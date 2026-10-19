/**
 * 学习链路单测（建议待审池聚合/采纳转正 + 3mf 参数提取）
 * 用法：node test/learning-loop-test.js
 */
process.env.PROCESS_RULES_FILE = require('os').tmpdir() + `/bambu-test-rules-${process.pid}.json`;
process.env.RULE_SUGGESTIONS_FILE = require('os').tmpdir() + `/bambu-test-sug-${process.pid}.json`;
process.env.AUTH_STORE_FILE = require('os').tmpdir() + `/bambu-test-auth-${process.pid}.json`;
const assert = require('assert');
const fs = require('fs');
const AdmZip = require('adm-zip');
const ruleSuggestions = require('../src/services/ruleSuggestions');
const processRules = require('../src/services/processRules');
const { extractFrom3mf } = require('../src/services/slicerExtract');

let failures = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- 建议待审池 ----------

check('提交建议入池（pending）', () => {
  const r = ruleSuggestions.add({
    when: { load_magnitude: 'heavy' },
    set: { infillDensity: 70 },
    reason: '重载件实测 60% 填充不够，建议 70%',
    source: 'correction',
    sourceRef: 'R20261005-001',
    suggestedBy: '测试审批人',
  });
  assert.equal(r.merged, false);
  assert.equal(r.suggestion.status, 'pending');
});

check('相同 when+set 自动聚合 count+1（审核负担不随修正次数增长）', () => {
  const r = ruleSuggestions.add({
    when: { load_magnitude: 'heavy' },
    set: { infillDensity: 70 },
    reason: '又遇到同样的情况',
    source: 'correction',
    sourceRef: 'R20261005-002',
    suggestedBy: '另一位审批人',
  });
  assert.equal(r.merged, true);
  assert.equal(r.suggestion.count, 2);
  assert.ok(r.suggestion.sourceRefs.includes('R20261005-002'), '来源单号应累计');
});

check('不同 set 不合并（各自成候选）', () => {
  const r = ruleSuggestions.add({ when: { load_magnitude: 'heavy' }, set: { infillDensity: 80 }, reason: '另一种档位' });
  assert.equal(r.merged, false);
});

check('校验闸门：白名单外参数 / 池外字段 / 缺理由被拒', () => {
  assert.throws(() => ruleSuggestions.add({ when: { load_magnitude: ['light'] }, set: { nozzleDiameter: 0.4 }, reason: '测试' }), /白名单外/);
  assert.throws(() => ruleSuggestions.add({ when: { nope: ['x'] }, set: { wallLoops: 2 }, reason: '测试' }), /池外字段|应为非空数组/);
  assert.throws(() => ruleSuggestions.add({ when: { load_magnitude: ['light'] }, set: { wallLoops: 2 }, reason: '' }), /reason/);
});

check('采纳转正：pending → 生效规则，applyRules 立即体现', () => {
  const pendingList = ruleSuggestions.list('pending');
  const target = pendingList.find((s) => s.set.infillDensity === 70);
  const s = ruleSuggestions.adopt(target.id, '测试管理员', 150);
  assert.equal(s.status, 'adopted');
  assert.equal(s.ruleId, `sug-${target.key}`);
  const applied = processRules.applyRules({ load_magnitude: 'heavy' });
  assert.equal(applied.params.infillDensity, 70, '采纳后 applyRules 应命中新规则（priority 150 后应用）');
  assert.throws(() => ruleSuggestions.adopt(target.id, '测试管理员'), /不可重复处理/, '重复采纳被拒');
});

check('拒绝：pending → rejected', () => {
  const target = ruleSuggestions.list('pending').find((s) => s.set.infillDensity === 80);
  const s = ruleSuggestions.reject(target.id, '测试管理员');
  assert.equal(s.status, 'rejected');
  assert.throws(() => ruleSuggestions.reject(target.id, '测试管理员'), /不可重复处理/);
});

