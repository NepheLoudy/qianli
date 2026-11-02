'use strict';

/**
 * 多模型↔切片包含匹配（v75 · 曼波问「一个切片有多个模型怎么上传」）：
 * 训练录入支持一次传 N 个模型 + 1 份切片产物（一盘多件），本模块回答
 * 「切片里哪个 object 对应哪个模型文件」——
 *
 *   ① 每个候选（切片 object / 上传模型）提取特征签名：包围盒体积、三角数、
 *      孔数、悬垂面积占比——几何指纹；
 *   ② 特征距离 = 归一化对数差的加权和（体积/三角数跨量级，取 log 差；
 *      孔数/悬垂绝对差）；
 *   ③ 二分图配对：排列叶子数（mPn）在预算内走 DFS 剪枝全排列取最优，
 *      超预算（如 8 切片 × 12 模型 = 12!/4! 级）走贪心 + 多轮交换改进——
 *      上传模型多于切片 object 时多余模型不带切片标签
 *      （允许：一次录一批模型、切片只切了其中几件）。
 *
 * 匹配阈值：距离 < 0.9 才算可信配对；低于阈值标记 lowConfidence（仍配对但透出提示）。
 */

const MAX_PAIRING = 12;

/** 特征签名。flags.holesKnown/overhangKnown=false 表示该侧解析不出孔/悬垂
 *  （切片 object 侧的现状）——距离函数只计入两侧都已知的维（v83 审查修复） */
function signature(bboxVolCm3, triangles, holeCount, overhangSeverePct, flags = {}) {
  return {
    bboxVolCm3: Math.max(1e-3, Number(bboxVolCm3) || 1e-3), triangles: Number(triangles) || 1,
    holeCount: Number(holeCount) || 0, overhangSeverePct: Number(overhangSeverePct) || 0,
    holesKnown: flags.holesKnown !== false, overhangKnown: flags.overhangKnown !== false,
  };
}

function distance(a, b) {
  const terms = [
    [0.4, Math.abs(Math.log10(a.bboxVolCm3) - Math.log10(b.bboxVolCm3))],       // 0=同量级
    [0.3, Math.abs(Math.log10(a.triangles) - Math.log10(b.triangles))],
  ];
  if (a.holesKnown !== false && b.holesKnown !== false) terms.push([0.15, Math.min(1, Math.abs(a.holeCount - b.holeCount) / 3)]);
  if (a.overhangKnown !== false && b.overhangKnown !== false) terms.push([0.15, Math.abs(a.overhangSeverePct - b.overhangSeverePct) / 100]);
  const w = terms.reduce((s, t) => s + t[0], 0);
  return terms.reduce((s, t) => s + t[0] * t[1], 0) / w;
}

/** 全排列最优配对（DFS 逐位选模型 + 非负距离剪枝）；返回 [ [sliceIdx, modelIdx], ... ]。
 *  只排前 n 位（部分排列）——护栏看叶子数预算而非切片数，防 8 切片×12 模型=12!/4! 级枚举 */
const BRUTE_BUDGET = 2e6;
function permLeaves(n, m) { let p = 1; for (let k = 0; k < n; k++) { p *= m - k; if (p > BRUTE_BUDGET) return p; } return p; }
function bruteForce(sigs, msigs, m) {
  const n = Math.min(sigs.length, m);
  let best = null;
  let bestCost = Infinity;
  const used = new Array(m).fill(false);
  const assign = new Array(n).fill(0);
  const rec = (depth, cost) => {
    if (depth === n) {
      if (cost < bestCost - 1e-12) { bestCost = cost; best = assign.slice(); }
      return;
    }
    for (let j = 0; j < m; j++) {
      if (used[j]) continue;
      const d = distance(sigs[depth], msigs[j]);
      if (cost + d >= bestCost) continue; // 距离非负，越界即剪
      used[j] = true; assign[depth] = j;
      rec(depth + 1, cost + d);
      used[j] = false;
    }
  };
  rec(0, 0);
  return (best || []).map((modelIdx, sliceIdx) => [sliceIdx, modelIdx]);
}

