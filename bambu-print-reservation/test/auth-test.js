/**
 * 账号与会话单测（注册/登录/限速/角色/中间件双通道）
 * 用法：node test/auth-test.js
 */
process.env.PROCESS_RULES_FILE = require('os').tmpdir() + `/bambu-test-rules-${process.pid}.json`;
process.env.AUTH_STORE_FILE = require('os').tmpdir() + `/bambu-test-auth-${process.pid}.json`;
const assert = require('assert');
const fs = require('fs');
const authStore = require('../src/services/authStore');
const { requireUser, parseCookies } = require('../src/auth');

let failures = 0;
let passed = 0;
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(() => { passed++; console.log(`✓ ${name}`); }, (err) => { failures++; console.error(`✗ ${name} — ${err.message}`); }));
    } else { passed++; console.log(`✓ ${name}`); }
  } catch (err) { failures++; console.error(`✗ ${name} — ${err.message}`); }
}

// ---------- 注册 ----------

check('首位注册者自动成为 admin（bootstrap）', () => {
  const u = authStore.register({ username: 'boss', password: 'secret1', displayName: '曼波' });
  assert.equal(u.role, 'admin');
  assert.ok(!u.passHash && !u.salt, 'safeUser 不得泄露密码字段');
});

check('后续注册者为 member', () => {
  const u = authStore.register({ username: 'member1', password: 'secret1', displayName: '队员甲' });
  assert.equal(u.role, 'member');
});

check('非法用户名 / 重名 / 弱密码被拒', () => {
  assert.throws(() => authStore.register({ username: 'ab', password: 'secret1', displayName: 'x' }), /3–32/);
  assert.throws(() => authStore.register({ username: 'boss', password: 'secret1', displayName: 'y' }), /已存在/);
  assert.throws(() => authStore.register({ username: 'okname', password: '123', displayName: 'z' }), /至少 6 位/);
  assert.throws(() => authStore.register({ username: 'okname2', password: 'secret1', displayName: '' }), /显示姓名/);
});

// ---------- 登录与限速 ----------

check('登录成功返回用户并记录 lastLoginAt', () => {
  const u = authStore.login('boss', 'secret1');
  assert.equal(u.username, 'boss');
  assert.ok(u.lastLoginAt);
});

check('错误密码报「用户名或密码错误」（不泄露存在性）', () => {
  assert.throws(() => authStore.login('boss', 'wrong!'), /用户名或密码错误/);
});

check('连续 5 次失败锁定 10 分钟', () => {
  for (let i = 0; i < 5; i++) {
    try { authStore.login('member1', 'bad'); } catch (e) {
      assert.match(e.message, i < 4 ? /用户名或密码错误/ : /已锁定/);
    }
  }
  assert.throws(() => authStore.login('member1', 'secret1'), /已锁定/, '锁定期内正确密码也不放行');
});

// ---------- 会话 ----------

const bossId = () => authStore.listUsers().find((u) => u.username === 'boss').id;

check('createSession/resolveSession 往返，登出即失效', () => {
  const token = authStore.createSession(bossId());
  const me = authStore.resolveSession(token);
  assert.equal(me.username, 'boss');
  authStore.destroySession(token);
  assert.equal(authStore.resolveSession(token), null);
});

check('过期会话被拒并清理', () => {
  const token = authStore.createSession(bossId());
  const data = JSON.parse(fs.readFileSync(process.env.AUTH_STORE_FILE, 'utf-8'));
  data.sessions[token].expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(process.env.AUTH_STORE_FILE, JSON.stringify(data));
  assert.equal(authStore.resolveSession(token), null);
  assert.ok(!JSON.parse(fs.readFileSync(process.env.AUTH_STORE_FILE, 'utf-8')).sessions[token], '过期会话应被清理');
});

// ---------- 角色 ----------

check('setRole 升降 reviewer/admin，非法角色被拒', () => {
  const u = authStore.listUsers().find((x) => x.username === 'member1');
  assert.equal(authStore.setRole(u.id, 'reviewer').role, 'reviewer');
  assert.throws(() => authStore.setRole(u.id, 'superman'), /非法角色/);
  authStore.setRole(u.id, 'member');
});

check('最后一个 admin 不可降权（防管理面永久锁死）', () => {
  const boss = authStore.listUsers().find((u) => u.username === 'boss');
  assert.throws(() => authStore.setRole(boss.id, 'member'), /最后一个管理员/);
});

