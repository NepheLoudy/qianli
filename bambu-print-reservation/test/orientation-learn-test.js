/**
 * 摆向学习回路单测（2026-10-19）：3mf 变换提取 / 样本体检 / 不足门 / 合成样本拟合 / 策略执行
 * 用法：node test/orientation-learn-test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const orient = require('../src/services/modelOrient');
const extract = require('../src/services/orientationExtract');
const fitter = require('../src/services/orientationFitter');

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

function boxMesh(w, h, d) {
  const x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2, z0 = 0, z1 = d;
  const v = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
  const faces = [[0, 2, 1], [0, 3, 2], [4, 5, 6], [4, 6, 7], [0, 1, 5], [0, 5, 4], [3, 7, 6], [3, 6, 2], [0, 4, 7], [0, 7, 3], [1, 2, 6], [1, 6, 5]];
  return { positions: new Float64Array(v.flat()), faces: new Uint32Array(faces.flat()), triangles: faces.length, vertices: v.length };
}

check('3mf matrix：绕 Z 90° → 四元数；单位矩阵 → identity', () => {
  const mk = (matrix) => {
    const zip = new AdmZip();
    zip.addFile('Metadata/model_settings.config', Buffer.from(`<config><object id="1"><metadata key="matrix" value="${matrix}"/></object></config>`));
    return zip.toBuffer();
  };
  const rot = extract.extractOrientationFrom3mf(mk('0 -1 0 0 1 0 0 0 0 0 1 0 0 0 0 1'));
  assert.ok(rot && !rot.identity, '应识别为旋转');
  assert.ok(Math.abs(Math.abs(rot.quaternion[2]) - Math.SQRT1_2) < 1e-3 || Math.abs(Math.abs(rot.quaternion[3]) - Math.SQRT1_2) < 1e-3, JSON.stringify(rot.quaternion));
  const id = extract.extractOrientationFrom3mf(mk('1 0 0 0 0 1 0 0 0 0 1 15.75 0 0 0 1'));
  assert.ok(id && id.identity, '平移矩阵应为 identity');
  assert.strictEqual(extract.extractOrientationFrom3mf(Buffer.from('not a zip')), null);
});

check('样本体检：标签/几何/切片/家族/outcome 计数', () => {
  const audit = fitter.auditSamples([
    { id: 'a', family: 'f1', model: { storedPath: 'x', features: { ok: true } }, slice: { extraction: {} }, placement: [0, 0, 0, 1], outcome: { status: '成功' } },
    { id: 'b', family: 'f1', model: { storedPath: 'y' }, orientation: { quaternion: [0, 0, 0, 1], source: 'placement' }, outcome: { status: '未打印' } },
    { id: 'c', family: 'f2', model: {} },
  ]);
  assert.strictEqual(audit.total, 3);
  assert.strictEqual(audit.families, 2);
  assert.strictEqual(audit.withModelFile, 2);
  assert.strictEqual(audit.withFeatures, 1);
  assert.strictEqual(audit.withSlice, 1);
  assert.strictEqual(audit.labeled, 2);
  assert.strictEqual(audit.sufficientForFit, false);
});

// ---------- 合成样本拟合（异步） ----------
(async () => {
  const ins = await fitter.fitOrientationPolicy([{ id: 'x', family: 'f1', model: { storedPath: 'none' } }]);
  check('拟合不足：0 标签明确返回 insufficient（不编造策略）', () => {
    assert.strictEqual(ins.insufficient, true);
    assert.ok(/摆向标签不足/.test(ins.stats.note));
    assert.strictEqual(ins.policy, undefined);
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orient-learn-'));
  const dims = [[5, 20, 100], [3, 30, 80], [4, 15, 60]];
  const samples = [];
  // 专家：始终把最大面（yz 面，法向 ±X）贴床 → 模型 X 轴朝上 → q 把模型 X 旋到打印 Z
  const qExpert = [0, -Math.SQRT1_2, 0, Math.SQRT1_2];
  let n = 0;
  for (const [w, h, d] of dims) {
    const stl = path.join(dir, `box-${w}-${h}-${d}.stl`);
    orient.writeBinaryStl(boxMesh(w, h, d), stl);
    for (const family of ['famA', 'famB', 'famC']) {
      n++;
      samples.push({
        id: `S${n}`,
        family,
        model: { storedPath: stl, features: { ok: true, bbox: { x: w, y: h, z: d } } },
        selection: {},
        spatial: [],
        orientation: { quaternion: qExpert, source: 'placement' },
        outcome: { status: '成功' },
      });
    }
  }
  const result = await fitter.fitOrientationPolicy(samples, { minRows: 6, minFamilies: 3 });
  check('合成 9 样本 / 3 家族：拟合产出策略且 LOFO 准确率 ≥ 80%', () => {
    assert.strictEqual(result.insufficient, false, result.stats.note);
    assert.ok(result.policy && result.policy.weights, '应产出权重');
    assert.ok(result.stats.lofo && result.stats.lofo.accuracy >= 0.8, JSON.stringify(result.stats.lofo));
    assert.ok(result.stats.fitted.accuracy >= 0.8, JSON.stringify(result.stats.fitted));
  });
  check('学习策略执行：接触权重策略选最大接触面，note 标注策略版本', () => {
    const parsed = boxMesh(5, 20, 100);
    const policy = { version: 'op-test', weights: { contact: 1, support: 0, height: 0 }, minContactRatio: 0.3 };
    const chosen = orient.chooseOrientation(parsed, { strategy: 'auto', policy });
    assert.strictEqual(chosen.changed, true);
    assert.ok(/op-test/.test(chosen.note), chosen.note);
    assert.ok(chosen.contact > 1900, `应选最大接触面，实际 ${chosen.contact}`);
    assert.ok(Math.abs(chosen.height - 5) < 1e-6, `高度应为 5，实际 ${chosen.height}`);
  });
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`\n摆向学习回路单测: ${pass} 通过 / ${failures} 失败`);
  process.exit(failures ? 1 : 0);
})();
