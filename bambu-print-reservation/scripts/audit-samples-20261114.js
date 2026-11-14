/**
 * 训练库一次性清洗（2026-11-14 v107 曼波令「素材噪声整理」）——幂等，打标不删数据。
 * 在部署目标上跑：node scripts/audit-samples-20261114.js [--dry]
 * 规则（60 条全量体检结论）：
 *   excluded    工程 3mf 误入档 3 条（source=engineering：特征=作者网格非打印件、无切片参数，
 *               从未打成功——A面×2/下横梁）
 *   humanFactor 失败且无故障证据（failCode 空/0=热修49 类级反转人因终止）4 条——参数学习噪声
 *   quarantine  无 outcome（提交后从未打印）11 条
 *   machine 回填 outcome.issues「完成 @ 机器名」（41 条可回填）
 * 其余保持 clean。原始数据可从 bak 文件回滚。
 */
process.env.PRINTER_HOSTS = '';
process.env.PLAZA_BITABLE_TABLE_ID = '';
const fs = require('fs');
const path = require('path');

const TRAINING_FILE = process.env.TRAINING_SAMPLES_FILE
  || 'C:/home/qianli/bambu-data/training/training-samples.json';
const dry = process.argv.includes('--dry');

const d = JSON.parse(fs.readFileSync(TRAINING_FILE, 'utf8'));
const S = d.samples;
const changed = [];
const dist = { excluded: 0, humanFactor: 0, quarantine: 0, clean: 0, machineBackfilled: 0 };

// 源单工程件判定：样本 notes「源单 Rxxx」→ reservations 交叉查 embeddedParams.source。
// 关键教训：工程件的 slice.extraction.params **不是空的**——extractFrom3mf 会提出作者
// 上次工程保存的参数（13 项看着像真的，实际不是本单切片参数），且样本 id 与源单 id 有
// 错位（同日多单序号偏移），硬编码样本 id 会打偏——必须按源单号交叉判定
const RESV_FILE = process.env.RESERVATIONS_FILE || 'C:/home/qianli/bambu-data/reservations.json';
const R = JSON.parse(fs.readFileSync(RESV_FILE, 'utf8'));
const engSources = new Set((R.records || [])
  .filter((r) => r.embeddedParams && r.embeddedParams.source === 'engineering')
  .map((r) => r.id));
const sourceOf = (s) => {
  const m = /源单 (R\d{8}-\d{3})/.exec(s.notes || '');
  return m ? m[1] : null;
};

for (const s of S) {
  const before = JSON.stringify({ q: s.quality, m: s.machine });
  const notes = [];

  // ① 工程件误入档 → excluded（源单是 engineering 提交的样本）
  const src = sourceOf(s);
  if (src && engSources.has(src)) {
    s.quality = 'excluded';
    notes.push(`工程 3mf 误入档（源单 ${src} 为工程件提交——参数是作者工程参数非本单切片参数，特征=作者网格）`);
  }
  // ② 无 outcome → quarantine（工程件已 excluded 优先）
  if (!s.quality && !s.outcome) {
    s.quality = 'quarantine';
    notes.push('无 outcome——提交后从未打印，待复核');
  }
  // ③ 失败且无故障证据 → humanFactor
  if (!s.quality && s.outcome && s.outcome.status === '失败'
    && (!s.outcome.failCode || s.outcome.failCode === 0)) {
    s.quality = 'humanFactor';
    notes.push(`失败无故障证据（${(s.outcome.issues || '').slice(0, 30)}）= 人因终止类，参数学习噪声`);
  }
  // ④ machine 回填（含已打标的样本一并回填）
  if (!s.machine && s.outcome && s.outcome.issues) {
    const m = /完成 @ (.+)$/.exec(s.outcome.issues);
    if (m && m[1]) { s.machine = m[1].trim(); dist.machineBackfilled++; }
  }

  if (notes.length) {
    s.qualityNote = notes.join('；').slice(0, 300);
    s.qualityAt = new Date().toISOString();
  }
  s.quality = s.quality || 'clean';
  dist[s.quality] = (dist[s.quality] || 0) + 1;
  const after = JSON.stringify({ q: s.quality, m: s.machine });
  if (before !== after) changed.push(`${s.id} → ${s.quality}${s.machine ? ' +machine=' + s.machine : ''}`);
}

console.log(`[dry=${dry}] 总数 ${S.length}，变更 ${changed.length} 条`);
console.log('质量分布:', JSON.stringify(dist));
if (!dry) {
  const bak = TRAINING_FILE + '.bak-audit-20261114';
  if (!fs.existsSync(bak)) fs.copyFileSync(TRAINING_FILE, bak);
  fs.writeFileSync(TRAINING_FILE, JSON.stringify(d, null, 2));
  console.log('备份:', bak);
  console.log('已写回:', TRAINING_FILE);
}
changed.forEach((c) => console.log('  ', c));
