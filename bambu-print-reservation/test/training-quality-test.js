/**
 * 训练库清洗批单测（2026-11-14 v107 曼波令「素材噪声整理+学习链路迭代」）
 * 覆盖：quality 体系（setQuality 校验/统计）、setOutcome machine 回填、dumpJsonl excluded 过滤、
 *       工程 3mf 入库拒收（reservation.createSampleFromReservation 闸门静态锚）。
 * 用法：node test/stub-test-training-quality.js（环境隔离不连生产）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
const TMP = path.join(os.tmpdir(), `bambu-train-q-${Date.now()}`);
fs.mkdirSync(TMP, { recursive: true });
process.env.TRAINING_SAMPLES_FILE = path.join(TMP, 'training-samples.json');
process.env.RESERVATIONS_STORE_FILE = path.join(TMP, 'reservations.json');

const store = require('../src/services/trainingStore');

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

function mkSample(id, extra = {}) {
  return store.create({
    createdBy: 'test',
    notes: `测试样本 ${id}`,
    sourceRecordId: `R-TEST-${id}`,
    featureSource: 'auto',
    confidence: 40,
    selection: { scene_usage: ['structural'] },
    materialType: 'PETG',
    model: { originalName: `${id}.stl`, buffer: Buffer.from('stl-stub'), features: { ok: true, source: 'auto', volumeCm3: 5, bbox: { x: 1, y: 1, z: 1 } } },
    slice: { originalName: `${id}.gcode.3mf`, buffer: Buffer.from('gcode-stub'), extraction: { source: 'project_settings', params: { wallLoops: 3, infillDensity: 15 } } },
    ...extra,
  });
}

check('create 默认 quality=clean；setQuality 四档校验+落档', () => {
  const s = mkSample('Q001');
  assert.strictEqual(s.quality, 'clean', '新样本默认 clean');
  assert.throws(() => store.setQuality(s.id, 'bogus'), /quality 必须是/);
  store.setQuality(s.id, 'quarantine', '无 outcome 待复核');
  const g = store.get(s.id);
  assert.strictEqual(g.quality, 'quarantine');
  assert.ok(g.qualityNote.includes('待复核'));
  assert.ok(g.qualityAt);
});

check('setOutcome 自动回填 machine（完成 @ 机器名）；已有 machine 不覆盖', () => {
  const a = mkSample('Q002');
  store.setOutcome(a.id, { status: '成功', issues: '打印完成 @ X1C', recordedBy: '打印系统' });
  assert.strictEqual(store.get(a.id).machine, 'X1C', 'machine 空时应从 issues 回填');
  const b = mkSample('Q003', { machine: 'H2D' });
  store.setOutcome(b.id, { status: '成功', issues: '打印完成 @ P1S', recordedBy: '打印系统' });
  assert.strictEqual(store.get(b.id).machine, 'H2D', '已有 machine 不被 outcome 覆盖');
});

check('dumpJsonl 默认过滤 excluded、带 quality 字段；includeExcluded 可全量', () => {
  const a = mkSample('Q004');
  const b = mkSample('Q005');
  store.setQuality(b.id, 'excluded', '工程件误入档');
  const lines = store.dumpJsonl().trim().split('\n');
  const ids = lines.map((l) => JSON.parse(l).id);
  assert.ok(!ids.includes(b.id), 'excluded 不得出现在默认 dump');
  assert.ok(ids.includes(a.id));
  assert.strictEqual(JSON.parse(lines.find((l) => l.includes(a.id))).quality, 'clean');
  const all = store.dumpJsonl({ includeExcluded: true }).trim().split('\n').map((l) => JSON.parse(l).id);
  assert.ok(all.includes(b.id), 'includeExcluded=true 时全量输出');
});

check('stats 带质量分布', () => {
  const st = store.stats();
  assert.ok(st.quality && typeof st.quality === 'object');
  assert.ok(st.quality.excluded >= 1);
});

check('静态锚：工程 3mf 入库拒收闸（reservation 侧）+ 源单交叉判定的清洗脚本存在', () => {
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes("record.embeddedParams.source === 'engineering'"), '入库入口必须有工程件判定');
  assert.ok(resv.includes('不入训练库'), '拒收文案必须给可操作去路');
  const script = fs.readFileSync(path.join(__dirname, '../scripts/audit-samples-20261114.js'), 'utf8');
  assert.ok(script.includes('engSources'), '清洗脚本必须按源单交叉判定工程件（样本 id 与源单 id 有错位）');
  assert.ok(script.includes('bak-audit'), '清洗必须先备份（可回滚）');
});

process.exit(failures > 0 ? 1 : 0);
