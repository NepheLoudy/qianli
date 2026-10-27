// 提单源文件配对单测（2026-10-27 曼波令「两个齐活视为一次训练素材」）：
// 切片件 + STEP/STL 源文件 → 训练入库自动配对真网格特征；源文件缺失/坏件回退切片件口径
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-pair-'));
process.env.TRAINING_SAMPLES_FILE = path.join(tmpDir, 'samples.json');
process.env.TRAINING_FILES_DIR = path.join(tmpDir, 'files');
process.env.RESERVATIONS_STORE_FILE = path.join(tmpDir, 'reservations.json');
process.env.RESERVATIONS_UPLOAD_DIR = path.join(tmpDir, 'uploads');
fs.mkdirSync(process.env.RESERVATIONS_UPLOAD_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

async function main() {
  const modelOrient = require('../src/services/modelOrient');
  const { analyzeStl } = require('../src/services/modelFeatures');
  const { createSampleFromReservation } = require('../src/services/reservation');

  // 夹具：一个盒体网格 → STL（真网格源文件）；切片件用文本假 3mf（解析失败自动降级口径）
  const positions = [];
  const faces = [];
  const box = (x0, y0, z0, x1, y1, z1) => {
    const v = [
      [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
      [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
    ];
    const quad = (a, b, c, d) => {
      const s = positions.length / 3;
      positions.push(...v[a], ...v[b], ...v[c], ...v[a], ...v[c], ...v[d]);
      faces.push(s, s + 1, s + 2, s + 3, s + 4, s + 5);
    };
    quad(0, 1, 2, 3); quad(4, 5, 6, 7); quad(0, 1, 5, 4); quad(3, 2, 6, 7); quad(1, 2, 6, 5); quad(0, 3, 7, 4);
  };
  box(0, 0, 0, 30, 20, 10);
  const parsed = { positions, faces, triangles: faces.length / 3 };
  const stlPath = path.join(tmpDir, 'bracket.stl');
  modelOrient.writeBinaryStl(parsed, stlPath);
  const stlOk = analyzeStl(fs.readFileSync(stlPath));
  assert.strictEqual(stlOk.ok, true, '夹具 STL 体检应通过');

  // 切片件假 3mf（解析失败即降级口径，不阻塞）
  const fake3mf = path.join(tmpDir, 'slice.gcode.3mf');
  fs.writeFileSync(fake3mf, 'not-a-zip');

  checks.push(['配对入库：真网格特征 + 模型归档换源文件', async () => {
    const sample = await createSampleFromReservation({
      id: 'R-PAIR-1', fileName: 'bracket.gcode.3mf', filePath: fake3mf,
      materialType: 'PLA', selection: { temp_class: 't50' },
      sourceFile: { originalName: 'bracket.stl', storedPath: stlPath, size: fs.statSync(stlPath).size },
    }, 't');
    assert.strictEqual(sample.featureSource, 'auto');
    assert.strictEqual(sample.model.features.ok, true, '特征应为真网格（ok）');
    assert.ok(sample.model.features.triangles > 0);
    assert.strictEqual(sample.model.name, 'bracket.stl', '模型归档应为源文件');
    assert.ok(sample.model.features.overhang || sample.model.features.contact, '真网格特征含 overhang/contact');
  }]);

  checks.push(['无源文件：维持切片件口径', async () => {
    const sample = await createSampleFromReservation({
      id: 'R-PAIR-2', fileName: 'plain.gcode.3mf', filePath: fake3mf,
      materialType: 'PLA', selection: { temp_class: 't50' },
    }, 't');
    assert.strictEqual(sample.model.name, 'plain.gcode.3mf');
  }]);

  checks.push(['源文件不可读：回退切片件口径不抛错', async () => {
    const sample = await createSampleFromReservation({
      id: 'R-PAIR-3', fileName: 'gone.gcode.3mf', filePath: fake3mf,
      materialType: 'PLA', selection: { temp_class: 't50' },
      sourceFile: { originalName: 'missing.step', storedPath: path.join(tmpDir, 'nope.step'), size: 1 },
    }, 't');
    assert.strictEqual(sample.model.name, 'gone.gcode.3mf');
  }]);

  for (const [name, fn] of checks) {
    try { await fn(); console.log(`✓ ${name}`); pass++; }
    catch (err) { console.error(`✗ ${name}\n  ${err.message}`); fail++; }
  }
  console.log(`\n提单源文件配对单测: ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
