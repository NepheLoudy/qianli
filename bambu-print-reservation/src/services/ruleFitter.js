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

// v84 移除：fitRules/lofoEvaluate（阈值规则拟合与 LOFO 评估）——曼波定「拟合应选取连续映射
// 而非定态规则」，数值参数学习由 paramModel（三族 LOFO 竞技）承担；本模块保留
// median/expertOf 作为 paramModel 的消费依赖。历史实现见 git（v83d 前）。

module.exports = { median, expertOf };
