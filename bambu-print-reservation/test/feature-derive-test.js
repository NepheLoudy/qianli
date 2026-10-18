/**
 * 特征派生 + 规则拟合单测（纯逻辑，不连打印机/不读写生产文件）。
 * 用法：node test/feature-derive-test.js
 */
const assert = require('assert');
const { deriveFeatures, holeAxis } = require('../src/services/featureDerive');
const { fitRules, median } = require('../src/services/ruleFitter');

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

// ---------- holeAxis：孔轴向判定 ----------
check('Z 向孔判定（法向主分量 Z）', () => {
  assert.strictEqual(holeAxis([0, 0, 1]), 'z');
  assert.strictEqual(holeAxis([0, 0, -1]), 'z');
  assert.strictEqual(holeAxis([0.1, 0.1, 0.98]), 'z');
});
check('水平孔判定（法向 X/Y 为主）', () => {
  assert.strictEqual(holeAxis([1, 0, 0]), 'xy');
  assert.strictEqual(holeAxis([0, 0.9, 0.1]), 'xy');
});

// ---------- deriveFeatures：孔特征 ----------
check('spatial 孔标注 → 轴向分桶 + 孔径统计', () => {
  const spatial = [
    { tool: 'hole_rim', type: 'circle', c: [1, 1, 1], n: [0, 0, 1], r: 1.5 }, // Z 向小孔
    { tool: 'hole_rim', type: 'circle', c: [2, 2, 2], n: [0, 0, 1], r: 3 },
    { tool: 'hole_rim', type: 'circle', c: [3, 3, 3], n: [1, 0, 0], r: 2.5 }, // 水平孔
  ];
  const feat = deriveFeatures(spatial, null, {});
  assert.strictEqual(feat.holes_z, 2);
  assert.strictEqual(feat.holes_xy, 1);
  assert.strictEqual(feat.holes_total, 3);
  assert.strictEqual(feat.holes_min_r, 1.5);
  assert.strictEqual(feat.holes_max_r, 3);
  assert.strictEqual(feat.holes_small, 1); // r<2 只有 1.5
});

check('体检孔与标注孔同径去重（防翻倍）', () => {
  const spatial = [{ tool: 'hole_rim', type: 'circle', c: [1, 1, 1], n: [0, 0, 1], r: 1.5 }];
  const mf = { ok: true, holes: { count: 2, circles: [{ c: [1, 1, 1], n: [0, 0, 1], r: 1.5 }, { c: [9, 9, 9], n: [0, 0, 1], r: 4 }] } };
  const feat = deriveFeatures(spatial, mf, {});
  assert.strictEqual(feat.holes_total, 2, '同径孔去重后总数为 2（1.5 标注+4 体检）');
});

check('无 spatial 有体检 count → 只给总数（无轴向）', () => {
  const feat = deriveFeatures([], { ok: true, holes: { count: 3 } }, {});
  assert.strictEqual(feat.holes_total, 3);
  assert.strictEqual(feat.holes_z, undefined);
});

// ---------- deriveFeatures：标注布尔 + 体检数值 ----------
check('空间标注工具计数 → annot_* 特征', () => {
  const spatial = [
    { tool: 'bending_zone', type: 'axis', a: [0, 0, 0], b: [1, 0, 0], dir: [0, 1, 0] },
    { tool: 'contact_surface', type: 'region', faces: [1, 2], normal: [0, 0, 1] },
    { tool: 'contact_surface', type: 'region', faces: [3], normal: [0, 1, 0] },
    { tool: 'load', type: 'load', loadType: 'bending', pos: [1, 1, 1], dir: [0, 0, -1] },
  ];
  const feat = deriveFeatures(spatial, null, {});
  assert.strictEqual(feat.annot_bending_zone, 1);
  assert.strictEqual(feat.annot_contact_surface, 2);
  assert.strictEqual(feat.has_load_annot, 1);
});

