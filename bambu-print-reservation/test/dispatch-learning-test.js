/**
 * 分发学习器单测（2026-11-05 P2 审查批）：dispatchLearning 零专属测试 → 补齐
 * 覆盖：null-est 不进中位数（durationBias）、queueWait 取紧邻「打印中」的排队
 * 轨迹（失败重排单不虚高）、recommendBySpeed basis 文案与实际采样路径一致、
 * 输出结构（升序/字段）。
 * 用法：node test/dispatch-learning-test.js
 * 纯函数测试：不 require dispatcher/store——dispatchLearning 只收 records 数组，
 * 零环境隔离需求（模块顶层无 env 读取、无 IO）。
 */
const assert = require('assert');
const dl = require('../src/services/dispatchLearning');

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

const T = (iso) => Date.parse(iso);

// ---------- 造样本工具 ----------
function rec(dispatchStats, history) {
  return { id: `R-${Math.random().toString(36).slice(2, 8)}`, printer: dispatchStats && dispatchStats.printer, dispatchStats, history };
}
function hist(entries) {
  // entries: [[minutesOffset, to], ...] 相对 t0 的分钟偏移
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  return entries.map(([m, to]) => ({ at: new Date(t0 + m * 60000).toISOString(), from: null, to, note: '' }));
}

// ---------- ① durationBias：null est 不进中位数 ----------

check('durationBias：null estMinutes 不混入中位数（老单不拉低 estMedian）', () => {
  const records = [
    rec({ printer: 'P1', estMinutes: 100, actualMinutes: 120 }, null),
    rec({ printer: 'P1', estMinutes: 200, actualMinutes: 240 }, null),
    rec({ printer: 'P1', estMinutes: null, actualMinutes: 300 }, null), // 老单：est 不可补
  ];
  const bias = dl.durationBias(records);
  assert.ok(bias.P1, 'P1 应有统计');
  assert.equal(bias.P1.n, 3, '样本数含老单（actMedian 用得上）');
  assert.equal(bias.P1.estMedian, 150, 'estMedian 应只算 100/200 的中位 150，null 不当 0');
  assert.equal(bias.P1.actualMedian, 240, 'actMedian 三值中位 240');
  assert.equal(bias.P1.bias, Math.round((240 / 150) * 100) / 100, 'bias=actMed/estMed');
  assert.equal(bias.P1.actualOnly, false, '有 est 样本时 actualOnly=false');
});

check('durationBias：全 null est 的机器——actualOnly=true、bias=null（不消失）', () => {
  const records = [
    rec({ printer: 'P2', estMinutes: null, actualMinutes: 50 }, null),
    rec({ printer: 'P2', estMinutes: null, actualMinutes: 70 }, null),
  ];
  const bias = dl.durationBias(records);
  assert.equal(bias.P2.estMedian, null, 'estMedian 应为 null 而非 0');
  assert.equal(bias.P2.bias, null, 'bias 未知');
  assert.equal(bias.P2.actualOnly, true, '校准系数标记 unavailable');
  assert.equal(bias.P2.actualMedian, 60, 'actMedian 照常可用');
});

check('durationBias：无 actualMinutes 的记录整体不进统计（collectStats 门槛）', () => {
  const records = [
    rec({ printer: 'P3', estMinutes: 100, actualMinutes: 120 }, null),
    rec({ printer: 'P3', estMinutes: 100, actualMinutes: null }, null), // actual 缺：整条剔除
    rec({ printer: 'P3', estMinutes: 100 }, null), // actual 无字段：剔除
  ];
  const bias = dl.durationBias(records);
  assert.equal(bias.P3.n, 1);
});

// ---------- ② queueWaitByPrinter：取紧邻「打印中」的排队轨迹 ----------

check('queueWait：常规单（排队→打印中）直算', () => {
  const records = [rec(null, hist([[0, '待审批'], [30, '排队中'], [75, '打印中'], [200, '已完成']]))];
  records[0].printer = 'PA';
  const q = dl.queueWaitByPrinter(records);
  assert.equal(q.PA.median, 45, '排队 30 → 开打 75，等待 45 分钟');
  assert.equal(q.PA.n, 1);
});

check('queueWait：失败重排单——等待取紧邻开打的那次排队，含重试+冷却的首次排队不计', () => {
  // 首次排队 0 分，失败重排在 120 分（含 60 分冷却+重试），实际开打 180 分
  // 旧口径（首个排队）会算 180 分钟；新口径应算 60 分钟
  const records = [rec(null, hist([
    [0, '排队中'], [30, '打印中'], [90, '排队中'], // 首轮：30 分开打 90 分失败
    [120, '排队中'], [180, '打印中'], [400, '已完成'], // 重排：120 分再排队，180 分开打
  ]))];
  records[0].printer = 'PB';
  const q = dl.queueWaitByPrinter(records);
  assert.equal(q.PB.median, 60, '应取紧邻第二次开打的排队（180-120=60），非首次（180-0=180）');
});

