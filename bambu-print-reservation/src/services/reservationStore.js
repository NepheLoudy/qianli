// ============================================================
// 预约本地存储（2026-10-05 路线 A：断飞书审批链，预约系统整体本地化）
//
// 真相源 = 本文件管理的 JSON 存储（不再依赖多维表格镜像/审批实例事件）。
// 持久化模式照 DISPATCH_STATE_FILE：外部数据目录（部署清目录不丢）、
// 同步写 + 临时文件原子改名；预约低频写，不做防抖。
//
// 状态机（config.status）：
//   待审批 → 已通过 | 已驳回 | 已取消
//   已通过 → 排队中 | 已取消
//   排队中 → 打印中 | 排队中(失败重排) | 已取消
//   打印中 → 已完成 | 排队中(失败重排) | 已取消
//   已完成/已驳回/已取消 = 终态
// ============================================================

const fs = require('fs');
const path = require('path');
const config = require('../config');
const taxonomy = require('./taxonomy');

const STORE_FILE = process.env.RESERVATIONS_STORE_FILE || path.join(__dirname, '..', '..', '.reservations.json');
const UPLOAD_DIR = process.env.RESERVATIONS_UPLOAD_DIR || path.join(__dirname, '..', '..', 'data', 'uploads');

// 状态机：from → 允许的 to 集合
const TRANSITIONS = {
  [config.status.PENDING_REVIEW]: [config.status.REVIEW_APPROVED, config.status.REVIEW_REJECTED, config.status.CANCELLED],
  [config.status.REVIEW_APPROVED]: [config.status.QUEUED, config.status.CANCELLED],
  [config.status.QUEUED]: [config.status.PRINTING, config.status.QUEUED, config.status.COMPLETED, config.status.REVIEW_APPROVED, config.status.CANCELLED],
  [config.status.PRINTING]: [config.status.COMPLETED, config.status.QUEUED, config.status.CANCELLED],
  [config.status.COMPLETED]: [],
  [config.status.REVIEW_REJECTED]: [],
  [config.status.CANCELLED]: [],
};

// 历史轨迹截尾（防无限增长；200 条足够回溯单据全生命周期）
const HISTORY_CAP = 200;

// mtime 缓存（2026-10-08）：预约低频写但读频繁（列表轮询/指令/审批每次都全文件 parse），
// 以文件 mtime 作新鲜度凭证——外部手改文件（运维/测试）mtime 变化自动失效重读，
// 本模块写入后直接刷新缓存，语义与每次重读完全一致
let cache = null; // { mtimeMs, records }

/** 存储文件损坏隔离（2026-10-08）：坏文件改名留档后按空启动——原逻辑直接按空返回，
 * 下一次 create 会把仅存的记录全部覆盖（当日数据无备份可救）。隔离后坏文件可人工抢救 */
function quarantineCorruptFile(err) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const quarantined = `${STORE_FILE}.corrupt-${stamp}`;
  try { fs.renameSync(STORE_FILE, quarantined); } catch { /* 改不动就留在原地 */ }
  console.error(`[预约存储] 存储文件损坏已隔离到 ${quarantined}（${err.message}）——按空启动，请人工检查抢救`);
}

function load() {
  try {
    if (!fs.existsSync(STORE_FILE)) { cache = null; return []; }
    const mtimeMs = fs.statSync(STORE_FILE).mtimeMs;
    if (cache && cache.mtimeMs === mtimeMs) return cache.records;
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8'));
    const records = Array.isArray(data.records) ? data.records : [];
    cache = { mtimeMs, records };
    return records;
  } catch (err) {
    // 审查修复（v62）：损坏隔离只针对「文件内容真坏了」（JSON 解析失败）——EPERM/EBUSY
    // 等瞬时 fs 错误（Windows 杀软/索引器常见）原样上抛让请求 500 保留现场；原口径对
    // 任何错误都改名隔离并按空启动，一次杀软扫描就可能触发「旧数据进 .corrupt、新文件
    // 只含单条新记录」的静默缩水
    if (!(err instanceof SyntaxError)) throw err;
    quarantineCorruptFile(err);
    cache = null;
    return [];
  }
}

function save(records) {
  const tmp = STORE_FILE + '.tmp';
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), records }, null, 2));
  fs.renameSync(tmp, STORE_FILE);
  try { cache = { mtimeMs: fs.statSync(STORE_FILE).mtimeMs, records }; } catch { cache = null; }
}

