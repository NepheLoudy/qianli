const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
// dotenv 必须最先加载（config 内 require('dotenv').config）：authStore/processRules/
// trainingStore 等服务模块在顶层读 process.env.XXXX 决定存储路径——晚于它们加载
// 会让 .env 的存储路径静默失效、退回项目根默认（2026-10-12 审查发现，账号库
// 实际落在了项目根而非 bambu-data 数据目录）
const config = require('./config');
const { requireApiToken, requireUser, parseCookies, safeEqual } = require('./auth');
const authStore = require('./services/authStore');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const reservationService = require('./services/reservation');
const reservationStore = require('./services/reservationStore');
const processRules = require('./services/processRules');
const dispatcher = require('./services/dispatcher');
const printerManager = require('./printer/manager');
const { BAMBU_FILAMENT_PRESETS } = require('./printer/client');
const FlashforgeClient = require('./printer/flashforge');
// 指令唯一出口：hub 经 POST /api/chat/command 转发（对话铁律——本仓不消费消息事件）
const { executeCommand } = require('./services/chatService');

// 2026-10-05 路线 A（断飞书审批链）：审批实例/任务/表格事件消费 + 审批对账整体退役
// （approvalService/eventSubscription 已随 v46 遗留清理批删除）；预约真相源改为本地存储
// （reservationStore），审批动作为本服务 HTTP 端点，飞书仅剩群 webhook 播报。

const app = express();

app.use(cors());
// 审批事件/表单可能较大（AGENTS.md 通用坑：express.json 放宽到 2mb）
app.use(express.json({ limit: '2mb' }));

// HTTP → HTTPS 导航自动升级（2026-10-16 曼波反复踩「HTTP 页面没画面」根治）：
// WebCodecs 要求安全上下文，HTTP 非 localhost 下画面必然黑屏。只对**浏览器 HTML 导航**
// （Accept 含 text/html）302 跳转 HTTPS 镜像；API/内部调用（Accept: */* 的 fetch/curl、
// gateway/hub 转发）不受影响。302 而非 301：避免浏览器永久缓存（将来调整端口的余地）
// ⚠️ 内嵌浏览器（Electron/ZCode IAB）豁免（2026-10-16 实锤：IAB 不认系统证书库，
// 跳 HTTPS 落证书错误页反而全瞎）——IAB 留在 HTTP，画面走 MSE（jmuxer）通道
const HTTPS_MIRROR_PORT = Number(process.env.HTTPS_PORT || 3443);
app.use((req, res, next) => {
  const ua = String(req.headers['user-agent'] || '');
  const isEmbedded = /Electron|ZCode\//i.test(ua); // IAB 内嵌内核不重定向
  if (
    req.protocol === 'http' // ⚠️ 仅 HTTP 侧生效——HTTPS 镜像共用同一 app，缺此条件会自我 302 死循环（ERR_TOO_MANY_REDIRECTS 实锤）
    && req.method === 'GET'
    && HTTPS_MIRROR_PORT > 0
    && !isEmbedded
    && String(req.headers.accept || '').includes('text/html')
    && !req.path.startsWith('/api/') // API 路径永不重定向（保险双闸）
  ) {
    return res.redirect(302, `https://${req.hostname}:${HTTPS_MIRROR_PORT}${req.originalUrl}`);
  }
  next();
});

// 前端页面（同源伺服，public/index.html）；HTML 不缓存——页面迭代后浏览器不得吃旧版；
// js/css 同样不缓存（2026-10-12：迭代期启发式缓存让浏览器跑旧脚本，"功能又坏了"类反馈的真凶）
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// 上传目录预建
fs.mkdirSync(reservationStore.UPLOAD_DIR, { recursive: true });
// 模型/切片扩展名白名单（审查批：拒任意文件）。gcode 系=闪铸切片产物（2026-10-14
// 双品牌批）：与 3mf 同走「审批直通」（参数已定，引擎不定档），分发时按品牌分流
const MODEL_EXT_RE = /\.(stl|step|stp|3mf|obj|gcode|gx|g)$/i;
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, reservationStore.UPLOAD_DIR),
    filename: (req, file, cb) =>
      cb(null, `${Date.now()}-${Math.round(Math.random() * 1e6)}${path.extname(file.originalname || '')}`),
  }),
  fileFilter: (req, file, cb) => {
    if (MODEL_EXT_RE.test(file.originalname || '')) return cb(null, true);
    cb(new Error('仅接受 .stl / .step / .stp / .3mf / .obj 模型文件'));
  },
  limits: { fileSize: 200 * 1024 * 1024 }, // 模型/切片文件上限 200MB
});

// multer/busby 编码实测（2026-10-05，干净进程 codepoint 插桩定案）：
//   file.originalname 按 latin1 解（需显式还原 UTF-8）；
//   multipart 文本字段 busboy 已按 UTF-8 解好——勿二次转换（否则中文反而乱码）

/** 取消/删除权限：本人（按提交时账号 id，displayName 非唯一键）或 reviewer/admin */
function assertCanManage(user, reservation) {
  if (!reservation) {
    const err = new Error('预约记录不存在');
    err.statusCode = 404;
    throw err;
  }
  if (reservation.submittedBy === user.id || ['reviewer', 'admin'].includes(user.role)) return;
  const err = new Error('只能操作自己的预约');
  err.statusCode = 403;
  throw err;
}

app.get('/api/health', (req, res) => {
  // 数据面文件状态（运维可见性：部署漏配项目外路径时在这里一眼看出）
  const fs = require('fs');
  const fileState = (p) => { try { return fs.existsSync(p) ? fs.statSync(p).size : null; } catch { return 'err'; } };
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    version: require('../package.json').version,
    phase: 'local-webapp', // 路线 A 自建前后端（2026-10-05）
    printers: config.printers.length,
    quietHours: require('./utils/quietHours').getStatus(),
    stores: {
      reservations: fileState(reservationStore.STORE_FILE),
      uploadsDir: fs.existsSync(reservationStore.UPLOAD_DIR),
      auth: fileState(require('./services/authStore').AUTH_FILE),
      rules: fileState(require('./services/processRules').getRulesSnapshot().rulesFile),
      ruleSuggestions: fileState(require('./services/ruleSuggestions').FILE),
      backup: (() => {
        const b = require('./services/backup').getLastRun();
        return b ? { lastCopied: b.copied.length, dir: b.dir } : null;
      })(),
    },
  });
});

// ---------- 账号体系（2026-10-05 第二批：防止未授权使用） ----------
// 注册开放（首位注册者自动 admin，之后均 member）；审批人由 admin 在页面升权。

