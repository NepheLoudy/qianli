/**
 * 几何 DNA 单测（v83 回归）：带孔实例（holesFeature.circles 非空）不再 TypeError、
 * 22 维向量产出——旧版孔实例 map 丢 c/n，⑧ 最小孔周壁段必炸、整个 DNA 被
 * modelFeatures 的 catch 降级为无（带孔件的 DNA 从 v68 起一直是坏的）
 * 用法：node test/geometry-dna-test.js
 */
const assert = require('assert');
const { computeDNA } = require('../src/services/geometryDNA');

let pass = 0, fail = 0;
function check(name, fn) { try { fn(); pass++; console.log('✓ ' + name); } catch (e) { fail++; console.error('✗ ' + name + ' — ' + e.message); } }

/** 立方体网格（12 三角，中心在原点） */
function cubeMesh(size = 20) {
  const h = size / 2;
  const v = [
    [-h, -h, -h], [h, -h, -h], [h, h, -h], [-h, h, -h],
    [-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h],
  ];
  const quads = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [3, 0, 4, 7],
  ];
  const positions = [];
  for (const p of v) positions.push(p[0], p[1], p[2]);
  const faces = [];
  for (const q of quads) faces.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  return { positions: Float64Array.from(positions), faces: Uint32Array.from(faces), triangles: faces.length / 3 };
}

check('带孔实例：computeDNA 不抛错且 22 维向量全有限（v83 回归）', () => {
  const mesh = cubeMesh(20);
  const holesFeature = { circles: [{ c: [0, 0, 10], n: [0, 0, 1], r: 3 }] };
  const dna = computeDNA(mesh, holesFeature);
  assert.ok(dna && Array.isArray(dna.vector), '应产出 DNA 向量');
  assert.strictEqual(dna.vector.length, 22, 'v79 扩维后 22 维');
  dna.vector.forEach((v, i) => {
    assert.ok(v == null || Number.isFinite(Number(v)), `第 ${i} 维应有限，实得 ${v}`);
  });
});

check('无孔网格：DNA 照常产出（孔相关维度空值不炸）', () => {
  const dna = computeDNA(cubeMesh(15), null);
  assert.ok(Array.isArray(dna.vector) && dna.vector.length === 22);
});

console.log(`\n几何 DNA 单测: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
