/**
 * 多模型↔切片匹配单测（v75）：明晰配对/打乱顺序/歧义检测/部分切片/贪心路径
 * 用法：node test/multi-model-match-test.js
 */
const assert = require('assert');
const { matchModels } = require('../src/services/multiModelMatch');

let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.error('✗ ' + name + ' — ' + e.message); } }

check('明晰两件：切片顺序打乱仍各归其位且低歧义', () => {
  const slice = [
    { bboxVolCm3: 5.4, triangles: 300, holeCount: 0, overhangSeverePct: 4 },
    { bboxVolCm3: 1.1, triangles: 80, holeCount: 2, overhangSeverePct: 12 },
  ];
  const models = [
    { bboxVolCm3: 1.1, triangles: 90, holeCount: 2, overhangSeverePct: 10 },
    { bboxVolCm3: 5.4, triangles: 320, holeCount: 0, overhangSeverePct: 3 },
  ];
  const r = matchModels(slice, models);
  const byModel = new Map(r.pairs.map((p) => [p.modelIdx, p.sliceIdx]));
  assert.strictEqual(byModel.get(0), 1, 'thinwall(模型0) ↔ slice1');
  assert.strictEqual(byModel.get(1), 0, 'lbeam(模型1) ↔ slice0');
  assert.ok(r.pairs.every((p) => !p.lowConfidence), '明晰配对不应标歧义');
});

check('歧义三件（特征几乎同貌）：全部标 lowConfidence', () => {
  const sigs = Array.from({ length: 3 }, (_, i) => ({ bboxVolCm3: 10 + i * 0.1, triangles: 200 + i * 5, holeCount: 1, overhangSeverePct: 5 }));
  const r = matchModels(sigs, sigs);
  assert.ok(r.pairs.every((p) => p.lowConfidence), '次优替代差 <0.05 应全标歧义');
});

check('模型多于切片 object：多余模型进 unpairedModels', () => {
  const slice = [{ bboxVolCm3: 5.4, triangles: 300, holeCount: 0, overhangSeverePct: 4 }];
  const models = [
    { bboxVolCm3: 5.4, triangles: 320, holeCount: 0, overhangSeverePct: 3 },
    { bboxVolCm3: 1.1, triangles: 90, holeCount: 2, overhangSeverePct: 10 },
  ];
  const r = matchModels(slice, models);
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.pairs[0].modelIdx, 0, '应配对到 lbeam');
  assert.deepStrictEqual(r.unpairedModels, [1], 'thinwall 未被切 → unpaired');
});

check('贪心路径（>8 对）：数量配满且无重复模型', () => {
  const sigs = Array.from({ length: 10 }, (_, i) => ({ bboxVolCm3: 5 + i, triangles: 100 + i * 30, holeCount: i % 3, overhangSeverePct: i * 2 }));
  const shuffled = sigs.slice().reverse();
  const r = matchModels(sigs, shuffled);
  assert.strictEqual(r.pairs.length, 10);
  const models = new Set(r.pairs.map((p) => p.modelIdx));
  assert.strictEqual(models.size, 10, 'model 无重复配对');
});

check('单件 1:1：配对唯一', () => {
  const r = matchModels([{ bboxVolCm3: 3, triangles: 120, holeCount: 0, overhangSeverePct: 2 }], [{ bboxVolCm3: 3.1, triangles: 125, holeCount: 0, overhangSeverePct: 2 }]);
  assert.strictEqual(r.pairs.length, 1);
  assert.strictEqual(r.unpairedModels.length, 0);
});

check('贪心非精确配对：已配切片不被更远候选顶替、模型不泄漏（v83 回归）', () => {
  // 场景：s0 最佳 m0（近）、s0 次选 m2；s2 的最佳也是 m2 但更远。
  // 旧贪心无 bySlice.has 防线时：(0,2) 会顶掉更优的 (0,0)——m0 泄漏在 used 里，
  // 配对数缩水到 2、s0 被配到更差模型
  const slice = Array.from({ length: 9 }, (_, i) => ({ bboxVolCm3: 10 + i * 2, triangles: 200 + i * 20, holeCount: 0, overhangSeverePct: 0 }));
  const models = [
    { bboxVolCm3: 10, triangles: 200, holeCount: 0, overhangSeverePct: 0 },   // s0 精确匹配
    { bboxVolCm3: 12, triangles: 220, holeCount: 0, overhangSeverePct: 0 },   // s1 精确匹配
    { bboxVolCm3: 14, triangles: 260, holeCount: 0, overhangSeverePct: 0 },   // s0 次选 / s2 最佳
  ];
  const r = matchModels(slice, models);
  assert.strictEqual(r.pairs.length, 3, '3 个模型应全部配出（无模型泄漏）');
  const used = new Set(r.pairs.map((p) => p.modelIdx));
  assert.strictEqual(used.size, 3, 'model 无重复配对');
  const bySlice = new Map(r.pairs.map((p) => [p.sliceIdx, p.modelIdx]));
  assert.strictEqual(bySlice.get(0), 0, 's0 应保持最优配对 m0，不被 (0,2) 顶替');
  assert.strictEqual(bySlice.get(2), 2, 's2 应配到其最佳 m2');
});

check('排列预算护栏：8 切片×12 模型瞬时完成（v83 回归，旧版按切片数放行 12!/4! 级枚举）', () => {
  const slice = Array.from({ length: 8 }, (_, i) => ({ bboxVolCm3: 3 + i, triangles: 150 + i * 25, holeCount: 0, overhangSeverePct: 0 }));
  const models = Array.from({ length: 12 }, (_, i) => ({ bboxVolCm3: 3 + (i % 8), triangles: 150 + (i % 8) * 25, holeCount: 0, overhangSeverePct: 0 }));
  const t0 = Date.now();
  const r = matchModels(slice, models);
  assert.ok(Date.now() - t0 < 2000, `应在毫秒级完成，实耗 ${Date.now() - t0}ms`);
  assert.strictEqual(r.pairs.length, 8, '8 个切片全部配对');
  assert.strictEqual(new Set(r.pairs.map((p) => p.modelIdx)).size, 8);
});

check('切片侧孔/悬垂未知：距离不再惩罚有孔/悬垂模型（v83）', () => {
  const { distance, signature } = require('../src/services/multiModelMatch');
  const sliceSig = signature(5.4, 300, 0, 0, { holesKnown: false, overhangKnown: false });
  const holedModel = signature(5.4, 300, 3, 40);
  const plainModel = signature(5.4, 300, 0, 0);
  assert.ok(
    Math.abs(distance(sliceSig, holedModel) - distance(sliceSig, plainModel)) < 1e-9,
    '孔/悬垂未知时两模型距离应只由体积/三角数决定',
  );
  const knownSlice = signature(5.4, 300, 0, 0);
  assert.ok(distance(knownSlice, holedModel) > distance(knownSlice, plainModel), '两侧都已知时有孔模型距离更远（原语义保持）');
});

console.log(`\n多模型匹配单测: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
