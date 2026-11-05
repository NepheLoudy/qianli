/**
 * 切片件自动选机单测（2026-11-05 H2D 失联实案修复批）。
 *
 * 背景：R20261105-003（H2D 件）自动分发时 H2D 掉线，v65 品牌族降级选中 A1mini，
 * 随后被 approveReservation 的跨型号硬校验拒掉 → 静默转人工，用户白等两小时。
 * 本测试锁死修复后的契约：无同型号机 → 不降级、返回结构化原因（name=null +
 * noSameModel），让提交链能播报「为什么没打」。
 *
 * 用法：node test/machine-pick-test.js
 * 纯函数测试：chooseMachineForSliced 只收参数数组，零 IO、零 env。
 */
const assert = require('assert');
const { chooseMachineForSliced } = require('../src/services/machineLearning');

let pass = 0;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

const P = (name, model, status = '空闲') => ({ name, model, status });

// ---------- ① 同型号优先（回归保护，行为不得变） ----------

check('同型号唯一：直接选中并标注唯一', () => {
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('H2D', 'H2D'), P('A1mini', 'A1 mini')], []);
  assert.strictEqual(r.name, 'H2D');
  assert.strictEqual(r.lowConfidence, false);
  assert.ok(/唯一/.test(r.basis), r.basis);
});

check('同型号多台：按历史成功率择优', () => {
  const recs = [
    { printer: 'X1C-a', history: [{ to: '已完成' }] },
    { printer: 'X1C-b', history: [{ to: '已完成' }] },
    { printer: 'X1C-b', history: [{ to: '已取消', note: '失败重排' }] },
  ];
  const r = chooseMachineForSliced('Bambu Lab X1C', [P('X1C-b', 'X1C'), P('X1C-a', 'X1C')], recs);
  assert.strictEqual(r.name, 'X1C-a', '成功率 100% 的 X1C-a 应胜出');
  assert.ok(/择优/.test(r.basis), r.basis);
});

// ---------- ② 无同型号：不再降级（本次修复核心） ----------

check('无同型号（H2D 掉线，只剩 A1mini）：不降级，返回 noSameModel', () => {
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('A1mini', 'A1 mini')], []);
  assert.strictEqual(r.name, null, '不得选中跨型号机——否则必被硬校验拒掉');
  assert.strictEqual(r.noSameModel, true);
  assert.strictEqual(r.machineModel, 'Bambu Lab H2D');
  assert.deepStrictEqual(r.brandCandidates, ['A1mini'], '同品牌候选应如实回传供播报');
});

check('无同型号时 basis 文案说明「跨型号不兼容、不做降级」', () => {
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('A1mini', 'A1 mini')], []);
  assert.ok(/不做降级/.test(r.basis), `文案应说清不做降级: ${r.basis}`);
  assert.ok(/Bambu Lab H2D/.test(r.basis), '文案应带内嵌机型');
});

check('无同型号：修复前会选中的机器名绝不出现在 name 上（回归锚）', () => {
  // 旧实现返回 { name:'A1mini', basis:'…降级到 A1mini…' }——本断言锁死不回潮
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('A1mini', 'A1 mini'), P('P1S', 'P1S')], []);
  assert.notStrictEqual(r.name, 'A1mini');
  assert.notStrictEqual(r.name, 'P1S');
});

// ---------- ③ 边界 ----------

check('候选机队为空：返回 null（调用方报 noCandidate）', () => {
  assert.strictEqual(chooseMachineForSliced('Bambu Lab H2D', [], []), null);
  assert.strictEqual(chooseMachineForSliced('Bambu Lab H2D', null, []), null);
});

check('跨品牌也算无同型号（H2D 件 + 只有闪铸机）', () => {
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('闪铸A5P', 'AD5M Pro')], []);
  assert.strictEqual(r.name, null);
  assert.strictEqual(r.noSameModel, true);
  assert.deepStrictEqual(r.brandCandidates, [], '异品牌不进同品牌候选');
});

check('前缀互吞仍算同型号（H2D-CFS 变体不被误判为无同型号）', () => {
  const r = chooseMachineForSliced('Bambu Lab H2D', [P('H2D', 'H2D-CFS')], []);
  assert.strictEqual(r.name, 'H2D', '前缀互吞口径应命中');
});

console.log(`\n切片件自动选机单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
