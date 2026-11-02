'use strict';

/**
 * 轻量多层神经网络引擎（v61 · 曼波令「设计可以尽可能复杂，多层神经网络也可加入」）
 *
 * 定位：参数智能层的第三族学习器。纯 JS 零依赖（部署目标 96MB pm2 进程，不引
 * TF.js 类重型依赖——dayjs 事故的前车之鉴），全矩阵手写：
 *
 *   结构：多任务共享底座——输入 d（几何连续值 + 工况 one-hot，同岭回归特征向量）
 *         → 隐层 h1（tanh）→ 隐层 h2（tanh）→ 输出 K（每个可学习参数一个线性头）。
 *         小样本下参数共享表示学习是关键：几何/工况的底层结构由全部参数联合塑形。
 *   训练：full-batch Adam + L2（权重衰减）+ 样本权重进损失 + 标签 mask
 *         （缺某参数标签的样本在该头不计损失/不回传）。
 *   集成：nNet 个不同确定性种子的网络取预测均值——方差缩减，兼作置信度依据
 *         （网络间分歧大 = 该区域数据支撑弱）。
 *   序列化：权重 JSON 存档（量化到 4 位小数，~百 KB 量级），反序列化即可预测。
 *
 * 诚实边界：MLP 的表达力优势要样本 ≥ 数十~百条才兑现；样本极少时它大概率在
 * LOFO 竞技场输给 kNN/岭回归——这正是竞技场的意义：复杂度只在赢的时候上岗。
 */

const ARCH = [24, 12];            // 隐层宽度（d→24→12→K）
const N_NETS = 5;                 // 集成规模
const EPOCHS = 1200;              // 收敛实测：400ep@lr0.01 严重欠拟合（RMSE 3.7），1200ep@lr0.02 收敛（<0.1）
const LR = 0.02;
const L2 = 3e-3;
const WEIGHT_QUANT = 1e4;         // 序列化量化（4 位小数）

/** 确定性 PRNG（mulberry32）：同种子同序列——训练可复现、测试可断言 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** He 初始化（tanh 用 Xavier 更合适——tanh 导数 ≤1，用 Xavier/输入维度开方） */
function initMatrix(rows, cols, rand) {
  const scale = Math.sqrt(1 / Math.max(1, rows));
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => (rand() * 2 - 1) * 2 * scale));
}

function tanhArr(a) { return a.map((v) => Math.tanh(v)); }

/** 前向：x(d) → [a1(h1), a2(h2), out(K)]（缓存激活供反向） */
function forward(net, x) {
  const z1 = new Array(net.W1.length).fill(0);
  for (let i = 0; i < net.W1.length; i++) {
    let s = net.b1[i];
    const row = net.W1[i];
    for (let j = 0; j < x.length; j++) s += row[j] * x[j];
    z1[i] = s;
  }
  const a1 = tanhArr(z1);
  const z2 = new Array(net.W2.length).fill(0);
  for (let i = 0; i < net.W2.length; i++) {
    let s = net.b2[i];
    const row = net.W2[i];
    for (let j = 0; j < a1.length; j++) s += row[j] * a1[j];
    z2[i] = s;
  }
  const a2 = tanhArr(z2);
  const out = new Array(net.W3.length).fill(0);
  for (let k = 0; k < net.W3.length; k++) {
    let s = net.b3[k];
    const row = net.W3[k];
    for (let j = 0; j < a2.length; j++) s += row[j] * a2[j];
    out[k] = s;
  }
  return { a1, a2, out };
}

/** 集成预测：网络均值 */
function predictEnsemble(ens, x) {
  const K = ens.nets[0].W3.length;
  const sum = new Array(K).fill(0);
  for (const net of ens.nets) {
    const { out } = forward(net, x);
    for (let k = 0; k < K; k++) sum[k] += out[k];
  }
  return sum.map((v) => v / ens.nets.length);
}

/** 集成分歧（逐输出）：网络间标准差——置信度依据 */
function ensembleDispersion(ens, x) {
  const K = ens.nets[0].W3.length;
  const per = Array.from({ length: K }, () => []);
  for (const net of ens.nets) {
    const { out } = forward(net, x);
    for (let k = 0; k < K; k++) per[k].push(out[k]);
  }
  return per.map((vals) => {
    const m = vals.reduce((s, v) => s + v, 0) / vals.length;
    return Math.sqrt(vals.reduce((s, v) => s + (v - m) * (v - m), 0) / Math.max(1, vals.length - 1));
  });
}

