/**
 * 晚间静默策略单测（2026-10-20）：打印预约群播静默期直接丢弃、不落积压；
 * DM 等非群播载荷仍按旧口径积压；旧版 webhook-card 积压加载时清理。
 * 用法：node test/quiet-hours-test.js
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

// 构造一个覆盖当前时刻的静默窗口（上海时区，±1/2 小时留边界余量）
const shHour = new Date(Date.now() + 8 * 3600 * 1000).getUTCHours();
const start = (shHour + 23) % 24;
const end = (shHour + 2) % 24;
process.env.QUIET_HOURS_START = String(start);
process.env.QUIET_HOURS_END = String(end === start ? (start + 1) % 24 : end);
process.env.QUIET_HOURS_DISABLED = '';
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-quiet-${process.pid}.json`);

const quiet = require('../src/utils/quietHours');

let pass = 0;
let failures = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (err) { failures++; console.error(`✗ ${name} — ${err.message}`); }
}
function readBacklog() {
  if (!fs.existsSync(process.env.QUIET_BACKLOG_FILE)) return [];
  return JSON.parse(fs.readFileSync(process.env.QUIET_BACKLOG_FILE, 'utf8')).items || [];
}

check('当前时刻在构造的静默窗口内（前置条件）', () => {
  assert.strictEqual(quiet.inQuietHours(), true, quiet.getStatus().window);
});

check('打印预约群播（webhook-card）：静默期直接丢弃，不写积压文件', () => {
  const before = quiet.getStatus().backlog;
  const gated = quiet.gatePayload('webhook-card', { card: 'queue' }, '排队卡测试');
  assert.strictEqual(gated, true, '应拦截发送');
  assert.strictEqual(quiet.getStatus().backlog, before, '积压数量不应增加');
  assert.ok(!fs.existsSync(process.env.QUIET_BACKLOG_FILE), '不应生成积压文件');
});

check('非群播载荷（dm-text）：仍按旧口径积压', () => {
  const gated = quiet.gatePayload('dm-text', { openId: 'u1', text: 'x' }, 'DM 测试');
  assert.strictEqual(gated, true);
  const items = readBacklog();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].type, 'payload');
  assert.strictEqual(items[0].name, 'dm-text');
});

check('旧版 webhook-card 积压：加载时清理，不参与补发', () => {
  fs.writeFileSync(process.env.QUIET_BACKLOG_FILE, JSON.stringify({
    items: [
      { id: 'legacy-card', type: 'payload', name: 'webhook-card', payload: {}, queuedAt: '2026-10-19T20:00:00.000Z' },
      { id: 'keep-dm', type: 'payload', name: 'dm-text', payload: { openId: 'u1', text: 'y' }, queuedAt: '2026-10-19T20:01:00.000Z' },
    ],
  }, null, 2));
  assert.strictEqual(quiet.getStatus().backlog, 1, '只保留 DM 条目');
  const items = readBacklog();
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].id, 'keep-dm');
});

try { fs.unlinkSync(process.env.QUIET_BACKLOG_FILE); } catch { /* 已不存在 */ }
console.log(`\n晚间静默策略单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
