const config = require('../config');
const { requestAPI } = require('./client');

async function sendMessage(cardContent, targetUrl) {
  // targetUrl（2026-10-16 曼波令）：指定 webhook 覆盖——「有人预约需要审批」提醒走话题群专用钩子；
  // 不传 = 默认机械组群（其余播报全部保持原址）
  const webhookUrl = targetUrl || config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'interactive',
      card: cardContent,
    }),
    signal: AbortSignal.timeout(15000), // 裸 fetch 无超时会卡死静默冲刷/播报链
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

async function sendTextMessage(text) {
  const webhookUrl = config.bot.webhookUrl;

  if (!webhookUrl) {
    console.warn('未配置机器人 Webhook URL，跳过消息发送');
    return null;
  }

  const res = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      msg_type: 'text',
      content: {
        text: text,
      },
    }),
    signal: AbortSignal.timeout(15000), // 裸 fetch 无超时会卡死静默冲刷/播报链
  });

  const data = await res.json();

  if (data.code !== 0 && data.StatusCode !== 0) {
    throw new Error(`发送消息失败: ${JSON.stringify(data)}`);
  }

  return data;
}

function buildAtTag(userId) {
  if (!userId) return '';
  return `<at id="${userId}"></at>`;
}

function buildReservationAlertCard(reservation, extraElements = []) {
  const applicantName = reservation.fields['发起人']?.[0]?.name || '未知用户';
  const applicantId = reservation.fields['发起人']?.[0]?.id || '';
  const startTime = reservation.fields['发起时间'];
  const sliceFile = reservation.fields['切片文件'] && reservation.fields['切片文件'].length > 0 ? reservation.fields['切片文件'][0] : null;
  const fileName = sliceFile?.name || '未指定';
  const isUrgent = reservation.fields['是否加急'];

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: `**📋 新的打印预约**`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**发起人**: ${applicantName}`,
      },
      {
        tag: 'markdown',
        content: `**文件**: ${fileName}`,
      },
      {
        tag: 'markdown',
        content: `**发起时间**: ${startTime || '未指定'}`,
      },
      isUrgent ? {
        tag: 'markdown',
        content: `**⚡ 加急**: 是`,
      } : null,
      ...extraElements,
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `**审批者**: 请在打印预约页面登录后审批（未切片模型需先切片为 3mf）`,
      },
    ].filter(Boolean),
    header: {
      template: 'blue',
      title: {
        content: '🖨️ 打印预约通知',
        tag: 'plain_text',
      },
    },
  };
}

function buildReviewResultCard(reservation, result, comment) {
  const applicantName = reservation.fields['发起人']?.[0]?.name || '未知用户';
  const applicantId = reservation.fields['发起人']?.[0]?.id || '';
  const sliceFile = reservation.fields['切片文件'] && reservation.fields['切片文件'].length > 0 ? reservation.fields['切片文件'][0] : null;
  const fileName = sliceFile?.name || '未指定';

  const isApproved = result === config.reviewResult.APPROVED;

  return {
    config: {
      wide_screen_mode: true,
      enable_forward: true,
    },
    elements: [
      {
        tag: 'markdown',
        content: isApproved ? `**✅ 审批通过**` : `**❌ 审批驳回**`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: `${buildAtTag(applicantId)} **发起人**: ${applicantName}`,
      },
      {
        tag: 'markdown',
        content: `**文件**: ${fileName}`,
      },
      {
        tag: 'markdown',
        content: `**审批意见**: ${comment || '无'}`,
      },
      { tag: 'hr' },
      {
        tag: 'markdown',
        content: isApproved
          ? '📝 系统将自动上传文件并排队打印，请等待打印机就绪'
          : '📝 请修改切片文件后重新提交预约',
      },
    ],
    header: {
      template: isApproved ? 'green' : 'red',
      title: {
        content: '🖨️ 审批结果通知',
        tag: 'plain_text',
      },
    },
  };
}

function taskBrief(task) {
  const material = [task.materialType, task.color].filter(Boolean).join('×') || '未指定材料';
  return `${task.applicationNo || task.recordId}｜${task.fileName || '未命名'}｜${material}`;
}

/** 入队播报：审批通过进入队列 */
function buildQueueCard(task, position) {
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**✅ 审批通过，已进入打印队列**（前方还有 ${position} 单）` },
      { tag: 'hr' },
      { tag: 'markdown', content: `${buildAtTag(task.applicant?.id)} **任务**: ${taskBrief(task)}` },
      { tag: 'markdown', content: `**需求材料**: ${[task.materialType, task.color].filter(Boolean).join(' × ') || '未指定（任意可用打印机）'}${task.isUrgent ? '｜⚡加急' : ''}` },
      { tag: 'markdown', content: '📝 将按各打印机 AMS 装料自动匹配，匹配成功即开始打印' },
    ],
    header: { template: 'blue', title: { content: '📋 打印排队通知', tag: 'plain_text' } },
  };
}

/** 审批通过·已入队合并卡（2026-10-16 曼波令：审批结果与排队通知合成一张单子；
 *  打印开始不再单独播报——此卡「匹配成功即开始打印」已交代后文；完成/失败卡保留） */
