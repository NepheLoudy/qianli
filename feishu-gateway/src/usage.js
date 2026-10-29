const fs = require('fs');
const path = require('path');
const config = require('./config');
const { resolveDataDir } = require('./data-dir');
const { fetchWithTimeout, TOKEN_TIMEOUT_MS } = require('./http');

// ============================================================
// 使用统计（运维台「功能使用 / 队员活跃」看板的数据源）
// - 只计数不改路由：dispatch 在消息命中目标后顺带记录，故障时静默自愈
// - 口径=机器人交互：显式路由命中/私聊/群内 @机器人；群内未 @ 的普通消息不计
//   （按天分桶的明细 feats/users 仅服务运维台与日活跃汇总，不再落多维表格分表）
// - 按天分桶：每日 { total, users: {open_id: {c, last, f: {功能: 次数}}}, feats: {功能: 次数} }，保留 30 天
//   （f=按人功能归因，2026-09-22 起记录；此前的旧数据无 f，聚合时按全量正经处理不回溯剔除）
// - 活跃口径双轨（2026-09-22 修正）：activeUsers=机器人交互全量（网关日活跃表同口径，
//   不变）；seriousActiveUsers=正经使用（剔娱乐功能）。娱乐清单=静态（抽奖/关键词回答//lottery）
//   + 自学习（归因上报带 fun:1 学功能名、learn:[触发词] 学 '/触发词' 形态），均持久化。
//   规则见顶层 AGENTS「队员/功能统计上报规则」
// - 落盘目录必须在项目外：部署 tar 会清空 /opt/feishu-gateway，
//   默认 /home/qianli/feishu-gateway-data（与 approval-bot-data 惯例一致），可 GATEWAY_DATA_DIR 覆盖
// - 成员名用共用应用凭证查通讯录并永久缓存（查不到则回退展示 open_id 尾号）
// ============================================================

const KEEP_DAYS = 30;
const dataDir = resolveDataDir();
const FILE = path.join(dataDir, 'usage-stats.json');

let stats = { v: 1, names: {}, days: {}, funFeats: {}, funCmds: {}, mentions: {} };
try {
  stats = Object.assign(stats, JSON.parse(fs.readFileSync(FILE, 'utf-8')));
} catch (err) {
  // 坏文件改名留存（2026-10-30 审查批 P2：崩溃截断后空表起步+回写会静默清零 30 天统计资产）
  if (fs.existsSync(FILE)) {
    try { fs.renameSync(FILE, `${FILE}.corrupt-${Date.now()}`); } catch (e2) { /* 留存失败仅日志 */ }
    console.error('[使用统计] stats 文件解析失败，已改名留存后空表起步:', err.message);
  }
}

let dirty = false;
// 原子写（2026-10-30 审查批 P2）：先写 .tmp 再 rename 替换，进程强杀落在写中间也不会截断正式文件
function flushStats(cb) {
  const tmp = `${FILE}.tmp`;
  fs.writeFile(tmp, JSON.stringify(stats), () => {
    fs.rename(tmp, FILE, () => { if (cb) cb(); });
  });
}
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  flushStats();
}, 60 * 1000).unref();
process.on('SIGINT', () => {
  try { fs.writeFileSync(FILE, JSON.stringify(stats)); } catch (err) { /* 退出不等落盘 */ }
  process.exit(0);
});
process.on('SIGTERM', () => {
  try { fs.writeFileSync(FILE, JSON.stringify(stats)); } catch (err) { /* 退出不等落盘 */ }
  process.exit(0);
});