/**
 * 训练单个网络（full-batch Adam）。
 * @param {Array<{x:number[], y:(number|null)[], w:number}>} rows x=特征向量，y=逐头标签（null=缺），w=样本权重
 * @param {number} dIn 输入维度
 * @param {number} kOut 输出头数
 * @param {number} seed 随机种子
 */
function trainNet(rows, dIn, kOut, seed, opts = {}) {
  const epochs = opts.epochs || EPOCHS;
  const lr = opts.lr || LR;
  const l2 = opts.l2 != null ? opts.l2 : L2;
  const rand = mulberry32(seed);
  const net = {
    W1: initMatrix(ARCH[0], dIn, rand), b1: new Array(ARCH[0]).fill(0),
    W2: initMatrix(ARCH[1], ARCH[0], rand), b2: new Array(ARCH[1]).fill(0),
    W3: initMatrix(kOut, ARCH[1], rand), b3: new Array(kOut).fill(0),
  };
  // Adam 状态（同构零张量）
  const adam = {};
  for (const key of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) adam[key] = { m: zerosLike(net[key]), v: zerosLike(net[key]) };
  let step = 0;
  const nEff = rows.reduce((s, r) => s + r.w, 0) || 1;

  const grads = {};
  const cache = { a1: null, a2: null };
  const dOut = new Array(kOut).fill(0);
  const da2 = new Array(ARCH[1]).fill(0);
  const dz2 = new Array(ARCH[1]).fill(0);
  const da1 = new Array(ARCH[0]).fill(0);
  const dz1 = new Array(ARCH[0]).fill(0);

  for (let ep = 0; ep < epochs; ep++) {
    for (const key of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) grads[key] = zerosLike(net[key]);
    let loss = 0;

    for (const r of rows) {
      const { a1, a2, out } = forward(net, r.x);
      cache.a1 = a1; cache.a2 = a2;
      // 输出梯度：加权 MSE（mask 缺标签）
      let anyHit = false;
      for (let k = 0; k < kOut; k++) {
        const y = r.y[k];
        if (y === null || y === undefined || !Number.isFinite(y)) { dOut[k] = 0; continue; }
        const diff = out[k] - y;
        loss += r.w * diff * diff;
        dOut[k] = (2 * r.w * diff) / nEff;
        anyHit = true;
      }
      if (!anyHit) continue;
      // W3/b3
      for (let k = 0; k < kOut; k++) {
        if (dOut[k] === 0) continue;
        for (let j = 0; j < ARCH[1]; j++) grads.W3[k][j] += dOut[k] * a2[j];
        grads.b3[k] += dOut[k];
      }
      // 隐层 2
      for (let j = 0; j < ARCH[1]; j++) {
        let s = 0;
        for (let k = 0; k < kOut; k++) s += net.W3[k][j] * dOut[k];
        da2[j] = s;
        dz2[j] = s * (1 - a2[j] * a2[j]);
      }
      for (let j = 0; j < ARCH[1]; j++) {
        if (dz2[j] === 0) continue;
        for (let i = 0; i < ARCH[0]; i++) grads.W2[j][i] += dz2[j] * a1[i];
        grads.b2[j] += dz2[j];
      }
      // 隐层 1
      for (let i = 0; i < ARCH[0]; i++) {
        let s = 0;
        for (let j = 0; j < ARCH[1]; j++) s += net.W2[j][i] * dz2[j];
        da1[i] = s;
        dz1[i] = s * (1 - a1[i] * a1[i]);
      }
      for (let i = 0; i < ARCH[0]; i++) {
        if (dz1[i] === 0) continue;
        for (let d = 0; d < dIn; d++) grads.W1[i][d] += dz1[i] * r.x[d];
        grads.b1[i] += dz1[i];
      }
    }

    // L2（权重衰减进梯度；偏置不衰减）
    for (const key of ['W1', 'W2', 'W3']) {
      const g = grads[key]; const w = net[key];
      for (let i = 0; i < g.length; i++) for (let j = 0; j < g[i].length; j++) g[i][j] += l2 * w[i][j];
    }

    // Adam 步
    step++;
    for (const key of ['W1', 'b1', 'W2', 'b2', 'W3', 'b3']) {
      const t = net[key]; const g = grads[key]; const st = adam[key];
      updateAdam(t, g, st, step, lr);
    }
    void loss; // 监控口（当前不透出训练曲线，LOFO 是最终裁判）
  }
  return net;
}

