'use strict';

/**
 * 参数智能层（v60 · 2026-10-30 曼波令）：几何特征 × 工况 → 切片参数的多变量学习模型
 *
 * 为什么不是 ruleFitter 的加强版：阈值规则「检测到某个值就触发」有天花板——
 * 单变量、二元分段、常数输出，学不出连续响应（孔径大小↔补偿量）、特征交互
 * （Z 向孔 × 重载 → 补偿更大）和不确定性。本模块补这条消费链路：
 *
 *   ① 案例推理（kNN）：新单在样本库找 top-k 相似专家切片（几何标准化欧氏 +
 *      工况 Jaccard），加权融合其专家参数——连续响应、天然非线性、可审计
 *      （「参考了 T20261021-003 等 3 条案例」），小样本下最稳；
 *   ② 加权岭回归：全样本多变量闭式解（工况 one-hot + 几何连续值），捕捉全局趋势
 *      与交互；正则强度 λ 小网格由 LOFO 选出，不拍脑袋；
 *   ③ 逐参数择优：LOFO（留一家族出）MAE 与「全局中位数基线」比——严格优于基线
 *      的参数才启用预测（'knn'/'ridge'），学不会的参数诚实回退（'none'）；
 *   ④ 置信度门控：预测时按近邻覆盖度 × 分歧度算 confidence，低于门限逐参数回退
 *      规则值——「不确定就别装懂」；
 *   ⑤ 样本权重：打印失败的案例降权（outcome）、低置信度录入降权（confidence），
 *      sliceStats/outcome 信号从此进入学习侧。
 *
 * 规则库（processRules）地位不变：显式工艺因果与安全硬约束（材料排除/绝缘禁 CF/
 * 耐温档）仍由规则承担；本模型只修正**数值工艺参数**（层高/墙/壳/填充/支撑/补偿/
 * 温差/裙边），枚举与安全参数一律不碰。
 */

const processRules = require('./processRules');
const ruleFitter = require('./ruleFitter');
const featureVector = require('./featureVector');
const mlp = require('./mlp');

// ---------- 数值参数域（clamp 用；与 processRules.validateRule 的范围口径一致） ----------
const PARAM_DOMAINS = {
  layerHeight: { min: 0.08, max: 0.32 },
  wallLoops: { min: 1, max: 6, int: true },
  topShellLayers: { min: 1, max: 10, int: true },
  bottomShellLayers: { min: 1, max: 10, int: true },
  infillDensity: { min: 0, max: 100 },
  supportThresholdAngle: { min: 10, max: 60 },
  supportDensity: { min: 0, max: 100 },
  brimWidth: { min: 0, max: 10 },
  xyHoleComp: { min: -0.5, max: 0.5 },
  xyContourComp: { min: -0.5, max: 0.5 },
  temperatureDelta: { min: -20, max: 20 },
  nozzleTempDelta: { min: -20, max: 20 },
};
const LEARNABLE_PARAMS = Object.keys(PARAM_DOMAINS);

// 打印结果 → 样本权重系数（失败案例的专家参数可能正是出错原因，降权不剔除——
// 失败里也有信息；未打印的案例参数未经现实验证，轻降）
const OUTCOME_WEIGHTS = { '成功': 1, '部分成功': 0.8, '失败': 0.3, '未打印': 0.85 };
const DEFAULT_OUTCOME_WEIGHT = 0.85;

const KNN_K = 5;
const GEO_MIX = 0.6;        // 距离 = GEO_MIX·几何 + (1-GEO_MIX)·工况 Jaccard
const RIDGE_LAMBDAS = [2, 8, 32];
const MIN_RIDGE_ROWS = 8;   // 岭回归最低行数（低于只走 kNN）
const MIN_MLP_ROWS = 10;    // MLP 最低行数（再少纯过拟合，LOFO 也测不出东西——直接不进竞技场）
const MLP_LOFO = { nNets: 3, epochs: 1200, lr: 0.02 };  // LOFO 评估用轻量集成（省时）
const MLP_FULL = { nNets: mlp.N_NETS, epochs: mlp.EPOCHS, lr: mlp.LR }; // 存档模型用满配
const CONF_GATE_DEFAULT = 0.55;

// ---------- 线性代数（d≤~60，列主元高斯消元足够） ----------
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-10) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const p = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / p;
      if (!f) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = M[r][n];
    for (let c = r + 1; c < n; c++) s -= M[r][c] * x[c];
    x[r] = s / M[r][r];
  }
  return x;
}

function median(nums) { return ruleFitter.median(nums); }

function weightedMedian(pairs) {
  // pairs = [{v, w}]，按值排序后累计权重过半处
  const list = pairs.filter((p) => Number.isFinite(p.v) && p.w > 0).sort((a, b) => a.v - b.v);
  if (!list.length) return null;
  const total = list.reduce((s, p) => s + p.w, 0);
  let acc = 0;
  for (const p of list) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return list[list.length - 1].v;
}

