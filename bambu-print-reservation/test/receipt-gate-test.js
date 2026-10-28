// 取件回执闸单测（2026-10-28 曼波令「第一个件打完了在预约界面要回执才行」）：
// completeTask 置闸 → 该机被匹配层排除 → acknowledgeReceipt 清闸恢复 + 单据落回执
const os = require('os');
const path = require('path');
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-rg-res-${process.pid}.json`);
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-rg-up-${process.pid}`);
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-rg-ds-${process.pid}.json`);
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-rg-qb-${process.pid}.json`);
process.env.QUIET_HOURS_DISABLED = '1';
process.env.BOT_WEBHOOK_URL = '';
process.env.AUTH_STORE_FILE = path.join(os.tmpdir(), `bambu-test-rg-auth-${process.pid}.json`);
process.env.PROCESS_RULES_FILE = path.join(os.tmpdir(), `bambu-test-rg-rules-${process.pid}.json`);
process.env.RULE_SUGGESTIONS_FILE = path.join(os.tmpdir(), `bambu-test-rg-sug-${process.pid}.json`);
process.env.TRAINING_SAMPLES_FILE = path.join(os.tmpdir(), `bambu-test-rg-train-${process.pid}.json`);
process.env.TRAINING_FILES_DIR = path.join(os.tmpdir(), `bambu-test-rg-trainfiles-${process.pid}`);
// 阻断真机连接（2026-10-16 二踩教训：manager require 即连生产）
process.env.PRINTER_HOSTS = '';
process.env.PRINTER_ACCESS_CODES = '';
process.env.PRINTER_SERIALS = '';
process.env.PRINTER_NAMES = '';
process.env.PRINTER_MODELS = '';

const assert = require('assert');
const fs = require('fs');

let pass = 0;
let fail = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

async function main() {
  const dispatcher = require('../src/services/dispatcher');
  const store = require('../src/services/reservationStore');

  const printer = { id: 'p1', name: 'X1C', model: 'X1C', autoDispatch: true, status: '空闲', ams: [{ slot: 'AMS 0', amsId: 0, trayId: 0, type: 'PLA' }] };
  const task = { recordId: 'R-RT-1', applicationNo: 'R-RT-1', fileName: 'part.gcode.3mf', materialType: 'PLA', quantity: 1 };

  checks.push(['无闸：同品牌空闲机可被选中', async () => {
    const hit = dispatcher.matchPrinter(task, [printer]);
    assert.strictEqual(hit && hit.id, 'p1');
  }]);

  checks.push(['置闸：该机被匹配层排除（打完等回执）', async () => {
    dispatcher.receiptHold.set('p1', 'R-RT-1');
    const hit = dispatcher.matchPrinter(task, [printer]);
    assert.strictEqual(hit, null, '持闸机器不可选');
    assert.strictEqual(dispatcher.listReceiptHold().length, 1);
  }]);

  checks.push(['回执：清闸 + 匹配恢复（幂等：再回执 held:false）', async () => {
    const ack1 = dispatcher.acknowledgeReceipt('R-RT-1');
    assert.strictEqual(ack1.held, true);
    assert.strictEqual(ack1.printerId, 'p1');
    assert.strictEqual(dispatcher.matchPrinter(task, [printer]).id, 'p1', '清闸后恢复可选');
    const ack2 = dispatcher.acknowledgeReceipt('R-RT-1');
    assert.strictEqual(ack2.held, false, '重复回执幂等');
  }]);

  checks.push(['回执落档：终态单 receipt+history；非终态 400', async () => {
    const rec = store.create({ applicant: '测试员', fileName: 'a.3mf', filePath: '/tmp/a.3mf', selection: { temp_class: 't50' } });
    assert.throws(() => store.acknowledgeReceipt(rec.id, { displayName: '张三', id: 'u1' }), /只有打完的单/, '排队中单不可回执');
    for (const st of ['已通过', '排队中', '打印中', '已完成']) store.updateStatus(rec.id, st, `测试流转→${st}`);
    const out = store.acknowledgeReceipt(rec.id, { displayName: '张三', id: 'u1' });
    assert.strictEqual(out.receipt.by, '张三');
    assert.ok(out.history.some((h) => /取件回执/.test(h.note || '')), 'history 落回执记录');
    const again = store.acknowledgeReceipt(rec.id, { displayName: '李四', id: 'u2' });
    assert.strictEqual(again.receipt.by, '李四', '重复回执覆盖为最新');
  }]);

  checks.push(['状态落盘：receiptHold 进 statePayload 且可恢复', async () => {
    dispatcher.receiptHold.set('p2', 'R-RT-2');
    const payload = JSON.parse(JSON.stringify(dispatcher.statePayload()));
    assert.ok(payload.receiptHold.some(([pid, rid]) => pid === 'p2' && rid === 'R-RT-2'), 'payload 含闸');
    dispatcher.receiptHold.delete('p2');
  }]);

  for (const [name, fn] of checks) {
    try { await fn(); console.log(`✓ ${name}`); pass++; }
    catch (err) { console.error(`✗ ${name}\n  ${err.message}`); fail++; }
  }
  console.log(`\n取件回执闸单测: ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