function buildApprovedQueuedCard(reservation, comment, queueInfo = {}) {
  const ahead = Number.isFinite(Number(queueInfo.ahead)) ? Number(queueInfo.ahead) : null;
  const material = [reservation.materialType, reservation.color].filter(Boolean).join(' × ') || '未指定（任意可用打印机）';
  const dispatch = reservation.review && reservation.review.dispatch;
  const prefLine = dispatch
    ? [
        dispatch.assignedPrinter,
        Array.isArray(dispatch.trays)
          ? `用料 ${dispatch.trays.map((t, i) => `${i + 1}→${t ? t.slot : '自动'}`).join(' ')}`
          : dispatch.tray && dispatch.tray.slot,
        dispatch.nozzleLabel,
      ].filter(Boolean).join(' · ')
    : null;
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**✅ 审批通过 · 已进入打印队列**${ahead != null ? `（前方还有 ${ahead} 单）` : ''}` },
      { tag: 'hr' },
      { tag: 'markdown', content: `**任务**: ${reservation.id}｜${reservation.fileName || '未命名'}｜${material}` },
      { tag: 'markdown', content: `**发起人**: ${reservation.applicant || '未知用户'}${reservation.isUrgent ? '｜⚡加急' : ''}` },
      ...(prefLine ? [{ tag: 'markdown', content: `**分发指定**: ${prefLine}` }] : []),
      ...(comment ? [{ tag: 'markdown', content: `**审批意见**: ${comment}` }] : []),
      { tag: 'hr' },
      { tag: 'markdown', content: '📝 将按各打印机 AMS 装料自动匹配，匹配成功即开始打印；完成后在此群播报' },
    ],
    header: { template: 'green', title: { content: '🖨️ 审批通过 · 打印排队', tag: 'plain_text' } },
  };
}

/** 完成播报 */
function buildJobFinishCard(task, printer) {
  const duration = task.startedAt
    ? Math.round((Date.now() - task.startedAt) / 60000)
    : null;
  const durationText = duration !== null
    ? duration >= 60
      ? `${Math.floor(duration / 60)} 小时 ${duration % 60} 分钟`
      : `${duration} 分钟`
    : '未知';
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**✅ 打印完成**: ${printer.name}（${printer.model}）` },
      { tag: 'hr' },
      { tag: 'markdown', content: `${buildAtTag(task.applicant?.id)} **任务**: ${taskBrief(task)}` },
      { tag: 'markdown', content: `**耗时**: ${durationText}` },
      { tag: 'markdown', content: '📦 请及时取件；若取件确认无误，可在多维表格归档' },
    ],
    header: { template: 'green', title: { content: '✅ 打印完成', tag: 'plain_text' } },
  };
}

/** 失败播报 */
function buildJobFailedCard(task, printer, reason) {
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**❌ 打印异常**: ${printer ? `${printer.name}（${printer.model}）` : ''}` },
      { tag: 'hr' },
      { tag: 'markdown', content: `${buildAtTag(task.applicant?.id)} **任务**: ${taskBrief(task)}` },
      { tag: 'markdown', content: `**原因**: ${reason || '未知'}` },
      { tag: 'markdown', content: '🛠️ 请检查打印机（断料/堵头/平台），处理完成后任务会重新排队' },
    ],
    header: { template: 'red', title: { content: '❌ 打印异常', tag: 'plain_text' } },
  };
}

/** 人工取消卡（2026-10-19 曼波令）：标题/配色与「打印异常」区分——取消不是故障，
 *  不再写「请检查断料/堵头，处理后会重新排队」（取消不重排）。 */
function buildJobCancelledCard(task, printer, reason) {
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**⏹ 打印已取消**: ${printer ? `${printer.name}（${printer.model}）` : ''}` },
      { tag: 'hr' },
      { tag: 'markdown', content: `${buildAtTag(task.applicant?.id)} **任务**: ${taskBrief(task)}` },
      { tag: 'markdown', content: `**原因**: ${reason || '人工取消'}` },
      { tag: 'markdown', content: '🧰 人工取消不会自动重发；如需继续打印，请在预约页面使用「复刻」重新提交' },
    ],
    header: { template: 'grey', title: { content: '⏹ 打印已取消', tag: 'plain_text' } },
  };
}

/** 简版文本卡（2026-10-27 分发改派建议/换料核对播报用）：无任务上下文的提示性卡片 */
function buildTextCard(title, text) {
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [{ tag: 'markdown', content: String(text || '') }],
    header: { template: 'yellow', title: { content: String(title || '通知'), tag: 'plain_text' } },
  };
}

/** 缺料提醒 */
function buildMaterialMissingCard(waitingCount, needs) {
  return {
    config: { wide_screen_mode: true, enable_forward: true },
    elements: [
      { tag: 'markdown', content: `**⚠️ 有 ${waitingCount} 个打印任务因缺料等待**` },
      { tag: 'hr' },
      { tag: 'markdown', content: `**所需耗材**: ${needs}` },
      { tag: 'markdown', content: '🔧 请为对应打印机 AMS 换料/补料，装好后会自动开始打印；如需改派其它打印机，请在打印预约页面联系审批者处理' },
    ],
    header: { template: 'yellow', title: { content: '⚠️ 缺料提醒', tag: 'plain_text' } },
  };
}

async function sendTextToUser(openId, text) {
  const res = await requestAPI(
    'POST',
    '/im/v1/messages?receive_id_type=open_id',
    {
      receive_id: openId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    }
  );

  if (res.code !== 0) {
    throw new Error(`发送私聊消息失败: ${res.msg} (code: ${res.code})`);
  }

  return res.data;
}

module.exports = {
  sendMessage,
  sendTextMessage,
  buildReservationAlertCard,
  buildReviewResultCard,
  buildQueueCard,
  buildApprovedQueuedCard,
  buildJobFinishCard,
  buildJobFailedCard,
  buildJobCancelledCard,
  buildMaterialMissingCard,
  buildTextCard,
  sendTextToUser,
};
