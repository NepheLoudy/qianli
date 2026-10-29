const fs = require('fs');
const path = require('path');
const config = require('../config');
const bitableApi = require('../feishu/bitable');
const { downloadFile, downloadApprovalAttachment } = require('../feishu/client');
const { sendMessage, buildJobFailedCard } = require('../feishu/bot');
const quietHours = require('../utils/quietHours');
const { isUnslicedFileName } = require('../utils/fileTypes');
const printerManager = require('../printer/manager');
const reservationService = require('./reservation');
const reservationStore = require('./reservationStore');
const slicerExtract = require('./slicerExtract');
const autoSlice = require('./autoSlice');

const isUnslicedFile = (r) => isUnslicedFileName(r && r.fileName);
const plaza = require('./plaza');

// 机器端人工取消的 fail_reason 集合（2026-10-16 曼波令）：HMS 0300-400C「打印已取消」
// 系列码 = 打印被人在机器上停止/取消（屏幕手停、外部客户端取消）——**人的决定，系统
// 必须尊重**：不重排队、不自动重发（此前误走 failTask「失败重排」——机器上取消一次、
// 系统就再发一次，与人循环对抗）。本系统自己发的 stop 不会走到此判（dequeue 先释放
// printing 映射，failed 事件找不到在册任务）。
const HUMAN_CANCEL_FAIL_CODES = new Set([
  50348044,  // 0x0300400C 拓竹标准人工取消码（P1/X1 实证）
  201359426, // 0x0C008042 H2D 屏幕停机变体码（2026-10-24 R20261024-001 实证）
  50364437,  // 0x03008015 A1 系屏幕停止码（2026-10-29 R20261028-005/003 实证：A1 老世代
             // 停止不上报 fail_reason，码落在 print_error 位图——见 failed 分支 printError 通道）
  83918929,  // 0x05008051 H2D 屏幕暂停/停止码（2026-10-29 R20261029-004 实证：08:54 停 →
             // 判真故障重排 → 08:57 复打；与 fail_reason/print_error 同值出现）
]);

/**
 * 本次打印期间的 HMS 条目数（2026-10-29 热修68）：拓竹 hms 数组是**累积列表**，
 * 停机后不清空——H2D 实案里躺着 2026-10-07 的陈年条目，被判成「本次故障证据」
 * 导致屏幕停机后自动复打。只认 ts_unix 在开打之后的条目（无 startedAt 退 6 小时窗口；
 * 无法解析时间戳的条目按证据计——宁可多判一次真故障，也不放过真实断料）。
 */
