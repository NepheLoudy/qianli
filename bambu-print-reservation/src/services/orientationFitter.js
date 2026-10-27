// ============================================================
// 摆向策略学习（2026-10-19 曼波令：几何特征 → 切片方式必须进学习回路）
//
// 分层：
//   · modelOrient = 几何感知层（候选 24 轴向 + 接触/支撑/高度度量，不做取舍）；
//   · 本模块 = 策略学习层：从带「专家摆向」标签的样本里学候选评分权重
//     （wContact / wSupport / wHeight + 最低接触比），输出 orientationPolicy；
//   · autoSlice = 执行层：采用已采纳的 policy 选候选；无 policy 时回退冷启动启发式。
//
// 标签来源（orientationExtract）：预约 placement 四元数 / 专家 3mf 的 matrix。
// 损失口径：支撑耗材与接触不足远比参数 MAE 重要——这里用「专家摆向是否被选中」
// 做 top-1 准确率，并按几何家族 LOFO 验证跨族泛化；没有标签就诚实返回不足。
// ============================================================

const fs = require('fs');
const path = require('path');
const modelOrient = require('./modelOrient');
const featureDerive = require('./featureDerive');

const MIN_ROWS = 6;
const MIN_FAMILIES = 3;
// 标签可信度权重（2026-10-27 特征标签批）：placement=人工摆放最强；3mf matrix=专家
// 切片弱标签；auto-confirmed=自举（自动摆向打印成功——经现实验证但存在偏见强化，
// 低权重只当先验）。加权口径贯穿 top-1 准确率/meanRank/LOFO，未登记来源按 1 计。
const LABEL_WEIGHTS = {
  'placement': 1,
  '3mf-model-settings': 0.8,
  '3mf-build-item': 0.8,
  'auto-confirmed': 0.35,
  'default-pose': 0.5, // 预留：identity 语义实证通过后的默认朝向弱标签
};
const AXIS_DOT = 0.985; // 专家朝上的轴与候选轴夹角 ≤10° 才算同一摆向（面朝下语义）
const GRID = {
  contact: [0, 0.25, 0.5, 0.75, 1, 1.5, 2],
  support: [0, 0.25, 0.5, 0.75, 1, 1.5, 2],
  height: [0, 0.25, 0.5],
  minContactRatio: [0, 0.1, 0.2, 0.3, 0.35, 0.4, 0.5],
};

function rotateVec(q, v) {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}
function candidateUp(o) {
  // 打印坐标的 +Z（朝上）对应模型坐标的哪个轴：new[i]=s[i]*old[p[i]]，
  // 令 new=[0,0,1] → old[p[2]]=s[2]（其余分量为 0）
  const v = [0, 0, 0];
  v[o.p[2]] = o.s[2];
  return v;
}

/** 样本的专家摆向标签 [x,y,z,w]（orientation 优先，兼容旧样本 placement 字段） */
function sampleLabel(sample) {
  const o = sample && sample.orientation;
  if (o && Array.isArray(o.quaternion) && o.quaternion.length === 4) {
    return { quaternion: o.quaternion.map(Number), source: o.source || 'orientation' };
  }
  if (Array.isArray(sample && sample.placement) && sample.placement.length === 4) {
    return { quaternion: sample.placement.map(Number), source: 'placement' };
  }
  return null;
}

/** 样本库体检：先回答「有没有数据可学」 */
function auditSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const labelSources = {};
  let labeled = 0;
  let withModelFile = 0;
  let withFeatures = 0;
  let withSlice = 0;
  const families = new Set();
  const labeledFamilies = new Set();
  const outcome = {};
  for (const s of list) {
    if (s.family) families.add(s.family);
    if (s.model && s.model.storedPath) withModelFile++;
    if (s.model && s.model.features) withFeatures++;
    if (s.slice && s.slice.extraction) withSlice++;
    const lab = sampleLabel(s);
    if (lab) {
      labeled++;
      labeledFamilies.add(s.family || 'unknown');
      labelSources[lab.source] = (labelSources[lab.source] || 0) + 1;
    }
    const st = (s.outcome && s.outcome.status) || '未打印';
    outcome[st] = (outcome[st] || 0) + 1;
  }
  return {
    total: list.length,
    families: families.size,
    withModelFile,
    withFeatures,
    withSlice,
    labeled,
    labeledFamilies: labeledFamilies.size,
    labelSources,
    outcomes: outcome,
    sufficientForFit: labeled >= MIN_ROWS && labeledFamilies.size >= MIN_FAMILIES,
    thresholds: { minRows: MIN_ROWS, minFamilies: MIN_FAMILIES },
  };
}