// ---------- 向量与距离 ----------
/** 样本 → 稀疏行（geometry 键值 + 点亮热位）+ 标签参数 + 权重。
 *  v68 标签源重构（曼波定「参数由几何+工况+需求决定，而非看专家差多少」）：
 *  · 样本库行：标签=作者/专家切片参数（extraction，ruleFitter.expertOf 口径），
 *    权重 = outcome 系数 × confidence——这是「人怎么切」的弱先验；
 *  · 预约记录行（tier2 利用率）：标签=审批认可参数（processParams，仅取已完成/
 *    打印中），权重 0.5——数量级提升训练面（几何 DNA 缺失按 impute 降级）。 */
function buildRow(sample, spec) {
  const expert = ruleFitter.expertOf(sample);
  if (!expert) return null;
  const feat = featureDeriveSafe(sample);
  const raw = featureVector.buildRawVector(sample.selection || {}, sample.model && sample.model.features, feat, spec);
  const outcomeW = OUTCOME_WEIGHTS[(sample.outcome && sample.outcome.status)] || DEFAULT_OUTCOME_WEIGHT;
  const confW = Number.isFinite(Number(sample.confidence)) && sample.confidence != null
    ? Math.max(0.2, Math.min(1, Number(sample.confidence) / 100)) : 1;
  return {
    id: sample.id,
    family: sample.family || 'unknown',
    geometry: raw.geometry,          // 稀疏：缺失键不出（NaN 语义）
    hotOnes: Object.keys(raw.hot).filter((k) => raw.hot[k] === 1),
    expert,
    weight: outcomeW * confW,
  };
}

/** 预约记录 → tier2 行（标签=审批认可参数 processParams；权重 0.5×状态系数） */
function buildRowFromRecord(record, spec) {
  const pp = record.processParams || {};
  const expert = {};
  for (const P of LEARNABLE_PARAMS) {
    const v = Number(pp[P]);
    if (Number.isFinite(v)) expert[P] = v;
  }
  if (!Object.keys(expert).length) return null;
  const feats = record.modelFeatures;
  if (!feats) return null;
  const feat = featureDeriveSafe(record);
  const raw = featureVector.buildRawVector(record.selection || {}, feats, feat, spec);
  // 状态系数：已完成=参数经现实验证 ×1.0；打印中 ×0.8；待审 ×0.5
  // （已驳回/已取消在 fit 入口剔除——v83，被人工否决的参数不得当弱正样本学）
  const statusW = record.status === '已完成' ? 1 : (record.status === '打印中' ? 0.8 : 0.5);
  return {
    id: record.id,
    family: record.family || null,
    geometry: raw.geometry,
    hotOnes: Object.keys(raw.hot).filter((k) => raw.hot[k] === 1),
    expert,
    weight: 0.5 * statusW,
  };
}

function featureDeriveSafe(sample) {
  // v83 修复：预约记录（tier2）的特征对象在 modelFeatures 字段而非 model.features——
  // 两种形态都兼容，否则 tier2 派生特征（悬垂/接触面/曲面/孔）恒空、全体按中位数填补
  try { return require('./featureDerive').deriveFeatures(sample.spatial || [], (sample.model && sample.model.features) || sample.modelFeatures || null, sample.selection || {}); }
  catch { return {}; }
}

/** geometry 稀疏键值 → dense 数值向量（按 spec.numericKeys；缺失用 spec.impute 填补） */
function denseFrom(geometry, spec) {
  return spec.numericKeys.map((k) => {
    const v = Number(geometry[k]);
    return Number.isFinite(v) ? v : (spec.impute[k] || 0);
  });
}

/** 行 → dense 数值向量 */
function rowDense(row, spec) { return denseFrom(row.geometry, spec); }

/** 预测目标 → 同一稀疏形态 */
function targetRow(selection, modelFeatures, feat, spec) {
  const raw = featureVector.buildRawVector(selection || {}, modelFeatures, feat || {}, spec);
  return { geometry: raw.geometry, hotOnes: Object.keys(raw.hot).filter((k) => raw.hot[k] === 1) };
}

/** 标准化 dense 向量（spec.scaleMean/std；std 过小当 1） */
function standardize(dense, spec) {
  return dense.map((v, i) => {
    const k = spec.numericKeys[i];
    const std = spec.scaleStd[k] || 1;
    return (v - (spec.scaleMean[k] || 0)) / std;
  });
}

/** 距离：几何标准化欧氏（均方）+ 工况 Jaccard 混合 */
function rowDistance(aDenseStd, aHot, bDenseStd, bHot) {
  let ss = 0;
  for (let i = 0; i < aDenseStd.length; i++) { const d = aDenseStd[i] - bDenseStd[i]; ss += d * d; }
  const geo = Math.sqrt(ss / Math.max(1, aDenseStd.length));
  const setA = new Set(aHot);
  const setB = new Set(bHot);
  let inter = 0;
  for (const k of setA) if (setB.has(k)) inter++;
  const union = setA.size + setB.size - inter;
  // 审查修复（v62）：两边都没勾工况（∅ vs ∅）语义上是「工况完全一致」，距离 0；
  // 原记 1（最大分歧）会让纯几何相似的空标注单互相远离
  const jac = union ? 1 - inter / union : 0;
  return GEO_MIX * geo + (1 - GEO_MIX) * jac;
}

