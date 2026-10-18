// ============================================================
// 模型单自动切片（2026-10-18 曼波令「模型勾选了份数就要自动排版」+ P0 切片桥接）
//
// 链路：需求链路单（stl/step）在**分发时刻**按审批勾选的引擎参数自动切片：
//   勾选 → processRules（含材料特性策略）→ 参数档 → Orca CLI（--copies N 盘内排布）
//   → 已切片 3mf → 上传开打。份数语义在此从「串行续打」变为「盘内多件」（一次成型）。
//
// 兼容性（能力矩阵 + 档位解析）：只对拓竹机型；机型 → machine 档、材料 → filament 档
// （统一 @BBL X1C 系，2026-10-18 实机实测 P1S 机器 + X1C 档可切）；无档机型诚实报错。
// 回读校验：产物内嵌参数与引擎参数比对（paramFit v2），拟合度随分发日志输出。
// 复现性：产物按「单号-份数-源文件 mtime/size」缓存，重试不重切。
// ============================================================

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const processRules = require('./processRules');
const paramFit = require('./paramFit');
const slicerExtract = require('./slicerExtract');
const { capabilitiesFor } = require('../printer/capabilities');

const SLICE_DIR = process.env.AUTO_SLICE_DIR || path.join(os.tmpdir(), 'bambu-auto-slices');
const BRIDGE = path.join(__dirname, '..', '..', 'scripts', 'slice-with-engine.js');
const MAX_COPIES = 50; // 单盘份数上限（Orca 自动排布；超过手动切）
const SLICE_TIMEOUT_MS = 10 * 60 * 1000;

/** 异步跑切片桥（2026-10-18：**不可用 spawnSync**——分发锁内同步阻塞会让 MQTT 状态处理/
 *  网页请求全部卡死分钟级） */
function runBridge(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { windowsHide: true });
    let out = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* 已退出 */ } }, SLICE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ status: -1, out, stderr: stderr + err.message, timedOut }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ status: code, out, stderr, timedOut }); });
  });
}

/** 机型 → 切片桥档位（2026-10-18 档名实核；H2C 等无档机型由桥报「档位文件不存在」） */
const PROFILE_RULES = [
  { match: /H2D|H2S/i, machine: 'Bambu Lab H2D 0.4 nozzle', process: '0.20mm Standard @BBL H2D' },
  { match: /X1/i, machine: 'Bambu Lab X1 Carbon 0.4 nozzle', process: '0.20mm Standard @BBL X1C' },
  { match: /P1/i, machine: 'Bambu Lab P1S 0.4 nozzle', process: '0.20mm Standard @BBL X1C' },
  { match: /A1/i, machine: 'Bambu Lab A1 0.4 nozzle', process: '0.20mm Standard @BBL A1' },
];

/** 材料 → 耗材档（统一 @BBL X1C 系，机器档由桥做兼容降级） */
const MATERIAL_PROFILES = {
  PLA: 'Bambu PLA Basic @BBL X1C',
  'PLA-CF': 'Bambu PLA-CF @BBL X1C',
  PETG: 'Bambu PETG Basic @BBL X1C',
  'PETG-CF': 'Bambu PETG-CF @BBL X1C',
  ABS: 'Bambu ABS @BBL X1C',
  ASA: 'Bambu ASA @BBL X1C',
  TPU: 'Bambu TPU 95A @BBL X1C',
  PC: 'Bambu PC @BBL X1C',
  PA: 'Bambu PA-CF @BBL X1C',
  'PA-CF': 'Bambu PA-CF @BBL X1C',
};

function normalizeMaterial(materialType) {
  const raw = String(materialType || 'PLA').toUpperCase().replace(/\s+/g, '');
  const base = raw.split(/[+＋/、,，]/)[0] || 'PLA';
  if (MATERIAL_PROFILES[base]) return { key: base, profile: MATERIAL_PROFILES[base], note: '' };
  const stripped = base.replace(/-CF$/, '');
  if (stripped !== base && MATERIAL_PROFILES[stripped]) {
    return { key: stripped, profile: MATERIAL_PROFILES[stripped], note: `材料 ${base} 无独立档，按 ${stripped} 基材档切片` };
  }
  return { key: 'PLA', profile: MATERIAL_PROFILES.PLA, note: `材料「${materialType || '(空)'}」未匹配，按 PLA 档切片` };
}

/** 机型/材料 → 档位组（拓竹专供；未知机型诚实抛错） */
function resolveSliceProfiles(model, materialType) {
  const caps = capabilitiesFor(model);
  if (caps.brand !== 'bambu') throw new Error(`自动切片仅支持拓竹机型（${model} 为闪铸，请预先切好 gcode）`);
  const m = String(model || '').toUpperCase();
  const hit = PROFILE_RULES.find((r) => r.match.test(m));
  if (!hit) throw new Error(`机型「${model}」没有对应的 Orca 机器档（自动切片暂不支持）`);
  const mat = normalizeMaterial(materialType);
  return { machine: hit.machine, process: hit.process, filament: mat.profile, notes: [mat.note].filter(Boolean) };
}

function clampCopies(quantity) {
  return Math.max(1, Math.min(MAX_COPIES, Math.floor(Number(quantity) || 1)));
}

