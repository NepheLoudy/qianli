'use strict';

/**
 * 规则拟合引擎（2026-10-15 曼波定原则）：
 * **学习型工艺因果一律动态拟合**——从「优秀切片样本 × 其几何特征」统计得出，
 * 不手写「Z 向孔 → +0.2」这类结论（手写已撤，原则注释见 processRules）。
 *
 * 数据源：训练样本库（每条样本 = 专家切片参数提取 + 几何体检特征 + 3D 空间标注 + 工况勾选）
 * 拟合算法（第一版·务实统计）：
 *   对每个参数键 P × 每个派生特征 F：
 *     分组 = 特征活跃组（F ≥ 阈值）vs 不活跃组，取各组专家参数中位数
 *     显著条件：活跃样本 ≥ 3 且 中位差 ≥ max(|基线|×5%, 0.01)
 *     → 产出候选规则 { when: {feat.F: {min}}, set: {P: 活跃组中位值} } + 统计依据
 * 产出：候选规则数组（供待审池确认，采纳后进 processRules 生效）
 */

const BASELINE_FOR_FIT = require('./processRules').BASELINE;

/** 中位数（空数组返回 null） */
function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).slice().sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 只拟合数值参数（字符串/数组参数的中位统计无意义——留后续分类拟合） */
function isNumericParam(name) {
  const v = BASELINE_FOR_FIT[name];
  return typeof v === 'number';
}

/** 样本 → 专家参数（diff 优先，回退全量提取；无效样本返回 null） */
function expertOf(sample) {
  const ext = sample && sample.slice && sample.slice.extraction;
  if (!ext || !ext.params) return null;
  const expert = { ...ext.params };
  if (ext.diff) Object.assign(expert, ext.diff); // diff = 专家显式覆盖（更权威）
  return expert;
}

/**
 * 主入口。
 * @param {Function} deriveFeatures featureDerive.deriveFeatures
 * @param {Array} samples trainingStore 样本数组（list()）
 * @param {Object} [opts] opts.minSamples 活跃组最小样本数（默认 3）；opts.minRelDelta 相对差阈值（默认 0.05）
 * @returns {{ candidates: Array, stats: Object }}
 */