// ---------- 训练 ----------
/**
 * 训练参数模型（含 LOFO 评估与逐参数择优）。
 * @param {Array} samples trainingStore.list()
 * @param {Object} [opts] opts.minGain 相对基线 MAE 的最低改善率（默认 0.05）
 * @returns {{model:Object, stats:Object}}
 */
function train(samples, opts = {}) {
  const minGain = Number(opts.minGain) > 0 ? Number(opts.minGain) : 0.05;
  const spec = freezeSpec();
  const rows = (samples || []).map((s) => buildRow(s, spec)).filter(Boolean);
  // v68 tier2 利用率：需求链预约单（processParams=审批认可参数 + modelFeatures 快照）
  // 以低权重入训——训练面从「样本库数十条」扩到「全部需求链单据」；family 按几何
  // 量化签名（复用 trainingStore.familyOf）保证 LOFO 防泄漏语义
  let tier2Count = 0;
  if (Array.isArray(opts.reservations) && opts.reservations.length) {
    const famOf = (() => { try { return require('./trainingStore').familyOf; } catch { return null; } })();
    for (const rec of opts.reservations) {
      const row = buildRowFromRecord(rec, spec);
      if (!row) continue;
      if (!row.family && famOf) row.family = famOf(rec.modelFeatures, rec.fileName);
      if (!row.family) row.family = 'res-unknown';
      rows.push(row);
      tier2Count++;
    }
  }
  const stats = {
    samples: rows.length,
    tier1: rows.length - tier2Count,
    tier2: tier2Count,
    families: new Set(rows.map((r) => r.family)).size,
    params: {},
    note: '',
  };
  if (rows.length < 4) {
    stats.note = `有效样本 ${rows.length} 条（<4）——不产出模型`;
    return { insufficient: true, stats };
  }

  // impute（几何逐特征中位数）与标准化参数（全体行）。
  // 时序铁律（审查修复 v62）：spec.impute 必须先于 denseAll 计算——rowDense 读
  // spec.impute 填补缺失特征，顺序错了训练侧走 0 填补、预测侧走中位数填补，
  // 同一条样本两套坐标，LOFO/coverageRadius/回归全部学在失真空间上。
  const impute = {};
  for (const k of spec.numericKeys) {
    const vals = rows.map((r) => r.geometry[k]).filter((v) => v !== undefined && Number.isFinite(v));
    impute[k] = vals.length ? median(vals) || 0 : 0;
  }
  spec.impute = impute;
  const denseAll = rows.map((r) => rowDense(r, spec));
  const scaleMean = {};
  const scaleStd = {};
  for (let i = 0; i < spec.numericKeys.length; i++) {
    const k = spec.numericKeys[i];
    const col = denseAll.map((d) => d[i]).filter(Number.isFinite);
    const mean = col.length ? col.reduce((s, v) => s + v, 0) / col.length : 0;
    const std = Math.sqrt(col.reduce((s, v) => s + (v - mean) * (v - mean), 0) / Math.max(1, col.length - 1));
    scaleMean[k] = mean;
    scaleStd[k] = std > 1e-6 ? std : 1;
  }
  spec.scaleMean = scaleMean;
  spec.scaleStd = scaleStd;

  const rowsStd = rows.map((r, i) => ({ ...r, dense: standardize(denseAll[i], spec) }));

  // MLP（v61）：多任务一次评估全部参数头（fold 内训一个集成、多头同测——12 参数
  // 逐参数重训要贵一个量级，没必要；LOFO 逐参数 MAE 事后与 kNN/岭回归同台择优）
  const mlpLofo = mlpLofoEvaluate(rowsStd, spec);

  // 逐参数：kNN / 岭回归 LOFO 评估 → 择优
  const perParam = {};
  const ridgeModels = {};
  for (const P of LEARNABLE_PARAMS) {
    const labeled = rowsStd.filter((r) => Number.isFinite(Number(r.expert[P])));
    const m = LEARNABLE_PARAMS.indexOf(P);
    const info = { n: labeled.length, choice: 'none', knnMae: null, ridgeMae: null, mlpMae: null, baseMae: null, lambda: null };
    if (labeled.length >= 3) {
      const lofo = lofoEvaluateParam(rowsStd, P, spec, { knnOnly: labeled.length < MIN_RIDGE_ROWS });
      info.knnMae = lofo.knnMae;
      info.baseMae = lofo.baseMae;
      info.ridgeMae = lofo.ridgeMae;
      info.lambda = lofo.lambda;
      info.lofoFolds = lofo.folds;
      const mlpInfo = mlpLofo[P];
      if (mlpInfo) {
        info.mlpMae = mlpInfo.mae;
        info.mlpFolds = mlpInfo.folds;
      }
      // 审查修复（v62）：MLP 的 MAE 合入 lofo 视图——下方择优 filter 统一读
      // lofo[`${m2}Mae`]，漏合会让 'mlp' 因 undefined 永远被静默滤掉（竞技场空转）
      lofo.mlpMae = mlpInfo ? mlpInfo.mae : null;
      const best = ['knn', 'ridge', 'mlp']
        .filter((m2) => (m2 === 'ridge' ? labeled.length >= MIN_RIDGE_ROWS && lofo.lambda != null : true))
        .filter((m2) => (m2 === 'mlp' ? labeled.length >= MIN_MLP_ROWS && info.mlpMae != null : true))
        .filter((m2) => Number.isFinite(lofo[`${m2}Mae`]) && Number.isFinite(lofo.baseMae) && lofo.baseMae > 0)
        .filter((m2) => lofo[`${m2}Mae`] <= lofo.baseMae * (1 - minGain))
        .sort((a, b) => lofo[`${a}Mae`] - lofo[`${b}Mae`])[0];
      if (best) info.choice = best;
    }
    perParam[P] = info;
    if (info.choice === 'ridge' && info.lambda != null) {
      // 审查修复（v62）：存档模型的 λ 在全量 labeled 上按训练加权 MAE 重选——
      // LOFO 返回的 lambda 只是「末折训练侧最优」，直接用会让正则强度随折序漂移
      let bestLam = info.lambda;
      let bestMae = Infinity;
      for (const lam of RIDGE_LAMBDAS) {
        const m = fitRidge(labeled, P, lam, spec);
        if (!m) continue;
        const mae = labeled.reduce((s, r) => s + Math.abs(ridgePredict(m, buildRidgeX(r, spec)) - Number(r.expert[P])) * r.weight, 0)
          / labeled.reduce((s, r) => s + r.weight, 0);
        if (mae < bestMae) { bestMae = mae; bestLam = lam; }
      }
      info.lambda = bestLam;
      ridgeModels[P] = fitRidge(labeled, P, bestLam, spec);
    }
    void m; // 头索引在预测侧按 LEARNABLE_PARAMS 序取（保持一处真源）
  }

  // 每参数训练侧标签标准差（模型顶层）：kNN 近邻分歧与 MLP 集成分歧共用的
  // 置信度归一化基准——变异系数（std/|mean|）在参数值跨 0 时（孔补偿/温差）
  // 会爆到 10⁴ 量级让置信度恒 0（审查修复 v62），统一改按参数自身离散度归一
  const paramStd = LEARNABLE_PARAMS.map((P) => {
    const vals = rowsStd.map((r) => Number(r.expert[P])).filter(Number.isFinite);
    if (vals.length < 2) return 1;
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length - 1)) || 1;
  });

  // 存档 MLP（满配集成，全量样本训练；LOFO 只做裁判不做训练）+ 置换重要性
  let mlpArchived = null;
  if (rowsStd.length >= MIN_MLP_ROWS) {
    const ensRows = rowsStd.map((r) => ({
      x: buildRidgeX(r, spec),
      y: LEARNABLE_PARAMS.map((P) => { const v = Number(r.expert[P]); return Number.isFinite(v) ? v : null; }),
      w: r.weight,
    }));
    const ens = mlp.trainEnsemble(ensRows, ensRows[0].x.length, LEARNABLE_PARAMS.length, MLP_FULL);
    const serialized = mlp.serialize(ens);
    const importance = mlp.permutationImportance(ens, ensRows, spec.numericKeys, { repeats: 2 });
    mlpArchived = { ...serialized, paramStd, importance };
  }

  // 覆盖半径：训练行到第 k 近邻距离的 75 分位（预测时判 coverage）
  const radii = [];
  for (let i = 0; i < rowsStd.length; i++) {
    const dists = rowsStd
      .filter((_, j) => j !== i)
      .map((r) => rowDistance(rowsStd[i].dense, rowsStd[i].hotOnes, r.dense, r.hotOnes))
      .sort((a, b) => a - b);
    if (dists.length) radii.push(dists[Math.min(KNN_K, dists.length) - 1]);
  }
  radii.sort((a, b) => a - b);
  const coverageRadius = radii.length ? radii[Math.floor(radii.length * 0.75)] : 1;

  const model = {
    version: `pm-${Date.now().toString(36)}`,
    kind: 'param-model',
    createdAt: new Date().toISOString(),
    spec: { ...spec, hot: spec.hot, numericKeys: spec.numericKeys },
    rows: rowsStd.map((r) => ({ id: r.id, family: r.family, geometry: r.geometry, hotOnes: r.hotOnes, expert: r.expert, weight: r.weight })),
    knn: { k: KNN_K, geoMix: GEO_MIX, coverageRadius },
    ridge: ridgeModels,
    mlp: mlpArchived,
    paramStd,
    choices: perParam,
  };

  // ---------- 失败归因报告（v88 · 学习链路深化）：失败样本的「参数档 × 失败码」联合
  // 统计——回答「哪种参数组合容易出哪种失败」，给曼波下次切片/录样本指方向。
  // 纯统计不改模型权重（样本量上来后才值得做归因加权）。
  stats.failureAttribution = failureAttribution(samples, rows);

  const adopted = Object.values(perParam).filter((p) => p.choice !== 'none');
  stats.params = perParam;
  stats.coverageRadius = Math.round(coverageRadius * 1000) / 1000;
  stats.enabledParams = Object.entries(perParam)
    .filter(([, p]) => p.choice !== 'none')
    .map(([name, p]) => ({ param: name, ...p }));
  stats.enabledCount = stats.enabledParams.length;
  stats.note = stats.enabledParams.length
    ? `${stats.enabledParams.length}/${LEARNABLE_PARAMS.length} 个数值参数通过 LOFO 择优（严格优于中位数基线 ≥${Math.round(minGain * 100)}%）：` +
      stats.enabledParams.map((e) => `${e.param}→${paramLabel(e.choice)}（LOFO MAE ${e[`${e.choice}Mae`].toFixed(3)} < 基线 ${e.baseMae.toFixed(3)}）`).join('、')
    : '没有参数通过 LOFO 泛化闸门（都不比全局中位数基线更准）——不产出可采纳模型';
  if (!stats.enabledParams.length) return { insufficient: true, stats };
  return { insufficient: false, model, stats };
}

