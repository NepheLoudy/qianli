/**
 * 存储熔断单测（2026-11-16 v112 曼波令「553 自动熔断」批准落地）
 * 实案：X1C 11-08 与 H2D 11-15 先后存储掉挂载（U 盘被拔），各烧 3 次重试才被发现，
 * 后续单子排队陪葬。机制：553+sdcard=false → 该机熔断停派+任务回队列不计数+DM 申请人；
 * sdcard 恢复（热插回/重启后固件重挂载）→ sweep 自动解除+恢复队列。
 * 用法：node test/stub-test-storage-hold.js（环境隔离不连生产）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-storage-${Date.now()}.json`);

const dispatcher = require('../src/services/dispatcher');
const printerManager = require('../src/printer/manager');

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

check('storageHold 结构存在（内存态，不落盘）', () => {
  assert.ok(dispatcher.storageHold instanceof Map);
  const payload = dispatcher.statePayload();
  assert.ok(!('storageHold' in payload), '熔断状态刻意不持久化——服务重启即清零重评估');
});

check('sweepStorageHold：sdcard 恢复 true 自动解除；未恢复/失联保持熔断', () => {
  // 未恢复：熔断保留
  dispatcher.storageHold.set(91, { at: Date.now(), recordId: 'R-HOLD-A' });
  dispatcher.sweepStorageHold();
  assert.ok(dispatcher.storageHold.has(91), '机队里查无此机（失联）必须保持熔断');
  // 恢复：解除（updateState 对未知 id 静默忽略——测试直接注入 printerStates）
  printerManager.printerStates[92] = { id: 92, name: '测试机', status: '空闲', raw: { print: { sdcard: true } } };
  dispatcher.storageHold.set(92, { at: Date.now() - 60000, recordId: 'R-HOLD-B' });
  dispatcher.sweepStorageHold();
  assert.ok(!dispatcher.storageHold.has(92), 'sdcard=true 必须自动解除');
  // 未恢复：sdcard=false 保持
  printerManager.printerStates[93] = { id: 93, name: '掉卡机', status: '空闲', raw: { print: { sdcard: false } } };
  dispatcher.storageHold.set(93, { at: Date.now(), recordId: 'R-HOLD-C' });
  dispatcher.sweepStorageHold();
  assert.ok(dispatcher.storageHold.has(93), 'sdcard=false 必须保持熔断');
  dispatcher.storageHold.delete(91);
  dispatcher.storageHold.delete(93);
  delete printerManager.printerStates[92];
  delete printerManager.printerStates[93];
});

check('静态锚：熔断三件套（标记/过滤/解除）与播报 DM 接线', () => {
  const client = fs.readFileSync(path.join(__dirname, '../src/printer/client.js'), 'utf8');
  assert.ok(client.includes('e.storageOffline = true'), 'client 层必须打 storageOffline 标记');
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('!this.storageHold.has(p.id)'), 'matchPrinter 候选必须过滤熔断机器');
  assert.ok(disp.includes('if (err.storageOffline)'), '分发 catch 必须识别熔断标记');
  assert.ok(disp.includes('sweepStorageHold'), '解除巡检必须存在');
  assert.ok(disp.includes('notifyApplicantDm(task.recordId'), '熔断必须 DM 申请人');
  assert.ok(disp.includes('存储熔断'), '必须留人话日志/播报');
});

process.exit(failures > 0 ? 1 : 0);
