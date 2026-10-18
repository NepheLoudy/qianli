/**
 * 工艺映射规则库单测（纯逻辑，不调 API；规则文件指向 tmp 防污染项目根）
 * 用法：node test/process-rules-test.js
 */
process.env.PROCESS_RULES_FILE = require('os').tmpdir() + '/bambu-test-rules-' + process.pid + '.json';
const assert = require('assert');
const {
  BASELINE,
  PARAM_NAMES,
  DEFAULT_RULES,
  validateRule,
  applyRules,
  upsertRule,
  removeRule,
  resetRules,
  getRulesSnapshot,
  rulesVersion,
} = require('../src/services/processRules');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- 种子规则自洽（引用字段/参数必须合法，防规则库写错） ----------

check('出厂种子规则全部通过 validateRule（字段在池内/参数在白名单）', () => {
  for (const rule of DEFAULT_RULES) {
    const problems = validateRule(rule);
    assert.deepEqual(problems, [], `种子规则 ${rule.id} 校验失败: ${problems.join('; ')}`);
  }
});

check('priority 升序应用（fast 200 必须晚于 appearance 100）', () => {
  const ap = DEFAULT_RULES.find((r) => r.id === 'appearance-fine');
  const fast = DEFAULT_RULES.find((r) => r.id === 'fast-mode-coarse');
  assert.ok(ap.priority < fast.priority);
});

// ---------- applyRules 基础 ----------

check('空勾选 → baseline 原样输出，无应用记录', () => {
  const r = applyRules({});
  assert.equal(r.blocked, false);
  assert.deepEqual(r.params, { ...BASELINE, materialExclude: [], materialPrefer: [] });
  assert.deepEqual(r.applied, []);
});

check('Z 向受力 → 改朝向策略 + 层高加密', () => {
  const r = applyRules({ load_direction: ['Z'] });
  assert.equal(r.params.directionStrategy, 'avoid-z-load');
  assert.equal(r.params.layerHeight, 0.16);
  assert.ok(r.applied.some((a) => a.id === 'z-load-orient'));
});

check('多规则叠加：剪切弯曲（墙4+填充40）× 中载（墙3+填充40）→ 后应用优先级高者定稿', () => {
  const r = applyRules({ load_type: ['shear'], load_magnitude: 'medium' });
  // shear-bend-structure(20) 与 load-medium(30) 都设 wallLoops/infillDensity → priority 30 赢
  assert.equal(r.params.wallLoops, 3);
  assert.equal(r.params.infillDensity, 40);
  assert.equal(r.applied.length, 2);
});

check('高速(200) 覆盖外观(100) 的层高——用户显式选快', () => {
  const r = applyRules({ fast_mode: true, appearance: true });
  assert.equal(r.params.layerHeight, 0.28);
  assert.equal(r.params.seamPosition, 'hidden'); // 外观非冲突参数保留
  assert.equal(r.warnings.length, 1); // taxonomy 冲突警告透传
});

check('材料排除：柔顺件 × CF → excluded=true；× PETG 不排除', () => {
  // flexible-vs-cf 为 warn 级（非拦截）——materialVerdict 是引擎端兜底，
  // 服务「材料在表单后/分发链中被人工改过」的场景，用例用非拦截组合
  const soft = { deflection_scale: -2 };
  assert.equal(applyRules(soft, { material: 'PAHT-CF' }).materialVerdict.excluded, true);
  assert.equal(applyRules(soft, { material: 'PETG' }).materialVerdict.excluded, false);
  assert.equal(applyRules({ temp_class: 't80' }, { material: 'PLA' }).blocked, true, 't80 × PLA 硬拦截仍在（v6 收窄后）');
});

check('材料优先：滚压接触 × PAHT → preferred=true', () => {
  const r = applyRules({ load_type: ['contact'] }, { material: 'PAHT' });
  assert.equal(r.materialVerdict.preferred, true);
});

check('taxonomy 硬冲突透传：绝缘 × CF 材料 → blocked', () => {
  const r = applyRules({ electrical_insulation: true }, { material: 'PAHT-CF' });
  assert.equal(r.blocked, true);
  assert.equal(r.params, null);
  assert.match(r.errors[0], /碳纤|CF/);
});

check('multi 字段 when 任一命中（ torsion 单独成规则可触发）', () => {
  const r = applyRules({ load_type: ['torsion', 'bending'] });
  assert.ok(r.applied.some((a) => a.id === 'torsion-gyroid'));
});

check('输出带双版本号（rulesVersion + taxonomyVersion）', () => {
  const r = applyRules({});
  assert.match(r.rulesVersion, /^r-[0-9a-f]{8}$/);
  assert.equal(r.taxonomyVersion, 'v7');
});

// ---------- 写窗口操作 ----------