/**
 * 失败归因统计（v88）：失败样本按失败码分组，输出各组的关键参数分布与几何特征均值——
 * 「print_error 83902467 的 3 条失败样本，平均墙数 2、平均填充 15%」这类可读结论。
 * 只统计 outcome.status=失败 且带 failCode 的样本；paramModel 训练不消费（样本量足够后
 * 再考虑把失败码当分类目标）。
 */
function failureAttribution(samples, rows) {
  const fails = (samples || []).filter((s) => s.outcome && s.outcome.status === '失败'
    && Number.isFinite(Number(s.outcome.failCode)));
  if (fails.length < 2) return { note: `失败样本带结构化失败码的不足 2 条（现 ${fails.length}）——样本量足够后自动出报告`, groups: [] };
  const byCode = {};
  for (const s of fails) {
    const code = Number(s.outcome.failCode);
    (byCode[code] = byCode[code] || []).push(s);
  }
  const groups = Object.entries(byCode).map(([code, list]) => {
    // 参数分布：每个可学习参数的「中位值 vs 全体成功样本中位值」
    const paramDevs = {};
    for (const P of LEARNABLE_PARAMS) {
      const failVals = list.map((s) => Number((((s.slice || {}).extraction || {}).params || {})[P])).filter(Number.isFinite);
      const okVals = (samples || []).filter((s) => s.outcome && s.outcome.status === '成功')
        .map((s) => Number((((s.slice || {}).extraction || {}).params || {})[P])).filter(Number.isFinite);
      if (failVals.length >= 2 && okVals.length >= 2) {
        paramDevs[P] = {
          failMedian: median(failVals),
          okMedian: median(okVals),
        };
      }
    }
    // 几何 DNA 均值（有 DNA 的失败样本）
    // P2 修复（2026-11-05 全量审查）：旧写法以首个样本长度为基准——ragged vector
    // 首样本短时高维静默缺位、首样本长时短样本越界读 undefined。改以规则库当前
    // 维度（featureVector.DNA 键数）为准：长度不符的样本跳过并计数（退回旧基准
    // 只在维度信息不可用时兜底）；逐维无有效值的位输出 null（缺失诚实可见）
    const dnaLists = list.map((s) => s.model && s.model.features && s.model.features.dna).filter(Boolean);
    const dnaTargetDim = featureVector.GEOMETRY_FEATURES.filter((k) => /^dna_\d+$/.test(k)).length
      || (dnaLists[0] && dnaLists[0].vector && dnaLists[0].vector.length)
      || 0;
    const dnaAligned = dnaLists.filter((d) => Array.isArray(d.vector) && d.vector.length === dnaTargetDim);
    const dnaSkipped = dnaLists.length - dnaAligned.length;
    const dnaMean = dnaAligned.length
      ? Array.from({ length: dnaTargetDim }, (_, i) => {
        const vals = dnaAligned.map((d) => d.vector[i]).filter(Number.isFinite);
        return vals.length ? Math.round(vals.reduce((s2, v) => s2 + v, 0) / vals.length * 100) / 100 : null;
      })
      : null;
    return {
      failCode: Number(code),
      count: list.length,
      sampleIds: list.map((s) => s.id),
      paramDevs,
      dnaMean,
      dnaSkipped, // DNA 维度与规则库不符被跳过的样本数（ragged vector 防御，0=全部对齐）
      files: list.map((s) => (s.model && s.model.originalName) || '').filter(Boolean).slice(0, 3),
    };
  }).sort((a, b) => b.count - a.count);
  return { note: `${fails.length} 条失败样本 / ${groups.length} 种失败码`, groups };
}

