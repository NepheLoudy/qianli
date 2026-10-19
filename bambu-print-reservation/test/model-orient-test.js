/**
 * 自动摆向单测（2026-10-19）：24 轴向搜索 / 接触与支撑评分 / keep 与用户放置优先
 * 用法：node test/model-orient-test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const orient = require('../src/services/modelOrient');
const { parseStl } = require('../src/services/modelFeatures');

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

/** 轴对齐盒：底面 z=0，尺寸 w×h×d，外法线朝外 */
function boxMesh(w, h, d) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = 0, z1 = d;
  const v = [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ];
  const faces = [
    [0, 2, 1], [0, 3, 2],       // bottom -Z
    [4, 5, 6], [4, 6, 7],       // top +Z
    [0, 1, 5], [0, 5, 4],       // y0 -Y
    [3, 7, 6], [3, 6, 2],       // y1 +Y
    [0, 4, 7], [0, 7, 3],       // x0 -X
    [1, 2, 6], [1, 6, 5],       // x1 +X
  ];
  const positions = new Float64Array(v.flat());
  const idx = new Uint32Array(faces.flat());
  return { positions, faces: idx, triangles: faces.length, vertices: v.length };
}

check('竖放的 5×20×100 盒：自动摆向放倒为 100×20 底面（接触 100→2000mm²，高 100→5mm）', () => {
  const parsed = boxMesh(5, 20, 100);
  const cur = orient.metricsFor(parsed, orient.IDENTITY);
  assert.ok(Math.abs(cur.contact - 100) < 1, `当前接触应约 100，实际 ${cur.contact}`);
  assert.ok(Math.abs(cur.height - 100) < 1e-6);
  const chosen = orient.chooseOrientation(parsed, { strategy: 'auto' });
  assert.strictEqual(chosen.changed, true, '应判定需要改向');
  assert.ok(chosen.contact > 1900, `改向后接触应 >1900，实际 ${chosen.contact}`);
  assert.ok(Math.abs(chosen.height - 5) < 1e-6, `改向后高应为 5，实际 ${chosen.height}`);
  const applied = orient.normalize(orient.applyOrientation(parsed, chosen));
  const m = orient.metricsFor(applied, orient.IDENTITY);
  assert.ok(m.contact > 1900, `落地后接触应 >1900，实际 ${m.contact}`);
  assert.ok(Math.abs(m.height - 5) < 1e-6, `落地后高应为 5，实际 ${m.height}`);
});

check('directionStrategy=keep：保持原朝向（不自动改向）', () => {
  const parsed = boxMesh(5, 20, 100);
  const chosen = orient.chooseOrientation(parsed, { strategy: 'keep' });
  assert.strictEqual(chosen.changed, false);
  assert.ok(Math.abs(chosen.height - 100) < 1e-6);
});

check('用户放置四元数优先：choose 返回 placement 标记、不再自动改向', () => {
  const parsed = boxMesh(5, 20, 100);
  const chosen = orient.chooseOrientation(parsed, { strategy: 'auto', placement: [0, 0, 0, 1] });
  assert.strictEqual(chosen.placement, true);
  assert.strictEqual(chosen.changed, false);
});

check('四元数旋转（绕 X 90°）：Z 跨度 100→20', () => {
  const parsed = boxMesh(5, 20, 100);
  const s = Math.sin(Math.PI / 4), c = Math.cos(Math.PI / 4);
  const rotated = orient.applyQuaternion(parsed, [s, 0, 0, c]);
  const m = orient.metricsFor(rotated, orient.IDENTITY);
  assert.ok(Math.abs(m.height - 20) < 1e-6, `绕 X 90° 后高度应为 20，实际 ${m.height}`);
});

check('writeBinaryStl → parseStl 往返：三角数与摆向后的高度一致', () => {
  const parsed = boxMesh(5, 20, 100);
  const chosen = orient.chooseOrientation(parsed, { strategy: 'auto' });
  const applied = orient.normalize(orient.applyOrientation(parsed, chosen));
  const out = path.join(os.tmpdir(), `orient-test-${process.pid}.stl`);
  orient.writeBinaryStl(applied, out);
  const back = parseStl(fs.readFileSync(out));
  fs.unlinkSync(out);
  assert.strictEqual(back.triangles, parsed.triangles);
  const m = orient.metricsFor(back, orient.IDENTITY);
  assert.ok(Math.abs(m.height - 5) < 1e-6, `回读高度应为 5，实际 ${m.height}`);
});

console.log(`\n自动摆向单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
