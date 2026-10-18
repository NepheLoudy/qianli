/**
 * 黄金基准件结构单测（2026-10-18 P0）：fixtures 存在且可解析、几何尺寸符合基准定义
 * 用法：node test/golden-parts-test.js（不跑 Orca；切片回归用 scripts/golden-benchmark.js）
 */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const modelFeatures = require('../src/services/modelFeatures');

const DIR = path.join(__dirname, 'fixtures', 'golden');
const EXPECT = {
  'cube20.stl': { x: 20, y: 20, z: 20 },
  'thinwall.stl': { x: 30, y: 30, z: 1.2 },
  'tower.stl': { x: 20, y: 20, z: 60 },
  'lbeam.stl': { x: 30, y: 30, z: 6 },
};

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

check('基准件齐全（4 件）', () => {
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.stl')).sort();
  assert.deepStrictEqual(files, Object.keys(EXPECT).sort());
});

for (const [file, exp] of Object.entries(EXPECT)) {
  check(`基准件几何：${file}（bbox ${exp.x}×${exp.y}×${exp.z}，闭合网格）`, () => {
    const r = modelFeatures.analyzeStl(fs.readFileSync(path.join(DIR, file)));
    assert.ok(r && r.ok, `${file} 解析应成功`);
    assert.ok(r.mesh && r.mesh.closed, `${file} 应为闭合网格`);
    for (const axis of ['x', 'y', 'z']) {
      assert.ok(Math.abs(Number(r.bbox[axis]) - exp[axis]) < 1e-3, `${file} ${axis} 应为 ${exp[axis]}，实际 ${r.bbox[axis]}`);
    }
  });
}

console.log(`\n黄金基准件结构单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