function fitRules(deriveFeatures, samples, opts = {}) {
  const minSamples = Number(opts.minSamples) > 0 ? Number(opts.minSamples) : 3;
  const minRelDelta = Number(opts.minRelDelta) > 0 ? Number(opts.minRelDelta) : 0.05;

  // ① 样本 → { feat, expertParams }（expertParams = diff 优先，回退全量提取）
  const rows = [];
  for (const s of (Array.isArray(samples) ? samples : [])) {
    const expert = expertOf(s);
    if (!expert) continue;
    const feat = deriveFeatures(s.spatial || [], s.model && s.model.features, s.selection || {});
    rows.push({ feat, expert });
  }
  if (rows.length < minSamples) {
    return { candidates: [], stats: { samples: rows.length, note: `样本不足（${rows.length} < ${minSamples}），无法产出可靠拟合` } };
  }

  // ② 特征键集（样本中出现过的派生特征）
  const featureKeys = new Set();
  for (const r of rows) for (const k of Object.keys(r.feat)) featureKeys.add(k);

  // ③ 逐 (特征 × 参数) 统计
  const candidates = [];
  const paramNames = Object.keys(BASELINE_FOR_FIT).filter(isNumericParam);
  for (const F of featureKeys) {
    const activeValues = [];
    const inactiveValues = [];
    const activeFeatVals = [];
    for (const r of rows) {
      const fv = Number(r.feat[F]);
      const isActive = Number.isFinite(fv) && fv >= 1; // 计数/布尔特征活跃判据：≥1
      if (isActive) activeFeatVals.push(fv);
      for (const P of paramNames) {
        const pv = Number(r.expert[P]);
        if (!Number.isFinite(pv)) continue;
        (isActive ? activeValues : inactiveValues).push({ P, v: pv });
      }
    }
    if (activeFeatVals.length < minSamples) continue;
    const threshold = Math.min(...activeFeatVals);
    for (const P of paramNames) {
      const act = activeValues.filter((x) => x.P === P).map((x) => x.v);
      const inact = inactiveValues.filter((x) => x.P === P).map((x) => x.v);
      // 活跃组与对照组都要有足够样本（全员同值特征无对照=伪关联，2026-10-15 集成实测暴露）
      if (act.length < minSamples || inact.length < minSamples) continue;
      const medA = median(act);
      const medI = inact.length ? median(inact) : Number(BASELINE_FOR_FIT[P]) || 0;
      if (medA === null || medI === null) continue;
      const delta = medA - medI;
      const thresholdDelta = Math.max(Math.abs(medI) * minRelDelta, 0.01);
      if (Math.abs(delta) < thresholdDelta) continue; // 差异不显著
      candidates.push({
        when: { [`feat.${F}`]: { min: threshold } },
        set: { [P]: Math.round(medA * 1000) / 1000 },
        reason: `样本拟合：${F} ≥ ${threshold} 的 ${act.length} 条优秀切片中，${P} 中位值 ${medA}（对照 ${medI === null ? '—' : medI}，差 ${Math.round(delta * 1000) / 1000}）`,
        stats: { feature: F, param: P, active: act.length, inactive: inact.length, medianActive: medA, medianInactive: medI, delta: Math.round(delta * 1000) / 1000 },
      });
    }
  }

  // ④ 排序（样本多、差异大者优先）+ 去重（特征+参数唯一）
  candidates.sort((a, b) => (b.stats.active - a.stats.active) || (Math.abs(b.stats.delta) - Math.abs(a.stats.delta)));
  const seen = new Set();
  const unique = [];
  for (const c of candidates) {
    const key = `${c.stats.feature}|${c.stats.param}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(c);
  }

  const stats = { samples: rows.length, features: featureKeys.size, candidates: unique.length };
  // LOFO 跨家族泛化体检（2026-10-18 P0；样本带 family 时；不阻塞主拟合）
  if (opts.lofo !== false) {
    try { stats.lofo = lofoEvaluate(deriveFeatures, samples, { ...opts, lofo: false }); }
    catch (err) { stats.lofoNote = `LOFO 评估失败: ${err.message}`; }
  }
  return { candidates: unique, stats };
}

/**
 * LOFO（留一家族出）评估（2026-10-18 P0 防泄漏）：按样本 family 分组，逐族留出——
 * 用其余族跑 fitRules 产候选，在留出族上测候选规则的预测误差，并与「训练侧全局中位
 * 基线」对比（gain>0 = 规则在未见家族上比裸中位数更准）。输出跨族泛化数字，
 * 供待审池候选排序/阈值判断；不替代主拟合（主拟合仍全量样本）。
 */
function lofoEvaluate(deriveFeatures, samples, opts = {}) {
  const list = (Array.isArray(samples) ? samples : []).map((s, i) => ({
    s,
    family: String((s && s.family) || `fam-unknown-${i}`),
  }));
  const families = [...new Set(list.map((x) => x.family))];
  if (families.length < 2) return { families: families.length, folds: 0, note: '家族不足（<2），无法 LOFO 评估' };
  const paramNames = Object.keys(BASELINE_FOR_FIT).filter(isNumericParam);
  const acc = new Map(); // `${feature}|${param}` → 累计误差
  let folds = 0;
  for (const held of families) {
    const trainS = list.filter((x) => x.family !== held).map((x) => x.s);
    const testS = list.filter((x) => x.family === held).map((x) => x.s);
    if (!trainS.length || !testS.length) continue;
    let fitted;
    try { fitted = fitRules(deriveFeatures, trainS, { ...opts, minSamples: Math.min(2, Number(opts.minSamples) || 3), lofo: false }); }
    catch { continue; }
    // 训练侧全局中位（基线预测）
    const base = {};
    for (const P of paramNames) {
      base[P] = median(trainS.map((s) => { const e = expertOf(s); return e ? Number(e[P]) : NaN; }).filter(Number.isFinite));
    }
    for (const c of fitted.candidates) {
      const F = c.stats.feature;
      const P = c.stats.param;
      const minF = (c.when[`feat.${F}`] && Number(c.when[`feat.${F}`].min)) || 1;
      const key = `${F}|${P}`;
      const cur = acc.get(key) || { feature: F, param: P, fired: 0, errSum: 0, baseErrSum: 0 };
      for (const s of testS) {
        const feat = deriveFeatures(s.spatial || [], s.model && s.model.features, s.selection || {});
        const fv = Number(feat[F]);
        if (!(Number.isFinite(fv) && fv >= minF)) continue;
        const expert = expertOf(s);
        const ev = expert ? Number(expert[P]) : NaN;
        if (!Number.isFinite(ev)) continue;
        cur.fired += 1;
        cur.errSum += Math.abs(Number(c.set[P]) - ev);
        if (Number.isFinite(base[P])) cur.baseErrSum += Math.abs(base[P] - ev);
      }
      acc.set(key, cur);
    }
    folds += 1;
  }
  const candidates = [...acc.values()]
    .filter((c) => c.fired > 0)
    .map((c) => ({
      feature: c.feature,
      param: c.param,
      fired: c.fired,
      lofoMae: Math.round((c.errSum / c.fired) * 1000) / 1000,
      baselineMae: Math.round((c.baseErrSum / c.fired) * 1000) / 1000,
      gain: Math.round(((c.baseErrSum - c.errSum) / c.fired) * 1000) / 1000,
    }))
    .sort((a, b) => (b.gain || 0) - (a.gain || 0));
  return { families: families.length, folds, candidates };
}

module.exports = { fitRules, lofoEvaluate, median, expertOf };