/** 当日单号：R + YYYYMMDD + '-' + 3 位当日序号（以既有记录为准，重启不重号） */
function nextId(records) {
  const day = new Date();
  const ymd = `${day.getFullYear()}${String(day.getMonth() + 1).padStart(2, '0')}${String(day.getDate()).padStart(2, '0')}`;
  const prefix = `R${ymd}-`;
  const todayCount = records.filter((r) => String(r.id).startsWith(prefix)).length;
  return `${prefix}${String(todayCount + 1).padStart(3, '0')}`;
}

/** 颜色名识别（2026-10-08）：字典色名或 6 位 hex 视为可匹配；其余进警告——
 *  未识别颜色在选机时按「任意颜色」放行（dispatcher findTray 无参考色即放行），需让用户知情 */
function unrecognizedColors(colorStr) {
  const raw = String(colorStr || '').trim();
  if (!raw) return [];
  const dict = Object.keys(config.colorReference || {});
  return raw
    .split(/[+＋/、,，]/)
    .map((s) => s.trim())
    .filter((c) => c && !dict.includes(c) && !/^#?[0-9a-f]{6}$/i.test(c));
}

const reservationStore = {
  STORE_FILE,
  UPLOAD_DIR,

  /** 提交预约：材料可空——由需求标签反推（materialExclude/materialPrefer 随 processParams 下发选机） */
  create(input) {
    const errors = [];
    if (!input.applicant || !String(input.applicant).trim()) errors.push('发起人不能为空');
    if (!input.fileName) errors.push('切片/模型文件不能为空');
    if (!input.filePath) errors.push('文件未落盘');

    const selection = input.selection || {};
    const gate = taxonomy.validateSelection(selection, { material: input.materialType });
    errors.push(...gate.errors);
    // 颜色警告（不拦截）：字典外色名/杂色写法匹配时按任意颜色放行，提示用户知情
    const colorWarnings = unrecognizedColors(input.color)
      .map((c) => `颜色「${c}」不在常用色表（也非 hex 色值），自动匹配将按任意颜色处理——建议用标准色名（如 黑色/红色）或 #RRGGBB`);
    if (errors.length > 0) {
      const err = new Error(errors.join('；'));
      err.details = { errors, warnings: [...gate.warnings, ...colorWarnings] };
      throw err;
    }

    const records = load();
    const now = new Date().toISOString();
    const record = {
      id: nextId(records),
      createdAt: now,
      updatedAt: now,
      status: config.status.PENDING_REVIEW,
      applicant: String(input.applicant).trim(),
      submittedBy: String(input.submittedBy || ''), // 提交账号 id（归属判定键，displayName 非唯一）
      fileName: input.fileName,
      filePath: input.filePath,
      fileSize: input.fileSize || 0,
      // STEP/STL 源文件配对（2026-10-27 曼波令「两个齐活视为一次训练素材」）：
      // 切片文件提单时补交的 CAD 源，训练入库时提取真网格特征（gcode 估计的升级）
      sourceFile: input.sourceFile || null,
      sourceRecordId: input.sourceRecordId || null, // 复刻血缘（2026-11-04）：新单指向源单，关联视图数据源
      materialType: String(input.materialType || '').trim(),
      color: String(input.color || '').trim(),
      assignedPrinter: String(input.assignedPrinter || '').trim(),
      isUrgent: Boolean(input.isUrgent),
      quantity: Math.max(1, Math.min(99, Math.floor(Number(input.quantity) || 1))), // 份数护栏：正整数 1..99（防 1e9/NaN/小数进队列与切片）
      estMinutes: Number(input.estMinutes) > 0 ? Number(input.estMinutes) : null, // 3mf 内嵌预估时长（队列 ETA）
      selection,
      processParams: input.processParams || null,   // applyRules 快照（需求链路单；3mf 直通为 null）
      appliedRules: input.appliedRules || [],
      modelProvenance: input.modelProvenance || null, // 参数智能层 provenance（v60：模型修正/建议依据随单存档，审批台展示）
      embeddedParams: input.embeddedParams || null, // 3mf 内嵌参数摘要（审批透明化）
      spatial: Array.isArray(input.spatial) ? input.spatial : null, // 3D 标注随单存档（v56：载荷工况由标注驱动）
      placement: Array.isArray(input.placement) && input.placement.length === 4 ? input.placement.map(Number) : null, // 放置平面四元数（2026-10-16：Place on Face 累计旋转）
      modelFeatures: input.modelFeatures || null,   // STL 几何体检快照（需求链路单；学习回路底料）
      processWarnings: [...gate.warnings, ...colorWarnings],
      review: null,
      printer: null,
      history: [{ at: now, from: null, to: config.status.PENDING_REVIEW, note: '提交预约' }],
    };
    records.push(record);
    save(records);
    return { ...record };
  },

  get(id) {
    return load().find((r) => r.id === id) || null;
  },

  list() {
    return load();
  },

  /**
   * 分页查询（2026-11-04 审批台全量单据管理批）：过滤/排序/分页收口在存储层，路由只做参数解析。
   * 容错：page<1/非法归 1；pageSize 钳 1..200（默认 20）；status 仅认状态机合法值，非法值忽略不过滤；
   * q 空串视为未提供（大小写不敏感模糊匹配 id/applicant/fileName）；from/to 非法日期忽略该侧条件
   * （按 createdAt 过滤，含边界）；sort 仅 createdAt_asc/createdAt_desc，其余取值按默认 createdAt_desc。
   * 返回 { records, total, page, pageSize }（page/pageSize 为钳后有效值，路由原样回显）
   */
  query(opts = {}) {
    let records = load();
    // 状态过滤：精确匹配，字典外状态一律忽略（不做过滤）
    const status = typeof opts.status === 'string' ? opts.status.trim() : '';
    if (status && Object.values(config.status).includes(status)) {
      records = records.filter((r) => r.status === status);
    }
    // 关键词模糊：三字段任一命中即保留；空串/纯空白视为未提供
    const q = typeof opts.q === 'string' ? opts.q.trim().toLowerCase() : '';
    if (q) {
      records = records.filter((r) =>
        String(r.id || '').toLowerCase().includes(q)
        || String(r.applicant || '').toLowerCase().includes(q)
        || String(r.fileName || '').toLowerCase().includes(q));
    }
    // 时间范围（含边界）：非法日期忽略该侧；createdAt 自身非法的记录不落入任何范围
    const fromT = opts.from ? new Date(opts.from).getTime() : NaN;
    const toT = opts.to ? new Date(opts.to).getTime() : NaN;
    if (!Number.isNaN(fromT) || !Number.isNaN(toT)) {
      records = records.filter((r) => {
        const t = new Date(r.createdAt).getTime();
        if (Number.isNaN(t)) return false;
        if (!Number.isNaN(fromT) && t < fromT) return false;
        if (!Number.isNaN(toT) && t > toT) return false;
        return true;
      });
    }
    // 排序：仅 createdAt 双向（拷贝后排序，不污染 mtime 缓存数组的既有顺序）
    const dir = opts.sort === 'createdAt_asc' ? 1 : -1;
    records = [...records].sort((a, b) =>
      (new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()) * dir);
    // 分页钳制：page 从 1 起；pageSize 默认 20，上限 200
    let page = Math.floor(Number(opts.page));
    if (!Number.isFinite(page) || page < 1) page = 1;
    let pageSize = Math.floor(Number(opts.pageSize));
    if (!Number.isFinite(pageSize)) pageSize = 20;
    pageSize = Math.max(1, Math.min(200, pageSize));
    return {
      records: records.slice((page - 1) * pageSize, page * pageSize),
      total: records.length,
      page,
      pageSize,
    };
  },

  countByStatus(status) {
    return load().filter((r) => r.status === status).length;
  },

  /** 状态流转（状态机校验非法流转即抛）；printer 可选记录分配结果 */
  updateStatus(id, to, note = '') {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    const allowed = TRANSITIONS[record.status] || [];
    if (!allowed.includes(to)) {
      throw new Error(`状态机不允许「${record.status}」→「${to}」`);
    }
    const at = new Date().toISOString();
    record.history.push({ at, from: record.status, to, note });
    if (record.history.length > HISTORY_CAP) record.history = record.history.slice(-HISTORY_CAP);
    record.status = to;
    record.updatedAt = at;
    save(records);
    return { ...record };
  },

  /** 审批记录（不流转状态，附言用途） */
  setReview(id, review) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    record.review = { ...review, at: new Date().toISOString() };
    record.updatedAt = record.review.at;
    save(records);
    return { ...record };
  },

  setPrinter(id, printerName) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    record.printer = printerName;
    record.updatedAt = new Date().toISOString();
    save(records);
    return { ...record };
  },

  /** 审批入库样本标记（2026-10-16 曼波令）：{sampleEntry/sampleId/sampleError} 落档，不流转状态 */
  setSample(id, patch = {}) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    record.sample = { ...(record.sample || {}), ...patch };
    record.updatedAt = new Date().toISOString();
    save(records);
    return { ...record };
  },

  /**
   * 取件回执（2026-10-28 曼波令「打完要回执才行」）：已完成单确认取件落档——
   * 幂等（重复回执覆盖为最新）；终态单均可回执（巡检补完成的老单也能补确认）。
   * 队列闸的清理由 dispatcher.acknowledgeReceipt 负责（端点串联两步）。
   */
  acknowledgeReceipt(id, user) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    if (!['已完成', '已取消', '已驳回'].includes(record.status)) {
      const err = new Error(`预约「${id}」当前状态「${record.status}」——只有打完的单才需要取件回执`);
      err.statusCode = 400;
      throw err;
    }
    record.receipt = {
      by: user.displayName || user.username,
      byId: user.id || '',
      at: new Date().toISOString(),
    };
    record.updatedAt = record.receipt.at;
    record.history.push({ at: record.receipt.at, from: record.status, to: record.status, note: `取件回执：${record.receipt.by}` });
    if (record.history.length > HISTORY_CAP) record.history = record.history.slice(-HISTORY_CAP);
    save(records);
    return { ...record };
  },

  /** 轨迹追加（不流转状态）：复刻血缘等「单据间事件」记档（2026-11-04 任务卡 B） */
  appendHistory(id, note) {
    const records = load();
    const record = records.find((r) => r.id === id);
    if (!record) throw new Error(`预约不存在: ${id}`);
    const at = new Date().toISOString();
    record.history.push({ at, from: record.status, to: record.status, note });
    if (record.history.length > HISTORY_CAP) record.history = record.history.slice(-HISTORY_CAP);
    record.updatedAt = at;
    save(records);
    return { ...record };
  },

  /**
   * 上传源文件生命周期（2026-10-05 审查批）：终态单（已完成/已取消/已驳回）超过
   * UPLOAD_RETENTION_DAYS 天（默认 30，0=禁用）后清理源文件——磁盘护栏；单据记录
   * 与参数快照永久保留（fileCleaned 标记），打印产物不受影响
   */
  cleanupExpiredUploads(now = Date.now()) {
    const days = Number(process.env.UPLOAD_RETENTION_DAYS || 30);
    if (!days || days <= 0) return { disabled: true, removed: 0 };
    const records = load();
    let removed = 0;
    for (const record of records) {
      if (!['已完成', '已取消', '已驳回'].includes(record.status)) continue;
      if (record.fileCleaned || !record.filePath) continue;
      const age = now - new Date(record.updatedAt || record.createdAt).getTime();
      if (age < days * 24 * 3600 * 1000) continue;
      try {
        fs.unlinkSync(record.filePath);
        // 配对的 CAD 源文件同生命周期清理（2026-10-27 提单配对批）：不留孤儿文件
        // v83 数组形态适配（一盘多件多源）：sourceFile 为数组时逐个清理，否则孤儿无限累积
        const sfs = Array.isArray(record.sourceFile) ? record.sourceFile : [record.sourceFile].filter(Boolean);
        for (const sf of sfs) {
          if (!sf || !sf.storedPath) continue;
          try { fs.unlinkSync(sf.storedPath); } catch (e2) { if (e2.code !== 'ENOENT') console.warn(`[预约存储] 清理配对源文件失败 ${record.id}:`, e2.message); }
        }
        record.fileCleaned = true;
        record.fileCleanedAt = new Date(now).toISOString();
        removed++;
      } catch (err) {
        if (err.code === 'ENOENT') { record.fileCleaned = true; } else { console.warn(`[预约存储] 清理源文件失败 ${record.id}:`, err.message); }
      }
    }
    if (removed > 0) save(records);
    return { disabled: false, removed };
  },
};

reservationStore._saveForBackfill = save; // v84：DNA 回填脚本专用保存通道（受控导出，不进常规 API）
module.exports = reservationStore;
