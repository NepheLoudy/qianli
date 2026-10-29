// ============================================================
// 账号与会话存储（2026-10-05 路线 A 第二批：防止未授权使用）
//
// 角色模型：
//   member   = 发起人（注册即得）——提交预约、查看列表、取消自己的单
//   reviewer = 审批人（admin 升权）——member 全部 + 审批通过/驳回
//   admin    = 管理员 ——reviewer 全部 + 用户角色管理；首位注册者自动成为 admin（bootstrap）
//
// 安全实现（Node 内置，无新依赖）：
//   密码 crypto.scryptSync + 随机 salt，timingSafeEqual 比对（照 feishu-gateway auth 模板口径）；
//   登录限速：同用户名连续 5 次失败锁 10 分钟（内存态，重启清零可接受）；
//   会话 token crypto.randomBytes(32)，30 天有效，落盘（pm2 重启不掉线），惰性清理过期。
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const AUTH_FILE = process.env.AUTH_STORE_FILE || path.join(__dirname, '..', '..', '.auth-users.json');
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_MS = 10 * 60 * 1000;
const ROLES = ['member', 'reviewer', 'admin'];

function load() {
  try {
    if (!fs.existsSync(AUTH_FILE)) return { users: [], sessions: {} };
    const data = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    return {
      users: Array.isArray(data.users) ? data.users : [],
      sessions: data.sessions && typeof data.sessions === 'object' ? data.sessions : {},
    };
  } catch (err) {
    // 损坏隔离（2026-10-08 同 reservationStore 口径）：坏文件改名留档，防止下一次
    // register/save 把仅存的账号表静默覆盖；隔离件可人工抢救
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.renameSync(AUTH_FILE, `${AUTH_FILE}.corrupt-${stamp}`); } catch { /* 留在原地 */ }
    console.error(`[账号存储] 存储文件损坏已隔离（${err.message}）——按空启动，请人工检查抢救`);
    return { users: [], sessions: {} };
  }
}

function save(data) {
  const tmp = AUTH_FILE + '.tmp';
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...data }, null, 2));
  fs.renameSync(tmp, AUTH_FILE);
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}

