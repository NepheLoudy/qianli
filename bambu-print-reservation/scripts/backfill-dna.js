/**
 * 需求链预约单 DNA 回填（v84）：v79 前录入的 STEP 需求链单 modelFeatures 无 DNA——
 * 源文件（STEP/STL）在 uploads 归档里，重算 analyzeStep/analyzeStl + computeDNA 回填。
 * 同时给训练样本库的 STEP/STL 录入件做同样回填。
 * 用法：node scripts/backfill-dna.js [--dry]
 * 安全：dry 模式只统计；写入走 setFeatures/reservationStore.save 原子路径。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const mf = require('../src/services/modelFeatures');

async function analyzeFile(filePath, name) {
  const buf = fs.readFileSync(filePath);
  if (/\.3mf$/i.test(name || filePath)) return mf.analyze3mf(buf);
  if (/\.(step|stp)$/i.test(name || filePath)) return await mf.analyzeStep(buf, name || filePath);
  return mf.analyzeStl(buf);
}

(async () => {
  const dry = process.argv.includes('--dry');
  console.log(`模式：${dry ? 'DRY（只统计）' : 'WRITE'}`);

  // ---------- ① 需求链预约单（STEP/STL 有归档文件） ----------
  const reservationStore = require('../src/services/reservationStore');
  const rs = reservationStore.list().filter((r) => r.modelFeatures && !r.modelFeatures.dna
    && /\.(step|stp|stl)$/i.test(r.fileName || '') && r.filePath && fs.existsSync(r.filePath));
  console.log(`\n[预约单] 缺 DNA 且源文件在档：${rs.length} 条`);
  let ok1 = 0;
  for (const r of rs) {
    try {
      const feats = await analyzeFile(r.filePath, r.fileName);
      if (!feats || !feats.ok || !feats.dna) { console.log(`  ${r.id}: 体检未过（${(feats && feats.reason) || '?'}）`); continue; }
      if (!dry) {
        const all = reservationStore.list();
        const target = all.find((x) => x.id === r.id);
        target.modelFeatures = feats; // 全量替换（含 DNA + 更新后的建议）
        // 走 store 的 save（store 未导出 save——用内部口径 tmp+rename 原子写）
        const saveFn = reservationStore._saveForBackfill || null;
        if (saveFn) saveFn(all);
        else { console.log(`  ${r.id}: 无保存通道，跳过`); continue; }
      }
      ok1++;
      console.log(`  ${r.id}: DNA✓｜孔 ${feats.dna.vector[0]}｜悬垂域 ${feats.dna.vector[5]}｜凹角 ${feats.dna.vector[9]}`);
    } catch (err) {
      console.log(`  ${r.id}: 失败 ${err.message}`);
    }
  }

  // ---------- ② 训练样本库（kind=stl 的 4 条 + 3mf 带网格的少数） ----------
  const store = require('../src/services/trainingStore');
  const samples = store.list();
  const need = samples.filter((s) => s.model && s.model.storedPath && !(s.model.features && s.model.features.dna));
  console.log(`\n[样本库] 缺 DNA 且有归档：${need.length} 条`);
  let ok2 = 0;
  for (const s of need) {
    try {
      const feats = await analyzeFile(s.model.storedPath, s.model.originalName || s.model.storedPath);
      if (!feats || !feats.ok || !feats.dna) { console.log(`  ${s.id}: 无网格/未过（切片导出件属预期）`); continue; }
      if (!dry) store.setFeatures(s.id, { features: feats, featureSource: s.featureSource || 'auto' });
      ok2++;
      console.log(`  ${s.id}: DNA✓｜孔 ${feats.dna.vector[0]}`);
    } catch (err) {
      console.log(`  ${s.id}: 失败 ${err.message}`);
    }
  }
  console.log(`\n完成：预约单 ${ok1}/${rs.length}，样本库 ${ok2}/${need.length}${dry ? '（dry 未写入）' : ''}`);
})();