check('载荷标注分桶（方向/类型/性质/量级，2026-10-18 P0）', () => {
  const spatial = [
    { tool: 'load', type: 'load', loadType: 'bending', loadNature: 'fatigue', loadMagnitude: 'heavy', pos: [1, 1, 1], dir: [0, 0, -1] },
    { tool: 'load', type: 'load', loadType: 'compression', loadNature: 'static', loadMagnitude: 'light', pos: [2, 1, 1], dir: [1, 0, 0] },
    { tool: 'load', type: 'load', loadType: 'bending', loadNature: 'static', loadMagnitude: 'medium', pos: [3, 1, 1], dir: [0, 0, 1] },
  ];
  const feat = deriveFeatures(spatial, null, {});
  assert.strictEqual(feat.load_z, 2, '两支竖直载荷');
  assert.strictEqual(feat.load_xy, 1);
  assert.strictEqual(feat.load_type_bending, 2);
  assert.strictEqual(feat.load_type_compression, 1);
  assert.strictEqual(feat.load_nature_fatigue, 1);
  assert.strictEqual(feat.load_mag_heavy, 1);
  assert.strictEqual(feat.load_mag_light, 1);
});

check('体检数值特征直通（悬垂/贴底/曲面/高度）', () => {
  const feat = deriveFeatures([], { ok: true, overhang: { severePct: 12.5, moderatePct: 3 }, contact: { areaMm2: 800, footprintPct: 55 }, curvedPct: 20, mesh: { closed: true }, bbox: { x: 10, y: 10, z: 42 } }, {});
  assert.strictEqual(feat.overhang_severe_pct, 12.5);
  assert.strictEqual(feat.contact_footprint_pct, 55);
  assert.strictEqual(feat.mesh_closed, 1);
  assert.strictEqual(feat.bbox_z, 42);
});

// ---------- ruleFitter ----------
check('median 基础', () => {
  assert.strictEqual(median([1, 3, 2]), 2);
  assert.strictEqual(median([1, 2, 3, 4]), 2.5);
  assert.strictEqual(median([]), null);
});

check('拟合：Z 向孔样本组补偿 +0.2 → 产出候选规则', () => {
  const mk = (holesZ, comp) => ({
    spatial: Array.from({ length: holesZ }, (_, i) => ({ tool: 'hole_rim', type: 'circle', c: [i, 1, 1], n: [0, 0, 1], r: 2 })),
    model: { features: null },
    selection: {},
    slice: { extraction: { params: { xyHoleComp: comp }, diff: { xyHoleComp: comp } } },
  });
  const samples = [mk(1, 0.2), mk(2, 0.2), mk(1, 0.2), mk(0, 0), mk(0, 0), mk(0, 0)];
  const { candidates, stats } = fitRules(deriveFeatures, samples, {});
  assert.strictEqual(stats.samples, 6);
  const hit = candidates.find((c) => c.stats.feature === 'holes_z' && c.stats.param === 'xyHoleComp');
  assert.ok(hit, '应产出 holes_z × xyHoleComp 候选');
  assert.strictEqual(hit.set.xyHoleComp, 0.2);
  assert.strictEqual(hit.when['feat.holes_z'].min, 1);
  assert.ok(hit.reason.includes('样本拟合'));
});

check('拟合：差异不显著不产出（样本组同值）', () => {
  const mk = (holesZ, comp) => ({
    spatial: Array.from({ length: holesZ }, (_, i) => ({ tool: 'hole_rim', type: 'circle', c: [i, 1, 1], n: [0, 0, 1], r: 2 })),
    model: { features: null }, selection: {},
    slice: { extraction: { params: { xyHoleComp: comp }, diff: { xyHoleComp: comp } } },
  });
  const samples = [mk(1, 0.1), mk(2, 0.1), mk(1, 0.1), mk(0, 0.1), mk(0, 0.1), mk(0, 0.1)];
  const { candidates } = fitRules(deriveFeatures, samples, {});
  assert.ok(!candidates.find((c) => c.stats.param === 'xyHoleComp'), '两组同值不应产出');
});

check('拟合：样本不足返回空并注明', () => {
  const { candidates, stats } = fitRules(deriveFeatures, [
    { slice: { extraction: { params: { wallLoops: 4 }, diff: {} } }, spatial: [], selection: {}, model: {} },
  ], {});
  assert.strictEqual(candidates.length, 0);
  assert.ok(String(stats.note).includes('样本不足'));
});

process.exit(failures ? 1 : 0);