check('parseCookies 畸形百分号编码不抛错（回落原文）', () => {
  const c = parseCookies({ headers: { cookie: 'bambu_session=%E0%A4%A; other=ok' } });
  assert.equal(c.other, 'ok');
  assert.ok(c.bambu_session.includes('%E0%A4%A'), '畸形编码应保留原文而非崩溃');
});

// ---------- 中间件（双通道） ----------

function mockReq(headers) { return { headers, get: (k) => headers[k.toLowerCase()] }; }
function mockRes() {
  const r = { statusCode: 0, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}

check('requireUser：X-API-Token 通道视作 admin（运维台链路不破）', () => {
  process.env.API_TOKEN = 'test-token-123';
  const mw = requireUser('admin');
  const req = mockReq({ 'x-api-token': 'test-token-123' });
  let next = false;
  mw(req, mockRes(), () => { next = true; });
  assert.ok(next);
  assert.equal(req.user.role, 'admin');
  delete process.env.API_TOKEN;
});

check('requireUser：无会话 401', () => {
  const mw = requireUser();
  const res = mockRes();
  mw(mockReq({}), res, () => { throw new Error('不应放行'); });
  assert.equal(res.statusCode, 401);
});

check('requireUser：角色不足 403，角色匹配放行', () => {
  const token = authStore.createSession(bossId());
  const cookie = `bambu_session=${token}`;
  const mwAdmin = requireUser('admin');
  let next = false;
  mwAdmin(mockReq({ cookie }), mockRes(), () => { next = true; });
  assert.ok(next, 'admin 会话应放行 admin 端点');

  // reviewer 级端点对 admin 同样放行（角色向上兼容）
  const mwReviewer = requireUser('reviewer');
  let nextB = false;
  mwReviewer(mockReq({ cookie }), mockRes(), () => { nextB = true; });
  assert.ok(nextB, 'admin 会话应放行 reviewer+ 端点');
  // member 会话打 admin 端点 → 403（createSession 不走 login，不受登录锁影响）
  const memberId = authStore.listUsers().find((u) => u.username === 'member1').id;
  const memberCookie = `bambu_session=${authStore.createSession(memberId)}`;
  const resC = mockRes();
  mwAdmin(mockReq({ cookie: memberCookie }), resC, () => { throw new Error('member 不应放行 admin 端点'); });
  assert.equal(resC.statusCode, 403);
  assert.match(resC.body.error, /权限不足/);
  assert.equal(parseCookies({ headers: { cookie } }).bambu_session, token);
});

check('parseCookies 解析与解码', () => {
  const c = parseCookies({ headers: { cookie: 'a=1; bambu_session=abc%20def' } });
  assert.equal(c.a, '1');
  assert.equal(c.bambu_session, 'abc def');
});

check('注册邀请码:配置后无码/错码拒绝,正确码放行', () => {
  process.env.REGISTER_INVITE_CODE = 'lab-2026';
  assert.throws(() => authStore.register({ username: 'nc1', password: 'secret1', displayName: '无码者' }), /邀请码/);
  assert.throws(() => authStore.register({ username: 'nc2', password: 'secret1', displayName: '错码者', inviteCode: 'wrong' }), /邀请码/);
  const u = authStore.register({ username: 'nc3', password: 'secret1', displayName: '有码者', inviteCode: 'lab-2026' });
  assert.equal(u.role, 'member');
  delete process.env.REGISTER_INVITE_CODE;
  // 未配置 = 开放注册
  const v = authStore.register({ username: 'nc4', password: 'secret1', displayName: '开放注册' });
  assert.equal(v.role, 'member');
});

check('changePassword:旧密码验证+新密码生效', () => {
  authStore.register({ username: 'cp1', password: 'oldpass1', displayName: '改密测试' });
  const u = authStore.listUsers().find((x) => x.username === 'cp1');
  assert.throws(() => authStore.changePassword(u.id, 'wrong-old', 'newpass1'), /旧密码不正确/);
  assert.throws(() => authStore.changePassword(u.id, 'oldpass1', '123'), /至少 6 位/);
  authStore.changePassword(u.id, 'oldpass1', 'newpass1');
  assert.ok(authStore.login('cp1', 'newpass1'));
  assert.throws(() => authStore.login('cp1', 'oldpass1'), /用户名或密码错误/);
});

// ---------- 收尾 ----------
Promise.all(pending).then(() => {
  try { fs.unlinkSync(process.env.AUTH_STORE_FILE); } catch { /* 无则跳过 */ }
  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
});
