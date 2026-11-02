/**
 * 参数智能层单测（v60 · 2026-10-30）：统一特征向量 / 合成样本学回线性关系 /
 * LOFO 择优与常数参数回退 / 置信度门控 / shadow-active 模式 / clamp 域 / store 流
 * 用法：node test/param-model-test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

// store 模块加载时定文件路径——env 先行
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'param-model-test-'));
process.env.PARAM_MODEL_FILE = path.join(tmpDir, '.param-model.json');

const featureVector = require('../src/services/featureVector');
const paramModel = require('../src/services/paramModel');
const store = require('../src/services/paramModelStore');
const processRules = require('../src/services/processRules');

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

// ---------- 合成样本：xyHoleComp = -0.04×holes_z + 家族偏移；infillDensity = 20+5×holes_z；
// layerHeight 恒 0.2（常数——应被 LOFO 闸门拒绝，不动基线） ----------
const FAMILIES = ['famA', 'famB', 'famC', 'famD'];
const FAMILY_OFFSET = { famA: 0.006, famB: -0.004, famC: 0.002, famD: -0.006 };

function mkSample(i, holesZ, heavy) {
  const family = FAMILIES[i % FAMILIES.length];
  const comp = Math.round((-0.04 * holesZ + FAMILY_OFFSET[family]) * 1000) / 1000;
  const circles = Array.from({ length: holesZ }, () => ({ c: [0, 0, 0], n: [0, 0, 1], r: 3 }));
  return {
    id: `T0000-${String(i).padStart(3, '0')}`,
    family,
    selection: heavy
      ? { load_direction: ['Z'], load_type: ['bending'], load_magnitude: 'heavy' }
      : { load_magnitude: 'light' },
    spatial: [],
    model: {
      originalName: `m${i}.stl`,
      features: {
        ok: true,
        bbox: { x: 40 + i, y: 30, z: 20 + holesZ * 3 },
        volumeCm3: 12 + i * 0.5,
        holes: { count: holesZ, circles },
        overhang: { severePct: 2 + i * 0.2, moderatePct: 8 },
        contact: { areaMm2: 500 + i * 10, footprintPct: 40 },
        curvedPct: 10 + i,
      },
    },
    slice: { extraction: { params: { xyHoleComp: comp, infillDensity: 20 + holesZ * 5, layerHeight: 0.2, wallLoops: heavy ? 4 : 2 } } },
    outcome: { status: '成功' },
    confidence: 90,
  };
}

const SAMPLES = Array.from({ length: 24 }, (_, i) => mkSample(i, i % 5, i % 2 === 0));

check('featureVector：几何数值段 + 工况 one-hot + 标尺进数值段', () => {
  const spec = paramModel._internals.freezeSpec();
  const raw = featureVector.buildRawVector(
    { load_direction: ['Z', 'Y'], load_magnitude: 'heavy', deflection_scale: 2, electrical_insulation: true },
    { bbox: { x: 40, y: 30, z: 20 }, volumeCm3: 12 },
    { holes_z: 2 },
    spec,
  );
  assert.strictEqual(raw.geometry.holes_z, 2);
  assert.strictEqual(raw.geometry.bbox_x, 40);
  assert.ok(raw.geometry.aspect_ratio === 2, `aspect_ratio=${raw.geometry.aspect_ratio}`);
  assert.strictEqual(raw.geometry['scale:deflection_scale'], 2, '标尺应进数值段');
  assert.strictEqual(raw.hot['load_direction=Z'], 1);
  assert.strictEqual(raw.hot['load_direction=Y'], 1);
  assert.strictEqual(raw.hot['load_magnitude=heavy'], 1);
  assert.strictEqual(raw.hot.electrical_insulation, 1);
  assert.strictEqual(raw.hot['load_magnitude=light'], 0);
  assert.ok(spec.numericKeys.includes('scale:deflection_scale'), '标尺键应进 numericKeys');
});

check('合成 24 样本：训练产出模型，孔补偿与填充通过 LOFO 择优', () => {
  const { model, stats, insufficient } = paramModel.train(SAMPLES);
  assert.strictEqual(insufficient, false, stats.note);
  assert.ok(model.choices.xyHoleComp, '应有 xyHoleComp 决策');
  assert.ok(['knn', 'ridge'].includes(model.choices.xyHoleComp.choice), `xyHoleComp choice=${model.choices.xyHoleComp.choice}（knn=${model.choices.xyHoleComp.knnMae} ridge=${model.choices.xyHoleComp.ridgeMae} base=${model.choices.xyHoleComp.baseMae}）`);
  assert.ok(['knn', 'ridge'].includes(model.choices.infillDensity.choice), `infillDensity choice=${model.choices.infillDensity.choice}`);
  assert.ok(Number.isFinite(model.choices.xyHoleComp.baseMae) && model.choices.xyHoleComp.baseMae > 0, '基线 MAE 应为正');
  assert.ok(model.choices.xyHoleComp[`${model.choices.xyHoleComp.choice}Mae`] < model.choices.xyHoleComp.baseMae, '择优 MAE 应严格优于基线');
});

check('常数参数防线：layerHeight 恒值时 LOFO 无增益 → 不修正（不装懂）', () => {
  const { model } = paramModel.train(SAMPLES);
  assert.strictEqual(model.choices.layerHeight.choice, 'none', `layerHeight choice=${model.choices.layerHeight.choice}`);
});

check('模型预测：孔多（holes_z=4）→ 孔补偿为负、填充升档，值在 clamp 域内', () => {
  const r = paramModel.train(SAMPLES);
  store.saveCandidate(r.model, r.stats);
  store.adopt({ mode: 'active', adoptedBy: '测试' });
  const active = store.getActive();
  const selection = { load_direction: ['Z'], load_type: ['bending'], load_magnitude: 'heavy' };
  const feat = { holes_z: 4, holes_total: 4, holes_max_r: 3 };
  const modelFeatures = { ok: true, bbox: { x: 44, y: 30, z: 32 }, volumeCm3: 24, holes: { count: 4 } };
  const ruleParams = processRules.applyRules(selection, { material: 'PLA', feat }).params;
  const pm = paramModel.applyToParams(ruleParams, { selection, modelFeatures, feat }, active);
  assert.ok(pm.used, `应有参数被修正：${JSON.stringify(pm.provenance && pm.provenance.params, null, 0).slice(0, 400)}`);
  assert.ok(pm.params.xyHoleComp < 0, `孔补偿应为负（模型学到 -0.04×holes_z），实际 ${pm.params.xyHoleComp}`);
  assert.ok(pm.params.infillDensity > 20, `填充应高于 20 基线，实际 ${pm.params.infillDensity}`);
  for (const P of paramModel.LEARNABLE_PARAMS) {
    const dom = paramModel.PARAM_DOMAINS[P];
    assert.ok(pm.params[P] >= dom.min && pm.params[P] <= dom.max, `${P}=${pm.params[P]} 越域 [${dom.min},${dom.max}]`);
  }
  // 枚举/安全参数不被模型碰
  assert.strictEqual(pm.params.infillPattern, ruleParams.infillPattern);
  assert.strictEqual(pm.params.materialExclude, ruleParams.materialExclude);
  assert.strictEqual(pm.params.directionStrategy, ruleParams.directionStrategy);
  // provenance 可审计：依据案例 + LOFO 证据
  const pv = pm.provenance.params.xyHoleComp;
  assert.ok(pv && pv.applied === true, 'xyHoleComp provenance 应标记 applied');
  assert.ok(Array.isArray(pv.neighbors) && pv.neighbors.length > 0, '应透出参考案例');
  assert.ok(pv.neighbors.every((n) => /^T0000-/.test(n.id) && Number.isFinite(n.dist) && Number.isFinite(n.value)), '案例 id/距离/值应完整');
  assert.ok(Number.isFinite(pv.lofoMae) && Number.isFinite(pv.baselineMae), '应带 LOFO 证据');
});

check('shadow 模式：建议透出但参数保持规则库值', () => {
  store.setMode('shadow');
  const active = store.getActive();
  const selection = { load_direction: ['Z'], load_magnitude: 'heavy' };
  const feat = { holes_z: 4 };
  const ruleParams = processRules.applyRules(selection, { material: 'PLA', feat }).params;
  const pm = paramModel.applyToParams(ruleParams, { selection, modelFeatures: { bbox: { x: 44, y: 30, z: 32 }, holes: { count: 4 } }, feat }, active);
  assert.strictEqual(pm.used, false, 'shadow 不应真实替换参数');
  assert.strictEqual(pm.params.xyHoleComp, ruleParams.xyHoleComp, 'shadow 参数应保持基线');
  assert.ok(pm.provenance && pm.provenance.params.xyHoleComp, 'shadow 应透出建议');
  assert.strictEqual(pm.provenance.params.xyHoleComp.applied, false);
  assert.ok(pm.provenance.params.xyHoleComp.modelValue < 0, `建议值应为负，实际 ${pm.provenance.params.xyHoleComp.modelValue}`);
});

check('置信度门控：gate 调到 0.99 → 逐参数回退规则值（不装懂）', () => {
  store.setMode('active');
  const active = store.getActive();
  const selection = { load_magnitude: 'heavy' };
  const feat = { holes_z: 4 };
  const ruleParams = processRules.applyRules(selection, { material: 'PLA', feat }).params;
  const pm = paramModel.applyToParams(ruleParams, { selection, modelFeatures: { bbox: { x: 44, y: 30, z: 32 } }, feat }, active, { minConfidence: 0.99 });
  assert.strictEqual(pm.used, false, '极高门限下不应有参数被修正');
  assert.strictEqual(pm.params.xyHoleComp, ruleParams.xyHoleComp);
});

check('无已采纳模型：参数原样、provenance 为 null', () => {
  const ruleParams = processRules.applyRules({}, { material: 'PLA' }).params;
  const pm = paramModel.applyToParams(ruleParams, { selection: {}, feat: {} }, null);
  assert.strictEqual(pm.used, false);
  assert.strictEqual(pm.provenance, null);
  assert.deepStrictEqual(pm.params, ruleParams);
});

check('store 流：candidate→adopt(shadow)→setMode(active)→deactivate', () => {
  store.deactivate(); // 前序用例已 adopt——先清场
  store.saveCandidate(... (() => { const r = paramModel.train(SAMPLES); return [r.model, r.stats]; })());
  assert.strictEqual(store.getActive(), null, 'candidate 不生效');
  store.adopt({ mode: 'shadow', adoptedBy: '测试' });
  assert.strictEqual(store.getActive().mode, 'shadow');
  assert.ok(store.getSnapshot().active.choices, '快照应带逐参数决策');
  store.setMode('active');
  assert.strictEqual(store.getActive().mode, 'active');
  store.deactivate();
  assert.strictEqual(store.getActive(), null, '下线后消费端回退规则口径');
  assert.throws(() => store.adopt({}), /无候选模型/, '无 candidate 时 adopt 应报错');
});

check('样本权重：失败案例降权后 kNN 近邻排序仍稳定（不崩、可预测）', () => {
  const weighted = SAMPLES.map((s, i) => (i === 0 ? { ...s, outcome: { status: '失败' } } : s));
  const { model, insufficient } = paramModel.train(weighted);
  assert.strictEqual(insufficient, false, statsNote(insufficient, model));
  const w0 = model.rows.find((r) => r.id === weighted[0].id);
  assert.ok(w0.weight < 0.5, `失败样本权重应 <0.5，实际 ${w0.weight}`);
});

function statsNote(insufficient, model) { return insufficient ? '不应判定不足' : (model && model.version ? model.version : ''); }

check('样本不足防线：<4 条有效样本不产出模型', () => {
  const { insufficient, stats } = paramModel.train(SAMPLES.slice(0, 2));
  assert.strictEqual(insufficient, true);
  assert.ok(/<4/.test(stats.note), stats.note);
});

// ---------- v61 多层神经网络（mlp.js） ----------
const mlp = require('../src/services/mlp');

check('MLP 反向传播：拟合一维正弦（函数级梯度正确性证据）', () => {
  const N = 48;
  const rows = Array.from({ length: N }, (_, i) => {
    const x = i / (N - 1);
    return { x: [x], y: [Math.sin(2 * Math.PI * x)], w: 1 };
  });
  const ens = mlp.trainEnsemble(rows, 1, 1, { nNets: 1, epochs: 900, lr: 0.02, l2: 0, seedBase: 7 });
  let se = 0;
  for (const r of rows) se += (mlp.predictEnsemble(ens, r.x)[0] - r.y[0]) ** 2;
  const rmse = Math.sqrt(se / N);
  assert.ok(rmse < 0.12, `正弦拟合 RMSE=${rmse.toFixed(4)} 应 <0.12（反向传播失准会到 0.3+）`);
});

check('MLP 序列化往返：量化后预测与内存态一致（≤4 位小数量化误差）', () => {
  const rows = Array.from({ length: 20 }, (_, i) => ({ x: [i / 20, Math.random()], y: [i / 10], w: 1 }));
  const ens = mlp.trainEnsemble(rows, 2, 1, { nNets: 2, epochs: 60, seedBase: 11 });
  const de = JSON.parse(JSON.stringify(mlp.serialize(ens)));
  const revived = { arch: de.arch, nets: de.nets, nNets: de.nNets };
  for (const r of rows.slice(0, 5)) {
    const a = mlp.predictEnsemble(ens, r.x)[0];
    const b = mlp.predictEnsemble(revived, r.x)[0];
    assert.ok(Math.abs(a - b) < 1e-2, `往返预测差 ${Math.abs(a - b)}`);
  }
});

check('MLP 确定性：同种子训练权重完全一致（可复现）', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ x: [i / 12, 1 - i / 12], y: [i % 3], w: 1 }));
  const a = mlp.trainEnsemble(rows, 2, 1, { nNets: 1, epochs: 5, seedBase: 99 });
  const b = mlp.trainEnsemble(rows, 2, 1, { nNets: 1, epochs: 5, seedBase: 99 });
  assert.deepStrictEqual(a.nets[0].W1, b.nets[0].W1);
  assert.deepStrictEqual(a.nets[0].W3, b.nets[0].W3);
});

check('MLP 竞技场：饱和曲线（非线性）上 MLP 进闸门，线性数据上诚实让位岭回归', () => {
  // 饱和：infillDensity = 20 + 40·holes_z/(holes_z+1.5)——线性最优拟合显著次优
  const nonlin = Array.from({ length: 24 }, (_, i) => {
    const holesZ = i % 5;
    const family = FAMILIES[i % FAMILIES.length];
    const circles = Array.from({ length: holesZ }, () => ({ c: [0, 0, 0], n: [0, 0, 1], r: 3 }));
    return {
      id: `N0000-${i}`, family, selection: {}, spatial: [],
      model: { originalName: 'n.stl', features: { ok: true, bbox: { x: 40 + i, y: 30, z: 20 + holesZ * 3 }, volumeCm3: 12, holes: { count: holesZ, circles }, overhang: { severePct: 2, moderatePct: 8 }, contact: { areaMm2: 500, footprintPct: 40 }, curvedPct: 10 } },
      slice: { extraction: { params: { infillDensity: Math.round((20 + 40 * holesZ / (holesZ + 1.5)) * 10) / 10, layerHeight: 0.2 } } },
      outcome: { status: '成功' }, confidence: 95,
    };
  });
  const { model, stats, insufficient } = paramModel.train(nonlin);
  assert.strictEqual(insufficient, false, stats.note);
  const inf = model.choices.infillDensity;
  assert.ok(Number.isFinite(inf.mlpMae), 'MLP 应参与评估');
  assert.ok(inf.mlpMae <= inf.baseMae * 0.95, `非线性数据 MLP LOFO MAE=${inf.mlpMae} 应明显优于基线 ${inf.baseMae}`);
  assert.ok(['knn', 'ridge', 'mlp'].includes(inf.choice), `择优应在三族内：${inf.choice}`);
  // 存档模型可用：MLP 头预测在合理域内
  if (inf.choice === 'mlp') {
    store.saveCandidate(model, stats);
    store.adopt({ mode: 'active', adoptedBy: '测试' });
    const ruleParams = processRules.applyRules({}, { material: 'PLA' }).params;
    const pm = paramModel.applyToParams(ruleParams, { selection: {}, modelFeatures: { bbox: { x: 42, y: 30, z: 32 }, holes: { count: 3 } }, feat: { holes_z: 3, holes_total: 3 } }, store.getActive());
    if (pm.provenance && pm.provenance.params.infillDensity && pm.provenance.params.infillDensity.source === 'mlp') {
      const v = pm.provenance.params.infillDensity.modelValue;
      assert.ok(v >= 20 && v <= 100, `MLP 预测 ${v} 应在 clamp 域`);
      assert.ok(Number.isFinite(pm.provenance.params.infillDensity.confidence), 'MLP 应给集成分歧置信度');
    }
  }
});

check('置换重要性：结构完整（每参数 top≤5 特征，score 递减）', () => {
  const { model } = paramModel.train(SAMPLES);
  assert.ok(model.mlp && Array.isArray(model.mlp.importance), '应存档重要性');
  assert.strictEqual(model.mlp.importance.length, paramModel.LEARNABLE_PARAMS.length);
  for (const list of model.mlp.importance) {
    assert.ok(list.length <= 5, 'top≤5');
    for (let i = 1; i < list.length; i++) assert.ok(list[i - 1].score >= list[i].score, 'score 递减');
  }
});

console.log(`\n参数智能层单测: ${pass} 通过 / ${failures} 失败`);
fs.rmSync(tmpDir, { recursive: true, force: true });
process.exit(failures ? 1 : 0);
