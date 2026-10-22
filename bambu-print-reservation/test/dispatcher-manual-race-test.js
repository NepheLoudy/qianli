/**
 * 分发互斥闸门测试（2026-09-13 竞态修复回归）：
 *   人工指定与自动匹配的分钟级 TOCTOU——dispatch 是下载/上传/下发的 await 链，
 *   printing 占用登记在链尾；无闸门时两路会对同一台打印机双双下发。
 *   验证：①分发中打印机对自动匹配不可见 ②并发 dispatch 第二路立即拒绝
 *        ③manualDispatch 分发中判定 ④链路完成后闸门释放、排队任务可继续分发
 *        ⑤manualDispatch 状态白名单（待审批/已完成拒绝，2026-09-27 审批绕过修复）
 *        ⑥idle 幽灵收尾（PRINTING→IDLE 无完成事件 → failTask 收尾，2026-09-27）
 *        ⑦白名单放行（已通过/排队中直发照常）。
 * 用法：node test/dispatcher-manual-race-test.js（全通过退出码 0）
 */
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.QUIET_HOURS_DISABLED = '1';

const path = require('path');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

// ---- 桩：外部依赖全部走桩，下载用可控 deferred 模拟分钟级 await 链 ----
const calls = { uploads: [], starts: [], tableWrites: [] };
let downloadGate = null; // { promise, resolve }
let reservationRecords = []; // manualDispatch 兜底拉单的表数据（守卫用例用）
const listeners = {};   // printerManager.on 注册的监听（idle 幽灵用例直接触发）
const PRINTER = { id: 1, name: 'P1', autoDispatch: true, status: '空闲', ams: [{ type: 'PLA', colorHex: '#FF0000' }] };
let availablePrinters = [PRINTER];

const stubs = {
  [path.join(ROOT, 'src/feishu/bitable.js')]: {
    updateRecord: async (tableId, id, fields) => { calls.tableWrites.push({ id, fields }); return {}; },
    getAllRecords: async () => reservationRecords,
  },
  [path.join(ROOT, 'src/feishu/client.js')]: {
    downloadFile: async () => Buffer.from('x'),
    downloadApprovalAttachment: () => downloadGate.promise,
  },
  [path.join(ROOT, 'src/feishu/bot.js')]: {
    sendMessage: async () => ({}),    buildJobFailedCard: () => ({}),
    buildJobCancelledCard: () => ({}),
    buildQueueCard: () => ({}),
    buildMaterialMissingCard: () => ({}),
  },
  [path.join(ROOT, 'src/utils/quietHours.js')]: {
    gatePayload: () => false,
    gateTask: () => false,
  },
  [path.join(ROOT, 'src/printer/manager.js')]: {
    getAvailablePrinters: () => availablePrinters,
    getAllPrinterStates: () => availablePrinters,
    getApiStates: () => [], // 回执丢失对账（reconcileLostAck）用：桩场景无在打机器
    getPrinterState: () => PRINTER,
    brandOf: () => 'bambu', // 2026-10-14 双品牌批：分发匹配按文件格式↔品牌隔离（桩固定拓竹）
    uploadFileToPrinter: async (id, buffer, remoteName) => { calls.uploads.push({ id, remoteName }); },
    startProjectOnPrinter: async (id, remoteName) => { calls.starts.push({ id, remoteName }); },
    updateState: () => {},
    stopPrintOnPrinter: async () => ({}),
    on: (event, cb) => { listeners[event] = cb; },
  },
  [path.join(ROOT, 'src/services/plaza.js')]: { append: () => {} },
};

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request.startsWith('.') && parent?.filename) {
    const abs = path.resolve(path.dirname(parent.filename), request);
    for (const key of Object.keys(stubs)) {
      if (abs === key || abs === key.replace(/\.js$/, '')) return key;
    }
  }
  return origResolve.call(this, request, parent, ...rest);
};
for (const [key, value] of Object.entries(stubs)) {
  require.cache[key] = new Module(key, null);
  require.cache[key].exports = value;
  require.cache[key].loaded = true;
}

const dispatcher = require(path.join(ROOT, 'src/services/dispatcher.js'));

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
}

function taskOf(rid, appNo) {
  return { recordId: rid, applicationNo: appNo, materialType: 'PLA', color: '红', fileSource: 'approval', fileToken: `tok_${rid}` };
}

