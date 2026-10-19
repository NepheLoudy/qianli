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
const crypto = require('crypto');
const { spawn } = require('child_process');
const processRules = require('./processRules');
const paramFit = require('./paramFit');
const slicerExtract = require('./slicerExtract');
const modelOrient = require('./modelOrient');
const orientationPolicyStore = require('./orientationPolicyStore');
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

/** 机型 → 切片桥档位（2026-10-18 档名实核；H2C 无官方档 → H2D 兼容降级并明示） */
const PROFILE_RULES = [
  { match: /H2D|H2S/i, machine: 'Bambu Lab H2D 0.4 nozzle', process: '0.20mm Standard @BBL H2D' },
  // H2C（README 已记录 Orca 2.4.2 未带该机器档）：按 H2D 兼容档切片——同家族运动/挤出结构，
  // 差异（腔体/喷头配置）在产物回读与人工审批里兜底；诚实标注不静默
  { match: /H2C/i, machine: 'Bambu Lab H2D 0.4 nozzle', process: '0.20mm Standard @BBL H2D', note: 'Orca 2.4.2 无 H2C 机器档——按 H2D 兼容档切片，尺寸/挤出差异需人工复核' },
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
  return { machine: hit.machine, process: hit.process, filament: mat.profile, notes: [hit.note || '', mat.note].filter(Boolean) };
}

function clampCopies(quantity) {
  return Math.max(1, Math.min(MAX_COPIES, Math.floor(Number(quantity) || 1)));
}

/**
 * 解析模型 → 自动摆向 → 临时 STL（Orca CLI 对 CAD 格式支持不稳，统一走网格）。
 * 摆向规则（2026-10-19 曼波实锤补全 directionStrategy）：
 *   · 用户放置过（placement 四元数）→ 按用户朝向烘焙，不再自动改向；
 *   · directionStrategy=keep → 保持原朝向；
 *   · 其余（auto/avoid-z-load）→ 24 轴向搜索接触/支撑最优摆向；
 *   · 原始 STL 且无需改向 → 直接复用源文件，不无谓重写。
 * @returns {{path:string, orientation:object|null}}
 */
async function prepareModelPath(sourcePath, fileName, params = {}, placement = null, policy = null) {
  let parsed;
  if (/\.(step|stp)$/i.test(fileName || '')) {
    parsed = await require('../utils/stepMesh').parseCadToParsed(fs.readFileSync(sourcePath), fileName);
    if (parsed.error) throw new Error(`STEP 解析失败：${parsed.error}`);
  } else if (/\.stl$/i.test(fileName || '')) {
    parsed = require('./modelFeatures').parseStl(fs.readFileSync(sourcePath));
    if (parsed.error) throw new Error(`STL 解析失败：${parsed.error}`);
  } else {
    return { path: sourcePath, orientation: null }; // obj 等格式直通（由桥自行处理）
  }
  let orientation;
  if (Array.isArray(placement) && placement.length === 4) {
    parsed = modelOrient.applyQuaternion(parsed, placement);
    orientation = { changed: true, placement: true, note: '按用户放置朝向切片（尊重手动摆向）' };
  } else {
    orientation = modelOrient.chooseOrientation(parsed, { strategy: params.directionStrategy, policy });
    if (orientation.changed) parsed = modelOrient.applyOrientation(parsed, orientation);
  }
  if (/\.stl$/i.test(fileName || '') && !orientation.changed) {
    return { path: sourcePath, orientation };
  }
  const normalized = modelOrient.normalize(parsed);
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  const out = path.join(SLICE_DIR, `oriented-${Date.now()}-${Math.round(Math.random() * 1e6)}.stl`);
  modelOrient.writeBinaryStl(normalized, out);
  return { path: out, orientation };
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
async function sliceModel({ sourcePath, fileName, model, materialType, selection, params, quantity, outDir, placement = null }) {
  const profiles = resolveSliceProfiles(model, materialType);
  const applied = params ? { params, blocked: false, errors: [] } : processRules.applyRules(selection || {}, { material: materialType || '' });
  if (applied.blocked) throw new Error(`勾选存在硬冲突，无法自动切片：${(applied.errors || []).join('；')}`);
  const copies = clampCopies(quantity);
  const dir = outDir || SLICE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const outPath = path.join(dir, `${Date.now()}-${Math.round(Math.random() * 1e6)}.gcode.3mf`);
  // 摆向策略：审批快照里显式携带优先，其次已采纳的学习策略，最后冷启动启发式
  const activePolicy = (applied.params && applied.params.orientationPolicy) || orientationPolicyStore.getActive();
  const prepared = await prepareModelPath(sourcePath, fileName, applied.params || {}, placement, activePolicy);
  if (prepared.orientation && prepared.orientation.note) profiles.notes.push(prepared.orientation.note);
  const args = [BRIDGE, prepared.path, outPath,
    '--machine', profiles.machine,
    '--process', profiles.process,
    '--filament', profiles.filament,
    '--params', JSON.stringify(applied.params || {}),
    '--copies', String(copies)];
  let r;
  try {
    r = await runBridge(args);
  } finally {
    if (prepared.path !== sourcePath) { try { fs.unlinkSync(prepared.path); } catch { /* 已不存在 */ } }
  }
  const log = `${r.out}${r.stderr}`.trim();
  if (r.timedOut) throw new Error(`自动切片超时（${Math.round(SLICE_TIMEOUT_MS / 60000)} 分钟）`);
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size === 0) {
    throw new Error(`自动切片失败（桥退出 ${r.status}）：${log.split('\n').slice(-3).join(' | ') || '无输出'}`);
  }
  const { objects, extraction } = inspectOutput(outPath);
  // 件数核对（2026-10-18 审查）：产物 object 数必须等于请求份数——排布失败时
  // Orca 可能只打 1 件，静默放行会让「4 份单」实际只出 1 件。读不出 object 数
  // （老切片器/异常产物）才降级放行，由回读拟合与人工预览兜底
  if (objects > 0 && objects !== copies) {
    throw new Error(`自动切片排布核对失败：请求 ${copies} 件/盘，产物只有 ${objects} 件（切片器未正确复制排盘）——请人工切片后上传 gcode.3mf`);
  }
  const fit = extraction && extraction.params ? paramFit.compare(applied.params || {}, extraction.params) : null;
  return { ok: true, outPath, copies, objects, fit, profiles, orientation: prepared.orientation, log };
}

