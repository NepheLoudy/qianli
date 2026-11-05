const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

function parseArrayConfig(value) {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(v => v);
}

const printerHosts = parseArrayConfig(process.env.PRINTER_HOSTS);
const printerAccessCodes = parseArrayConfig(process.env.PRINTER_ACCESS_CODES);
const printerSerials = parseArrayConfig(process.env.PRINTER_SERIALS);
const printerNames = parseArrayConfig(process.env.PRINTER_NAMES);
const printerModels = parseArrayConfig(process.env.PRINTER_MODELS);

const printers = printerHosts.map((host, index) => ({
  id: index + 1,
  name: printerNames[index] || `打印机${index + 1}`,
  model: printerModels[index] || 'P1S',
  host: host,
  accessCode: printerAccessCodes[index] || '',
  serial: printerSerials[index] || '',
}));

// 色名 → 参考 RGB（用于和 AMS 上报的 colorHex 做近似匹配）
const COLOR_REFERENCE = {
  '白色': [255, 255, 255],
  '黑色': [0, 0, 0],
  '红色': [232, 38, 28],
  '蓝色': [0, 112, 192],
  '绿色': [0, 176, 80],
  '黄色': [255, 235, 59],
  '灰色': [128, 128, 128],
  '橙色': [255, 152, 0],
  '紫色': [112, 48, 160],
  '粉色': [236, 112, 158],
  '棕色': [121, 85, 61],
  '透明': [220, 230, 235],
  '银色': [192, 192, 192],
  '金色': [212, 175, 55],
};