// 注册已关闭（2026-10-12 曼波：需要账号联系 2805328773@qq.com 人工开）。
// 端点保留并 fail-closed 403——防止老客户端/脚本仍走开放注册
app.post('/api/auth/register', (req, res) => {
  res.status(403).json({ error: '注册已关闭——如需账号请联系 2805328773@qq.com（注明姓名与用途），由管理员人工开通' });
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { username, password } = req.body || {};
    const user = authStore.login(username, password);
    const token = authStore.createSession(user.id);
    res.setHeader('Set-Cookie',
      `bambu_session=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${30 * 24 * 3600}`);
    res.json(user);
  } catch (err) {
    res.status(401).json({ error: err.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = parseCookies(req).bambu_session;
  if (token) authStore.destroySession(token);
  res.setHeader('Set-Cookie', 'bambu_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  res.json({ success: true });
});

// 管理员重置用户密码（2026-10-12）：临时密码随返回值给管理员转交，被重置者会话全清
app.post('/api/auth/users/:id/reset-password', requireUser('admin'), (req, res) => {
  try {
    const temp = 'tmp' + String(Math.floor(1000 + Math.random() * 9000));
    res.json(require('./services/authStore').adminResetPassword(req.params.id, temp));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/auth/me', (req, res) => {
  const user = authStore.resolveSession(parseCookies(req).bambu_session);
  if (!user) return res.status(401).json({ error: '未登录' });
  res.json(user);
});

// 修改密码（登录态 + 旧密码验证；api-token 通道无改密语义，明确拒绝）
app.post('/api/auth/change-password', (req, res) => {
  const token = parseCookies(req).bambu_session;
  const user = authStore.resolveSession(token);
  if (!user || user.id === 'api-token') return res.status(401).json({ error: '未登录' });
  try {
    const { oldPassword, newPassword } = req.body || {};
    authStore.changePassword(user.id, oldPassword, newPassword, token);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 用户管理（admin）：名册 + 角色升降
app.get('/api/auth/users', requireUser('admin'), (req, res) => {
  res.json(authStore.listUsers());
});

app.post('/api/auth/users/:id/role', requireUser('admin'), (req, res) => {
  try {
    res.json(authStore.setRole(req.params.id, (req.body || {}).role));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 定制窗口（规则见顶层 AGENTS「机器人后端定制窗口」）：定制项全景只读 ----------

app.get('/api/print/policy', (req, res) => {
  let queue = null;
  try { queue = dispatcher.getQueueSnapshot(); } catch (err) { queue = null; }
  let printing = null;
  try { printing = dispatcher.getPrintingSnapshot(); } catch (err) { printing = null; }
  res.json({
    bot: { name: config.bot?.name || 'bambu-print-reservation', port: config.port },
    printers: {
      configured: config.printers.length,
      list: config.printers.map((p) => ({ id: p.id, name: p.name, model: p.model, brand: require('./printer/manager').brandOf(p.model) })),
      available: (() => { try { return printerManager.getAvailablePrinters().length; } catch { return null; } })(),
    },
    approval: {
      primaryChannel: false, // 2026-10-05 路线 A 退役：审批走自建页面，事件/对账链路已下线（字段保留仅供旧面板兼容）
      approvalCodeConfigured: Boolean(config.approval.approvalCode),
      autoApprove: false,
      reconcileMinutes: config.approval.reconcileMinutes,
      reconcileWindowMinutes: config.approval.reconcileWindowMinutes,
      retired: true,
    },
    dispatch: {
      colorDistanceThreshold: config.dispatch.colorDistanceThreshold,
      reconcileMinutes: config.dispatch.reconcileMinutes,
      materialRemindMinutes: config.dispatch.materialRemindMinutes,
      useAms: config.dispatch.useAms,
      maxRetries: config.dispatch.maxRetries,
      retryCooldownMs: config.dispatch.retryCooldownMs,
      givenUpCount: (() => { try { return dispatcher.listGivenUp().length; } catch { return null; } })(),
    },
    queue: { waiting: Array.isArray(queue) ? queue.length : null, printingCount: printing ? (Array.isArray(printing) ? printing.length : Object.keys(printing).length) : null },
    reviewResult: config.reviewResult,
  });
});

// 需求标签池窗口（「勾选 → 规则引擎 → 切片」体系第一层，只读全景）：
// 标签定义/映射提示/冲突规则，供运维台展示与「打标指南」文档页取数
app.get('/api/print/taxonomy', (req, res) => {
  res.json(require('./services/taxonomy').getTaxonomy());
});

// 颜色字典窗口（2026-10-08 只读）：提交页颜色栏 datalist 数据源 + 未识别色名提示依据
// （字典外颜色在选机时按「任意颜色」放行——此处把可匹配色集显式暴露给前端校验）
app.get('/api/print/colors', (req, res) => {
  res.json({
    colorNames: Object.keys(config.colorReference),
    threshold: config.dispatch.colorDistanceThreshold,
  });
});

// ---------- 工艺映射规则库窗口（体系第二层：标签 → 切片参数） ----------
// 读窗口：基线参数/白名单/规则集全景（含版本，进切片产物缓存 key）
app.get('/api/print/process-rules', (req, res) => {
  res.json(require('./services/processRules').getRulesSnapshot());
});
// 写窗口（管理端点，X-API-Token 鉴权）：热改规则，内存即时生效并写回规则文件
// body: { op: 'upsert' | 'remove' | 'reset', rule?, id? }
app.post('/api/print/process-rules', requireApiToken, (req, res) => {
  const { op, rule, id } = req.body || {};
  const rules = require('./services/processRules');
  let result;
  if (op === 'upsert') result = rules.upsertRule(rule);
  else if (op === 'remove') result = rules.removeRule(id);
  else if (op === 'reset') result = rules.resetRules();
  else return res.status(400).json({ error: 'op 必须是 upsert/remove/reset' });
  res.status(result.ok ? 200 : 400).json(result);
});

// ---------- 学习链路（2026-10-05 第三批）：预览 / 修正建议池 / 专家 3mf 导入 ----------

// 参数实时预览（登录用户）：提交页勾选变化即调，让用户/审批人提交前看到「本单会怎么切」
app.post('/api/print/process-rules/preview', requireUser(), (req, res) => {
  const { selection, material } = req.body || {};
  res.json(processRules.applyRules(selection || {}, { material }));
});

// 修正建议池（登录用户可提交——使用/审批中发现参数不合适即可提；待审池聚合，reviewer 采纳）
app.post('/api/print/rule-suggestions', requireUser(), (req, res) => {
  try {
    const { when, set, reason, source, sourceRef } = req.body || {};
    const result = require('./services/ruleSuggestions').add({
      when, set, reason, source, sourceRef, suggestedBy: req.user.displayName,
    });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details });
  }
});

app.get('/api/print/rule-suggestions', requireUser('reviewer', 'admin'), (req, res) => {
  res.json(require('./services/ruleSuggestions').list(req.query.status));
});

app.post('/api/print/rule-suggestions/:id/adopt', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    const { priority } = req.body || {};
    res.json(require('./services/ruleSuggestions').adopt(req.params.id, req.user.displayName, priority));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/print/rule-suggestions/:id/reject', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    res.json(require('./services/ruleSuggestions').reject(req.params.id, req.user.displayName));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 专家 3mf 作品导入（reviewer+）：提取参数 diff 生成候选草稿——不入库，前端确认后走建议池
app.post('/api/print/slicer-extract', requireUser('reviewer', 'admin'), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少 3mf 文件（multipart 字段名 file）' });
    if (!/\.3mf$/i.test(req.file.originalname || '')) {
      try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
      return res.status(400).json({ error: '仅接受 .3mf（专家切片产物/工程导出）' });
    }
    const result = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(req.file.path));
    try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
    res.json(result);
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: `3mf 解析失败: ${err.message}` });
  }
});

// STL/3mf 几何体检（登录即可；2026-10-11 模型特征自拟合）：解析上传的裸模型，
// 返回几何特征 + taxonomy「几何体检」组预勾选建议——体检是提效不设卡：
// 失败/超限不阻塞提交，前端按「无建议」降级。2026-10-12 扩 3mf（训练录入页复用）
app.post('/api/print/model-features', requireUser(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少模型文件（multipart 字段名 file）' });
    const name = req.file.originalname || '';
    const clean = () => { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } };
    const mf = require('./services/modelFeatures');
    if (/\.stl$/i.test(name)) {
      const result = mf.analyzeStl(fs.readFileSync(req.file.path));
      clean();
      return res.json(result);
    }
    if (/\.3mf$/i.test(name)) {
      const result = mf.analyze3mf(fs.readFileSync(req.file.path));
      clean();
      return res.json(result);
    }
    // STEP/IGES（2026-10-15 曼波令）：occt WASM 网格化后走同一体检核心
    if (require('./utils/stepMesh').isCadFile(name)) {
      const result = await mf.analyzeStep(fs.readFileSync(req.file.path), name);
      clean();
      return res.json(result);
    }
    clean();
    return res.status(400).json({ error: '几何体检目前仅支持 .stl / .3mf / .step / .stp（obj 按需求勾选走）' });
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ ok: false, skipped: true, error: `模型解析失败: ${err.message}` });
  }
});

// ---------- 训练集录入工坊（2026-10-12，无审批：录入即入库） ----------

// 机队档案（多品牌机型隔离；JSON 人工维护）
app.get('/api/training/fleet', requireUser(), (req, res) => {
  res.json({ machines: require('./services/printerFleet').load() });
});

// 拟合度（2026-10-12 曼波纠正置信度语义）：引擎按人工工况算的参数 vs 专家切片参数，
// 衡量规则库对此 case 的覆盖程度；差异项即「可被记忆的参数」（一键转规则候选）
app.post('/api/training/fit', requireUser(), (req, res) => {
  try {
    const { selection, materialType, expertParams } = req.body || {};
    if (!expertParams || !Object.keys(expertParams).length) {
      return res.status(400).json({ error: '缺少专家切片参数（先上传切片产物）' });
    }
    const applied = require('./services/processRules').applyRules(selection || {}, { material: materialType });
    if (applied.blocked) {
      return res.json({ score: null, blocked: true, errors: applied.errors });
    }
    const fit = require('./services/paramFit').compare(applied.params, expertParams);
    res.json({ ...fit, engineParams: applied.params });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 规则拟合（2026-10-15 曼波定原则）：从「优秀切片样本 × 几何特征」统计拟合学习型因果规则，
// 候选进待审池（source='fit'）——采纳后进规则库生效；不手写工艺因果（手写已撤）
app.post('/api/training/rule-fit', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    const trainingStore = require('./services/trainingStore');
    const { fitRules } = require('./services/ruleFitter');
    const { deriveFeatures } = require('./services/featureDerive');
    const result = fitRules(deriveFeatures, trainingStore.list(), req.body || {});
    const suggestions = require('./services/ruleSuggestions');
    let added = 0;
    for (const c of result.candidates) {
      suggestions.add({
        when: c.when,
        set: c.set,
        reason: c.reason,
        source: 'fit',
        sourceRef: `fit:${c.stats.feature}×${c.stats.param}`,
        suggestedBy: req.user.displayName,
      });
      added += 1;
    }
    res.json({ ...result, added, note: added ? `已产出 ${added} 条候选（待审池确认后生效）` : '暂无显著特征-参数关联（样本量或差异不足）' });
  } catch (err) {
    console.error('规则拟合失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 网格下发（3D 标注工房用）：模型文件 → 抽稀网格 JSON（≤12 万面，浏览器可渲染）
/** 模型文件 → 3D 预览网格（训练标注工坊与审批台 Z 截面预览共用；超 80MB 由调用方拦截） */
async function buildMeshPreview(fileBuffer, fileName) {
  const mf = require('./services/modelFeatures');
  let parsed;
  if (/\.3mf$/i.test(fileName)) {
    // 注意：用 parse3mfModel 拿原始网格（analyze3mf 的对象是分析结果，不含几何）
    const r = mf.parse3mfModel(fileBuffer);
    if (r.error || !r.objects.length) {
      // 已切片 3mf（2026-10-18 曼波反馈）：内部只有 gcode 与缩略图、没有模型网格——
      // 返回切片展示要素供前端友好降级；两者都缺才保留原错误
      const artifacts = require('./services/sliceArtifacts').extractSlicedArtifacts(fileBuffer);
      if (artifacts) return artifacts;
      throw new Error(r.error || '3mf 内无可渲染网格');
    }
    parsed = r.objects[0]; // 多零件取首件（v1 标注以主零件为界）
  } else if (require('./utils/stepMesh').isCadFile(fileName)) {
    // STEP/IGES：occt WASM 网格化（2026-10-15 支持 step 解析）
    parsed = await require('./utils/stepMesh').parseCadToParsed(fileBuffer, fileName);
  } else {
    parsed = mf.parseStl(fileBuffer);
  }
  if (parsed.error) throw new Error(parsed.error);
  const { positions, faces, triangles } = parsed;
  const MAX_VIEW_FACES = 120000;
  const skip = Math.max(1, Math.ceil(triangles / MAX_VIEW_FACES));
  const outFaces = [];
  for (let t = 0; t < triangles; t += skip) outFaces.push(faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]);
  return {
    positions: Array.from(positions),
    faces: outFaces,
    faceCount: outFaces.length / 3,
    originalFaceCount: triangles,
    decimated: skip > 1,
    skip,
  };
}

app.post('/api/training/mesh', requireUser(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少模型文件' });
    if (req.file.size > 80 * 1024 * 1024) {
      try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
      return res.status(400).json({ error: '模型超过 80MB，3D 标注视图不支持（不影响录入）' });
    }
    const clean = () => { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } };
    try {
      const preview = await buildMeshPreview(fs.readFileSync(req.file.path), req.file.originalname || '');
      clean();
      res.json(preview);
    } catch (err) {
      clean();
      return res.status(400).json({ error: err.message });
    }
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: `网格下发失败: ${err.message}` });
  }
});