function zerosLike(t) {
  return Array.isArray(t[0]) ? t.map((row) => row.map(() => 0)) : t.map(() => 0);
}

function updateAdam(t, g, st, step, lr) {
  const beta1 = 0.9, beta2 = 0.999, eps = 1e-8;
  const c1 = 1 - Math.pow(beta1, step);
  const c2 = 1 - Math.pow(beta2, step);
  if (Array.isArray(t[0])) {
    for (let i = 0; i < t.length; i++) {
      for (let j = 0; j < t[i].length; j++) {
        const gi = g[i][j];
        st.m[i][j] = beta1 * st.m[i][j] + (1 - beta1) * gi;
        st.v[i][j] = beta2 * st.v[i][j] + (1 - beta2) * gi * gi;
        t[i][j] -= lr * (st.m[i][j] / c1) / (Math.sqrt(st.v[i][j] / c2) + eps);
      }
    }
  } else {
    for (let i = 0; i < t.length; i++) {
      const gi = g[i];
      st.m[i] = beta1 * st.m[i] + (1 - beta1) * gi;
      st.v[i] = beta2 * st.v[i] + (1 - beta2) * gi * gi;
      t[i] -= lr * (st.m[i] / c1) / (Math.sqrt(st.v[i] / c2) + eps);
    }
  }
}

/**
 * 训练集成（多网络均值）。
 * @returns {{arch:number[], nets:Array, nNets:number, seeds:number[]}}
 */
function trainEnsemble(rows, dIn, kOut, { nNets = N_NETS, epochs = EPOCHS, lr = LR, l2 = L2, seedBase = 20261030 } = {}) {
  const nets = [];
  const seeds = [];
  for (let i = 0; i < nNets; i++) {
    seeds.push(seedBase + i * 7919);
    nets.push(trainNet(rows, dIn, kOut, seeds[i], { epochs, lr, l2 }));
  }
  return { arch: [...ARCH, kOut], nets, nNets, seeds };
}

/** 序列化：量化到 4 位小数（体积换精度，tanh 界内足够） */
function serialize(ens) {
  const q = (t) => (Array.isArray(t[0]) ? t.map((r) => r.map((v) => Math.round(v * WEIGHT_QUANT) / WEIGHT_QUANT)) : t.map((v) => Math.round(v * WEIGHT_QUANT) / WEIGHT_QUANT));
  return {
    arch: ens.arch,
    nNets: ens.nNets,
    seeds: ens.seeds,
    nets: ens.nets.map((net) => ({
      W1: q(net.W1), b1: q(net.b1), W2: q(net.W2), b2: q(net.b2), W3: q(net.W3), b3: q(net.b3),
    })),
  };
}

/**
 * 置换重要性（训练侧近似）：逐特征列打乱测输出变化均值，逐参数头累计。
 * @returns {Object} {paramName: [{feature, score}...]}（score 越大该特征对该参数越要紧）
 */
function permutationImportance(ens, rows, featureNames, { repeats = 3 } = {}) {
  const K = ens.nets[0].W3.length;
  const base = rows.map((r) => predictEnsemble(ens, r.x));
  const acc = Array.from({ length: K }, () => ({}));
  for (let f = 0; f < featureNames.length; f++) {
    for (let rep = 0; rep < repeats; rep++) {
      // 打乱列 f（固定种子洗牌：可复现）
      const order = rows.map((_, i) => i);
      const rand = mulberry32(777 + f * 31 + rep);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const shuffled = rows.map((r, i) => {
        const x = r.x.slice();
        x[f] = rows[order[i]].x[f];
        return { r, x };
      });
      for (let i = 0; i < rows.length; i++) {
        const pred = predictEnsemble(ens, shuffled[i].x);
        for (let k = 0; k < K; k++) {
          if (rows[i].y[k] === null || rows[i].y[k] === undefined) continue;
          const d = Math.abs(pred[k] - base[i][k]);
          acc[k][featureNames[f]] = (acc[k][featureNames[f]] || 0) + d;
        }
      }
    }
  }
  const out = [];
  for (let k = 0; k < K; k++) {
    out.push(Object.entries(acc[k])
      .map(([feature, score]) => ({ feature, score: Math.round((score / (repeats * Math.max(1, rows.length))) * 1e5) / 1e5 }))
      .filter((e) => e.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 5));
  }
  return out;
}

module.exports = {
  ARCH, N_NETS, EPOCHS, LR, L2,
  mulberry32, forward, predictEnsemble, ensembleDispersion,
  trainNet, trainEnsemble, serialize, permutationImportance,
};
