/**
 * 模型单自动切片纯函数单测（2026-10-18）：档位解析 / 材料归一 / 份数钳制
 * 用法：node test/auto-slice-test.js（不调 Orca CLI，秒级）
 */
const assert = require('assert');
const { resolveSliceProfiles, normalizeMaterial, clampCopies } = require('../src/services/autoSlice');

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

check('档位解析：P1S/X1C/A1/H2D 各配机器档与工艺档', () => {
  const p1 = resolveSliceProfiles('P1S', 'PLA');
  assert.equal(p1.machine, 'Bambu Lab P1S 0.4 nozzle');
  assert.equal(p1.process, '0.20mm Standard @BBL X1C');
  assert.equal(resolveSliceProfiles('X1C', 'PLA').machine, 'Bambu Lab X1 Carbon 0.4 nozzle');
  assert.equal(resolveSliceProfiles('A1 mini', 'PLA').process, '0.20mm Standard @BBL A1');
  assert.equal(resolveSliceProfiles('H2D', 'PLA').process, '0.20mm Standard @BBL H2D');
});

check('材料归一：CF 档直取、未知材料回落 PLA 并给出提示', () => {
  assert.equal(normalizeMaterial('PETG-CF').profile, 'Bambu PETG-CF @BBL X1C');
  assert.equal(normalizeMaterial('petg').profile, 'Bambu PETG Basic @BBL X1C');
  const unknown = normalizeMaterial('PEEK');
  assert.equal(unknown.profile, 'Bambu PLA Basic @BBL X1C');
  assert.ok(unknown.note.includes('PLA'), '未知材料应有回落提示');
});

check('份数钳制：≥1 且 ≤50', () => {
  assert.equal(clampCopies(0), 1);
  assert.equal(clampCopies(4), 4);
  assert.equal(clampCopies('7'), 7);
  assert.equal(clampCopies(999), 50);
});

check('闪铸机型拒绝自动切片（诚实失败）', () => {
  assert.throws(() => resolveSliceProfiles('Creator 5 Pro', 'PLA'), /仅支持拓竹机型/);
  assert.throws(() => resolveSliceProfiles('AD5M Pro', 'PLA'), /仅支持拓竹机型/);
});

check('未知拓竹机型：无档诚实报错（不静默回退）', () => {
  assert.throws(() => resolveSliceProfiles('Bambu X9', 'PLA'), /没有对应的 Orca 机器档/);
});

console.log(`\n自动切片单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