check('queueWait：打印中前无排队轨迹（直通/历史不全）——不计入', () => {
  const records = [rec(null, hist([[0, '待审批'], [50, '打印中'], [100, '已完成']]))];
  records[0].printer = 'PC';
  const q = dl.queueWaitByPrinter(records);
  assert.equal(q.PC, undefined, '无排队轨迹不应产出该机统计');
});

check('queueWait：负等待（时间戳乱序）与超 48h（脏数据）剔除', () => {
  const t0 = Date.UTC(2026, 10, 1, 0, 0, 0);
  const mk = (qMin, pMin) => ({
    printer: 'PD',
    history: [
      { at: new Date(t0 + qMin * 60000).toISOString(), from: null, to: '排队中', note: '' },
      { at: new Date(t0 + pMin * 60000).toISOString(), from: null, to: '打印中', note: '' },
    ],
  });
  const q = dl.queueWaitByPrinter([mk(100, 50), mk(0, 100), mk(0, 60 * 50)]);
  assert.equal(q.PD.n, 1, '只有合法等待（100 分）入统计：负值/超 48h 剔除');
  assert.equal(q.PD.median, 100);
});

// ---------- ③ recommendBySpeed：basis 文案与实际采样一致 ----------

function statsRec(printer, vol, actual) {
  return rec({ printer, estMinutes: 100, actualMinutes: actual, volumeCm3: vol }, null);
}

check('recommend：同量级样本 ≥2——basis 声称「（同体积量级）」且 n=同量级池', () => {
  const records = [
    statsRec('M1', 10, 60), statsRec('M1', 20, 80), statsRec('M1', 500, 600), // 两条同量级(10±) + 一条远量级
  ];
  const out = dl.recommendBySpeed({ volumeCm3: 15, material: 'PLA' }, [{ name: 'M1', model: 'X1C' }], records);
  assert.equal(out.length, 1);
  assert.ok(out[0].basis.includes('（同体积量级）'), `basis 应含同体积量级标注: ${out[0].basis}`);
  assert.equal(out[0].n, 2, 'n 应为同量级池 2 条');
  assert.equal(out[0].predictedMedian, 70, '中位取同量级池 (60+80)/2');
});

check('recommend：vol 提供但同量级 <2 退回全机池——basis 不再误称「（同体积量级）」', () => {
  const records = [
    statsRec('M2', 500, 400), statsRec('M2', 800, 500), // 与 vol=10 差多个量级
  ];
  const out = dl.recommendBySpeed({ volumeCm3: 10, material: 'PLA' }, [{ name: 'M2', model: 'A1' }], records);
  assert.equal(out.length, 1);
  assert.ok(!out[0].basis.includes('（同体积量级）'), `退回全机池时 basis 不应声称同体积量级: ${out[0].basis}`);
  assert.ok(out[0].basis.includes('同机'), 'basis 仍应说明同机口径');
  assert.equal(out[0].n, 2, 'n=全机池 2 条');
});

check('recommend：无 vol——basis 全机口径不带量级标注', () => {
  const records = [statsRec('M3', 10, 60), statsRec('M3', 500, 600)];
  const out = dl.recommendBySpeed({}, [{ name: 'M3', model: 'P1S' }], records);
  assert.equal(out.length, 1);
  assert.ok(!out[0].basis.includes('（同体积量级）'), '无 vol 不带量级标注');
  assert.equal(out[0].predictedMedian, 330, '全池中位 (60+600)/2');
});

check('recommend：输出结构——按 predictedMedian 升序（快者先）+ 字段齐', () => {
  const records = [
    statsRec('FAST', 10, 30), statsRec('SLOW', 10, 300), statsRec('MID', 10, 100),
  ];
  const out = dl.recommendBySpeed({ volumeCm3: 10 }, [
    { name: 'SLOW', model: 'X1C' }, { name: 'MID', model: 'P1S' }, { name: 'FAST', model: 'A1' },
  ], records);
  assert.deepEqual(out.map((x) => x.name), ['FAST', 'MID', 'SLOW'], '升序：快者先');
  for (const m of out) {
    assert.ok(Number.isFinite(m.predictedMedian), `${m.name} predictedMedian 应为有限数`);
    assert.ok(m.n >= 1 && typeof m.basis === 'string' && m.basis.includes('n='), `${m.name} basis 应含样本数`);
  }
});

check('recommend：无样本机器不入榜（med=null continue）', () => {
  const out = dl.recommendBySpeed({ volumeCm3: 10 }, [{ name: 'EMPTY', model: 'X1C' }], [statsRec('OTHER', 10, 30)]);
  assert.equal(out.length, 0, '无历史样本的机器不应产出条目');
});

// ---------- 收尾 ----------

console.log(failures === 0 ? `\n全部通过（${pass} 项）` : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