/** 读取样本归档模型 → 网格（STL/STEP/带几何的 3mf） */
async function loadSampleMesh(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { error: '模型归档文件不存在' };
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === '.stl') {
      const r = require('./modelFeatures').parseStl(fs.readFileSync(filePath));
      return r.error ? { error: r.error } : r;
    }
    if (ext === '.step' || ext === '.stp') {
      const r = await require('../utils/stepMesh').parseCadToParsed(fs.readFileSync(filePath), filePath);
      return r.error ? { error: r.error } : r;
    }
    if (ext === '.3mf') {
      const r = require('./modelFeatures').parse3mfModel(fs.readFileSync(filePath));
      if (r.error || !r.objects || !r.objects.length) return { error: r.error || '3mf 无几何网格' };
      return r.objects[0];
    }
    return { error: `不支持的模型格式 ${ext}` };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * 构造学习行：每条样本 → 24 候选的度量 + 专家朝上轴。
 * @param {Array} samples trainingStore.list()
 * @returns {Promise<{rows:Array, skipped:Object}>}
 */
async function buildOrientationRows(samples) {
  const rows = [];
  const skipped = { noLabel: 0, noModel: 0, meshError: 0, nonAxis: 0 };
  for (const s of samples || []) {
    const lab = sampleLabel(s);
    if (!lab) { skipped.noLabel++; continue; }
    const stored = s.model && s.model.storedPath;
    if (!stored) { skipped.noModel++; continue; }
    const mesh = await loadSampleMesh(stored);
    if (mesh.error) { skipped.meshError++; continue; }
    const candidates = modelOrient.allOrientations().map((o) => ({ ...o, ...modelOrient.metricsFor(mesh, o) }));
    // 专家 quaternion 是「模型→打印」旋转；打印 +Z 对应模型坐标 q⁻¹(Z)
    const q = lab.quaternion;
    const qInv = [-q[0], -q[1], -q[2], q[3]];
    const expertUp = rotateVec(qInv, [0, 0, 1]);
    const match = candidates
      .map((c, i) => ({ i, dot: candidateUp(c)[0] * expertUp[0] + candidateUp(c)[1] * expertUp[1] + candidateUp(c)[2] * expertUp[2] }))
      .sort((a, b) => b.dot - a.dot)[0];
    if (!match || match.dot < AXIS_DOT) { skipped.nonAxis++; continue; }
    // 同朝上轴可能对应多个面内旋转候选——只要选中的候选朝上轴一致即算对
    const expertSet = new Set();
    candidates.forEach((c, i) => {
      const u = candidateUp(c);
      if (u[0] * expertUp[0] + u[1] * expertUp[1] + u[2] * expertUp[2] >= AXIS_DOT) expertSet.add(i);
    });
    const features = featureDerive.deriveFeatures(s.spatial || [], (s.model && s.model.features) || null, s.selection || {});
    rows.push({
      id: s.id,
      family: s.family || 'unknown',
      candidates,
      expertSet,
      features,
      labelSource: lab.source,
      weight: LABEL_WEIGHTS[lab.source] != null ? LABEL_WEIGHTS[lab.source] : 1,
    });
  }
  return { rows, skipped };
}

function normalized(candidates) {
  const maxContact = Math.max(1e-6, ...candidates.map((c) => c.contact));
  const maxSupport = Math.max(1, ...candidates.map((c) => c.support));
  const maxHeight = Math.max(1e-6, ...candidates.map((c) => c.height));
  return candidates.map((c) => ({
    ...c,
    nContact: c.contact / maxContact,
    nSupport: c.support / maxSupport,
    nHeight: c.height / maxHeight,
    contactRatio: c.contact / maxContact,
  }));
}

function scoreCandidate(c, policy) {
  return (policy.weights.contact || 0) * c.nContact
    - (policy.weights.support || 0) * c.nSupport
    - (policy.weights.height || 0) * c.nHeight;
}

function pickCandidate(candidates, policy) {
  const minContact = Number(policy.minContactRatio) || 0;
  const eligible = candidates.filter((c) => c.contactRatio >= minContact);
  if (!eligible.length) return null;
  return eligible.reduce((best, c) => (scoreCandidate(c, policy) > scoreCandidate(best, policy) ? c : best));
}

function evaluateRows(rows, policy) {
  let correct = 0;
  let weightSum = 0;
  let rankSum = 0;
  for (const row of rows) {
    const w = Number(row.weight) || 1;
    weightSum += w;
    const norm = normalized(row.candidates);
    const picked = pickCandidate(norm, policy);
    const idx = picked ? norm.indexOf(picked) : -1;
    if (idx >= 0 && row.expertSet.has(idx)) correct += w;
    // 专家候选的平均排名（越小越好，按标签权重计）
    let bestRank = Infinity;
    for (const ei of row.expertSet) {
      const sorted = norm.slice().sort((a, b) => scoreCandidate(b, policy) - scoreCandidate(a, policy));
      const rank = sorted.indexOf(norm[ei]);
      if (rank >= 0 && rank < bestRank) bestRank = rank;
    }
    rankSum += (Number.isFinite(bestRank) ? bestRank : norm.length) * w;
  }
  return {
    accuracy: weightSum ? correct / weightSum : 0,
    meanRank: weightSum ? rankSum / weightSum : null,
    correct: Math.round(correct * 1000) / 1000,
    total: rows.length,
    weightSum: Math.round(weightSum * 1000) / 1000,
  };
}

