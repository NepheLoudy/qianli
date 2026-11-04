/**
 * 完成单 dispatchStats 回填（v89）：56 条已完成单从 history 时间差补算实际时长，
 * 机×料×几何全量可回溯——机型/耗材学习器的统计素材立即从 0 变 54。
 * 用法：node scripts/backfill-dispatch-stats.js [--dry]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const store = require('../src/services/reservationStore');

(async () => {
  const dry = process.argv.includes('--dry');
  const all = store.list();
  const done = all.filter((r) => r.status === '已完成' && r.printer && !r.dispatchStats);
  console.log(`完成单缺 dispatchStats：${done.length} 条${dry ? '（dry）' : ''}`);
  let ok = 0, skip = 0;
  for (const r of done) {
    const startH = (r.history || []).find((h) => h.to === '打印中');
    const endH = (r.history || []).find((h) => h.to === '已完成');
    if (!startH || !endH) { skip++; continue; }
    const mins = (Date.parse(endH.at) - Date.parse(startH.at)) / 60000;
    if (!(mins > 1 && mins < 60 * 24)) { skip++; continue; }
    if (!dry) {
      const target = all.find((x) => x.id === r.id);
      target.dispatchStats = {
        printer: r.printer,
        printerModel: (r.review && r.review.dispatch && r.review.dispatch.assignedPrinter) || r.printer,
        material: r.materialType || null,
        estMinutes: Number(r.estMinutes) > 0 ? Number(r.estMinutes) : null,
        actualMinutes: Math.round(mins),
        volumeCm3: (r.modelFeatures && r.modelFeatures.volumeCm3) || null,
        triangles: (r.modelFeatures && r.modelFeatures.triangles) || null,
        recordedAt: new Date().toISOString(),
        backfilled: true, // 回填标记（区分实时采集的信号）
      };
    }
    ok++;
    console.log(`  ${r.id}: ${r.printer} ${Math.round(mins)}min`);
  }
  if (!dry && ok) store._saveForBackfill(all);
  console.log(`\n完成：回填 ${ok} / 跳过 ${skip}${dry ? '（dry 未写入）' : ''}`);
})();
