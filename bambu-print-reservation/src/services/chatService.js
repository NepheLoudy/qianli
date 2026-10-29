const config = require('../config');
const reservationService = require('./reservation');
const printerManager = require('../printer/manager');
const dispatcher = require('./dispatcher');

// ============================================================
// 指令服务（2026-09-25 对话铁律收口）：本仓不消费消息事件、不直接回复对话，
// 指令统一由 hub 经 POST /api/chat/command 转发进来（executeCommand 出口）。
// 旧版 processChatMessage 直连链（im.message.receive_v1 → 直接回复）已删除。
// ============================================================

const STATUS_ICONS = {
  '空闲': '🟢', '打印中': '🟠', '准备中': '🟠', '切片中': '🟠',
  '暂停': '🟡', '已完成': '✅', '故障': '🔴', '未连接': '⚫',
};

/** 分钟 → 「Xh Ym」可读形态（ETA 展示；0/空返回空串） */
function fmtMinutes(mins) {
  const m = Number(mins);
  if (!Number.isFinite(m) || m <= 0) return '';
  return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'm' : ''}` : `${m}m`;
}

/** 队列/在打 ETA 汇总行（页面与 /print-status 共用口径）：
 *  队列按 3mf 内嵌预估时长求和；在打按打印机实时剩余分钟求和 */
function etaSummary(queue, printing) {
  const queueKnown = queue.filter((t) => Number(t.estMinutes) > 0);
  const queueSum = queueKnown.reduce((s, t) => s + Number(t.estMinutes), 0);
  const unknown = queue.length - queueKnown.length;
  const printSum = printing.reduce((s, p) => s + (Number(p.remainingMinutes) || 0), 0);
  const parts = [];
  if (queue.length > 0) {
    parts.push(`队列预估总时长 ${queueSum > 0 ? '~' + fmtMinutes(queueSum) : '未知'}${unknown > 0 ? `（${unknown} 单无预估）` : ''}`);
  }
  if (printing.length > 0) {
    parts.push(`在打 ${printing.length} 台实时剩余合计 ${printSum > 0 ? '~' + fmtMinutes(printSum) : '未知'}`);
  }
  return parts.join('｜');
}

async function handleHelpCommand() {
  const botName = config.bot.name || '爆米花机';
  return `🖨️ ${botName} - 3D打印预约指令帮助

打印预约指令：
  /print-help     显示打印相关帮助
  /print-status   查看打印机状态
  /print-ams      查看所有打印机装载的耗材明细
  /print-list     查看预约列表
  /print-pending  查看待审批预约

使用方式：
  • 群聊中请先 @${botName} 再发送指令
  • 示例：@${botName} /print-status`;
}

async function handlePrintHelpCommand() {
  return `🖨️ 3D打印预约系统 - 指令帮助

📋 查询指令（本聊天通道仅保留查看类；提交/审批/人工恢复请用打印预约页面）：
  /print-status    查看打印机状态（含 AMS 耗材与打印队列）
  /print-ams       查看所有打印机装载的耗材明细
  /print-list      查看当前所有预约记录
  /print-pending   查看待审批的预约

