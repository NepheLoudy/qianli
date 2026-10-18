#!/usr/bin/env node
// ============================================================
// 黄金模型基准件生成器（2026-10-18 P0 框架）：用几何基元拼出固定测试集——
//   cube20    20×20×20 立方（基础体/盘面中心）
//   thinwall  30×30×1.2 薄板（最薄层/翘曲）
//   tower     20×20×60 高塔（高 Z/时间）
//   lbeam     L 形挤出件（悬挑/支撑阈值）
// 单材质、可复现（每次生成同字节），供 golden-benchmark 做切片回归：
//   node scripts/make-golden-parts.js [输出目录=test/fixtures/golden]
// ============================================================
const fs = require('fs');
const path = require('path');

/** 闭合多边形（CCW）沿 Z 挤出为封闭 STL（二进制） */
function extrudePolygon(points, height) {
  const tris = [];
  const n = points.length;
  const idx = (i) => points[i % n];
  for (let i = 1; i + 1 < n; i++) {
    tris.push([[...idx(0), 0], [...idx(i + 1), 0], [...idx(i), 0]]); // 底盖（-Z 绕行）
    tris.push([[...idx(0), height], [...idx(i), height], [...idx(i + 1), height]]); // 顶盖（+Z）
  }
  for (let i = 0; i < n; i++) {
    const a = idx(i), b = idx(i + 1);
    tris.push([[...a, 0], [...b, 0], [...b, height]]);
    tris.push([[...a, 0], [...b, height], [...a, height]]);
  }
  return tris; // 每个三角 = [[x,y,z]×3]
}

/** 二进制 STL 写出 */
function writeStl(file, tris) {
  const buf = Buffer.alloc(84 + 50 * tris.length);
  buf.writeUInt32LE(tris.length, 80);
  tris.forEach((t, i) => {
    const off = 84 + i * 50;
    const [a, b, c] = t;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n.forEach((v, j) => buf.writeFloatLE(v / l, off + j * 4));
    t.forEach((p, j) => p.forEach((v, k) => buf.writeFloatLE(v, off + 12 + j * 12 + k * 4)));
  });
  fs.writeFileSync(file, buf);
  return buf.length;
}

const SQUARE = (s) => [[0, 0], [s, 0], [s, s], [0, s]];
const L_PROFILE = [[0, 0], [30, 0], [30, 8], [8, 8], [8, 30], [0, 30]];
const FIXTURES = [
  { name: 'cube20.stl', tris: extrudePolygon(SQUARE(20), 20) },
  { name: 'thinwall.stl', tris: extrudePolygon(SQUARE(30), 1.2) },
  { name: 'tower.stl', tris: extrudePolygon(SQUARE(20), 60) },
  { name: 'lbeam.stl', tris: extrudePolygon(L_PROFILE, 6) },
];

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test', 'fixtures', 'golden'));
fs.mkdirSync(outDir, { recursive: true });
for (const f of FIXTURES) {
  const size = writeStl(path.join(outDir, f.name), f.tris);
  console.log(`✓ ${f.name}（${f.tris.length} 三角，${size}B）`);
}
console.log(`黄金基准件已生成 → ${outDir}`);
