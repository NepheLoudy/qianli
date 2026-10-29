const express = require('express');
const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');
const { dispatchFrame, deliveryStatsSnapshot } = require('./dispatch');
const { recordFeature } = require('./usage');
const usage = require('./usage');
const bitableSync = require('./bitable-sync');
const { requireApiToken } = require('./auth');
const { fetchWithTimeout, TOKEN_TIMEOUT_MS } = require('./http');

const app = express();
app.use(express.json({ limit: '2mb' }));

let wsStarted = false;
let wsLastError = null;
let wsConnecting = false;
let wsConnectingSince = 0; // connecting 持续计时（巡检兜底用）
let wsRetryTimer = null;
let wsRetryCount = 0;
let wsClient = null;          // 当前 WSClient 实例（重试时整体新建）
let wsStatusTimer = null;     // 连接状态巡检（兜底 SDK 静默失败场景）
let wsSdkState = null;        // SDK 原始连接态透出（2026-10-30 审查批 P2 可观测性：reconnecting 等此前 health 恒报 running）
const WS_RETRY_BASE_MS = 2 * 1000;      // 首次重试 2s(2026-09-14 提速:校园网被踢秒级自愈后尽快恢复事件流)
const WS_RETRY_MAX_MS = 5 * 60 * 1000;  // 封顶 5 分钟
const WS_CONNECTING_GIVE_UP_MS = Number(process.env.WS_CONNECTING_GIVE_UP_MS) || 5 * 60 * 1000; // connecting 恒挂兜底阈值（v21 遗留死常量 WS_START_WATCHDOG_MS 的本来语义，v154 落地实现）无响应看门狗

app.get('/api/health', (req, res) => {
  const full = {
    status: 'ok',
    ws: wsLastError ? `error: ${wsLastError}` : wsStarted ? (wsSdkState && wsSdkState !== 'connected' ? `running(${wsSdkState})` : 'running') : wsConnecting ? 'connecting' : 'stopped',
    uptime: process.uptime(),
    defaultTarget: config.defaultTarget,
    consumers: config.consumers,
    routes: config.messageRoutes,
    delivery: deliveryStatsSnapshot(),
  };
  // R10⑤（2026-09-15）：消费者清单/路由表/投递统计只对本机回环调用方暴露
  //（LAN 内工具只需 ws 状态做存活判断；服务绑定 0.0.0.0 供 LAN 冒烟测试是既有设计）
  const remote = String((req.socket && req.socket.remoteAddress) || '');
  const loopback = /^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/.test(remote);
  res.json(loopback ? full : { status: full.status, ws: full.ws, uptime: full.uptime });
});

// 使用统计（运维台活跃看板数据源）：?days=N 聚合最近 N 天（默认 1，最大 30）
// 【已知取舍，2026-09-27 成文】无鉴权只读：LAN 内任何主机可读全员 open_id 级使用/被@统计。
// 历史背景：该端点早于 0.0.0.0 绑定（服务曾仅回环可达）；现随服务绑 0.0.0.0 供 LAN 冒烟测试
// （同 /api/health 惯例），数据为聚合计数、无写风险、不含密钥，评估后保留只读开放不加鉴权；
// 若未来暴露面扩大（出公网）须重新评估
app.get('/api/usage', (req, res) => {
  res.json(usage.aggregate(req.query.days));
});

// 群聊被@统计（2026-09-24 团队负载算法数据源，pm-robot /api/hub/workload 消费）：
// ?days=N 滑窗按人求和（默认 7，最大 30），只读不鉴权照 /api/usage 惯例
// （取舍同 /api/usage：LAN 可读 open_id 级被@计数，无写风险，见上方成文）
app.get('/api/usage/mentions', (req, res) => {
  res.json(usage.aggregateMentions(req.query.days));
});

// 消费方归因上报（2026-09-13 统计覆盖规则）：hub 等服务把路由层看不见的功能命中
// 回报为队员/功能统计（不计 total 防双算）。规则见顶层 AGENTS「队员/功能统计上报规则」。
// 2026-09-22 活跃口径修正：娱乐功能上报须带 fun:1（不计入队员活跃），
// 抽奖另带 learn:[触发词] 供网关把 '/触发词' 路由记录学进娱乐清单
app.post('/api/usage/report', requireApiToken, (req, res) => {
  const { openId, feature, fun, learn } = req.body || {};
  if (!openId || !feature) return res.status(400).json({ error: '缺少 openId/feature' });
  recordFeature({
    senderId: openId,
    feature: String(feature).slice(0, 40),
    fun: fun ? 1 : 0,
    learn: Array.isArray(learn) ? learn : null,
  });
  res.json({ ok: true });
});

