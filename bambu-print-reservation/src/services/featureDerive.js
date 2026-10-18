'use strict';

/**
 * 特征派生层（2026-10-15 曼波令「重整和细化」批）：
 * 把「3D 空间标注（spatial）+ 几何体检（modelFeatures）+ 工况勾选（selection）」
 * 折算成**统一特征字典 feat**，供 processRules.applyRules 的条件引用——
 * 让「Z 向孔收缩 → XY 孔补偿 +0.2mm」这类空间因果从「采集了但吃不到」变成可表达、
 * 可拟合（将来样本库 expert diff 可按特征聚类学习补偿量，替代硬编码）。
 *
 * 特征字典命名约定：小写下划线；数值特征给 applyRules 的区间条件（{min}/{max}）用。
 */

/** 孔轴向判定（纯函数）：法向主分量 Z → z 向孔（竖直）；否 → 水平（xy 向） */
function holeAxis(normal) {
  const n = Array.isArray(normal) ? normal.map(Number) : [0, 0, 1];
  const abs = n.map(Math.abs);
  const maxAxis = abs[0] >= abs[1] && abs[0] >= abs[2] ? 0 : abs[1] >= abs[2] ? 1 : 2;
  return maxAxis === 2 ? 'z' : 'xy';
}

/** 从 spatial 标注 + 体检结果收集全部孔（去重：标注孔优先，体检孔补充） */
function collectHoles(spatial, modelFeatures) {
  const holes = [];
  for (const s of (Array.isArray(spatial) ? spatial : [])) {
    if (s && s.type === 'circle' && Array.isArray(s.c) && Array.isArray(s.n)) {
      holes.push({ n: s.n.map(Number), r: Number(s.r) || 0, src: 'spatial' });
    }
  }
  const mfHoles = modelFeatures && modelFeatures.holes;
  const circles = mfHoles && Array.isArray(mfHoles.circles) ? mfHoles.circles : [];
  for (const c of circles) {
    if (c && Array.isArray(c.c) && Array.isArray(c.n)) {
      // 体检孔与标注孔同位置去重（半径相近且圆心相近）
      const dup = holes.some((h) => Math.abs(h.r - (Number(c.r) || 0)) < 0.3);
      if (!dup) holes.push({ n: c.n.map(Number), r: Number(c.r) || 0, src: 'mesh' });
    }
  }
  return holes;
}

/**
 * 主入口：派生特征字典。
 * @param {Array} spatial 3D 标注（sanitizeSpatial 净化后的）
 * @param {Object|null} modelFeatures STL 几何体检快照（可选）
 * @param {Object} selection 工况勾选（保留位，供跨层派生）
 * @returns {Object} feat 特征字典
 */
