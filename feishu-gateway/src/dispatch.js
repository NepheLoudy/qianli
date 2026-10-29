const lark = require('@larksuiteoapi/node-sdk');
const config = require('./config');
const usage = require('./usage');
const { fetchWithTimeout } = require('./http');

// 已处理事件去重（飞书可能对同一事件重复投递；机器人侧也有 message_id 去重兜底）
const seenEvents = new Set();
const SEEN_MAX = 2000;

// 指令转发结果代回复用的飞书客户端（懒加载，未配凭证时为 null）
let larkClient = null;

function getLarkClient() {
  if (!larkClient && config.feishu.appId && config.feishu.appSecret) {
    larkClient = new lark.Client({
      appId: config.feishu.appId,
      appSecret: config.feishu.appSecret,
      appType: lark.AppType.SelfBuild,
      domain: lark.Domain.FeiShu,
    });
  }
  return larkClient;
}

function rememberKey(key) {
  if (seenEvents.has(key)) return true;
  seenEvents.add(key);
  if (seenEvents.size > SEEN_MAX) {
    seenEvents.delete(seenEvents.values().next().value);
  }
  return false;
}

/**
 * SDK 长连接投递的 data 可能是 {header, event} 包装结构，也可能是扁平事件体。
 * 统一归一化为飞书 HTTP 回调同款 {schema, header, event} 结构后再转发。
 */
function normalizeFrame(eventType, data) {
  const header =
    data && data.header && data.header.event_type
      ? data.header
      : Object.assign({ event_type: eventType }, (data && data.header) || {});
  const event = data && data.event !== undefined ? data.event : data;
  return { schema: '2.0', header, event };
}

function findConsumer(name) {
  return config.consumers.find((c) => c.name === name) || null;
}

function extractText(message) {
  if (!message) return '';
  if (message.message_type && message.message_type !== 'text') return '';
  // content 兼容两种形态：HTTP 回调/网关转发里是 JSON 字符串，SDK 某些版本里直接是对象
  let content = message.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content || '{}');
    } catch (err) {
      return '';
    }
  }
  return String((content && content.text) || '')
    .replace(/@_user_\d+\s*/g, '')
    .replace(/@_bot_\d+\s*/g, '')
    .replace(/@_everyone\s*/g, '')
    .trim();
}

function isMentioned(message) {
  if (!message || !Array.isArray(message.mentions)) return false;
  return message.mentions.some(
    (m) => m && (m.id === 'self' || m.mentioned_type === 'app' || m.mentioned_type === 'bot' || String(m.key || '').startsWith('@_bot'))
  );
}

function parseCommand(text) {
  if (!text || !text.startsWith('/')) return null;
  const parts = text.split(/\s+/);
  return { command: parts[0].toLowerCase(), args: parts.slice(1) };
}