function paramLabel(choice) { return choice === 'knn' ? '案例推理' : (choice === 'mlp' ? '神经网络' : '岭回归'); }

/**
 * MLP 多任务 LOFO（v61）：逐族留出，fold 内训轻量集成（多头同测），逐参数累计
 * 绝对误差与训练侧中位数基线对比。行数 < MIN_MLP_ROWS 返回空（MLP 不进竞技场）。
 * @returns {Object} {paramName: {mae, baseMae, folds}}
 */
function mlpLofoEvaluate(rowsStd, spec) {
  if (rowsStd.length < MIN_MLP_ROWS) return {};
  const families = [...new Set(rowsStd.map((r) => r.family))];
  if (families.length < 2) return {};
  const errs = {};
  const baseErrs = {};
  const nBase = {};
  let folds = 0;
  for (const fam of families) {
    const train = rowsStd.filter((r) => r.family !== fam);
    const test = rowsStd.filter((r) => r.family === fam);
    if (!train.length || !test.length) continue;
    const trainRows = train.map((r) => ({
      x: buildRidgeX(r, spec),
      y: LEARNABLE_PARAMS.map((P) => { const v = Number(r.expert[P]); return Number.isFinite(v) ? v : null; }),
      w: r.weight,
    }));
    let ens;
    try { ens = mlp.trainEnsemble(trainRows, trainRows[0].x.length, LEARNABLE_PARAMS.length, { ...MLP_LOFO, seedBase: 424242 }); }
    catch { continue; }
    // 训练侧逐参数加权中位数基线（同 LOFO 其它族口径）
    for (const t of test) {
      const xT = buildRidgeX(t, spec);
      const pred = mlp.predictEnsemble(ens, xT);
      LEARNABLE_PARAMS.forEach((P, k) => {
        const tv = Number(t.expert[P]);
        if (!Number.isFinite(tv)) return;
        (errs[P] = errs[P] || { sum: 0, n: 0 }).sum += Math.abs(pred[k] - tv);
        errs[P].n++;
      });
    }
    for (const P of LEARNABLE_PARAMS) {
      const trainLabeled = train.filter((r) => Number.isFinite(Number(r.expert[P])));
      const baseV = weightedMedian(trainLabeled.map((r) => ({ v: Number(r.expert[P]), w: r.weight })));
      for (const t of test) {
        const tv = Number(t.expert[P]);
        if (!Number.isFinite(tv) || baseV == null) continue;
        (baseErrs[P] = baseErrs[P] || { sum: 0, n: 0 }).sum += Math.abs(baseV - tv);
        baseErrs[P].n++;
      }
    }
    folds++;
  }
  const out = {};
  for (const P of LEARNABLE_PARAMS) {
    const e = errs[P];
    const b = baseErrs[P];
    if (!e || !e.n) continue;
    out[P] = {
      mae: Math.round((e.sum / e.n) * 1e4) / 1e4,
      baseMae: b && b.n ? Math.round((b.sum / b.n) * 1e4) / 1e4 : null,
      folds,
    };
  }
  return out;
}

