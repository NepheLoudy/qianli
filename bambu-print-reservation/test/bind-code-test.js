// 飞书自助绑定单测（2026-10-29）：绑定码生成/一次性/过期 + /print-bind 指令入参校验
const assert = require('assert');
const os = require('os');
const path = require('path');

const tmp = fsTmp();
function fsTmp() {
  const fs = require('fs');
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bind-'));
}
process.env.AUTH_STORE_FILE = path.join(tmp, 'auth.json');
process.env.PRINTER_HOSTS = '';
process.env.PRINTER_ACCESS_CODES = '';
process.env.PRINTER_SERIALS = '';
process.env.PRINTER_NAMES = '';
process.env.PRINTER_MODELS = '';

let pass = 0;
let fail = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

async function main() {
  const authStore = require('../src/services/authStore');
  const { executeCommand } = require('../src/services/chatService');

  // 夹具账号（首位自动 admin，之后 member）
  const admin = authStore.register({ username: 'u_admin', password: 'secret1', displayName: '管理员' });
  const member = authStore.register({ username: 'u_member', password: 'secret1', displayName: '队员甲' });

  check('绑定码：6 位数字 + 有效期', async () => {
    const r = authStore.createBindCode(member.id);
    assert.ok(/^\d{6}$/.test(r.code), `码格式 ${r.code}`);
    assert.strictEqual(r.expiresInSeconds, 300);
  });

  check('/print-bind：正确码 + senderId → 绑定成功', async () => {
    const { code } = authStore.createBindCode(member.id);
    const reply = await executeCommand('/print-bind', [code], { senderId: 'ou_test_member_0001' });
    assert.ok(/已绑定/.test(reply), reply);
    assert.strictEqual(authStore.getUserById(member.id).feishuOpenId, 'ou_test_member_0001');
  });

  check('绑定码一次性：同码二次使用报无效', async () => {
    const { code } = authStore.createBindCode(member.id);
    await executeCommand('/print-bind', [code], { senderId: 'ou_x_0001' });
    const reply = await executeCommand('/print-bind', [code], { senderId: 'ou_x_0001' });
    assert.ok(/无效或已使用/.test(reply), reply);
  });

  check('/print-bind：无 senderId → 明确降级提示（不绑定）', async () => {
    const { code } = authStore.createBindCode(admin.id);
    const reply = await executeCommand('/print-bind', [code], {});
    assert.ok(/未取到你的飞书身份/.test(reply), reply);
    assert.ok(!authStore.getUserById(admin.id).feishuOpenId, '仍未绑定');
  });

  check('/print-bind：非法码 → 用法提示', async () => {
    const reply = await executeCommand('/print-bind', ['abc'], { senderId: 'ou_y' });
    assert.ok(/用法/.test(reply), reply);
  });

  check('setFeishuOpenId：明显垃圾值被拒', async () => {
    assert.throws(() => authStore.setFeishuOpenId(member.id, 'x'), /格式可疑/);
    authStore.setFeishuOpenId(member.id, ''); // 解除绑定合法
    assert.ok(!authStore.getUserById(member.id).feishuOpenId, '已解除');
  });

  check('deleteUser 边界：不能删自己 / 最后 admin', async () => {
    assert.throws(() => authStore.deleteUser(admin.id, admin.id), /不能删除自己/);
    // admin 是当前唯一 admin（member 是 member）
    const member2 = authStore.register({ username: 'u_m2', password: 'secret1', displayName: '队员乙' });
    assert.throws(() => authStore.deleteUser(admin.id, member2.id), /最后一个管理员/);
    const out = authStore.deleteUser(member2.id, admin.id);
    assert.strictEqual(out.deleted, 'u_m2');
  });

  for (const [name, fn] of checks) {
    try { await fn(); console.log(`✓ ${name}`); pass++; }
    catch (err) { console.error(`✗ ${name}\n  ${err.message}`); fail++; }
  }
  console.log(`\n飞书自助绑定单测: ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
