/**
 * 排队池修复单测（2026-11-08 v99 曼波令「根据今天这情况把排队池机制修好 + 所有人可确认取件」）
 * 实案：R-011 取件闸挂 H2D → 同型号新单提交即「无可用机」转人工散伙（R20261107-001/002）。
 * 修复：①选机排队语义（持闸机不隐身，有空机优先空机）②取件闸 TTL 自动放行
 * ③确认取件全民化（登录即可）。
 * 用法：node test/stub-test-receipt-pool.js（PRINTER_HOSTS='' 隔离，不连生产打印机）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.DISPATCH_STATE_FILE = path.join(require('os').tmpdir(), `bambu-test-state-${Date.now()}.json`);

const dispatcher = require('../src/services/dispatcher');
const config = require('../src/config');
const { chooseMachineForSliced } = require('../src/services/machineLearning');

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

check('config：receiptTtlHours 默认 24、env 可覆盖', () => {
  assert.strictEqual(config.dispatch.receiptTtlHours, 24);
});

check('TTL 巡检：未超时闸保留、超时闸放行并触发匹配、manual-* 人工闸不受限', () => {
  const now = Date.now();
  // 未超时
  dispatcher.receiptHold.set(91, 'R-TEST-FRESH');
  dispatcher.receiptHoldAt.set(91, now - 3600 * 1000); // 1h 前
  // 超时（25h）
  dispatcher.receiptHold.set(92, 'R-TEST-EXPIRED');
  dispatcher.receiptHoldAt.set(92, now - 25 * 3600 * 1000);
  // 超时但人工置闸
  dispatcher.receiptHold.set(93, 'manual-test');
  dispatcher.receiptHoldAt.delete(93); // 人工置闸无计时源
  dispatcher.sweepReceiptHoldTtl();
  assert.ok(dispatcher.receiptHold.has(91), '未超时闸必须保留');
  assert.ok(!dispatcher.receiptHold.has(92), '超时闸必须自动放行');
  assert.ok(!dispatcher.receiptHoldAt.has(92), '放行时计时源同步清');
  assert.ok(dispatcher.receiptHold.has(93), '人工置闸（manual-*）不受 TTL 约束');
  // 清理
  dispatcher.receiptHold.delete(91);
  dispatcher.receiptHold.delete(93);
  dispatcher.receiptHoldAt.delete(91);
});

check('TTL=0 关闭巡检（env 显式 0 时不摘任何闸）', () => {
  const orig = config.dispatch.receiptTtlHours;
  config.dispatch.receiptTtlHours = 0;
  dispatcher.receiptHold.set(94, 'R-TEST-NO-TTL');
  dispatcher.receiptHoldAt.set(94, Date.now() - 100 * 3600 * 1000);
  dispatcher.sweepReceiptHoldTtl();
  assert.ok(dispatcher.receiptHold.has(94), 'TTL=0 必须不摘闸');
  config.dispatch.receiptTtlHours = orig;
  dispatcher.receiptHold.delete(94);
  dispatcher.receiptHoldAt.delete(94);
});

check('恢复兼容：旧档无 receiptHoldAt 键 → 闸按现在起算（不误摘）', () => {
  // restoreState 读 STATE_FILE——写入一个 v98 形态（无 receiptHoldAt）的档再恢复
  const stateFile = process.env.DISPATCH_STATE_FILE;
  fs.writeFileSync(stateFile, JSON.stringify({
    queue: [], printing: [], completedCount: [], known: [], givenUp: [],
    receiptHold: [[95, 'R-LEGACY']],
  }));
  dispatcher.restoreState();
  assert.ok(dispatcher.receiptHold.has(95), '旧档闸必须恢复');
  const at = dispatcher.receiptHoldAt.get(95);
  assert.ok(Number.isFinite(at) && Date.now() - at < 60 * 1000, '无计时源必须按现在起算（不误摘）');
  dispatcher.receiptHold.delete(95);
  dispatcher.receiptHoldAt.delete(95);
});

check('acknowledgeReceipt 幂等 + 摘闸清计时源', () => {
  dispatcher.receiptHold.set(96, 'R-TEST-ACK');
  dispatcher.receiptHoldAt.set(96, Date.now());
  const r1 = dispatcher.acknowledgeReceipt('R-TEST-ACK');
  assert.strictEqual(r1.held, true);
  assert.ok(!dispatcher.receiptHoldAt.has(96), '回执摘闸必须同步清计时源');
  const r2 = dispatcher.acknowledgeReceipt('R-TEST-ACK');
  assert.strictEqual(r2.held, false, '重复回执幂等');
});

check('静态锚：选机排队语义 + TTL 接线 + 回执全民化', () => {
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes('cand.map((p) => ({'), '选机候选必须全量传递（不再全局取舍挤掉持闸机）');
  assert.ok(resv.includes('held: holdHas(p.id)'), '候选必须带持闸标记（选机内部同型号内排序）');
  assert.ok(!resv.includes('candFree'), 'v105：全局「有空闲优先」取舍必须移除（异型号空机不得挤掉持闸同型号机）');
  assert.ok(resv.includes('本单排队待放行后自动开打'), '选中持闸机的选机依据必须注明排队');
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('sweepReceiptHoldTtl'), 'TTL 巡检方法必须存在');
  assert.ok(disp.includes("this.trigger('queue-sweep')") && disp.includes('receiptTtlTimer'), 'TTL 巡检必须挂周期定时器');
  assert.ok(disp.includes("startsWith('manual-')"), '人工置闸必须豁免 TTL');
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  const receiptSeg = idx.slice(idx.indexOf("/api/reservations/:id/receipt"), idx.indexOf("/api/reservations/:id/receipt") + 500);
  assert.ok(!receiptSeg.includes('assertCanManage'), '取件回执端点必须解除本人/reviewer 限制（v99 全民化）');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(/r\.status === '已完成' && !r\.receipt\s*\n?\s*\? `<button class="mini" onclick="ackReceipt/.test(front), '前端确认取件按钮必须对所有人可见');
});

check('v105 回归（陈同学实案）：持闸同型号机不被异型号空机挤出局——选中并注明排队', () => {
  // 场景还原 09:07 R20261109-002：H2D 持闸（R-001 等取件），四台异型号空闲
  const choice = chooseMachineForSliced(
    'Bambu Lab H2D',
    [
      { name: '闪铸A5P', model: 'AD5M Pro', held: false },
      { name: 'A1mini', model: 'A1 mini', held: false },
      { name: '闪铸C5P', model: 'Creator 5 Pro', held: false },
      { name: 'P1S', model: 'P1S', held: false },
      { name: 'H2D', model: 'H2D', held: true }, // 持闸：R-001 打完等取件
    ],
    [],
  );
  assert.strictEqual(choice.name, 'H2D', '同型号持闸机必须入选（排队语义），不得误报无同型号');
  assert.ok(/排队/.test(choice.basis), `basis 必须注明排队：${choice.basis}`);
  // 同型号有空闲兄弟机时持闸机让位
  const dual = chooseMachineForSliced(
    'Bambu Lab H2D',
    [
      { name: 'H2D-A', model: 'H2D', held: false },
      { name: 'H2D-B', model: 'H2D', held: true },
    ],
    [],
  );
  assert.strictEqual(dual.name, 'H2D-A', '同型号内无闸机优先');
});

process.exit(failures > 0 ? 1 : 0);