/** 参数级 LOFO：按 family 留出；kNN 固定超参，岭回归 λ 小网格取训练侧最优 */
function lofoEvaluateParam(rows, P, spec, { knnOnly = false } = {}) {
  const families = [...new Set(rows.map((r) => r.family))];
  const folds = [];
  const errs = { knn: 0, ridge: 0, base: 0, knnN: 0, ridgeN: 0, baseN: 0 };
  let lambda = null;
  for (const fam of families) {
    const train = rows.filter((r) => r.family !== fam);
    const test = rows.filter((r) => r.family === fam && Number.isFinite(Number(r.expert[P])));
    if (!train.length || !test.length) continue;
    const trainLabeled = train.filter((r) => Number.isFinite(Number(r.expert[P])));
    if (trainLabeled.length < 2) continue;
    const baseV = weightedMedian(trainLabeled.map((r) => ({ v: Number(r.expert[P]), w: r.weight })));
    let ridged = null;
    if (!knnOnly && trainLabeled.length >= MIN_RIDGE_ROWS) {
      let bestLambda = null;
      let bestTrainMae = Infinity;
      for (const lam of RIDGE_LAMBDAS) {
        const m = fitRidge(trainLabeled, P, lam, spec);
        if (!m) continue;
        const mae = trainLabeled.reduce((s, r) => s + Math.abs(ridgePredict(m, buildRidgeX(r, spec)) - Number(r.expert[P])) * r.weight, 0)
          / trainLabeled.reduce((s, r) => s + r.weight, 0);
        if (mae < bestTrainMae) { bestTrainMae = mae; bestLambda = lam; ridged = m; }
      }
      if (bestLambda != null) lambda = bestLambda;
    }
    for (const t of test) {
      const tv = Number(t.expert[P]);
      // kNN 留一：测试样本不出现在训练侧（LOFO 已按族分离）
      const knnV = knnPredict(trainLabeled, t.dense, t.hotOnes, P);
      if (knnV != null) { errs.knn += Math.abs(knnV - tv); errs.knnN++; }
      if (ridged) { errs.ridge += Math.abs(ridgePredict(ridged, buildRidgeX(t, spec)) - tv); errs.ridgeN++; }
      if (baseV != null) { errs.base += Math.abs(baseV - tv); errs.baseN++; }
    }
    folds.push(fam);
  }
  return {
    folds: folds.length,
    knnMae: errs.knnN ? errs.knn / errs.knnN : null,
    ridgeMae: errs.ridgeN ? errs.ridge / errs.ridgeN : null,
    baseMae: errs.baseN ? errs.base / errs.baseN : null,
    lambda,
  };
}

