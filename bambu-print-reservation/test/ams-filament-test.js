/**
 * 料信息写入纯函数单测（2026-10-17）：拓竹预设解析 + 闪铸调色板校验
 * 用法：node test/ams-filament-test.js
 */
const assert = require('assert');
const { resolveFilamentPreset, BAMBU_FILAMENT_PRESETS } = require('../src/printer/client');
const { normalizeMatlChoice, FILAMENT_MATERIALS, FILAMENT_COLORS } = require('../src/printer/flashforge');

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

check('拓竹预设：大小写/空格/下划线归一', () => {
  assert.deepStrictEqual(resolveFilamentPreset('pla'), { key: 'PLA', idx: 'GFL99', min: 190, max: 230 });
  assert.deepStrictEqual(resolveFilamentPreset('PETG CF'), { key: 'PETG-CF', idx: 'GFG50', min: 240, max: 270 });
  assert.strictEqual(resolveFilamentPreset('pla_cf').idx, 'GFL98');
  assert.strictEqual(resolveFilamentPreset('XYZ'), null, '未知料型必须返回 null（拒绝写入）');
  assert.ok(BAMBU_FILAMENT_PRESETS.PETG, '预设表含 PETG');
});

check('闪铸调色板：料名/颜色精确命中并规范大小写', () => {
  assert.deepStrictEqual(normalizeMatlChoice('petg', '4caaf8'), { mt: 'PETG', rgb: '#4CAAF8' });
  assert.deepStrictEqual(normalizeMatlChoice('PETG-CF', '#1b1b1b'), { mt: 'PETG-CF', rgb: '#1B1B1B' });
});

check('闪铸调色板：非色盘值必须拒绝（防固件静默存成 #FFFFFF）', () => {
  assert.throws(() => normalizeMatlChoice('PETG', '123456'), /不在 Creator 5 调色板/);
  assert.throws(() => normalizeMatlChoice('PETG', '4caaf9'), /不在 Creator 5 调色板/);
  assert.throws(() => normalizeMatlChoice('PLA+', 'FFFFFF'), /不在 Creator 5 调色板/);
});

check('调色板规模：21 料 / 24 色（官方档案）', () => {
  assert.strictEqual(FILAMENT_MATERIALS.length, 21);
  assert.strictEqual(FILAMENT_COLORS.length, 24);
  assert.ok(FILAMENT_COLORS.includes('#4CAAF8') && FILAMENT_COLORS.includes('#1B1B1B'));
});

console.log(`\n料信息写入单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