function baselinePolicy() {
  // 冷启动启发式同款（支撑优先，接触≥35% 最大）——用相同评分接口表达
  return { weights: { contact: 0.35, support: 1, height: 0 }, minContactRatio: 0.35, kind: 'cold-start' };
}

function fitOnRows(rows) {
  let best = null;
  for (const wc of GRID.contact) {
    for (const ws of GRID.support) {
      for (const wh of GRID.height) {
        for (const minContact of GRID.minContactRatio) {
          const policy = { weights: { contact: wc, support: ws, height: wh }, minContactRatio: minContact };
          const ev = evaluateRows(rows, policy);
          const key = [ev.accuracy, -ev.meanRank];
          if (!best || key[0] > best.key[0] || (key[0] === best.key[0] && key[1] > best.key[1])) {
            best = { key, policy, ev };
          }
        }
      }
    }
  }
  return best;
}

/**
 * 拟合摆向策略（含 LOFO）。
 * @returns {Promise<{insufficient:boolean, stats:Object, policy?:Object}>}
 */
async function fitOrientationPolicy(samples, opts = {}) {
  const audit = auditSamples(samples);
  const { rows, skipped } = await buildOrientationRows(samples);
  const families = new Set(rows.map((r) => r.family));
  const stats = {
    ...audit,
    rows: rows.length,
    rowsFamilies: families.size,
    skipped,
    baseline: null,
    fitted: null,
    lofo: null,
    note: '',
  };
  if (rows.length < (opts.minRows || MIN_ROWS) || families.size < (opts.minFamilies || MIN_FAMILIES)) {
    stats.note = `摆向标签不足：可用 ${rows.length} 条（≥${opts.minRows || MIN_ROWS}）/ ${families.size} 个家族（≥${opts.minFamilies || MIN_FAMILIES}）——本轮不产出策略，继续用冷启动启发式`;
    return { insufficient: true, stats };
  }
  const base = evaluateRows(rows, baselinePolicy());
  const fitted = fitOnRows(rows);
  stats.baseline = base;
  stats.fitted = fitted.ev;
  // LOFO：按家族留出，训练侧拟合、留出族评估
  let heldCorrect = 0;
  let heldTotal = 0;
  const folds = [];
  for (const fam of families) {
    const train = rows.filter((r) => r.family !== fam);
    const test = rows.filter((r) => r.family === fam);
    if (!train.length || !test.length) continue;
    const f = fitOnRows(train);
    const ev = evaluateRows(test, f.policy);
    heldCorrect += ev.correct;
    heldTotal += ev.total;
    folds.push({ family: fam, accuracy: ev.accuracy, n: ev.total });
  }
  const lofoAccuracy = heldTotal ? heldCorrect / heldTotal : 0;
  stats.lofo = { accuracy: lofoAccuracy, folds };
  const gain = fitted.ev.accuracy - base.accuracy;
  const lofoGain = lofoAccuracy - base.accuracy;
  stats.gain = gain;
  stats.lofoGain = lofoGain;
  const enough = rows.length >= (opts.minRows || MIN_ROWS)
    && families.size >= (opts.minFamilies || MIN_FAMILIES)
    && lofoGain >= (opts.minGain == null ? 0.1 : opts.minGain);
  stats.note = enough
    ? `可采纳：全量 top-1 ${(fitted.ev.accuracy * 100).toFixed(0)}%（基线 ${(base.accuracy * 100).toFixed(0)}%），LOFO ${(lofoAccuracy * 100).toFixed(0)}%`
    : `效果未超过冷启动（增益 ${(lofoGain * 100).toFixed(0)} 个百分点，需 ≥${Math.round((opts.minGain == null ? 0.1 : opts.minGain) * 100)}）——继续用冷启动启发式`;
  const policy = {
    version: `op-${Date.now().toString(36)}`,
    kind: 'learned',
    weights: fitted.policy.weights,
    minContactRatio: fitted.policy.minContactRatio,
    stats: {
      rows: rows.length, families: families.size, accuracy: fitted.ev.accuracy,
      lofoAccuracy, baseline: base.accuracy, gain, lofoGain, sufficientForAdoption: enough,
    },
    createdAt: new Date().toISOString(),
  };
  return { insufficient: false, sufficientForAdoption: enough, stats, policy };
}

module.exports = {
  auditSamples, buildOrientationRows, fitOrientationPolicy, evaluateRows,
  sampleLabel, loadSampleMesh, MIN_ROWS, MIN_FAMILIES,
};
