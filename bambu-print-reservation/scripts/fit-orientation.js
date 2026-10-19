#!/usr/bin/env node
// 摆向策略学习体检/拟合 CLI（2026-10-19）
// 用法：node scripts/fit-orientation.js [--fit] [--min-rows 6] [--min-families 3]
//   默认只输出样本库体检；--fit 额外跑权重网格 + LOFO 并打印策略。
//   candidate 只写 orientation-policy.json 的 candidate 状态，不自动生效。
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const trainingStore = require('../src/services/trainingStore');
const fitter = require('../src/services/orientationFitter');
const policyStore = require('../src/services/orientationPolicyStore');

const args = process.argv.slice(2);
const argOf = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

(async () => {
  const samples = trainingStore.list();
  const audit = fitter.auditSamples(samples);
  console.log('=== 样本库体检 ===');
  console.log(JSON.stringify(audit, null, 2));
  const snapshot = policyStore.getSnapshot();
  console.log('=== 当前策略 ===');
  console.log(snapshot ? JSON.stringify({ status: snapshot.status, policy: snapshot.policy, adoptedAt: snapshot.adoptedAt }, null, 2) : '(无)');
  if (!args.includes('--fit')) return;
  console.log('=== 拟合 ===');
  const result = await fitter.fitOrientationPolicy(samples, {
    minRows: Number(argOf('--min-rows', fitter.MIN_ROWS)),
    minFamilies: Number(argOf('--min-families', fitter.MIN_FAMILIES)),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.policy) {
    const saved = policyStore.saveCandidate(result.policy, result.stats);
    console.log(`已写候选策略：${policyStore.FILE}（status=${saved.status}，需人工 adopt）`);
  }
})().catch((err) => { console.error(err.stack || err.message); process.exit(1); });