/** 岭回归特征行 = 标准化几何/标尺 dense + 工况 one-hot（0/1 不标准化）——多变量学习吃全信号 */
function buildRidgeX(rowLike, spec) {
  return [...rowLike.dense, ...spec.hot.map((k) => (rowLike.hotOnes && rowLike.hotOnes.includes(k) ? 1 : 0))];
}

/** 加权岭回归（标准化空间；正规方程 (XᵀWX+λI)w = XᵀWy） */
function fitRidge(rows, P, lambda, spec) {
  const X = rows.map((r) => buildRidgeX(r, spec));
  const d = X[0].length;
  const wts = rows.map((r) => r.weight);
  const y = rows.map((r) => Number(r.expert[P]));
  const wSum = wts.reduce((s, v) => s + v, 0) || 1;
  const yMean = y.reduce((s, v, i) => s + v * wts[i], 0) / wSum;
  const A = Array.from({ length: d }, () => new Array(d).fill(0));
  const b = new Array(d).fill(0);
  for (let i = 0; i < X.length; i++) {
    const wi = wts[i];
    const yi = y[i] - yMean;
    for (let a = 0; a < d; a++) {
      b[a] += wi * X[i][a] * yi;
      for (let c = 0; c < d; c++) A[a][c] += wi * X[i][a] * X[i][c];
    }
  }
  for (let a = 0; a < d; a++) A[a][a] += lambda;
  const coef = solveLinear(A, b);
  if (!coef) return null;
  return { coef, intercept: yMean };
}

function ridgePredict(m, denseStd) {
  let s = m.intercept;
  for (let i = 0; i < m.coef.length; i++) s += m.coef[i] * denseStd[i];
  return s;
}