📝 预约流程（自建网页提交，2026-10-05 起）：
  • 打开打印预约页面 → 注册/登录账号 → 上传模型并勾选工况需求
  • 审批者在页面审批；通过后自动按 AMS 装料匹配打印`;
}

async function handlePrintStatusCommand() {
  const printers = printerManager.getAllPrinterStates();

  if (printers.length === 0) {
    return '🖨️ 暂无配置的打印机';
  }

  const queue = dispatcher.getQueueSnapshot();
  const printing = dispatcher.getPrintingSnapshot();
  const lines = ['🖨️ 打印机状态', ''];

  printers.forEach((printer, i) => {
    lines.push(`${i + 1}. ${STATUS_ICONS[printer.status] || '🔵'} ${printer.name} (${printer.model})`);
    if (printer.activeTask) {
      lines.push(`   当前任务: ${printer.activeTask.applicationNo || ''} ${printer.activeTask.fileName || ''}`);
    } else if (printer.currentJob) {
      lines.push(`   当前文件: ${printer.currentJob}`);
    }
    if (printer.status === '打印中' || printer.status === '暂停') {
      // remainingMinutes 本身就是分钟（mc_remaining_time），直接展示
      const remain = printer.remainingMinutes ? `，剩余 ${printer.remainingMinutes} 分钟` : '';
      lines.push(`   进度: ${printer.progress}%${remain}`);
    }
    const ams = (printer.ams || []).filter((t) => t.type);
    if (ams.length > 0) {
      lines.push(`   耗材: ${ams.map((t) => `${t.type}${t.colorHex ? '·' + t.colorHex : ''}${t.active ? '◉' : ''}`).join('、')}`);
    } else if (printer.autoDispatch) {
      lines.push('   耗材: （未获取到 AMS 数据）');
    }
    if (!printer.autoDispatch) {
      lines.push('   ⚙️ 非 Bambu 机型：仅登记，分发需人工（/print-dispatch 指定后手动上传）');
    }
    lines.push('');
  });

  if (queue.length > 0) {
    lines.push(`📋 打印队列（${queue.length} 单待分发）:`);
    queue.slice(0, 5).forEach((t) => {
      lines.push(`  ${t.position}. ${t.applicationNo || ''} ${t.fileName || ''} [${t.materialType || '任意'}×${t.color || '任意'}]${t.isUrgent ? ' ⚡' : ''}（${t.applicant}）`);
    });
    if (queue.length > 5) lines.push(`  …共 ${queue.length} 单`);
  }

  // ETA 汇总（2026-10-08）：回答「几点能来取件」——队列按内嵌预估、在打按实时剩余
  const eta = etaSummary(queue, printing);
  if (eta) lines.push('', `⏱️ ${eta}`);

  return lines.join('\n');
}

async function handlePrintAmsCommand() {
  const printers = printerManager.getAllPrinterStates();
  const lines = ['🧵 打印机耗材总览', ''];

  let any = false;
  for (const printer of printers) {
    const ams = (printer.ams || []).filter((t) => t.type);
    if (!ams.length) continue;
    any = true;
    lines.push(`▸ ${printer.name}（${printer.model}）`);
    ams.forEach((t) => {
      lines.push(`   ${t.slot}: ${t.type} ${t.colorHex || ''}${t.active ? ' ◉在用' : ''}`);
    });
    lines.push('');
  }
  if (!any) lines.push('（暂无 AMS 数据，打印机可能未连接）');

  return lines.join('\n');
}

// 本地化后发起人是字符串（displayName）；旧镜像记录是 {id,name} 对象——双形态兼容
const applicantName = (applicant) =>
  typeof applicant === 'string' ? applicant : applicant?.name || '未知';

async function handlePrintListCommand() {
  const reservations = await reservationService.getAllReservations();

  if (reservations.length === 0) {
    return '📋 暂无打印预约记录';
  }

  const lines = ['📋 打印预约列表', ''];

  reservations.forEach((res, i) => {
    let statusIcon = '📋';

    switch (res.status) {
      case config.status.PENDING_REVIEW:
        statusIcon = '⏳';
        break;
      case config.status.REVIEW_APPROVED:
        statusIcon = '✅';
        break;
      case config.status.REVIEW_REJECTED:
        statusIcon = '❌';
        break;
      case config.status.QUEUED:
        statusIcon = '📝';
        break;
      case config.status.PRINTING:
        statusIcon = '🖨️';
        break;
      case config.status.COMPLETED:
        statusIcon = '🎉';
        break;
      case config.status.CANCELLED:
        statusIcon = '🚫';
        break;
    }

    lines.push(`${i + 1}. ${statusIcon} ${res.fileName || '未命名文件'}`);
    lines.push(`   发起人: ${applicantName(res.applicant)}`);
    lines.push(`   状态: ${res.status}`);

    if (res.id || res.applicationNo) {
      lines.push(`   单号: ${res.id || res.applicationNo}`);
    }

    const startTime = res.createdAt || res.startTime;
    if (startTime) {
      lines.push(`   发起时间: ${String(startTime).replace('T', ' ').slice(0, 16)}`);
    }

    if (res.isUrgent) {
      lines.push(`   ⚡ 加急`);
    }

    if (res.isInternalProject) {
      lines.push(`   📌 千里内部项目`);
    }

    lines.push('');
  });

  return lines.join('\n');
}

async function handlePrintPendingCommand() {
  const reservations = await reservationService.getPendingReviewReservations();

  if (reservations.length === 0) {
    return '✅ 暂无待审批的预约';
  }

  const lines = ['⏳ 待审批预约列表', ''];

  reservations.forEach((res, i) => {
    lines.push(`${i + 1}. 📋 ${res.fileName || '未命名文件'}`);
    lines.push(`   发起人: ${applicantName(res.applicant)}`);
    if (res.id || res.applicationNo) {
      lines.push(`   单号: ${res.id || res.applicationNo}`);
    }
    const startTime = res.createdAt || res.startTime;
    if (startTime) {
      lines.push(`   发起时间: ${String(startTime).replace('T', ' ').slice(0, 16)}`);
    }
    if (res.isUrgent) {
      lines.push(`   ⚡ 加急`);
    }
    lines.push('');
  });

  lines.push('💡 提示：请在打印预约页面登录后审批（审批人账号由管理员开通）');

  return lines.join('\n');
}

/**
 * 飞书自助绑定（2026-10-29）：用户在网页生成 6 位绑定码 → 飞书发「/print-bind 码」→
 * 打印服务按 hub 透传的 senderId（飞书 open_id）把该身份绑到生码账号，之后打印进程
 * 事件即可私信到人。senderId 缺失时给出明确指引（hub 未透传的降级提示）。
 */
async function handlePrintBindCommand(args, ctx) {
  const code = String((args && args[0]) || '').trim();
  if (!/^\d{6}$/.test(code)) {
    return '❌ 用法：/print-bind 六位绑定码\n绑定码在打印预约页面账号区点「生成飞书绑定码」获取（5 分钟内有效）';
  }
  const senderId = (ctx && (ctx.senderId || ctx.openId)) || '';
  if (!senderId) {
    return '❌ 未取到你的飞书身份（对话枢纽未透传 senderId）——请让管理员先在运维台手动绑定，或等 hub 升级后重试';
  }
  try {
    const user = require('./authStore').bindByCode(code, senderId);
    return `✅ 已绑定飞书私信通知：账号「${user.username}」（${user.displayName}）\n今后打印完成/失败/取消/驳回等进程事件会私信到这里`;
  } catch (err) {
    return `❌ ${err.message}`;
  }
}

const commandHandlers = {
  '/help': handleHelpCommand,
  '/print-help': handlePrintHelpCommand,
  '/print-status': handlePrintStatusCommand,
  '/print-ams': handlePrintAmsCommand,
  '/print-list': handlePrintListCommand,
  '/print-pending': handlePrintPendingCommand,
  '/print-bind': handlePrintBindCommand, // 飞书自助绑定（2026-10-29）
  // /print-dispatch 已移除（2026-10-05 曼波定：聊天通道仅保留查看类指令）——
  // 人工指定分发的管理动作走 HTTP（页面/运维台，reviewer 及以上）
};

/**
 * 统一指令执行入口（hub 经网关 /api/chat/command 转发的唯一对话出口）
 * @param {string} command
 * @param {string[]} args
 * @param {{senderId?:string}} [ctx] 发送者身份（飞书 open_id，hub 透传；2026-10-29）
 * @returns {Promise<string>} 回复文本
 */
async function executeCommand(command, args, ctx) {
  const handler = commandHandlers[command];
  if (!handler) {
    return `❌ 未知指令：${command}\n发送 /print-help 查看可用指令`;
  }
  return handler(args || [], ctx || {});
}

module.exports = {
  executeCommand,
  handlePrintHelpCommand,
  handlePrintStatusCommand,
  handlePrintAmsCommand,
  handlePrintListCommand,
  handlePrintPendingCommand,
  etaSummary,
  fmtMinutes,
};