module.exports = {
  port: process.env.PORT || 3001,

  feishu: {
    appId: process.env.APP_ID || '',
    appSecret: process.env.APP_SECRET || '',
  },

  plaza: {
    // 动态广场事件流（机器人项目看板「动态广场」表，供多维表格仪表盘展示）
    appToken: process.env.PLAZA_BITABLE_APP_TOKEN || 'ZlVZbXDkRayUzSsFRiycznmZn5b',
    tableId: process.env.PLAZA_BITABLE_TABLE_ID || 'tbld1zHXkTzko20p',
  },
  bitable: {
    appToken: process.env.BITABLE_APP_TOKEN || '',
    reservationTableId: process.env.BITABLE_RESERVATION_TABLE_ID || '',
    printerTableId: process.env.BITABLE_PRINTER_TABLE_ID || '',
  },

  feishuEvent: {
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || '',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY || '',
    // 仅作误配绊线：置 true 启动即抛（fail-fast）——本仓没有长连接实现，
    // qianli 只允许 gateway 持长连接（顶层 AGENTS.md 对话铁律）
    useLongConnection: process.env.FEISHU_USE_LONG_CONNECTION === 'true',
  },

  bot: {
    name: process.env.BOT_NAME || '爆米花机-对话型',
    webhookUrl: process.env.BOT_WEBHOOK_URL || '',
    // 审批提醒专用 webhook（2026-10-16 曼波令：「有人预约需要审批」走话题群，其余播报留在机械组）；
    // 未配置时回落默认群，行为不变
    approvalWebhookUrl: process.env.APPROVAL_WEBHOOK_URL || '',
    chatId: process.env.BOT_CHAT_ID || '',
  },

  printers,

  reviewers: parseArrayConfig(process.env.REVIEWERS),

  status: {
    PENDING_REVIEW: '待审批',
    REVIEW_APPROVED: '已通过',
    REVIEW_REJECTED: '已驳回',
    QUEUED: '排队中',
    PRINTING: '打印中',
    COMPLETED: '已完成',
    CANCELLED: '已取消',
  },

  reviewResult: {
    APPROVED: '通过',
    REJECTED: '驳回',
  },

  // 可复刻（reprint）的终态白名单（2026-11-05 P2 审查：服务层与路由层共用同一
  // 常量——此前只在 index.js 路由层拦截，API 之外的直调（脚本/测试/未来消费者）
  // 绕过终态门槛会复刻非终态单）。前端 canReprint（approve.html）显隐同口径
  reprintAllowedStatuses: ['已完成', '已取消'],

  // ---------- 分发引擎 ----------
  dispatch: {
    // v85 自动分发（曼波令「审批功能停了，收到文件自动分发」）：提交后跳过人工审批
    // 直接入队（勾选硬冲突/程序初审仍拦）；审批台降级为复核干预面板。默认关，.env 开
    autoDispatch: process.env.DISPATCH_AUTO === 'true',
    autoApproverName: process.env.DISPATCH_AUTO_APPROVER_NAME || '自动分发',
    // 审批表字段名
    materialField: process.env.DISPATCH_MATERIAL_FIELD || '材料类型',
    colorField: process.env.DISPATCH_COLOR_FIELD || '颜色',
    printerField: process.env.DISPATCH_PRINTER_FIELD || '指定打印机',
    // 颜色近似匹配阈值（redmean 距离），越大越宽松
    colorDistanceThreshold: Number(process.env.DISPATCH_COLOR_THRESHOLD || 120),
    // 兜底对账间隔（分钟）：扫描审批表补漏入队
    reconcileMinutes: Number(process.env.DISPATCH_RECONCILE_MINUTES || 2),
    // 缺料提醒重发间隔（分钟）
    materialRemindMinutes: Number(process.env.DISPATCH_MATERIAL_REMIND_MINUTES || 30),
    // 打印下发是否使用 AMS（多色/单色均由 AMS 供料）
    useAms: process.env.DISPATCH_USE_AMS !== 'false',
    // 分发失败重试上限（超过后退出队列转人工，防确定性失败无限重试）
    maxRetries: Number(process.env.DISPATCH_MAX_RETRIES || 3),
    // 分发失败重试冷却（毫秒），冷却期内不参与匹配
    retryCooldownMs: Number(process.env.DISPATCH_RETRY_COOLDOWN_MS || 60 * 1000),
  },

  // ---------- 官方审批直连（主通道） ----------
  approval: {
    // 分发以审批实例状态事件为准（秒级）；多维表格是半小时级同步镜像，仅作展示
    enabled: process.env.APPROVAL_PRIMARY !== 'false',
    // 审批定义 code（审批管理后台可查）。留空 = 不过滤，靠「表单含附件」自适应识别打印审批
    approvalCode: process.env.APPROVAL_CODE || '',
    // 自动审批：审批流里「自动审批」节点的审批人 open_id（可都填同一个人）。
    // 该审批人名下的待审批任务到达时，机器人按 AMS 规则自动同意/留人工。留空 = 不自动审批
    autoApproverId: process.env.APPROVAL_AUTO_APPROVER_ID || '',
    // 审批事件丢失自愈（分钟）：周期对账补入队，覆盖网关/处理环节丢事件；0 = 关闭
    reconcileMinutes: Number(process.env.APPROVAL_RECONCILE_MINUTES || 5),
    // 对账回看窗口（分钟）：按实例提交时间批量拉取；窗口外的历史丢失无法自愈
    reconcileWindowMinutes: Number(process.env.APPROVAL_RECONCILE_WINDOW_MINUTES || 24 * 60),
  },

  // ---------- 使用上报（顶层「队员/功能统计上报规则」：页面交互向网关归因） ----------
  usage: {
    // 网关使用上报端点（网关 ：3010 与本服务同机 pm2；空串=关闭上报）。
    // 2026-10-10 修复：默认值原误指 :3000（hub），上报全部 404 静默丢弃
    reportUrl: process.env.USAGE_REPORT_URL || 'http://127.0.0.1:3010/api/usage/report',
    // 全工作区共享 API_TOKEN（顶层规则同值）
    token: process.env.API_TOKEN || '',
  },

  colorReference: COLOR_REFERENCE,
};
