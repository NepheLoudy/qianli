'use strict';

/**
 * 分发学习器 v2（v89 · 「分发学习逻辑深化」）：从计数器到真统计模型。
 *
 * 数据源：预约单 dispatchStats（v89 起完成单实时回填 + 存量 54 条已回填）——
 *   {printer, printerModel, material, estMinutes, actualMinutes, volumeCm3, triangles}
 *
 * 三层能力（全部纯读预约记录，零新存储）：
 *   ① 时长校准：estMinutes vs actualMinutes 的按机偏差系数——切片预估乘上系数
 *      才是这台机的真实预期（同一切片在 H2D 与 A1mini 上时间可能差 30%+）；
 *   ② 机型推荐（速度视角）：给定体积/材料，各机历史实际时长中位数对比——
 *      「这单交 A1mini 39 分钟 vs 交 X1C 336 分钟」的量化依据；
 *   ③ 负载视角：各机当前队列等待中位数（排队→开打的历史等待），排队择机时参考。
 */

const median = (arr) => {
  const a = (arr || []).filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
};

/** 从预约单聚合 dispatchStats 样本 */
function collectStats(records) {
  return (records || []).filter((r) => r.dispatchStats && Number.isFinite(Number(r.dispatchStats.actualMinutes)));
}

/** ① 按机时长校准：{printer: {estMedian, actualMedian, bias, n}}。
 *  v89 续修正：老单 estMinutes 全空（回填时也不可补）——bias 无从算起时退回
 *  actualMedian 供参考（校准系数标记 unavailable 而非空对象消失）。 */
function durationBias(records) {
  const byPrinter = {};
  for (const s of collectStats(records)) {
    const st = s.dispatchStats;
    (byPrinter[st.printer] = byPrinter[st.printer] || []).push({ est: Number(st.estMinutes), act: Number(st.actualMinutes) });
  }
  const out = {};
  for (const [printer, list] of Object.entries(byPrinter)) {
    const estMed = median(list.map((x) => x.est));
    const actMed = median(list.map((x) => x.act));
    out[printer] = {
      n: list.length,
      actualMedian: actMed,
      estMedian: estMed,
      bias: estMed ? Math.round((actMed / estMed) * 100) / 100 : null, // 无 est 的老单：bias 未知
      actualOnly: !estMed, // true = 该机历史全是无预估时长（校准系数待新单积累）
    };
  }
  return out;
}

/** ② 机×材料实际时长矩阵：{printer×material: {median, n}} */
function machineMaterialMatrix(records) {
  const m = {};
  for (const s of collectStats(records)) {
    const st = s.dispatchStats;
    const key = `${st.printer}×${st.material || '?'}`;
    (m[key] = m[key] || []).push(Number(st.actualMinutes));
  }
  const out = {};
  for (const [key, list] of Object.entries(m)) out[key] = { median: median(list), n: list.length };
  return out;
}

/**
 * ③ 机型推荐（给定任务特征 → 各候选机的预期时长排名）。
 * @param {Object} task {volumeCm3, material}
 * @param {Array} machines [{name, model}]
 * @param {Array} records 预约单全量
 * @returns {Array} [{name, predictedMedian, n, basis}] 按预期时长升序（快者先）
 */
function recommendBySpeed(task, machines, records) {
  const stats = collectStats(records).map((r) => r.dispatchStats);
  const vol = Number(task.volumeCm3) || null;
  const out = [];
  for (const m of machines || []) {
    // 同机样本优先取「体积同量级」的（±1 个数量级内），不足 2 条退回全机样本
    let pool = stats.filter((s) => s.printer === m.name);
    if (vol) {
      const sized = pool.filter((s) => Number.isFinite(Number(s.volumeCm3)) && Math.abs(Math.log10(Math.max(0.1, Number(s.volumeCm3))) - Math.log10(Math.max(0.1, vol))) <= 1);
      if (sized.length >= 2) pool = sized;
    }
    const med = median(pool.map((s) => Number(s.actualMinutes)));
    if (med == null) continue;
    out.push({
      name: m.name,
      predictedMedian: med,
      n: pool.length,
      basis: `${m.name} 历史同机${vol ? '（同体积量级）' : ''}实际时长中位 ${med}min（n=${pool.length}）`,
    });
  }
  return out.sort((a, b) => a.predictedMedian - b.predictedMedian);
}

/** 排队等待中位数（负载视角）：从 history 排队中→打印中 时间差按机聚合 */
function queueWaitByPrinter(records) {
  const byP = {};
  for (const r of records || []) {
    const q = (r.history || []).find((h) => h.to === '排队中');
    const p = (r.history || []).find((h) => h.to === '打印中');
    if (!q || !p) continue;
    const mins = (Date.parse(p.at) - Date.parse(q.at)) / 60000;
    if (!(mins >= 0 && mins < 60 * 48)) continue;
    (byP[r.printer] = byP[r.printer] || []).push(mins);
  }
  const out = {};
  for (const [p, list] of Object.entries(byP)) out[p] = { median: median(list), n: list.length };
  return out;
}

module.exports = { collectStats, durationBias, machineMaterialMatrix, recommendBySpeed, queueWaitByPrinter, median };