/** kNN 加权融合预测：近邻按 (weight, 距离) 双权重取加权中位数 */
function knnPredict(rows, denseStd, hotOnes, P) {
  const dists = rows
    .map((r) => ({ r, d: rowDistance(denseStd, hotOnes, r.dense, r.hotOnes) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, Math.min(KNN_K, rows.length));
  const pairs = dists.map(({ r, d }) => ({ v: Number(r.expert[P]), w: r.weight / (1 + d * d) }));
  return weightedMedian(pairs);
}

// ---------- 预测与消费 ----------
/**
 * 冻结 spec（训练侧）：taxonomy one-hot 展开 + 数值键全集。
 */
function freezeSpec() {
  const tax = featureVector.taxonomyVectorSpec();
  const names = featureVector.specFeatureNames(tax);
  return {
    hot: names.hot.filter((k) => !k.startsWith('scale:')),
    scale: tax.scale,
    numericKeys: [...names.geometry, ...tax.scale.map((s) => `scale:${s}`)],
    impute: {},
    scaleMean: {},
    scaleStd: {},
  };
}

/**
 * 对（规则库产出的）基线参数做模型修正。
 * @param {Object} ruleParams processRules.applyRules().params（基线）
 * @param {Object} ctx { selection, modelFeatures, feat, spatial }
 * @param {Object} active paramModelStore.getActive()（null = 无已采纳模型）
 * @param {Object} [opts] opts.mode 覆盖生效模式（'shadow'|'active'）；opts.minConfidence
 * @returns {{used:boolean, params:Object, provenance:Object|null, note:string}}
 *   mode=shadow：params 原样返回，provenance 携带建议值（审批台展示，不生效）；
 *   mode=active：confidence ≥ 门限的参数替换为模型值（clamp 域内），provenance 全透出。
 */
function applyToParams(ruleParams, ctx, active, opts = {}) {
  const params = { ...(ruleParams || {}) };
  const mode = opts.mode || (active && active.mode) || 'off';
  const model = active && active.model;
  const provenance = {
    modelVersion: model ? model.version : null,
    mode,
    params: {},
    used: false,
  };
  if (!model || mode === 'off') return { used: false, params, provenance: null, note: '无已采纳参数模型' };
  const gate = Number(opts.minConfidence) > 0 ? Number(opts.minConfidence) : CONF_GATE_DEFAULT;
  const spec = model.spec;
  const feat = ctx.feat || {};
  const target = targetRow(ctx.selection, ctx.modelFeatures, feat, spec);
  const denseStd = standardize(denseFrom(target.geometry, spec), spec);
  const trainRows = model.rows.map((r) => ({ ...r, dense: standardize(denseFrom(r.geometry, spec), spec) }));

  for (const P of LEARNABLE_PARAMS) {
    const choice = (model.choices && model.choices[P]) || {};
    const ruleVal = Number(params[P]);
    if (choice.choice === 'none' || !Number.isFinite(ruleVal)) continue;
    let value = null;
    let source = null;
    let mlpDisp = null;
    if (choice.choice === 'knn' || (choice.choice === 'ridge' && !model.ridge[P])) {
      value = knnPredict(trainRows, denseStd, target.hotOnes, P);
      source = 'knn';
    } else if (choice.choice === 'ridge' && model.ridge[P]) {
      value = ridgePredict(model.ridge[P], buildRidgeX({ dense: denseStd, hotOnes: target.hotOnes }, spec));
      source = 'ridge';
    } else if (choice.choice === 'mlp' && model.mlp) {
      const k = LEARNABLE_PARAMS.indexOf(P);
      const x = buildRidgeX({ dense: denseStd, hotOnes: target.hotOnes }, spec);
      const ens = { arch: model.mlp.arch, nets: model.mlp.nets, nNets: model.mlp.nNets };
      value = mlp.predictEnsemble(ens, x)[k];
      mlpDisp = mlp.ensembleDispersion(ens, x)[k];
      source = 'mlp';
    }
    if (!Number.isFinite(value)) continue;
    // 参考案例（审计用）：top-k 近邻的 id/距离/专家值——岭回归预测同样透出（预测依据可读）
    const neighbors = trainRows
      .map((r) => ({ id: r.id, d: rowDistance(denseStd, target.hotOnes, r.dense, r.hotOnes) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, model.knn.k)
      .map((n) => ({ id: n.id, dist: Math.round(n.d * 1000) / 1000, value: Number(trainRows.find((r) => r.id === n.id).expert[P]) }));
    const dom = PARAM_DOMAINS[P];
    const clamped = Math.max(dom.min, Math.min(dom.max, dom.int ? Math.round(value) : Math.round(value * 1000) / 1000));
    // 置信度：kNN=近邻覆盖度 × (1-分歧度)；MLP=1 - 集成分歧/(1.5×参数自身离散度)。
    // 分歧归一基准 = 模型顶层 paramStd（该参数训练侧标准差）——变异系数口径在
    // 参数值跨 0 时爆表致置信度恒 0（审查修复 v62）；老模型无顶层 paramStd 退回 |mean|。
    let confidence = null;
    const stdIdx = LEARNABLE_PARAMS.indexOf(P);
    const stdBaseOf = (fallbackMean) => {
      const top = model.paramStd && Number.isFinite(model.paramStd[stdIdx]) && model.paramStd[stdIdx] > 1e-9 ? model.paramStd[stdIdx] : null;
      if (top) return top;
      return Math.abs(Number.isFinite(fallbackMean) ? fallbackMean : 0) + 1e-6;
    };
    if (source === 'knn') {
      const near = neighbors.filter((n) => n.dist <= model.knn.coverageRadius);
      const coverage = near.length / Math.max(1, neighbors.length);
      const vals = neighbors.map((n) => n.value).filter(Number.isFinite);
      const mean = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
      const spread = vals.length > 1
        ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) * (v - mean), 0) / (vals.length - 1)) / stdBaseOf(mean)
        : 0;
      confidence = Math.max(0, Math.min(1, coverage * (1 - Math.min(1, spread))));
    } else if (source === 'mlp') {
      const std = stdBaseOf(value) * 1.5;
      confidence = Math.max(0, Math.min(1, 1 - (mlpDisp || 0) / std));
    } else {
      confidence = choice.lofoFolds >= 2 ? 0.6 : 0.5;
    }
    const apply = mode === 'active' && confidence >= gate && clamped !== ruleVal;
    if (apply) params[P] = clamped;
    provenance.params[P] = {
      ruleValue: ruleVal,
      modelValue: clamped,
      source,
      confidence: Math.round(confidence * 100) / 100,
      applied: apply,
      neighbors: neighbors.slice(0, 3),
      lofoMae: round(choice[`${source}Mae`]),
      baselineMae: round(choice.baseMae),
    };
  }
  provenance.used = Object.values(provenance.params).some((p) => p.applied);
  return {
    used: provenance.used,
    params,
    provenance,
    note: mode === 'shadow'
      ? '影子模式：模型建议只透出给审批台，不改动切片参数'
      : (provenance.used ? '已按模型修正数值参数（逐参数置信度门控）' : '模型置信度未达门限或无差异——参数保持规则库值'),
  };
}

function round(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null; }

/** 治理台预览：规则基线 vs 模型建议 逐参数对比（不动真实参数） */
function preview(ruleParams, ctx, active) {
  const r = applyToParams(ruleParams, ctx, active, { mode: 'shadow' });
  return { ruleParams, suggestions: r.provenance ? r.provenance.params : {}, modelVersion: r.provenance ? r.provenance.modelVersion : null, note: r.note };
}

module.exports = {
  failureAttribution,
  train,
  applyToParams,
  preview,
  buildRow,
  targetRow,
  PARAM_DOMAINS,
  LEARNABLE_PARAMS,
  CONF_GATE_DEFAULT,
  _internals: { rowDistance, standardize, weightedMedian, knnPredict, fitRidge, ridgePredict, solveLinear, freezeSpec },
};
