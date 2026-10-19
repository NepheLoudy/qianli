/**
 * 训练集样本库单测（纯逻辑；存储指向 tmp 防污染）
 * 用法：node test/training-store-test.js
 */
process.env.TRAINING_SAMPLES_FILE = require('os').tmpdir() + `/bambu-test-train-${process.pid}.json`;
process.env.TRAINING_FILES_DIR = require('os').tmpdir() + `/bambu-test-train-files-${process.pid}`;
// 开工清档（2026-10-16）：pid 命名的隔离文件会被 Windows **PID 复用**撞上——旧运行的样本
// 残留叠进本次（曾出现重复样本号 T..-003×2、计数断言 6!=3 的假失败）——启动即删保证真隔离
require('fs').rmSync(process.env.TRAINING_SAMPLES_FILE, { force: true });
require('fs').rmSync(process.env.TRAINING_FILES_DIR, { force: true, recursive: true });
const assert = require('assert');
const store = require('../src/services/trainingStore');

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

const FEATURES = {
  ok: true, triangles: 100, vertices: 60, bbox: { x: 20, y: 20, z: 4 }, volumeCm3: 1.1,
  overhang: { severePct: 0, moderatePct: 0, upperOverhangPct: 0 },
  contact: { areaMm2: 400, footprintPct: 100 }, curvedPct: 0,
  mesh: { closed: true, openEdges: 0, nonManifoldEdges: 0, genus: 0 },
  holes: { count: 0, genusCount: 0, loopCount: 0, radii: [], openMesh: false },
  suggestions: { selection: {}, notes: [] },
};

check('空工况勾选拒收——没有人工标注不构成训练数据', () => {
  assert.throws(() => store.create({ createdBy: 't', selection: {}, model: { originalName: 'a.stl', buffer: Buffer.from('x'), features: FEATURES } }), /工况勾选不能为空/);
});

check('非法工况（池外字段）按 taxonomy 校验拒收', () => {
  assert.throws(() => store.create({ createdBy: 't', selection: { nope_field: true }, model: { originalName: 'a.stl', buffer: Buffer.from('x'), features: FEATURES } }), /未知需求标签/);
});

check('正常录入：id 递增、选择与特征与切片参数三方合成', () => {
  const s1 = store.create({
    createdBy: '曼波', notes: '测试样本',
    selection: { hole_comp_z: true, load_direction: ['Z'] },
    orientation: { quaternion: [0, 0, 0, 1], source: 'placement' },
    model: { originalName: 'part.stl', buffer: Buffer.from('model-data'), features: FEATURES },
    slice: { originalName: 'part.gcode.3mf', buffer: Buffer.from('slice-data'), extraction: { source: 'gcode', params: { layerHeight: 0.2 }, diff: { layerHeight: 0.2 }, estMinutes: 30 } },
  });
  assert.ok(/^T\d{8}-001$/.test(s1.id), `id 格式应 T日期-序号，实际 ${s1.id}`);
  assert.equal(s1.selection.hole_comp_z, true);
  assert.equal(s1.model.features.ok, true);
  assert.equal(s1.slice.extraction.estMinutes, 30);
  assert.deepEqual(s1.orientation, { quaternion: [0, 0, 0, 1], source: 'placement', note: '' });
  assert.equal(s1.createdBy, '曼波');
  // 归档文件落盘
  const fs = require('fs');
  assert.ok(fs.existsSync(s1.model.storedPath), '模型文件应归档');
  assert.ok(fs.existsSync(s1.slice.storedPath), '切片文件应归档');
  // 同日第二条序号递增
  const s2 = store.create({ createdBy: 't', selection: { appearance: true }, model: { originalName: 'b.stl', buffer: Buffer.from('y'), features: FEATURES } });
  assert.ok(/-002$/.test(s2.id), `同日第二条应 -002，实际 ${s2.id}`);
});

check('模型分析失败（features=null）不阻塞录入——负样本也是数据', () => {
  const s = store.create({ createdBy: 't', selection: { repeated_assembly: true }, model: { originalName: 'c.stl', buffer: Buffer.from('z'), features: null } });
  assert.equal(s.model.features, null);
  assert.equal(s.autoSuggestion, null);
});

check('list 倒序 + get + stats 覆盖统计', () => {
  const list = store.list();
  assert.equal(list.length, 3);
  assert.ok(/-003$/.test(list[0].id), 'list 应按新→旧');
  assert.ok(store.get(list[0].id));
  const stats = store.stats();
  assert.equal(stats.total, 3);
  assert.equal(stats.withSlice, 1);
  assert.equal(stats.withFeatures, 2, '第三条 features=null 不计入 withFeatures');
  assert.equal(stats.conditionCoverage.hole_comp_z, 1);
});

check('remove 删除样本（归档文件保留）', () => {
  const list = store.list();
  const victim = list[list.length - 1];
  const removed = store.remove(victim.id);
  assert.equal(removed.id, victim.id);
  assert.throws(() => store.remove(victim.id), /不存在/);
  const fs = require('fs');
  assert.ok(fs.existsSync(victim.model.storedPath), '删除索引不应删除归档文件');
  assert.equal(store.list().length, 2);
});

check('outcome 回填：合法状态入库、非法状态拒收', () => {
  const s = store.create({ createdBy: 't', selection: { hole_comp_z: true }, model: { originalName: 'o.stl', buffer: Buffer.from('o'), features: FEATURES } });
  const updated = store.setOutcome(s.id, { status: '失败', issues: '支撑翻车' });
  assert.equal(updated.outcome.status, '失败');
  assert.equal(updated.outcome.issues, '支撑翻车');
  assert.ok(updated.outcome.recordedAt);
  assert.throws(() => store.setOutcome(s.id, { status: '完美' }), /未打印\/成功\/失败/);
  assert.equal(store.setOutcome(s.id, { status: '成功' }).outcome.status, '成功');
  const stats = store.stats();
  assert.equal(stats.withOutcome, 1, '成功计入 withOutcome，未打印不计');
});

check('dumpJsonl：一行一样本，含 outcome 奖励通道与三方字段', () => {
  const jsonl = store.dumpJsonl();
  const lines = jsonl.trim().split('\n');
  assert.equal(lines.length, store.list().length);
  const row = JSON.parse(lines[lines.length - 1]);
  assert.ok(row.selection && row.outcome, '选择与 outcome 必在');
  assert.ok('expertParams' in row && 'modelFeatures' in row && 'autoSuggestion' in row, '三方字段齐备');
});

check('超限大文件只记元数据不落盘', () => {
  const s = store.create({
    createdBy: 't', selection: { electrical_insulation: true },
    model: { originalName: 'huge.stl', buffer: Buffer.alloc(81 * 1024 * 1024), features: FEATURES },
  });
  assert.equal(s.model.tooLargeToArchive, true);
  assert.equal(s.model.storedPath, null);
});

console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败（共 ${passed + failures} 项）`);
process.exit(failures === 0 ? 0 : 1);