async function postJson(url, body) {
  try {
    // 全部出站 POST 附共享 X-API-Token（历史口径统一附带；command 模式下游（approval 等）09-29 起
    // 管理端点挂鉴权靠它过闸）。2026-10-30 审查批注释勘误：原注释只提 command 模式与实现不符——
    // 现网消费者均在本机回环无泄露路径，未来新增指向外部的 CONSUMERS 时需重新评估附带范围
    const headers = { 'Content-Type': 'application/json' };
    if (process.env.GATEWAY_API_TOKEN) headers['X-API-Token'] = process.env.GATEWAY_API_TOKEN; // 与 auth.js 同源（config 未导出该键）
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, body: json };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

function withToken(frame) {
  return config.verificationToken ? Object.assign({}, frame, { token: config.verificationToken }) : frame;
}

function logDelivery(consumerName, what, result) {
  if (result.ok) {
    console.log(`[转发] → ${consumerName} ${what} ✓`);
  } else {
    const reason = result.error ? `error: ${result.error}` : `HTTP ${result.status}`;
    console.error(`[转发] → ${consumerName} ${what} ✗ ${reason}`);
  }
}

/**
 * 指令端点（/api/chat/command）只返回 {reply} 文本，不感知来源会话，
 * 由网关代为回复到原消息（与 hub 转发后回复的行为一致）
 */
async function replyText(messageId, text) {
  const client = getLarkClient();
  if (!client || !messageId) return;
  try {
    await client.im.message.reply({
      params: { message_id: messageId },
      data: { content: JSON.stringify({ text }), msg_type: 'text' },
    });
  } catch (err) {
    console.error('[转发] 代回复指令结果失败:', err.message);
  }
}

// 投递可靠性（2026-09-13 R3；2026-09-15 计数修正）：传输异常自动重试一次（3s 后），
// 按消费者累计失败计数并暴露到 /api/health——各仓已有 messageId 幂等，重试不会重复生效。
// HTTP 层失败（下游 4xx/5xx）不自动重试（指令类转发下游可能已执行，重试有双执行风险），
// 但如实计入 failed，不再误计为 ok（此前监控把下游半死状态显示成全绿）。
const deliveryStats = { ok: 0, retried: 0, failed: 0, byConsumer: {} };

function deliveryStatsSnapshot() {
  return { ok: deliveryStats.ok, retried: deliveryStats.retried, failed: deliveryStats.failed, byConsumer: { ...deliveryStats.byConsumer } };
}

async function deliverTo(consumer, mode, frame, text) {
  let result;
  try {
    result = await deliverOnce(consumer, mode, frame, text);
    // R11（2026-09-16 重构）：事件模式下游 HTTP 失败与传输异常同款重试一次——
    // 事件消费方都有 messageId 幂等，重发不会重复生效；command 模式单次尝试
    // （指令无幂等键，下游可能已执行，双执行风险大于丢指令，失败有兜底回复可感知）。
    if (result && result.ok === false && mode !== 'command') {
      console.warn(`[路由] 投递 ${consumer.name} HTTP 层失败（status ${result.status}），3s 后重试一次`);
      await new Promise((r) => setTimeout(r, 3000));
      const second = await deliverOnce(consumer, mode, frame, text);
      if (second && second.ok !== false) {
        deliveryStats.ok += 1;
        deliveryStats.retried += 1;
        return second;
      }
      result = second || result;
    }
    if (result && result.ok === false) {
      // 最终失败（含 command 模式单次失败）：如实计一次 failed，不给 ok 充数
      deliveryStats.failed += 1;
      deliveryStats.byConsumer[consumer.name] = (deliveryStats.byConsumer[consumer.name] || 0) + 1;
      console.warn(`[路由] 投递 ${consumer.name} 失败（status ${result.status}）`);
      return result;
    }
    deliveryStats.ok += 1;
    return result;
  } catch (err) {
    // 首败不预记：终态（重试后再败/再抛）才计一次 failed，与 HTTP 层失败路径同口径
    //（此前传输异常路径首败+终态各计一次，最终失败被计成 2）
    console.warn(`[路由] 投递 ${consumer.name} 失败（${err.message}），3s 后重试一次`);
    await new Promise((r) => setTimeout(r, 3000));
    try {
      result = await deliverOnce(consumer, mode, frame, text);
    } catch (err2) {
      deliveryStats.failed += 1;
      deliveryStats.byConsumer[consumer.name] = (deliveryStats.byConsumer[consumer.name] || 0) + 1;
      throw err2;
    }
    if (result && result.ok !== false) {
      deliveryStats.ok += 1;
      deliveryStats.retried += 1;
      return result;
    }
    deliveryStats.failed += 1;
    deliveryStats.byConsumer[consumer.name] = (deliveryStats.byConsumer[consumer.name] || 0) + 1;
    return result;
  }
}

async function deliverOnce(consumer, mode, frame, text) {
  if (mode === 'command' && !consumer.commandUrl) {
    // 规则声明了 command 模式但消费者没配指令端点：降级为原始事件转发，必须有日志否则配置错误无从察觉
    console.warn(`[路由] ${consumer.name} 未配置指令端点（CONSUMERS 第三段），command 规则降级为原始事件转发`);
  }
  if (mode === 'command' && consumer.commandUrl) {
    const parsed = parseCommand(text);
    if (parsed) {
      const result = await postJson(consumer.commandUrl, { command: parsed.command, args: parsed.args });
      logDelivery(consumer.name, `指令 ${parsed.command}`, result);
      if (result.ok && result.body && result.body.reply) {
        await replyText(frame.event && frame.event.message && frame.event.message.message_id, result.body.reply);
      } else if (!result.ok) {
        // 下游服务不可用：给用户一个兜底回复，避免指令石沉大海
        await replyText(
          frame.event && frame.event.message && frame.event.message.message_id,
          `❌ ${consumer.name} 服务暂不可用，请稍后再试`
        );
      }
      return result;
    }
    // 命中 prefix 规则但不是 / 指令文本，退回原始事件转发
  }
  const result = await postJson(consumer.eventUrl, withToken(frame));
  logDelivery(consumer.name, `事件 ${frame.header.event_type}`, result);
  return result;
}

/**
 * 使用统计（只观察不改路由）：记录「谁用了什么功能」，口径=机器人交互——
 * 显式路由命中（工单域等专用能力）、私聊、群内 @机器人 才计数；
 * 群内未 @ 落默认目标的普通消息不计（hub 本就不会响应，属闲聊非交互）。
 * 功能口径：/ 开头取首个 token（/print-status、/approval-list…可精确到指令）；
 * 工单接单监听（@/私聊+接单，非 / 文本）记为「工单接单」；其余按私聊/群 @对话计。
 */
function recordUsage(frame, text, consumer, { explicit = false } = {}) {
  try {
    const event = frame.event || {};
    const message = event.message || {};
    if (!explicit && message.chat_type !== 'p2p' && !isMentioned(message)) return;
    const senderId =
      (event.sender && event.sender.sender_id && (event.sender.sender_id.open_id || event.sender.sender_id.user_id)) ||
      (message.sender_id && (message.sender_id.open_id || message.sender_id.user_id)) ||
      '';
    const feature = text.startsWith('/')
      ? text.split(/\s+/)[0].toLowerCase()
      : consumer && consumer.name === 'ticket' && text.includes('接单')
        ? '工单接单'
        : message.chat_type === 'p2p' ? '私聊对话' : '@群对话';
    usage.recordMessage({ senderId, feature });
  } catch (err) {
    console.warn('[使用统计] 异常（忽略）:', err.message);
  }
}

async function routeMessage(frame) {
  // traceId（2026-09-13 R6）：随转发载荷透传，消费者日志可按它串联全链路
  frame.traceId = 'evt_' + String((frame.event && frame.event.message && frame.event.message.message_id) || Date.now()).slice(-12);
  const event = frame.event || {};
  const message = event.message || {};
  const text = extractText(message);
  const mentioned = isMentioned(message);

  // 被@统计（2026-09-24 团队负载算法数据源）：与路由无关，所有群消息必经此处，
  // 在任何路由 return 之前记——不命中任何规则的消息里的 @ 也算（只计数不影响路由/转发）
  usage.recordMentions(message);

  if (!text && message && message.message_id) {
    console.log(
      `[路由] 未提取到文本 message_id=${message.message_id} message_type=${message.message_type} ` +
      `content=${typeof message.content}:${String(JSON.stringify(message.content) || '').slice(0, 120)}`
    );
  }

  for (const rule of config.messageRoutes) {
    const m = rule.match || {};
    if (m.chatId && message.chat_id !== m.chatId) continue;
    if (m.chatType && message.chat_type !== m.chatType) continue;
    if (m.mention && !mentioned) continue;
    if (m.prefix && !text.toLowerCase().startsWith(String(m.prefix).toLowerCase())) continue;
    if (m.contains && !text.toLowerCase().includes(String(m.contains).toLowerCase())) continue;

    const consumer = findConsumer(rule.target);
    if (consumer) {
      console.log(`[路由] ${frame.traceId} 消息命中规则 ${JSON.stringify(m)} → ${consumer.name} (${rule.mode || 'event'}) chat=${message.chat_id || '?'} text="${text.slice(0, 50)}"`);
      recordUsage(frame, text, consumer, { explicit: true });
      return deliverTo(consumer, rule.mode || 'event', frame, text);
    }
    console.warn(`[路由] 规则目标 ${rule.target} 未在 CONSUMERS 中定义，继续匹配下一条规则`);
  }

  const fallback = findConsumer(config.defaultTarget);
  if (!fallback) {
    console.warn(`[路由] 无匹配规则且默认目标 ${config.defaultTarget} 未定义，消息丢弃: "${text.slice(0, 50)}"`);
    return { ok: false, dropped: true };
  }
  console.log(`[路由] ${frame.traceId} 消息走默认目标 → ${fallback.name} text="${text.slice(0, 50)}"`);
  recordUsage(frame, text, fallback);
  return deliverTo(fallback, 'event', frame, text);
}

async function fanoutBitable(frame) {
  const tableId = frame.event && frame.event.table_id;
  const names = config.bitableTargets.length ? config.bitableTargets : config.consumers.map((c) => c.name);

  for (const name of names) {
    const consumer = findConsumer(name);
    if (!consumer) {
      console.warn(`[路由] bitable 目标 ${name} 未在 CONSUMERS 中定义，跳过`);
      continue;
    }

    if (consumer.legacy) {
      // 旧版结构消费者：把 V2 action_list 拆成单记录 create/update 事件
      //（机制保留备用；现役消费者均为 V2 结构——bambu 是唯一 legacy 用户，已随其
      //  2026-10-05 路线 A 断事件链退网，v35 收口）
      const items = (frame.event && frame.event.action_list) || [];
      const typeMap = { record_added: 'bitable.record.create', record_edited: 'bitable.record.update' };
      for (const item of items) {
        const legacyType = typeMap[item.action];
        if (!legacyType) continue;
        const legacyFrame = {
          schema: '2.0',
          header: { event_type: legacyType },
          event: {
            table_id: tableId,
            record: { record_id: item.record_id, fields: item.after_value || item.before_value || {} },
          },
        };
        await fanoutPost(consumer, `${legacyType} record=${item.record_id}`, legacyFrame);
      }
    } else {
      await fanoutPost(consumer, `bitable table=${tableId}`, frame);
    }
  }
}

/**
 * fanout（bitable/审批事件广播）专用投递：与消息投递共用同一本 deliveryStats，
 * 让 /api/health 的投递统计覆盖全部出站转发。与 deliverTo 不同的是**不自动重试**——
 * 消费方幂等虽已具备（表格事件按 table_id 过滤、审批事件按 approval_code 决策，
 * legacy 拆事件也是纯转发），但 fanout 的重试语义（补发窗口/失败风暴控制）另批评估，
 * 当前保持单次投递，失败如实计入 failed。
 */
async function fanoutPost(consumer, what, frame) {
  const result = await postJson(consumer.eventUrl, withToken(frame));
  logDelivery(consumer.name, what, result);
  if (result.ok) {
    deliveryStats.ok += 1;
  } else {
    deliveryStats.failed += 1;
    deliveryStats.byConsumer[consumer.name] = (deliveryStats.byConsumer[consumer.name] || 0) + 1;
  }
  return result;
}

/**
 * 审批事件（approval_instance / approval_task）→ 定向转发配置的目标（默认 ticket——
 * 工单接单联动自动通过。bambu 打印自动审批已随其 2026-10-05 路线 A 退役，v35 收口）。
 * 消费方各自按 approval_code 过滤、拉实例详情决策（官方审批事件不依赖表格同步，秒级）。
 */
async function fanoutApproval(frame) {
  const names = config.approvalTargets.length ? config.approvalTargets : ['ticket'];
  let last = null;
  for (const name of names) {
    const consumer = findConsumer(name);
    if (!consumer) {
      console.warn(`[路由] 审批事件目标 ${name} 未在 CONSUMERS 中定义，跳过`);
      continue;
    }
    last = await fanoutPost(consumer, `审批事件 ${frame.header.event_type} instance=${(frame.event && frame.event.instance_id) || '?'}`, frame);
  }
  return last || { ok: false, dropped: true };
}

/**
 * 事件总入口：归一化 → 去重 → 按类型分发
 */
async function dispatchFrame(eventType, data) {
  const frame = normalizeFrame(eventType, data);

  const dedupId = frame.header.event_id || (frame.event && frame.event.message && frame.event.message.message_id) || '';
  if (dedupId && rememberKey(`${frame.header.event_type}:${dedupId}`)) {
    console.log(`[网关] 重复事件，跳过: ${frame.header.event_type}:${dedupId}`);
    return { ok: true, duplicated: true };
  }

  const type = frame.header.event_type;
  if (type === 'im.message.receive_v1') {
    return routeMessage(frame);
  }
  if (type === 'drive.file.bitable_record_changed_v1') {
    return fanoutBitable(frame);
  }
  if (type === 'approval_instance' || type === 'approval_task') {
    return fanoutApproval(frame);
  }
  if (type === 'drive.file.bitable_field_changed_v1') {
    // 字段【结构】变更：应用控制台订阅层送来，无消费方——静默忽略（v28 前未注册
    // handler 时 SDK 对每条刷 `no ... handle` warn，曾淹没 error 日志）
    return { ok: true, ignored: true };
  }
  console.log(`[网关] 未配置分发逻辑的事件类型: ${type}，已忽略`);
  return { ok: true, ignored: true };
}

module.exports = {
  deliveryStatsSnapshot,
  dispatchFrame,
  replyText,
  normalizeFrame,
  extractText,
  isMentioned,
  parseCommand,
};
