/**
 * qianli-netlog · 实验室网络日志探针（v1 · 2026-09-27）
 *
 * 背景：全家流量骑在主路由 superqianli（192.168.31.1）的学生账号校园网认证会话上，
 * 会话被踢/路由器异常 = 全家断网 = 生产机六机器人全掉线，且此时任何内网手段都看不到
 * 现场动机与恢复时刻（qianli-lab-network skill §四「被踢是常态」）。本服务跑在
 * 生产机（小电脑 DESKTOP-FE1MIGI）上持续探测并落盘，断网期间日志照记，恢复后把
 * 积压事件汇总成一张飞书卡片补发（通知通道与被监控网络同生死，实时通知物理上
 * 不可能，「落盘 + 恢复补报」是唯一正确语义）。
 *
 * 探测项：
 *   lan — 主路由 TCP 可达性（路由器/内网活着没）
 *   wan — 公网 TCP 可达性，多目标任一通即通（校园网认证会话活着没；不用域名，排除 DNS 因素）
 *   egress IP — wan 恢复时 / 每 30 分钟心跳时查出口 IP，变化即记事件（飞书 IP 白名单风险信号）
 *
 * 防抖：连续 NETLOG_FAIL_THRESHOLD 次失败才记 down（单次抖动不刷屏）；一次成功即记 up。
 * 日志：状态变化必记 + 无变化每 15 分钟心跳记一行（JSONL，量级 ~100 行/天，不做轮转）。
 * 端点：GET /api/health、/api/netlog/summary（只读）；POST /api/netlog/revive（管理端点，X-API-Token 鉴权，未配置=锁定）。
 *
 * 结构：createEngine(deps) 纯状态机（依赖注入，stub 可测）；本文件尾部组装真实依赖。
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { URL } = require('url');

// ============================================================
// 配置（env 均可覆盖；.env 由本文件顶部 dotenv 手工加载——零依赖，不引 dotenv 包）
// ============================================================
function loadDotEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadDotEnv();

const DATA_DIR = process.env.NETLOG_DATA_DIR || path.join(os.homedir(), 'qianli-data', 'netlog');
const CONFIG = {
  port: Number(process.env.NETLOG_PORT || 3016),
  intervalMs: Number(process.env.NETLOG_INTERVAL_MS || 60 * 1000),
  timeoutMs: Number(process.env.NETLOG_TIMEOUT_MS || 2500),
  failThreshold: Number(process.env.NETLOG_FAIL_THRESHOLD || 2),
  lanHost: process.env.NETLOG_LAN_HOST || '192.168.31.1',
  lanPort: Number(process.env.NETLOG_LAN_PORT || 80),
  wanTargets: (process.env.NETLOG_WAN_TARGETS || '223.5.5.5:443,119.29.29.29:443')
    .split(',').map((s) => s.trim()).filter(Boolean)
    .map((s) => { const [host, port] = s.split(':'); return { host, port: Number(port || 443) }; }),
  // HTTPS 层验证目标（v12 引入；v14 多供应商 AND）：TCP 握手会被认证网关代答（认证死掉
  // 照样握手成功=假阴性，2026-10-05 05:28 事故），DoH 端点走真 TLS+HTTP 数据面，200 且返回
  // 合法 DoH JSON 才算出网。v14 关键：目标必须跨供应商——受限会话（认证死但未重连）对阿里系
  // 白名单是真实放行（2026-10-07 实锤：无认证态下 223.5.5.5 的 DoH 照样 200+合法 JSON），
  // 单阿里源测不出「只能上阿里」的半残态；默认阿里+腾讯双源，全部通过才算出网（AND）
  httpsTargets: (process.env.NETLOG_HTTPS_TARGETS || 'https://223.5.5.5/resolve?name=qq.com&type=1,https://120.53.53.53/dns-query?name=qq.com&type=1')
    .split(',').map((s) => s.trim()).filter(Boolean),
  // 流量探测（v9，曼波「握手通但网页刷不开」实况）：TCP 握手测不出软踢/限速——
  // generate_204 源走完整 HTTP 往返，status=204 即「用户意义上的网络可用」。
  // 多候选任一 204 即通过；被认证网关劫持重定向（非 204）按失败计
  trafficUrls: (process.env.NETLOG_TRAFFIC_URLS || 'http://connect.rom.miui.com/generate_204,http://wifi.vivo.com.cn/generate_204')
    .split(',').map((s) => s.trim()).filter(Boolean),
  heartbeatMs: Number(process.env.NETLOG_HEARTBEAT_MS || 15 * 60 * 1000),
  // 断电感知（v11）：启动时与上一进程最后心跳的间隔超过阈值 → 发「离线后重新上线」卡
  // （10-03 断电 10h 无声无息，恢复后无人知晓——通知永远只该迟到，不该缺席）
  offlineNotifyMs: Number(process.env.NETLOG_OFFLINE_NOTIFY_MS || 15 * 60 * 1000),
  // ---- 通知节流（v13，2026-10-05 60 条私信事故）：翻转事件改「事故聚合」 ----
  // down 只落盘不再逐条私聊；断开持续 downAlertMs 才即时报警（含每 stillDownRealertMs 复报）；
  // 恢复时抖动群（flapWindowMs 窗口内累计）达「累计 ≥ flapAlertMs 或次数 ≥ flapCountAlert」
  // 才发一张恢复汇总卡。mismatch 每 mismatchNotifyMs 至多私聊一条（校园网账号被抢拉锯期
  // 30 分钟一轮 × 全天 = 20 条/天的教训）。积压补发由「wan 恢复翻转 / 攒够 flushBatch 条 /
  // 距上次补发超 flushCooldownMs」三条件驱动，堵住「每分钟一张汇总卡」的旁路。
  downAlertMs: Number(process.env.NETLOG_DOWN_ALERT_MS || 10 * 60 * 1000),
  stillDownRealertMs: Number(process.env.NETLOG_STILL_DOWN_REALERT_MS || 2 * 60 * 60 * 1000),
  flapAlertMs: Number(process.env.NETLOG_FLAP_ALERT_MS || 5 * 60 * 1000),
  flapCountAlert: Number(process.env.NETLOG_FLAP_COUNT_ALERT || 3),
  flapWindowMs: Number(process.env.NETLOG_FLAP_WINDOW_MS || 30 * 60 * 1000),
  mismatchNotifyMs: Number(process.env.NETLOG_MISMATCH_NOTIFY_MS || 4 * 60 * 60 * 1000),
  flushCooldownMs: Number(process.env.NETLOG_FLUSH_COOLDOWN_MS || 2 * 60 * 60 * 1000),
  flushBatch: Number(process.env.NETLOG_FLUSH_BATCH || 10),
  egressIntervalMs: Number(process.env.NETLOG_EGRESS_INTERVAL_MS || 30 * 60 * 1000),
  egressUrls: (process.env.NETLOG_EGRESS_URLS || 'http://members.3322.org/dyndns/getip,http://ip.3322.net,https://api.ipify.org')
    .split(',').map((s) => s.trim()).filter(Boolean),
  dataDir: DATA_DIR,
  // ---- 被抢垫底（v18，曼波「首选只是优先不是拉锯」）：状态文件独立于池配置（池文件=
  // push.js 上传的种子，垫底=运行时状态不随部署丢失）；时长默认 24h，到期自动复位 ----
  demoteFile: process.env.NETLOG_DEMOTE_FILE || path.join(DATA_DIR, 'account-demotions.json'),
  kickDemoteHours: Number(process.env.NETLOG_KICK_DEMOTE_HOURS || 24),
  // ---- 复活引擎（v2）：账号池 + Dr.COM eportal 认证 + 慢速降级 ----
  accountPool: process.env.NETLOG_ACCOUNT_POOL || path.join(os.homedir(), 'qianli-data', 'netlog', 'campus-accounts.local.json'),
  apiToken: process.env.NETLOG_API_TOKEN || '', // 手动复活端点鉴权（管理端点必须鉴权；未配置=端点锁定）
  reviveEnabled: process.env.NETLOG_REVIVE_ENABLED !== 'false', // 默认开；false 退化回纯日志探针
  // ---- 播报总开关（v21，曼波 2026-11-11 拍板「断网播报全关」）：false=即时私聊/积压补发
  // 全静默，事件流 jsonl 照记可回放；恢复=改 true 重启 ----
  notifyEnabled: process.env.NETLOG_NOTIFY_ENABLED !== 'false',
  // ---- 路由器无线状态观测（v14）：主路由半死（射频信标不发/DHCP 僵死）有线侧感知不到，
  // 低频登录 miwifi 拉射频状态补上这块盲区；密码未配置=观测停用 ----
  routerWatchHost: process.env.NETLOG_ROUTER_HOST || '192.168.31.1',
  routerWatchIntervalMs: Number(process.env.NETLOG_ROUTER_WATCH_INTERVAL_MS || 10 * 60 * 1000),
};

// ============================================================
// 通用格式化（2026-11-05 自 createEngine 闭包提升到模块作用域）：main() 装配层的
// boot_after_offline 分支（:776）也在用它——此前模块作用域无此名字，长停机启动
// 必抛 ReferenceError（崩溃点在首个 engine.tick() 前 → jsonl 尾行永不推进 =
// 确定性 crash loop，P0 全量审查实测）。engine 返回的 fmtTs 与此同址，语义零变化。
// ============================================================
function fmtTs(ts) {
  // 全仓 Asia/Shanghai 口径：epoch → +08:00 ISO 文本
  return new Date(ts + 8 * 3600 * 1000).toISOString().slice(0, 19).replace('T', ' ') + '+08:00';
}

// ============================================================
// 状态机引擎（依赖注入，纯逻辑）
// ============================================================
function createEngine(deps) {
  const {
    probeLan, probeWan, probeTraffic, fetchEgressIp, sendWebhook,
    appendLog, readBacklog, writeBacklog,
    now = () => Date.now(),
    failThreshold = CONFIG.failThreshold,
    heartbeatMs = CONFIG.heartbeatMs,
    egressIntervalMs = CONFIG.egressIntervalMs,
    downAlertMs = CONFIG.downAlertMs,
    stillDownRealertMs = CONFIG.stillDownRealertMs,
    flapAlertMs = CONFIG.flapAlertMs,
    flapCountAlert = CONFIG.flapCountAlert,
    flapWindowMs = CONFIG.flapWindowMs,
    mismatchNotifyMs = CONFIG.mismatchNotifyMs,
    flushCooldownMs = CONFIG.flushCooldownMs,
    flushBatch = CONFIG.flushBatch,
    notifyEnabled = CONFIG.notifyEnabled,
    onTick = null, // 钩子：每轮探测完成后调用 (wanOk, lanOk, trafficOk)；wanGuard 复活引擎挂这里
  } = deps;

  const state = {
    lan: null, wan: null, traffic: null, // null=未探测，true=up，false=down
    failLan: 0, failWan: 0, failTraffic: 0,
    lanDownSince: 0, wanDownSince: 0, trafficDownSince: 0,
    egressIp: '', lastEgressCheck: 0,
    lastLogAt: 0, startedAt: now(),
    events: [], // 内存 ring（最近 50 条事件，summary 直接吐）
  };

  // fmtTs 已提升到模块作用域（main() 装配层 boot_after_offline 同用）——闭包内
  // 不再重复定义，此处引用即提升版（engine 返回的 fmtTs 指向同一函数）。

  function record(type, row) {
    const line = { ts: now(), type, ...row };
    appendLog(line);
    if (type === 'event') {
      state.events.unshift({ ...line, tsText: fmtTs(line.ts) });
      if (state.events.length > 50) state.events.length = 50;
    }
    return line;
  }

  const BACKLOG_MAX = 50; // 积压上限：一直不配置 webhook 时防无限增长（丢最旧）

  // 事件分级（2026-09-28 刷屏事故整改 → v13 事故聚合重构）：
  // 只有「持续断开 / 恢复汇总 / 会话被占 / 出口 IP 变化」才即时私聊；
  // 单次翻转（*_down/*_up）只落盘（jsonl 事件流不变，可回放）——校园网半死不活状态下
  // 一分钟级翻转 × 全天 = 36 条/天的私信轰炸（2026-10-05 实测 60 条事故的主力）。
  // 复活过程细节（start/success/no_candidates/throttled）照旧只落盘+进积压。
  const NOTIFY_IMMEDIATE = new Set([
    'lan_down_sustained', 'wan_down_sustained', 'traffic_down_sustained',
    'lan_recovered', 'wan_recovered', 'traffic_recovered',
    'egress_ip_changed', 'revive_exhausted', 'boot_after_offline',
    'revive_session_mismatch', // v12：出口本通但会话被他人账号放行，换号无效需人工——低频且必须知晓
    'account_demoted', // v18：账号被抢垫底 24h（池里有别人在用这个号——曼波需要知晓）
    'wan_restricted', // v16：出口半残（部分白名单通）——认证/放行异常指纹，翻转才发天然低频
  ]);

  // 即时事件冷却（v13）：冷却期内不私聊只落盘+进积压（汇总卡可见）。mismatch 在账号被抢
  // 拉锯期每 30 分钟一条 × 全天 20 条——同一局面重复播报没有信息增量。
  const NOTIFY_COOLDOWN_MS = { revive_session_mismatch: mismatchNotifyMs, account_demoted: mismatchNotifyMs };
  const lastImmediateOkAt = {}; // event → 上次私聊成功时刻（只成功才占用冷却）

  async function notify(event, detail) {
    if (!notifyEnabled) return; // 播报全关（v21）：不外发不积压；emit 已先 record，jsonl 照记可回放
    const text = `[netlog] ${event}${detail ? `\n${detail}` : ''}`;
    if (!NOTIFY_IMMEDIATE.has(event)) {
      // 过程事件：直接进积压（断网恢复后由汇总卡带上，平时不打扰通知群）
      pushBacklog(event, detail, 'process-event');
      return;
    }
    const cd = NOTIFY_COOLDOWN_MS[event];
    if (cd && now() - (lastImmediateOkAt[event] || 0) < cd) {
      pushBacklog(event, detail, 'notify-cooldown');
      return;
    }
    try {
      await sendNotify(text);
      lastImmediateOkAt[event] = now();
    } catch (err) {
      // 推送失败（断网时必然失败）→ 积压，恢复后汇总补发
      pushBacklog(event, detail, err.message);
      console.warn(`[netlog] 通知发送失败已积压: ${err.message}`);
    }
  }

  function pushBacklog(event, detail, error) {
    const backlog = readBacklog();
    backlog.push({ id: `${now()}-${Math.random().toString(36).slice(2, 8)}`, ts: now(), event, detail, error });
    while (backlog.length > BACKLOG_MAX) backlog.shift();
    writeBacklog(backlog);
  }

  /**
   * emit(event, detail, opts)
   *   opts.silent=true → 只落盘（jsonl + 内存 ring），不通知不积压（v13 翻转痕迹专用：
   *   事件流可回放，通知走事故聚合通道 down_sustained/recovered）。
   */
  function emit(event, detail, opts = {}) {
    record('event', { event, detail });
    console.log(`[netlog] 事件 ${event}${detail ? `: ${detail}` : ''}`);
    if (opts.silent) return Promise.resolve();
    return notify(event, detail);
  }

  // ---- 事故聚合（v13）：per 探测维度维护「抖动群」，翻转只落盘，报警/恢复按群汇总 ----
  const incidents = {}; // key(lan/wan/traffic) → { downs, totalMs, firstAt, lastDownAt, segStart, alertedAt, meta }
  let flushAsap = false; // wan down→up 翻转置位：恢复瞬间允许立即补发积压（绕过补发冷却）

  function openSegment(key, meta) {
    const t = now();
    const inc = incidents[key];
    if (inc && t - inc.lastDownAt < flapWindowMs) {
      inc.downs += 1; // 窗口内又抖了：同一抖动群累计（窗口外的视为新群）
    } else {
      incidents[key] = { downs: 1, totalMs: 0, firstAt: t };
    }
    Object.assign(incidents[key], { lastDownAt: t, segStart: t, alertedAt: 0, meta });
  }

  async function closeSegment(key, lastDurMs) {
    const inc = incidents[key];
    if (!inc) return;
    inc.totalMs += lastDurMs;
    const sustainedAlerted = inc.alertedAt > 0;
    if (sustainedAlerted || inc.totalMs >= flapAlertMs || inc.downs >= flapCountAlert) {
      const scope = inc.downs > 1
        ? `窗口内断开 ${inc.downs} 次、累计 ${Math.round(inc.totalMs / 1000)}s（${fmtTs(inc.firstAt)} 起）`
        : `断开历时 ${Math.round(lastDurMs / 1000)}s`;
      await emit(`${key}_recovered`,
        `${inc.meta} 恢复${sustainedAlerted ? '（持续断开后）' : ''}，${scope}`);
    }
    // 抖动群保留至窗口过期（expireIncidents），窗口内的后续抖动继续累计
    inc.segStart = 0;
    inc.alertedAt = 0;
  }

  /** 断开进行中的持续报警（tick 内调）：达到 downAlertMs 即时报警，其后每 stillDownRealertMs 复报一次 */
  async function checkSustained() {
    const t = now();
    for (const key of Object.keys(incidents)) {
      const inc = incidents[key];
      if (!inc.segStart) continue; // 未在断开中
      const segMs = t - inc.segStart;
      if (segMs >= downAlertMs && (!inc.alertedAt || t - inc.alertedAt >= stillDownRealertMs)) {
        const prevAlertAt = inc.alertedAt;
        inc.alertedAt = t;
        await emit(`${key}_down_sustained`,
          `${inc.meta} 持续断开 ${Math.round(segMs / 60000)} 分钟（自 ${fmtTs(inc.segStart)}${prevAlertAt ? `，距上次报警 ${Math.round((t - prevAlertAt) / 60000)} 分钟` : ''}）`);
      }
    }
  }

  /** 抖动群窗口过期清理：恢复后 flapWindowMs 内无新断开 → 群收档（未达阈值的就此静默翻篇） */
  function expireIncidents() {
    const t = now();
    for (const key of Object.keys(incidents)) {
      const inc = incidents[key];
      if (!inc.segStart && t - inc.lastDownAt > flapWindowMs) delete incidents[key];
    }
  }

  /** 断/恢复通用翻转：防抖记 down（连续 threshold 次失败），一次成功记 up。
   *  v13：翻转痕迹（*_down/*_up）silent 落盘不私聊——通知由事故聚合通道（down_sustained/recovered）出 */
  async function flip(key, ok, meta) {
    const isDown = state[key] === false;
    const cap = key.charAt(0).toUpperCase() + key.slice(1);
    if (!ok) {
      state[`fail${cap}`] += 1;
      const fails = state[`fail${cap}`];
      if (!isDown && fails >= failThreshold) {
        state[key] = false;
        state[`${key}DownSince`] = now();
        openSegment(key, meta);
        await emit(`${key}_down`, `${meta} 连续 ${fails} 次探测失败，判定断开 @ ${fmtTs(now())}`, { silent: true });
      }
      return;
    }
    state[`fail${cap}`] = 0;
    if (isDown) {
      const dur = now() - state[`${key}DownSince`];
      const downSinceTs = state[`${key}DownSince`];
      state[key] = true;
      state[`${key}DownSince`] = 0; // 清零：否则 summary 在恢复后仍挂着旧断开时刻（2026-10-04 发现）
      await emit(`${key}_up`, `${meta} 恢复，断开历时 ${Math.round(dur / 1000)}s（${fmtTs(downSinceTs)} → ${fmtTs(now())}）`, { silent: true });
      if (key === 'wan') flushAsap = true; // 恢复瞬间优先补发积压（v8 滞留教训 + v13 限频的恢复旁路）
      await closeSegment(key, dur);
    } else if (state[key] === null) {
      state[key] = true; // 首轮探测直接成功：只落状态不报事件
    }
  }

  let lastFlushOkAt = 0; // 上次成功补发时刻（内存：重启后允许立即补发一次，方向安全）

  async function flushBacklog() {
    if (!notifyEnabled) return; // 播报全关（v21）：积压保持原样——不补发也不丢弃
    const backlog = readBacklog();
    if (!backlog.length) return;
    const t = now();
    // v13 补发限频：三条件任一满足才发——wan 恢复翻转（flushAsap）、攒够一批（flushBatch，
    // 防积压逼近 50 上限丢最旧）、距上次补发超 flushCooldownMs（迟到兜底）。
    // 此前 wan 通着就每轮尝试：拉锯期过程事件每 30 分钟落 2-3 条 → 每轮一张汇总卡刷屏。
    if (!flushAsap && backlog.length < flushBatch && t - lastFlushOkAt < flushCooldownMs) return;
    const lines = backlog.map((b) => `· ${fmtTs(b.ts)} ${b.event}${b.detail ? `：${b.detail}` : ''}`);
    const text = `[netlog] 断网期间事件汇总（${backlog.length} 条，现已恢复）\n${lines.join('\n')}`;
    try {
      await sendNotify(text);
    } catch (err) {
      console.warn(`[netlog] 积压补发仍失败（保留待下轮）: ${err.message}`);
      return;
    }
    flushAsap = false;
    lastFlushOkAt = t;
    // 按 id 剔除已发条目后写回——冲刷期间新落盘的积压不被覆盖丢失（quiet-flush v87 同款教训）
    const sentIds = new Set(backlog.map((b) => b.id));
    writeBacklog(readBacklog().filter((b) => !sentIds.has(b.id)));
    console.log(`[netlog] 积压已补发 ${backlog.length} 条`);
  }

  async function checkEgress(reason) {
    state.lastEgressCheck = now();
    let ip = null;
    try { ip = await fetchEgressIp(); } catch { /* 查不到不阻塞主流程 */ }
    if (!ip) return;
    const prev = state.egressIp;
    state.egressIp = ip;
    if (prev && prev !== ip) {
      await emit('egress_ip_changed', `出口 IP ${prev} → ${ip}（${reason}）——校园网会话可能重连过，若开 IP 白名单需比对（运维台 /api/egress-ip 参照）`);
    }
  }

  async function tick() {
    let lanOk = false;
    let wanOk = false;
    let trafficOk = true; // trafficProbe 未注入时恒真（旧桩/纯 TCP 语义兼容）
    try { lanOk = await probeLan(); } catch { /* 探测异常按失败计 */ }
    try { wanOk = await probeWan(); } catch { /* 同上 */ }
    if (probeTraffic) { try { trafficOk = await probeTraffic(); } catch { trafficOk = false; } }

    const prevWanUp = state.wan === true;
    await flip('lan', lanOk, `主路由 ${CONFIG.lanHost}:${CONFIG.lanPort}`);
    await flip('wan', wanOk, '公网出口');
    await flip('traffic', trafficOk, '流量探测（HTTP 全链路）');
    await checkSustained(); // v13：断开进行中的持续报警/复报（翻转之后判，首 tick 即可命中阈值）
    expireIncidents(); // 抖动群窗口过期收档
    record('state', { lan: lanOk, wan: wanOk, traffic: trafficOk, egressIp: state.egressIp });

    // 出口 IP：wan 刚恢复 或 到达心跳间隔才查（限频，防探测目标限流）
    if (wanOk && (state.wan !== prevWanUp || now() - state.lastEgressCheck >= egressIntervalMs || !state.lastEgressCheck)) {
      await checkEgress(state.wan !== prevWanUp ? '断网恢复' : '定期心跳');
    }
    // 积压冲刷：wan 通着就每轮尝试（受 v13 补发限频约束：恢复翻转/攒批/超时三条件）。
    // 不能只在 down→up 翻转时冲——复活引擎自愈的短暂断网用原始单轮信号触发，常抢在
    // 2 轮防抖判定之前，状态机从未翻转 → revive_start/success 过程事件永远滞留积压、
    // 复活通知永远发不出（2026-10-04 20:21 实况：55s 自愈成功但通知卡滞留）。wanOk 时
    // 冲刷同时自愈这类历史滞留。
    if (wanOk) await flushBacklog();
    // 复活引擎钩子（传当轮原始探测结果——有意不用防抖态：wan 首轮失败即启动复活，
    // 抢在 2 轮防抖判定之前自愈；代价是单轮抖动也会触发一次 login，由 eportal 应答
    // 与账号池冷却兜底。wanGuard 侧文档同此口径。trafficOk 让 guard 抓「握手通流量断」
    // 的软踢/限速场景——v9 曼波实况：TCP 握手全绿但网页刷不开，换账号认证立刻恢复）
    if (onTick) await onTick(wanOk, lanOk, trafficOk);
    state.lastLogAt = now();
  }

  function summary() {
    return {
      now: fmtTs(now()),
      lan: state.lan, wan: state.wan, traffic: state.traffic,
      lanDownSince: state.lanDownSince ? fmtTs(state.lanDownSince) : null,
      wanDownSince: state.wanDownSince ? fmtTs(state.wanDownSince) : null,
      trafficDownSince: state.trafficDownSince ? fmtTs(state.trafficDownSince) : null,
      egressIp: state.egressIp || null,
      lastEgressCheck: state.lastEgressCheck ? fmtTs(state.lastEgressCheck) : null,
      startedAt: fmtTs(state.startedAt),
      incidents: Object.fromEntries(Object.entries(incidents).map(([k, inc]) => [
        k, { downs: inc.downs, totalMs: inc.totalMs, firstAt: fmtTs(inc.firstAt), down: !!inc.segStart, alerted: !!inc.alertedAt },
      ])), // v13 抖动群观察窗（summary 直出）
      recentEvents: state.events,
    };
  }

  return { state, tick, summary, flushBacklog, emit, fmtTs };
}

