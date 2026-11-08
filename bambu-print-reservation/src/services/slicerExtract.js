// ============================================================
// 3mf 切片参数提取器（2026-10-05 学习链路冷启动）
//
// 「机器学人」的起点：专家手工切好的 3mf 就是标注数据——提取其中
// 与本仓参数白名单可映射的核心参数，与 baseline 做 diff 生成候选规则
// 草稿（必须经待审池人工确认后转正，本模块不做任何自动生效）。
//
// 3mf = zip。提取优先级：
//   ① Metadata/project_settings.config（JSON，Bambu Studio 工程导出）
//   ② Metadata/plate_*.gcode 头部「; key = value」注释键值（切片产物）
// ⚠️ 字段名按 Bambu Studio 常见导出编写；真实文件若对不上，以 raw 键值
//    兜底展示人工核对——映射表首次真机使用时校准。
// ============================================================

const AdmZip = require('adm-zip');
const processRules = require('./processRules');

// Bambu Studio 参数名 → 本仓 PARAM_NAMES 映射
const BAMBU_PARAM_MAP = {
  layer_height: { param: 'layerHeight', num: true },
  initial_layer_print_height: null, // 忽略
  wall_loops: { param: 'wallLoops', num: true },
  top_shell_layers: { param: 'topShellLayers', num: true },
  bottom_shell_layers: { param: 'bottomShellLayers', num: true },
  sparse_infill_density: { param: 'infillDensity', pct: true },
  sparse_infill_pattern: {
    param: 'infillPattern',
    enum: { grid: 'grid', gyroid: 'gyroid', cubic: 'cubic', line: 'lines', lines: 'lines', zigzag: 'grid', honeycomb: 'grid' },
  },
  threshold_overhang_angle: { param: 'supportThresholdAngle', num: true },
  support_base_density: { param: 'supportDensity', pct: true },
  support_density: { param: 'supportDensity', pct: true },
  tree_support_branch_density: { param: 'supportDensity', pct: true },
  brim_width: { param: 'brimWidth', num: true },
  // nozzle_temperature 是绝对温度，材料默认各异，不做 Δ 换算（语义会错），不映射
  seam_position: {
    param: 'seamPosition',
    enum: { aligned: 'aligned', nearest: 'nearest', back: 'hidden', rear: 'hidden' },
  },
  xy_hole_compensation: { param: 'xyHoleComp', num: true },
  xy_contour_compensation: { param: 'xyContourComp', num: true },
  enable_support: { param: 'supportType', enum: { '1': 'auto', 'true': 'auto', '0': 'none', 'false': 'none' } },
  // Orca 2.4 的关闭值是 "no ironing"（不是 "none"）——只认 none 会把默认关闭误判成开启，
  // 回读拟合白扣一项（2026-10-19 R20261019-004 实锤）
  ironing_type: { param: 'ironing', enum: { none: 'false', 'no ironing': 'false' } }, // 其余任何非关闭值 → true
  brim_type: { param: 'brim', enum: { none: 'false', no_brim: 'false' } }, // 其余非空值 → true
};

/** 单值清洗：'40%' → 40、'0.16' → 0.16、布尔语义 */
function coerce(raw, def) {
  let v = String(raw).trim().toLowerCase();
  if (def.pct) v = v.replace(/%$/, '');
  if (def.num || def.pct) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  if (def.enum) {
    if (v in def.enum) return def.enum[v];
    if (def.param === 'ironing' || def.param === 'brim') return 'true'; // 非 none 值
    return null;
  }
  return null;
}

/** 预计打印时长（分钟）：gcode 头部注释两种流派——Orca/Bambu 系秒数、Prusa 系 h/m/s；
 *  project_settings.config 的 time_cost（秒，Bambu 工程导出，真机首次使用时核对）。
 *  解析失败返回 null（调用方按「无预估」降级，不影响提交） */