// 切片产物参数提取（登录即可）：3mf 工程/已切片产物 → 专家切片参数 + baseline diff
app.post('/api/training/analyze-slice', requireUser(), upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少切片产物（multipart 字段名 file，.3mf）' });
    const clean = () => { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } };
    if (!/\.3mf$/i.test(req.file.originalname || '')) {
      clean();
      return res.status(400).json({ error: '切片产物仅支持 .3mf（工程导出或已切片产物）' });
    }
    if (req.file.size > 50 * 1024 * 1024) {
      clean();
      return res.status(400).json({ error: '3mf 超过 50MB，跳过提取（adm-zip 需整文件进内存）' });
    }
    const result = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(req.file.path));
    clean();
    res.json(result);
  } catch (err) {
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: `切片参数提取失败: ${err.message}` });
  }
});

// 录入训练样本（登录即可，无审批）：模型文件必填 + 切片产物可选 + 人工工况勾选必填
app.post('/api/training/samples', requireUser(), upload.fields([
  { name: 'model', maxCount: 1 },
  { name: 'slice', maxCount: 1 },
]), (req, res) => {
  try {
    const body = req.body || {};
    let selection = {};
    let spatial = [];
    try {
      selection = body.selection ? JSON.parse(body.selection) : {};
      spatial = body.spatial ? JSON.parse(body.spatial) : [];
    } catch {
      return res.status(400).json({ error: 'selection/spatial 不是合法 JSON' });
    }
    // 使用场景必填（2026-10-18 曼波令：标注工坊与预约台双入口同口径，服务端兜底）
    if (!require('./services/taxonomy').isSceneSelected(selection)) {
      return res.status(400).json({ error: '请勾选「使用场景」（必填）', details: ['使用场景是必填项——在需求标签区顶部勾选至少一项'] });
    }
    // 放置平面四元数（2026-10-16）：与预约单同口径——随样本存档（标注朝向帧换算桥）
    let placement = null;
    if (body.placement) {
      try {
        const q = JSON.parse(body.placement);
        if (Array.isArray(q) && q.length === 4 && q.every((v) => Number.isFinite(Number(v)))) placement = q.map(Number);
      } catch { /* 非法忽略 */ }
    }
    // spatial 字段净化（v56 抽取为 utils/spatialSanitize 唯一权威实现，预约提交共用）：
    // point/axis/survey/circle/region/load 白名单；faces 封顶 20 万
    spatial = require('./utils/spatialSanitize').sanitizeSpatial(spatial);
    const modelFile = (req.files && req.files.model && req.files.model[0]) || null;
    const sliceFile = (req.files && req.files.slice && req.files.slice[0]) || null;
    if (!modelFile) return res.status(400).json({ error: '缺少模型文件（multipart 字段名 model）' });

    // 几何特征（分析失败不阻塞——负样本也是数据）；>80MB 不读内存（整读会拖垮进程）
    let features = null;
    let modelBuf = null;
    if (modelFile.size <= 80 * 1024 * 1024) {
      try {
        const mf = require('./services/modelFeatures');
        modelBuf = fs.readFileSync(modelFile.path);
        features = /\.3mf$/i.test(modelFile.originalname || '') ? mf.analyze3mf(modelBuf) : mf.analyzeStl(modelBuf);
      } catch (err) {
        console.warn(`[训练集] 模型特征分析失败（照常入库）: ${err.message}`);
      }
    } else {
      console.warn(`[训练集] 模型 ${Math.round(modelFile.size / 1048576)}MB 超上限，特征与归档跳过（只记元数据）`);
    }

    // 专家切片参数提取（失败不阻塞）——必须在拟合度计算之前：v48 曾把它写在
    // fit 块后面，fit 块引用 extraction 触发 TDZ，所有带工况的入库请求 400
    let extraction = null;
    if (sliceFile && req.files.slice[0].size <= 50 * 1024 * 1024) {
      try {
        extraction = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(sliceFile.path));
      } catch (err) {
        console.warn(`[训练集] 切片参数提取失败（照常入库）: ${err.message}`);
      }
    }

    // 机型置信度快照改为「拟合度」：引擎(工况) vs 专家(切片) 参数贴合程度
    let fit = null;
    if (Object.keys(selection).length && extraction && extraction.params) {
      try {
        const applied = require('./services/processRules').applyRules(selection, { material: body.materialType });
        if (!applied.blocked) {
          fit = require('./services/paramFit').compare(applied.params, extraction.params);
        }
      } catch { /* 不阻塞 */ }
    }

    // 专家摆向标签（2026-10-19 学习回路）：人工放置优先；3mf 对象变换为弱标签
    let orientation = placement ? { quaternion: placement, source: 'placement' } : null;
    if (!orientation && modelBuf && /\.3mf$/i.test(modelFile.originalname || '')) {
      try {
        const ex = require('./services/orientationExtract').extractOrientationFrom3mf(modelBuf);
        if (ex && !ex.identity) orientation = { quaternion: ex.quaternion, source: ex.source, note: `角度 ${ex.angleDeg}°` };
      } catch { /* 提取失败不阻塞入库 */ }
    }
    if (!orientation && sliceFile && /\.3mf$/i.test(sliceFile.originalname || '') && sliceFile.size <= 50 * 1024 * 1024) {
      try {
        const ex = require('./services/orientationExtract').extractOrientationFrom3mf(fs.readFileSync(sliceFile.path));
        if (ex && !ex.identity) orientation = { quaternion: ex.quaternion, source: ex.source, note: `角度 ${ex.angleDeg}°` };
      } catch { /* 提取失败不阻塞入库 */ }
    }

    const sample = require('./services/trainingStore').create({
      createdBy: req.user.displayName,
      notes: body.notes,
      selection,
      machine: body.machine,
      confidence: (() => { const v = Number(body.confidence); return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null; })(),
      spatial,
      placement,      // 放置平面四元数（2026-10-16：Place on Face 累计旋转；未放置为 null）
      orientation,    // 专家摆向标签（学习回路）
      materialType: body.materialType,
      fit,
      model: {
        originalName: Buffer.from(modelFile.originalname || 'unnamed', 'latin1').toString('utf8'),
        ...(modelBuf ? { buffer: modelBuf } : { buffer: Buffer.alloc(0), tooLargeToArchive: true }),
        features,
      },
      slice: sliceFile ? {
        originalName: Buffer.from(sliceFile.originalname || 'slice.3mf', 'latin1').toString('utf8'),
        buffer: fs.readFileSync(sliceFile.path),
        extraction,
      } : null,
    });
    res.json(sample);
  } catch (err) {
    res.status(400).json({ error: err.message, details: err.details });
  } finally {
    // 清理 multer 落盘的临时文件（样本内已归档副本）
    if (req.files) for (const arr of Object.values(req.files)) for (const f of arr) { try { fs.unlinkSync(f.path); } catch { /* 已不存在 */ } }
  }
});

app.get('/api/training/samples', requireUser(), (req, res) => {
  const store = require('./services/trainingStore');
  res.json({ samples: store.list(), stats: store.stats() });
});