const pad = (n) => String(n).padStart(2, '0');
// 日桶按东八区固定偏移截取（2026-10-30 审查批 P2：与 bitable-sync toMs 的 +08:00 统一口径，
// 宿主 TZ 变化不再导致日桶边界漂移）
function dayKeyOffset(offsetDays) {
  const d = new Date(Date.now() + 8 * 3600000 + offsetDays * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function today() {
  return dayKeyOffset(0);
}

function prune() {
  const keys = Object.keys(stats.days).sort();
  while (keys.length > KEEP_DAYS) delete stats.days[keys.shift()];
  const mkeys = Object.keys(stats.mentions || {}).sort();
  while (mkeys.length > KEEP_DAYS) delete stats.mentions[mkeys.shift()];
}

// ---------- 娱乐功能清单（2026-09-22 活跃口径修正：队员活跃只算正经使用） ----------
// 静态清单覆盖已知娱乐功能名（hub 归因上报）与娱乐指令；动态部分靠上报自学习：
// fun:1 → 功能名进 funFeats；learn:[触发词] → 归一化为 '/触发词' 进 funCmds，
// 盖住抽奖动态触发词在路由层被记成正经 '/指令' 的漏洞。均随 stats 持久化，重启不丢。
// 新增娱乐类功能时按规则上报（见顶层 AGENTS），静态清单同步补一行。
const STATIC_FUN_FEATURES = new Set(['抽奖', '关键词回答', '/lottery']);

function isFunFeature(feat) {
  return STATIC_FUN_FEATURES.has(feat) || stats.funFeats[feat] === 1 || stats.funCmds[feat] === 1;
}

function learnFunTokens(tokens) {
  for (const kw of tokens) {
    const token = '/' + String(kw || '').trim().toLowerCase().split(/\s+/)[0];
    if (token !== '/' && stats.funCmds[token] !== 1) {
      stats.funCmds[token] = 1;
      dirty = true;
    }
  }
}

function recordMessage({ senderId, feature }) {
  try {
    if (!senderId) return;
    const day = stats.days[today()] || (stats.days[today()] = { total: 0, users: {}, feats: {} });
    day.total += 1;
    const u = day.users[senderId] || (day.users[senderId] = { c: 0, last: 0, f: {} });
    if (!u.f) u.f = {};
    u.f[feature] = (u.f[feature] || 0) + 1;
    u.c += 1;
    u.last = Date.now();
    day.feats[feature] = (day.feats[feature] || 0) + 1;
    prune();
    dirty = true;
    ensureName(senderId);
  } catch (err) {
    console.warn('[使用统计] 记录失败（忽略）:', err.message);
  }
}

// 消费方归因上报（2026-09-13 统计覆盖规则）：hub 等服务把网关路由层看不见的
// 功能命中（关键词回答/DDL 确认/专项指令等）回报到这里——只加用户与功能计数，
// 不加 total（total 口径仍是网关路由层交互次数，避免双算）。
// 2026-09-22 起支持 fun:1（娱乐功能标记，功能名进 funFeats）与
// learn:[触发词]（抽奖触发词进 funCmds，供聚合时把 '/触发词' 路由记录归为娱乐）
function recordFeature({ senderId, feature, fun, learn }) {
  try {
    if (!senderId || !feature) return;
    if (fun && stats.funFeats[feature] !== 1) {
      stats.funFeats[feature] = 1;
      dirty = true;
    }
    if (Array.isArray(learn) && learn.length) learnFunTokens(learn.slice(0, 50));
    const day = stats.days[today()] || (stats.days[today()] = { total: 0, users: {}, feats: {} });
    const u = day.users[senderId] || (day.users[senderId] = { c: 0, last: 0, f: {} });
    if (!u.f) u.f = {};
    u.f[feature] = (u.f[feature] || 0) + 1;
    u.c += 1;
    u.last = Date.now();
    day.feats[feature] = (day.feats[feature] || 0) + 1;
    prune();
    dirty = true;
    ensureName(senderId);
  } catch (err) {
    console.warn('[使用统计] 归因记录失败（忽略）:', err.message);
  }
}

// ---------- 群聊被@统计（2026-09-24 团队负载算法数据源） ----------
// 口径：群聊消息里 @ 了普通成员，每 @ 一人次计一（pm-robot 负载评分 0.01 分/次）。
// 不含 @机器人（路由层另有交互统计）与 @所有人；私聊无 mention 语义不计。
// 按天分桶 { 'YYYY-MM-DD': { openId: count } }，随 stats 落盘、prune 同窗清理；
// mention 条目自带被@者姓名，顺手进 names 缓存（免费，聚合输出直接带名字）。
function recordMentions(message) {
  try {
    if (!message || message.chat_type !== 'group') return;
    if (!Array.isArray(message.mentions)) return;
    let day = null;
    for (const m of message.mentions) {
      if (!m || !m.key) continue;
      // @机器人（self/app/bot/@_bot_*）与 @所有人（@_everyone）不计——与 isMentioned/extractText 的判定口径对齐
      if (m.id === 'self' || m.mentioned_type === 'app' || m.mentioned_type === 'bot') continue;
      if (String(m.key).startsWith('@_bot') || String(m.key).startsWith('@_everyone')) continue;
      // 普通成员：id 为 open_id 字符串；防御个别形态给对象（{open_id: ...}）
      const openId = typeof m.id === 'string' ? m.id : (m.id && m.id.open_id) || '';
      if (!openId) continue;
      if (!day) day = stats.mentions[today()] || (stats.mentions[today()] = {});
      day[openId] = (day[openId] || 0) + 1;
      if (m.name && !stats.names[openId]) {
        stats.names[openId] = m.name;
        dirty = true;
      }
    }
    if (day) {
      prune();
      dirty = true;
    }
  } catch (err) {
    console.warn('[使用统计] 被@记录失败（忽略）:', err.message);
  }
}

// 被@聚合（?days=N，默认 7 天，最大 30）：按人求和，输出 [{id, name, count}] 降序。
// 窗口按自然日过滤（起点 = today-N+1）而非「最近 N 个有数据的桶」——与 usage.aggregate
// 的桶数滑窗不同：被@是负载评分输入，稀疏数据下桶数滑窗会把老计数长期带在身上虚高分
function aggregateMentions(daysN = 7) {
  const raw = daysN === undefined || daysN === null || daysN === '' ? 7 : Number(daysN);
  const n = Math.min(KEEP_DAYS, Math.max(1, Number.isFinite(raw) ? raw : 7));
  const fromKey = dayKeyOffset(-(n - 1));
  const dates = Object.keys(stats.mentions || {}).sort().filter((d) => d >= fromKey);
  const users = {};
  for (const d of dates) {
    for (const [id, c] of Object.entries(stats.mentions[d] || {})) {
      users[id] = (users[id] || 0) + (c || 0);
    }
  }
  const userList = Object.entries(users)
    .map(([id, count]) => ({ id, name: stats.names[id] || '', count }))
    .sort((a, b) => b.count - a.count);
  return {
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    days: n,
    users: userList,
  };
}

// ---------- 成员名解析（通讯录，永久缓存；失败 24h 内不重试） ----------
const nameFailedUntil = new Map();
const namePending = new Set();
let tokenCache = null;

async function tenantToken() {
  if (tokenCache && Date.now() < tokenCache.expireAt) return tokenCache.token;
  const appId = config.feishu.appId;
  const appSecret = config.feishu.appSecret;
  if (!appId || !appSecret) return null;
  const res = await fetchWithTimeout(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    },
    TOKEN_TIMEOUT_MS
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || 'token 获取失败');
  tokenCache = { token: data.tenant_access_token, expireAt: Date.now() + ((data.expire || 3600) - 300) * 1000 };
  return tokenCache.token;
}

async function resolveName(openId) {
  const token = await tenantToken();
  if (!token) return null;
  const res = await fetchWithTimeout(
    `https://open.feishu.cn/open-apis/contact/v3/users/${openId}?user_id_type=open_id`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  if (data.code !== 0) throw new Error(data.msg || '通讯录查询失败');
  return (data.data && data.data.user && data.data.user.name) || null;
}

function ensureName(openId) {
  if (stats.names[openId] || namePending.has(openId)) return;
  if ((nameFailedUntil.get(openId) || 0) > Date.now()) return;
  namePending.add(openId);
  resolveName(openId)
    .then((name) => {
      if (name) {
        stats.names[openId] = name;
        dirty = true;
      } else {
        nameFailedUntil.set(openId, Date.now() + 24 * 3600 * 1000);
      }
    })
    .catch(() => nameFailedUntil.set(openId, Date.now() + 24 * 3600 * 1000))
    .finally(() => namePending.delete(openId));
}

// ---------- 聚合输出（?days=N，默认 1 天，最大 30） ----------
function aggregate(daysN = 1) {
  const n = Math.min(KEEP_DAYS, Math.max(1, Number(daysN) || 1));
  const dates = Object.keys(stats.days).sort().slice(-n);
  const users = {};
  const feats = {};
  const daily = [];
  let total = 0;
  for (const d of dates) {
    const day = stats.days[d];
    total += day.total || 0;
    daily.push({ date: d, count: day.total || 0 });
    for (const [id, u] of Object.entries(day.users || {})) {
      const x = users[id] || (users[id] = { count: 0, last: 0, fun: 0 });
      x.count += u.c;
      x.last = Math.max(x.last, u.last || 0);
      if (u.f) for (const [f, c] of Object.entries(u.f)) if (isFunFeature(f)) x.fun += c;
    }
    for (const [f, c] of Object.entries(day.feats || {})) feats[f] = (feats[f] || 0) + c;
  }
  const userList = Object.entries(users)
    .map(([id, x]) => ({ id, name: stats.names[id] || '', count: x.count, seriousCount: Math.max(0, x.count - x.fun), last: x.last }))
    .sort((a, b) => b.count - a.count);
  // 正经活跃（2026-09-22 口径）：剔娱乐命中；旧数据无按人归因（f 缺失）按全量正经处理，不回溯剔除
  const seriousUsers = userList
    .filter((u) => u.seriousCount > 0)
    .map(({ id, name, seriousCount, last }) => ({ id, name, count: seriousCount, last }))
    .sort((a, b) => b.count - a.count);
  const featList = Object.entries(feats)
    .map(([feat, count]) => ({ feat, count }))
    .sort((a, b) => b.count - a.count);
  return {
    from: dates[0] || null,
    to: dates[dates.length - 1] || null,
    total,
    activeUsers: userList.length,
    seriousActiveUsers: seriousUsers.length,
    users: userList,
    seriousUsers,
    features: featList,
    daily,
  };
}

module.exports = {
  recordMessage,
  recordFeature,
  recordMentions,
  aggregate,
  aggregateMentions,
  statsFile: FILE,
  // 供 bitable-sync 消费：原始日桶 / 姓名缓存 / 飞书客户端
  getAllDays: () => stats.days,
  getAllMentions: () => stats.mentions,
  getNames: () => stats.names,
  resolveName,
  tenantToken,
};
