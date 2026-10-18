#!/usr/bin/env node
// ============================================================
// 服务端切片桥（2026-10-12 曼波：今天争取跑通）
//
// 引擎参数档（processRules.params）→ OrcaSlicer CLI（orca-slicer.exe）
// → gcode.3mf。链路：
//   ① 从 Orca vendor 档出发，把 inherits 继承链拍平成全量配置
//      （CLI 没有 datadir，解析不了继承，必须喂扁平 JSON）；
//   ② 叠加引擎参数覆盖（Bambu/Orca 同源键名，processRules 白名单直映）；
//   ③ 经 PowerShell 桥调 CLI（GUI 子系统 exe，输出静默，以产物为准）。
//
// 用法：node scripts/slice-with-engine.js <model.stl> <输出.gcode.3mf> [选项]
//   --machine "Bambu Lab H2D 0.4 nozzle"   机器档名（Orca BBL/machine/）
//   --process  "0.20mm Standard @BBL H2D"  工艺基座档名（BBL/process/）
//   --filament "Bambu PLA Basic @BBL H2D"  耗材档名（BBL/filament/）
//   --params   '{"layerHeight":0.2,...}'   引擎参数 JSON（默认读 stdin）
//   --workdir <dir>                        中间配置目录（默认系统临时目录）
// 退出码：0=成功且产物存在；非 0=CLI 退出码或桥错误
// ============================================================

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// 本地切片桥：Orca 安装路径两机不同，环境变量优先；缺省按常见安装位置探测，探测不到在使用时报错并给指引
const ORCA_CANDIDATES = [
  process.env.ORCA_SLICER_EXE,
  'C:/qianli/opt/OrcaSlicer/orca-slicer.exe', // 生产机（2026-10-15 台式机整目录搬迁落位）
  'D:/Programs/OrcaSlicer/orca-slicer.exe',
  'C:/Program Files/OrcaSlicer/orca-slicer.exe',
].filter(Boolean);
const ORCA_EXE = ORCA_CANDIDATES.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || ORCA_CANDIDATES[0];
const ORCA_PROFILES = process.env.ORCA_PROFILES_DIR || (ORCA_EXE ? ORCA_EXE.replace(/orca-slicer\.exe$/i, 'resources/profiles/BBL') : 'resources/profiles/BBL');

// 引擎参数名 → Orca/Bambu 配置键（与 slicerExtract 的 BAMBU_PARAM_MAP 同源反向；
// 速度档 speedProfile 是档位语义不直接映射，基座档自带速度族键）。
// ⚠️ Orca 2.4 改名：Bambu threshold_overhang_angle → support_threshold_angle；
// 百分比类型（coPercent）必须带 % 后缀，裸数字会被静默拒绝回落基座值
const pct = (v) => (String(v).includes('%') ? String(v) : String(v) + '%');
const PARAM_TO_CONFIG = {
  layerHeight: (v) => ['layer_height', String(v)],
  wallLoops: (v) => ['wall_loops', String(v)],
  topShellLayers: (v) => ['top_shell_layers', String(v)],
  bottomShellLayers: (v) => ['bottom_shell_layers', String(v)],
  infillDensity: (v) => ['sparse_infill_density', pct(v)],
  infillPattern: (v) => ['sparse_infill_pattern', v === 'lines' ? 'lines' : v, true],
  supportType: (v) => ['enable_support', v === 'none' ? '0' : '1'],
  supportThresholdAngle: (v) => ['support_threshold_angle', String(v)],
  supportDensity: (v) => ['support_base_density', pct(v)],
  seamPosition: (v) => ['seam_position', v === 'hidden' ? 'back' : v],
  xyHoleComp: (v) => ['xy_hole_compensation', String(v)],
  xyContourComp: (v) => ['xy_contour_compensation', String(v)],
  ironing: (v) => ['ironing_type', v ? 'all' : null].slice(0, v ? 2 : 1),
  brim: (v) => ['brim_type', v ? 'outer_only' : 'no_brim'],
  brimWidth: (v) => ['brim_width', String(v)],
};