/** 分发链入口：按任务份数切片（盘内多件），产物缓存（同单同份数同源文件同参数复用，重试不重切） */
async function ensureSliced(task, printer) {
  const copies = clampCopies((Number(task.remaining) || 0) + 1);
  // 审批快照优先（2026-10-18 审查）：规则库演进不应改变已审批单的切片口径；
  // 老单无快照才现算规则。快照参数同时进缓存签名——参数一变缓存自然失效
  let params = task.processParams || null;
  if (!params) {
    const applied = processRules.applyRules(task.selection || {}, { material: task.materialType || '' });
    if (applied.blocked) throw new Error(`勾选存在硬冲突，无法自动切片：${(applied.errors || []).join('；')}`);
    params = applied.params;
  }
  const signature = crypto.createHash('md5')
    .update(JSON.stringify({
      model: printer.model,
      material: task.materialType || '',
      selection: task.selection || {},
      params: params || {},
      placement: task.placement || null,
      orient: 'v2', // 摆向算法版本（2026-10-19 引入自动摆向）——旧缓存自动失效
      policy: ((params && params.orientationPolicy) || orientationPolicyStore.getActive() || {}).version || 'cold-start',
    }))
    .digest('hex')
    .slice(0, 10);
  fs.mkdirSync(SLICE_DIR, { recursive: true });
  const cachePath = path.join(SLICE_DIR, `${task.recordId}-x${copies}-${signature}.gcode.3mf`);
  const metaPath = cachePath + '.meta.json';
  const stat = fs.statSync(task.filePath);
  if (fs.existsSync(cachePath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.sourceMtimeMs === stat.mtimeMs && meta.sourceSize === stat.size
        && meta.copies === copies && meta.signature === signature) {
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
    params,
    quantity: copies,
    outDir: SLICE_DIR,
    placement: task.placement || null,
  });
  fs.copyFileSync(result.outPath, cachePath);
  fs.writeFileSync(metaPath, JSON.stringify({
    savedAt: new Date().toISOString(),
    copies: result.copies,
    objects: result.objects,
    fit: result.fit,
    signature,
    machine: printer.model,
    materialType: task.materialType || '',
    sourceMtimeMs: stat.mtimeMs,
    sourceSize: stat.size,
  }, null, 2));
  try { fs.unlinkSync(result.outPath); } catch { /* 已不存在 */ }
  return { buffer: fs.readFileSync(cachePath), copies: result.copies, objects: result.objects, fit: result.fit };
}

module.exports = { sliceModel, ensureSliced, resolveSliceProfiles, normalizeMaterial, clampCopies, MAX_COPIES, SLICE_DIR };