// ============================================================
// 真实依赖组装 + HTTP 端点
// ============================================================
/** v14：wan 数据面多供应商 AND（可测）——逐目标探测后交三态判定，取 ok 布尔 */
async function wanPlanePass(httpsTargets, probeFn) {
  const results = [];
  for (const url of httpsTargets || []) results.push(await probeFn(url));
  return wanPlaneJudge(results).ok;
}

/**
 * v16：wan 数据面三态判定（可测纯逻辑）。
 *   全过 = { ok:true,  restricted:false }（健康）
 *   部分过 = { ok:false, restricted:true }（受限/半残：认证或放行异常的指纹——
 *            2026-10-07 实锤受限会话对阿里白名单真实放行，单看布尔会漏掉这层信息）
 *   全不过 = { ok:false, restricted:false }（down）
 */
function wanPlaneJudge(results) {
  const arr = Array.isArray(results) ? results : [];
  if (arr.length === 0) return { ok: false, restricted: false };
  const passed = arr.filter(Boolean).length;
  return { ok: passed === arr.length, restricted: passed > 0 && passed < arr.length };
}

// ---- 探针矩阵（v16）：每轮逐目标结果快照，summary 直出 + 报警 detail 引用 ----
let lastProbeMatrix = {};
let engineRef = null; // engine 创建后回填（probeWan/probeTraffic 闭包里走事件链路）
let lastRestricted = false;
function noteProbeMatrix(patch) {
  Object.assign(lastProbeMatrix, patch, { at: Date.now() });
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const net = require('net');
    const socket = net.connect({ host, port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

function httpRequestText(url, { timeoutMs = 5000, method = 'GET', body = null, headers = {}, tls = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method, headers, timeout: timeoutMs, ...tls }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
        else reject(new Error(`HTTP ${res.statusCode}`));
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/** DoH 响应判定（v12 纯函数，可测）：TLS+HTTP 数据面真伪——200 且 body 为 DoH JSON（含 Status 字段）。
 *  认证网关代答只能伪造 TCP 握手，伪造不了 TLS 上的合法 DoH 响应；captive portal 劫持页即使
 *  握手成功（自签证书），body 也不是 DoH JSON → false */
function dohResponseOk(status, body) {
  return status === 200 && typeof body === 'string' && body.includes('"Status"');
}

/** HTTPS 层探测（v12）：DoH 端点完整 TLS+HTTP 往返。rejectUnauthorized 关闭仅因目标以裸 IP
 *  访问（223.5.5.5 证书 SAN 为域名不匹配），身份无涉探测语义，数据面真伪由 dohResponseOk 把关 */
async function probeHttps(url, timeoutMs = CONFIG.timeoutMs * 2) {
  try {
    const body = await httpRequestText(url, { timeoutMs, tls: { rejectUnauthorized: false } });
    return dohResponseOk(200, body);
  } catch {
    return false;
  }
}

const DATA_FILE = path.join(CONFIG.dataDir, 'net-log.jsonl');
const BACKLOG_FILE = path.join(CONFIG.dataDir, 'backlog.json');

function ensureDataDir() {
  fs.mkdirSync(CONFIG.dataDir, { recursive: true });
}
function appendLog(line) {
  try {
    ensureDataDir();
    fs.appendFileSync(DATA_FILE, JSON.stringify(line) + '\n');
  } catch (err) {
    console.error(`[netlog] 日志落盘失败: ${err.message}`);
  }
}
function readBacklog() {
  try {
    const raw = fs.readFileSync(BACKLOG_FILE, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** 上一进程最后一条日志的心跳时刻（断电感知用：文件尾部倒序找第一条可解析 ts） */
function lastLogTs() {
  try {
    const lines = fs.readFileSync(DATA_FILE, 'utf8').trim().split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      try { const o = JSON.parse(lines[i]); if (Number(o.ts) > 0) return Number(o.ts); } catch { /* 跳过半截行 */ }
    }
  } catch { /* 无日志文件（首跑） */ }
  return 0;
}

/** 离线间隔判定（纯函数，stub 可测）：间隔超阈值返回信息对象，否则 null */
function offlineGapInfo(lastTs, nowMs, thresholdMs) {
  if (!lastTs || lastTs <= 0) return null; // 首跑无历史
  const ms = nowMs - lastTs;
  if (ms < thresholdMs) return null; // 常规重启（秒级）不算离线
  const minutes = ms / 60000;
  const human = minutes >= 1440 ? `${(minutes / 1440).toFixed(1)} 天` : minutes >= 60 ? `${(minutes / 60).toFixed(1)} 小时` : `${Math.round(minutes)} 分钟`;
  return { lastTs, now: nowMs, ms, human };
}
function writeBacklog(list) {
  try {
    ensureDataDir();
    fs.writeFileSync(BACKLOG_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.error(`[netlog] 积压写盘失败: ${err.message}`);
  }
}

/** 通知出口（v6，曼波拍板「不用 webhook 用机器人本体」）：
 *  仅走对话型机器人（共用应用）私聊 NETLOG_NOTIFY_OPEN_IDS；
 *  任一目标成功即视为送达；全部失败抛错（调用方积压）。 */
async function sendNotify(text) {
  if (!CONFIG.notifyEnabled) throw new Error('通知已全关（NETLOG_NOTIFY_ENABLED=false）');
  const tasks = [];
  for (const oid of feishu.NOTIFY_OPEN_IDS) {
    tasks.push({ name: `dm:${oid.slice(0, 12)}`, run: () => feishu.sendTextToOpenId(oid, text) });
  }
  if (!tasks.length) throw new Error('未配置通知目标（NETLOG_NOTIFY_OPEN_IDS 为空）');
  const results = await Promise.allSettled(tasks.map((t) => t.run()));
  const failures = results.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
  const okCount = results.length - failures.length;
  if (okCount === 0) throw new Error(failures.join(' ; ').slice(0, 240));
  if (failures.length) console.warn(`[netlog] 部分通知目标失败（已送达 ${okCount}/${results.length}）: ${failures.join(' ; ').slice(0, 200)}`);
}

async function fetchEgressIp() {
  for (const url of CONFIG.egressUrls) {
    try {
      const text = (await httpRequestText(url, { timeoutMs: 5000 })).trim();
      const ip = text.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/);
      if (ip) return ip[1];
    } catch { /* 换下一个候选源 */ }
  }
  return null;
}


// ============================================================
// wanGuard 复活引擎组装（v2）：账号池 × Dr.COM eportal × 慢速降级
// guard 与 engine 相互需要（guard.emit → engine.emit），用后绑定解环：
// guard 先建（emit 走占位），engine 建好后回填 emitRef。
// ============================================================
let guard = null;
let emitRef = (event, detail) => console.log(`[netlog] (emit 未就绪) ${event} ${detail || ''}`);
try {
  const { createAccountPool, createDemoteStore, rankWithDemotions } = require('./accountPool');
  const campusAuth = require('./campusAuth');
  const { createWanGuard } = require('./wanGuard');

  const pool = createAccountPool(CONFIG.accountPool);
  const demoteStore = createDemoteStore(CONFIG.demoteFile);

  /** 单次 wan 探测延迟（v12 走 HTTPS 数据面：TCP 代答握手只有几 ms，会把基线压到
   *  下限 30ms 使慢速判定永远通过；TLS 往返才反映真实链路质量） */
  async function probeLatency() {
    for (const url of CONFIG.httpsTargets) {
      const start = Date.now();
      const ok = await probeHttps(url);
      if (ok) return Date.now() - start;
    }
    return null;
  }

  guard = createWanGuard({
    // v18：候选按垫底状态重排（健康的在前、被抢垫底的沉底——「首选只是优先不是拉锯」）
    candidates: () => rankWithDemotions(pool.listCandidates(), demoteStore.active()),
    authIp: () => campusAuth.fetchAuthIp(),
    login: (acct) => campusAuth.login(acct),
    probeLatency,
    // v12 成功判定核会话归属：online_list 里当前账号真在线才算复活成功
    verifySession: async (user) => {
      const list = await campusAuth.onlineList();
      return Array.isArray(list) && list.some((s) => s.user === user);
    },
    ban: (user, reason) => pool.banThisMonth(user, reason),
    demote: (user, hours, reason) => demoteStore.demote(user, hours, reason),
    demotions: () => demoteStore.active(),
    kickDemoteHours: CONFIG.kickDemoteHours,
    emit: (event, detail) => emitRef(event, detail),
  });

  // v12 修复：trafficOk 此前在接线处被丢弃（wrapper 只收两参），软踢/认证死场景
  // guard 永远收到 true → 复活引擎整晚安睡（2026-10-05 05:28 事故元凶）
  var guardOnTick = (wanOk, lanOk, trafficOk = true) => guard.onTick(wanOk, lanOk, trafficOk);
} catch (err) {
  console.error(`[netlog] 复活引擎初始化失败（退化为纯日志探针）: ${err.message}`);
  var guardOnTick = null;
}

let feishu = { NOTIFY_OPEN_IDS: [] };
try { feishu = require('./feishu'); } catch (err) { console.warn(`[netlog] 飞书私聊模块不可用: ${err.message}`); }

const engine = createEngine({
  probeLan: () => probeTcp(CONFIG.lanHost, CONFIG.lanPort, CONFIG.timeoutMs),
  probeWan: async () => {
    // v12 TCP 预检（真断网快速失败）→ v14/v16 多供应商 DoH 数据面三态判定：
    // 全过=ok；部分过=restricted（受限/半残指纹——2026-10-07 实锤受限会话对阿里白名单
    // 真实放行）；全不过=down。布尔主链只看 ok；restricted 翻转补发精准事件。
    let tcpOk = false;
    let wanTcpTarget = null;
    for (const t of CONFIG.wanTargets) {
      if (await probeTcp(t.host, t.port, CONFIG.timeoutMs)) { tcpOk = true; wanTcpTarget = `${t.host}:${t.port}`; break; }
    }
    if (!tcpOk) {
      noteProbeMatrix({ wanTcp: null, wanDoh: [], wanState: 'down' });
      return false;
    }
    const results = [];
    for (const url of CONFIG.httpsTargets) {
      const label = new URL(url).host;
      results.push({ target: label, ok: await probeHttps(url) });
    }
    const judge = wanPlaneJudge(results.map((r) => r.ok));
    noteProbeMatrix({ wanTcp: wanTcpTarget, wanDoh: results, wanState: judge.ok ? 'ok' : judge.restricted ? 'restricted' : 'down' });
    if (judge.restricted !== lastRestricted && engineRef) {
      lastRestricted = judge.restricted;
      const detail = `出口半残（${results.map((r) => `${r.target}=${r.ok ? '通' : '断'}`).join('，')}）——认证/放行异常指纹，复活引擎已介入；若持续请检查主路由认证会话`;
      engineRef.emit(judge.restricted ? 'wan_restricted' : 'wan_restricted_recover', detail).catch(() => {});
    } else {
      lastRestricted = judge.restricted;
    }
    return judge.ok;
  },
  // 流量探测（v9）：generate_204 源 HTTP 全链路，status=204 即通过；超时取 TCP 的 2 倍
  //（HTTP 完整往返比握手慢，但目标极轻，正常 <200ms）
  probeTraffic: async () => {
    const perSource = [];
    let anyOk = false;
    for (const url of CONFIG.trafficUrls) {
      const status = await new Promise((resolve) => {
        let settled = false;
        const done = (v) => { if (!settled) { settled = true; resolve(v); } };
        try {
          const req = http.request(url, { method: 'GET', timeout: CONFIG.timeoutMs * 2, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
            res.resume(); // 204 无 body，弹掉防句柄悬挂
            done(res.statusCode);
          });
          req.on('timeout', () => { req.destroy(); done(0); });
          req.on('error', () => done(0));
          req.end();
        } catch { done(0); }
      });
      perSource.push({ target: new URL(url).host, status });
      if (status === 204) anyOk = true;
    }
    noteProbeMatrix({ traffic: perSource });
    return anyOk;
  },
  fetchEgressIp,
  appendLog,
  readBacklog,
  writeBacklog,
  onTick: async (wanOk, lanOk, trafficOk = true) => {
    if (!CONFIG.reviveEnabled || !guardOnTick) return;
    try {
      await guardOnTick(wanOk, lanOk, trafficOk);
      if (wanOk && guard) await guard.sampleBaseline();
    } catch (err) {
      console.error(`[netlog] wanGuard tick 异常: ${err.message}`);
    }
  },
});
emitRef = (event, detail) => engine.emit(event, detail); // 回填：guard 事件进引擎的记录+通知链路
engineRef = engine; // v16：probeWan/probeTraffic 闭包的 restricted 等事件出口

// ============================================================
// 路由器无线状态观测（v14）：主路由半死（射频信标不发/DHCP 僵死）时有线侧
// 一切正常，探针全绿——只有登进管理面才看得见。低频观测，异常翻转走事件链路。
// NETLOG_ROUTER_PASSWORD 未配置 = 停用（零凭据时静默退化，不影响探针主业）
// ============================================================
let routerWatch = { tick: async () => ({ skipped: 'disabled' }), summary: () => ({ enabled: false }) };
try {
  const { createRouterWatch } = require('./routerWatch');
  const { probeDhcp, DEFAULT_PROBE_MAC, PROBE_TIMEOUT_MS, parseProbeMac } = require('./dhcpProbe');
  // v17：固定探针 MAC——陌生 MAC 首查会踩路由器 3~4s 检查路径（3000ms 超时下
  // 掷骰子，dhcp_down 振荡全是伪影）；固定 MAC 首查进快表后恒毫秒级，连续
  // 超时才是服务真挂。可用 NETLOG_DHCP_PROBE_MAC 覆盖（非法值回退默认）。
  const probeMac = parseProbeMac(process.env.NETLOG_DHCP_PROBE_MAC) || DEFAULT_PROBE_MAC;
  routerWatch = createRouterWatch({
    host: CONFIG.routerWatchHost,
    password: process.env.NETLOG_ROUTER_PASSWORD || '',
    emit: async (event, detail) => { if (emitRef) await emitRef(event, detail); },
    dhcpProbe: () => probeDhcp({
      broadcastAddr: process.env.NETLOG_DHCP_BROADCAST || `${(CONFIG.routerWatchHost.split('.').slice(0, 3).join('.'))}.255`,
      timeoutMs: PROBE_TIMEOUT_MS,
      mac: probeMac,
    }),
  });
} catch (err) {
  console.error(`[netlog] routerWatch 初始化失败（观测停用）: ${err.message}`);
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/netlog/revive') {
      // 管理端点必须鉴权（全局工程规则）：X-API-Token，timingSafeEqual + fail-closed——未配置 token = 端点整体锁定
      const token = req.headers['x-api-token'] || '';
      const expected = CONFIG.apiToken;
      let authed = false;
      if (expected && token.length === expected.length) {
        authed = require('crypto').timingSafeEqual(Buffer.from(token), Buffer.from(expected));
      }
      if (req.method !== 'POST') {
        res.writeHead(405).end();
        return;
      }
      if (!authed) {
        console.warn(`[netlog] /api/netlog/revive 鉴权失败（token 未配置或不匹配），拒绝`);
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'forbidden' }));
        return;
      }
      if (!guard) {
        res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: 'guard 未初始化' }));
        return;
      }
      console.log('[netlog] 手动触发复活流程（API）');
      guard.forceRevive().then(() => {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, note: 'revive 流程已启动，结果看 /api/netlog/summary 与事件通知' }));
      }).catch((err) => {
        res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: false, error: String(err.message) }));
      });
      return;
    }
    if (req.method !== 'GET') {
      res.writeHead(405).end();
      return;
    }
    if (url.pathname === '/api/health') {
      const s = engine.summary();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, lan: s.lan, wan: s.wan, egressIp: s.egressIp, uptime: Math.round((Date.now() - engine.state.startedAt) / 1000) + 's' }));
      return;
    }
    if (url.pathname === '/api/netlog/summary') {
      const s = engine.summary();
      s.guard = guard ? guard.summary() : null;
      s.routerWatch = routerWatch.summary();
      s.probeMatrix = lastProbeMatrix; // v16：逐目标探针矩阵（wanTcp/wanDoh/traffic，排查哪层坏了一眼看清）
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(s, null, 2));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(CONFIG.port, () => {
    console.log(`[netlog] HTTP 端点已启动 :${CONFIG.port}（GET /api/health、/api/netlog/summary；POST /api/netlog/revive ${CONFIG.apiToken ? '已鉴权启用' : '未配置 NETLOG_API_TOKEN，已锁定'}）`);
  });
}