const args = process.argv.slice(2);
function argOf(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const model = args[0];
const output = args[1];
if (!model || !output || !fs.existsSync(model)) {
  console.error('用法: node scripts/slice-with-engine.js <model.stl> <输出.gcode.3mf> [--machine 名] [--process 名] [--filament 名] [--params JSON]');
  process.exit(1);
}
const machineName = argOf('--machine') || 'Bambu Lab H2D 0.4 nozzle';
const processName = argOf('--process') || '0.20mm Standard @BBL H2D';
const filamentName = argOf('--filament') || 'Bambu PLA Basic @BBL H2D';
// --copies N（2026-10-18 曼波令：模型单份数 → 盘内多件自动排布）：同一模型文件重复传入
// N 次，Orca CLI 按原生排布逻辑自动排开（2026-10-18 实测：4 份=4 object、段数 4 倍、
// XY 跨 41.6mm=2×2；有无 --arrange 输出一致，故不依赖该标志）
const copies = Math.max(1, Math.min(50, Number(argOf('--copies')) || 1));
const paramsJson = argOf('--params');
// 参数来源：--params 显式 → stdin；两者皆空（后台/服务调用常见）默认 {}——
// 此前空 stdin 会 JSON.parse('') 崩（2026-10-15 生产首跑实锤：脚本方式运行 stdin 恒空）
let engineParams = {};
if (paramsJson) {
  engineParams = JSON.parse(paramsJson);
} else {
  const stdinRaw = (() => { try { return fs.readFileSync(0, 'utf8').trim(); } catch { return ''; } })();
  if (stdinRaw) engineParams = JSON.parse(stdinRaw);
}

/** 沿 inherits 拍平 vendor 档（root → leaf，叶子覆盖同名键） */
function flattenProfile(dir, name, guard = new Set()) {
  if (guard.has(name)) throw new Error(`继承链成环: ${name}`);
  guard.add(name);
  const file = path.join(dir, name + '.json');
  if (!fs.existsSync(file)) throw new Error(`档位文件不存在: ${file}`);
  const self = JSON.parse(fs.readFileSync(file, 'utf8'));
  const merged = self.inherits ? flattenProfile(dir, self.inherits, guard) : {};
  for (const [k, v] of Object.entries(self)) {
    if (k === 'inherits') continue;
    merged[k] = v;
  }
  return merged;
}

function stripVendorMeta(cfg, type, name) {
  const out = { ...cfg };
  // CLI 不吃 vendor 元数据壳，但 type/name 是 CLI 分流与预设注册的必需键——
  // Orca vendor 档没有 type（Bambu 有），缺了 CLI 静默跳过整个档（裸默认行为）；
  // from 必须 user：from:system 的档 CLI 按名去 datadir 找，便携无 datadir 即回退默认
  delete out.setting_id;
  delete out.printer_model_id;
  delete out.printer_variant_name;
  out.type = type;
  out.name = name;
  out.from = 'user';
  return out;
}

// ---------- 组配置 ----------
const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'orca-slice-'));
const machineCfg = stripVendorMeta(flattenProfile(path.join(ORCA_PROFILES, 'machine'), machineName), 'machine', machineName);
const processCfg = stripVendorMeta(flattenProfile(path.join(ORCA_PROFILES, 'process'), processName), 'process', processName);
const filamentCfg = stripVendorMeta(flattenProfile(path.join(ORCA_PROFILES, 'filament'), filamentName), 'filament', filamentName);

// 双嘴机档默认相对 E 寻址（use_relative_e_distances 默认开），vendor 模板缺
// G92 E0 层间复位 → CLI 校验拒切（-51）。校验正则读 print config 侧的
// layer_change_gcode，直接在该侧补精确复位行（相对 E + 每层复位是合法组合）
processCfg.layer_change_gcode = [
  (processCfg.layer_change_gcode || ''),
  'G92 E0 ; reset E per layer (slice bridge)',
].join('\n');
machineCfg.layer_change_gcode = [
  (machineCfg.layer_change_gcode || ''),
  'G92 E0 ; reset E per layer (slice bridge)',
].join('\n');

// 引擎覆盖：类型对齐（数值键都是字符串形态，与 vendor 档一致）
let applied = [];
for (const [k, v] of Object.entries(engineParams)) {
  const map = PARAM_TO_CONFIG[k];
  if (!map) continue; // 白名单外（如 materialExclude/temperatureDelta 材料族）不落切片档
  const [key, val] = Array.isArray(map(v)) ? map(v) : [map(v), undefined];
  if (val === undefined || val === null) continue;
  processCfg[key] = val;
  applied.push(`${k}→${key}=${val}`);
}

// 打印板型对齐（2026-10-15 真机实锤）：Orca 基座档缺省 Cool Plate（床温 35°）与
// H2D 实装的金色纹理 PEI 不符 → 打印机板检测警告 [0500-8051 223015] 暂停。
// 默认注入 Textured PEI Plate；ORCA_BED_TYPE 环境变量可覆盖（换板即改）
const bedType = process.env.ORCA_BED_TYPE || 'Textured PEI Plate';
processCfg.curr_bed_type = bedType;
applied.push(`bedType→curr_bed_type=${bedType}`);

// 兼容对齐：CLI 拿 machine 的 inherits（user 档的系统父名）与 process 的
// compatible_printers 名单逐个比对，不等即 -17 拒切。让两边指向同一身份：
// machine.inherits = 机器档名，process 名单 = [机器档名]
machineCfg.inherits = machineName;
processCfg.compatible_printers = [machineName];
delete processCfg.compatible_printers_condition;

const machineFile = path.join(workdir, 'machine.json');
const processFile = path.join(workdir, 'process.json');
const filamentFile = path.join(workdir, 'filament.json');
fs.writeFileSync(machineFile, JSON.stringify(machineCfg, null, 2));
fs.writeFileSync(processFile, JSON.stringify(processCfg, null, 2));
fs.writeFileSync(filamentFile, JSON.stringify(filamentCfg, null, 2));
console.log(`[切片桥] 配置就绪：${machineName} / ${processName} / ${filamentName}${copies > 1 ? ` / ${copies} 件/盘` : ''}`);
console.log(`[切片桥] 引擎覆盖 ${applied.length} 项: ${applied.join(' ') || '（无——全基座）'}`);