function parseEstimatedMinutes(headText, raw) {
  const m1 = /;\s*total estimated time \(s\)\s*[:=]\s*(\d+)/i.exec(headText);
  if (m1) return Math.round(Number(m1[1]) / 60);
  // v90：Bambu Studio 风味「; model printing time: 20h 37m 34s; total estimated time: 20h 42m 57s」
  // ——新导出的注释行带分号分隔的 model/total 两段，m2 的 PrusaSlicer 风味咬不住
  const mBbl = /total estimated time:\s*([\d\s*hms]+?)(?:;|$)/im.exec(headText);
  if (mBbl) {
    const h = /(\d+)\s*h/i.exec(mBbl[1]);
    const min = /(\d+)\s*m/i.exec(mBbl[1]);
    const s = /(\d+)\s*s/i.exec(mBbl[1]);
    const mins = (h ? Number(h[1]) * 60 : 0) + (min ? Number(min[1]) : 0) + (s ? Math.round(Number(s[1]) / 60) : 0);
    if (mins > 0) return mins;
  }
  const m2 = /;\s*estimated printing time[^=\n]*=\s*([\d\shdms]+)/i.exec(headText);
  if (m2) {
    const h = /(\d+)\s*h/i.exec(m2[1]);
    const min = /(\d+)\s*m/i.exec(m2[1]);
    const s = /(\d+)\s*s/i.exec(m2[1]);
    const mins = (h ? Number(h[1]) * 60 : 0) + (min ? Number(min[1]) : 0) + (s ? Math.round(Number(s[1]) / 60) : 0);
    return mins > 0 ? mins : null;
  }
  const tc = Number(raw.time_cost);
  return Number.isFinite(tc) && tc > 0 ? Math.round(tc / 60) : null;
}

// 解压炸弹护栏（2026-10-18 审查）：只读头部却 getData() 会整份解压——先按未压缩大小设限
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const MAX_GCODE_READ_BYTES = 64 * 1024 * 1024;
const entrySize = (e) => Number((e && e.header && e.header.size) || 0);

/** 从解包后的文件内容提取键值对（JSON 优先，gcode 头部注释兜底） */
function extractRawParams(files) {
  const raw = {};
  let source = 'none';
  let headText = '';

  // ① project_settings.config（JSON）
  const ps = files.find((f) => /metadata\/project_settings\.config$/i.test(f.entryName));
  if (ps && entrySize(ps) <= MAX_CONFIG_BYTES) {
    try {
      const obj = JSON.parse(ps.getData().toString('utf8'));
      for (const [k, v] of Object.entries(obj)) raw[k] = String(v);
      source = 'project_settings';
    } catch { /* 损坏则走 gcode 兜底 */ }
  }

  // ② plate_*.gcode 头部注释键值（读前 96KB 足够覆盖头部参数块）。
  // v90 修复：headText 无条件采集（project_settings 存在时也读）——estMinutes 的
  // 「total estimated time: 20h 42m 57s」在 gcode 头部，project_settings 优先分支
  // 曾把 headText 留空导致带参数文件的预估时长恒 null（20h43m 实案）
  {
    const gcode = files.find((f) => /metadata\/plate_\d+.*\.gcode$/i.test(f.entryName));
    if (gcode && entrySize(gcode) <= MAX_GCODE_READ_BYTES) {
      headText = gcode.getData().subarray(0, 96 * 1024).toString('utf8');
      if (source === 'none') {
        for (const m of headText.matchAll(/^;\s*([a-z_][a-z0-9_]*)\s*=\s*(\S+)\s*$/gim)) {
          if (!(m[1] in raw)) raw[m[1]] = m[2];
        }
        source = 'gcode';
      }
    }
  }
  return { raw, source, headText };
}

/**
 * 打印用料清单（2026-10-16 曼波真单批）：slice_info.config 的 <filament> 元素——
 * 切片器记录的「本板实际用料」（类型/颜色/用量），开打帧 ams_mapping2 的匹配底料。
 * 未用料槽（used_m/used_g 均 0 且 used_for_object!=true）剔除；解析失败按空清单处理。
 * v64 修订（H2多色.3mf 实案）：Bambu Studio 02.04 起 slice_info.config 只剩 header
 * （205 字节实锤），清单兜底从 project_settings.config 的 filament_colour ×
 * filament_type 平行数组按序配对提取（老格式 slice_info 优先不变）。
 */
