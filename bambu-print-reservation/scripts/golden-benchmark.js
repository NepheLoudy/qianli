#!/usr/bin/env node
// ============================================================
// 黄金模型基准（2026-10-18 P0 框架）：固定基准件 × 固定机型，跑「自动切片」全链
// （档位解析 → Orca CLI → 产物回读）——profile/桥/规则改动后跑一遍，防回归。
//
// 用法：node scripts/golden-benchmark.js [--machine P1S] [--fixtures 目录] [--keep]
//   校验项：切片成功｜盘内 object 数 ≥1｜产物可提取内嵌参数｜回读拟合不 fail
// 退出码：0=全绿；1=有失败项（输出表格定位）
// ============================================================
const fs = require('fs');
const os = require('os');
const path = require('path');

const args = process.argv.slice(2);
const argOf = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const MACHINE = argOf('--machine') || 'P1S';
const FIXTURES = path.resolve(argOf('--fixtures') || path.join(__dirname, '..', 'test', 'fixtures', 'golden'));
const KEEP = args.includes('--keep');
const OUT_DIR = path.join(os.tmpdir(), `golden-bench-${Date.now()}`);

(async () => {
  const autoSlice = require('../src/services/autoSlice');
  if (!fs.existsSync(FIXTURES)) { console.error(`基准件目录不存在：${FIXTURES}（先跑 node scripts/make-golden-parts.js）`); process.exit(1); }
  const files = fs.readdirSync(FIXTURES).filter((f) => /\.(stl|step|stp)$/i.test(f)).sort();
  if (!files.length) { console.error('基准件目录为空'); process.exit(1); }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  console.log(`黄金基准：${files.length} 件 × ${MACHINE}（输出 ${OUT_DIR}）\n`);
  const rows = [];
  for (const f of files) {
    const t0 = Date.now();
    try {
      const r = await autoSlice.sliceModel({
        sourcePath: path.join(FIXTURES, f),
        fileName: f,
        model: MACHINE,
        materialType: 'PLA',
        selection: {},
        quantity: 1,
        outDir: OUT_DIR,
      });
      const verdict = r.fit ? r.fit.verdict : 'n/a';
      const ok = r.objects >= 1 && verdict !== 'fail';
      rows.push({ file: f, ok, objects: r.objects, fit: r.fit ? r.fit.weightedScore : null, verdict, ms: Date.now() - t0 });
      if (!KEEP) { try { fs.unlinkSync(r.outPath); } catch { /* 已不存在 */ } }
    } catch (err) {
      rows.push({ file: f, ok: false, err: err.message.slice(0, 140), ms: Date.now() - t0 });
    }
  }
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('件', 16) + pad('结果', 6) + pad('objects', 9) + pad('拟合%', 7) + pad('判定', 7) + 'ms');
  for (const r of rows) {
    console.log(pad(r.file, 16) + pad(r.ok ? '✓' : '✗', 6) + pad(r.objects != null ? r.objects : '—', 9)
      + pad(r.fit != null ? r.fit : '—', 7) + pad(r.verdict || r.err || '—', 7) + r.ms);
  }
  const bad = rows.filter((r) => !r.ok);
  console.log(`\n${bad.length ? `❌ ${bad.length} 项失败` : '✅ 全部通过'}（${rows.length} 件）`);
  process.exit(bad.length ? 1 : 0);
})();
