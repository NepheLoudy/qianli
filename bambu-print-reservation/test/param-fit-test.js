/**
 * 参数拟合度单测（2026-10-12 曼波纠正置信度语义后新增）
 * 用法：node test/param-fit-test.js
 */
const assert = require('assert');
const { compare, memorizable, normalize } = require('../src/services/paramFit');
const processRules = require('../src/services/processRules');

let failures = 0;
let passed = 0;
function check(name, fn) {
  try { fn(); passed++; console.log(`✓ ${name}`); } catch (err) { failures++; console.error(`✗ ${name} — ${err.message}`); }
}

check('值归一化：百分比/布尔/数值精度', () => {
  assert.equal(normalize('15%'), '15');
  assert.equal(normalize('15'), '15');
  assert.equal(normalize('true'), 'true');
  assert.equal(normalize('True'), 'true');
  assert.equal(normalize(0.15), '0.15');
  assert.equal(normalize(['A', 'B']), 'A|B');
});

check('全吻合 = 拟合 100%', () => {
  const engine = { layerHeight: 0.2, wallLoops: 2, xyHoleComp: -0.1 };
  const expert = { layerHeight: '0.2', wallLoops: '2', xyHoleComp: '-0.1' };
  const fit = compare(engine, expert);
  assert.equal(fit.score, 100);
  assert.equal(fit.mismatches, 0);
});

check('差异检出：引擎没覆盖的键 = 可记忆参数', () => {
  const engine = { layerHeight: 0.2, wallLoops: 2 };
  const expert = { layerHeight: 0.16, wallLoops: 2, supportDensity: 30 };
  const fit = compare(engine, expert);
  assert.equal(fit.total, 3);
  assert.equal(fit.matches, 1);
  assert.equal(fit.score, 33);
  const mem = memorizable(fit);
  assert.deepEqual(mem, { layerHeight: 0.16, supportDensity: 30 }, '差异键应进可记忆集合');
  assert.equal(fit.rows[0].match, false, '差异排前');
});

check('口径：只在专家声明的键上评估，引擎多出的键不罚分', () => {
  const fit = compare({ layerHeight: 0.2, wallLoops: 3 }, {});
  assert.equal(fit.total, 0);
  assert.equal(fit.score, null, '专家无声明则拟合度不可评');
  const fit2 = compare({ layerHeight: 0.2, wallLoops: 3, infillDensity: 40 }, { wallLoops: 3 });
  assert.equal(fit2.total, 1, '只评 wallLoops');
  assert.equal(fit2.score, 100, '引擎多出的 infillDensity 不参与');
});

check('真实规则引擎烟测：基线勾选 vs 专家切片 diff 可比较', () => {
  const applied = processRules.applyRules({ hole_comp_z: true, curved_surface: true });
  const expert = { layer_height: '0.2', wall_loops: '2', xy_hole_compensation: '-0.2', support_threshold_angle: '40' };
  const fit = compare(applied.params, {
    layerHeight: expert.layer_height, wallLoops: expert.wall_loops,
    xyHoleComp: expert.xy_hole_compensation, supportThresholdAngle: expert.support_threshold_angle,
  });
  assert.equal(fit.score, 75, '孔补偿 -0.1 vs -0.2 差异应被检出');
  assert.deepEqual(memorizable(fit), { xyHoleComp: '-0.2' }, '仅孔补偿进可记忆集合');
});

// ---------- 拟合度 v2（2026-10-18 P0 框架）：容差/加权/判定 ----------
check('v2：容差内视为通过（舍入噪音不算差异）', () => {
  const fit = compare({ layerHeight: 0.2, xyHoleComp: -0.1 }, { layerHeight: '0.2', xyHoleComp: '-0.102' });
  assert.equal(fit.matches, 2, '0.002 差异在 ±0.005 容差内');
});

check('v2：接近带 nearMiss 单列 + 加权分与判定', () => {
  const fit = compare(
    { layerHeight: 0.2, wallLoops: 2, infillDensity: 40 },
    { layerHeight: 0.16, wallLoops: 2, infillDensity: 42 }
  );
  assert.equal(fit.matches, 1);
  assert.equal(fit.rows.find((r) => r.key === 'layerHeight').nearMiss, true, '0.04 差异落在 near 带');
  assert.equal(fit.rows.find((r) => r.key === 'infillDensity').nearMiss, true, '2% 差异落在 near 带');
  // 权重：layerHeight 2 + wallLoops 2 + infillDensity 2 = 6，通过权重 2 → 33.3%
  assert.equal(fit.weightedScore, 33.3);
  assert.equal(fit.verdict, 'fail');
});

check('v2：全通过 → pass 判定', () => {
  const fit = compare({ layerHeight: 0.2, wallLoops: 3, infillDensity: 40 }, { layerHeight: 0.2, wallLoops: 3, infillDensity: '40%' });
  assert.equal(fit.weightedScore, 100);
  assert.equal(fit.verdict, 'pass');
});

console.log(passed + failures ? '' : '');
console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败（共 ${passed + failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
