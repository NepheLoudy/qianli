/**
 * 规则种子增量同步单测（2026-10-18 P0 框架）：文件缺内置自动补 / 墓碑不复活 /
 * 手动编辑同 id 保留 / 删除内置落墓碑 / reset 清墓碑回全量
 * 用法：node test/rules-seed-sync-test.js
 */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

process.env.PROCESS_RULES_FILE = path.join(os.tmpdir(), `bambu-test-seedsync-${process.pid}.json`);
// 预置「旧文件」：一条人工编辑过的内置（z-load-orient）+ 一条自定义 + impact-tough 墓碑
fs.writeFileSync(process.env.PROCESS_RULES_FILE, JSON.stringify({
  savedAt: '2026-01-01T00:00:00.000Z',
  rules: [
    { id: 'z-load-orient', priority: 10, when: { load_direction: ['Z'] }, set: { wallLoops: 4 }, reason: '人工改过的内置规则', builtin: true },
    { id: 'custom-x', priority: 5, when: { load_magnitude: ['light'] }, set: { infillDensity: 15 }, reason: '自定义规则示例', builtin: false },
  ],
  removedBuiltins: ['impact-tough'],
}));

const pr = require('../src/services/processRules');

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

check('文件缺的内置种子自动补入（新增种子能到线上），自定义保留', () => {
  const ids = pr.getRulesSnapshot().rules.map((r) => r.id);
  assert.ok(ids.includes('custom-x'), '自定义规则保留');
  assert.ok(ids.includes('trait-self-lubricating'), '代码新增内置补齐');
  assert.ok(ids.includes('trait-fiber-reinforced'), '代码新增内置补齐（第二条）');
});

check('墓碑保护：被删除的内置规则不复活', () => {
  const ids = pr.getRulesSnapshot().rules.map((r) => r.id);
  assert.ok(!ids.includes('impact-tough'), 'impact-tough 在墓碑中应缺席');
});

check('同 id 人工编辑优先（种子不覆盖文件版本）', () => {
  const z = pr.getRulesSnapshot().rules.find((r) => r.id === 'z-load-orient');
  assert.equal(z.set.wallLoops, 4, '文件里的编辑版应保留');
});

check('删除内置 → 墓碑落盘；reset → 清墓碑回全量种子', () => {
  assert.equal(pr.removeRule('trait-wear-resistant').ok, true);
  let saved = JSON.parse(fs.readFileSync(process.env.PROCESS_RULES_FILE, 'utf8'));
  assert.ok((saved.removedBuiltins || []).includes('trait-wear-resistant'), '删除内置应记墓碑');
  assert.equal(pr.resetRules().ok, true);
  saved = JSON.parse(fs.readFileSync(process.env.PROCESS_RULES_FILE, 'utf8'));
  assert.ok(!(saved.removedBuiltins || []).includes('trait-wear-resistant'), 'reset 应清墓碑');
  assert.ok(saved.rules.some((r) => r.id === 'trait-wear-resistant'), 'reset 应回全量内置种子');
  assert.ok(!saved.rules.some((r) => r.id === 'custom-x'), 'reset 后自定义规则清空（出厂语义）');
});

fs.unlinkSync(process.env.PROCESS_RULES_FILE);
console.log(`\n规则种子同步单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
