// 取件码回执单测（2026-10-29 曼波令「完成私信询问是否取件，回复后清机端状态」）
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pickup-'));
process.env.RESERVATIONS_STORE_FILE = path.join(tmp, 'res.json');
process.env.RESERVATIONS_UPLOAD_DIR = path.join(tmp, 'up');
process.env.DISPATCH_STATE_FILE = path.join(tmp, 'ds.json');
process.env.QUIET_BACKLOG_FILE = path.join(tmp, 'qb.json');
process.env.QUIET_HOURS_DISABLED = '1';
process.env.BOT_WEBHOOK_URL = '';
process.env.AUTH_STORE_FILE = path.join(tmp, 'auth.json');
process.env.PROCESS_RULES_FILE = path.join(tmp, 'rules.json');
process.env.RULE_SUGGESTIONS_FILE = path.join(tmp, 'sug.json');
process.env.TRAINING_SAMPLES_FILE = path.join(tmp, 'train.json');
process.env.TRAINING_FILES_DIR = path.join(tmp, 'tf');
process.env.PRINTER_HOSTS = '';
process.env.PRINTER_ACCESS_CODES = '';
process.env.PRINTER_SERIALS = '';
process.env.PRINTER_NAMES = '';
process.env.PRINTER_MODELS = '';

const assert = require('assert');
let pass = 0; let fail = 0;
const checks = [];
function check(n, f) { checks.push([n, f]); }

async function main() {
  const dispatcher = require('../src/services/dispatcher');
  const store = require('../src/services/reservationStore');
  const manager = require('../src/printer/manager');

  function makeDoneOrder(id) {
    const rec = store.create({ applicant: '甲', submittedBy: 'u-t1', fileName: 'a.3mf', filePath: path.join(tmp, 'a.3mf'), selection: { temp_class: 't50' } });
    for (const st of ['已通过', '排队中', '打印中', '已完成']) store.updateStatus(rec.id, st, `→${st}`);
    return rec.id;
  }

  check('发码 → 回执成功：闸清 + 单据落回执 + 清机端被调用', async () => {
    const rid = makeDoneOrder();
    dispatcher.receiptHold.set('4', rid);
    const { code } = dispatcher.issuePickupCode('4', rid);
    assert.ok(/^\d{6}$/.test(code), '6 位码');
    let cleanedWith = null;
    const origClean = manager.cleanPrintErrorOnPrinter;
    manager.cleanPrintErrorOnPrinter = async (pid) => { cleanedWith = pid; return { cleared: true }; };
    try {
      const r = await dispatcher.confirmPickupByCode(code, 'ou_test', () => '');
      assert.strictEqual(r.recordId, rid);
      assert.strictEqual(r.queueResumed, true, '持闸 → 放行');
      assert.strictEqual(cleanedWith, 4, '清机端用数字 id');
      assert.ok(!dispatcher.receiptHold.has('4'), '闸已清');
      const rec = store.get(rid);
      assert.ok(rec.receipt && rec.receipt.by, '单据落回执');
    } finally { manager.cleanPrintErrorOnPrinter = origClean; }
  });

  check('一次性：同码二次使用报无效', async () => {
    const rid = makeDoneOrder();
    dispatcher.receiptHold.set('4', rid);
    const { code } = dispatcher.issuePickupCode('4', rid);
    const origClean = manager.cleanPrintErrorOnPrinter;
    manager.cleanPrintErrorOnPrinter = async () => ({ cleared: true });
    try { await dispatcher.confirmPickupByCode(code, 'ou_test', () => ''); } finally { manager.cleanPrintErrorOnPrinter = origClean; }
    await assert.rejects(() => dispatcher.confirmPickupByCode(code, 'ou_test', () => ''), /无效或已使用/);
  });

  check('归属校验：账号已绑飞书 → 非本人回复被拒', async () => {
    const rid = makeDoneOrder();
    dispatcher.receiptHold.set('4', rid);
    const { code } = dispatcher.issuePickupCode('4', rid);
    await assert.rejects(() => dispatcher.confirmPickupByCode(code, 'ou_stranger', () => 'ou_owner'), /不属于你的账号/);
    assert.ok(dispatcher.pickupCodes.has(code), '被拒时码未被消费');
  });

  check('过期：TTL 后报过期并清理', async () => {
    const rid = makeDoneOrder();
    const { code } = dispatcher.issuePickupCode('4', rid);
    dispatcher.pickupCodes.get(code).expiresAt = Date.now() - 1;
    await assert.rejects(() => dispatcher.confirmPickupByCode(code, 'ou_x', () => ''), /已过期/);
    assert.ok(!dispatcher.pickupCodes.has(code), '过期码已删');
  });

  check('清机端失败不影响回执（只记日志）', async () => {
    const rid = makeDoneOrder();
    dispatcher.receiptHold.set('4', rid);
    const { code } = dispatcher.issuePickupCode('4', rid);
    const origClean = manager.cleanPrintErrorOnPrinter;
    manager.cleanPrintErrorOnPrinter = async () => { throw new Error('打印机未连接'); };
    try {
      const r = await dispatcher.confirmPickupByCode(code, 'ou_test', () => '');
      assert.ok(r.cleaned && r.cleaned.error, '记录清理失败');
      assert.ok(!dispatcher.receiptHold.has('4'), '闸照样清');
    } finally { manager.cleanPrintErrorOnPrinter = origClean; }
  });

  check('重发同单：旧码作废（一单一码）', async () => {
    const rid = makeDoneOrder();
    const a = dispatcher.issuePickupCode('4', rid);
    const b = dispatcher.issuePickupCode('4', rid);
    assert.ok(!dispatcher.pickupCodes.has(a.code), '旧码作废');
    assert.ok(dispatcher.pickupCodes.has(b.code), '新码有效');
  });

  check('manual- 占位码不发取件码', async () => {
    assert.strictEqual(dispatcher.issuePickupCode('4', 'manual-abc'), null);
  });

  for (const [n, f] of checks) {
    try { await f(); console.log(`✓ ${n}`); pass++; }
    catch (e) { console.error(`✗ ${n}\n  ${e.message}`); fail++; }
  }
  console.log(`\n取件码回执单测: ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
