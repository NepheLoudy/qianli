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

const isUnslicedFile = (r) => isUnslicedFileName(r && r.fileName);
const plaza = require('./plaza');

// 机器端人工取消的 fail_reason 集合（2026-10-16 曼波令）：HMS 0300-400C「打印已取消」
// 系列码 = 打印被人在机器上停止/取消（屏幕手停、外部客户端取消）——**人的决定，系统
// 必须尊重**：不重排队、不自动重发（此前误走 failTask「失败重排」——机器上取消一次、
// 系统就再发一次，与人循环对抗）。本系统自己发的 stop 不会走到此判（dequeue 先释放
// printing 映射，failed 事件找不到在册任务）。
const HUMAN_CANCEL_FAIL_CODES = new Set([50348044]); // 0x0300400C；后续实测到变体码再补
function isHumanCancelFailReason(code) {
  return HUMAN_CANCEL_FAIL_CODES.has(Number(code) || 0);
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
  if (quietHours.gatePayload('webhook-card', card, name)) return;
  // 打印异常类卡片（buildJobFailedCard，标题「❌ 打印异常」）改发审批 webhook 机器人所在群
  // （2026-10-18 曼波令：机械组播报太吵，异常卡集中到话题群）；其余播报仍走机械组。
  // 显式 targetUrl 优先；审批群 webhook 未配置时回落机械组（fail-safe）
  const isFailureCard = card && card.header && card.header.title
    && String(card.header.title.content || '').includes('打印异常');
  const url = targetUrl || (isFailureCard ? config.bot.approvalWebhookUrl || undefined : undefined);
  sendMessage(card, url).catch(onError);
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
    printerManager.on('jobEvent', ({ printer, event }) => {
      const task = this.printing.get(printer.id);
      if (event === 'finish') {
        if (task) this.completeTask(task, printer);
      } else if (event === 'failed') {
        if (task) {
          // 2026-10-16 曼波令：机器端人工取消（0300-400C 系列）不重发——
          // 其余失败（机械/挤出/AMS 等）维持既有「失败重排」通道
          if (isHumanCancelFailReason(printer.failReason)) {
            this.humanTerminateTask(task, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else {
            this.failTask(task, printer, '打印机上报失败状态');
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
        if (ghost) {
          // 幽灵收尾同样尊重人工取消码（直回空闲但残留取消码时不当失败重排）
          if (isHumanCancelFailReason(printer.failReason)) {
            this.humanTerminateTask(ghost, printer).catch((err) =>
              console.error('[分发] 人工终止收尾失败:', err.message)
            );
          } else {
            console.warn(`[分发] 打印机 ${printer.name} 由打印中直回空闲且无完成事件，按失败收尾幽灵任务: ${ghost.applicationNo || ghost.recordId}`);
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
      const available = printerManager.getAvailablePrinters().filter((p) => !this.dispatching.has(p.id));
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
      if (!want) continue;
      const hit = actives.find((p) => {
        const sub = String(p.subtaskName || '').trim();
        return sub && (sub === want || sub.includes(want) || want.includes(sub));
      });
      if (!hit) continue;
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
    );

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
        }
        return null;
      }
      // 审批分发指定（2026-10-16）：审批人指定的槽位在分发时刻仍须实装——
      // 换料/抽走导致槽位不可用时滞留等人工（不静默换槽，尊重审批指定）。
      // 多耗材批：prefTrays 逐条检查非空条目（留自动的条目无需检查）
      const prefSlots = Array.isArray(task.prefTrays) && task.prefTrays.some(Boolean)
        ? task.prefTrays.filter(Boolean)
        : (task.prefTray && task.prefTray.slot ? [task.prefTray] : []);
      for (const pt of prefSlots) {
        const stillThere = (named.ams || []).some((t) => t.slot === pt.slot && t.type);
        if (!stillThere) {
          console.warn(`[分发] ${task.applicationNo} 审批指定槽位「${pt.slot}」在 ${named.name} 已不可用——滞留等待人工处理`);
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
    if (this.dispatching.has(printer.id)) {
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
      // 切片元数据（用料清单/板型/内嵌机型，2026-10-16 曼波真单批）：分发时刻现读文件——
      // 对老单（提交时未提取）同样生效；读不出回落提交时快照 embeddedParams
      let fileMeta = task.embeddedParams || null;
      if (/\.3mf$/i.test(task.fileName || '')) {
        try {
          fileMeta = { ...(fileMeta || {}), ...slicerExtract.extractFrom3mf(buffer) };
        } catch (err) {
          console.warn(`[分发] ${task.recordId} 切片元数据读取失败，按默认参数下发: ${err.message}`);
        }
      }
      // 闪铸目标 + 3mf 工程文件（2026-10-16 曼波真机反馈批）：Orca 工程 .gcode.3mf（拿闪铸机子
      // 切的）内嵌 flashforge gcode——闪铸固件只吃裸 gcode，必须提取后按 .gcode 上传
      const effBrand = brandForFileWithMeta(task.fileName, (fileMeta && fileMeta.machineModel) || task.machineModel);
      let uploadName = remoteName;
      if (effBrand === 'flashforge' && /\.3mf$/i.test(task.fileName || '')) {
        try {
          const g = new (require('adm-zip'))(buffer).getEntry('Metadata/plate_1.gcode');
          if (!g) throw new Error('未找到 Metadata/plate_1.gcode');
          buffer = g.getData();
          uploadName = remoteName.replace(/\.3mf$/i, '.gcode');
          console.log(`[分发] ${task.recordId} 闪铸直通：提取内嵌 gcode ${Math.round(buffer.length / 1024)}KB → ${uploadName}`);
        } catch (err) {
          throw new Error(`闪铸直通 3mf 提取内嵌 gcode 失败：${err.message}`);
        }
      }
      await printerManager.uploadFileToPrinter(printer.id, buffer, uploadName);

      if (await checkCancelled('下发')) return;
      const amsFrame = buildAmsMapping(task, printer, fileMeta);
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
    } else if (isMirrorTask(task)) {
      await bitableApi
        .updateRecord(config.bitable.reservationTableId, task.recordId, {
          '申请状态': config.status.CANCELLED,
        })
        .catch(() => {});
    }

    announce(
      `终止卡 ${task.recordId}`,
      require('../feishu/bot').buildJobFailedCard(
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
      // 入库样本失败回填（2026-10-16）：重试若成功会再覆盖为「成功」——末次真实结果为准
      try {
        const rec = reservationStore.get(task.recordId);
        if (rec && rec.sample && rec.sample.sampleEntry && rec.sample.sampleId) {
          require('./trainingStore').setOutcomeBySource(task.recordId, {
            status: '失败', recordedBy: '打印系统', issues: String(reason || '').slice(0, 200),
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