/** 贪心 + 交换改进（n > 8）；同 bruteForce 口径返回 [sliceIdx, modelIdx] */
function greedy(sigs, msigs, m) {
  const n = Math.min(sigs.length, m);
  const pairs = [];
  const used = new Set();
  const cand = [];
  for (let i = 0; i < sigs.length; i++) for (let j = 0; j < m; j++) cand.push({ i, j, d: distance(sigs[i], msigs[j]) });
  cand.sort((a, b) => a.d - b.d);
  const bySlice = new Map();
  for (const c of cand) {
    if (bySlice.size >= n) break;
    if (bySlice.has(c.i) || used.has(c.j)) continue; // 切片只配一次（cand 升序，先到即最优），模型不复用
    used.add(c.j);
    bySlice.set(c.i, c.j);
  }
  for (const [si, mi] of bySlice) pairs.push([si, mi]);
  // 交换改进（多轮至收敛）：任两对互换 model 后总距离下降则换
  let improved = true;
  while (improved) {
    improved = false;
    for (let a = 0; a < pairs.length; a++) for (let b = a + 1; b < pairs.length; b++) {
      const cur = distance(sigs[pairs[a][0]], msigs[pairs[a][1]]) + distance(sigs[pairs[b][0]], msigs[pairs[b][1]]);
      const alt = distance(sigs[pairs[a][0]], msigs[pairs[b][1]]) + distance(sigs[pairs[b][0]], msigs[pairs[a][1]]);
      if (alt < cur - 1e-9) { const t = pairs[a][1]; pairs[a][1] = pairs[b][1]; pairs[b][1] = t; improved = true; }
    }
  }
  return pairs;
}

/**
 * 主入口。
 * @param {Array} sliceSigs 切片各 object 的签名（含 name）
 * @param {Array} modelSigs 上传各模型的签名（含 name）
 * @returns {{pairs:Array<{sliceIdx, modelIdx, distance, lowConfidence}>, unpairedModels:number[]}}
 *   lowConfidence 判定（v75 歧义场景）：距离与「次优替代」的差距 <0.05 即歧义——
 *   该切片 object 换配另一个模型代价几乎一样时，配对结果不可信（阈值比较而非绝对值）
 */
function matchModels(sliceSigs, modelSigs) {
  const s = sliceSigs.map((x) => signature(x.bboxVolCm3, x.triangles, x.holeCount, x.overhangSeverePct, x));
  const ms = modelSigs.map((x) => signature(x.bboxVolCm3, x.triangles, x.holeCount, x.overhangSeverePct, x));
  const m = Math.min(ms.length, MAX_PAIRING);
  const n = Math.min(s.length, m);
  const order = (n <= 8 && permLeaves(n, m) <= BRUTE_BUDGET ? bruteForce(s, ms, m) : greedy(s, ms, m)) || [];
  const pairs = order.map(([si, mi]) => {
    const d = distance(s[si], ms[mi]);
    // 次优替代：该切片 object 配给其它任一模型的最小距离
    let alt = Infinity;
    for (let j = 0; j < ms.length; j++) {
      if (j === mi) continue;
      alt = Math.min(alt, distance(s[si], ms[j]));
    }
    const ambiguous = Number.isFinite(alt) && alt - d < 0.05; // 次优与所选几乎一样近
    return { sliceIdx: si, modelIdx: mi, distance: Math.round(d * 1000) / 1000, lowConfidence: ambiguous };
  }).sort((a, b) => a.modelIdx - b.modelIdx);
  const unpaired = [];
  const usedModels = new Set(pairs.map((p) => p.modelIdx));
  ms.forEach((_, i) => { if (!usedModels.has(i)) unpaired.push(i); });
  return { pairs, unpairedModels: unpaired };
}

module.exports = { matchModels, signature, distance, MAX_PAIRING };
