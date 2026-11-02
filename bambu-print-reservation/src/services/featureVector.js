'use strict';

/**
 * 统一特征向量空间（v60 参数智能层 · 2026-10-30 曼波令「学习和几何特征处理链路」批）
 *
 * 痛点：featureDerive 产出的 feat 字典把连续量手工分桶（load_mag_light/medium/heavy）、
 * 且与工况勾选（taxonomy selection）分属两个世界——学习器（ruleFitter）只能在
 * 「单特征活跃/不活跃」上做二元分段。本模块把「派生特征 + 几何体检原值 + 工况勾选」
 * 折进**同一个数值向量空间**（连续值保留连续、枚举 one-hot、标尺直进），
 * 让 kNN 相似检索与多变量回归有统一的坐标度量。
 *
 * 一致性铁律：训练（paramModel.train）与预测（applyToParams）必须用同一份 spec
 * （特征名清单 + 填补值 + 标准化参数）——spec 随模型冻结存档，taxonomy 演进后
 * 旧模型对未知维度按填补值处理（等价于忽略），不会漂移崩溃。
 */

const taxonomy = require('./taxonomy');

// ---------- 几何/派生数值特征（连续，尽量不丢分辨率） ----------
// 来源两路：modelFeatures 几何体检快照（原值）+ featureDerive feat 字典（派生）。
// v68 几何 DNA：features.dna.vector（实例级结构向量，15 维）以 dna_0..dna_14 键入列
// ——旧样本/预约快照无 dna 时走 impute（NaN→中位数），安全降级。
// 缺失 → NaN，由 spec.impute 在训练/预测两侧统一填补（训练时算中位数并冻结）。
const DNA_DIMS = 22; // v79 DNA v2：+截面剖面(maxJump/首末层面积)/悬垂环岛/最小孔周壁/层数/高度
const DNA_KEYS = Array.from({ length: DNA_DIMS }, (_, i) => `dna_${i}`);
const GEOMETRY_FEATURES = [
  'bbox_x', 'bbox_y', 'bbox_z',      // 包围盒三轴（mm）
  'aspect_ratio',                     // 最长边/最短边（≥1；扁平/细长判据）
  'volume_cm3',                       // 体积
  ...DNA_KEYS,                        // v68 几何 DNA 实例级向量
  'holes_total', 'holes_z', 'holes_xy',
  'holes_min_r', 'holes_max_r', 'holes_small',
  'overhang_severe_pct', 'overhang_moderate_pct',
  'contact_area_mm2', 'contact_footprint_pct',
  'curved_pct',
  'load_z', 'load_xy',                // 载荷标注方向桶（Z 向/面内）
  'annot_total',                      // 3D 标注总数（标注强度=工况复杂度信号）
  'mesh_closed',
];

// ---------- 工况勾选 → one-hot / 标尺（从 taxonomy 池动态展开，pool 内字段全覆盖） ----------
function taxonomyVectorSpec() {
  const spec = { hot: [], scale: [] };
  for (const g of taxonomy.groups) {
    for (const f of g.fields) {
      if (f.type === 'scale') { spec.scale.push(f.id); continue; }
      if (f.type === 'bool') { spec.hot.push(f.id); continue; } // bool 当 0/1 热位
      const opts = (f.options || []).map((o) => o.id).filter((id) => id && id !== 'none');
      for (const o of opts) spec.hot.push(`${f.id}=${o}`);
    }
  }
  return spec;
}

/** selection 值 → 该字段的 one-hot 热位集合（multi 数组多热；single 单热；bool 0/1） */
function selectionHotValue(selection, fieldId) {
  const v = selection[fieldId];
  if (v === undefined || v === null || v === '' || v === false) return { [fieldId]: 0 };
  if (v === true) return { [fieldId]: 1 };
  if (Array.isArray(v)) {
    const out = {};
    for (const item of v) out[`${fieldId}=${item}`] = 1;
    return out;
  }
  return { [`${fieldId}=${v}`]: 1 };
}