const HMS_TS_TOLERANCE_MS = 10 * 60 * 1000; // 时钟容差：HMS 可能比 startedAt 略早
const HMS_FALLBACK_WINDOW_MS = 6 * 3600 * 1000;
function parseHmsTs(h) {
  const raw = h && (h.ts_unix != null ? h.ts_unix : h.ts);
  if (raw == null) return null;
  if (typeof raw === 'number') return raw > 1e12 ? raw : raw * 1000; // 秒/毫秒双兼容
  const s = String(raw).trim();
  if (/^\d{14}$/.test(s)) { // YYYYMMDDHHMMSS（打印机本地墙钟）
    const p = [0, 4, 6, 8, 10, 12].map((i) => Number(s.slice(i, i + 2)));
    const d = new Date(2000 + p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
    return Number.isFinite(d.getTime()) ? d.getTime() : null;
  }
  const n = Number(s);
  if (Number.isFinite(n) && n > 0) return n > 1e12 ? n : n * 1000;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.getTime() : null;
}
function freshHmsCount(hms, startedAt) {
  const list = Array.isArray(hms) ? hms : [];
  if (!list.length) return 0;
  const since = (Number(startedAt) > 0 ? Number(startedAt) : Date.now() - HMS_FALLBACK_WINDOW_MS) - HMS_TS_TOLERANCE_MS;
  return list.filter((h) => {
    const ts = parseHmsTs(h);
    return ts === null || ts >= since; // 无法判时代按证据计（保守，不放过真故障）
  }).length;
}
// 系统自己发起的停止（控制台/页面）没有 0300-400C 码：用「停机意图」标记兜住——
// 标记随任务落盘（humanStopRequested），重启后 failed/idle 事件仍按取消收尾
const HUMAN_STOP_TTL_MS = 3 * 60 * 1000;
function isHumanCancelFailReason(code) {
  return HUMAN_CANCEL_FAIL_CODES.has(Number(code) || 0);
}

// 闪铸机端取消指纹（2026-10-23 热修47，R20261022-006 实案）：固件屏幕取消会经历
// canceling → cancel → ready 原始态，归一后折进 IDLE 触发 idle 事件——事件携带的
// rawStatus 落在其中即是「人在机器上取消了」，按人工取消收尾而非幽灵失败重发。
// 5s 轮询若两个态都错过（瞬发取消）则退回幽灵通道，属已知边界。
const MACHINE_CANCEL_RAW_STATUSES = new Set(['canceling', 'cancel']);
function isMachineCancelRawStatus(raw) {
  return MACHINE_CANCEL_RAW_STATUSES.has(String(raw || '').toLowerCase());
}

// 打印成功回执即清机端残留（2026-10-26 曼波令「程序自己拿成功回执清理状态」）：
// 闪铸完成/取消后的屏幕弹窗会挡后续控制与上传（A5P 8080 半死实案）——成功回执一到位
// 就远程点掉（stateCtrl setClearPlatform），不等人工跑现场；拓竹 FINISH 残留不锁存储
// （P1S/X1C 对照实证）且 clean_print_error 清不动它，不空发。fire-and-forget：清屏失败
// 只记日志，绝不进完成收尾路径
function cleanupMachineAfterJob(printerId, printerName) {
  try {
    const st = printerManager.getApiStates().find((p) => p.id === printerId);
    if (!st || (printerManager.brandOf(st.model) || 'bambu') !== 'flashforge') return;
    printerManager.cleanPrintErrorOnPrinter(printerId).catch((err) =>
      console.warn(`[分发] ${printerName || printerId} 完成后清屏失败:`, err.message));
  } catch (err) {
    console.warn(`[分发] ${printerName || printerId} 完成后清屏调度失败:`, err.message);
  }
}

/**
 * 文件格式 → 品牌适配（2026-10-14 双品牌纯内网批，纯函数单测覆盖）：
 * gcode/g/gx（FlashPrint/Orca 闪铸 profile 产物）→ 闪铸；其余（Bambu Studio 3mf
 * 切片、需求链路模型文件）→ 拓竹。两品牌切片格式互不兼容，跨品牌喂文件=废件。
 */
function brandForFile(fileName) {
  return /\.(gcode|gx|g)$/i.test(String(fileName || '')) ? 'flashforge' : 'bambu';
}

/**
 * 文件 → 品牌（内嵌机型优先版，2026-10-16 曼波真机反馈批）：切片文件自带目标机型
 * （project_settings.printer_model / slice_info.printer_model_id）——「拿闪铸机子切的
 * .gcode.3mf」用扩展名判断会误判为拓竹；有内嵌机型时以内嵌为准，无则退回扩展名
 */
function brandForFileWithMeta(fileName, machineModel) {
  const m = String(machineModel || '');
  if (m && /flashforge|ad5|5m|creator/i.test(m)) return 'flashforge';
  if (m && /bambu|a1|p1|x1|h2/i.test(m)) return 'bambu';
  return brandForFile(fileName);
}

/**
 * printing 幽灵巡检阈值（纯函数，单测覆盖）：有打印机上报的预估时长（expectedMinutes，
 * start 事件时从 mc_remaining_time 捕获）按「预估×2 且 ≥1h」动态判定；无预估（需求链路
 * 单/报文缺失）退回保守的固定 12h（此前唯一口径）
 */
function staleThresholdMs(expectedMinutes) {
  const m = Number(expectedMinutes);
  if (!Number.isFinite(m) || m <= 0) return 12 * 3600 * 1000;
  return Math.max(m * 2, 60) * 60 * 1000;
}

// 任务来源谓词（2026-10-05 本地化改造）：
//   'approval' = 旧飞书审批实例源（不写任何表，状态由引擎内存/状态文件追踪）
//   'local'    = 自建前后端预约源（状态回写 reservationStore；文件在本地 uploads）
//   其余（无 fileSource / 'mirror'）= 旧多维表格镜像源（写镜像表，遗留兼容）
const isApprovalTask = (t) => t.fileSource === 'approval';
const isLocalTask = (t) => t.fileSource === 'local';
const isMirrorTask = (t) => !isApprovalTask(t) && !isLocalTask(t);

/** 本地预约记录 → 分发任务（审批通过入队 / manualDispatch 恢复共用）。
 *  materialExclude/materialPrefer 随单下发：材料留空时由需求标签反推可选材料 */
function buildLocalTask(reservation) {
  return {
    recordId: reservation.id,
    applicationNo: reservation.id,
    fileSource: 'local',
    filePath: reservation.filePath,
    fileName: reservation.fileName,
    fileToken: null, // 本地文件不走飞书下载
    machineModel: (reservation.embeddedParams && reservation.embeddedParams.machineModel) || null, // 内嵌目标机型（品牌路由权威，2026-10-16）
    materialType: reservation.materialType,
    selection: reservation.selection || {}, // 模型单自动切片用（勾选 → 引擎参数）
    processParams: reservation.processParams || null, // 审批快照（自动切片口径锁定，规则库演进不影响已审批单）
    placement: reservation.placement || null, // 放置四元数（用户手动摆向 → 切片尊重，不再自动改向）
    color: reservation.color,
    assignedPrinter: reservation.assignedPrinter,
    isUrgent: reservation.isUrgent,
    materialExclude: reservation.processParams?.materialExclude || [],
    materialPrefer: reservation.processParams?.materialPrefer || [],
    quantity: reservation.quantity || 1,
    remaining: Math.max(0, (reservation.quantity || 1) - 1), // 份数续打:首件外剩余件数
    estMinutes: Number(reservation.estMinutes) > 0 ? Number(reservation.estMinutes) : null, // 3mf 内嵌预估时长（队列 ETA 用）
    applicant: { id: '', name: reservation.applicant || '' },
  };
}

/** 多色解析：颜色栏「白色+黑色」「白/黑」→ 颜色数组（单色返回单元素） */
function parseTaskColors(task) {
  const raw = String(task.color || '').trim();
  if (!raw) return [];
  return raw.split(/[+＋/、,，]/).map((s) => s.trim()).filter(Boolean);
}

/** 料槽是否未被排除（materialExclude regex 源对料槽材料求值） */
function trayAllowed(tray, excludeSrc) {
  if (!Array.isArray(excludeSrc) || excludeSrc.length === 0) return true;
  return !excludeSrc.some((src) => {
    try { return new RegExp(src, 'i').test(String(tray.type || '')); } catch { return false; }
  });
}

/** 料槽是否命中优先材料 */
function trayPreferred(tray, preferSrc) {
  if (!Array.isArray(preferSrc) || preferSrc.length === 0) return false;
  return preferSrc.some((src) => {
    try { return new RegExp(src, 'i').test(String(tray.type || '')); } catch { return false; }
  });
}

/** 单条用料 → 料位映射（材料精确/家族 + 颜色 redmean 最近；无匹配回落 AMS0 槽 0 并告警） */
function autoMapEntry(f, trays) {
  const want = String((f && f.type) || '').trim().toUpperCase();
  const pick = (level) => {
    let best = null;
    let bestD = Infinity;
    for (const t of trays) {
      if (want && materialMatch(want, t.type) !== level) continue;
      const d = f.colorHex && t.colorHex ? colorDistance(t.colorHex, f.colorHex) : 0;
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  };
  const hit = pick('exact') || pick('family') || (!want ? trays[0] : null);
  if (!hit) {
    console.warn(`[分发] 用料「${(f && f.type) || '未知'}」在本机料位无匹配，回落 AMS0 槽 0`);
    return { ams_id: 0, slot_id: 0 };
  }
  return {
    ams_id: Number.isInteger(hit.amsId) ? hit.amsId : 0,
    slot_id: Number.isInteger(hit.trayId) ? hit.trayId : 0,
  };
}

/**
 * 开打用料映射（2026-10-16 曼波真单批）：把切片文件的用料清单映射到打印机实际料位——
 *   ⓪ 审批逐条指定（prefTrays，2026-10-16 多耗材批）：与文件用料**逐条对齐**——该条有指定
 *      用指定槽位（指定即权威），null/空条目按该条用料自动匹配（逐条可留自动）；
 *   ① 审批单槽指定（prefTray，旧路径）：首条用料映射到该槽（多色件其余自动补齐）；
 *   ② 未指定：逐条按 autoMapEntry 匹配（AMS + 外挂料盘，避开 materialExclude 排除项）；
 *   ③ 无清单（旧文件/解析失败）：维持旧默认 [{ams_id:0, slot_id:0}]。
 * 返回 { amsMapping2, amsMapping }——ams_mapping2 用 {ams_id, slot_id}（外挂料盘
 * ams_id=254/255）；legacy ams_mapping 值：AMS = ams*4+slot、外挂 = 虚拟料位原值。
 */
function buildAmsMapping(task, printer, fileMeta) {
  const filaments = fileMeta && Array.isArray(fileMeta.filaments) && fileMeta.filaments.length
    ? fileMeta.filaments
    : null;
  const trays = (printer.ams || []).filter((t) => t.type && trayAllowed(t, task.materialExclude));
  const entries = [];
  const prefTrays = Array.isArray(task.prefTrays) ? task.prefTrays : null;
  if (prefTrays && prefTrays.some((t) => t && Number.isInteger(t.amsId) && Number.isInteger(t.trayId))) {
    // 逐条对齐：条目数取 max(指定数组, 文件用料)，缺料条目按文件用料自动匹配
    const n = Math.max(prefTrays.length, filaments ? filaments.length : 0);
    for (let i = 0; i < n; i++) {
      const pt = prefTrays[i];
      if (pt && Number.isInteger(pt.amsId) && Number.isInteger(pt.trayId)) {
        entries.push({ ams_id: pt.amsId, slot_id: pt.trayId });
      } else if (filaments && filaments[i]) {
        entries.push(autoMapEntry(filaments[i], trays));
      } else if (i === 0) {
        entries.push({ ams_id: 0, slot_id: 0 });
      }
    }
  } else if (task.prefTray && Number.isInteger(task.prefTray.amsId) && Number.isInteger(task.prefTray.trayId)) {
    const pref = task.prefTray;
    entries.push({ ams_id: pref.amsId, slot_id: pref.trayId });
    if (filaments && filaments.length > 1) {
      for (let i = 1; i < filaments.length; i++) {
        entries.push(autoMapEntry(filaments[i], trays));
      }
    }
  } else if (filaments) {
    for (const f of filaments) {
      entries.push(autoMapEntry(f, trays));
    }
  } else {
    entries.push({ ams_id: 0, slot_id: 0 });
  }
  const amsMapping = entries.map((e) => (e.ams_id >= 254 ? e.ams_id : e.ams_id * 4 + e.slot_id));
  return { amsMapping2: entries, amsMapping };
}

/** 按任务来源取切片/模型文件 buffer */
async function loadTaskFile(task) {
  if (isApprovalTask(task)) {
    return downloadApprovalAttachment(task.fileToken, task.fileName);
  }
  if (isLocalTask(task)) {
    return fs.promises.readFile(task.filePath);
  }
  return downloadFile(task.fileToken);
}

/** 本地预约状态回写（store 同步抛错，吞掉以保证分发链不因存储抖动中断） */
function storeSafe(fn, label) {
  try {
    fn();
  } catch (err) {
    console.error(`[分发] 预约状态回写失败(${label}):`, err.message);
  }
}

// ============================================================
// 队列/打印中状态持久化（2026-09-13 口径：重启不丢队列）
// 文件放项目外数据目录（DISPATCH_STATE_FILE，默认项目根 .dispatch-state.json），
// 部署清目录不再丢状态；known 截尾保存防止无限增长。
// ============================================================
const STATE_FILE = process.env.DISPATCH_STATE_FILE || path.join(__dirname, '..', '..', '.dispatch-state.json');
try { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); } catch { /* 目录不可建时退化为不持久化，分发本身不受影响 */ }
const KNOWN_CAP = 2000;
const GIVEN_UP_CAP = 200; // givenUp 持久化截尾（人工恢复通道的容量护栏）
const REPRINT_GUARD_MS = 30 * 60 * 1000; // 短时复打熔断窗口（2026-10-29 热修68）
const PICKUP_CODE_TTL_MS = 24 * 3600 * 1000; // 取件码有效期（2026-10-29）：取件可能隔天，给足 24h

// ============================================================
// 打印分发引擎：任务队列 + 空闲触发匹配
//
// 触发时机：新任务入队 / 打印机空闲变迁（jobEvent）/ 对账周期
// 匹配规则：指定打印机优先 → AMS 材料类型+颜色近似匹配 → 加急优先
//          （「负载最少」选机为预留，未实现）
// 执行链：飞书下载 3mf → SFTP 上传打印机 → MQTT project_file 下发 → 状态写表
// 播报：开始/完成/失败 关键节点卡片；缺料提醒按间隔节流
// ============================================================

/** redmean 颜色距离（人眼加权），约 0~765 */
function colorDistance(hex1, hex2) {
  const p1 = hexToRgb(hex1);
  const p2 = hexToRgb(hex2);
  if (!p1 || !p2) return Infinity;
  const rm = (p1[0] + p2[0]) / 2;
  const dr = p1[0] - p2[0];
  const dg = p1[1] - p2[1];
  const db = p1[2] - p2[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** 材料类型匹配：精确匹配；家族前缀（PLA-CF ⊂ PLA）作为软匹配 */
function materialMatch(required, trayType) {
  const a = String(required || '').trim().toUpperCase();
  const b = String(trayType || '').trim().toUpperCase();
  if (!a || !b) return false;
  if (a === b) return 'exact';
  if (b.startsWith(a + '-') || a.startsWith(b + '-')) return 'family';
  return false;
}

/**
 * 群播出口：晚间静默窗口（默认 02:00–09:00）内不直接发送，卡片落盘积压、
 * 窗口结束原样补发（打印机控制/写表/队列匹配不延迟，只有消息延后）
 */
function announce(name, card, onError, targetUrl) {
  // 群播全面关闭（2026-10-28 曼波令「机械组播报全面关闭」）：打印进程改私信申请人本人
  // （notifyApplicantDm，见各事件钩子）——完成/失败/取消等状态 DM 到人，页面与放弃池兜底。
  // 此函数保留骨架供将来定向播报复活，当前一律丢弃（含完成卡）
  return;
}

class Dispatcher {
  constructor() {
    this.queue = [];              // 待分发任务（按优先级排序后）
    this.known = new Set();       // 已处理过的 recordId（防事件与对账重复入队）
    this.printing = new Map();    // printerId → task（正在执行）
    this.completedCount = new Map(); // printerId → 累计完成数（预留：按负载选机未实现，只写不读）
    this.lastMaterialRemind = 0;  // 缺料提醒节流
    this.matching = false;        // 匹配过程串行化
    this.givenUp = new Map();     // 重试耗尽退出的任务（recordId → task，供 /print-dispatch 人工恢复）
    // 打完等回执闸（2026-10-28 曼波令「第一个件打完了在预约界面要回执才行」）：
    // printerId → recordId。completeTask 一律置闸——该机在取件确认前不开打队列中的
    // 下一件（板上件没取走就开新件会撞板/挤料，且装配件要先试装）。回执接口清闸并
    // 触发匹配；状态落盘防重启丢闸
    this.receiptHold = new Map();
    this.pickupCodes = new Map(); // 取件码 → {recordId, printerId, expiresAt}（内存态）
    this.humanStops = new Map();  // printerId → {at, reason}：系统发起的停止意图（failed/idle 事件消费）
    this.inFlight = [];           // 分发进行中的任务（已出队未入 printing；落盘携带，重启重回队列）
    this.dispatching = new Set(); // 正在分发中的 printerId（人工指定 vs 自动匹配互斥闸门；
                                  // 刻意不持久化——崩溃后清零重新评估，残留锁才危险）
    this.timer = null;
    this.saveTimer = null;        // 落盘防抖
    this.exitHooked = false;      // 进程退出冲刷只挂一次
    this.queueSweepTimer = null;  // 队列兜底推进定时器（事件缺失时防卡死）
  }

  start() {
    if (this.timer) return;
    this.restoreState();
    this.hookExitFlush();
    // printing 幽灵巡检（2026-09-13）：finish 事件落在停机/打印机离线窗口时 completeTask
    // 永不执行——打印中超过 STALE 倍数打印时长仍卡着的任务，按打印机当前实况补完成/继续等
    if (!this.staleTimer) {
      this.staleTimer = setInterval(() => {
        this.sweepStalePrinting().catch((err) => console.error('[分发] printing 巡检失败:', err.message));
      }, 10 * 60 * 1000);
    }
    // 队列兜底推进（2026-10-16 曼波真单卡滞修复）：事件驱动的匹配在「状态恢复但事件缺失」
    // （FAILED→IDLE 恢复、重连后首报文、报文丢包）下会静默停摆——队列非空时每分钟补一轮；
    // 匹配侧有串行闸与多重门控，空转只读无副作用
    if (!this.queueSweepTimer) {
      this.queueSweepTimer = setInterval(() => {
        if (this.queue.length > 0) this.trigger('queue-sweep');
      }, 60 * 1000);
    }
    if (config.approval.enabled) {
      // 审批直连主通道：事件秒级且可靠，镜像表对账只会造成重复入队，关闭
      console.log('[分发] 审批直连主通道，表格对账已关闭');
    } else {
      // 对账兜底：网关事件丢失时分钟级补漏（审批表「已通过」未入队的记录）
      this.timer = setInterval(() => {
        this.reconcile().catch((err) =>
          console.error('[分发] 对账失败:', err.message)
        );
      }, Math.max(config.dispatch.reconcileMinutes, 1) * 60 * 1000);
      this.reconcile().catch(() => {});
      console.log(`[分发] 引擎已启动（对账间隔 ${config.dispatch.reconcileMinutes} 分钟）`);
    }
    this.bindPrinterEvents();
    // 启动即匹配一轮（2026-09-17）：审批直连分支此前提前 return，重启恢复的队列
    // 滞留不触发匹配；matching 串行闸防重入，重复触发幂等
    this.trigger('restore');
  }

  bindPrinterEvents() {
    printerManager.on('jobEvent', ({ printer, event, prevState, rawStatus }) => {
      const task = this.printing.get(printer.id);
      if (event === 'finish') {
        const humanStop = this.consumeHumanStop(printer.id);
        if (task && (humanStop || task.humanStopRequested)) {
          console.log(`[分发] ${printer.name} 人工停止后收到完成态（${humanStop ? humanStop.reason : '停机标记'}）→ 按取消收尾`);
          this.humanTerminateTask(task, printer).catch((err) =>
            console.error('[分发] 人工终止收尾失败:', err.message)
          );
        } else if (task) {
          this.completeTask(task, printer);
        }
      } else if (event === 'failed') {
        const humanStop = this.consumeHumanStop(printer.id);
        if (task) {
          const humanFlag = Boolean(task.humanStopRequested);
          // 2026-10-16 曼波令：机器端人工取消（0300-400C 系列）不重发——其余失败维持重排。
          // 2026-10-19：系统自己发的停止没有该码（R-004 实况 failed 直接回排队中），
          // 以 humanStops/humanStopRequested 标记同样按取消收尾。
          // 2026-10-29（热修61）：A1 老世代停止不上报 fail_reason，人因码落在 print_error
          // 位图（0x03008015 实证）——码表检查同时覆盖 failReason 与 printError 两通道；
          // 命中码表的 print_error 不算「故障证据」（热修49 类级反转不被伪证据劫持）。
          const humanCode = isHumanCancelFailReason(printer.failReason) || isHumanCancelFailReason(printer.printError);
          if (humanStop || humanFlag || humanCode) {
            console.log(`[分发] ${printer.name} 人工停止（${humanStop ? humanStop.reason : humanFlag ? '停机标记' : `人因码 ${printer.failReason || printer.printError}`}）→ 按取消收尾，不回排队`);
            this.humanTerminateTask(task, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else {
            // 类级反转（2026-10-24 热修49，H2D R20261024-001 实案）：同一屏幕停机动作
            // 先后吐 0x0C008042 / 0 / 0x0300400C 三种 fail_reason——按码追指纹结构性
            // 失败。真实故障（断料/堵料/跌件）必带故障证据（拓竹 HMS/print_error、
            // 闪铸 errorCode），**无证据的 FAILED 默认按人为终止收尾**，只有带证据的
            // 才失败重排。误伤面：极罕见「无码真实故障」会落已取消（页面可见可重约），
            // 远小于旧行为「与人循环对抗到重试耗尽」的耗材浪费。
            //
            // 2026-10-29 热修68（H2D R20261029-004 复打实案）：证据必须**属于本次打印**——
            // 该机 hms 里躺着 2026-10-07 的陈年条目（ts_unix 实测），被当成本次故障证据，
            // 「屏幕停机 → 判真故障 → 自动复打」循环复现。三条加固：
            //   ① HMS 时效过滤：只认本次开打后的条目（无 startedAt 时退 6 小时窗口）；
            //   ② print_error 若等于 fail_reason（同值镜像），不算独立证据——只有它独有
            //      的值才可能是另一路的真实故障位；
            //   ③ 短时复打熔断（failTask 内）：同单 30 分钟内二次失败不再自动重排。
            const hmsFresh = freshHmsCount(printer.hms, task && task.startedAt);
            const pe = Number(printer.printError) || 0;
            const fr = Number(printer.failReason) || 0;
            const peIsMirror = pe > 0 && pe === fr; // 同值 = 同一路错误码的镜像，非独立证据
            const hasErrorEvidence = hmsFresh > 0
              || (pe > 0 && !peIsMirror)
              || Boolean(String(printer.errorCode || '').trim());
            if (!hasErrorEvidence) {
              console.log(`[分发] ${printer.name} 失败无本次故障证据（failReason=${fr}，本次 HMS ${hmsFresh} 项/print_error=${pe}${peIsMirror ? '（与 fail_reason 同值镜像）' : ''}）→ 按人为终止收尾，不回排队`);
              this.humanTerminateTask(task, printer).catch((err) =>
                console.error('[分发] 人为终止收尾失败:', err.message)
              );
            } else {
              console.log(`[分发] ${printer.name} 打印失败（failReason=${fr}，本次 HMS ${hmsFresh} 项/print_error=${pe}${printer.errorCode ? '/errorCode=' + printer.errorCode : ''}）→ 自动重排`);
              this.failTask(task, printer, '打印机上报失败状态');
            }
          }
        }
      } else if (event === 'start') {
        // 预估时长捕获（v46）：start 时刻打印机已算出本任务 ETA（mc_remaining_time，
        // 分钟）——幽灵巡检阈值从固定 12h 变动态（预估×2 且 ≥1h）
        if (task && Number(printer.remainingMinutes) > 0) {
          task.expectedMinutes = Number(printer.remainingMinutes);
          console.log(`[分发] 任务 ${task.applicationNo || task.recordId} 预估时长 ${task.expectedMinutes} 分钟（巡检阈值随之动态化）`);
        }
      } else if (event === 'idle') {
        // 打印中断电/断联恢复场景（2026-09-27）：PRINTING→IDLE 直接回空闲，
        // 跳过了 FINISH/FAILED——printing 里的旧任务成幽灵，新任务分发时
        // printing.set 会静默覆盖、旧任务永久丢追踪（表格停在假「打印中」）。
        // 放行前先按失败收尾（写回「排队中」+ 重排/重试通道），再触发下一轮匹配
        const ghost = this.printing.get(printer.id);
        const humanStop = this.consumeHumanStop(printer.id);
        if (ghost) {
          // 终态清态 ≠ 打印中断（2026-10-19 P1S 真单假失败）：新任务刚下发时，上一单的
          // FINISH/FAILED 会先清回 IDLE，再进 PREPARE→RUNNING（P1S 实测间隔 28s）。
          // 旧逻辑把这次 IDLE 当幽灵失败，开打 9s 就发「打印异常」卡并回滚排队。
          const prev = String(prevState || '').toUpperCase();
          const terminalClear = prev === 'FINISH' || prev === 'FAILED';
          if (humanStop || ghost.humanStopRequested) {
            // 系统发起的停止：直回空闲也按人工取消收尾（不回排队）
            console.log(`[分发] ${printer.name} 人工停止（${humanStop ? humanStop.reason : '停机标记'}）→ 直回空闲按取消收尾`);
            this.humanTerminateTask(ghost, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else if (terminalClear) {
            console.log(`[分发] ${printer.name} ${prev}→IDLE 为上一单终态清除（非中断），任务 ${ghost.applicationNo || ghost.recordId} 继续观察`);
          } else if (isHumanCancelFailReason(printer.failReason)) {
            // 幽灵收尾同样尊重人工取消码（直回空闲但残留取消码时不当失败重排）
            this.humanTerminateTask(ghost, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else if (isMachineCancelRawStatus(rawStatus)) {
            // 闪铸机端屏幕取消（热修47）：canceling/cancel 原始态即人工意图，
            // 按取消收尾——此前走幽灵失败重发，与人循环对抗直到重试耗尽
            console.log(`[分发] ${printer.name} 机端人工取消（原始态 ${rawStatus}）→ 按取消收尾，不回排队`);
            this.humanTerminateTask(ghost, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else {
            console.warn(`[分发] 打印机 ${printer.name} 由${prev || '首报文'}直回空闲且无完成事件，按失败收尾幽灵任务: ${ghost.applicationNo || ghost.recordId}`);
            this.failTask(ghost, printer, '打印机回空闲且无完成事件').catch((err) =>
              console.error('[分发] 幽灵任务收尾失败:', err.message)
            );
          }
        }
        this.trigger('printer-idle');
      }
    });
  }

  /** 当前引擎状态快照（持久化载荷） */
  statePayload() {
    return {
      savedAt: new Date().toISOString(),
      queue: this.queue,
      inFlight: this.inFlight,
      printing: [...this.printing.entries()],
      completedCount: [...this.completedCount.entries()],
      known: [...this.known].slice(-KNOWN_CAP),
      // 重试耗尽任务落盘（2026-09-15）：此前纯内存，重启后 /print-dispatch 人工恢复
      // 通道静默失效（known 已拦重入队、审批源单不在镜像表）——B4 承诺在重启场景不成立
      givenUp: [...this.givenUp.entries()].slice(-GIVEN_UP_CAP),
      receiptHold: [...this.receiptHold.entries()],
    };
  }

  /** 同步落盘（写临时文件后原子改名；损坏的旧文件按空处理由 restore 兜底） */
  flushState() {
    try {
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.statePayload(), null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (err) {
      console.warn('[分发] 状态落盘失败（不影响分发）:', err.message);
    }
  }

  /** 状态变更后防抖落盘（合并突发变更，300ms 内只写一次） */
  persistState() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushState();
    }, 300);
  }

  /** 启动恢复：队列/打印中/已知记录/完成计数（文件缺失按空启动；损坏先隔离留档再按空——
   *  直接按空会让下一次落盘覆盖坏文件，队列/打印中映射再无抢救机会） */
  restoreState() {
    try {
      if (!fs.existsSync(STATE_FILE)) return;
      const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
      this.queue = Array.isArray(data.queue) ? data.queue : [];
      this.printing = new Map(Array.isArray(data.printing) ? data.printing : []);
      this.completedCount = new Map(Array.isArray(data.completedCount) ? data.completedCount : []);
      this.known = new Set(Array.isArray(data.known) ? data.known : []);
      this.givenUp = new Map(Array.isArray(data.givenUp) ? data.givenUp.slice(-GIVEN_UP_CAP) : []);
      this.receiptHold = new Map(Array.isArray(data.receiptHold) ? data.receiptHold : []);
      for (const t of this.queue) this.known.add(t.recordId);
      for (const [, t] of this.printing) this.known.add(t.recordId);
      // 分发中断恢复（2026-09-13）：上次退出时正在下载/上传的任务处于「已出队、未入
      // printing」中间态——known 保留会永久拦截重入队（已审批单永不分发）。重回队列
      // 完整重发一次（若打印机已实际开打，重发会覆盖——比静默丢单可感知得多）
      const interrupted = Array.isArray(data.inFlight) ? data.inFlight : [];
      for (const t of interrupted) {
        if (!t || !t.recordId) continue;
        this.known.delete(t.recordId);
        if (!this.queue.some((q) => q.recordId === t.recordId)) {
          this.queue.push(t);
          console.warn(`[分发] 恢复分发中断任务: ${t.applicationNo || t.recordId}（重新完整分发）`);
        }
      }
      console.log(`[分发] 已恢复持久化状态: 队列 ${this.queue.length} / 打印中 ${this.printing.size} / 已知 ${this.known.size}（${STATE_FILE}）`);
    } catch (err) {
      // 损坏隔离（2026-10-08 同 reservationStore 口径）：坏文件改名留档，防下一次落盘覆盖
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      try { fs.renameSync(STATE_FILE, `${STATE_FILE}.corrupt-${stamp}`); } catch { /* 留在原地 */ }
      console.error(`[分发] 状态文件损坏已隔离（${err.message}）——按空队列启动，请人工检查抢救`);
    }
  }

  /** 进程退出前冲刷（pm2 restart 发 SIGINT/SIGTERM；只挂一次） */
  hookExitFlush() {
    if (this.exitHooked) return;
    this.exitHooked = true;
    const flush = () => this.flushState();
    process.on('SIGINT', flush);
    process.on('SIGTERM', flush);
  }

  /** 对账：拉「已通过」状态的记录，补入队列（幂等） */
  async reconcile() {
    if (!config.bitable.reservationTableId) return;
    const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
    const approved = records.filter(
      (r) => r.fields && r.fields['申请状态'] === config.status.REVIEW_APPROVED
    );
    for (const r of approved) {
      this.enqueue(reservationService.formatReservation(r), { silent: true });
    }
    // 打印中的记录若重启后丢失映射，恢复占用关系（尽力而为）
    const printingRecords = records.filter(
      (r) => r.fields && r.fields['申请状态'] === config.status.PRINTING
    );
    for (const r of printingRecords) {
      if (![...this.printing.values()].some((t) => t.recordId === r.record_id)) {
        const task = reservationService.formatReservation(r);
        const printerName = r.fields[config.dispatch.printerField];
        const printer = printerManager.getAllPrinterStates().find((p) => p.name === printerName);
        if (printer) {
          this.printing.set(printer.id, task);
          console.log(`[分发] 恢复打印中任务映射: ${task.fileName || task.recordId} → ${printer.name}`);
        }
      }
    }
    this.trigger('reconcile');
  }

  /**
   * 入队（幂等）。来源：审批事件 / 对账 / 人工指令
   */
  enqueue(task, { silent = false } = {}) {
    if (!task || !task.recordId) return false;
    if (this.known.has(task.recordId)) return false;
    if (this.queue.some((t) => t.recordId === task.recordId)) return false;

    this.known.add(task.recordId);
    this.queue.push(task);
    const position = this.queue.length - 1;
    console.log(`[分发] 入队: ${task.applicationNo || task.recordId} ${task.materialType || ''}${task.color ? '×' + task.color : ''}${task.isUrgent ? ' [加急]' : ''}`);
    // 文件用料清单异步解析（2026-10-27 指定槽换料校验批）：3mf 直通件入队后后台提取
    // filaments 挂任务上，供 matchPrinter 对指定槽做料型核对（审批入队关键路径零 await
    // 的竞态约束保持——任务排队等机的秒级窗口足够解析完成）
    setImmediate(() => {
      try {
        if (/\.3mf$/i.test(task.fileName || '') && task.filePath && fs.existsSync(task.filePath)) {
          const ex = require('./slicerExtract').extractFrom3mf(fs.readFileSync(task.filePath));
          if (Array.isArray(ex && ex.filaments) && ex.filaments.length) {
            task.filaments = ex.filaments;
            const grams = ex.filaments.reduce((a, f) => a + (Number(f.usedG) || 0), 0);
            if (grams > 0) task.filamentGrams = Math.round(grams * 10) / 10;
          }
        }
      } catch { /* 解析失败按无清单处理——槽料核对退化为只查槽位在 */ }
    });

    if (!silent) {
      plaza.append({ event: '打印排队', title: `${task.applicationNo || task.recordId} ${task.materialType || ''}${task.color ? '×' + task.color : ''}${task.isUrgent ? '（加急）' : ''}` });
      announce(`排队卡 ${task.recordId}`, require('../feishu/bot').buildQueueCard(task, position), (err) =>
        console.error('[分发] 入队播报失败:', err.message)
      );
    }
    this.trigger('enqueue');
    return true;
  }

  dequeue(recordId) {
    const removed = this.queue.filter((t) => t.recordId === recordId);
    this.queue = this.queue.filter((t) => t.recordId !== recordId);
    // 审批撤销落在分发 await 链窗口内（2026-09-27）：任务已出队、正在
    // 「写表→下载→上传→下发」的分钟级链路中，队列里已找不到它——置位
    // cancelled 标记，dispatchLocked 在写表/上传/下发各步骤前复查中止
    for (const t of removed) t.cancelled = true;
    for (const t of this.inFlight) {
      if (t.recordId === recordId) t.cancelled = true;
    }
    // 审批终态同步清理 givenUp（2026-09-25）：留着可被 /print-dispatch 复活，
    // 已撤销/驳回的审批会重新驱动真机
    this.givenUp.delete(recordId);
    for (const [printerId, task] of this.printing) {
      if (task.recordId === recordId) {
        // 打印中取消：停机并释放。停机失败不再静默（v56）——机器可能继续打已取消单，
        // 重试一次，仍失败发人工介入卡（群播走静默闸）
        const printer = printerManager.getPrinterState(printerId);
        this.stopWithRetry(printerId, task, printer, 1);
        this.printing.delete(printerId);
      }
    }
    this.persistState();
  }

  /** 打印中取消的停机指令：失败重试一次，仍失败群播人工介入（v56 竞态批修复） */
  stopWithRetry(printerId, task, printer, retries) {
    printerManager.stopPrintOnPrinter(printerId).catch((err) => {
      console.error(`[分发] 已取消单停机失败（${printer ? printer.name : printerId}）:`, err.message);
      if (retries > 0) {
        setTimeout(() => this.stopWithRetry(printerId, task, printer, retries - 1), 3000);
        return;
      }
      announce(
        `已取消单停机失败提醒 ${task.recordId}`,
        buildJobFailedCard(task, printer, '该单已被取消，但停机指令下发失败——机器可能仍在打印已取消的任务，请人工停止'),
        (e) => console.error('[分发] 停机失败人工介入卡发送失败:', e.message)
      );
    });
  }

  /** 记录是否已在本引擎登记过（含排队/打印中/已完成；审批对账用于跳过已知实例） */
  isKnown(recordId) {
    return this.known.has(recordId);
  }

  /** 该打印机是否有引擎在册任务（停止端点判断是否要打「人工停机」标记） */
  hasPrintingTask(printerId) {
    return this.printing.has(Number(printerId));
  }

  /**
   * 标记「人工停机意图」（2026-10-19 曼波令：手动取消直接落已取消，不回排队）。
   * 系统发起的停止没有 0300-400C fail_reason，单靠码表会误走 failTask；标记同时
   * 写进 task.humanStopRequested（随状态文件落盘，重启后仍能按取消收尾）。
   */
  markHumanStop(printerId, reason = '人工停止') {
    const key = Number(printerId);
    this.humanStops.set(key, { at: Date.now(), reason: String(reason || '人工停止') });
    const task = this.printing.get(key);
    if (task) task.humanStopRequested = true;
    this.persistState();
  }

  /** 停止指令未生效时撤销标记，避免把后续真实失败误判成人工取消 */
  clearHumanStop(printerId) {
    const key = Number(printerId);
    this.humanStops.delete(key);
    const task = this.printing.get(key);
    if (task) task.humanStopRequested = false;
    this.persistState();
  }

  consumeHumanStop(printerId) {
    const key = Number(printerId);
    const hit = this.humanStops.get(key);
    this.humanStops.delete(key);
    if (!hit) return null;
    return Date.now() - hit.at <= HUMAN_STOP_TTL_MS ? hit : null;
  }

  /**
   * 系统停止确认后立即按人工取消收尾（2026-10-19 曼波令）：不依赖打印机后续
   * failed/idle 事件（事件可能丢失/延迟）——停机制令确认生效即落「已取消」。
   * 事件先到也无妨：humanTerminateTask 幂等，第二次找不到在册任务直接返回。
   */
  async finalizeHumanStop(printerId, reason = '人工停止') {
    const key = Number(printerId);
    const task = this.printing.get(key);
    if (!task) { this.clearHumanStop(key); return null; }
    const printer = printerManager.getPrinterState(key) || { id: key, name: `打印机${key}`, model: '' };
    await this.humanTerminateTask(task, printer);
    this.clearHumanStop(key);
    return task.recordId;
  }

  /**
   * 实例是否已有分发痕迹：排队/打印中/已完成（known）或重试耗尽退出（givenUp）。
   * 审批对账补入队前的防重打闸——24h 对账窗口内已完成/已放弃的实例不再重新入队，
   * 否则同一文件会被真机再打一遍（known 不含「已放弃但从未入队」的极端态，故并查 givenUp）
   */
  hasDispatchHistory(recordId) {
    return this.known.has(recordId) || this.givenUp.has(recordId);
  }

  /** 触发一轮匹配（串行） */
  trigger(reason) {
    if (this.matching) return;
    this.matching = true;
    let dispatched = false;
    Promise.resolve()
      .then(() => this.match(reason))
      .then((progressed) => { dispatched = !!progressed; })
      .catch((err) => console.error(`[分发] 匹配失败(${reason}):`, err.message))
      .finally(() => {
        this.matching = false;
        this.persistState();
        // 匹配过程中可能有新任务/新空闲，再跑一轮。
        // 仅在本轮确有分发动作时才立即重跑：缺料等待若也 setImmediate 重跑，
        // 会形成无节流的忙等循环（条件恒真：队列就绪 + 打印机空闲，但谁也匹配不上谁）
        if (
          dispatched &&
          this.queue.some((t) => this.isTaskReady(t)) &&
          printerManager.getAvailablePrinters().length > 0
        ) {
          setImmediate(() => this.trigger(reason + '-retry'));
        }
      });
  }

  /** 任务是否已过失败重试冷却期 */
  isTaskReady(task) {
    return !task.nextMatchAt || task.nextMatchAt <= Date.now();
  }

  /** @returns {boolean} 本轮是否发生过分发动作（供 trigger 判断是否立即重跑） */
  async match(reason) {
    let dispatched = false;
    // 回执丢失对账（2026-10-16 R-008 真单实况）：分发时 project_file 回执超时被误判失败
    // 回滚回队列，但机器实际已在打印本任务（subtask_name 匹配）——先补记为「打印中」移出
    // 队列，防机器空闲后二次开打同一文件（自愈也适用于升级部署前遗留在队列的旧案）
    if (this.reconcileLostAck()) dispatched = true;
    while (this.queue.length > 0) {
      // 分发中的打印机对自动匹配不可见（分钟级 await 链里 printing 登记在链尾才发生）
      const available = printerManager.getAvailablePrinters().filter((p) => !this.dispatching.has(p.id) && !this.printing.has(p.id));
      if (available.length === 0) break;

      this.sortQueue();
      const task = this.queue.find((t) => this.isTaskReady(t));
      if (!task) break; // 全部任务都在重试冷却中

      const result = this.matchPrinter(task, available);

      if (!result) {
        // 队首匹配不到：不阻塞后续任务，看看后面的任务有没有能匹配的
        const alternate = this.findAnyMatch(available);
        if (!alternate) {
          this.notifyMaterialMissing();
          break;
        }
        await this.dispatch(alternate.task, alternate.printer);
        dispatched = true;
        continue;
      }
      await this.dispatch(task, result);
      dispatched = true;
    }
    return dispatched;
  }

  sortQueue() {
    this.queue.sort((a, b) => {
      if (!!b.isUrgent !== !!a.isUrgent) return b.isUrgent ? 1 : -1; // 加急在前
      return (a.enqueuedAt || 0) - (b.enqueuedAt || 0);               // 先来先服务
    });
    this.queue.forEach((t, i) => {
      if (!t.enqueuedAt) t.enqueuedAt = Date.now() + i;
    });
  }

  /**
   * 队列任务 × 打印机实况对账（回执丢失自愈，2026-10-16 R-008 真单实况）：
   * 「project_file 回执超时 → 回滚重排」时机器实际已开打——若某台机器**正在打印的
   * 文件名（subtask_name）与本任务文件一致**，说明该任务其实已分发成功：补记「打印中」
   * 并移出队列（否则机器空闲后队列重试会让同一文件二次开打）。
   */
  reconcileLostAck() {
    if (this.queue.length === 0) return false;
    const printingStates = ['打印中', '准备中'];
    const actives = printerManager.getApiStates().filter((p) => printingStates.includes(p.status));
    if (actives.length === 0) return false;
    let healed = false;
    for (const task of [...this.queue]) {
      const want = String(task.fileName || '').trim();
      if (!want || task.cancelled) continue;
      const hit = actives.find((p) => {
        if (this.printing.has(p.id)) return false; // 该机已有在册任务：不能把队列任务顶替进去
        const sub = String(p.subtaskName || '').trim();
        return sub && (sub === want || sub.includes(want) || want.includes(sub));
      });
      if (!hit) continue;
      if (this.printing.has(hit.id)) continue; // 双保险（find 与 set 之间无 await，此处仅防御性）
      console.warn(`[分发] ${task.applicationNo || task.recordId} 回执丢失自愈：${hit.name} 正在打印同一文件「${hit.subtaskName}」——按已分发补记（打印中，移出队列）`);
      this.queue = this.queue.filter((t) => t.recordId !== task.recordId);
      task.startedAt = task.startedAt || Date.now();
      this.printing.set(hit.id, task);
      printerManager.updateState(hit.id, { activeTask: task });
      storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.PRINTING, `回执丢失补记：已在 ${hit.name} 打印`), 'lost-ack');
      healed = true;
    }
    return healed;
  }

  /**
   * 多色匹配（2026-10-05）：打印机 AMS 是否覆盖全部颜色——逐色找近似色槽、
   * 各色不共槽，材料精确全过或家族全过两档。needMaterial 留空（材料反推场景）
   * 材料维度放行、仅要求槽上有料（2026-10-07 修复：materialMatch 空串恒 false，
   * 原实现会让「多色+材料留空」永远选不中机）
   */
  amsCoversColors(printer, colors, needMaterial, trayOpts = {}) {
    const m = String(needMaterial || '').trim().toUpperCase();
    const trays = (printer.ams || []).filter((t) => t.type && trayAllowed(t, trayOpts.exclude));
    for (const level of ['exact', 'family']) {
      const used = new Set();
      let ok = true;
      for (const color of colors) {
        const rgb = config.colorReference[color] || null;
        const tray = trays.find((t) => {
          if (used.has(t)) return false;
          if (m && materialMatch(m, t.type) !== level) return false;
          return !rgb || !t.colorHex || colorDistance(t.colorHex, rgbToHex(rgb)) <= config.dispatch.colorDistanceThreshold;
        });
        if (!tray) { ok = false; break; }
        used.add(tray);
      }
      if (ok) return true;
    }
    return false;
  }

  /** 为单个任务选机：指定打印机 → 多色覆盖 → AMS 精确 → AMS 家族 */
  matchPrinter(task, available) {
    // 双保险：只考虑真正空闲且支持自动分发的打印机（调用方列表未过滤时也不误选）；
    // 静止的残留故障（FAILED 挂态，指令免疫）同空闲放行——2026-10-16 方案B
    // （新任务开打自动顶掉残留；有在打痕迹的真故障仍拒绝）；
    // 文件格式↔品牌隔离（2026-10-14 双品牌批）：拓竹 3mf 与闪铸 gcode 切片格式互不
    // 兼容，跨品牌分发=打出废件，匹配层直接不可见
    const candidates = (available || []).filter(
      (p) => p.autoDispatch
        && (['空闲', '已完成'].includes(p.status) || printerManager.canDispatchResidueFailed(p))
        && brandForFileWithMeta(task.fileName, task.machineModel) === (printerManager.brandOf(p.model) || 'bambu')
        && !this.receiptHold.has(p.id) // 打完等回执闸：上一单取件确认前本机不开新件（2026-10-28 曼波令）
    );

    // 切片直通件不做自动分发（2026-10-28 曼波令「自动分发只对纯 step 有效」）：切片文件
    // 内嵌机型锁死切片 profile，品牌级自动匹配会让 A1 mini 的件落到 X1C（机端 preset
    // 不匹配/打废）——无指定即滞留提示，等审批补指定；模型直投单（STEP/STL，分发时刻
    // 现场切片）才真正具备自动匹配资格
    if (!task.assignedPrinter && !isUnslicedFileName(task.fileName || '')) {
      const nowSilent = Date.now();
      if (!task._noAutoSliceLoggedAt || nowSilent - task._noAutoSliceLoggedAt > 10 * 60 * 1000) {
        task._noAutoSliceLoggedAt = nowSilent;
        console.warn(`[分发] ${task.applicationNo || task.recordId} 切片直通件未指定打印机——不自动分发（内嵌机型锁定切片 profile，自动匹配仅对模型直投有效），等待审批指定同型号机`);
      }
      return null;
    }

    // 1. 指定打印机（**指定即权威**，2026-10-16 曼波真机反馈「选 A5P 却被分发到 X1C」）：
    //    指定的机器不在候选（品牌不符/忙/失联）时**滞留等待人工**，绝不静默改派他机——
    //    此前 fallthrough 到自动匹配，把人的明确指定当空气
    if (task.assignedPrinter) {
      const named = candidates.find((p) => p.name === task.assignedPrinter);
      if (!named) {
        // 日志节流（2026-10-16）：滞留单每 60s 兜底扫描都会走到这里，逐轮刷屏淹没真错误——
        // 同一任务 10 分钟内只记一次
        const now = Date.now();
        if (!task._prefUnavailLoggedAt || now - task._prefUnavailLoggedAt > 10 * 60 * 1000) {
          task._prefUnavailLoggedAt = now;
          console.warn(`[分发] ${task.applicationNo || task.recordId} 指定打印机「${task.assignedPrinter}」当前不可用（品牌不符/忙/失联）——滞留等待人工，不改派`);
          // 受控改派提示（2026-10-27 曼波令）：模型直投单（STEP/STL）分发时刻才现场切片，
          // 物理上可在同品牌空闲机间改派——把「可改派到谁」播报出来（30 分钟节流），
          // 一键改派走 POST /api/dispatch/manual；3mf/gcode 直通件机型锁定，无此选项
          if (!/\.(3mf|gcode|gx|g)$/i.test(task.fileName || '')
            && (!task._reassignHintAt || Date.now() - task._reassignHintAt > 30 * 60 * 1000)) {
            const alt = candidates.filter((p) => p.name !== task.assignedPrinter);
            if (alt.length) {
              task._reassignHintAt = Date.now();
              announce(
                `改派建议 ${task.recordId}`,
                require('../feishu/bot').buildTextCard(
                  `📋 ${task.applicationNo} 指定的 ${task.assignedPrinter} 暂不可用（忙/失联）。该单是模型直投（分发时现场切片，机型可换）：${alt.map((p) => p.name).join('、')} 空闲且兼容——可在主页该单上点「改派」一键换机。3mf 直通件无此选项，仍滞留等待。`
                ),
                (err) => console.error('[分发] 改派建议播报失败:', err.message)
              );
            }
          }
        }
        return null;
      }
      // 审批分发指定（2026-10-16）：审批人指定的槽位在分发时刻仍须实装——
      // 换料/抽走导致槽位不可用时滞留等人工（不静默换槽，尊重审批指定）。
      // 多耗材批：prefTrays 逐条检查非空条目（留自动的条目无需检查）
      const prefSlotEntries = Array.isArray(task.prefTrays)
        ? task.prefTrays.map((t, i) => [i, t]).filter(([, t]) => t && t.slot)
        : (task.prefTray && task.prefTray.slot ? [[0, task.prefTray]] : []);
      for (const [fi, pt] of prefSlotEntries) {
        const tray = (named.ams || []).find((t) => t.slot === pt.slot && t.type);
        if (!tray) {
          console.warn(`[分发] ${task.applicationNo} 审批指定槽位「${pt.slot}」在 ${named.name} 已不可用——滞留等待人工处理`);
          return null;
        }
        // 槽内料型核对（2026-10-27 曼波令「按实际填充材料改判」）：审批后人把槽里的
        // PLA 换成 PETG 也能打下去的历史缺口——文件逐条用料优先、提单声明材料兜底，
        // 类型对不上（exact/family 均不匹配）即滞留播报，不打废件；旧文件/模型直投
        // 解析不出用料时退回「槽位在即可」不阻塞
        const wantType = (Array.isArray(task.filaments) && task.filaments[fi] && task.filaments[fi].type)
          || task.materialType;
        if (wantType && materialMatch(wantType, tray.type) === false) {
          console.warn(`[分发] ${task.applicationNo} 指定槽位「${pt.slot}」在 ${named.name} 现为 ${tray.type}，与文件用料「${wantType}」不符——滞留等待人工核对换料`);
          announce(
            `换料核对 ${task.recordId}`,
            require('../feishu/bot').buildTextCard(
              `⚠️ ${task.applicationNo} 指定 ${named.name}·${pt.slot}，但槽内现为 ${tray.type}，文件要的是「${wantType}」——已滞留不派，请核对换料或改派。`
            ),
            (err) => console.error('[分发] 换料核对播报失败:', err.message)
          );
          return null;
        }
      }
      return named;
    }

    const needMaterial = String(task.materialType || '').trim().toUpperCase();
    const needColor = String(task.color || '').trim();
    const colorRgb = config.colorReference[needColor] || null;
    // 需求标签反推的材料约束（材料留空时生效的 exclude/prefer 随单下发）
    const trayOpts = { exclude: task.materialExclude, prefer: task.materialPrefer };

    // 2. 多色件（颜色栏含多个颜色）：要求所有颜色同机 AMS 可得
    const colors = parseTaskColors(task);
    if (colors.length > 1) {
      for (const printer of candidates) {
        if (this.amsCoversColors(printer, colors, needMaterial, trayOpts)) return printer;
      }
      return null;
    }

    // 3. AMS 精确材料匹配（+颜色近似）
    for (const printer of candidates) {
      const tray = this.findTray(printer, needMaterial, colorRgb, 'exact', trayOpts);
      if (tray) return printer;
    }
    // 4. 家族匹配（PLA-CF/PLA-HF 等）
    for (const printer of candidates) {
      const tray = this.findTray(printer, needMaterial, colorRgb, 'family', trayOpts);
      if (tray) return printer;
    }
    return null;
  }

  findTray(printer, needMaterial, colorRgb, level, opts = {}) {
    // 排除/优先（2026-10-05 材料反推）：exclude 槽直接不可见；需求为空时优先命 prefer 槽
    const trays = (printer.ams || []).filter((t) => trayAllowed(t, opts.exclude));
    if (!needMaterial) {
      if (Array.isArray(opts.prefer) && opts.prefer.length > 0) {
        const hit = trays.find((t) => t.type && trayPreferred(t, opts.prefer));
        if (hit) return hit;
      }
      return trays.find((t) => t.type) || null;
    }
    for (const tray of trays) {
      if (materialMatch(needMaterial, tray.type) !== level) continue;
      if (!colorRgb || !tray.colorHex) return tray;
      if (colorDistance(tray.colorHex, rgbToHex(colorRgb)) <= config.dispatch.colorDistanceThreshold) {
        return tray;
      }
    }
    return null;
  }

  /** 遍历整个队列找任何一个能匹配的组合（避免队首缺料阻塞整条队列；冷却中的任务跳过） */
  findAnyMatch(available) {
    for (const task of this.queue) {
      if (!this.isTaskReady(task)) continue;
      const printer = this.matchPrinter(task, available);
      if (printer) return { task, printer };
    }
    return null;
  }

  notifyMaterialMissing() {
    const now = Date.now();
    if (now - this.lastMaterialRemind < config.dispatch.materialRemindMinutes * 60 * 1000) return;
    this.lastMaterialRemind = now;

    const needs = this.queue
      .slice(0, 5)
      .map((t) => `${t.materialType || '任意材料'}×${t.color || '任意颜色'}（${t.applicationNo || t.fileName || t.recordId}）`)
      .join('；');
    announce('缺料提醒', require('../feishu/bot').buildMaterialMissingCard(this.queue.length, needs), (err) =>
      console.error('[分发] 缺料提醒播报失败:', err.message)
    );
    console.log(`[分发] ${this.queue.length} 个任务缺料等待: ${needs}`);
  }

  /**
   * 执行分发：下载 → 上传 → 下发 → 写表 → 占用登记
   * 互斥闸门：dispatch 是分钟级 await 链，printing 占用登记在链尾才发生；
   * 不设闸门时人工指定与自动匹配会在窗口期双双选中同一台打印机（上传互覆/顶掉任务）。
   * check+add 同步完成（单线程事件循环无插入窗口）；finally 保证失败/重试路径也释放。
   */
  async dispatch(task, printer) {
    if (this.dispatching.has(printer.id) || this.printing.has(printer.id)) {
      throw new Error(`打印机 ${printer.name} 正在有任务分发中，请稍候再试`);
    }
    this.dispatching.add(printer.id);
    this.inFlight.push(task);
    try {
      await this.dispatchLocked(task, printer);
    } finally {
      this.dispatching.delete(printer.id);
      this.inFlight = this.inFlight.filter((t) => t.recordId !== task.recordId);
      this.persistState();
    }
  }

  async dispatchLocked(task, printer) {
    this.queue = this.queue.filter((t) => t.recordId !== task.recordId);

    // 审批撤销复查（2026-09-27）：cancelled 由 dequeue 置位，写表/上传/下发各
    // 步骤前复查，命中即中止分发——撤销落在分钟级 await 链窗口内不再被静默丢失
    const fromApproval = isApprovalTask(task);
    const fromLocal = isLocalTask(task);
    let mirrorWritten = false; // 已把镜像表写成「打印中」（中止时需回写已取消）
    const checkCancelled = async (stage) => {
      if (!task.cancelled) return false;
      console.log(`[分发] 任务 ${task.recordId} 在${stage}前检测到已撤销（审批终态），中止分发`);
      if (fromLocal) {
        storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.CANCELLED, `分发中止（${stage}前检测到撤销）`), 'cancel');
      } else if (!fromApproval && mirrorWritten) {
        await bitableApi
          .updateRecord(config.bitable.reservationTableId, task.recordId, {
            '申请状态': config.status.CANCELLED,
          })
          .catch(() => {});
      }
      return true;
    };
    if (await checkCancelled('入链')) return;

    try {
      console.log(`[分发] 开始分发: ${task.applicationNo || task.recordId} → ${printer.name}`);

      // 先校验附件再写「打印中」：缺附件的任务不该在镜像表里经历 打印中→已通过 的假抖动
      if (isMirrorTask(task) && !task.fileToken) throw new Error('任务缺少切片文件附件');
      if (fromLocal && !task.filePath) throw new Error('任务缺少本地文件路径');

      // 审批来源不写镜像表（那是审批系统的同步数据，写入会被覆盖且无权限）；
      // 状态追踪由引擎内存完成；本地来源状态回写预约存储
      if (await checkCancelled('写表')) return;
      if (fromLocal) {
        storeSafe(() => {
          reservationStore.updateStatus(task.recordId, config.status.PRINTING, `开始打印 → ${printer.name}`);
          reservationStore.setPrinter(task.recordId, printer.name);
        }, 'printing');
      } else if (!fromApproval) {
        await bitableApi.updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.PRINTING,
          [config.dispatch.printerField]: printer.name,
        });
        mirrorWritten = true;
      }

      // 远端文件名用 recordId，避免中文名/空格在 FTP URL 里出编码问题；
      // 扩展名跟源文件走（拓竹 3mf / 闪铸 gcode 系——闪铸 printGcode 按文件名识别格式）
      const srcExtMatch = String(task.fileName || '').match(/\.(3mf|gcode|gx|g)$/i);
      const srcExt = srcExtMatch ? srcExtMatch[1].toLowerCase() : '3mf';
      const remoteName = `print_${task.recordId}.${srcExt}`;
      if (await checkCancelled('上传')) return;
      let buffer = await loadTaskFile(task);
      // 模型单自动切片（2026-10-18 曼波令）：需求链路单（stl/step）按勾选参数与审批份数
      // 在分发时刻自动切片——份数 = 盘内多件（Orca 原生排布、一次成型），此后按已切片单走
      // 上传；盘已含全部份数 → 关闭续件（remaining=0）
      let autoSliced = null;
      if (isUnslicedFileName(task.fileName || '') && isLocalTask(task)) {
        autoSliced = await autoSlice.ensureSliced(task, printer);
        buffer = autoSliced.buffer;
        // 实际生效摆向（2026-10-27 特征标签批）：打印成功后按此回填自举标签——
        // changed=false 的直通（原姿态/keep）candidateUpAxis 恒 +Z，同样有效
        task.usedOrientation = autoSliced.orientation || null;
        // 切片预估时长/申报耗材量（校准时间与耗材模型的标签素材）
        if (autoSliced.estMinutes > 0) task.estMinutes = autoSliced.estMinutes;
        if (autoSliced.filamentGrams > 0) task.filamentGrams = autoSliced.filamentGrams;
        // 注意：remaining 清零必须等「开打成功」之后（见下发段）——提前清零会让
        // 上传/下发失败后的重试按 1 件重切（4 份单静默缩水成 1 份）
        const fitNote = autoSliced.fit ? `，回读拟合 ${autoSliced.fit.weightedScore}%（${autoSliced.fit.verdict}）` : '';
        console.log(`[分发] ${task.recordId} 模型单自动切片：${autoSliced.copies} 件/盘（${autoSliced.objects} object${fitNote}）`);
      }
      // 切片元数据（用料清单/板型/内嵌机型，2026-10-16 曼波真单批）：分发时刻现读文件——
      // 对老单（提交时未提取）同样生效；读不出回落提交时快照 embeddedParams
      let fileMeta = task.embeddedParams || null;
      if (autoSliced || /\.3mf$/i.test(task.fileName || '')) {
        try {
          fileMeta = { ...(fileMeta || {}), ...slicerExtract.extractFrom3mf(buffer) };
        } catch (err) {
          console.warn(`[分发] ${task.recordId} 切片元数据读取失败，按默认参数下发: ${err.message}`);
        }
      }
      // 闪铸目标 + 3mf 工程文件（2026-10-16 曼波真机反馈批）：Orca 工程 .gcode.3mf（拿闪铸机子
      // 切的）内嵌 flashforge gcode——闪铸固件只吃裸 gcode，必须提取后按 .gcode 上传
      const effBrand = autoSliced ? 'bambu' : brandForFileWithMeta(task.fileName, (fileMeta && fileMeta.machineModel) || task.machineModel);
      let uploadName = remoteName;
      if (effBrand === 'flashforge' && /\.3mf$/i.test(task.fileName || '')) {
        try {
          const g = new (require('adm-zip'))(buffer).getEntry('Metadata/plate_1.gcode');
          if (!g) throw new Error('未找到 Metadata/plate_1.gcode');
          buffer = g.getData();
          uploadName = remoteName.replace(/\.3mf$/i, '.gcode');
          console.log(`[分发] ${task.recordId} 闪铸直通：提取内嵌 gcode ${Math.round(buffer.length / 1024)}KB → ${uploadName}`);
          // 喷头审计（2026-10-23 热修48，C5P 二号喷嘴争议）：机端用哪支喷头完全由文件
          // 里 T 指令决定——切片器把喷嘴选择留在元数据没烙进刀路时，这里分发前一眼可见
          const toolStats = {};
          for (const m of buffer.toString('utf8').matchAll(/^T(\d)\s*$/gm)) {
            toolStats['T' + m[1]] = (toolStats['T' + m[1]] || 0) + 1;
          }
          const toolSummary = Object.keys(toolStats).length
            ? Object.entries(toolStats).map(([t, n]) => `${t}×${n}`).join(' + ')
            : '无 T 指令（机端用当前默认喷头）';
          console.log(`[分发] ${task.recordId} 闪铸文件喷头指令: ${toolSummary}`);
        } catch (err) {
          throw new Error(`闪铸直通 3mf 提取内嵌 gcode 失败：${err.message}`);
        }
      }
      await printerManager.uploadFileToPrinter(printer.id, buffer, uploadName);

      if (await checkCancelled('下发')) return;
      // 开打帧 AMS 映射仅拓竹消费（startProjectOnPrinter 闪铸分支只 startFile）——
      // A5P 这类无料站机型不再空跑映射，避免误报「回落 AMS0 槽 0」（2026-10-22 曼波反馈）
      const amsFrame = printer.brand === 'flashforge'
        ? { amsMapping2: [], amsMapping: [] }
        : buildAmsMapping(task, printer, fileMeta);
      // 无 AMS 机型（P1S/A1mini 仅外挂槽，2026-10-18 P1S 首单排障）：use_ams 置 false——
      // 否则固件按 AMS 供料解析找不到槽位；有 AMS（非外挂槽）的机型维持全局配置
      const hasAms = (printer.ams || []).some((t) => !t.external);
      await printerManager.startProjectOnPrinter(
        printer.id,
        uploadName,
        task.fileName || task.applicationNo || uploadName,
        config.dispatch.useAms && hasAms,
        task.prefTray || (Array.isArray(task.prefTrays) ? task.prefTrays.find(Boolean) : null) || null, // 审批分发指定（2026-10-16）：指定槽位随帧下发（多耗材取首条非空；实际映射以 amsMapping2 为准）
        {
          bedTypeName: (fileMeta && fileMeta.bedType) || null, // 板型随切片产物（防板检测错配暂停）
          amsMapping2: amsFrame.amsMapping2,
          amsMapping: amsFrame.amsMapping,
        }
      );

      task.startedAt = Date.now();
      // 盘内多件已一次成型：开打成功后关闭续件（失败路径保持原 remaining，重试仍按原份数切片）
      if (autoSliced) task.remaining = 0;
      this.printing.set(printer.id, task);
      // 重试计数口径（2026-10-16 热修4）：**成功分发不清零**——此前每次开打成功即清零，
      // 「开打→快速失败→重排」循环永远停在计数 1、够不到上限 3，配合残留放行（方案B）
      // 成无限热循环（R003 实测 9 分钟 4 发）。清零只发生在「干净的起点」：人工恢复
      // （manualDispatch）与完整件完成（completeTask 续件段）。
      printerManager.updateState(printer.id, { activeTask: task });

      // 打印开始不播报（2026-10-16 曼波令：审批+排队合并卡已交代「匹配成功即开始打印」）——广场动态仍记账
      plaza.append({ event: '打印开始', title: `${task.applicationNo || task.recordId} → ${printer.name}` });
    } catch (err) {
      console.error(`[分发] 分发失败 ${task.recordId}:`, err.message);
      // 回滚状态并重新排队（下一轮再试）；审批来源无表状态可回滚
      if (fromLocal) {
        storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.QUEUED, `分发失败回滚：${err.message}`), 'fail-rollback');
      } else if (isMirrorTask(task)) {
        await bitableApi
          .updateRecord(config.bitable.reservationTableId, task.recordId, {
            '申请状态': config.status.REVIEW_APPROVED,
          })
          .catch(() => {});
      }
      // 重试上限 + 冷却：缺附件/上传失败等确定性失败若不设限，match 循环会原地死循环并刷屏
      task.dispatchRetries = (task.dispatchRetries || 0) + 1;
      if (task.dispatchRetries >= config.dispatch.maxRetries) {
        console.error(
          `[分发] 任务 ${task.recordId} 已重试 ${task.dispatchRetries} 次仍失败，退出队列，请人工处理`
        );
        // 保留到 givenUp（2026-09-13）：审批源任务 recordId=instance_code 不在镜像表，
        // 不保留则 /print-dispatch 永远找不到它——人工恢复通道（B4）
        this.givenUp.set(task.recordId, task);
        if (fromLocal) {
          // 重试耗尽转人工：store 回「排队中」，manualDispatch 的状态白名单才放行恢复
          storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.QUEUED, '分发重试耗尽，转人工恢复'), 'given-up');
        } else if (isMirrorTask(task)) {
          // 镜像表写回「排队中」（照 failTask 口径，2026-09-27）：分发失败前已把表
          // 写成「打印中」，非审批源不回滚会让镜像表永久停在假「打印中」，
          // /print-dispatch 恢复链路的状态校验也对不上
          await bitableApi
            .updateRecord(config.bitable.reservationTableId, task.recordId, {
              '申请状态': config.status.QUEUED,
            })
            .catch(() => {});
        }
        announce(
          `分发放弃卡 ${task.recordId}`,
          require('../feishu/bot').buildJobFailedCard(
            task,
            printer,
            `分发失败：${err.message}；已自动重试 ${task.dispatchRetries} 次仍失败，已暂停自动分发，请人工介入`
          ),
          (err) => console.error('[分发] 放弃播报失败:', err.message)
        );
        return;
      }
      task.dispatchError = err.message;
      task.nextMatchAt = Date.now() + config.dispatch.retryCooldownMs;
      task.enqueuedAt = Date.now();
      this.queue.push(task);
      announce(
        `分发重试卡 ${task.recordId}`,
        require('../feishu/bot').buildJobFailedCard(
          task,
          printer,
          `分发失败：${err.message}，已重新排队（第 ${task.dispatchRetries}/${config.dispatch.maxRetries} 次重试）`
        ),
        (err) => console.error('[分发] 重试播报失败:', err.message)
      );
      // 冷却结束后再触发一轮匹配（否则要等到下一次入队/空闲事件才会重试）
      setTimeout(() => {
        if (this.queue.some((t) => t.recordId === task.recordId)) {
          this.trigger('retry-cooldown');
        }
      }, config.dispatch.retryCooldownMs + 500);
    }
  }

  async completeTask(task, printer) {
    if (this.printing.get(printer.id) !== task) return;
    this.printing.delete(printer.id);
    this.completedCount.set(printer.id, (this.completedCount.get(printer.id) || 0) + 1);
    printerManager.updateState(printer.id, { activeTask: null });
    // 打完等回执闸（2026-10-28 曼波令）：板上件被确认取走前，本机不开打下一件。
    // 续打单（hasMore）同样置闸——取件后再打下一盘
    this.receiptHold.set(printer.id, task.recordId);
    // 取件码（2026-10-29 曼波令「私信提醒完成时问是否取件」）：DM 里带 6 位码，
    // 申请人回 /print-pickup 码 即完成回执——顺带清机端残留（完成弹窗/故障位）
    const pickup = this.issuePickupCode(printer.id, task.recordId);
    this.persistState();
    console.log(`[分发] ${task.applicationNo || task.recordId} @ ${printer.name} 完成——等取件回执后继续队列（取件码 ${pickup ? pickup.code : '未发'}）`);
    // 私信申请人（2026-10-28 曼波令「群播全面关闭转私信」）：fire-and-forget 永不阻塞收尾
    require('./reservation').notifyApplicantDm(task.recordId,
      pickup
        ? `✅ 你的打印件已完成（${printer.name}）\n\n到实验室取件后，直接回复这条格式确认：\n/print-pickup ${pickup.code}\n\n（24 小时内有效；确认后我会清理打印机状态并放行队列里的下一件）`
        : `✅ 你的打印件已完成（${printer.name}）——请到实验室取件，并在预约界面点「确认取件」后队列才会继续`);

    // 份数续打判定先于状态写入：remaining>0 时单据回「排队中」而非「已完成」——
    // 全部件完成才算完成，否则队列里挂着续件、表上却是终态（意图-执行断裂）
    const hasMore = isLocalTask(task) && Number(task.remaining) > 0;

    if (isLocalTask(task)) {
      storeSafe(() => reservationStore.updateStatus(
        task.recordId,
        hasMore ? config.status.QUEUED : config.status.COMPLETED,
        hasMore ? `完成 1 件（还剩 ${task.remaining} 件），自动续打下一件` : `打印完成 @ ${printer.name}`
      ), 'complete');
      // 审批入库样本回填（2026-10-16）：勾选入库的单在全部件完成后写真实成功结果
      if (!hasMore) {
        try {
          const rec = reservationStore.get(task.recordId);
          if (rec && rec.sample && rec.sample.sampleEntry && rec.sample.sampleId) {
            require('./trainingStore').setOutcomeBySource(task.recordId, {
              status: '成功', recordedBy: '打印系统', issues: `打印完成 @ ${printer.name}`,
            });
            // 自举摆向标签（2026-10-27 特征标签批）：自动摆向打印成功 = 朝向经现实验证，
            // 记弱标签（fitter 低权重防偏见强化）；人工/专家标签已在则 trainingStore 不覆盖
            if (task.usedOrientation) {
              const modelOrient = require('./modelOrient');
              const up = modelOrient.candidateUpAxis(task.usedOrientation);
              require('./trainingStore').setOrientationBySource(task.recordId, {
                quaternion: modelOrient.quaternionFromUpAxis(up),
                source: 'auto-confirmed',
                note: task.usedOrientation.note || '',
              });
            }
            // 耗时/耗材统计标签（2026-10-27 特征标签批）：时间与耗材模型的校准素材
            require('./trainingStore').setSliceStatsBySource(task.recordId, {
              estMinutes: task.estMinutes,
              actualMinutes: task.startedAt ? (Date.now() - task.startedAt) / 60000 : null,
              filamentGrams: task.filamentGrams,
              machine: printer.model,
            });
          }
        } catch (err) { console.warn('[分发] 入库样本结果回填失败:', err.message); }
      }
    } else if (isMirrorTask(task)) {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.COMPLETED,
        })
        .catch((err) => console.error('[分发] 完成写表失败:', err.message));
    }

    announce(`完成卡 ${task.recordId}`, require('../feishu/bot').buildJobFinishCard(task, printer), (err) =>
      console.error('[分发] 完成播报失败:', err.message)
    );
    cleanupMachineAfterJob(printer.id, printer.name);
    plaza.append({ event: '打印完成', title: `${task.applicationNo || task.recordId} @ ${printer.name}` });
    // 续件重入队（2026-10-05 审查批落地：quantity 从「只存不用」到真实执行）：
    // 绕过 enqueue 的 known 幂等——同一单的续件不是重复事件；
    // dispatchRetries 清零防续件带着历史重试计数一次失败即折寿
    if (hasMore) {
      task.remaining -= 1;
      task.dispatchRetries = 0;
      task.startedAt = undefined;
      this.queue.push(task);
      console.log(`[分发] 份数续打: ${task.applicationNo} 完成 1 件，剩余 ${task.remaining} 件重新入队`);
      announce(`续件排队卡 ${task.recordId}`,
        require('../feishu/bot').buildQueueCard(task, Math.max(0, this.queue.length - 1)),
        (err) => console.error('[分发] 续件播报失败:', err.message)
      );
    }
    console.log(`[分发] 完成: ${task.applicationNo || task.recordId} @ ${printer.name}`);
    this.trigger('task-finish');
  }

  /**
   * 机器端人工终止（2026-10-16 曼波令）：打印在机器上被手动取消（fail_reason 命中
   * HUMAN_CANCEL_FAIL_CODES）——**人的决定，系统不跟人对着干**：不重排队、不自动重发。
   * 口径对齐网页端取消：本地单置「已取消」（如需继续用「复刻」一键重开）+ 播报终止卡。
   * 与 failTask 的差别：不消耗重试次数、不进 givenUp——这不是失败，是人工终止。
   */
  async humanTerminateTask(task, printer) {
    if (this.printing.get(printer.id) !== task) return;
    this.printing.delete(printer.id);
    printerManager.updateState(printer.id, { activeTask: null });

    if (isLocalTask(task)) {
      storeSafe(() => reservationStore.updateStatus(
        task.recordId,
        config.status.CANCELLED,
        '已被人工取消（打印机屏幕或控制台）——系统不自动重发（如需继续请「复刻」该单）'
      ), 'human-terminate');
      require('./reservation').notifyApplicantDm(task.recordId,
        `⏹ 你的打印单已被人工停止（打印机屏幕或控制台）——系统不自动重发；如需继续，请在预约页面用「复刻」重新提交`);
    } else if (isMirrorTask(task)) {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.CANCELLED,
        })
        .catch(() => {});
    }

    announce(
      `终止卡 ${task.recordId}`,
      require('../feishu/bot').buildJobCancelledCard(
        task,
        printer,
        '任务已被人工取消（打印机屏幕或控制台均可）——系统不会自动重发；如需继续打印，请在预约页面使用「复刻」重新提交'
      ),
      (err) => console.error('[分发] 终止播报失败:', err.message)
    );
    plaza.append({ event: '人工终止', title: `${task.applicationNo || task.recordId} @ ${printer.name}：人工取消` });
    console.log(`[分发] 人工终止: ${task.applicationNo || task.recordId} @ ${printer.name}（人工取消，不重发）`);
    this.trigger('task-human-terminated');
  }

  async failTask(task, printer, reason) {
    if (this.printing.get(printer.id) !== task) return;
    this.printing.delete(printer.id);
    printerManager.updateState(printer.id, { activeTask: null });

    if (isLocalTask(task)) {
      storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.QUEUED, `打印失败重排：${reason}`), 'fail');
      require('./reservation').notifyApplicantDm(task.recordId,
        `⚠️ 你的打印单失败（${String(reason || '未知').slice(0, 80)}），已自动重新排队（第 ${task.dispatchRetries}/${config.dispatch.maxRetries} 次重试）——若反复失败会转入放弃池等人工处理`);
      // 入库样本失败回填（2026-10-16）：重试若成功会再覆盖为「成功」——末次真实结果为准
      try {
        const rec = reservationStore.get(task.recordId);
        if (rec && rec.sample && rec.sample.sampleEntry && rec.sample.sampleId) {
          require('./trainingStore').setOutcomeBySource(task.recordId, {
            status: '失败', recordedBy: '打印系统', issues: String(reason || '').slice(0, 200),
            failCode: printer.failReason || null, // 结构化失败码（拓竹 fail_reason/HMS 位图，2026-10-27 特征标签批）
          });
        }
      } catch (err) { console.warn('[分发] 入库样本失败回填异常:', err.message); }
    } else if (isMirrorTask(task)) {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.QUEUED,
        })
        .catch(() => {});
    }

    // 运行期失败接入与分发失败同款的重试/让位通道（2026-09-15）：此前只把镜像表
    // 写回「排队中」而不重排，known 拦截重入队 → 单据永久滞留（失败卡却承诺会重排）
    task.dispatchRetries = (task.dispatchRetries || 0) + 1;
    // 短时复打熔断（2026-10-29 热修68，H2D 复打实案的结构性兜底）：机器指纹不可全信
    // （缺码/变体码/陈年 HMS 都见过），任何一次误判都会变成「人停一次、系统复打一次」。
    // 同单在 REPRINT_GUARD_MS 内二次失败即不再自动重排——把误差上限钉死在「最多多打一次」，
    // 转放弃池等人工决定（页面黄条可恢复/丢弃，DM 会通知）。
    const nowFail = Date.now();
    const recentFail = Number(task.lastPrintFailAt) > 0 && nowFail - Number(task.lastPrintFailAt) < REPRINT_GUARD_MS;
    task.lastPrintFailAt = nowFail;
    if (recentFail) {
      console.error(`[分发] 任务 ${task.recordId} ${Math.round(REPRINT_GUARD_MS / 60000)} 分钟内二次失败——疑似人因终止/机器反复异常，停止自动重排转人工`);
      this.givenUp.set(task.recordId, task);
      this.persistState();
      require('./reservation').notifyApplicantDm(task.recordId,
        `⚠️ 你的打印单在短时间内连续失败两次（${String(reason || '').slice(0, 60)}）——已停止自动重打，转人工处理：确认不是人为停止后可让管理员恢复，或直接「复刻」重新提交`);
      announce(
        `失败卡 ${task.recordId}`,
        require('../feishu/bot').buildJobFailedCard(task, printer, `打印失败：${reason}；短时间连续失败，已停止自动重打，转人工处理`),
        (err) => console.error('[分发] 失败播报失败:', err.message)
      );
      return;
    }
    if (task.dispatchRetries >= config.dispatch.maxRetries) {
      console.error(`[分发] 任务 ${task.recordId} 运行期失败已重试 ${task.dispatchRetries} 次，退出队列，请人工处理`);
      this.givenUp.set(task.recordId, task);
      announce(
        `失败卡 ${task.recordId}`,
        require('../feishu/bot').buildJobFailedCard(
          task,
          printer,
          `打印失败：${reason}；已自动重试 ${task.dispatchRetries} 次仍失败，已暂停自动分发，请在打印预约页面重新提交或联系管理员在运维台恢复`
        ),
        (err) => console.error('[分发] 失败播报失败:', err.message)
      );
    } else {
      task.dispatchError = reason;
      task.nextMatchAt = Date.now() + config.dispatch.retryCooldownMs;
      task.enqueuedAt = Date.now();
      this.queue.push(task);
      announce(
        `失败卡 ${task.recordId}`,
        require('../feishu/bot').buildJobFailedCard(
          task,
          printer,
          `打印失败：${reason}，已重新排队（第 ${task.dispatchRetries}/${config.dispatch.maxRetries} 次重试）`
        ),
        (err) => console.error('[分发] 失败播报失败:', err.message)
      );
      setTimeout(() => {
        if (this.queue.some((t) => t.recordId === task.recordId)) {
          this.trigger('retry-cooldown');
        }
      }, config.dispatch.retryCooldownMs + 500);
    }

    plaza.append({ event: '打印失败', title: `${task.applicationNo || task.recordId} @ ${printer.name}：${reason}` });
    console.error(`[分发] 失败: ${task.applicationNo || task.recordId} @ ${printer.name} ${reason}`);
    this.trigger('task-failed');
  }

  /** 队列快照（指令/接口展示用） */
  getQueueSnapshot() {
    this.sortQueue();
    return this.queue.map((t, i) => ({
      position: i + 1,
      applicationNo: t.applicationNo,
      fileName: t.fileName,
      materialType: t.materialType,
      color: t.color,
      isUrgent: t.isUrgent,
      applicant: t.applicant?.name || '',
      recordId: t.recordId,
      remaining: Number(t.remaining) > 0 ? Number(t.remaining) : 0, // 份数续打剩余
      estMinutes: Number(t.estMinutes) > 0 ? Number(t.estMinutes) : null, // 预估时长（队列 ETA）
    }));
  }

  /**
   * printing 幽灵巡检（2026-09-13）：任务打印中时长超过巡检阈值且打印机实况已回
   * 空闲/已完成 → 补跑 completeTask（表格状态与队列收尾）；实况仍在打印 → 继续等。
   * 阈值动态化（2026-10-08）：有打印机上报预估时长（expectedMinutes）按「预估×2 且 ≥1h」，
   * 无预估退回固定 12h（见 staleThresholdMs）
   */
  async sweepStalePrinting() {
    let released = false;
    for (const [printerId, task] of [...this.printing.entries()]) {
      if (!task.startedAt) continue;
      const ageMs = Date.now() - task.startedAt;
      if (ageMs < staleThresholdMs(task.expectedMinutes)) continue;
      const state = printerManager.getPrinterState(printerId);
      if (!state) continue;
      if (['空闲', '已完成'].includes(state.status)) {
        console.warn(`[分发] printing 巡检：${task.applicationNo || task.recordId} 打印中已 ${Math.round(ageMs / 3600000)}h 且打印机实况空闲，补完成收尾`);
        this.printing.delete(printerId);
        this.completedCount.set(printerId, (this.completedCount.get(printerId) || 0) + 1);
        printerManager.updateState(printerId, { activeTask: null });
        this.receiptHold.set(printerId, task.recordId); // 打完等回执闸（与 completeTask 同口径）
        // 审批源不写镜像表（同 completeTask 守卫）：写 instance_code 必然失败，白刷错误日志
        if (isLocalTask(task)) {
          storeSafe(() => reservationStore.updateStatus(task.recordId, config.status.COMPLETED, `巡检补完成 @ ${state.name || printerId}`), 'sweep-complete');
        } else if (isMirrorTask(task)) {
          await bitableApi
            .updateRecord(config.bitable.reservationTableId, task.recordId, { '申请状态': config.status.COMPLETED })
            .catch((err) => console.error('[分发] 巡检补完成写表失败:', err.message));
        }
        announce(`完成卡 ${task.recordId}`, require('../feishu/bot').buildJobFinishCard(task, state), (err) =>
          console.error('[分发] 巡检完成播报失败:', err.message)
        );
        cleanupMachineAfterJob(printerId, state.name);
        plaza.append({ event: '打印完成', title: `${task.applicationNo || task.recordId} @ ${state.name || printerId}（巡检补记）` });
        released = true;
      }
    }
    // 收尾必须落盘（2026-09-17）：不落盘则崩溃后幽灵 printing 从状态文件复活，重复补发完成卡；
    // 释放出的打印机立即补一轮匹配让队列任务顶上（matching 串行闸防重入，幂等）
    this.persistState();
    if (released) this.trigger('stale-sweep');
  }

  getPrintingSnapshot() {
    return [...this.printing.entries()].map(([printerId, task]) => {
      const state = printerManager.getPrinterState(printerId);
      return {
        printer: state?.name || printerId,
        applicationNo: task.applicationNo,
        fileName: task.fileName,
        startedAt: task.startedAt,
        remainingMinutes: Number(state?.remainingMinutes) > 0 ? Number(state.remainingMinutes) : null, // 实时剩余（ETA 用）
        estMinutes: Number(task.estMinutes) > 0 ? Number(task.estMinutes) : null,
      };
    });
  }

  /** 重试耗尽待人工恢复的单（观测面 + /print-dispatch 恢复的前置查询） */
  listGivenUp() {
    return [...this.givenUp.entries()].map(([recordId, task]) => ({
      recordId,
      applicationNo: task.applicationNo,
      fileName: task.fileName,
      retries: task.dispatchRetries,
      error: task.dispatchError || '',
    }));
  }

  /**
   * 取件回执（2026-10-28 曼波令「第一个件打完了在预约界面要回执才行」）：
   * 清该单所在机的回执闸并触发一轮匹配——下一件这才开打。幂等：单没持闸时返回
   * {held:false}（重复回执/历史单回执无害）。
   */
  acknowledgeReceipt(recordId) {
    let printerId = null;
    for (const [pid, rid] of this.receiptHold.entries()) {
      if (rid === recordId) { printerId = pid; break; }
    }
    if (!printerId) return { held: false };
    this.receiptHold.delete(printerId);
    this.persistState();
    this.trigger('receipt-ack');
    console.log(`[分发] 回执取件：${recordId}（printer=${printerId}）——闸清，队列继续`);
    return { held: true, printerId };
  }

  /** 运维置闸（2026-10-28 曼波「板上有件先停机」）：人工把某机按入「等待取件」态——
   *  板上有未取件/需清板时防队列下一件顶上。与 completeTask 自动置闸同通道。 */
  holdQueue(printerId, recordId) {
    this.receiptHold.set(printerId, recordId || ('manual-' + Date.now().toString(36)));
    this.persistState();
    console.log(`[分发] 人工置闸：printer=${printerId}（${this.receiptHold.get(printerId)}）——队列对该机暂停`);
    return { held: true, printerId, recordId: this.receiptHold.get(printerId) };
  }

  /** 清闸（运维口）：取件完成/清板完毕后放行该机队列 */
  releaseHold(printerId) {
    const rid = this.receiptHold.get(printerId);
    if (!rid) return { held: false };
    this.receiptHold.delete(printerId);
    this.persistState();
    this.trigger('receipt-ack');
    console.log(`[分发] 人工清闸：printer=${printerId}（原 ${rid}）——队列恢复`);
    return { held: true, printerId, recordId: rid };
  }

  /** 回执闸清单（queue 快照消费：页面显示哪台机卡在「等待取件回执」） */
  listReceiptHold() {
    return [...this.receiptHold.entries()].map(([printerId, recordId]) => ({ printerId, recordId }));
  }

  /**
   * 取件码发放（2026-10-29 曼波令「DM 提醒完成时问是否取件」）：6 位数字、24 小时有效、
   * 内存态（重启失效，页面按钮仍可回执兜底）。码 → {recordId, printerId}，一次性消费。
   */
  issuePickupCode(printerId, recordId) {
    if (!recordId || String(recordId).startsWith('manual-')) return null;
    const now = Date.now();
    for (const [c, v] of this.pickupCodes) if (v.expiresAt < now) this.pickupCodes.delete(c);
    // 同单重复发放时作废旧码（续打多盘/重试场景保持一单一码）
    for (const [c, v] of this.pickupCodes) if (v.recordId === recordId) this.pickupCodes.delete(c);
    let code;
    do { code = String(Math.floor(100000 + Math.random() * 900000)); } while (this.pickupCodes.has(code));
    this.pickupCodes.set(code, { recordId, printerId, expiresAt: now + PICKUP_CODE_TTL_MS });
    return { code, expiresInHours: Math.round(PICKUP_CODE_TTL_MS / 3600000) };
  }

  /**
   * 取件码回执（飞书回复 /print-pickup 码）：校验归属 → 单据落回执 → 清闸放行队列 →
   * 清机端残留（拓竹 clean_print_error / 闪铸清屏弹窗）。清残留失败不影响回执（只记日志）。
   * @param {(id:string)=>string} getBoundOpenId 单据 → 绑定 openId（归属校验，空则不校验）
   */
  async confirmPickupByCode(code, senderId, getBoundOpenId) {
    const key = String(code || '').trim();
    const entry = this.pickupCodes.get(key);
    if (!entry) throw new Error('取件码无效或已使用——可在预约页面点「确认取件」');
    if (entry.expiresAt < Date.now()) { this.pickupCodes.delete(key); throw new Error('取件码已过期（24 小时）——请在预约页面点「确认取件」'); }
    const bound = getBoundOpenId ? String(getBoundOpenId(entry.recordId) || '') : '';
    // 归属校验（2026-10-29）：账号已绑飞书时必须本人回执；未绑定则不校验（码即凭据）
    if (bound && senderId && bound !== String(senderId)) {
      throw new Error('这个取件码不属于你的账号——请用本人飞书回复，或在预约页面点「确认取件」');
    }
    this.pickupCodes.delete(key);
    // 单据回执（失败也继续清闸：码已验证，不让账面问题卡住队列）
    let receiptBy = '飞书回复';
    try {
      const rec = reservationStore.get(entry.recordId);
      if (rec) {
        const out = reservationStore.acknowledgeReceipt(entry.recordId, { displayName: receiptBy, id: String(senderId || '') });
        receiptBy = (out.receipt && out.receipt.by) || receiptBy;
      }
    } catch (err) {
      console.warn('[分发] 取件码回执落档失败（继续清闸）:', err.message);
    }
    const ack = this.acknowledgeReceipt(entry.recordId);
    // 清机端残留（完成弹窗/故障位）：清理失败只记日志——回执成功是主目标
    let cleaned = null;
    try {
      const pid = Number.isFinite(Number(entry.printerId)) ? Number(entry.printerId) : entry.printerId;
      cleaned = await printerManager.cleanPrintErrorOnPrinter(pid);
    } catch (err) {
      console.warn('[分发] 取件后清机端状态失败:', err.message);
      cleaned = { error: err.message };
    }
    console.log(`[分发] 取件码回执：${entry.recordId}（printer=${entry.printerId}）——闸清 ${ack.held ? '已放行' : '（无闸）'}，清残留 ${cleaned && cleaned.error ? '失败' : '已发'}`);
    return { recordId: entry.recordId, printerId: entry.printerId, queueResumed: Boolean(ack.held), receiptBy, cleaned };
  }

  /**
   * 放弃池人工丢弃（2026-10-24 曼波令，热修50）：重试耗尽单此前只有「恢复」一条路，
   * 明确不要的单永远躺黄条/列表排队中——新增直接清理：移出放弃池、预约单落「已取消」。
   * 与恢复互斥（同一单只能选一样）；幂等：单不在池时报错由端点回 400。
   */
  async dismissGivenUp(recordId) {
    const task = this.givenUp.get(recordId);
    if (!task) throw new Error(`放弃池中没有 ${recordId}（可能已被恢复或丢弃）`);
    this.givenUp.delete(recordId);
    this.flushState();
    if (isLocalTask(task)) {
      storeSafe(() => reservationStore.updateStatus(
        recordId,
        config.status.CANCELLED,
        '放弃池人工丢弃——不再分发（如需打印请重新预约）'
      ), 'given-up-dismiss');
      require('./reservation').notifyApplicantDm(recordId,
        `⏹ 你的打印单此前多次分发失败，已被人工从放弃池丢弃——不再自动重试；如需打印请在预约页面用「复刻」重新提交`);
    } else if (isMirrorTask(task)) {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, recordId, {
          '申请状态': config.status.CANCELLED,
        })
        .catch(() => {});
    }
    console.log(`[分发] 放弃池丢弃 ${recordId}（${task.fileName || ''}）→ 预约单落「已取消」`);
    return task;
  }

  /** 人工强制指定分发（/print-dispatch） */
  async manualDispatch(recordId, printerName) {
    const printer = printerManager.getAllPrinterStates().find(
      (p) => p.name === printerName || String(p.id) === String(printerName)
    );
    if (!printer) throw new Error(`未找到打印机「${printerName}」`);

    let task = this.queue.find((t) => t.recordId === recordId || t.applicationNo === recordId);
    let fromGivenUp = false;
    if (!task && this.givenUp.has(recordId)) {
      // 重试耗尽被放弃的任务：人工恢复通道（B4）
      task = this.givenUp.get(recordId);
      fromGivenUp = true;
    }
    if (!task) {
      // 本地预约单（2026-10-05 本地化主通道）：状态白名单同 2026-09-27 审批绕过修复——
      // 仅「已通过/排队中」可人工直发，待审批/已驳回/已完成一律拒绝
      const localRecord = reservationStore.get(recordId);
      if (localRecord) {
        const dispatchableStatuses = [config.status.REVIEW_APPROVED, config.status.QUEUED];
        if (!dispatchableStatuses.includes(localRecord.status)) {
          throw new Error(
            `预约「${recordId}」当前状态「${localRecord.status}」不允许直接分发` +
            `（仅「${dispatchableStatuses.join('」/「')}」可人工直发；待审批单请先完成审批）`
          );
        }
        // 未切片文件闸（2026-10-06）：人工恢复 stl/step 同样会打裸文件
        if (isUnslicedFile(localRecord)) {
          throw new Error(`「${localRecord.fileName}」是未切片模型——人工恢复仅支持 3mf 切片产物`);
        }
        task = buildLocalTask(localRecord);
      }
    }
    if (!task) {
      // 遗留兼容：镜像表拉单（本地化后镜像源已无新增入口，仅服务历史单据）
      const records = await bitableApi.getAllRecords(config.bitable.reservationTableId);
      const record = records.find(
        (r) => r.record_id === recordId || r.fields['申请编号'] === recordId
      );
      if (!record) throw new Error(`未找到预约「${recordId}」`);
      const dispatchableStatuses = [config.status.REVIEW_APPROVED, config.status.QUEUED];
      const recordStatus = record.fields?.['申请状态'] || '';
      if (!dispatchableStatuses.includes(recordStatus)) {
        throw new Error(
          `预约「${recordId}」当前状态「${recordStatus || '未知'}」不允许直接分发` +
          `（仅「${dispatchableStatuses.join('」/「')}」可人工直发；待审批单请先完成审批）`
        );
      }
      task = reservationService.formatReservation(record);
    }

    // 品牌隔离硬校验（2026-10-27 改派批）：人工直发/改派同样不许跨品牌——3mf 打到
    // 闪铸、闪铸 gcode 打到拓竹都是废件。内嵌机型优先，扩展名兜底
    {
      const fileBrand = brandForFileWithMeta(task.fileName, task.machineModel);
      const targetBrand = printerManager.brandOf(printer.model) || 'bambu';
      if (fileBrand !== targetBrand) {
        throw new Error(
          `「${task.fileName}」是${fileBrand === 'flashforge' ? '闪铸' : '拓竹'}格式文件，` +
          `打不了${targetBrand === 'flashforge' ? '闪铸' : '拓竹'}机「${printer.name}」——两品牌切片格式互不兼容`
        );
      }
    }

    if (!printer.autoDispatch) {
      // 非自动机型（如闪铸）：只写表提示人工上传。
      // 任务必须移出队列（2026-09-13）：留着会被下一轮自动匹配分到别的 Bambu，覆盖人工指定
      this.queue = this.queue.filter((t) => t.recordId !== task.recordId);
      this.known.add(task.recordId);
      // 人工已接管同样要移出 givenUp（2026-09-25）：否则记录残留在恢复通道里，
      // 可被再次 /print-dispatch 复活重复驱动真机
      this.givenUp.delete(task.recordId);
      // 审批源任务不写镜像表（recordId=instance_code 不是镜像表 record_id，写入必抛错且任务
      // 已出队会静默丢失；同 dispatchLocked 守卫口径）：状态由引擎内存追踪，人工按提示上传即可
      if (isLocalTask(task)) {
        storeSafe(() => {
          reservationStore.updateStatus(task.recordId, config.status.QUEUED, `人工指定 ${printer.name}，需手动上传打印`);
          reservationStore.setPrinter(task.recordId, printer.name);
        }, 'manual-manual-only');
      } else if (isMirrorTask(task)) {
        await bitableApi.updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.QUEUED,
          [config.dispatch.printerField]: printer.name,
        });
      }
      this.persistState();
      return {
        manualOnly: true,
        message: `已指定 ${printer.name}（${printer.model}，需人工上传文件启动打印）：请用厂商工具将「${task.fileName}」发送到该打印机`,
      };
    }

    // 防覆盖在打任务：人工分发不走 matching 串行段，直接 dispatch 会顶掉 printing 映射，
    // 原任务永远无法写「已完成/失败」；分发中（下载/上传 await 链）同样不可指定（2026-09-13 竞态修复）
    const busyTask = this.printing.get(printer.id);
    if (busyTask) {
      throw new Error(
        `${printer.name} 正在打印「${busyTask.applicationNo || busyTask.fileName || busyTask.recordId}」，请等其完成后再指定`
      );
    }
    if (this.dispatching.has(printer.id)) {
      throw new Error(`${printer.name} 正在有任务分发中（文件下载/上传），请稍候再试`);
    }

    this.queue = this.queue.filter((t) => t.recordId !== task.recordId);
    if (fromGivenUp) this.givenUp.delete(task.recordId);
    // 人工恢复 = 干净的起点（2026-10-16）：清零历史失败计数，给满额重试额度
    task.dispatchRetries = 0;
    await this.dispatch(task, printer);
    this.persistState();
    return { manualOnly: false, message: `已分发到 ${printer.name}` };
  }
}

function rgbToHex(rgb) {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const dispatcher = new Dispatcher();

module.exports = dispatcher;
module.exports.colorDistance = colorDistance;
module.exports.materialMatch = materialMatch;
module.exports.buildLocalTask = buildLocalTask;
module.exports.staleThresholdMs = staleThresholdMs;
module.exports.brandForFile = brandForFile;
module.exports.brandForFileWithMeta = brandForFileWithMeta;
module.exports.buildAmsMapping = buildAmsMapping;
module.exports.isHumanCancelFailReason = isHumanCancelFailReason;
module.exports.freshHmsCount = freshHmsCount;
module.exports.parseHmsTs = parseHmsTs;
module.exports.REPRINT_GUARD_MS = REPRINT_GUARD_MS;