check('upsert 非法规则被拒（白名单外参数）', () => {
  const r = upsertRule({ id: 'bad', priority: 1, when: { load_magnitude: ['light'] }, set: { nozzleDiameter: 0.4 }, reason: '测试规则完整性' });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /白名单外/.test(e)), `应含白名单外错误，实际: ${r.errors.join('; ')}`);
});

check('upsert 非法规则被拒（池外字段/缺 reason）', () => {
  assert.equal(upsertRule({ id: 'bad2', priority: 1, when: { nope: ['x'] }, set: { wallLoops: 2 }, reason: '测试' }).ok, false);
  assert.equal(upsertRule({ id: 'bad3', priority: 1, when: { load_magnitude: ['light'] }, set: { wallLoops: 2 } }).ok, false);
});

check('upsert 合法规则热生效（下轮 applyRules 立即体现）', () => {
  const r = upsertRule({
    id: 'test-smoke',
    priority: 500,
    when: { humidity_resistant: [true] },
    set: { brim: true },
    reason: '测试规则：湿热提醒底板附着',
  });
  assert.equal(r.ok, true);
  const applied = applyRules({ humidity_resistant: true });
  assert.equal(applied.params.brim, true);
  assert.ok(applied.applied.some((a) => a.id === 'test-smoke'));
});

check('remove 生效 + 不存在报错', () => {
  assert.equal(removeRule('test-smoke').ok, true);
  assert.equal(applyRules({ humidity_resistant: true }).params.brim, false);
  assert.equal(removeRule('test-smoke').ok, false);
});

check('reset 恢复出厂种子', () => {
  upsertRule({ id: 'tmp-rule', priority: 999, when: { load_magnitude: ['light'] }, set: { ironing: true }, reason: '待重置' });
  resetRules();
  assert.equal(applyRules({ load_magnitude: 'light' }).params.ironing, false);
  assert.ok(!getRulesSnapshot().rules.some((r) => r.id === 'tmp-rule'));
});

check('rulesVersion 随规则集内容变化', () => {
  const v1 = rulesVersion();
  upsertRule({ id: 'ver-check', priority: 900, when: { weight_sensitive: [true] }, set: { wallLoops: 5 }, reason: '版本变化验证' });
  const v2 = rulesVersion();
  removeRule('ver-check');
  const v3 = rulesVersion();
  assert.notEqual(v1, v2);
  assert.equal(v1, v3);
});

check('参数细化:外观件规则带顶底壳/支撑阈值/喷嘴Δ(2026-10-05 细化批)', () => {
  const r = applyRules({ appearance: true });
  assert.equal(r.params.topShellLayers, 5);
  assert.equal(r.params.bottomShellLayers, 4);
  assert.equal(r.params.supportThresholdAngle, 45);
  assert.equal(r.params.nozzleTempDelta, 5);
});

check('参数细化:重载档顶底加实,高速档支撑稀疏', () => {
  assert.equal(applyRules({ load_magnitude: 'heavy' }).params.topShellLayers, 5);
  assert.equal(applyRules({ fast_mode: true }).params.supportDensity, 15);
});

check('参数细化:白名单校验范围(topShell/支撑阈值)', () => {
  const bad1 = upsertRule({ id: 'bad-ts', priority: 1, when: { load_magnitude: ['light'] }, set: { topShellLayers: 99 }, reason: '超范围测试' });
  assert.equal(bad1.ok, false);
  const bad2 = upsertRule({ id: 'bad-ang', priority: 1, when: { load_magnitude: ['light'] }, set: { supportThresholdAngle: 5 }, reason: '超范围测试' });
  assert.equal(bad2.ok, false);
});

// ---------- 收缩量标尺已下架（2026-10-10）：规则库不得残留 shrink- 规则 ----------

check('shrink 三条种子规则已随字段一并移除', () => {
  const ids = DEFAULT_RULES.map((r) => r.id);
  assert.ok(!ids.includes('shrink-precision'), 'shrink-precision 应已移除');
  assert.ok(!ids.includes('shrink-negative'), 'shrink-negative 应已移除');
  assert.ok(!ids.includes('shrink-expand'), 'shrink-expand 应已移除');
});

// ---------- 数组参数跨规则并集（2026-10-18 修复） ----------
check('materialExclude/Prefer 跨规则并集（不再后者覆盖前者）', () => {
  // 耐温档排 PLA（priority 40）+ 绝缘排 CF（45）——两条都要生效（temp_class 为 single 字段传标量）
  const r = applyRules({ temp_class: 't80', electrical_insulation: true });
  assert.ok(r.params && r.params.materialExclude.some((x) => /PLA/i.test(x)), '耐温 → 排 PLA 保留');
  assert.ok(r.params && r.params.materialExclude.some((x) => /CF|碳/i.test(x)), '绝缘 → 排 CF 保留');
});

// ---------- 清理 tmp 规则文件 ----------
try { require('fs').unlinkSync(process.env.PROCESS_RULES_FILE); } catch { /* 不存在即可 */ }

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