(async () => {
  console.log('\n== 1. 分发中的打印机：闸门关闭 + 自动匹配不可见 ==');
  downloadGate = (() => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; })();
  const taskA = taskOf('rA', '2026A');
  const inFlight = dispatcher.dispatch(taskA, PRINTER);
  check('闸门已关闭（dispatching 含打印机）', dispatcher.dispatching.has(1));

  const taskB = taskOf('rB', '2026B');
  dispatcher.queue.push(taskB);
  await dispatcher.match('race-test');
  check('自动匹配跳过分发中打印机（任务仍在队，无第二次上传）',
    dispatcher.queue.some((t) => t.recordId === 'rB') && calls.uploads.length === 0,
    JSON.stringify({ queue: dispatcher.queue.map((t) => t.recordId), uploads: calls.uploads.length }));

  console.log('\n== 2. 并发 dispatch 第二路立即拒绝（不排队不上传） ==');
  let secondErr = '';
  try {
    await dispatcher.dispatch(taskOf('rC', '2026C'), PRINTER);
  } catch (err) { secondErr = err.message; }
  check('第二路 dispatch 抛「正在有任务分发中」', secondErr.includes('正在有任务分发中'), secondErr);
  check('被拒任务未离开队列（重试由后续触发）', !dispatcher.queue.some((t) => t.recordId === 'rC'));

  console.log('\n== 3. manualDispatch 分发中判定 ==');
  let manualErr = '';
  try {
    await dispatcher.manualDispatch('rB', 'P1');
  } catch (err) { manualErr = err.message; }
  check('manualDispatch 抛「正在有任务分发中」', manualErr.includes('正在有任务分发中'), manualErr);

  console.log('\n== 4. 链路完成：闸门释放，排队任务继续分发 ==');
  downloadGate.resolve(Buffer.from('file'));
  await inFlight;
  check('首任务完成占用登记', dispatcher.printing.get(1)?.recordId === 'rA');
  // 释放打印机（完成事件模拟）后 match 应把 rB 分发出去
  dispatcher.printing.delete(1);
  await dispatcher.match('race-test-after');
  check('闸门释放后排队任务正常分发（rB 上传）',
    calls.uploads.some((u) => u.remoteName === 'print_rB.3mf') && !dispatcher.queue.some((t) => t.recordId === 'rB'),
    JSON.stringify({ uploads: calls.uploads, queue: dispatcher.queue.map((t) => t.recordId) }));
  check('闸门最终清空', dispatcher.dispatching.size === 0);

  console.log('\n== 5. manualDispatch 状态白名单：待审批/已完成直发被拒（2026-09-27 审批绕过修复） ==');
  reservationRecords = [
    { record_id: 'rPend', fields: { 申请编号: '2026P', 申请状态: '待审批', 切片文件: [{ name: 'p.3mf', file_token: 'tok_p' }] } },
    { record_id: 'rDone', fields: { 申请编号: '2026D2', 申请状态: '已完成', 切片文件: [{ name: 'd.3mf', file_token: 'tok_d' }] } },
  ];
  calls.tableWrites.length = 0;
  const uploadsBeforeGuard = calls.uploads.length;
  let pendErr = '';
  try { await dispatcher.manualDispatch('rPend', 'P1'); } catch (err) { pendErr = err.message; }
  check('待审批单拒绝直发', pendErr.includes('不允许直接分发') && pendErr.includes('待审批'), pendErr);
  check('被拒单未上传未写表', calls.uploads.length === uploadsBeforeGuard && calls.tableWrites.length === 0,
    JSON.stringify({ uploads: calls.uploads.length, uploadsBeforeGuard, writes: calls.tableWrites }));
  let doneErr = '';
  try { await dispatcher.manualDispatch('rDone', 'P1'); } catch (err) { doneErr = err.message; }
  check('已完成单拒绝直发', doneErr.includes('不允许直接分发') && doneErr.includes('已完成'), doneErr);

  console.log('\n== 6. idle 幽灵收尾：PRINTING→IDLE 无完成事件 → printing 按 failTask 收尾（2026-09-27） ==');
  dispatcher.bindPrinterEvents(); // start() 未跑，手动注册 jobEvent 监听
  calls.tableWrites.length = 0;
  const ghost = { recordId: 'rGhost', applicationNo: '2026G', fileToken: 'tok_g', fileSource: 'mirror' };
  dispatcher.printing.set(1, ghost);
  listeners.jobEvent({ printer: PRINTER, event: 'idle' });
  await new Promise((r) => setTimeout(r, 30)); // failTask 异步收尾（写表+重排）
  check('幽灵任务已移出 printing（不再被新任务静默覆盖）', dispatcher.printing.get(1)?.recordId !== 'rGhost',
    JSON.stringify([...dispatcher.printing.keys()]));
  check('镜像表写回「排队中」', calls.tableWrites.some((w) => w.id === 'rGhost' && w.fields['申请状态'] === '排队中'),
    JSON.stringify(calls.tableWrites));
  check('幽灵任务带冷却重排进队列（重试通道）',
    dispatcher.queue.some((t) => t.recordId === 'rGhost' && t.nextMatchAt > Date.now()),
    JSON.stringify(dispatcher.queue.map((t) => t.recordId)));

  console.log('\n== 6b. FINISH→IDLE 终态清除不算幽灵失败（2026-10-19 P1S 真单假失败） ==');
  calls.tableWrites.length = 0;
  const keep = { recordId: 'rKeep', applicationNo: '2026K', fileToken: 'tok_k', fileSource: 'mirror', startedAt: Date.now() };
  dispatcher.printing.set(1, keep);
  listeners.jobEvent({ printer: PRINTER, event: 'idle', prevState: 'FINISH' });
  await new Promise((r) => setTimeout(r, 30));
  check('上一单 FINISH 清回 IDLE：新任务仍在 printing（不误判失败）',
    dispatcher.printing.get(1)?.recordId === 'rKeep', JSON.stringify([...dispatcher.printing.keys()]));
  check('终态清除不写回排队中', !calls.tableWrites.some((w) => w.id === 'rKeep'), JSON.stringify(calls.tableWrites));
  dispatcher.printing.delete(1);

  console.log('\n== 6c. 人工停机意图：failed 事件直接按取消收尾（不回排队，2026-10-19 曼波令） ==');
  calls.tableWrites.length = 0;
  const stopped = { recordId: 'rStop', applicationNo: '2026S', fileToken: 'tok_s', fileSource: 'mirror' };
  dispatcher.printing.set(1, stopped);
  dispatcher.markHumanStop(1, '控制台停止');
  check('停机意图写入任务（随状态落盘，重启仍有效）', stopped.humanStopRequested === true, JSON.stringify(stopped));
  listeners.jobEvent({ printer: { ...PRINTER, failReason: 0 }, event: 'failed' });
  await new Promise((r) => setTimeout(r, 30));
  check('人工停机任务已移出 printing', dispatcher.printing.get(1)?.recordId !== 'rStop', JSON.stringify([...dispatcher.printing.keys()]));
  check('状态直接写「已取消」（不是排队中）',
    calls.tableWrites.some((w) => w.id === 'rStop' && w.fields['申请状态'] === '已取消'),
    JSON.stringify(calls.tableWrites));
  check('人工停机不进入重排队列', !dispatcher.queue.some((t) => t.recordId === 'rStop'),
    JSON.stringify(dispatcher.queue.map((t) => t.recordId)));

  console.log('\n== 6d. 停止确认后立即收尾（不等事件）：finalizeHumanStop ==');
  calls.tableWrites.length = 0;
  const fin = { recordId: 'rFin', applicationNo: '2026F', fileToken: 'tok_f', fileSource: 'mirror' };
  dispatcher.printing.set(1, fin);
  const finId = await dispatcher.finalizeHumanStop(1, '控制台停止');
  check('finalizeHumanStop 返回被取消单号', finId === 'rFin', String(finId));
  check('立即写回已取消且移出 printing',
    dispatcher.printing.get(1)?.recordId !== 'rFin'
    && calls.tableWrites.some((w) => w.id === 'rFin' && w.fields['申请状态'] === '已取消'),
    JSON.stringify({ writes: calls.tableWrites, printing: [...dispatcher.printing.keys()] }));

  console.log('\n== 6e. 闪铸机端屏幕取消：idle+rawStatus canceling/cancel 按取消收尾（2026-10-23 热修47） ==');
  for (const raw of ['canceling', 'cancel']) {
    calls.tableWrites.length = 0;
    const screen = { recordId: 'rScreen' + raw, applicationNo: '2026N', fileToken: 'tok_n', fileSource: 'mirror' };
    dispatcher.printing.set(1, screen);
    dispatcher.queue.length = 0;
    listeners.jobEvent({ printer: { ...PRINTER, failReason: 0 }, event: 'idle', rawStatus: raw });
    await new Promise((r) => setTimeout(r, 30));
    check(`[${raw}] 机端取消任务已移出 printing`, dispatcher.printing.get(1)?.recordId !== 'rScreen' + raw,
      JSON.stringify([...dispatcher.printing.keys()]));
    check(`[${raw}] 状态写「已取消」（不是排队中）`,
      calls.tableWrites.some((w) => w.id === 'rScreen' + raw && w.fields['申请状态'] === '已取消'),
      JSON.stringify(calls.tableWrites));
    check(`[${raw}] 不重排进队列（不与人循环对抗）`, !dispatcher.queue.some((t) => t.recordId === 'rScreen' + raw),
      JSON.stringify(dispatcher.queue.map((t) => t.recordId)));
  }

  console.log('\n== 7. 状态白名单放行：「已通过」单人工直发照常工作 ==');
  reservationRecords = [
    { record_id: 'rOK', fields: { 申请编号: '2026OK', 申请状态: '已通过', 切片文件: [{ name: 'ok.3mf', file_token: 'tok_ok' }] } },
  ];
  calls.tableWrites.length = 0;
  const manualRes = await dispatcher.manualDispatch('rOK', 'P1');
  check('已通过单直发成功（manualOnly=false）', manualRes.manualOnly === false, JSON.stringify(manualRes));
  check('直发上传并写入打印中状态',
    calls.uploads.some((u) => u.remoteName === 'print_rOK.3mf')
    && calls.tableWrites.some((w) => w.id === 'rOK' && w.fields['申请状态'] === '打印中'),
    JSON.stringify({ uploads: calls.uploads, writes: calls.tableWrites }));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('测试执行异常:', err);
  process.exit(1);
});
