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
  ironing_type: { param: 'ironing', enum: { none: 'false' } }, // 其余任何非 none 值 → true
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

  // ② plate_*.gcode 头部注释键值（读前 96KB 足够覆盖头部参数块）
  if (source === 'none') {
    const gcode = files.find((f) => /metadata\/plate_\d+.*\.gcode$/i.test(f.entryName));
    if (gcode && entrySize(gcode) <= MAX_GCODE_READ_BYTES) {
      headText = gcode.getData().subarray(0, 96 * 1024).toString('utf8');
      for (const m of headText.matchAll(/^;\s*([a-z_][a-z0-9_]*)\s*=\s*(\S+)\s*$/gim)) {
        if (!(m[1] in raw)) raw[m[1]] = m[2];
      }
      source = 'gcode';
    }
  }
  return { raw, source, headText };
}

/**
 * 打印用料清单（2026-10-16 曼波真单批）：slice_info.config 的 <filament> 元素——
 * 切片器记录的「本板实际用料」（类型/颜色/用量），开打帧 ams_mapping2 的匹配底料。
 * 未用料槽（used_m/used_g 均 0 且 used_for_object!=true）剔除；解析失败按空清单处理。
 */
function parseFilaments(zip) {
  const out = [];
  try {
    const e = zip.getEntry('Metadata/slice_info.config');
    if (!e || entrySize(e) > MAX_CONFIG_BYTES) return out;
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
      });
    }
  } catch { /* 解析失败按无清单处理 */ }
  return out;
}

/**
 * 提取 3mf（Buffer）→ 可映射参数 + 与 baseline 的 diff（候选规则 set 草稿）+ 预计时长
 * @returns {{ source, params: Object, raw: Object, diff: Object, estMinutes: number|null,
 *             filaments: Array<{type,colorHex,trayIdx}>, bedType: string|null }}
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

  return { source, params, raw, diff, estMinutes, filaments, bedType, machineModel };
}

module.exports = { extractFrom3mf, BAMBU_PARAM_MAP, parseEstimatedMinutes, parseFilaments };