// ---------- 摆向策略学习回路（2026-10-19 曼波令：几何特征→切片方式进学习网络） ----------
// audit：样本库体检（多少条有专家摆向标签/几何/outcome）；
// fit：跑拟合（24 候选 × 权重网格 + 按家族 LOFO），只写 candidate；
// adopt：人工采纳后 autoSlice 才使用（candidate 不生效）。
app.get('/api/training/orientation/audit', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    const samples = require('./services/trainingStore').list();
    const fitter = require('./services/orientationFitter');
    res.json({
      audit: fitter.auditSamples(samples),
      policy: require('./services/orientationPolicyStore').getSnapshot(),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/training/orientation/fit', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const samples = require('./services/trainingStore').list();
    const fitter = require('./services/orientationFitter');
    const result = await fitter.fitOrientationPolicy(samples, req.body || {});
    const saved = result.policy
      ? require('./services/orientationPolicyStore').saveCandidate(result.policy, result.stats)
      : null;
    res.json({ ...result, saved });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post('/api/training/orientation/adopt', requireUser('admin'), (req, res) => {
  try {
    res.json(require('./services/orientationPolicyStore').adopt());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 打印结果回填（学习信号奖励通道）：审阅者及以上——outcome 是训练权重来源，
// 普通成员随手改会让学习信号失真（2026-10-18 审查；录入/浏览仍对全体登录用户开放）
app.post('/api/training/samples/:id/outcome', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    res.json(require('./services/trainingStore').setOutcome(req.params.id, {
      ...(req.body || {}),
      recordedBy: req.user.displayName,
    }));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 几何特征重提取（reviewer+，2026-10-16 修复工具）：老样本因解析缺口特征未提取——
// 按归档模型重算（完整网格→网格分析；切片导出件无网格→gcode 估计），补低权重标记
app.post('/api/training/samples/:id/refit-features', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    const tstore = require('./services/trainingStore');
    const s = tstore.get(req.params.id);
    if (!s) return res.status(404).json({ error: '样本不存在' });
    if (!s.model || !s.model.storedPath) return res.status(400).json({ error: '样本无归档模型文件，无法重提取' });
    const buf = fs.readFileSync(s.model.storedPath);
    const mf = require('./services/modelFeatures');
    const is3mf = s.model.kind === '3mf' || /\.3mf$/i.test(s.model.name || '');
    const fr = is3mf ? mf.featuresFromSliced3mf(buf) : { features: mf.analyzeStl(buf), featureSource: 'auto' };
    if (!fr.features || fr.features.ok !== true) {
      return res.status(400).json({ error: `特征分析未成功：${(fr.features && fr.features.reason) || '未知'}` });
    }
    const updated = tstore.setFeatures(s.id, {
      features: fr.features,
      autoSuggestion: fr.features.suggestions || null,
      featureSource: s.featureSource || fr.featureSource,
      confidence: 40, // 自动特征低权重（曼波 2026-10-16；已有置信度的样本不覆盖）
    });
    res.json({
      success: true, id: updated.id, featureSource: updated.featureSource, confidence: updated.confidence,
      bbox: fr.features.bbox, layers: fr.features.layers, volumeCm3: fr.features.volumeCm3,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 训练管线消费口：JSONL 全量导出
app.get('/api/training/export', requireUser('reviewer', 'admin'), (req, res) => {
  const store = require('./services/trainingStore');
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="training-samples-${Date.now()}.jsonl"`);
  res.send(store.dumpJsonl());
});

app.delete('/api/training/samples/:id', requireUser('reviewer', 'admin'), (req, res) => {
  try {
    res.json(require('./services/trainingStore').remove(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/reservations', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getAllReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取预约列表失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/:id', requireUser(), async (req, res) => {
  try {
    const { id } = req.params;
    const reservation = await reservationService.getReservationById(id);
    if (!reservation) {
      return res.status(404).json({ error: '预约记录不存在' });
    }
    res.json(reservation);
  } catch (err) {
    console.error('获取预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// ---------- 审批台切片预览（2026-10-18 P0）：真实刀轨分层截面 ----------
// 解析切片产物内嵌 gcode（3mf 的 Metadata/plate_1.gcode / 闪铸单 .gcode），按 Z 层
// 抽出挤出路徑供前端画截面视图；解析结果按文件 mtime+size 缓存（最多 6 份）。
const slicePreviewCache = new Map();
function readGcodeFromRecord(rec) {
  const buf = fs.readFileSync(rec.filePath);
  // 解压炸弹/超大文件护栏：单层预览不需要整份 GB 级 gcode 进内存
  if (/\.gcode$/i.test(rec.fileName || '')) return buf.length <= 128 * 1024 * 1024 ? buf.toString('utf8') : null;
  if (/\.3mf$/i.test(rec.fileName || '')) {
    const AdmZipMod = require('adm-zip');
    const zip = new AdmZipMod(buf);
    const entry = zip.getEntry('Metadata/plate_1.gcode');
    if (!entry || Number((entry.header && entry.header.size) || 0) > 128 * 1024 * 1024) return null;
    return entry.getData().toString('utf8');
  }
  return null;
}
function getSliceLayers(rec) {
  if (!rec || rec.fileCleaned || !rec.filePath) return null;
  const stat = fs.statSync(rec.filePath);
  const key = `${rec.id}:${stat.mtimeMs}:${stat.size}`;
  if (slicePreviewCache.has(key)) return slicePreviewCache.get(key);
  const text = readGcodeFromRecord(rec);
  if (!text) return null;
  const { parseGcodeLayers, compactLayers } = require('./services/gcodeLayers');
  const layers = compactLayers(parseGcodeLayers(text));
  while (slicePreviewCache.size >= 6) slicePreviewCache.delete(slicePreviewCache.keys().next().value);
  slicePreviewCache.set(key, layers);
  return layers;
}

// 切片分层清单（reviewer+）：层号/Z/段数/全层包围盒 + 缩略图地址
app.get('/api/reservations/:id/slice-layers', requireUser('reviewer'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    const layers = getSliceLayers(rec);
    if (!layers || !layers.length) return res.status(404).json({ error: '该文件无内嵌 gcode（非切片产物或未含 plate_1.gcode）' });
    const bounds = layers.reduce((acc, l) => {
      const [a, b, c, d] = l.bounds;
      return [Math.min(acc[0], a), Math.min(acc[1], b), Math.max(acc[2], c), Math.max(acc[3], d)];
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    res.json({
      count: layers.length,
      layers: layers.map((l) => ({ i: l.i, z: l.z, count: l.segs.length })),
      bounds,
      thumbnail: /\.3mf$/i.test(rec.fileName || '') ? `/api/reservations/${encodeURIComponent(rec.id)}/thumbnail` : null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 单层截面（reviewer+）：segments=[[x1,y1,x2,y2]...]（mm，gcode 坐标）
app.get('/api/reservations/:id/slice-layer', requireUser('reviewer'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    const layers = getSliceLayers(rec);
    if (!layers) return res.status(404).json({ error: '该文件无内嵌 gcode' });
    const layer = layers[Number(req.query.i)];
    if (!layer) return res.status(404).json({ error: '层序号越界' });
    res.json({ i: layer.i, z: layer.z, bounds: layer.bounds, segments: layer.segs });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 3mf 切片缩略图（reviewer+）：Metadata/plate_1.png（切片器自带渲染）
app.get('/api/reservations/:id/thumbnail', requireUser('reviewer'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    if (rec.fileCleaned || !rec.filePath || !/\.3mf$/i.test(rec.fileName || '')) return res.status(404).json({ error: '无缩略图' });
    const AdmZipMod = require('adm-zip');
    const zip = new AdmZipMod(fs.readFileSync(rec.filePath));
    const entry = zip.getEntry('Metadata/plate_1.png') || zip.getEntry('Metadata/plate_1_small.png');
    if (!entry) return res.status(404).json({ error: '3mf 内无 plate 缩略图' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=600');
    res.send(entry.getData());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------- 审批台模型预览（reviewer+，2026-10-18 曼波令）：预约源文件 → 3D 网格，
// 前端用 MeshAnnotator 只读渲染 + Z 轴截面滑块查看「切片长啥样」
app.get('/api/reservations/:id/mesh', requireUser('reviewer'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    if (rec.fileCleaned) return res.status(410).json({ error: '源文件已过保留期清理，无法预览' });
    if (!rec.filePath) return res.status(404).json({ error: '该单无源文件路径' });
    const buf = await fs.promises.readFile(rec.filePath);
    if (buf.length > 80 * 1024 * 1024) return res.status(413).json({ error: '模型超过 80MB，预览不支持（不影响审批）' });
    res.json(await buildMeshPreview(buf, rec.fileName || ''));
  } catch (err) {
    res.status(400).json({ error: `网格下发失败: ${err.message}` });
  }
});

// 审批台切片回读校验（reviewer+，2026-10-18 P0 框架）：切片产物内嵌参数 ↔ 规则引擎
// 参数 → 拟合度 v2（容差+加权+verdict）与差异表——审批人「专家切得对不对」一屏核对
app.get('/api/reservations/:id/fit', requireUser('reviewer'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    const processRules = require('./services/processRules');
    const paramFit = require('./services/paramFit');
    const applied = processRules.applyRules(rec.selection || {}, { material: rec.materialType || '' });
    const expert = rec.embeddedParams && rec.embeddedParams.params ? rec.embeddedParams.params : null;
    const fit = expert ? paramFit.compare(applied.params || {}, expert) : null;
    res.json({
      engineParams: applied.params,
      blocked: Boolean(applied.blocked),
      errors: applied.errors || [],
      appliedRules: applied.applied || [],
      expertParams: expert,
      machineModel: (rec.embeddedParams && rec.embeddedParams.machineModel) || '',
      filaments: (rec.embeddedParams && rec.embeddedParams.filaments) || [],
      fit,
      rulesVersion: applied.rulesVersion || null,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// 审批前自动切片预览（reviewer+，2026-10-18 曼波令「step 上传要自动切好给我审批」）：
// 未切片模型单按「目标机 × 份数 × 审批快照参数（processParams）」现场切片——不下载发、
// 不上传打印机，仅产出层截面/缩略图/回读拟合，审批人看到的就是将要实际打印的切片。
// 结果缓存在内存（最多 4 单），按 id 提供单层路段查询；重启即失效（重新生成即可）。
const sliceRunCache = new Map();
app.post('/api/reservations/:id/slice-preview', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const rec = await reservationService.getReservationById(req.params.id);
    if (!rec) return res.status(404).json({ error: '预约记录不存在' });
    if (!/\.(stl|step|stp|obj)$/i.test(rec.fileName || '')) {
      return res.status(400).json({ error: '仅未切片模型单需要自动切片预览（已切片单请用切片回读校验）' });
    }
    if (rec.fileCleaned || !rec.filePath) return res.status(410).json({ error: '源文件不可用' });
    const cfg = require('./config');
    const { capabilitiesFor } = require('./printer/capabilities');
    const want = String((req.body && req.body.printerName) || rec.assignedPrinter || '').trim();
    let target = want ? cfg.printers.find((p) => p.name === want) : null;
    if (want && !target) return res.status(400).json({ error: `指定打印机「${want}」未登记` });
    if (!target) target = cfg.printers.find((p) => capabilitiesFor(p.model).brand === 'bambu');
    if (!target) return res.status(400).json({ error: '机队无拓竹机型，无法自动切片（闪铸需预先切好 gcode）' });
    const autoSlice = require('./services/autoSlice');
    const r = await autoSlice.sliceModel({
      sourcePath: rec.filePath,
      fileName: rec.fileName,
      model: target.model,
      materialType: rec.materialType,
      selection: rec.selection || {},
      params: rec.processParams || undefined, // 审批快照参数优先（规则库演进不改变已审批口径）
      quantity: rec.quantity || 1,
      outDir: path.join(autoSlice.SLICE_DIR, 'preview'),
      placement: rec.placement || null, // 用户手动放置 → 尊重其朝向（不自动改向）
    });
    const AdmZipMod = require('adm-zip');
    const buf = fs.readFileSync(r.outPath);
    const zip = new AdmZipMod(buf);
    const entrySize = (e) => Number((e && e.header && e.header.size) || 0);
    const gcode = zip.getEntry('Metadata/plate_1.gcode');
    const notes = ((r.profiles && r.profiles.notes) || []).slice();
    const tooBigGcode = gcode && entrySize(gcode) > 128 * 1024 * 1024;
    if (tooBigGcode) notes.push('gcode 超过 128MB，层截面预览已省略（缩略图仍可看）');
    const { parseGcodeLayers, compactLayers } = require('./services/gcodeLayers');
    const layers = gcode && !tooBigGcode ? compactLayers(parseGcodeLayers(gcode.getData().toString('utf8'))) : [];
    const bounds = layers.reduce((acc, l) => {
      const [a, b, c, d] = l.bounds;
      return [Math.min(acc[0], a), Math.min(acc[1], b), Math.max(acc[2], c), Math.max(acc[3], d)];
    }, [Infinity, Infinity, -Infinity, -Infinity]);
    const png = zip.getEntry('Metadata/plate_1.png') || zip.getEntry('Metadata/plate_1_small.png');
    const thumbOk = png && entrySize(png) <= 8 * 1024 * 1024;
    sliceRunCache.set(rec.id, { layers, machine: target.model, at: Date.now() });
    while (sliceRunCache.size > 4) sliceRunCache.delete(sliceRunCache.keys().next().value);
    try { fs.unlinkSync(r.outPath); } catch { /* 已不存在 */ }
    res.json({
      machine: target.name,
      model: target.model,
      copies: r.copies,
      objects: r.objects,
      fit: r.fit,
      layers: layers.map((l) => ({ i: l.i, z: l.z, count: l.segs.length })),
      bounds: layers.length ? bounds : null,
      thumbnail: thumbOk ? `data:image/png;base64,${png.getData().toString('base64')}` : null,
      notes,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.get('/api/reservations/:id/slice-preview/layer', requireUser('reviewer', 'admin'), (req, res) => {
  const hit = sliceRunCache.get(req.params.id);
  if (!hit) return res.status(409).json({ error: '自动切片预览已失效——请在审批台重新生成' });
  if (Date.now() - hit.at > 30 * 60 * 1000) { // 30 分钟 TTL：层数据可能较大，不做长期驻留
    sliceRunCache.delete(req.params.id);
    return res.status(409).json({ error: '自动切片预览已过期（超过 30 分钟）——请重新生成' });
  }
  const layer = hit.layers[Number(req.query.i)];
  if (!layer) return res.status(404).json({ error: '层序号越界' });
  res.json({ i: layer.i, z: layer.z, bounds: layer.bounds, segments: layer.segs });
});
app.post('/api/reservations', requireUser(), upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '缺少文件（multipart 字段名 file）' });
    const body = req.body || {};
    const fileName = Buffer.from(req.file.originalname || 'unnamed', 'latin1').toString('utf8');
    // 已切片产物=审批直通（2026-10-14 扩：闪铸 gcode 系与 3mf 同语义——参数已定，
    // 引擎不定档不越俎代庖；分发引擎按品牌分流：3mf→拓竹 / gcode→闪铸）
    const isSliced = /\.(3mf|gcode|gx|g)$/i.test(fileName);
    const is3mf = /\.3mf$/i.test(fileName);

    // 工况勾选与 3D 标注：**切片直通单同样收集**（2026-10-16 曼波定：切片参数由工况×几何
    // 共同决定——纯 3mf 无标注工况，入库训练无意义；直通单的勾选不作定档，仅作样本底料）
    let selection = {};
    let spatial = [];
    try {
      selection = body.selection ? JSON.parse(body.selection) : {};
      // 3D 标注随单存档（v56）：载荷工况由标注驱动，标注底料与训练样本同构入库
      spatial = require('./utils/spatialSanitize').sanitizeSpatial(
        body.spatial ? JSON.parse(body.spatial) : []
      );
    } catch {
      try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
      return res.status(400).json({ error: 'selection/spatial 不是合法 JSON' });
    }
    // 使用场景必填（2026-10-18 曼波令；标注/预约台双入口同口径，服务端兜底）
    if (!require('./services/taxonomy').isSceneSelected(selection)) {
      try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
      return res.status(400).json({ error: '请勾选「使用场景」（必填）', details: ['使用场景是必填项——在需求标签区顶部勾选至少一项'] });
    }
    // 放置平面四元数（2026-10-16）：3D 工坊 Place on Face 的累计旋转随单存档——
    // 标注坐标在放置后的朝向帧里，此值即朝向帧↔原始文件坐标系的换算桥（切片烘焙/解义用）
    let placement = null;
    if (body.placement) {
      try {
        const q = JSON.parse(body.placement);
        if (Array.isArray(q) && q.length === 4 && q.every((v) => Number.isFinite(Number(v)))) placement = q.map(Number);
      } catch { /* 非法忽略，不阻塞提交 */ }
    }

    // 需求链路才定档；3mf 直通（参数内嵌，快照置空并在页面标注）。
    // 定档需 modelFeatures（特征派生输入）——故快照解析先行（无副作用，原位置在下方）
    // 需求链路单的几何体检快照解析（2026-10-11 引入；2026-10-15 挪前供依据）：
    // 只收白名单数值键，防伪造膨胀；无/解析失败为 null
    let modelFeatures = null;
    if (!isSliced && body.modelFeatures) {
      try {
        const raw = JSON.parse(body.modelFeatures);
        if (raw && raw.ok === true) {
          modelFeatures = {
            triangles: Number(raw.triangles) || 0,
            vertices: Number(raw.vertices) || 0,
            bbox: raw.bbox || null,
            volumeCm3: Number(raw.volumeCm3) || 0,
            overhang: raw.overhang || null,
            contact: raw.contact || null,
            curvedPct: Number(raw.curvedPct) || 0,
            holes: raw.holes || null,
            mesh: raw.mesh || null,
            suggested: (raw.suggestions && raw.suggestions.selection) || {},
          };
        }
      } catch { /* 非法 JSON 忽略，不阻塞提交 */ }
    }

    let applied = null;
    if (!isSliced) {
      // 特征派生（2026-10-15）：spatial 标注 + 几何体检 → feat 字典进规则条件
      // （拟合规则引用 feat.*；载荷→勾选折算仍在前端完成）
      const feat = require('./services/featureDerive').deriveFeatures(spatial, modelFeatures, selection);
      applied = processRules.applyRules(selection, { material: body.materialType, feat });
      if (applied.blocked) {
        try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
        return res.status(400).json({ error: '需求勾选存在硬冲突', details: applied.errors, warnings: applied.warnings });
      }
    }

    // 3mf 审批透明化（2026-10-06）：提取文件内嵌切片参数摘要随单存档——审批人
    // 不用下载文件开 Bambu Studio 就能看参数。提取失败不阻塞提交（摘要置空）；
    // 大于 50MB 跳过提取（adm-zip 需整文件进内存，大文件会拖垮提交请求）
    let embeddedParams = null;
    let estMinutes = null;
    if (isSliced && is3mf) {
      if (req.file.size > 50 * 1024 * 1024) {
        console.log(`[提交] 3mf 过大（${Math.round(req.file.size / 1048576)}MB），跳过参数提取`);
      } else {
        try {
          const extracted = require('./services/slicerExtract').extractFrom3mf(fs.readFileSync(req.file.path));
          // 板型/用料清单随单入档（2026-10-16 真单批）：分发帧 bed_type 与 ams 映射的底料
          embeddedParams = {
            source: extracted.source, params: extracted.params, estMinutes: extracted.estMinutes,
            bedType: extracted.bedType || null, filaments: extracted.filaments || [],
            machineModel: extracted.machineModel || null, // 内嵌目标机型（2026-10-16：直通单品牌路由权威）
          };
          estMinutes = extracted.estMinutes; // 预计时长随单入档（队列 ETA 用）
        } catch (err) {
          console.warn(`[提交] 3mf 参数提取失败（不影响提交）: ${err.message}`);
        }
      }
    }

    // 指定打印机校验（2026-10-08）：自由文本填错名字此前会静默走自动匹配或永远排队——
    // 显式指定的值必须命中登记清单，拼错当场打回
    if (String(body.assignedPrinter || '').trim()) {
      const wanted = String(body.assignedPrinter).trim();
      const pr = config.printers.find((p) => p.name === wanted);
      if (!pr) {
        try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
        return res.status(400).json({
          error: `指定打印机「${wanted}」未登记，请从下拉选择（已登记：${config.printers.map((p) => p.name).join('、') || '无——先在 .env PRINTER_HOSTS 登记'}）`,
        });
      }
      // 品牌相容性（2026-10-16 曼波反馈批）：切片格式与机型品牌互不兼容——填错当场打回
      const prBrand = (printerManager.brandOf && printerManager.brandOf(pr.model)) || 'bambu';
      const fileBrand = require('./services/dispatcher').brandForFileWithMeta(fileName, embeddedParams && embeddedParams.machineModel); // 内嵌机型优先（2026-10-16）
      if (prBrand !== fileBrand) {
        try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ }
        return res.status(400).json({
          error: `「${wanted}」是${prBrand === 'flashforge' ? '闪铸' : '拓竹'}机型，打不了${fileBrand === 'flashforge' ? '闪铸 gcode 系' : '拓竹 3mf'}格式——两品牌切片格式互不兼容，请改选对应品牌机型或留空自动匹配`,
        });
      }
    }

    const reservation = await reservationService.createReservation({
      applicant: req.user.displayName, // 发起人 = 登录身份（防冒名），body.applicant 忽略
      submittedBy: req.user.id,        // 归属判定键（本人取消等）
      // 仅文件名需 latin1→UTF-8 还原（文本字段 busboy 已按 UTF-8 解好）
      fileName,
      filePath: req.file.path,
      fileSize: req.file.size,
      materialType: body.materialType,
      color: body.color,
      assignedPrinter: body.assignedPrinter,
      // 高速打印标签联动加急排队（仅需求链路；3mf 加急走表单 isUrgent）
      isUrgent: body.isUrgent === 'true' || body.isUrgent === '1' || selection.fast_mode === true,
      quantity: body.quantity,
      selection,
      spatial,        // 3D 标注随单存档（v56：载荷工况由标注驱动，底料与训练样本同构）
      placement,      // 放置平面四元数（2026-10-16：Place on Face 累计旋转；未放置为 null）
      processParams: applied ? applied.params : null,
      appliedRules: applied ? applied.applied : [],
      embeddedParams, // 3mf 内嵌参数摘要（审批透明化；需求链路单为 null）
      estMinutes,     // 3mf 内嵌预估时长（队列 ETA；需求链路单为 null）
      modelFeatures,  // STL 几何体检快照（需求链路单；3mf 直通为 null）
    });

    reservationService.notifyReviewers(reservation).catch(() => {}); // fire-and-forget
    require('./services/usageReport').reportUsage(req.user.username, 'print-submit').catch(() => {});
    res.json(reservation);
  } catch (err) {
    console.error('提交预约失败:', err);
    if (req.file) { try { fs.unlinkSync(req.file.path); } catch { /* 已不存在 */ } }
    res.status(400).json({ error: err.message, details: err.details, warnings: err.details?.warnings || [] });
  }
});

app.put('/api/reservations/:id', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: '状态不能为空' });
    }

    const reservation = reservationStore.get(id);
    if (!reservation) {
      return res.status(404).json({ error: '预约记录不存在' });
    }

    if (status === config.status.REVIEW_APPROVED) {
      await reservationService.approveReservation(id, 'HTTP', '');
    } else if (status === config.status.CANCELLED) {
      await reservationService.cancelReservation(id);
    } else {
      reservationStore.updateStatus(id, status, 'HTTP 状态变更（状态机校验）');
    }

    res.json(reservationStore.get(id));
  } catch (err) {
    console.error('更新预约失败:', err);
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/reservations/:id', requireUser(), async (req, res) => {
  try {
    const { id } = req.params;
    assertCanManage(req.user, reservationStore.get(id));
    await reservationService.cancelReservation(id);
    res.json({ success: true });
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

// ---------- 审批动作（reviewer 及以上；运维台 X-API-Token 走 admin 通道不受影响） ----------

app.post('/api/reservations/:id/approve', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { comment, dispatch, sampleEntry } = req.body || {};
    const result = await reservationService.approveReservation(req.params.id, req.user.displayName, comment, dispatch || {}, Boolean(sampleEntry));
    require('./services/usageReport').reportUsage(req.user.username, 'print-approve').catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('审批通过失败:', err);
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/reservations/:id/reject', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { comment } = req.body || {};
    const result = await reservationService.rejectReservation(req.params.id, req.user.displayName, comment);
    require('./services/usageReport').reportUsage(req.user.username, 'print-reject').catch(() => {});
    res.json(result);
  } catch (err) {
    console.error('审批驳回失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 兼容旧端点：/review 按结果转发 approve/reject
app.post('/api/reservations/:id/review', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewResult, reviewComment } = req.body;
    if (!reviewResult) {
      return res.status(400).json({ error: '审查结果不能为空' });
    }
    const result = reviewResult === config.reviewResult.APPROVED
      ? await reservationService.approveReservation(id, req.user.displayName, reviewComment)
      : await reservationService.rejectReservation(id, req.user.displayName, reviewComment);
    res.json(result);
  } catch (err) {
    console.error('处理审查结果失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 复刻（2026-10-08）：已完成单一键带参重提（打坏了重打/帮同学打同款）——
// 服务端复制源文件免重传；需求链路单按当前规则库重新定档；新单走完整审批流
app.post('/api/reservations/:id/reprint', requireUser(), async (req, res) => {
  try {
    const reservation = await reservationService.reprintReservation(req.params.id, req.user, req.body || {});
    reservationService.notifyReviewers(reservation).catch(() => {}); // fire-and-forget
    require('./services/usageReport').reportUsage(req.user.username, 'print-reprint').catch(() => {});
    res.json(reservation);
  } catch (err) {
    console.error('复刻预约失败:', err);
    res.status(400).json({ error: err.message, details: err.details, warnings: err.details?.warnings || [] });
  }
});

// 取消：本人取消自己的单，或 reviewer/admin 代管（用户自助取消）
app.post('/api/reservations/:id/cancel', requireUser(), async (req, res) => {
  try {
    assertCanManage(req.user, reservationStore.get(req.params.id));
    res.json(await reservationService.cancelReservation(req.params.id));
  } catch (err) {
    console.error('取消预约失败:', err);
    res.status(err.statusCode || 400).json({ error: err.message });
  }
});

app.get('/api/reservations/status/pending-review', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getPendingReviewReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取待审批预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/printing', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getPrintingReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取打印中预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/reservations/status/completed', requireUser(), async (req, res) => {
  try {
    const reservations = await reservationService.getCompletedReservations();
    res.json(reservations);
  } catch (err) {
    console.error('获取已完成预约失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 打印机实时状态（含内网 IP/温度/AMS，登录可见——不放匿名面；stateStale=报文过期失联标注）
app.get('/api/printers', requireUser(), (req, res) => {
  try {
    const printers = printerManager.getApiStates();
    res.json(printers);
  } catch (err) {
    console.error('获取打印机状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/printers/available', requireUser(), (req, res) => {
  try {
    const printers = printerManager.getAvailablePrinters();
    res.json(printers);
  } catch (err) {
    console.error('获取可用打印机失败:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 真机联调核对面（admin）：raw state 报文全量 + 连接/新鲜度元信息——AMS 报文形状、
// gcodeState 序列等「待真机核对」假设出错时，用它区分「报文假设错了」还是「解析错了」
app.get('/api/printers/:id/debug', requireUser('admin'), (req, res) => {
  const debug = printerManager.getPrinterDebug(parseInt(req.params.id));
  if (!debug) return res.status(404).json({ error: '打印机不存在' });
  res.json(debug);
});

app.get('/api/printers/:id', requireUser(), (req, res) => {
  try {
    const { id } = req.params;
    const printer = printerManager.getPrinterState(parseInt(id));
    if (!printer) {
      return res.status(404).json({ error: '打印机不存在' });
    }
    res.json(printer);
  } catch (err) {
    console.error('获取打印机状态失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 打印机控制端点分级（2026-10-15 观察台 v55，曼波拍板）：
//   低危（暂停/恢复/灯/速度/风扇）= reviewer+；危险（停止/gcode/动机械）= admin
//   「动机械」（回原点/轴移动/校准/退料）另有状态门控：仅空闲/完成/故障态可发（canJogMachine）

// 动机械门控前置校验：非空闲态 409（前端按钮置灰为第一道，这里硬校验兜底）
function requireIdleForMachine(printerId, res) {
  const st = printerManager.getPrinterState(printerId);
  if (!printerManager.canJogMachine(st ? st.gcodeState : '')) {
    res.status(409).json({ error: `打印机非空闲态（${st ? st.status : '未知'}），禁止动机械指令` });
    return false;
  }
  return true;
}

app.post('/api/printers/:id/print', requireUser('admin'), async (req, res) => {
  try {
    const { id } = req.params;
    const { filePath } = req.body;

    if (!filePath) {
      return res.status(400).json({ error: '文件路径不能为空' });
    }

    await printerManager.startPrintOnPrinter(parseInt(id), filePath);
    res.json({ success: true });
  } catch (err) {
    console.error('开始打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/pause', requireUser('reviewer'), async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.pausePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('暂停打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/printers/:id/resume', requireUser('reviewer'), async (req, res) => {
  try {
    const { id } = req.params;
    await printerManager.resumePrintOnPrinter(parseInt(id));
    res.json({ success: true });
  } catch (err) {
    console.error('恢复打印失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 停止打印（admin，2026-10-16 曼波真单批）：下发后**验证机器是否真的离开打印态**——
// 「指令被收下但机器没停」此前是黑盒（stop 回执 success 不等于停机）；按机器实际状态
// 如实回报（stopped/state/note），前端按结果提示，不再一律显示「已下发」
app.post('/api/printers/:id/stop', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  console.log(`[停止] 收到停止请求 printer=${id}`);
  try {
    const gone = ['PRINTING', 'RUNNING', 'PAUSE', 'PREPARE', 'RESUME'];
    const readState = () => {
      const st = printerManager.getPrinterState(id);
      return st ? String(st.gcodeState || '').toUpperCase() : '';
    };
    const before = readState();
    if (!gone.includes(before)) {
      return res.json({ success: true, wasPrinting: false, stopped: true, state: printerManager.getPrinterState(id)?.status || '', note: '机器当前未处于打印状态，无需停止' });
    }
    await printerManager.stopPrintOnPrinter(id);
    // 状态验证：≤10s 内离开打印/暂停/准备态视为已停止（H2 状态转换慢是已知特性）
    let stopped = false;
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (!gone.includes(readState())) { stopped = true; break; }
    }
    const st = printerManager.getPrinterState(id);
    res.json({
      success: true,
      wasPrinting: true,
      stopped,
      state: st ? st.status : '',
      note: stopped ? undefined : '指令被机器受理但状态未变化——请查看机器屏幕（固件可能未响应停止指令）',
    });
  } catch (err) {
    console.error('停止打印失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 清除任务错误残留（admin，2026-10-16 曼波真单批）：H2 固件取消/失败后残留 FAILED
// 会挡住分发匹配——本端点发 clean_print_error（停止态等价屏幕按掉报错，无物理动作）；
// 状态门沿用动机械口径（空闲/完成/故障放行，打印中/暂停/准备中一律拒绝）。
// 闪铸（2026-10-16 按钮批）：对应物=stateCtrl_cmd setClearPlatform——打印完成/取消后的
// 屏幕弹窗会挡住灯/暂停等控制，清屏等价屏幕上点掉弹窗（闪铸不做状态验证，如实标注）
app.post('/api/printers/:id/clear-error', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  // 请求可见性（2026-10-16：状态验证链最长约 1 分钟，防「点了没反应」无从排查）
  console.log(`[清残留] 收到清除请求 printer=${id}`);
  if (!requireIdleForMachine(id, res)) return;
  const st = printerManager.getPrinterState(id);
  const isFf = st && st.brand === 'flashforge';
  try {
    const r = await printerManager.cleanPrintErrorOnPrinter(id);
    if (isFf) {
      return res.json({
        success: true,
        screen: true, // 前端区分文案：闪铸=清屏弹窗（无状态验证）
        state: st.status,
        note: '已发送清屏指令（闪铸机型不做状态验证——屏幕弹窗是否已关闭以机器屏幕为准）',
      });
    }
    res.json({
      success: true,
      ...(r || {}),
      note: r && r.cleared === false
        ? '指令被机器受理但状态未变化：可在打印机屏幕处理该任务，或重启打印机电源'
        : undefined,
    });
  } catch (err) {
    console.error('清除打印错误失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 灯控（reviewer+）：body {on, lamp: 'chamber'|'work'}，缺省腔灯（闪铸忽略 lamp）
app.post('/api/printers/:id/light', requireUser('reviewer'), async (req, res) => {
  try {
    const body = req.body || {};
    const on = Boolean(body.on);
    const lamp = body.lamp === 'work' ? 'work_light' : 'chamber_light';
    await printerManager.lightControlOnPrinter(parseInt(req.params.id), on, lamp);
    res.json({ success: true, light: on ? 'on' : 'off', lamp });
  } catch (err) {
    console.error('灯控失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// 料信息写入选项（观察台编辑弹窗用）：拓竹=预设码表；C5P=21 料/24 色盘；AD5M 无料站
app.get('/api/printers/:id/ams-options', requireUser(), (req, res) => {
  const pid = parseInt(req.params.id);
  const p = findApiPrinter(pid);
  if (!p) return res.status(404).json({ error: '打印机不存在' });
  if (p.brand === 'flashforge') {
    const station = String(p.model || '').toUpperCase().includes('CREATOR');
    return res.json({
      supported: station,
      materials: station ? FlashforgeClient.FILAMENT_MATERIALS : [],
      colors: station ? FlashforgeClient.FILAMENT_COLORS : null,
      note: station
        ? 'Creator 5 料站调色板（远程写入打印机本地；固件 1.9.9 实测该命令暂空转，成败以状态回读为准）'
        : 'AD5M 系列打印机没有料站/料信息字段（仅左右进料口），无处可写',
    });
  }
  return res.json({
    supported: true,
    materials: Object.keys(BAMBU_FILAMENT_PRESETS),
    colors: null,
    note: '拓竹 AMS/外挂槽位——远程写入打印机本地（回执 + 状态回读双重验证）',
  });
});

// 料信息远程写入（admin，2026-10-17 曼波令「编辑=覆盖打印机本地数据，不是本地显示层」）：
// body { slot, type, colorHex }；成败如实回报（reflected=状态回读已体现目标值）
app.post('/api/printers/:id/ams-setting', requireUser('admin'), async (req, res) => {
  try {
    const pid = parseInt(req.params.id);
    const p = findApiPrinter(pid);
    if (!p) return res.status(404).json({ error: '打印机不存在' });
    const body = req.body || {};
    const slot = typeof body.slot === 'string' ? body.slot.trim() : '';
    const type = typeof body.type === 'string' ? body.type.trim() : '';
    const hex = String(body.colorHex || '').replace(/^#/, '').toUpperCase();
    if (!slot) return res.status(400).json({ error: 'slot 必填（槽位名）' });
    if (!type) return res.status(400).json({ error: '料名必填' });
    if (!/^[0-9A-F]{6}$/.test(hex)) return res.status(400).json({ error: '颜色须为 6 位十六进制' });
    const result = await printerManager.setAmsFilament(pid, slot, type, hex);
    console.log(`[料信息] ${p.name} 槽「${slot}」→ ${type}/${hex} 回读${result.reflected ? '确认' : '未确认'}${result.noAck ? '（无回执）' : ''}`);
    res.json({ success: true, slot, type, colorHex: hex, reflected: result.reflected, noAck: result.noAck });
  } catch (err) {
    console.error('料信息写入失败:', err.message);
    res.status(400).json({ error: err.message });
  }
});

// 速度档（reviewer+）：body {level: 1-4}
app.post('/api/printers/:id/speed', requireUser('reviewer'), async (req, res) => {
  try {
    await printerManager.setSpeedOnPrinter(parseInt(req.params.id), (req.body || {}).level);
    res.json({ success: true });
  } catch (err) {
    console.error('速度档下发失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 风扇（reviewer+）：body {kind: part|aux|chamber, speed: 0-255}
app.post('/api/printers/:id/fan', requireUser('reviewer'), async (req, res) => {
  try {
    const { kind, speed } = req.body || {};
    await printerManager.setFanSpeedOnPrinter(parseInt(req.params.id), kind, speed);
    res.json({ success: true });
  } catch (err) {
    console.error('风扇下发失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// gcode 直控（admin，危险面——页面有红色警示与确认）
app.post('/api/printers/:id/gcode', requireUser('admin'), async (req, res) => {
  try {
    await printerManager.sendGcodeOnPrinter(parseInt(req.params.id), (req.body || {}).line);
    res.json({ success: true });
  } catch (err) {
    console.error('gcode 下发失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 回原点（admin + 仅空闲）
app.post('/api/printers/:id/home', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    await printerManager.homeOnPrinter(id);
    res.json({ success: true });
  } catch (err) {
    console.error('回原点失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 轴移动（admin + 仅空闲）：body {axis: x|y|z, distance: mm 带符号}
app.post('/api/printers/:id/move', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    const { axis, distance } = req.body || {};
    await printerManager.moveAxisOnPrinter(id, axis, distance);
    res.json({ success: true });
  } catch (err) {
    console.error('轴移动失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 校准（admin + 仅空闲）：body {type: 'full'|'level'|'vib'}，缺省全量
app.post('/api/printers/:id/calibrate', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    const type = (req.body || {}).type;
    if (type !== undefined && !['full', 'level', 'vib'].includes(type)) {
      return res.status(400).json({ error: '校准类型必须是 full/level/vib' });
    }
    await printerManager.calibrationOnPrinter(id, type);
    res.json({ success: true, type: type || 'full' });
  } catch (err) {
    console.error('校准失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 退料（admin + 仅空闲）
app.post('/api/printers/:id/unload', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    await printerManager.unloadFilamentOnPrinter(id);
    res.json({ success: true });
  } catch (err) {
    console.error('退料失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// ---------- 设备化扩展（v56）：温度 / AMS / 文件管理 ----------

// 目标温度（reviewer+，打印中可调）：body {kind: 'nozzle'|'bed', deg}
app.post('/api/printers/:id/temp', requireUser('reviewer'), async (req, res) => {
  try {
    const { kind, deg } = req.body || {};
    if (kind === 'nozzle') await printerManager.setNozzleTempOnPrinter(parseInt(req.params.id), deg);
    else if (kind === 'bed') await printerManager.setBedTempOnPrinter(parseInt(req.params.id), deg);
    else return res.status(400).json({ error: 'kind 必须是 nozzle/bed' });
    res.json({ success: true, kind, deg: Number(deg) });
  } catch (err) {
    console.error('温度下发失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// AMS 切槽进料（reviewer+ + 仅空闲——进退料动机械）：body {amsId, trayId}
app.post('/api/printers/:id/ams/switch', requireUser('reviewer'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    const { amsId, trayId } = req.body || {};
    await printerManager.amsChangeFilamentOnPrinter(id, amsId, trayId);
    res.json({ success: true });
  } catch (err) {
    console.error('AMS 切槽失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// /sdcard 文件清单（admin，拓竹 X1/H2D SFTP 通道）
app.get('/api/printers/:id/files', requireUser('admin'), async (req, res) => {
  try {
    const files = await printerManager.listSdcardFilesOnPrinter(parseInt(req.params.id));
    res.json(files);
  } catch (err) {
    console.error('文件列表失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// 删除 /sdcard 文件（admin，危险面）
app.post('/api/printers/:id/files/delete', requireUser('admin'), async (req, res) => {
  try {
    const result = await printerManager.deleteSdcardFileOnPrinter(parseInt(req.params.id), (req.body || {}).name);
    res.json({ success: true, ...result });
  } catch (err) {
    console.error('文件删除失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// /sdcard 文件直接开打（admin + 仅空闲）：body {fileName}——project_file 帧切片参数随文件
app.post('/api/printers/:id/print-sdcard', requireUser('admin'), async (req, res) => {
  const id = parseInt(req.params.id);
  if (!requireIdleForMachine(id, res)) return;
  try {
    const { fileName } = req.body || {};
    const name = String(fileName || '');
    if (!name || /[\\/]/.test(name) || !/\.(3mf|gcode|gx|g)$/i.test(name)) {
      return res.status(400).json({ error: '非法文件名' });
    }
    await printerManager.startProjectOnPrinter(id, name, name);
    res.json({ success: true });
  } catch (err) {
    console.error('sdcard 开打失败:', err);
    res.status(400).json({ error: err.message });
  }
});

// ---------- 打印机画面通道（2026-10-14 纯内网批：观察台画面区） ----------
// 4A 拔线后打印机在 192.168.2.x，主网设备没有 31→2 静态路由的（手机等）看不了
// 直连流——统一走本服务代理，任何 31.x 设备都能看。登录可见（不放匿名面）。

function findApiPrinter(id) {
  return printerManager.getApiStates().find((p) => p.id === id) || null;
}

// 闪铸 MJPEG 代理：打印机 8080 multipart 流原样管道转发（每客户端独立上游，
// 客户端断开即销毁上游连接；上游失败 502——基础款 5M 无摄像头属预期）。
// 2026-10-16 A5P 真机实证：**5M Pro 的摄像头流需显式开启**（streamCtrl_cmd open）——
// 开流前 8080 端口 TCP 通但 HTTP 零响应（此前「画面不可用」的根因）；进入本端点先开流，
// 最后一个观看者断开后关流（streamCtrl_cmd close，省摄像头常开）
const mjpegViewers = new Map(); // printerId → 观看计数
app.get('/api/printers/:id/camera/mjpeg', requireUser(), async (req, res) => {
  const pid = parseInt(req.params.id);
  const p = findApiPrinter(pid);
  if (!p) return res.status(404).json({ error: '打印机不存在' });
  if (p.camera !== 'mjpeg') return res.status(400).json({ error: `该机型画面通道为「${p.camera || '无'}」，不走 MJPEG` });
  if (p.brand === 'flashforge') {
    const client = printerManager.getClient(pid);
    if (client && typeof client.startCameraStream === 'function') {
      try {
        await client.startCameraStream(); // 已在流时重复开流无副作用
        await new Promise((r) => setTimeout(r, 800)); // 相机起流出帧的缓冲窗口
      } catch (err) {
        console.warn(`[画面] ${p.name} 开流指令失败（继续尝试上游直连）:`, err.message);
      }
    }
    mjpegViewers.set(pid, (mjpegViewers.get(pid) || 0) + 1);
    const releaseStream = () => {
      const n = (mjpegViewers.get(pid) || 1) - 1;
      if (n <= 0) {
        mjpegViewers.delete(pid);
        if (client && typeof client.stopCameraStream === 'function') {
          client.stopCameraStream().catch(() => { /* 关流失败不影响观看体验（相机侧自行超时） */ });
        }
      } else {
        mjpegViewers.set(pid, n);
      }
    };
    res.on('close', releaseStream);
  }
  if (p.brand !== 'flashforge') {
    // 拓竹 P1/A1 摄像头（2026-10-17 A1 mini 实机新增）：6000 TLS+认证包 JPEG 帧流 →
    // 服务端重封装 multipart MJPEG（前端与闪铸同走 <img> 直显；~0.5fps 为机器实际出帧
    // 节拍）。每观看客户端独立上游连接，断开即销毁
    const camClient = printerManager.getClient(pid);
    if (!camClient || typeof camClient.openCameraJpegStream !== 'function') {
      return res.status(400).json({ error: `该机型（${p.model}）未实现 6000 帧流通道` });
    }
    let started = false;
    const camStream = camClient.openCameraJpegStream(
      (jpeg) => {
        if (res.writableEnded) return;
        if (!started) {
          started = true;
          res.setHeader('Content-Type', 'multipart/x-mixed-replace; boundary=bambuframe');
          res.setHeader('Cache-Control', 'no-cache');
        }
        res.write(`--bambuframe\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`);
        res.write(jpeg);
        res.write('\r\n');
      },
      (err) => {
        if (!started) res.status(502).json({ error: `画面拉流失败（${p.name}）: ${err.message}` });
        else res.end();
      }
    );
    req.on('close', () => { try { camStream.close(); } catch { /* 已关 */ } });
    return;
  }
  const upstream = http.request(p.cameraUrl, { timeout: 30000 }, (up) => {
    res.setHeader('Content-Type', up.headers['content-type'] || 'multipart/x-mixed-replace; boundary=frame');
    res.setHeader('Cache-Control', 'no-cache');
    up.pipe(res);
    up.on('error', () => res.end());
  });
  upstream.on('timeout', () => upstream.destroy(new Error('上游空闲超时')));
  upstream.on('error', (err) => {
    if (!res.headersSent) res.status(502).json({ error: `画面拉流失败（${p.name}）: ${err.message}` });
    else res.end();
  });
  req.on('close', () => upstream.destroy());
  upstream.end();
});

// 拓竹画面 H.264 中继：P1/A1=TCP 6000 裸流 / X1-H2D=RTSPS 322（rtsps.js 归一 Annex-B）
// → WebSocket 二进制（前端 WebCodecs 解码）。upgrade 不走 express 中间件，cookie 会话在此手动校验
const wssCamera = new WebSocketServer({ noServer: true });
// 每打印机并发观看上限（v56 复查批 + 踢旧迎新修订）：前端泄漏页/多开标签/半开 TCP
// 会按连接数占打印机 RTSP 会话额——超过上限时**踢掉最早的一条**（而非拒绝新连接）：
// 用户点击永远能立即接通，僵尸连接被自然淘汰（2026-10-15 实证：半开连接致 429 间歇拒绝）
const CAMERA_MAX_PER_PRINTER = 3;
const cameraRelays = new Map(); // printerId → [{ ws, upstream, createdAt }]（新→旧序无关，按 createdAt 踢）
function handleCameraUpgrade(req, socket, head) {
  // upgrade 回调抛异常 = 进程级 uncaught（不受 express 错误中间件保护）——整段兜底
  try { handleCameraUpgradeInner(req, socket, head); }
  catch (err) {
    console.error('[画面] upgrade 处理异常:', err.message);
    try { socket.destroy(); } catch { /* 已关 */ }
  }
}
function handleCameraUpgradeInner(req, socket, head) {
  const m = /^\/api\/printers\/(\d+)\/camera\/h264(\?.*)?$/.exec(req.url || '');
  if (!m) { socket.destroy(); return; }
  const user = authStore.resolveSession(parseCookies(req).bambu_session); // 传 token 字符串，传对象恒 401（v55 修复）
  if (!user) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  const p = findApiPrinter(parseInt(m[1]));
  if (!p || (p.camera !== 'p1stream' && p.camera !== 'rtsp')) {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wssCamera.handleUpgrade(req, socket, head, (ws) => {
    const relays = cameraRelays.get(p.id) || [];
    // 踢旧迎新：超上限先关闭最早的一条（僵尸/旧页面被淘汰，新观看永远优先）
    while (relays.length >= CAMERA_MAX_PER_PRINTER) {
      const oldest = relays.reduce((a, b) => (a.createdAt <= b.createdAt ? a : b));
      console.log(`[画面] ${p.name} 中继达上限 ${CAMERA_MAX_PER_PRINTER}，踢除最旧连接（${Math.round((Date.now() - oldest.createdAt) / 1000)}s 前建立）`);
      try { oldest.ws.close(1012, 'replaced by newer viewer'); } catch { /* 已关 */ }
      try { oldest.upstream.destroy(); } catch { /* 已销毁 */ }
      const at = relays.indexOf(oldest);
      if (at >= 0) relays.splice(at, 1);
    }
    const upstream = printerManager.openCameraStream(p.id);
    const entry = { ws, upstream, createdAt: Date.now() };
    relays.push(entry);
    cameraRelays.set(p.id, relays);
    const detach = () => {
      const arr = cameraRelays.get(p.id) || [];
      const at = arr.indexOf(entry);
      if (at >= 0) arr.splice(at, 1);
    };
    upstream.on('data', (chunk) => {
      // 背压保护：慢客户端（浏览器后台标签页）的缓冲超 4MB 就丢帧，防服务端内存被撑爆
      if (ws.readyState !== ws.OPEN) return;
      if (ws.bufferedAmount > 4 * 1024 * 1024) return;
      ws.send(chunk, { binary: true });
    });
    upstream.on('error', (err) => {
      detach();
      try { ws.close(1011, err.message.slice(0, 100)); } catch { /* 已关 */ }
    });
    upstream.on('close', () => {
      detach();
      try { ws.close(1000); } catch { /* 已关 */ }
    });
    ws.on('close', () => { detach(); try { upstream.destroy(); } catch { /* 已销毁 */ } });
    ws.on('error', () => { detach(); try { upstream.destroy(); } catch { /* 已销毁 */ } });
  });
}

// /api/feishu/event 端点已随 2026-10-05 路线 A 退役（审批实例/任务/表格事件不再消费）；
// url_verification 握手随事件订阅一并成为历史。

// 指令端点只应被本机 hub 转发调用（对话铁律：指令唯一入口 = POST /api/chat/command）。
// 2026-10-18 审查：此前无鉴权，内网任意主机可直接驱动打印指令链——改为「本机回环」默认门，
// 跨机调用须带 X-API-Token（与 approval-bot 的 requireApiToken 口径一致，hub 本机调用零改动）
function chatCommandGuard(req, res, next) {
  const ip = String((req.socket && req.socket.remoteAddress) || '');
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  const apiToken = process.env.API_TOKEN;
  const tokenOk = Boolean(apiToken) && safeEqual(req.get('X-API-Token') || '', apiToken);
  if (loopback || tokenOk) return next();
  res.status(403).json({ error: '指令端点仅限本机 hub 转发（跨机调用须带 X-API-Token）' });
}

app.post('/api/chat/command', chatCommandGuard, async (req, res) => {
  try {
    const { command, args } = req.body;

    if (!command) {
      return res.status(400).json({ error: '指令不能为空' });
    }

    const reply = await executeCommand(command, args || []);
    res.json({ reply });
  } catch (err) {
    console.error('处理指令失败:', err);
    res.json({ reply: `❌ 指令执行失败：${err.message}` });
  }
});

// ---------- 分发引擎 ----------

app.get('/api/dispatch/queue', requireUser(), (req, res) => {
  res.json({
    queue: dispatcher.getQueueSnapshot(),
    printing: dispatcher.getPrintingSnapshot(),
    givenUp: dispatcher.listGivenUp(), // 重试耗尽待人工恢复（页面黄条 + 恢复按钮消费）
  });
});

app.post('/api/dispatch/manual', requireUser('reviewer', 'admin'), async (req, res) => {
  try {
    const { recordId, printerName } = req.body;
    if (!recordId || !printerName) {
      return res.status(400).json({ error: 'recordId 和 printerName 不能为空' });
    }
    const result = await dispatcher.manualDispatch(recordId, printerName);
    res.json(result);
  } catch (err) {
    console.error('手动分发失败:', err);
    res.status(500).json({ error: err.message });
  }
});

// multer 校验失败（扩展名白名单/超限）等中间件错误 → 统一 JSON 400（而非默认 500 HTML）
app.use((err, req, res, next) => {
  if (!err) return next();
  console.error('[HTTP] 请求处理失败:', err.message);
  res.status(400).json({ error: err.message || '请求处理失败' });
});

function startServer() {
  const server = app.listen(config.port, () => {
    console.log(`🚀 拓竹3D打印预约系统（自建前后端）运行在 http://localhost:${config.port}`);
    console.log(`📚 API 健康检查: http://localhost:${config.port}/api/health`);
    console.log(`🖨️ 打印机数量: ${config.printers.length}`);
    if (!config.bitable.appToken) console.log('ℹ️ 未配置 BITABLE_APP_TOKEN（路线 A 已不依赖表格，保持空即可）');
  });

  // 打印机画面 WS 中继（拓竹 P1 系 6000 H.264 → 浏览器 WebCodecs；升级请求绕过
  // express 路由，鉴权在 handleCameraUpgrade 内做 cookie 会话校验）
  server.on('upgrade', handleCameraUpgrade);

  // HTTPS 镜像（3443，v56 追加）：WebCodecs 要求 secure context——纯 HTTP 非 localhost
  // 访问时浏览器不暴露 VideoDecoder，画面永远黑屏（2026-10-15 实锤）。自签证书在
  // certs/（不入 git），存在才启用：用户看画面走 https://<ip>:3443，其余功能 HTTP 照旧；
  // 内部调用（gateway/hub 的 localhost:3001）零改动
  try {
    const certDir = path.join(__dirname, '..', 'certs');
    const certFile = process.env.HTTPS_CERT_FILE || path.join(certDir, 'cert.pem');
    const keyFile = process.env.HTTPS_KEY_FILE || path.join(certDir, 'key.pem');
    if (fs.existsSync(certFile) && fs.existsSync(keyFile)) {
      const httpsPort = Number(process.env.HTTPS_PORT || 3443);
      const httpsServer = require('https').createServer(
        { cert: fs.readFileSync(certFile), key: fs.readFileSync(keyFile) },
        app
      );
      httpsServer.on('upgrade', handleCameraUpgrade);
      httpsServer.listen(httpsPort, () => {
        console.log(`🔐 HTTPS 镜像已启用: https://localhost:${httpsPort}（浏览器首访需信任自签证书；画面低延迟链路走此端口）`);
      });
    }
  } catch (err) {
    console.warn('[HTTPS] 镜像启动失败（不影响 HTTP）:', err.message);
  }

  // 2026-10-05 路线 A：startEventSubscription()（审批/表格事件订阅 + 审批对账）已退役；
  // 2026-10-10 修复：当时把 dispatcher.start() 一并弄丢（原挂在事件订阅启动里），
  // 分发引擎此后从未启动——队列恢复、jobEvent 完成收尾/失败重排/份数续打、幽灵巡检、
  // 退出冲刷全是死代码，且被「真机未接入 + 桩测试直调方法」双重掩盖。这里接回。
  require('./services/dispatcher').start();

  // 晚间静默：启动时若有积压通知，按当前时点调度补发（过点立即、未过点等到窗口结束整点）
  require('./utils/quietHours').initQuietHoursFlush();

  // 上传源文件生命周期：启动清一轮 + 每 6h 一轮（终态单超保留期的源文件，0=禁用）
  const retentionCleanup = () => {
    try {
      const r = reservationStore.cleanupExpiredUploads();
      if (r.removed > 0) console.log(`[存储维护] 已清理 ${r.removed} 个过期上传源文件`);
    } catch (err) {
      console.warn('[存储维护] 清理失败:', err.message);
    }
  };
  retentionCleanup();
  setInterval(retentionCleanup, 6 * 3600 * 1000);

  // 数据面每日快照（预约/账号/规则/建议四 JSON，保留 14 天；uploads 不备份）
  require('./services/backup').scheduleBackup();

  process.on('SIGINT', async () => {
    console.log('\n正在关闭服务器...');
    await printerManager.cleanupFileSessions();
    server.close(() => {
      console.log('服务器已关闭');
      process.exit(0);
    });
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = app;
module.exports.startServer = startServer; // 桩测试/运维脚本用（生产走 require.main 分支）