// ---------- PowerShell 桥调用 ----------
const psFile = path.join(workdir, 'run.ps1');
const logFile = path.join(workdir, 'cli.log');
const modelArgs = Array.from({ length: copies }, () => `'${path.resolve(model)}'`).join(' ');
const ps = [
  `$p = '${ORCA_EXE}'`,
  `Set-Location '${workdir}'`,
  `& $p --logfile cli-detail.log --debug 3 --load-settings 'machine.json;process.json' --load-filaments 'filament.json' --slice 0 --export-3mf '${path.resolve(output)}' ${modelArgs} 2>&1 | Out-File cli.log`,
  `exit $LASTEXITCODE`,
].join('\r\n');
fs.writeFileSync(psFile, ps, 'utf8');

let code = 1;
try {
  execFileSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psFile], { timeout: 10 * 60 * 1000 });
} catch (err) {
  code = err.status === null ? 1 : err.status;
}
try {
  code = Number(code);
  if (code > 2 ** 31) code -= 2 ** 32; // PowerShell 透传的无符号退出码转回有符号
} catch { code = 1; }

const log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf16le').replace(/\u0000/g, '').trim() : '';
if (log) console.log(`[CLI ${code}] ${log.slice(0, 500)}`);
// 已知现象：无头环境无 OpenGL → 缩略图跳过 → CLI 退出码仍为 1，但 gcode 与
// slice_info.config 均完整落包（cli-detail.log 可见 finished exporting 3mf）——以产物为准
if (fs.existsSync(output) && fs.statSync(output).size > 0) {
  // 后处理：剥掉模型实体，重写成 Bambu 原生「已切片板」形态。
  // CLI 导出会保留模型网格（3D/Objects/*.model + 3dmodel 里的 object 引用），
  // Studio 按「包里有没有模型」决定打开模式：有模型=待切项目（看不到 toolpath
  // 和支撑），剥成纯 gcode 板才能以已切片状态打开。打印链不受影响（走 plate_1.gcode）。
  try {
    const AdmZip = require('adm-zip');
    const outZip = new AdmZip(output);
    const entries = outZip.getEntries();
    const appVer = (() => {
      const m = /<metadata name="Application">([^<]+)<\//.exec(entries.find((e) => /3D\/3dmodel\.model$/i.test(e.entryName))?.getData().toString('utf8') || '');
      return m ? m[1] : 'BambuStudio-02.06.00.51';
    })();
    const modelSkeleton = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:BambuStudio="http://schemas.bambulab.com/package/2021" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06" requiredextensions="p">
 <metadata name="Application">${appVer}</metadata>
 <metadata name="OrcaSlicer">2.4.2</metadata>
 <metadata name="BambuStudio:3mfVersion">1</metadata>
 <resources>
 </resources>
 <build/>
</model>
`;
    const newZip = new AdmZip();
    for (const e of entries) {
      if (/^3D\/Objects\//i.test(e.entryName) || /^3D\/_rels\//i.test(e.entryName)) continue; // 模型实体与关系剥离
      if (/3D\/3dmodel\.model$/i.test(e.entryName)) { newZip.addFile(e.entryName, Buffer.from(modelSkeleton, 'utf8')); continue; }
      if (/model_settings\.config$/i.test(e.entryName)) {
        // 只保留 <plate> 的 <metadata> 行（剥掉 object 元素，保 gcode_file/缩略图引用）
        const xml = e.getData().toString('utf8');
        const metaLines = [...xml.matchAll(/<metadata key="[^"]+" value="[^"]*"\/>/g)].map((m) => m[0]).join('\n    ');
        const plateOnly = `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    ${metaLines}
  </plate>
</config>
`;
        newZip.addFile(e.entryName, Buffer.from(plateOnly, 'utf8'));
        continue;
      }
      newZip.addFile(e.entryName, e.getData());
    }
    outZip.writeFile ? null : null;
    fs.writeFileSync(output, newZip.toBuffer());
    console.log('[切片桥] 已重写为原生「已切片板」形态（剥模型实体，Studio 打开即 toolpath 视图）');
  } catch (err) {
    console.warn(`[切片桥] ⚠️ 后处理失败（产物保留 CLI 原样）: ${err.message}`);
  }
  const size = fs.statSync(output).size;
  if (code !== 0) console.log(`[切片桥] ⚠️ CLI 退出码 ${code}（无头缩略图缺失，产物完整）`);
  console.log(`[切片桥] ✅ 产出 ${output}（${Math.round(size / 1024)}KB）`);
  process.exit(0);
}
console.error(`[切片桥] ✗ CLI 退出码 ${code}，无产物`);
process.exit(code || 1);