function parseFilaments(zip) {
  const out = [];
  try {
    const e = zip.getEntry('Metadata/slice_info.config');
    if (e && entrySize(e) <= MAX_CONFIG_BYTES) {
      const xml = e.getData().toString('utf8');
      for (const m of xml.matchAll(/<filament\s([^>]*?)\/?>/g)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([\w-]+)="([^"]*)"/g)) attrs[a[1]] = a[2];
        const usedM = Number(attrs.used_m) || 0;
        const usedG = Number(attrs.used_g) || 0;
        if (attrs.used_for_object !== 'true' && usedM <= 0 && usedG <= 0) continue;
        out.push({
          type: attrs.type || '',
          colorHex: String(attrs.color || '').replace('#', '').slice(0, 6),
          trayIdx: attrs.tray_info_idx || '',
          usedG: usedG > 0 ? usedG : null, // 耗材量标签（2026-10-27 特征标签批）：克数随清单进样本库
        });
      }
    }
    if (!out.length) {
      const ps = zip.getEntry('Metadata/project_settings.config');
      if (ps && entrySize(ps) <= MAX_CONFIG_BYTES) {
        const obj = JSON.parse(ps.getData().toString('utf8'));
        const arr = (k) => (Array.isArray(obj[k]) ? obj[k].map(String) : []);
        const colours = arr('filament_colour');
        const types = arr('filament_type');
        if (colours.length && colours.length === types.length) {
          for (let i = 0; i < colours.length; i++) {
            out.push({ type: types[i], colorHex: colours[i].replace('#', '').slice(0, 6), trayIdx: '', usedG: null });
          }
        }
      }
    }
  } catch { /* 解析失败按无清单处理 */ }
  return out;
}

/**
 * slice_info.config 附加指纹（2026-11-06 v97 曼波令「喷嘴/打印板错误拒绝预约」）：
 *  - nozzle_diameters：切片喷嘴口径（逗号分隔，多喷头 H2D 形如 "0.4,0.4"）——硬约束，
 *    文件 0.2 落 0.4 实装机=机端秒 FAILED 83902535（R20261106-008/-009 实案）；
 *  - sliceWarnings：<warning> 告警清单（热床/喷嘴硬度等）——**建议级**（1000C001/
 *    1000C002 昨晚成功件同样携带并照打成功），不拦提交，只随单红标展示。
 * 解析失败按无附加处理（不推翻既有闸门结论）。
 */
function parseSliceInfoExtras(zip) {
  const out = { nozzleDiameters: [], sliceWarnings: [] };
  try {
    const e = zip.getEntry('Metadata/slice_info.config');
    if (!e || entrySize(e) > MAX_CONFIG_BYTES) return out;
    const xml = e.getData().toString('utf8');
    const nm = /key="nozzle_diameters"\s+value="([^"]+)"/.exec(xml);
    if (nm) {
      out.nozzleDiameters = nm[1]
        .split(',')
        .map((s) => Number(String(s).trim()))
        .filter((n) => Number.isFinite(n) && n > 0);
    }
    for (const m of xml.matchAll(/<warning\s([^>]*?)\/?>/g)) {
      const attrs = {};
      for (const a of m[1].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
      if (!attrs.msg) continue;
      out.sliceWarnings.push({ msg: attrs.msg, level: Number(attrs.level) || 0, errorCode: attrs.error_code || '' });
    }
  } catch { /* 解析失败按无附加处理 */ }
  return out;
}

/**
 * 是否真切片产物（v64）：工程 3mf（Bambu Studio 保存的工程）没有任何 plate gcode
 * 条目——此前被当直通单收下后，下发帧指向不存在的 Metadata/plate_1.gcode，机端
 * 找不到任务数据秒 FAILED（R20261031-002 实案）。提交链闸门用它打回并引导。
 * 接受 AdmZip 实例或原始 Buffer（v66 兼容——提交链前置探测传 Buffer）。
 */
function hasSlicedGcode(zipOrBuffer) {
  const zip = Buffer.isBuffer(zipOrBuffer) ? new AdmZip(zipOrBuffer) : zipOrBuffer;
  return zip.getEntries().some((f) => /metadata\/plate_\d+.*\.gcode$/i.test(f.entryName));
}

/**
 * 提取 3mf（Buffer）→ 可映射参数 + 与 baseline 的 diff（候选规则 set 草稿）+ 预计时长
 * @returns {{ source, params: Object, raw: Object, diff: Object, estMinutes: number|null,
 *             filaments: Array<{type,colorHex,trayIdx}>, bedType: string|null,
 *             nozzleDiameters: number[], sliceWarnings: Array<{msg,level,errorCode}> }}
 */
