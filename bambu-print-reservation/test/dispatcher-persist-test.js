/**
 * 分发引擎状态持久化往返测试（2026-09-13 口径：重启不丢队列）
 * 覆盖：落盘→重载恢复（队列/打印中/已知/完成计数）、known 截尾、损坏文件按空启动。
 * 用法：node test/dispatcher-persist-test.js（全通过退出码 0）
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

// 隔离：0 台打印机、禁广场写表；状态文件指向临时目录（必须在 require 前设置）
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
const STATE_FILE = path.join(os.tmpdir(), `dispatch-state-test-${Date.now()}.json`);
process.env.DISPATCH_STATE_FILE = STATE_FILE;
// failTask 播报会过静默闸门：积压文件也指向临时目录，别污染项目根的真实积压
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `quiet-backlog-test-${Date.now()}.json`);

const DISPATCHER_PATH = require.resolve('../src/services/dispatcher');
const dispatcher = require('../src/services/dispatcher');

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

/** 模拟重启：清 require 缓存重新加载单例 */
function freshDispatcher() {
  delete require.cache[DISPATCHER_PATH];
  return require('../src/services/dispatcher');
}

// ---------- 1. 构造状态 → 落盘 → 重载恢复 ----------
dispatcher.known = new Set(['r1', 'r2']);
dispatcher.queue = [
  { recordId: 'r1', applicationNo: '2026A', materialType: 'PLA', color: '红', isUrgent: true, applicant: { name: '甲' }, enqueuedAt: 1000 },
  { recordId: 'r2', applicationNo: '2026B', materialType: 'PETG', color: '黑', applicant: { name: '乙' } },
];
dispatcher.printing = new Map([[1, { recordId: 'r3', applicationNo: '2026C', fileName: 'x.3mf', startedAt: 2000 }]]);
dispatcher.completedCount = new Map([[1, 5]]);
dispatcher.flushState();

check('落盘文件已生成', () => assert.ok(fs.existsSync(STATE_FILE)));

const d2 = freshDispatcher();
d2.restoreState();
check('恢复：队列 2 条且加急在前数据一致', () => {
  assert.equal(d2.queue.length, 2);
  assert.equal(d2.queue[0].recordId, 'r1');
  assert.equal(d2.queue[0].isUrgent, true);
});
check('恢复：打印中映射（printerId=1 → r3）', () => {
  const t = d2.printing.get(1);
  assert.ok(t && t.recordId === 'r3' && t.startedAt === 2000);
});
check('恢复：known 含全部 recordId（含打印中）', () => {
  assert.ok(d2.known.has('r1') && d2.known.has('r2') && d2.known.has('r3'));
});
check('恢复：完成计数保留', () => assert.equal(d2.completedCount.get(1), 5));

// ---------- 2. known 截尾（防无限增长） ----------
d2.known = new Set(Array.from({ length: 3000 }, (_, i) => `old_${i}`));
d2.flushState();
const d3 = freshDispatcher();
d3.restoreState();
check('known 超 2000 条截尾保存（保留最新段，活动任务回加）', () => {
  assert.ok(d3.known.size <= 2003); // 保存截尾 2000 + 恢复时队列 2 + 打印中 1 回加
  assert.ok(d3.known.has('old_2999')); // 最新的保留
  assert.ok(!d3.known.has('old_0'));   // 最旧的截掉
  assert.ok(d3.known.has('r1') && d3.known.has('r3')); // 活动任务 id 由恢复逻辑回加
});

// ---------- 2.5 分发中断恢复：inFlight 任务重回队列并解除 known 拦截（B1） ----------
{
  const before = freshDispatcher();
  before.restoreState();
  before.known = new Set(['rX']);
  before.queue = [];
  before.inFlight = [{ recordId: 'rX', applicationNo: '2026X', fileSource: 'approval', fileToken: 'tok_x' }];
  before.flushState();
  const d = freshDispatcher();
  d.restoreState();
  check('分发中断任务恢复：重回队列', () => assert.ok(d.queue.some((t) => t.recordId === 'rX'), JSON.stringify(d.queue)));
  check('分发中断任务恢复：known 拦截已解除', () => assert.ok(!d.known.has('rX'), JSON.stringify([...d.known])));
}