function verifyPassword(password, salt, expectedHash) {
  const actual = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

// 登录限速（内存态）：username → { count, lockedUntil }
const loginAttempts = new Map();

const authStore = {
  AUTH_FILE,
  ROLES,

  /**
   * 注册：用户名 3–32 位字母数字_-，密码 ≥6 位；首个注册者自动 admin。
   * REGISTER_INVITE_CODE 配置后注册须携带邀请码（空 = 开放注册，仅内网屏障）
   */
  register({ username, password, displayName, inviteCode }) {
    const expected = String(process.env.REGISTER_INVITE_CODE || '');
    if (expected && String(inviteCode || '') !== expected) {
      throw new Error('注册邀请码错误（请向管理员获取）');
    }
    const uname = String(username || '').trim();
    const name = String(displayName || '').trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(uname)) throw new Error('用户名需 3–32 位字母/数字/下划线/短横线');
    if (!name || name.length > 24) throw new Error('请填写显示姓名（≤24 字）');
    if (String(password || '').length < 6) throw new Error('密码至少 6 位');

    const data = load();
    if (data.users.some((u) => u.username.toLowerCase() === uname.toLowerCase())) {
      throw new Error('用户名已存在');
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const user = {
      id: `u-${crypto.randomBytes(6).toString('hex')}`,
      username: uname,
      displayName: name,
      role: data.users.length === 0 ? 'admin' : 'member', // 首位注册者 = admin（bootstrap）
      passHash: hashPassword(password, salt),
      salt,
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
    };
    data.users.push(user);
    save(data);
    return authStore.safeUser(user);
  },

  /** 登录校验（带限速）：成功返回 user，失败 throw */
  login(username, password) {
    const uname = String(username || '').trim().toLowerCase();
    const attempt = loginAttempts.get(uname);
    if (attempt && attempt.lockedUntil > Date.now()) {
      const mins = Math.ceil((attempt.lockedUntil - Date.now()) / 60000);
      throw new Error(`失败次数过多，账号已锁定，请 ${mins} 分钟后再试`);
    }

    const data = load();
    const user = data.users.find((u) => u.username.toLowerCase() === uname);
    const ok = user && verifyPassword(password, user.salt, user.passHash);
    if (!ok) {
      // 仅「锁存在且已过期」才重置计数——lockedUntil=0 表示从未锁定，不得清零
      const expired = attempt && attempt.lockedUntil && attempt.lockedUntil < Date.now();
      const count = (expired ? 0 : (attempt?.count || 0)) + 1;
      loginAttempts.set(uname, {
        count,
        lockedUntil: count >= LOGIN_MAX_ATTEMPTS ? Date.now() + LOGIN_LOCK_MS : 0,
      });
      throw new Error(count >= LOGIN_MAX_ATTEMPTS ? '失败次数过多，账号已锁定 10 分钟' : '用户名或密码错误');
    }
    loginAttempts.delete(uname);

    user.lastLoginAt = new Date().toISOString();
    save(data);
    return authStore.safeUser(user);
  },

  /** 创建会话（30 天，落盘重启不掉线），返回 token */
  createSession(userId) {
    const data = load();
    if (!data.users.some((u) => u.id === userId)) throw new Error('用户不存在');
    const token = crypto.randomBytes(32).toString('hex');
    data.sessions[token] = { userId, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString() };
    // 惰性清理过期会话
    const now = Date.now();
    for (const [t, s] of Object.entries(data.sessions)) {
      if (new Date(s.expiresAt).getTime() < now) delete data.sessions[t];
    }
    save(data);
    return token;
  },

  /** 校验会话：返回 user；无效/过期返回 null */
  resolveSession(token) {
    if (!token || typeof token !== 'string') return null;
    const data = load();
    const session = data.sessions[token];
    if (!session) return null;
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      delete data.sessions[token];
      save(data);
      return null;
    }
    const user = data.users.find((u) => u.id === session.userId);
    return user ? authStore.safeUser(user) : null;
  },

  destroySession(token) {
    const data = load();
    if (data.sessions[token]) {
      delete data.sessions[token];
      save(data);
    }
  },

  /** 修改密码（需登录 + 旧密码验证）；keepToken = 当前会话保留，其余会话全摘（改密即踢掉旧登录） */
  changePassword(userId, oldPassword, newPassword, keepToken = '') {
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (!verifyPassword(oldPassword, user.salt, user.passHash)) throw new Error('旧密码不正确');
    if (String(newPassword || '').length < 6) throw new Error('新密码至少 6 位');
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passHash = hashPassword(newPassword, salt);
    for (const [t, sess] of Object.entries(data.sessions)) {
      if (sess.userId === userId && t !== keepToken) delete data.sessions[t];
    }
    save(data);
    return true;
  },

  /** 管理员重置密码（2026-10-12：终结反复锁死循环——临时密码随返回值给管理员转交） */
  adminResetPassword(userId, tempPassword) {
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (!/^\S{6,}$/.test(tempPassword)) throw new Error('临时密码至少 6 位');
    const salt = crypto.randomBytes(16).toString('hex');
    user.salt = salt;
    user.passHash = hashPassword(tempPassword, salt);
    for (const [t, sess] of Object.entries(data.sessions)) { // 清会话：会话真身在顶层 data.sessions，按 userId 摘除
      if (sess.userId === userId) delete data.sessions[t];
    }
    save(data);
    return { username: user.username, tempPassword };
  },

  /** 角色变更（admin 操作）：member/reviewer/admin；最后一个 admin 不可降权（防永久锁死管理面） */
  setRole(userId, role) {
    if (!ROLES.includes(role)) throw new Error(`非法角色: ${role}`);
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (user.role === 'admin' && role !== 'admin' && data.users.filter((u) => u.role === 'admin').length <= 1) {
      throw new Error('这是最后一个管理员账号，不能降权（否则无人能管理系统）——请先提升另一名管理员');
    }
    user.role = role;
    save(data);
    return authStore.safeUser(user);
  },

  listUsers() {
    return load().users.map(authStore.safeUser);
  },

  /** 按 id 查用户（含敏感口径内部用：DM 通知链取 openId） */
  getUserById(userId) {
    return load().users.find((u) => u.id === userId) || null;
  },

  /**
   * 绑定飞书 openId（2026-10-28 曼波令「打印进程私信告知申请人」）：打印进程事件
   * （完成/失败/取消/驳回）按此 DM 申请人。admin 端点写入；openId 格式浅校验（ou_ 前缀
   * 为飞书 open_id 惯例，历史值可能不同故只拦截明显垃圾）。
   */
  setFeishuOpenId(userId, openId) {
    const oid = String(openId || '').trim();
    if (oid && !/^[\w-]{16,64}$/.test(oid)) throw new Error('openId 格式可疑（应为 ou_ 开头的飞书开放平台标识）');
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    user.feishuOpenId = oid || null;
    save(data);
    return authStore.safeUser(user);
  },

  /**
   * 删除账号（2026-10-29 曼波令）：admin 管理 action——边界：不能删自己、不能删最后
   * 一个 admin；该用户的全部会话随删失效。历史预约单不受影响（applicant/displayName
   * 已随单落档，submittedBy 变为悬挂引用仅影响 DM 私信——单据页面状态照常可见）。
   */
  deleteUser(userId, operatorId) {
    if (String(userId) === String(operatorId)) throw new Error('不能删除自己当前登录的账号');
    const data = load();
    const user = data.users.find((u) => u.id === userId);
    if (!user) throw new Error('用户不存在');
    if (user.role === 'admin' && data.users.filter((u) => u.role === 'admin').length <= 1) {
      throw new Error('这是最后一个管理员账号，不能删除——请先提升另一名管理员');
    }
    data.users = data.users.filter((u) => u.id !== userId);
    for (const [token, sess] of Object.entries(data.sessions || {})) {
      if (sess && sess.userId === userId) delete data.sessions[token];
    }
    save(data);
    return { deleted: user.username, displayName: user.displayName };
  },

  /** 剔除敏感字段 */
  safeUser(user) {
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role, createdAt: user.createdAt, lastLoginAt: user.lastLoginAt, feishuOpenId: user.feishuOpenId || null };
  },
};