function extractFrom3mf(buffer) {
  const zip = new AdmZip(buffer);
  const files = zip.getEntries();
  const { raw, source, headText } = extractRawParams(files);
  const estMinutes = parseEstimatedMinutes(headText, raw);

  const params = {};
  for (const [bambuKey, def] of Object.entries(BAMBU_PARAM_MAP)) {
    if (!def || !(bambuKey in raw)) continue;
    const v = coerce(raw[bambuKey], def);
    if (v !== null && v !== undefined && v !== '') params[def.param] = v;
  }
  // 白名单过滤（防御映射表过期引入未知参数）
  for (const k of Object.keys(params)) {
    if (!processRules.PARAM_NAMES.includes(k)) delete params[k];
  }

  // 与 baseline 的 diff：值不同的参数构成候选 set
  const diff = {};
  for (const [k, v] of Object.entries(params)) {
    if (JSON.stringify(processRules.BASELINE[k]) !== JSON.stringify(v)) diff[k] = v;
  }

  // 开打帧底料：用料清单 + 板型（curr_bed_type，板型与切片不一致是打印失败/暂停的已知诱因）
  const filaments = parseFilaments(zip);
  const bedType = String(raw.curr_bed_type || '').trim() || null;
  // 目标机型（2026-10-16 曼波真机反馈批）：切片文件自带机型（project_settings.printer_model，
  // 缺则退回 slice_info 的 printer_model_id）——「拿闪铸机子切的 .gcode.3mf」扩展名会骗过
  // 品牌判断，内嵌机型是唯一权威
  let machineModel = String(raw.printer_model || '').trim() || null;
  if (!machineModel) {
    try {
      const si = zip.getEntry('Metadata/slice_info.config');
      if (si) {
        const xml = si.getData().toString('utf8');
        const m = /key="printer_model_id"\s+value="([^"]+)"/.exec(xml);
        if (m) machineModel = m[1].replace(/-/g, ' ').trim();
      }
    } catch { /* 解析失败按无内嵌处理 */ }
  }

  return {
    source, params, raw, diff, estMinutes, filaments, bedType, machineModel,
    sliced: hasSlicedGcode(zip),
    ...parseSliceInfoExtras(zip),
  };
}

/**
 * 纯 .gcode 头部指纹提取（2026-11-06 跨品牌误派 P0 修复）：拓竹系切片器（Orca/Bambu
 * Studio）导出的 .gcode 头部自带 `; printer_model = <机型>`——与 3mf 内嵌机型同源。
 * 此前 .gcode 没有任何提取，提交链 embeddedParams 为 null → 学习选机按扩展名兜底
 * 「.gcode=闪铸」瞎猜，把拓竹 H2D 的切片派给闪铸 A5P 打出废件（R20261106-001 实案）。
 * 头部 256KB 窗口：CONFIG_BLOCK 按字母序排参（R20261106-001 实单 printer_model 在偏移
 * 37017——4KB 窗口会漏），Orca 完整头一般 <100KB。读取失败按无指纹处理（调用方 fail-closed）。
 * @param {Buffer|string} buffer 文件内容（或其头部 ≥256KB）
 * @returns {{machineModel: string|null, estMinutes: number|null}}
 */
function extractGcodeMeta(buffer) {
  const head = Buffer.from(buffer).subarray(0, 256 * 1024).toString('utf8');
  let machineModel = null;
  const pm = /^;\s*printer_model\s*=\s*(.+)$/m.exec(head);
  if (pm && String(pm[1]).trim()) machineModel = pm[1].trim();
  // 预估时长与 3mf 同款注释（"; model printing time: ...; total estimated time: 17m 23s"），
  // 复用 parseEstimatedMinutes（mBbl 分支咬得住 Orca/Bambu 风味）
  let estMinutes = null;
  try {
    estMinutes = parseEstimatedMinutes(head, {});
  } catch { /* 解析失败按无预估降级 */ }
  return { machineModel, estMinutes };
}

module.exports = { extractFrom3mf, extractGcodeMeta, BAMBU_PARAM_MAP, parseEstimatedMinutes, parseFilaments, hasSlicedGcode };