function main() {
  console.log(`[netlog] 启动：lan=${CONFIG.lanHost}:${CONFIG.lanPort} wan=${CONFIG.wanTargets.map((t) => `${t.host}:${t.port}`).join('/')} traffic=${CONFIG.trafficUrls.length}个204源 interval=${CONFIG.intervalMs}ms threshold=${CONFIG.failThreshold}`);
  console.log(`[netlog] 数据目录 ${CONFIG.dataDir}（net-log.jsonl + backlog.json）；通知=${CONFIG.notifyEnabled ? '机器人私聊 ' + (feishu.NOTIFY_OPEN_IDS.length ? feishu.NOTIFY_OPEN_IDS.length + ' 个目标' : '（未配置 NETLOG_NOTIFY_OPEN_IDS，只落盘）') : '已全关（NETLOG_NOTIFY_ENABLED=false，事件照落盘可回放）'}`);
  console.log(`[netlog] 复活引擎 ${CONFIG.reviveEnabled ? '启用' : '停用'}：账号池 ${CONFIG.accountPool}${guard ? `（候选 ${(guard.summary().queueRemaining.length + (guard.summary().currentUser ? 1 : 0)) || '按池文件'}，首选项见 preferred）` : '（未初始化）'}`);
  startServer();
  // 断电感知（v11）：与上一进程最后心跳间隔超阈值 → 「离线后重新上线」卡
  // （机器断电时本服务同死，无法实时报警；这是恢复后立刻补报的唯一正确语义）
  const gap = offlineGapInfo(lastLogTs(), Date.now(), CONFIG.offlineNotifyMs);
  if (gap) {
    engine.emit('boot_after_offline', `设备离线 ${gap.human} 后重新上线（${fmtTs(gap.lastTs)} → ${fmtTs(gap.now)}，疑似断电；若为断电请核实 BIOS「After Power Failure=Power On」与 CMOS 电池）`)
      .catch((err) => console.warn(`[netlog] 断电感知通知失败（已积压待恢复补发）: ${err.message}`));
  }
  // 启动即尝试补发历史积压（断网期间积压但通知未送达的，配置就绪重启后送达）
  engine.flushBacklog().catch((err) => console.warn(`[netlog] 启动补发积压未完成（保留待下轮）: ${err.message}`));
  engine.tick().catch((err) => console.error(`[netlog] 首轮探测异常: ${err.message}`));
  setInterval(() => engine.tick().catch((err) => console.error(`[netlog] 探测轮异常: ${err.message}`)), CONFIG.intervalMs);
  // 路由器无线状态观测（v14）：独立低频循环；首拍立即对齐一次基线
  if (routerWatch.summary().enabled) {
    routerWatch.tick().catch((err) => console.error(`[netlog] routerWatch 首拍异常: ${err.message}`));
    setInterval(() => routerWatch.tick().catch((err) => console.error(`[netlog] routerWatch tick 异常: ${err.message}`)), CONFIG.routerWatchIntervalMs);
    console.log(`[netlog] routerWatch 已启用：每 ${Math.round(CONFIG.routerWatchIntervalMs / 60000)} 分钟观测 ${CONFIG.routerWatchHost} 无线状态`);
  } else {
    console.log('[netlog] routerWatch 停用（未配置 NETLOG_ROUTER_PASSWORD）');
  }
}

if (require.main === module) main();

module.exports = { createEngine, CONFIG, fmtShanghai: (ts) => new Date(ts + 8 * 3600 * 1000).toISOString(), offlineGapInfo, dohResponseOk, probeHttps, wanPlanePass, wanPlaneJudge };
