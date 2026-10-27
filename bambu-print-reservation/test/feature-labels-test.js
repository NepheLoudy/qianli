// 特征标签批单测（2026-10-27 热修52）：自举摆向四元数、fitter 标签权重、
// 自举回填防覆盖、切片统计标签
const assert = require('assert');
const modelOrient = require('../src/services/modelOrient');
const fitter = require('../src/services/orientationFitter');

let pass = 0;
function ok(name, fn) {
  try { fn(); console.log(`✓ ${name}`); pass++; }
  catch (err) { console.error(`✗ ${name}\n  ${err.message}`); process.exitCode = 1; }
}

// rotateVec 同 fitter 口径：验证 q⁻¹(Z) = up 往返
function rotateVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
function near(a, b, eps = 1e-6) { return Math.abs(a - b) < eps; }

ok('quaternionFromUpAxis：非零轴往返 q⁻¹(Z)=up', () => {
  for (const up of [[1, 0, 0], [0, -1, 0], [0, 0, -1], [1, 1, 0], [2, 3, -1], [0.5, -0.5, 1]]) {
    const q = modelOrient.quaternionFromUpAxis(up);
    assert.strictEqual(q.length, 4);
    // 归一化校验
    const n = Math.hypot(q[0], q[1], q[2], q[3]);
    assert.ok(near(n, 1, 1e-9), `|q|=1 (up=${up}) got ${n}`);
    // 语义往返：q⁻¹ 作用于 +Z 得到 up（单位化）
    const qInv = [-q[0], -q[1], -q[2], q[3]];
    const len = Math.hypot(...up);
    const upUnit = up.map((v) => v / len);
    const back = rotateVec(qInv, [0, 0, 1]);
    assert.ok(near(back[0], upUnit[0], 1e-9) && near(back[1], upUnit[1], 1e-9) && near(back[2], upUnit[2], 1e-9),
      `q⁻¹(Z)=up (up=${up}) got ${back}`);
  }
});

ok('quaternionFromUpAxis：+Z 恒等 / -Z 半翻', () => {
  assert.deepStrictEqual(modelOrient.quaternionFromUpAxis([0, 0, 1]), [0, 0, 0, 1]);
  const q = modelOrient.quaternionFromUpAxis([0, 0, -1]);
  assert.ok(near(q[3], 0, 1e-9)); // 180° → w=0
});

ok('candidateUpAxis：恒等候选朝上 = +Z', () => {
  const up = modelOrient.candidateUpAxis(modelOrient.IDENTITY);
  assert.deepStrictEqual(up, [0, 0, 1]);
});

ok('evaluateRows 加权：弱标签不淹没强标签', () => {
  // 两行：一行权重 1（专家选 A）、一行权重 0.35（自举选 B）。
  // 构造 policy 使 A 被选中 → 加权准确率应 = 1/(1+0.35) ≈ 0.7407
  const cands = [
    { contact: 2000, support: 0, height: 10 },
    { contact: 100, support: 0, height: 10 },
  ];
  const rows = [
    { family: 'f1', candidates: cands, expertSet: new Set([0]), weight: 1 },
    { family: 'f1', candidates: cands.map((c) => ({ ...c })), expertSet: new Set([1]), weight: 0.35 },
  ];
  // 接触最大化策略 → 选中 idx 0（contact 2000）
  const ev = fitter.evaluateRows(rows, { weights: { contact: 1, support: 0, height: 0 }, minContactRatio: 0 });
  assert.ok(near(ev.accuracy, 1 / 1.35, 1e-9), `accuracy=${ev.accuracy}`);
  assert.ok(near(ev.weightSum, 1.35, 1e-9));
  assert.strictEqual(ev.total, 2);
});

// ---- trainingStore：用隔离环境测回填（TRAINING_SAMPLES_FILE 指向临时文件） ----
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'feat-labels-'));
process.env.TRAINING_SAMPLES_FILE = path.join(tmpDir, 'samples.json');
process.env.TRAINING_FILES_DIR = path.join(tmpDir, 'files');
const trainingStore = require('../src/services/trainingStore');

ok('setOrientationBySource：无标签时回填 auto-confirmed', () => {
  const s = trainingStore.create({ createdBy: 't', selection: { temp_class: 't50' }, model: { features: null, originalName: 'a.step' }, slice: null });
  const r = trainingStore.setOrientationBySource(s.sourceRecordId, { quaternion: [0, 0, 0, 1], source: 'auto-confirmed', note: 'x' });
  assert.ok(r && r.ok);
  const got = trainingStore.get(s.id);
  assert.strictEqual(got.orientation.source, 'auto-confirmed');
  trainingStore.remove(s.id);
});

ok('setOrientationBySource：placement 强标签不被覆盖', () => {
  const s = trainingStore.create({
    createdBy: 't',
    selection: { temp_class: 't50' },
    placement: [0.7071, 0, 0, 0.7071],
    orientation: { quaternion: [0.7071, 0, 0, 0.7071], source: 'placement' },
    model: { features: null, originalName: 'b.step' }, slice: null,
  });
  const r = trainingStore.setOrientationBySource(s.sourceRecordId, { quaternion: [0, 0, 0, 1], source: 'auto-confirmed' });
  assert.ok(r && r.skipped, '应 skipped 不覆盖');
  assert.strictEqual(trainingStore.get(s.id).orientation.source, 'placement');
  trainingStore.remove(s.id);
});

ok('setSliceStatsBySource：耗时/耗材/机型回填', () => {
  const s = trainingStore.create({ createdBy: 't', selection: { temp_class: 't50' }, model: { features: null, originalName: 'c.step' }, slice: null });
  trainingStore.setSliceStatsBySource(s.sourceRecordId, { estMinutes: 120, actualMinutes: 133.5, filamentGrams: 28.4, machine: 'X1C' });
  const st = trainingStore.get(s.id).sliceStats;
  assert.strictEqual(st.estMinutes, 120);
  assert.ok(near(st.actualMinutes, 133.5));
  assert.strictEqual(st.filamentGrams, 28.4);
  assert.strictEqual(st.machine, 'X1C');
  trainingStore.remove(s.id);
});

ok('setOutcome：failCode 结构化落库', () => {
  const s = trainingStore.create({ createdBy: 't', selection: { temp_class: 't50' }, model: { features: null, originalName: 'd.step' }, slice: null });
  trainingStore.setOutcome(s.id, { status: '失败', issues: 'x', failCode: 70001, recordedBy: 't' });
  assert.strictEqual(trainingStore.get(s.id).outcome.failCode, 70001);
  trainingStore.setOutcome(s.id, { status: '成功', recordedBy: 't' });
  assert.strictEqual(trainingStore.get(s.id).outcome.failCode, null);
  trainingStore.remove(s.id);
});

ok('auditSamples：labelSources 涵盖自举来源', () => {
  const audit = fitter.auditSamples([
    { family: 'a', orientation: { quaternion: [0, 0, 0, 1], source: 'auto-confirmed' } },
    { family: 'b', placement: [0, 0, 0, 1] },
    { family: 'c' },
  ]);
  assert.strictEqual(audit.labeled, 2);
  assert.strictEqual(audit.labelSources['auto-confirmed'], 1);
  assert.strictEqual(audit.labelSources.placement, 1);
});

console.log(`\n特征标签批单测: ${pass} 通过 / ${process.exitCode ? 1 : 0} 失败`);
if (process.exitCode) process.exit(1);
