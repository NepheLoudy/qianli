/**
 * 切片 gcode 分层解析单测（2026-10-18 审批台预览 P0）
 * 用法：node test/gcode-layers-test.js
 */
const assert = require('assert');
const { parseGcodeLayers, compactLayers } = require('../src/services/gcodeLayers');

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

check('BBL 风味（CHANGE_LAYER + Z_HEIGHT）：分层/只收挤出段/包围盒', () => {
  const gcode = [
    'G1 X10 Y10 F3000',
    '; CHANGE_LAYER',
    '; Z_HEIGHT: 0.2',
    'G1 X10 Y12 E0.5',   // 挤出段（从 10,10 → 10,12）
    'G1 X12 Y12 E1.0',   // 挤出段
    'G1 X12 Y15',        // 空驶（无 E）→ 不收
    'G1 X12 Y15 E0.2',   // 同点回抽/无位移 → 不收
    '; CHANGE_LAYER',
    '; Z_HEIGHT: 0.4',
    'G1 X20 Y20 E1.0',   // 第一段：起点未知（x=12,y=15）→ 应收 [12,15,20,20]
  ].join('\n');
  const layers = parseGcodeLayers(gcode);
  assert.strictEqual(layers.length, 2);
  assert.strictEqual(layers[0].z, 0.2);
  assert.strictEqual(layers[0].segs.length, 2);
  assert.deepStrictEqual(layers[0].bounds, [10, 10, 12, 12]);
  assert.strictEqual(layers[1].z, 0.4);
  assert.deepStrictEqual(layers[1].segs[0], [12, 15, 20, 20]);
});

check('Prusa 风味（;LAYER_CHANGE + ;Z:）：同样识别', () => {
  const gcode = [';LAYER_CHANGE', ';Z:0.3', 'G1 X0 Y0 E1', 'G1 X5 Y0 E1.2'].join('\n');
  const layers = parseGcodeLayers(gcode);
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].z, 0.3);
  assert.strictEqual(layers[0].segs.length, 1, '首段起点未知（x/y=null）不收，第二段收');
});

check('Bambu 真实数值格式（省略前导零：E.02789 / E-.4）', () => {
  const gcode = [
    '; CHANGE_LAYER', '; Z_HEIGHT: 0.2',
    'G1 X108.833 Y98.126 E.02789', // 无前导零的挤出量（真机 gcode 实锤格式）
    'G1 X110.5 Y98.5 E.5',
    'G1 E-.4 F1800',
  ].join('\n');
  const layers = parseGcodeLayers(gcode);
  assert.strictEqual(layers.length, 1);
  assert.strictEqual(layers[0].segs.length, 1, '首段起点已知（108.833,98.126 → 110.5,98.5）');
  assert.deepStrictEqual(layers[0].segs[0], [108.833, 98.126, 110.5, 98.5]);
});

check('空层丢弃 + 无层标记的文件返回空', () => {
  const gcode = ['; CHANGE_LAYER', '; Z_HEIGHT: 0.2', '; CHANGE_LAYER', '; Z_HEIGHT: 0.4', 'G1 X0 Y0 E1', 'G1 X1 Y0 E1.1'].join('\n');
  const layers = parseGcodeLayers(gcode);
  assert.strictEqual(layers.length, 1, '无挤出段的层被丢弃');
  assert.strictEqual(layers[0].z, 0.4);
  assert.deepStrictEqual(parseGcodeLayers('; nothing here'), []);
});

check('回抽（负 E）与纯空驶不产生段', () => {
  const gcode = ['; CHANGE_LAYER', '; Z_HEIGHT: 0.2', 'G1 X0 Y0 E1', 'G1 X0 Y0 E-1', 'G1 X9 Y9'].join('\n');
  const layers = parseGcodeLayers(gcode);
  assert.strictEqual(layers.length, 0, '只有到点无挤出 → 空层');
});

check('compactLayers：总段数超预算按固定步长抽稀，层数/元数据保留', () => {
  const mk = (i) => ({ i, z: i * 0.2, segs: Array.from({ length: 100 }, (_, k) => [k, k, k + 1, k + 1]), bounds: [0, 0, 99, 99] });
  const layers = [mk(0), mk(1)];
  const out = compactLayers(layers, 10);
  assert.strictEqual(out.length, 2);
  assert.strictEqual(out.reduce((n, l) => n + l.segs.length, 0), 10, '抽稀后总段数不超过预算');
  assert.strictEqual(out[0].z, 0);
  assert.deepStrictEqual(out[1].bounds, [0, 0, 99, 99]);
  assert.strictEqual(compactLayers(layers, 1000), layers, '预算内原样返回');
});

console.log(`\n切片分层解析单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
