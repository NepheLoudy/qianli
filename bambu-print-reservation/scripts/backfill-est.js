/**
 * 完成单 estMinutes 回填（v90）：dispatchStats 的 estMinutes 全空（老单未采集）——
 * 完成单的 3mf 在档且内嵌 gcode 头部有预估时长，解包补算。
 * 用法：node scripts/backfill-est.js [--dry]
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const store = require('../src/services/reservationStore');

(async () => {
  const dry = process.argv.includes('--dry');
  const all = store.list();
  const need = all.filter((r) => r.dispatchStats && r.dispatchStats.estMinutes == null
    && /\.3mf$/i.test(r.fileName || '') && r.filePath && fs.existsSync(r.filePath));
  console.log(`dispatchStats 缺 est 且 3mf 在档：${need.length} 条${dry ? '（dry）' : ''}`);
  let ok = 0, skip = 0;
  for (const r of need) {
    try {
      const extraction = require('../src/services/slicerExtract').extractFrom3mf(fs.readFileSync(r.filePath));
      const est = extraction && Number.isFinite(Number(extraction.estMinutes)) ? Number(extraction.estMinutes) : null;
      if (!est) { skip++; continue; }
      if (!dry) {
        const target = all.find((x) => x.id === r.id);
        target.dispatchStats.estMinutes = est;
      }
      ok++;
      console.log(`  ${r.id}: est=${est}min（actual=${r.dispatchStats.actualMinutes}min）`);
    } catch (err) {
      skip++;
      console.log(`  ${r.id}: 失败 ${err.message}`);
    }
  }
  if (!dry && ok) store._saveForBackfill(all);
  console.log(`\n完成：回填 ${ok} / 跳过 ${skip}${dry ? '（dry 未写入）' : ''}`);
})();
