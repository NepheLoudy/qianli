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
  // P2 修复（2026-11-05 全量审查）：actualMinutes=null（老单/极端回填失败）经
  // Number() 变 0 混入统计会把 actualMedian 拉向 0——null 语义归 null，由
  // Number.isFinite 自然剔除（undefined 同理由 NaN 剔除）
  return (records || []).filter((r) => r.dispatchStats
    && r.dispatchStats.actualMinutes != null
    && Number.isFinite(Number(r.dispatchStats.actualMinutes)));
}

/** ① 按机时长校准：{printer: {estMedian, actualMedian, bias, n}}。
 *  v89 续修正：老单 estMinutes 全空（回填时也不可补）——bias 无从算起时退回
 *  actualMedian 供参考（校准系数标记 unavailable 而非空对象消失）。 */
function durationBias(records) {
  const byPrinter = {};
  for (const s of collectStats(records)) {
    const st = s.dispatchStats;
    // P2 修复（2026-11-05 全量审查）：老单 estMinutes=null（回填不可补），旧写法
    // Number(null)=0 会把 0 混进中位数拉低 estMedian——null 语义归 null，由 median
    // 的 Number.isFinite 过滤自然剔除
    (byPrinter[st.printer] = byPrinter[st.printer] || []).push({
      est: st.estMinutes == null ? null : Number(st.estMinutes),
      act: Number(st.actualMinutes),
    });
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
    let usedSizedPool = false;
    if (vol) {
      const sized = pool.filter((s) => Number.isFinite(Number(s.volumeCm3)) && Math.abs(Math.log10(Math.max(0.1, Number(s.volumeCm3))) - Math.log10(Math.max(0.1, vol))) <= 1);
      if (sized.length >= 2) { pool = sized; usedSizedPool = true; }
    }
    const med = median(pool.map((s) => Number(s.actualMinutes)));
    if (med == null) continue;
    // P2 修复（2026-11-05 全量审查）：basis 文案按实际采样路径给——vol 提供但同量级
    // 样本 <2 退回全机池时不再误称「（同体积量级）」
    out.push({
      name: m.name,
      predictedMedian: med,
      n: pool.length,
      basis: `${m.name} 历史同机${usedSizedPool ? '（同体积量级）' : ''}实际时长中位 ${med}min（n=${pool.length}）`,
    });
  }
  return out.sort((a, b) => a.predictedMedian - b.predictedMedian);
}

/** 排队等待中位数（负载视角）：从 history 取「紧邻打印中的那次排队」时间差按机聚合。
 *  P2 修复（2026-11-05 全量审查）：旧口径取首个「排队中」轨迹——失败重排单的等待
 *  含重试+冷却虚高；改为紧邻「打印中」之前的那条排队轨迹（实际生效的排队） */
function queueWaitByPrinter(records) {
  const byP = {};
  for (const r of records || []) {
    const hist = r.history || [];
    // 取最后一条「打印中」——失败重排单会多次开打，负载等待关心的是实际生效的
    // 那轮（旧口径取首个打印中+首个排队，重试+冷却全计入，等待虚高）
    let pIdx = -1;
    for (let i = hist.length - 1; i >= 0; i--) {
      if (hist[i].to === '打印中') { pIdx = i; break; }
    }
    if (pIdx < 0) continue;
    // 逆着找紧邻它之前的那条「排队中」（多轮排队取最后一轮）
    for (let i = pIdx - 1; i >= 0; i--) {
      if (hist[i].to === '排队中') {
        const mins = (Date.parse(hist[pIdx].at) - Date.parse(hist[i].at)) / 60000;
        if (mins >= 0 && mins < 60 * 48) (byP[r.printer] = byP[r.printer] || []).push(mins);
        break;
      }
    }
  }
  const out = {};
  for (const [p, list] of Object.entries(byP)) out[p] = { median: median(list), n: list.length };
  return out;
}

module.exports = { collectStats, durationBias, machineMaterialMatrix, recommendBySpeed, queueWaitByPrinter, median };