// ============================================================
// 飞书自助绑定码（2026-10-29）：网页登录态生成 6 位一次性码（5 分钟有效，内存态）——
// 用户在飞书发「/print-bind 码」，hub 转发时带 senderId（open_id），打印服务据此把
// 该 open_id 绑到生成码的账号。码只在内存：重启即失效（重新生成即可），不落盘不留痕。
// 前置依赖：hub 的 handlePrintCommand 需透传 senderId（跨项目改动，见交付说明）。
// ============================================================
const BIND_CODE_TTL_MS = 5 * 60 * 1000;
const bindCodes = new Map(); // code → { userId, expiresAt }

authStore.createBindCode = function createBindCode(userId) {
  const user = load().users.find((u) => u.id === userId);
  if (!user) throw new Error('用户不存在');
  const now = Date.now();
  for (const [c, v] of bindCodes) if (v.expiresAt < now) bindCodes.delete(c); // 惰性清理
  // 6 位数字码（避开易混 0/O、1/I 的字母码场景——纯数字最省事）；碰撞重抽
  let code;
  do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (bindCodes.has(code));
  bindCodes.set(code, { userId, expiresAt: now + BIND_CODE_TTL_MS });
  return { code, expiresInSeconds: Math.round(BIND_CODE_TTL_MS / 1000) };
};

/** 用绑定码把 openId 绑到对应账号；码无效/过期/已用均报错（一次性消费） */
authStore.bindByCode = function bindByCode(code, openId) {
  const key = String(code || '').trim();
  const entry = bindCodes.get(key);
  if (!entry) throw new Error('绑定码无效或已使用——请在打印预约页面重新生成');
  if (entry.expiresAt < Date.now()) { bindCodes.delete(key); throw new Error('绑定码已过期（5 分钟内有效）——请重新生成'); }
  const oid = String(openId || '').trim();
  if (!oid) throw new Error('未取到你的飞书身份（open_id）——请确认是在飞书里直接和机器人对话');
  bindCodes.delete(key); // 一次性
  const result = authStore.setFeishuOpenId(entry.userId, oid);
  return result;
};

module.exports = authStore;