/** STEP/STP → 临时 STL（Orca CLI 对 CAD 网格化格式支持不稳，先经 occt 转网格） */
async function ensureStlPath(sourcePath, fileName) {
  if (!/\.(step|stp)$/i.test(fileName || '')) return sourcePath;
  const parsed = await require('../utils/stepMesh').parseCadToParsed(fs.readFileSync(sourcePath), fileName);
  if (parsed.error) throw new Error(`STEP 解析失败：${parsed.error}`);
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  const out = path.join(SLICE_DIR, `cad-${Date.now()}-${Math.round(Math.random() * 1e6)}.stl`);
  const { positions, faces, triangles } = parsed;
  const buf = Buffer.alloc(84 + 50 * triangles);
  buf.writeUInt32LE(triangles, 80);
  for (let t = 0; t < triangles; t++) {
    const off = 84 + t * 50;
    const pts = [faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const w = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n.forEach((v, j) => buf.writeFloatLE(v / l, off + j * 4));
    pts.forEach((p, j) => p.forEach((v, k) => buf.writeFloatLE(v, off + 12 + j * 12 + k * 4)));
  }
  fs.writeFileSync(out, buf);
  return out;
}

/** 产物元信息：盘内 object 数（= 份数）+ 内嵌切片参数提取 */
function inspectOutput(outPath) {
  const AdmZip = require('adm-zip');
  const buf = fs.readFileSync(outPath);
  const zip = new AdmZip(buf);
  const si = zip.getEntry('Metadata/slice_info.config');
  const objects = si ? (si.getData().toString('utf8').match(/<object[^>]*/g) || []).length : 0;
  let extraction = null;
  try { extraction = slicerExtract.extractFrom3mf(buf); } catch { /* 提取失败不阻塞分发 */ }
  return { objects, extraction };
}

/**
 * 切片一次（模型单自动切片核心）。份数 = 盘内件数（Orca 原生排布）。
 * @returns {{ok, outPath, copies, objects, fit, profiles, log}}
 */
async function sliceModel({ sourcePath, fileName, model, materialType, selection, params, quantity, outDir }) {
  const profiles = resolveSliceProfiles(model, materialType);
  const applied = params ? { params, blocked: false, errors: [] } : processRules.applyRules(selection || {}, { material: materialType || '' });
  if (applied.blocked) throw new Error(`勾选存在硬冲突，无法自动切片：${(applied.errors || []).join('；')}`);
  const copies = clampCopies(quantity);
  const dir = outDir || SLICE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${Date.now()}-${Math.round(Math.random() * 1e6)}.gcode.3mf`);
  const stlPath = await ensureStlPath(sourcePath, fileName);
  const args = [BRIDGE, stlPath, outPath,
    '--machine', profiles.machine,
    '--process', profiles.process,
    '--filament', profiles.filament,
    '--params', JSON.stringify(applied.params || {}),
    '--copies', String(copies)];
  const r = await runBridge(args);
  const log = `${r.out}${r.stderr}`.trim();
  if (r.timedOut) throw new Error(`自动切片超时（${Math.round(SLICE_TIMEOUT_MS / 60000)} 分钟）`);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error(`自动切片失败（桥退出 ${r.status}）：${log.split('\n').slice(-3).join(' | ') || '无输出'}`);
  }
  const { objects, extraction } = inspectOutput(outPath);
  const fit = extraction && extraction.params ? paramFit.compare(applied.params || {}, extraction.params) : null;
  return { ok: true, outPath, copies, objects, fit, profiles, log };
}

/** 分发链入口：按任务份数切片（盘内多件），产物缓存（同单同份数同源文件复用，重试不重切） */
async function ensureSliced(task, printer) {
  const copies = clampCopies((Number(task.remaining) || 0) + 1);
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  const cachePath = path.join(SLICE_DIR, `${task.recordId}-x${copies}.gcode.3mf`);
  const metaPath = cachePath + '.meta.json';
  const stat = fs.statSync(task.filePath);
  if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.sourceMtimeMs === stat.mtimeMs && meta.sourceSize === stat.size) {
        console.log(`[自动切片] ${task.recordId} 复用缓存（${meta.copies} 件/盘，${meta.objects} object）`);
        return { buffer: fs.readFileSync(cachePath), copies: meta.copies, objects: meta.objects, fit: meta.fit };
      }
    } catch { /* 缓存损坏 → 重切 */ }
  }
  const result = await sliceModel({
    sourcePath: task.filePath,
    fileName: task.fileName,
    model: printer.model,
    materialType: task.materialType,
    selection: task.selection || {},
    quantity: copies,
    outDir: SLICE_DIR,
  });
  fs.copyFileSync(result.outPath, cachePath);
  fs.writeFileSync(metaPath, JSON.stringify({
    savedAt: new Date().toISOString(),
    copies: result.copies,
    objects: result.objects,
    fit: result.fit,
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
  }, null, 2));
  try { fs.unlinkSync(result.outPath); } catch { /* 已不存在 */ }
  return { buffer: fs.readFileSync(cachePath), copies: result.copies, objects: result.objects, fit: result.fit };
}

module.exports = { sliceModel, ensureSliced, resolveSliceProfiles, normalizeMaterial, clampCopies, MAX_COPIES, SLICE_DIR };