check('采纳后同 when+set 再提交：新建议独立 id 可再采纳（2026-10-08 撞 id 修复回归）', () => {
  // 采纳 infillDensity 70 的建议后，同组合再提一条——旧实现 id 固定 sug-<key>，
  // 与已采纳条目撞车，adopt 的 find 永远命中旧条目报「不可重复处理」，新建议成死单
  const re = ruleSuggestions.add({ when: { load_magnitude: 'heavy' }, set: { infillDensity: 70 }, reason: '同组合再次修正', suggestedBy: '第三人' });
  assert.equal(re.merged, false, '已采纳的聚合键不再合并，应生成新建议');
  assert.notEqual(re.suggestion.id, `sug-${re.suggestion.key}`, '建议 id 不应复用聚合 key');
  const re2 = ruleSuggestions.adopt(re.suggestion.id, '测试管理员', 155);
  assert.equal(re2.status, 'adopted', '新建议应可正常采纳');
});

// ---------- 3mf 参数提取 ----------

/** 构造 Bambu 风格 3mf（zip + project_settings.config） */
function make3mf(settings) {
  const zip = new AdmZip();
  zip.addFile('3D/Objects/model.model', Buffer.from('<model/>'));
  zip.addFile('Metadata/model_settings.config', Buffer.from('<config/>'));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify(settings)));
  return zip.toBuffer();
}

check('提取：project_settings.config → 参数映射（含 %/枚举清洗）', () => {
  const buf = make3mf({
    layer_height: '0.16',
    wall_loops: '4',
    sparse_infill_density: '65%',
    sparse_infill_pattern: 'gyroid',
    seam_position: 'back',
    supportFillet: '0', // 未映射键应被忽略
  });
  const r = extractFrom3mf(buf);
  assert.equal(r.source, 'project_settings');
  assert.equal(r.params.layerHeight, 0.16);
  assert.equal(r.params.wallLoops, 4);
  assert.equal(r.params.infillDensity, 65);
  assert.equal(r.params.infillPattern, 'gyroid');
  assert.equal(r.params.seamPosition, 'hidden');
  assert.ok(!('supportFillet' in r.params), '白名单外键不应出现');
});

check('ironing_type "no ironing"（Orca 2.4 关闭值）→ false，不再把默认关闭误判为开启', () => {
  assert.equal(extractFrom3mf(make3mf({ ironing_type: 'no ironing' })).params.ironing, 'false');
  assert.equal(extractFrom3mf(make3mf({ ironing_type: 'none' })).params.ironing, 'false');
  assert.equal(extractFrom3mf(make3mf({ ironing_type: 'top' })).params.ironing, 'true');
});

check('diff：与 baseline 有差异的参数进候选草稿，无差异不进', () => {
  const buf = make3mf({ layer_height: '0.2', wall_loops: '2', sparse_infill_density: '20%', sparse_infill_pattern: 'cubic' }); // = baseline
  const r = extractFrom3mf(buf);
  assert.deepEqual(r.diff, {}, '全等于 baseline 时 diff 为空');
  const buf2 = make3mf({ layer_height: '0.12' });
  const r2 = extractFrom3mf(buf2);
  assert.deepEqual(r2.diff, { layerHeight: 0.12 });
});

check('提取结果可直接过建议校验并入池（extraction 来源）', () => {
  const r2 = extractFrom3mf(make3mf({ layer_height: '0.12' }));
  const sug = ruleSuggestions.add({
    when: { appearance: true },
    set: r2.diff,
    reason: '专家作品提取：外壳件.gmf',
    source: 'extraction',
    sourceRef: '外壳件.gmf',
  });
  assert.equal(sug.merged, false);
  assert.equal(sug.suggestion.source, 'extraction');
});

check('损坏 3mf → 明确报错（不静默）', () => {
  assert.throws(() => extractFrom3mf(Buffer.from('not a zip')), /解析失败|zip|end of data|central directory/i);
});

// ---------- 收尾 ----------
try { fs.unlinkSync(process.env.RULE_SUGGESTIONS_FILE); } catch { /* 无则跳过 */ }
try { fs.unlinkSync(process.env.AUTH_STORE_FILE); } catch { /* 无则跳过 */ }
processRules.resetRules(); // 采纳转正改了全局规则集，恢复出厂种子

console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