// 手动触发网关活跃 → 多维表格同步（动态广场看板；?force=1 忽略签名重写全部）
// 鉴权（2026-09-13）：需带 X-API-Token 头（GATEWAY_API_TOKEN，.env 存储）
app.post('/api/usage-sync/run', requireApiToken, async (req, res) => {
  try {
    res.json({ ok: true, result: await bitableSync.runSync({ force: req.query.force === '1' }) });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// 手动投递测试：POST {type, event} 或 {header:{event_type}, event}，走与长连接相同的分发管线
// 鉴权（2026-09-13）：需带 X-API-Token 头（GATEWAY_API_TOKEN，.env 存储）
app.post('/api/dispatch', requireApiToken, async (req, res) => {
  const { type, header, event } = req.body || {};
  const eventType = (header && header.event_type) || type;
  if (!eventType) {
    return res.status(400).json({ error: '缺少 event_type（header.event_type 或 type）' });
  }
  try {
    const result = await dispatchFrame(eventType, {
      header: Object.assign({ event_type: eventType }, header || {}),
      event,
    });
    res.json(Object.assign({ ok: true }, result || {}));
  } catch (err) {
    console.error('[网关] 手动投递失败:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

function startWs() {
  if (!config.feishu.appId || !config.feishu.appSecret) {
    console.warn('[网关] 未配置 APP_ID/APP_SECRET，长连接未启动（HTTP 服务可用，可通过 /api/dispatch 测试路由）');
    return;
  }

  // 2026-09-13（v21）：SDK 的 WSClient.start() 永不 reject（连接失败的唯一信号是
  // onError 回调与 getConnectionStatus().state==='failed'），promise 链不可依赖——
  // 改为 onError/onReady 回调驱动 + 30s 状态巡检兜底。
  // 每次尝试新建 WSClient：SDK 致命错误会置 terminalError 并停摆，旧实例状态不可信；
  // 新建保证同一时刻至多一条连接。
  wsStarted = false;
  wsConnecting = true;
  wsLastError = null;
  wsConnectingSince = 0; // v39：connecting 兜底计时按「本次尝试」起算（否则跨尝试沿用旧时间戳，重试首次巡检即误判超时自退）

  wsClient = new lark.WSClient({
    appId: config.feishu.appId,
    appSecret: config.feishu.appSecret,
    appType: lark.AppType.SelfBuild,
    domain: lark.Domain.FeiShu,
    loggerLevel: lark.LoggerLevel.info,
    onReady: () => {
      const recovered = wsRetryCount > 0;
      wsStarted = true;
      wsConnecting = false;
      wsLastError = null;
      wsRetryCount = 0;
      console.log(recovered ? '📡 长连接已恢复（重试成功）' : `📡 长连接已启动（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);
    },
    onReconnected: () => {
      wsStarted = true;
      wsConnecting = false;
      wsLastError = null;
    },
    onError: (err) => {
      // SDK 的 autoReconnect 会自行处理瞬时断线；走到这里的 onError 是致命错误
      // （凭证失败 / 重连耗尽，SDK 已置 terminalError 停摆）——必须新建客户端重试
      wsStarted = false;
      wsConnecting = false;
      wsConnectingSince = 0; // v39：终结本次尝试的计时（防跨尝试误判）
      wsLastError = (err && err.message) || String(err);
      wsRetryCount += 1;
      const delay = Math.min(WS_RETRY_BASE_MS * 2 ** Math.min(wsRetryCount - 1, 10), WS_RETRY_MAX_MS);
      console.error(`[网关] 长连接致命错误（第 ${wsRetryCount} 次），${Math.round(delay / 1000)}s 后新建客户端重试:`, wsLastError);
      scheduleWsRetry(delay);
    },
  });

  const dispatcher = new lark.EventDispatcher({});
  for (const eventType of config.eventTypes) {
    dispatcher.register({
      [eventType]: async (data) => {
        try {
          await dispatchFrame(eventType, data);
        } catch (err) {
          console.error(`[网关] 处理事件 ${eventType} 失败:`, err.message);
        }
      },
    });
  }

  wsClient.start({ eventDispatcher: dispatcher });
  console.log(`📡 长连接启动中（共用应用本机唯一连接），订阅事件: ${config.eventTypes.join(', ')}`);

  // 状态巡检（30s）：兜底「SDK 未触发 onError 也未连上」的静默失败场景
  if (!wsStatusTimer) {
    wsStatusTimer = setInterval(() => {
      // 取 SDK 原始态提前于早退条件：即使巡检处理逻辑被 wsStarted 早退，health 也能透出真实态
      // （reconnecting/idle 等此前对 health 失明——2026-10-30 审查批 P2-1 可观测性部分；
      // 巡检对已建连接的行为扩展列待确认，未改动）
      let stNow = null;
      try { stNow = wsClient && wsClient.getConnectionStatus ? wsClient.getConnectionStatus() : null; } catch { stNow = null; }
      wsSdkState = stNow && stNow.state ? stNow.state : null;
      if (!wsClient || wsRetryTimer || wsStarted) return;
      let st = stNow;
      if (st && st.state === 'failed') {
        wsConnecting = false;
        wsConnectingSince = 0;
        wsLastError = wsLastError || '状态巡检发现长连接 failed';
        console.error('[网关] 状态巡检发现长连接 failed，转入自动重试');
        scheduleWsRetry(WS_RETRY_BASE_MS);
      } else if (st && st.state === 'connected' && !wsStarted) {
        wsStarted = true;
        wsConnecting = false;
        wsConnectingSince = 0;
        wsLastError = null;
        wsRetryCount = 0;
        console.log('📡 长连接已连接（状态巡检确认）');
      } else if (st && st.state === 'connecting') {
        // connecting 恒挂是 SDK 静默停摆的形态之一（README 兜底承诺此前无实现）——超阈值自退，pm2 自动重建
        if (!wsConnectingSince) {
          wsConnectingSince = Date.now();
        } else if (Date.now() - wsConnectingSince > WS_CONNECTING_GIVE_UP_MS) {
          console.error(`[网关] 长连接卡在 connecting 超过 ${Math.round(WS_CONNECTING_GIVE_UP_MS / 60000)} 分钟，进程自退待 pm2 重建（v154 巡检兜底）`);
          process.exit(1);
        }
      }
    }, 30 * 1000);
  }
}

function scheduleWsRetry(delay) {
  if (wsRetryTimer) return;
  wsRetryTimer = setTimeout(() => {
    wsRetryTimer = null;
    startWs();
  }, delay);
}

// 兜底：任何未捕获的 Promise 拒绝只记日志，不允许击垮唯一长连接进程
process.on('unhandledRejection', (err) => {
  console.error('[网关] 未处理的 Promise 拒绝:', (err && err.message) || err);
});

// 多维表格记录变更事件的前置条件：订阅对应云文档（幂等，可重复调用）
async function subscribeDocs() {
  if (!config.docSubscribes.length || !config.feishu.appId || !config.feishu.appSecret) return;
  try {
    const tokenRes = await fetchWithTimeout(
      'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: config.feishu.appId, app_secret: config.feishu.appSecret }),
      },
      TOKEN_TIMEOUT_MS
    );
    const tokenData = await tokenRes.json();
    if (tokenData.code !== 0) {
      throw new Error(tokenData.msg || '获取 tenant_access_token 失败');
    }
    for (const appToken of config.docSubscribes) {
      const res = await fetchWithTimeout(
        `https://open.feishu.cn/open-apis/drive/v1/files/${appToken}/subscribe?file_type=bitable`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenData.tenant_access_token}` },
        }
      );
      const data = await res.json().catch(() => ({}));
      console.log(`[网关] 订阅云文档 ${appToken}: code=${data.code} ${data.msg || ''}`);
    }
  } catch (err) {
    console.error('[网关] 订阅云文档失败:', err.message);
  }
}

app.listen(config.port, () => {
  console.log(`🚀 feishu-gateway 运行在 http://localhost:${config.port}`);
  console.log(
    `   下游消费者: ${config.consumers.map((c) => `${c.name}${c.legacy ? '(legacy)' : ''}`).join(', ')}`
  );
  console.log(`   默认消息目标: ${config.defaultTarget}`);
  console.log(`   消息路由规则: ${config.messageRoutes.length} 条`);
  subscribeDocs();
  startWs();
  bitableSync.start();
});
