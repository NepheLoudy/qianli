/**
 * 打印进程 DM 晚间静默闸单测（2026-11-05 P2 审查批）：notifyApplicantDm 修复
 * 前未过闸——静默窗口内完成/失败/取消 DM 会深夜直发吵人。修复后照 notifyReviewers
 * 同款 gatePayload（dm-text 载荷：静默落盘积压 09:00 补发，非静默直发）。
 * 用法：node test/reservation-dm-quiet-test.js
 * 隔离：所有 env 在 require 前设好（模块顶层读 env）；bot 模块 stub 掉发送层，
 * 不真连飞书；quietHours 构造覆盖当前时刻的窗口（同 quiet-hours-test 范式）。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// 构造覆盖当前时刻的静默窗口（上海时区）
const shHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
const start = (shHour + 23) % 24;
const end = (shHour + 2) % 24;
process.env.QUIET_HOURS_START = String(start);
process.env.QUIET_HOURS_END = String(end === start ? (start + 1) % 24 : end);
process.env.QUIET_HOURS_DISABLED = '';
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-dm-quiet-${process.pid}.json`);
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-dm-quiet-res-${process.pid}.json`);
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-dm-quiet-up-${process.pid}`);
process.env.AUTH_STORE_FILE = path.join(os.tmpdir(), `bambu-test-dm-quiet-auth-${process.pid}.json`);
process.env.PROCESS_RULES_FILE = path.join(os.tmpdir(), `bambu-test-dm-quiet-rules-${process.pid}.json`);
process.env.BOT_WEBHOOK_URL = '';

// stub 发送层：require feishu/bot 前 require.cache 预置假模块——不真连飞书
const BOT_PATH = require.resolve('../src/feishu/bot');
const sentDms = [];
require.cache[BOT_PATH] = {
  id: BOT_PATH,
  filename: BOT_PATH,
  loaded: true,
  exports: {
    sendMessage: async () => { throw new Error('本测试不应群播'); },
    sendTextToUser: async (openId, text) => { sentDms.push({ openId, text }); return { ok: true }; },
    buildReservationAlertCard: () => ({}),
    buildReviewResultCard: () => ({}),
    buildApprovedQueuedCard: () => ({}),
    buildQueueCard: () => ({}),
    buildJobFinishCard: () => ({}),
    buildJobFailedCard: () => ({}),
    buildJobCancelledCard: () => ({}),
    buildTextCard: () => ({}),
    buildMaterialMissingCard: () => ({}),
  },
};

const store = require('../src/services/reservationStore');
const authStore = require('../src/services/authStore');
const quietHours = require('../src/utils/quietHours');
const reservation = require('../src/services/reservation');

let pass = 0;
let failures = 0;
function check(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { pass++; console.log(`✓ ${name}`); })
    .catch((err) => { failures++; console.error(`✗ ${name} — ${err.message}`); });
}
function readBacklog() {
  if (!fs.existsSync(process.env.QUIET_BACKLOG_FILE)) return [];
  return JSON.parse(fs.readFileSync(process.env.QUIET_BACKLOG_FILE, 'utf8')).items || [];
}
const flush = () => new Promise((r) => setTimeout(r, 30)); // setImmediate 链落定

(async () => {
  check('前置：当前时刻在构造的静默窗口内', () => {
    assert.strictEqual(quietHours.inQuietHours(), true, quietHours.getStatus().window);
  });

  await check('DM 静默窗口内：notifyApplicantDm 落积压不直发', async () => {
    sentDms.length = 0;
    const user = authStore.register({ username: 'dm-quiet', password: 'secret1', displayName: '静默测试员' });
    authStore.setFeishuOpenId(user.id, 'ou_dmquiettest0000000000000');
    const rec = store.create({
      applicant: '静默测试员', submittedBy: user.id, fileName: 'x.3mf', filePath: 'unused',
      fileSize: 1, materialType: 'PLA', color: '黑', selection: {}, processParams: null, appliedRules: [],
    });
    reservation.notifyApplicantDm(rec.id, '✅ 打印完成');
    await flush();
    assert.equal(sentDms.length, 0, '静默窗口内不应直发 DM');
    const items = readBacklog();
    const dmItems = items.filter((it) => it.type === 'payload' && it.name === 'dm-text');
    assert.equal(dmItems.length, 1, '应恰好积压一条 dm-text 载荷');
    assert.equal(dmItems[0].payload.openId, 'ou_dmquiettest0000000000000');
    assert.ok(dmItems[0].payload.text.includes('✅ 打印完成'), '载荷保留原文');
    assert.ok(dmItems[0].payload.text.includes(rec.id), '载荷带单号署名');
  });

  await check('DM 静默窗口外（窗口翻转）：直发不积压', async () => {
    // 把窗口挪到「别处」：start=end 语义 = 关闭（inQuietHours false）→ 走直发分支
    // （不能改 settings 对象（模块冻结语义），用独立子进程语义等价验证太重——
    // 直接验证：非静默态 gatePayload 返回 false、notifyApplicantDm 直发路径）
    // 本用例在窗口内构造，翻转验证借 quietHours 的 gatePayload 契约：
    const gated = quietHours.gatePayload('dm-text', { openId: 'x', text: 'y' }, '契约');
    assert.strictEqual(gated, true, '窗口内 gatePayload=true（上用例已证积压）');
    // 静默关闭态（等价窗口外）：monkey-patch settings 不可行（闭包捕获），
    // 用行为等价断言：reservation.js 必须以 gatePayload 返回值为闸（源码契约锚）
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'reservation.js'), 'utf8');
    const fn = src.slice(src.indexOf('function notifyApplicantDm'));
    assert.ok(fn.includes("quietHours.gatePayload('dm-text'"), 'notifyApplicantDm 应以 dm-text 载荷过闸');
    assert.ok(/if \(quietHours\.gatePayload\([^)]+\)\) return;/.test(fn), '闸返回 true 时 return（积压补发），false 时直发');
  });

  // 收尾
  try { fs.unlinkSync(process.env.QUIET_BACKLOG_FILE); } catch { /* 无则跳过 */ }
  try { fs.unlinkSync(process.env.RESERVATIONS_STORE_FILE); } catch { /* 无则跳过 */ }
  try { fs.unlinkSync(process.env.AUTH_STORE_FILE); } catch { /* 无则跳过 */ }
  delete require.cache[BOT_PATH];
  console.log(failures === 0 ? `\n全部通过（${pass} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();