function deriveFeatures(spatial, modelFeatures, selection = {}) {
  const feat = {};
  const anns = Array.isArray(spatial) ? spatial : [];

  // ---------- ① 孔特征（轴向/孔径——「Z 向孔收缩补偿」的判据） ----------
  const holes = collectHoles(anns, modelFeatures);
  if (holes.length) {
    const zHoles = holes.filter((h) => holeAxis(h.n) === 'z');
    const xyHoles = holes.filter((h) => holeAxis(h.n) === 'xy');
    const radii = holes.map((h) => h.r).filter((r) => r > 0);
    feat.holes_z = zHoles.length;          // Z 向（竖直）孔数——收缩随高度叠加，补偿需求最大
    feat.holes_xy = xyHoles.length;        // 水平孔数——按层内收缩，补偿需求小
    feat.holes_total = holes.length;
    if (radii.length) {
      feat.holes_min_r = Math.min(...radii);
      feat.holes_max_r = Math.max(...radii);
      feat.holes_small = radii.filter((r) => r < 2).length; // 小孔（<Ø4）收缩占比高，公差敏感
    }
  } else if (modelFeatures && modelFeatures.holes && Number(modelFeatures.holes.count) > 0) {
    // 体检有孔但无圆参数（如闭合性差未出 circles）——只给总数，不给轴向
    feat.holes_total = Number(modelFeatures.holes.count);
  }

  // ---------- ② 空间标注布尔特征（3D 窗口能标的全进特征） ----------
  const byTool = {};
  for (const a of anns) {
    if (!a || !a.tool) continue;
    byTool[a.tool] = (byTool[a.tool] || 0) + 1;
  }
  for (const [tool, count] of Object.entries(byTool)) {
    feat[`annot_${tool}`] = count; // 如 annot_bending_zone=1 / annot_contact_surface=2 / annot_appearance_face=1
  }
  feat.has_load_annot = anns.some((a) => a && a.type === 'load') ? 1 : 0;
  feat.has_support_annot = byTool.support_need ? 1 : 0;

  // ---------- ②.5 载荷标注分桶（2026-10-18 P0：方向/性质/量级此前只采不学） ----------
  // annotator 的 load 标注自带 dir（力方向向量）/ loadType（受拉/受压/…）/
  // loadNature（静载/疲劳/冲击/振动）/ loadMagnitude（轻/中/重）——这些是 3D 标注
  // 里性价比最高的工况信号（人亲手标的），此前只数了个总数。这里按桶计数，
  // 规则与 ruleFitter 都能直接引用（如 load_cmp_bending ≥1 → 墙数+）。
  const loads = anns.filter((a) => a && a.type === 'load');
  if (loads.length) {
    const zLoads = loads.filter((a) => Math.abs(Number(a.dir && a.dir[2]) || 0) > 0.5).length;
    feat.load_z = zLoads;
    feat.load_xy = loads.length - zLoads;
    for (const l of loads) {
      if (l.loadType) feat[`load_type_${String(l.loadType)}`] = (feat[`load_type_${String(l.loadType)}`] || 0) + 1;
      if (l.loadNature) feat[`load_nature_${String(l.loadNature)}`] = (feat[`load_nature_${String(l.loadNature)}`] || 0) + 1;
      if (l.loadMagnitude) feat[`load_mag_${String(l.loadMagnitude)}`] = (feat[`load_mag_${String(l.loadMagnitude)}`] || 0) + 1;
    }
  }

  // ---------- ③ 几何体检数值特征 ----------
  const mf = modelFeatures || {};
  // 宽松判据：样本库快照可能不带 ok 标志（字段齐即视为有效体检）
  if (mf.ok || mf.overhang || mf.holes || mf.bbox || mf.contact) {
    if (mf.overhang) {
      feat.overhang_severe_pct = Number(mf.overhang.severePct) || 0;
      feat.overhang_moderate_pct = Number(mf.overhang.moderatePct) || 0;
    }
    if (mf.contact) {
      feat.contact_area_mm2 = Number(mf.contact.areaMm2) || 0;
      feat.contact_footprint_pct = Number(mf.contact.footprintPct) || 0;
    }
    feat.curved_pct = Number(mf.curvedPct) || 0;
    feat.mesh_closed = mf.mesh && mf.mesh.closed ? 1 : 0;
    feat.bbox_z = mf.bbox ? Number(mf.bbox.z) || 0 : 0; // 高度——竖直孔深度近似
  }

  return feat;
}

module.exports = { deriveFeatures, holeAxis, collectHoles };

/** 已知特征名清单（processRules.validateRule 校验 feat.* 引用用） */
const FEATURE_NAMES = [
  'holes_z', 'holes_xy', 'holes_total', 'holes_min_r', 'holes_max_r', 'holes_small',
  'has_load_annot', 'has_support_annot',
  // 载荷标注分桶（2026-10-18 P0）：方向/类型/性质/量级
  'load_z', 'load_xy',
  'load_type_tension', 'load_type_compression', 'load_type_shear', 'load_type_bending',
  'load_type_torsion', 'load_type_contact',
  'load_nature_static', 'load_nature_fatigue', 'load_nature_impact', 'load_nature_vibration',
  'load_mag_light', 'load_mag_medium', 'load_mag_heavy',
  'overhang_severe_pct', 'overhang_moderate_pct', 'contact_area_mm2', 'contact_footprint_pct',
  'curved_pct', 'mesh_closed', 'bbox_z',
];
module.exports.FEATURE_NAMES = FEATURE_NAMES;