/** 几何体检快照 + 派生字典 → 几何数值段（键值形态，缺失键不出） */
function geometryValues(modelFeatures, feat) {
  const out = {};
  const mf = modelFeatures || {};
  const bbox = mf.bbox || {};
  if (Number(bbox.x) > 0) {
    out.bbox_x = Number(bbox.x);
    out.bbox_y = Number(bbox.y);
    out.bbox_z = Number(bbox.z);
    const sides = [Number(bbox.x), Number(bbox.y), Number(bbox.z)].filter((n) => n > 0);
    if (sides.length === 3) {
      out.aspect_ratio = Math.max(...sides) / Math.max(1e-6, Math.min(...sides));
    }
  }
  if (Number(mf.volumeCm3) > 0) out.volume_cm3 = Number(mf.volumeCm3);
  // v68 几何 DNA 向量入列（实例级结构：孔深/贯通率/悬垂域/凹角/薄壁）
  if (mf.dna && Array.isArray(mf.dna.vector)) {
    mf.dna.vector.forEach((v, i) => {
      if (v != null && Number.isFinite(Number(v))) out[`dna_${i}`] = Number(v);
    });
  }
  const pick = (k) => (Number.isFinite(Number(feat[k])) ? Number(feat[k]) : undefined);
  for (const k of ['holes_total', 'holes_z', 'holes_xy', 'holes_min_r', 'holes_max_r', 'holes_small',
    'overhang_severe_pct', 'overhang_moderate_pct', 'contact_area_mm2', 'contact_footprint_pct',
    'curved_pct', 'load_z', 'load_xy']) {
    const v = pick(k);
    if (v !== undefined) out[k] = v;
  }
  const annotKeys = Object.keys(feat || {}).filter((k) => k.startsWith('annot_'));
  if (annotKeys.length) out.annot_total = annotKeys.reduce((s, k) => s + Number(feat[k] || 0), 0);
  if (feat && feat.mesh_closed !== undefined) out.mesh_closed = Number(feat.mesh_closed);
  return out;
}

// ---------- 显式交互特征（v61 · 曼波令「集合特征识别」批） ----------
// 物理上有因果意义的几何 × 工况组合，显式构造进向量——MLP 隐层能自己学交互，
// 但小样本下给岭回归/kNN 也喂上现成交互列，等于把「专家会注意什么组合」写进先验。
// 两侧输入缺失 → 交互缺失（undefined 走 impute 通道），不会伪造 0 交互。
const INTERACTIONS = [
  ['holes_z', 'scale:deflection_scale', 'holes_z_x_deflection'],       // 竖直孔 × 刚度档：刚性件孔补偿更敏感
  ['holes_max_r', 'holes_z', 'hole_size_x_count'],                     // 大孔 × 孔数：孔系整体收缩量
  ['overhang_severe_pct', 'aspect_ratio', 'overhang_x_slender'],       // 悬空 × 细长比：细高件悬端更危险
  ['contact_footprint_pct', 'bbox_z', 'contact_x_height'],             // 接触比 × 高度：高脚小底倾倒/翘曲
  ['curved_pct', 'overhang_severe_pct', 'curved_x_overhang'],          // 曲面 × 悬空：支撑疤风险
  ['load_z', 'bbox_z', 'loadz_x_height'],                              // 轴向载荷 × 高度：屈曲/层间剪
];

/** 交互列求值：两侧键都在 → 乘积；任一缺 → undefined */
function interactionValues(geometry) {
  const out = {};
  for (const [a, b, name] of INTERACTIONS) {
    const va = Number(geometry[a]);
    const vb = Number(geometry[b]);
    if (Number.isFinite(va) && Number.isFinite(vb)) out[name] = va * vb;
  }
  return out;
}

/**
 * 主入口：样本/单据 → {geometry: {k:v}, hot: {key:0|1}}（未填补、未标准化的原始键值）。
 * @param {Object} selection taxonomy 标准化勾选
 * @param {Object|null} modelFeatures 几何体检快照
 * @param {Object} feat featureDerive 派生字典
 * @param {Object} [spec] 冻结 spec（{hot, scale}）；缺省按当前 taxonomy 现算（训练侧）
 */
function buildRawVector(selection, modelFeatures, feat, spec) {
  const sp = spec || taxonomyVectorSpec();
  const geo = geometryValues(modelFeatures, feat || {});
  const hot = {};
  for (const key of sp.hot) {
    if (key.includes('=')) {
      const eq = key.indexOf('=');
      const fieldId = key.slice(0, eq);
      const opt = key.slice(eq + 1);
      const v = selection[fieldId];
      hot[key] = (Array.isArray(v) ? v.includes(opt) : v === opt) ? 1 : 0;
    } else {
      const v = selection[key];
      hot[key] = v === true || v === 1 ? 1 : 0;
    }
  }
  // 标尺类（deflection_scale -3~+3）是连续数值——进 geometry 数值段（键加 scale: 前缀
  // 与体检特征共用填补/标准化通道），不进 one-hot
  for (const fieldId of sp.scale) {
    const v = Number(selection[fieldId]);
    if (Number.isFinite(v)) geo[`scale:${fieldId}`] = v;
  }
  // 显式交互列（v61）：几何 × 工况乘积特征
  Object.assign(geo, interactionValues(geo));
  return { geometry: geo, hot };
}

/** 冻结 spec：特征全集（geometryNames 含交互列 + hot 键） */
function specFeatureNames(spec) {
  return {
    geometry: [...GEOMETRY_FEATURES, ...INTERACTIONS.map((i) => i[2])],
    hot: [...spec.hot, ...spec.scale.map((s) => `scale:${s}`)],
  };
}

module.exports = {
  GEOMETRY_FEATURES,
  INTERACTIONS,
  taxonomyVectorSpec,
  buildRawVector,
  specFeatureNames,
  geometryValues,
  interactionValues,
};
