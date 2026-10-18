const crypto = require('crypto');

// ============================================================
// 管理端点鉴权（2026-09-13，gateway auth.js 同款模板）：
// 写/配置类 POST 端点需带 X-API-Token 头（API_TOKEN，.env 存储随 push 下发，
// 全工作区共享同一值；运维台代理自动带头）。fail-closed：未配置 = 端点锁定。
// /api/feishu/event 与 /api/chat/command 等用户可达链路不挂本中间件。
// ============================================================

function safeEqual(a, b) {
  const ab = Buffer.from(String(a || ''));
  const bb = Buffer.from(String(b || ''));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

function requireApiToken(req, res, next) {
  const expected = process.env.API_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: '本服务未配置 API_TOKEN，管理端点已锁定（在 .env 配置后重启生效）' });
  }
  const provided = req.get('X-API-Token') || ''; // R10②：废除 ?token= 查询串传参（token 会进访问日志/代理日志）
  if (!safeEqual(provided, expected)) {
    return res.status(403).json({ error: '鉴权失败：X-API-Token 缺失或不匹配' });
  }
  next();
}

// ============================================================
// 用户会话鉴权（2026-10-05 路线 A 第二批）：双通道——
//   ① 页面会话： bambu_session cookie（authStore.resolveSession 校验）
//   ② 运维台/脚本：X-API-Token 头（视作 admin，既有管理链路不破）
// 挂法：requireUser()（登录即可）/ requireUser('reviewer')（reviewer 及以上）
// ============================================================

const authStore = require('./services/authStore');

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      const key = part.slice(0, idx).trim();
      const raw = part.slice(idx + 1).trim();
      // 畸形百分号编码（如 "%E0%A4%A"）会让 decodeURIComponent 抛 URIError：
      // 普通请求变 500，WS upgrade 回调里则直接炸到进程级——一律按原文兜底
      try { out[key] = decodeURIComponent(raw); } catch { out[key] = raw; }
    }
  }
  return out;
}

function requireUser(...allowedRoles) {
  return (req, res, next) => {
    // 通道②：运维台/管理脚本直调（API_TOKEN = admin 级）
    const apiToken = process.env.API_TOKEN;
    if (apiToken && safeEqual(req.get('X-API-Token') || '', apiToken)) {
      req.user = { id: 'api-token', username: 'api-token', displayName: '管理Token', role: 'admin' };
      return next();
    }
    // 通道①：页面会话
    const token = parseCookies(req).bambu_session;
    const user = authStore.resolveSession(token);
    if (!user) {
      return res.status(401).json({ error: '未登录或会话已过期' });
    }
    // admin 为超级角色：任何角色端点都放行（reviewer 及以上语义）
    if (allowedRoles.length > 0 && user.role !== 'admin' && !allowedRoles.includes(user.role)) {
      return res.status(403).json({ error: `权限不足（需要 ${allowedRoles.join('/')}，当前 ${user.role}）` });
    }
    req.user = user;
    next();
  };
}

module.exports = { requireApiToken, requireUser, parseCookies, safeEqual };
