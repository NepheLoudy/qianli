// ============================================================
// 参数拟合度（2026-10-12 曼波纠正置信度语义）
//
// 录入工坊的置信度条 = 「引擎按人工工况算出的参数」与「专家切片产物
// 内嵌参数」的拟合度——衡量当前规则库对这个 case 的覆盖程度：
//   拟合 100% = 规则库已解释专家切法；
//   拟合低   = 差异项就是「可被记忆的参数」——一键转规则候选进待审池，
//              采纳后规则库即学会这个 case（知识覆盖缺口 → 记忆的通路）。
//
// 比较口径：仅白名单参数键；值归一化后比较（'15%'≡15、'true'≡true、
// 数值 3 位小数截断）。engine 侧缺键 = 引擎没覆盖（记 mismatch，reason 无规则）。
// ============================================================

const processRules = require('./processRules');

function normalize(v) {
  if (v === undefined || v === null) return null;
  if (Array.isArray(v)) return v.join('|');
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  if (/^-?\d+(\.\d+)?%$/.test(s)) return String(parseFloat(s));
  if (/^-?\d+(\.\d+)?$/.test(s)) return String(parseFloat(parseFloat(s).toFixed(3)));
  const lower = s.toLowerCase();
  if (lower === 'true' || lower === 'false') return lower;
  return s;
}

// 拟合度 v2（2026-10-18 P0 框架）：容差 + 参数权重 + 判定 verdict——v1 的
// score/total/matches 字段与语义保持不变（向后兼容既有页面与测试），新增：
//   · tol = 数值容差（消掉单位/舍入级噪音的「伪差异」；枚举/布尔仍精确比对）；
//   · near = 「接近但不同」带（差异在 tol~near 之间 → nearMiss，不再与离谱值同权展示）；
//   · weight = 结构参数权重（层高/墙数/填充/支撑 > 外观/裙边等装饰参数）；
//   · weightedScore = 加权通过率；verdict = pass(≥90) / warn(≥70) / fail。
// 审批台用 weightedScore/verdict 做「切片回读校验」展示；memorizable 仍按 rows 的
// match=false 提取可记忆参数（nearMiss 也属于专家明确覆盖，需进候选）。
const TOLERANCES = {
  layerHeight: { tol: 0.005, near: 0.04, weight: 2 },
  wallLoops: { tol: 0, near: 0, weight: 2 },
  topShellLayers: { tol: 0, near: 0, weight: 1 },
  bottomShellLayers: { tol: 0, near: 0, weight: 1 },
  infillDensity: { tol: 0.5, near: 5, weight: 2 },
  supportType: { tol: 0, near: 0, weight: 2 },
  supportThresholdAngle: { tol: 0.5, near: 5, weight: 1.5 },
  supportDensity: { tol: 0.5, near: 5, weight: 1.5 },
  brimWidth: { tol: 0.05, near: 0.5, weight: 0.5 },
  xyHoleComp: { tol: 0.005, near: 0.05, weight: 1.5 },
  xyContourComp: { tol: 0.005, near: 0.05, weight: 1.5 },
  temperatureDelta: { tol: 0.5, near: 3, weight: 1 },
  nozzleTempDelta: { tol: 0.5, near: 3, weight: 1 },
};
const DEFAULT_TOL = { tol: 0, near: 0, weight: 1 };

/**
 * 拟合度比较。口径：**只在专家声明的键上评估**——专家没写的键 = 接受默认，
 * 不构成分歧（引擎侧多出的键不算罚分）；专家声明而引擎无规则覆盖 = 记
 * mismatch（reason 无规则覆盖），其专家值即「可被记忆的参数」。
 * @param {Object} engineParams applyRules().params（白名单全集）
 * @param {Object} expertParams slicerExtract().params（专家声明的参数）
 * @returns {{score, weightedScore, verdict, total, matches, mismatches, rows}}
 *   rows: [{key, engine, expert, match, nearMiss, tol, weight}]
 */
function compare(engineParams, expertParams) {
  const E = engineParams || {}, X = expertParams || {};
  const keys = Object.keys(X);
  const rows = [];
  let matches = 0;
  let wSum = 0;
  let wTotal = 0;
  for (const key of keys) {
    const engine = normalize(E[key]);
    const expert = normalize(X[key]);
    const tolDef = TOLERANCES[key] || DEFAULT_TOL;
    const weight = tolDef.weight || 1;
    const eNum = engine !== null && /^-?\d+(\.\d+)?$/.test(engine) ? parseFloat(engine) : null;
    const xNum = expert !== null && /^-?\d+(\.\d+)?$/.test(expert) ? parseFloat(expert) : null;
    let match = false;
    let nearMiss = false;
    if (eNum !== null && xNum !== null) {
      const diff = Math.abs(eNum - xNum);
      match = diff <= (tolDef.tol || 0) + 1e-9;
      nearMiss = !match && tolDef.near > 0 && diff <= tolDef.near + 1e-9;
    } else {
      match = engine !== null && expert !== null && engine === expert;
    }
    if (match) matches++;
    wTotal += weight;
    if (match) wSum += weight;
    rows.push({
      key,
      engine: E[key] === undefined ? null : E[key],
      expert: X[key] === undefined ? null : X[key],
      match,
      nearMiss,
      tol: tolDef.tol || 0,
      weight,
    });
  }
  rows.sort((a, b) => (a.match === b.match ? a.key.localeCompare(b.key) : a.match ? 1 : -1)); // 差异排前
  const total = rows.length;
  const mismatches = total - matches;
  const weightedScore = wTotal ? Math.round((wSum / wTotal) * 1000) / 10 : null;
  const verdict = weightedScore === null ? null : weightedScore >= 90 ? 'pass' : weightedScore >= 70 ? 'warn' : 'fail';
  return {
    score: total ? Math.round((matches / total) * 100) : null,
    weightedScore,
    verdict,
    total,
    matches,
    mismatches,
    rows,
  };
}

/** 从拟合结果提取「可记忆参数」：专家值 ≠ 引擎值的键 → {when, set} 规则候选 */
function memorizable(fit) {
  const set = {};
  for (const r of fit.rows || []) {
    if (!r.match && r.expert !== null) set[r.key] = r.expert;
  }
  return set;
}

module.exports = { compare, memorizable, normalize, TOLERANCES };