// ---------- 3. 损坏文件 → 按空启动不抛 ----------
fs.writeFileSync(STATE_FILE, '{broken json!!');
const d4 = freshDispatcher();
d4.restoreState();
check('损坏状态文件按空队列启动', () => {
  assert.equal(d4.queue.length, 0);
  assert.equal(d4.printing.size, 0);
  assert.equal(d4.known.size, 0);
});

// ---------- 4. 文件缺失 → 静默跳过 ----------
// 损坏文件已被隔离改名（2026-10-08），此处幂等清理不假设文件在
try { fs.unlinkSync(STATE_FILE); } catch { /* 已被隔离改名 */ }
const d5 = freshDispatcher();
d5.restoreState();
check('状态文件缺失时静默跳过', () => assert.equal(d5.queue.length, 0));

// ---------- 5~7. givenUp 持久化 + failTask 重排/让位（2026-09-15 R8） ----------
(async () => {
  const d6 = freshDispatcher();
  d6.givenUp = new Map([['g1', { recordId: 'g1', applicationNo: '2026G', fileSource: 'approval', fileToken: 'tok_g' }]]);
  d6.flushState();
  const d7 = freshDispatcher();
  d7.restoreState();
  check('givenUp 重启后恢复（/print-dispatch 可继续找到）', () => {
    assert.ok(d7.givenUp instanceof Map && d7.givenUp.has('g1'), JSON.stringify([...d7.givenUp.keys()]));
  });

  const config = require('../src/config');
  const d8 = freshDispatcher();
  d8.givenUp = new Map();
  d8.trigger = () => {}; // 引擎未启动，屏蔽匹配循环副作用
  const mkTask = () => ({ recordId: 'f1', applicationNo: '2026F', fileSource: 'approval', fileToken: 'tok_f', applicant: { name: 't' } });

  async function failOnce(d) {
    const t = d.queue.find((x) => x.recordId === 'f1') || mkTask();
    d.queue = d.queue.filter((x) => x.recordId !== 'f1');
    d.printing = new Map([[9, t]]);
    await d.failTask(t, { id: 9, name: 'P9' }, '测试失败');
    return t;
  }

  const t1 = await failOnce(d8);
  check('运行期失败第 1 次：重新排队并带冷却', () => {
    assert.equal(d8.queue.length, 1);
    assert.equal(d8.queue[0].recordId, 'f1');
    assert.equal(t1.dispatchRetries, 1);
    assert.ok(t1.nextMatchAt > Date.now() - 1000, 'nextMatchAt 已设');
  });

  let exhaustedTask = null;
  // 热修68 复打熔断：30 分钟内二次失败不再重排，直接转 givenUp（误判上限钉在「多打一次」）
  const t2 = await failOnce(d8);
  check('30 分钟内二次失败：熔断转 givenUp 退出队列（热修68）', () => {
    assert.equal(d8.queue.length, 0);
    assert.ok(d8.givenUp.has('f1'), JSON.stringify([...d8.givenUp.keys()]));
    assert.equal(t2.dispatchRetries, 2);
  });

  // 慢失败路径（每次把 lastPrintFailAt 拨到窗口外）：仍按 maxRetries 累计耗尽
  d8.givenUp.delete('f1');
  const slowTask = mkTask();
  slowTask.lastPrintFailAt = 0;
  for (let i = 0; i < config.dispatch.maxRetries; i++) {
    slowTask.lastPrintFailAt = Date.now() - 31 * 60 * 1000; // 视为超窗口的历史失败
    d8.queue = []; // 模拟分发已把任务从队列取走（真实链路：dispatch 出队 → printing）
    d8.printing = new Map([[9, slowTask]]);
    await d8.failTask(slowTask, { id: 9, name: 'P9' }, '慢失败');
  }
  exhaustedTask = slowTask;
  check(`慢失败累计 ${config.dispatch.maxRetries} 次：进入 givenUp 退出队列`, () => {
    assert.equal(d8.queue.length, 0);
    assert.ok(d8.givenUp.has('f1'), JSON.stringify([...d8.givenUp.keys()]));
    assert.equal(exhaustedTask.dispatchRetries, config.dispatch.maxRetries);
  });

  d8.flushState();
  const d9 = freshDispatcher();
  d9.restoreState();
  check('failTask 让位任务随落盘恢复（与 5 呼应）', () => assert.ok(d9.givenUp.has('f1')));

  try { fs.unlinkSync(STATE_FILE); } catch { /* 已删 */ }
  console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();

