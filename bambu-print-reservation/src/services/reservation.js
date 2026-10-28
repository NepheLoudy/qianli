const config = require('../config');
const fs = require('fs');
const path = require('path');
const store = require('./reservationStore');
const processRules = require('./processRules');
const { sendMessage, buildReservationAlertCard, buildReviewResultCard, buildApprovedQueuedCard } = require('../feishu/bot');
const quietHours = require('../utils/quietHours');
const { isUnslicedFileName } = require('../utils/fileTypes');

/** 未切片文件判定（2026-10-06 审查批；v56 起正则唯一权威在 utils/fileTypes）：
 *  需求链路单（stl/step/obj）不能直接驱动真机——打印机只认切片产物。
 *  切片产物口径（2026-10-14 双品牌批扩）=拓竹 3mf + 闪铸 gcode 系（g/gcode/gx） */
function isUnslicedFile(reservation) {
  return !!reservation && isUnslicedFileName(reservation.fileName);
}
const UNSLICED_HINT = '该单是未切片模型（stl/step）——请先切片后重新提交：拓竹机请用 Bambu Studio 切片为 3mf，闪铸机请用 FlashPrint/Orca（闪铸 profile）切片为 gcode（服务端自动切片上线前，需求链路单暂不支持直接分发）';

// ============================================================
// 预约服务（2026-10-05 路线 A 本地化改造）：
//   真相源 = reservationStore（本地 JSON 存储），不再读写多维表格镜像、
//   不再依赖审批实例事件；飞书仅剩群 webhook 播报（通知通道，非数据依赖）。
//   旧镜像表记录转换（formatReservation）保留，兼容状态文件里的历史任务与
//   /print-dispatch 对遗留单据的定位。
// 注意：本模块被 dispatcher.js 依赖，对 dispatcher 的引用必须惰性 require（避免循环加载）
// ============================================================

class ReservationService {
  // ---------- 查询（全部走本地存储） ----------

  getAllReservations() {
    return Promise.resolve(store.list());
  }

  getReservationById(id) {
    return Promise.resolve(store.get(id));
  }

  async getPendingReviewReservations() {
    return store.list().filter((r) => r.status === config.status.PENDING_REVIEW);
  }

  async getPrintingReservations() {
    return store.list().filter((r) => r.status === config.status.PRINTING);
  }

  async getCompletedReservations() {
    return store.list().filter((r) => r.status === config.status.COMPLETED);
  }

  // ---------- 提交（index.js 的上传端点在落盘文件后调用） ----------

  createReservation(input) {
    return Promise.resolve(store.create(input));
  }

  /** 提交后提醒审批人（群播卡片；3mf 直通单附内嵌参数摘要——审批透明化） */
  async notifyReviewers(reservation) {
    try {
      const embedLine = reservation.embeddedParams?.params
        ? [{
            tag: 'markdown',
            content: `**内嵌参数**: ${Object.entries(reservation.embeddedParams.params).slice(0, 8)
              .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(' · ')}`,
          }]
        : [];
      const card = buildReservationAlertCard({
        fields: {
          '发起人': [{ id: '', name: reservation.applicant }],
          '发起时间': reservation.createdAt,
          '切片文件': [{ name: reservation.fileName }],
          '是否加急': reservation.isUrgent,
          [config.dispatch.materialField]: reservation.materialType,
          [config.dispatch.colorField]: reservation.color,
        },
      }, embedLine);
      if (!quietHours.gatePayload('webhook-card', card, `预约审批提醒卡 ${reservation.id}`)) {
        await sendMessage(card, config.bot.approvalWebhookUrl || undefined); // 「有人预约需要审批」走话题群专用钩子（2026-10-16 曼波令）
      }
    } catch (err) {
      console.error('[预约服务] 通知审批人失败:', err.message);
    }
  }

  // ---------- 审批（管理动作，端点侧挂 X-API-Token） ----------

  /**
   * 审批通过：状态流转 + 群播结果卡 + 入队（本地任务，fileSource=local）。
   * dispatch（2026-10-16 曼波令「审批人应能选槽位/喷嘴」）：
   *   { assignedPrinter?: name, tray?: {slot}, trays?: [{slot}|null,...], nozzleId?: number }——都可空（空=自动匹配，保持原能力）。
   *   trays 为多耗材逐条指定（2026-10-16 曼波令「文件里有几个耗材就有几个栏位」）：与文件用料
   *   逐条对齐，null=该条自动匹配；tray 为单槽旧路径（首条映射，多色其余自动）。
   *   指定值**审批时硬校验**（打印机在册/槽位实装/喷头存在），fail 即 400 不落审批。
   * sampleEntry（2026-10-16 曼波令「审批做两件事」之①决定要不要进样本库）：
   *   勾选即异步建训练样本（未打印态）——打印完成/失败后由分发引擎按源单回填真实结果。
   */
  async approveReservation(id, reviewer, comment, dispatch = {}, sampleEntry = false) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');
    // 显式状态门槛：仅「待审批」可批。不能只依赖状态机——排队中→已通过是
    // 分发失败回滚的合法流转，放行会让已入队的单被重复审批（2026-10-05 测试暴露）
    if (reservation.status !== config.status.PENDING_REVIEW) {
      throw new Error(`预约当前状态「${reservation.status}」，仅待审批单可审批`);
    }
    // 未切片文件闸（2026-10-18 改造，曼波令「模型勾选份数要自动排版」）：拓竹目标改由
    // 分发链自动切片（份数=盘内多件一次成型）；闪铸目标仍需预先切好 gcode——指定闪铸
    // 机时当场拦，其余放行（分发时刻 autoSlice 按勾选参数与份数切片）
    if (isUnslicedFile(reservation)) {
      const target = dispatch.assignedPrinter ? config.printers.find((p) => p.name === dispatch.assignedPrinter) : null;
      if (target && (require('../printer/manager').brandOf(target.model) || 'bambu') === 'flashforge') {
        throw new Error(`「${reservation.fileName}」是未切片模型——${target.name} 为闪铸机型，需预先切好 gcode 再提交（拓竹机型可审批后自动切片）`);
      }
    }

    // 分发配置硬校验（指定即权威，但不放行明显无效值）
    const printerManager = require('../printer/manager');
    // 切片直通件必须显式指定打印机（2026-10-28 曼波令「自动分发只对纯 step 有效」）：
    // 切片文件内嵌机型锁死切片 profile，留空自动匹配=品牌级瞎配（A1 mini 的件落 X1C）
    // ——审批时打回，让审批人从同型号机中指定
    if (!dispatch.assignedPrinter && !isUnslicedFile(reservation)) {
      throw new Error(`「${reservation.fileName}」是切片文件（内嵌机型锁定切片 profile）——自动分发仅对模型直投（STEP/STL）有效，请从登记打印机中指定同型号机后再审批`);
    }
    const pref = {};
    if (dispatch.assignedPrinter) {
      const pr = config.printers.find((p) => p.name === dispatch.assignedPrinter);
      if (!pr) throw new Error(`指定打印机「${dispatch.assignedPrinter}」未登记`);
      // 品牌相容性硬校验（2026-10-16 曼波反馈「选 A5P 却被分到 X1C」）：切片格式与机型
      // 品牌互不兼容——审批时当场拦住并说明，杜绝「静默改派/打废件」
      const prBrand = printerManager.brandOf(pr.model) || 'bambu';
      console.log('[DBG-BRAND]', pr.name, '|', pr.model, '|', prBrand, '| file:', reservation.fileName);
      const fileBrand = require('./dispatcher').brandForFileWithMeta(reservation.fileName, reservation.embeddedParams && reservation.embeddedParams.machineModel); // 内嵌机型优先（2026-10-16）
      if (prBrand !== fileBrand) {
        throw new Error(`「${pr.name}」是${prBrand === 'flashforge' ? '闪铸' : '拓竹'}机型，打不了${fileBrand === 'flashforge' ? '闪铸 gcode 系' : '拓竹 3mf'}格式的文件——两品牌切片格式互不兼容。请改选对应品牌机型、留空自动匹配，或用目标机型的切片软件重新导出`);
      }
      // 机型相容硬校验（2026-10-28 曼波令「自动分发只对纯 step 有效」）：切片文件内嵌机型
      // 锁定切片 profile——指定同品牌但错型号（A1 mini 的件指到 X1C）同样机端 preset 不匹配。
      // modelKey 归一（去品牌前缀、adventurer→ad 缩写）后互含判等；无内嵌机型（老文件/提取
      // 失败）跳过不拦。与审批台 modelKey 前端版同口径，改一处记得两处
      const embeddedModel = reservation.embeddedParams && reservation.embeddedParams.machineModel;
      if (!isUnslicedFile(reservation) && embeddedModel) {
        const modelKey = (x) => String(x || '').toLowerCase()
          .replace(/^(bambu lab|flashforge)\s+/, '')
          .replace(/^adventurer\s+/, 'ad')
          .trim();
        const a = modelKey(embeddedModel);
        const b = modelKey(pr.model);
        const compatible = a && b && (a.includes(b) || b.includes(a));
        if (!compatible) {
          throw new Error(`切片文件内嵌机型「${embeddedModel}」，与指定的「${pr.name}」（${pr.model}）不同型号——切片 profile 已锁死，跨型号打印会机端拒收/参数错配。请指定${embeddedModel}对应的登记机，或用「${pr.model}」重新切片后提交`);
        }
      }
      pref.assignedPrinter = dispatch.assignedPrinter;
      const apiState = printerManager.getApiStates().find((p) => p.id === pr.id);
      const trays = (apiState && apiState.ams) || [];
      // 槽位名 → 实时料位 id 解析（2026-10-16）：前端只传槽位名，amsId/trayId 以服务端
      // 料位清单为准（外挂料盘 ams_id=254/255、AMS 槽 ams_id=单元号/槽位），防两侧口径漂移
      const resolveTray = (slotRaw, labelPrefix) => {
        const wantSel = String(slotRaw || '').trim();
        if (!wantSel) return null;
        const hit = trays.find((t) => t.slot === wantSel) || null;
        if (!hit) {
          throw new Error(`${labelPrefix || ''}槽位「${wantSel}」在 ${pr.name} 上不存在或未实装（可选：${trays.map((t) => t.slot).join('、') || '无料站信息'}）`);
        }
        return {
          amsId: Number.isInteger(hit.amsId) ? hit.amsId : 0,
          trayId: Number.isInteger(hit.trayId) ? hit.trayId : 0,
          slot: hit.slot,
        };
      };
      // 多耗材（2026-10-16 曼波令「文件里有几个耗材审批界面就有几个栏位」）：trays 与文件用料
      // 逐条对齐——该条留空的（null）分发时按该条用料类型/颜色自动匹配，逐条可混用
      if (Array.isArray(dispatch.trays) && dispatch.trays.some((t) => t && String(t.slot || '').trim())) {
        pref.trays = dispatch.trays.map((t, i) => resolveTray(t && t.slot, `用料 ${i + 1} 的`));
      } else if (dispatch.tray && String(dispatch.tray.slot || '').trim()) {
        pref.tray = resolveTray(dispatch.tray.slot, '');
      }
      if (dispatch.nozzleId !== undefined && dispatch.nozzleId !== null && dispatch.nozzleId !== '') {
        const apiState = printerManager.getApiStates().find((p) => p.id === pr.id);
        const nozzles = (apiState && apiState.nozzles) || [];
        const nid = Number(dispatch.nozzleId);
        if (nozzles.length < 2) throw new Error(`${pr.name} 非多喷头机型，无法指定喷嘴`);
        if (!nozzles.some((n) => n.id === nid)) throw new Error(`喷头 ${nid + 1} 不存在于 ${pr.name}`);
        pref.nozzleId = nid;
        // 展示名（H2D 左右口径，2026-10-16 实锤）：id0=左（外挂料盘）、id1=右（AMS）
        const nz = nozzles.find((n) => n.id === nid);
        pref.nozzleLabel = nz && nz.side === 'left' ? '左喷嘴（外挂料盘）'
          : nz && nz.side === 'right' ? '右喷嘴（AMS）'
          : `喷头${nid + 1}`;
      }
    }
    // 用料指定摘要：多耗材逐条「序号→槽位/自动」（2026-10-16）；单槽沿旧格式
    const trayNote = Array.isArray(pref.trays)
      ? `·用料 ${pref.trays.map((t, i) => `${i + 1}→${t ? t.slot : '自动'}`).join(' ')}`
      : pref.tray ? `·${pref.tray.slot}` : '';
    const prefNote = pref.trays || pref.tray || pref.nozzleId || pref.assignedPrinter
      ? `｜分发指定：${pref.assignedPrinter || '自动机'}${trayNote}${pref.nozzleId != null ? '·' + (pref.nozzleLabel || `喷头${pref.nozzleId + 1}`) : ''}`
      : '';
    const sampleNote = sampleEntry ? '｜📚 已勾选入库训练样本' : '';

    store.updateStatus(id, config.status.REVIEW_APPROVED, `审批人：${reviewer || '未署名'}${comment ? `｜意见：${comment}` : ''}${prefNote}${sampleNote}`);
    store.setReview(id, {
      reviewer: reviewer || '',
      comment: comment || '',
      result: config.reviewResult.APPROVED,
      dispatch: (pref.assignedPrinter || pref.tray || pref.trays || pref.nozzleId != null) ? pref : null, // 审批分发指定（审计+复刻参考）
    });

    // 入队关键路径内不得有 await（v56 竞态修复）：JS 单线程，无 await 即无取消插窗。
    // 此前 await 群播卡在「已通过落库」与「入队」之间开了窗口——用户取消可合法插队
    // （已通过→已取消），恢复执行后照常入队+写排队中失败，最终「已取消单真机开打」。
    const dispatcher = require('./dispatcher');
    const fresh = store.get(id);
    const task = dispatcher.buildLocalTask(fresh);
    if (pref.assignedPrinter) task.assignedPrinter = pref.assignedPrinter;
    if (pref.tray) task.prefTray = pref.tray;
    if (pref.trays) task.prefTrays = pref.trays; // 多耗材逐条指定（null=该条自动，2026-10-16）
    if (pref.nozzleId != null) task.prefNozzleId = pref.nozzleId;
    const enqueued = dispatcher.enqueue(task, { silent: true }); // 排队卡并入审批合并卡（2026-10-16 曼波令）
    if (!enqueued) {
      // 幂等命中（known/queue 已有该单）——不再静默滞留「已通过」
      throw new Error('该任务已在分发队列中（幂等拦截），请刷新列表核对单据状态');
    }
    store.updateStatus(id, config.status.QUEUED, '已进入打印队列');
    // 审批结果+排队合成一张卡（2026-10-16）：位次取排序后快照（加急在前）
    const snapEntry = dispatcher.getQueueSnapshot().find((t) => t.recordId === id);

    // 审批入库（2026-10-16 曼波令）：勾选即建训练样本（未打印态）——打印完成/失败后由
    // 分发引擎按源单回填真实 outcome（学习奖励通道）。setImmediate 异步执行：文件读+几何
    // 体检为秒级 CPU 工作，绝不进审批-入队关键路径（入队无 await 的竞态约束保持）
    if (sampleEntry) {
      store.setSample(id, { sampleEntry: true, at: new Date().toISOString() });
      const snapshot = store.get(id);
      setImmediate(async () => {
        try {
          const sample = await createSampleFromReservation(snapshot, reviewer);
          store.setSample(id, { sampleId: sample.id });
          console.log(`[预约服务] 审批入库：${id} → 样本 ${sample.id}`);
        } catch (err) {
          console.warn(`[预约服务] 审批入库失败 ${id}: ${err.message}`);
          try { store.setSample(id, { sampleError: err.message }); } catch { /* 记录失败不阻塞 */ }
        }
      });
    }

    // 群播移出入队关键路径：notifyReviewResult 自带 try/catch 永不 reject，此处仅触发不等待
    this.notifyReviewResult(store.get(id), config.reviewResult.APPROVED, comment, { ahead: snapEntry ? snapEntry.position - 1 : null });

    return store.get(id);
  }

  async rejectReservation(id, reviewer, comment) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');
    if (reservation.status !== config.status.PENDING_REVIEW) {
      throw new Error(`预约当前状态「${reservation.status}」，仅待审批单可驳回`);
    }

    store.updateStatus(id, config.status.REVIEW_REJECTED, `审批人：${reviewer || '未署名'}${comment ? `｜意见：${comment}` : ''}`);
    store.setReview(id, { reviewer: reviewer || '', comment: comment || '', result: config.reviewResult.REJECTED });
    await this.notifyReviewResult(reservation, config.reviewResult.REJECTED, comment);

    return store.get(id);
  }

  async notifyReviewResult(reservation, result, comment, queueInfo = null) {
    // 审批结果卡停发（2026-10-28 曼波令「机械组播报仅保留打印成功」补漏）：此前走
    // sendMessage 直发机械组主群、绕过 announce 过滤——代批一单群里多一张卡。审批是
    // 审批人自己的操作（结果页面立即可见，申请人看列表状态），无需群播回执。
    // 提单审批提醒（notifyReviewers→审批话题群）是审批人的工作入口，不受此令影响
    return;
  }

  // ---------- 取消 ----------

  async cancelReservation(id) {
    const reservation = store.get(id);
    if (!reservation) throw new Error('预约记录不存在');

    store.updateStatus(id, config.status.CANCELLED, '取消预约');
    const dispatcher = require('./dispatcher');
    dispatcher.dequeue(id); // 队列中/分发中/打印中（停机）统一由 dequeue 处理

    return { success: true };
  }

  // ---------- 复刻（2026-10-08：已完成单一键带参重提，打坏了重打/帮同学打同款） ----------

  /**
   * 从既有记录复制提交一份新预约（新单号、发起人=当前登录者）。
   * 源文件在保留期内 → 服务端直接复制文件（浏览器无需重传 200MB）；
   * 需求链路单按当前规则库**重新定档**（规则库可能已演进），3mf 直通单保持快照为空。
   * overrides 可覆盖 color/quantity/assignedPrinter/materialType/isUrgent
   */
  async reprintReservation(id, requester, overrides = {}) {
    const src = store.get(id);
    if (!src) throw new Error('预约记录不存在');
    if (src.fileCleaned) throw new Error('源文件已过保留期被清理，请重新上传模型文件');

    // 服务端复制源文件（复刻单与源单生命周期独立：源单日后清理不影响复刻单）
    const ext = path.extname(src.fileName || '') || '.3mf';
    const newPath = path.join(store.UPLOAD_DIR, `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    try {
      fs.mkdirSync(store.UPLOAD_DIR, { recursive: true });
      await fs.promises.copyFile(src.filePath, newPath);
    } catch (err) {
      throw new Error(`源文件已不存在（${err.code === 'ENOENT' ? '可能已过保留期清理' : err.message}），请重新上传模型文件`);
    }

    const pick = (key, fallback) => (overrides[key] !== undefined && overrides[key] !== null && overrides[key] !== ''
      ? overrides[key] : fallback);
    const materialType = pick('materialType', src.materialType);
    const isSliced = /\.3mf$/i.test(String(src.fileName || ''));

    let applied = null;
    if (!isSliced) {
      applied = processRules.applyRules(src.selection || {}, { material: materialType });
      if (applied.blocked) {
        try { fs.unlinkSync(newPath); } catch { /* 已不存在 */ }
        const err = new Error('需求勾选存在硬冲突（规则库可能已更新）');
        err.details = { errors: applied.errors, warnings: applied.warnings };
        throw err;
      }
    }

    let record;
    try {
      record = store.create({
        applicant: requester.displayName,
        submittedBy: requester.id,
        fileName: src.fileName,
        filePath: newPath,
        fileSize: src.fileSize,
        materialType,
        color: pick('color', src.color),
        assignedPrinter: pick('assignedPrinter', src.assignedPrinter),
        isUrgent: pick('isUrgent', src.isUrgent),
        quantity: pick('quantity', src.quantity),
        estMinutes: src.estMinutes,
        selection: src.selection || {},
        spatial: src.spatial || null, // 3D 标注随复刻单携带（同几何同工况）
        processParams: applied ? applied.params : null,
        appliedRules: applied ? applied.applied : [],
        embeddedParams: src.embeddedParams, // 3mf 直通单参数摘要随单携带
      });
    } catch (err) {
      try { fs.unlinkSync(newPath); } catch { /* 已不存在 */ }
      throw err;
    }
    return store.get(record.id);
  }

  // ---------- 遗留兼容 ----------

  /** 旧镜像表记录 → 展示形态（历史数据/状态文件遗留任务用；不再有新镜像单） */
  formatReservation(record) {
    const fields = record.fields || {};
    const sliceFile = fields['切片文件'] && fields['切片文件'].length > 0 ? fields['切片文件'][0] : null;

    return {
      recordId: record.record_id,
      applicationNo: fields['申请编号'],
      status: fields['申请状态'] || config.status.PENDING_REVIEW,
      startTime: fields['发起时间'],
      applicant: fields['发起人'] ? {
        id: fields['发起人'][0]?.id,
        name: fields['发起人'][0]?.name,
      } : null,
      isInternalProject: fields['是否为千里内部项目'],
      fileName: sliceFile?.name,
      fileToken: sliceFile?.file_token,
      fileUrl: sliceFile?.url,
      screenshot: fields['切片文件详情截图'],
      isUrgent: fields['是否加急'],
      materialType: fields[config.dispatch.materialField] || '',
      color: fields[config.dispatch.colorField] || '',
      assignedPrinter: fields[config.dispatch.printerField] || '',
      createdAt: record.created_time,
      updatedAt: record.updated_time,
    };
  }
}

const reservationService = new ReservationService();

/**
 * 预约单 → 训练样本（2026-10-16 曼波令「审批做两件事」之①）：与手工录入三方合成同构——
 * 几何特征（体检快照优先，否则现算）× 人工标注（selection + spatial）× 本单实际参数
 * （3mf 直通=内嵌切片提取；需求链路=引擎定档参数以小 JSON 归档）。
 * 同步执行（调用方 setImmediate 异步化）；失败抛错由调用方按失败软着陆记录 sampleError。
 */
// 3mf 直通样本的几何特征全自动提取（无人工核验）——额外低权重置信度（曼波 2026-10-16 令，训练消费按低权对待）
const AUTO_FEATURE_CONFIDENCE = 40;

async function createSampleFromReservation(record, reviewer) {
  const fs = require('fs');
  if (!record) throw new Error('预约记录不存在');
  const is3mf = /\.3mf$/i.test(record.fileName || '');
  const buf = record.filePath ? fs.readFileSync(record.filePath) : null;
  if (!buf || buf.length === 0) throw new Error('源文件不可读（filePath 缺失或为空）');
  let features = record.modelFeatures || null;
  let featureSource = 'auto'; // 3mf 直通：几何特征全自动（含网格→网格分析；切片导出件无网格→gcode 估计）
  let slice = null;
  // CAD 源文件配对（2026-10-27 曼波令「两个齐活视为一次训练素材」）：切片导出 3mf 本身
  // 无内嵌网格（29 条直通件实证），真几何特征从配对的 STEP/STL 源提取——模型归档一并换
  // 源文件（fitter loadSampleMesh 支持 step/stl，几何家族/摆向学习全链路吃到真网格）；
  // 提取失败回退切片件口径，不阻塞入库
  let meshBuf = buf;
  let meshName = record.fileName || 'model';
  if (record.sourceFile && record.sourceFile.storedPath) {
    try {
      const sb = fs.readFileSync(record.sourceFile.storedPath);
      const mf = require('./modelFeatures');
      const extM = /\.([a-z0-9]+)$/i.exec(record.sourceFile.originalName || '') || [];
      const ext = (extM[1] || '').toLowerCase();
      const analyzed = ext === 'stl' ? mf.analyzeStl(sb)
        : (ext === 'step' || ext === 'stp') ? await mf.analyzeStep(sb, record.sourceFile.originalName)
        : mf.analyze3mf(sb);
      if (analyzed && analyzed.ok) {
        features = analyzed;
        featureSource = 'auto';
        meshBuf = sb;
        meshName = record.sourceFile.originalName || meshName;
        console.log(`[训练入库] ${record.id} 配对源文件真网格特征：${meshName}`);
      } else {
        console.warn(`[训练入库] ${record.id} 配对源文件体检未通过（${(analyzed && analyzed.reason) || '未知'}），回退切片件口径`);
      }
    } catch (err) {
      console.warn(`[训练入库] ${record.id} 配对源文件读取/解析失败，回退切片件口径: ${err.message}`);
    }
  }
  // 专家摆向标签（2026-10-19 学习回路）：Place on Face 四元数优先；3mf 有对象变换则弱标签
  let orientation = null;
  if (Array.isArray(record.placement) && record.placement.length === 4) {
    orientation = { quaternion: record.placement.map(Number), source: 'placement' };
  } else if (is3mf) {
    try {
      const ex = require('./orientationExtract').extractOrientationFrom3mf(buf);
      if (ex && !ex.identity) orientation = { quaternion: ex.quaternion, source: ex.source, note: `角度 ${ex.angleDeg}°` };
    } catch { /* 提取失败不影响入库 */ }
  }
  if (is3mf) {
    let extraction = null;
    try { extraction = require('./slicerExtract').extractFrom3mf(buf); } catch { /* 提取失败仍入库 */ }
    if (!features) {
      try {
        const fr = require('./modelFeatures').featuresFromSliced3mf(buf);
        features = fr.features;
        featureSource = fr.featureSource; // 'auto'（网格分析）| 'gcode-estimate'（切片件估计）
      } catch { /* 体检失败照常入库 */ }
    }
    slice = {
      originalName: record.fileName || 'slice.3mf',
      buffer: buf,
      extraction: extraction
        ? { source: extraction.source, params: extraction.params, estMinutes: extraction.estMinutes, filaments: extraction.filaments, bedType: extraction.bedType }
        : null,
    };
  } else if (record.processParams && Object.keys(record.processParams).length > 0) {
    // 需求链路：引擎定档参数即本单实际参数（无切片产物）——小 JSON 归档，训练消费口径同 extraction
    slice = {
      originalName: 'engine-params.json',
      buffer: Buffer.from(JSON.stringify({ params: record.processParams, appliedRules: record.appliedRules || [] }, null, 2)),
      extraction: { source: 'engine', params: record.processParams, appliedRules: record.appliedRules || [] },
    };
  }
  return require('./trainingStore').create({
    createdBy: reviewer || '审批入库',
    notes: `审批入库 · 源单 ${record.id}`,
    sourceRecordId: record.id,
    // 几何特征权重（2026-10-16 曼波令）：3mf 直通单的特征**只能全自动提取**（无人工核验环节）
    // ——标记 featureSource='auto' 并赋予额外低权重置信度（40），训练消费按低权对待
    ...(is3mf ? { featureSource, confidence: AUTO_FEATURE_CONFIDENCE } : {}), // featureSource: 'auto'（网格分析）| 'gcode-estimate'（切片件估计）
    selection: record.selection || {},
    spatial: record.spatial || [],
    placement: record.placement || null,
    orientation, // 专家摆向标签（学习回路）
    materialType: record.materialType || '',
    model: { originalName: meshName, buffer: meshBuf, features },
    slice,
  });
}

module.exports = reservationService;
/**
 * 切片件提交初审（2026-10-28 曼波令「程序初审」）：3mf 上传即解析内嵌机型与用料清单——
 *   ① 机队无同型号登记机 → 禁止提交（内嵌机型锁死切片 profile，交了也打不了）；
 *   ② 同型号机端无对应耗材（逐条用料 type 对该机料位 exact/family 匹配，任意一台满足
 *      全部用料即可）→ 禁止提交；同型号机状态全部失联时降级为警告（料位不可信不误杀）；
 *   ③ 目标机占用/持闸 → 告知将排队（放行不拦）。
 * modelKey 与审批台前端/审批校验同口径（去品牌前缀、adventurer→ad，互含判等）——三处同款，改一处记得三处。
 * @param {{machineModel:string|null, filaments:Array<{type:string}>, printers:Array, apiStates:Array, queueInfo:{printing:string[], holdPrinterIds:string[], queueLength:number}}} input
 * @returns {{blocked:boolean, errors:string[], warnings:string[], targets:string}}
 */
function precheckSlicedSubmission(input = {}) {
  const errors = [];
  const warnings = [];
  const machineModel = input.machineModel;
  if (!machineModel) return { blocked: false, errors, warnings, targets: '' }; // 无内嵌机型：初审跳过（老文件/提取失败，不误杀）
  const modelKey = (x) => String(x || '').toLowerCase().replace(/^(bambu lab|flashforge)\s+/, '').replace(/^adventurer\s+/, 'ad').trim();
  const want = modelKey(machineModel);
  const targets = (input.printers || []).filter((p) => {
    const b = modelKey(p.model);
    return b && (want.includes(b) || b.includes(want));
  });
  if (!targets.length) {
    errors.push(`机队中没有「${machineModel}」同型号登记机——切片文件已锁定机型，提交了也无法分发；请用机队现有机型重新切片后再提交`);
    return { blocked: true, errors, warnings, targets: '' };
  }
  const targetNames = targets.map((p) => p.name).join('、');
  // 耗材初审：逐条用料对该机实时料位匹配；状态失联/料位空的机器不参与判定（不误杀）
  const lists = Array.isArray(input.filaments) ? input.filaments.filter((f) => f && f.type) : [];
  if (lists.length) {
    const states = input.apiStates || [];
    // 与 dispatcher.materialMatch 同口径（exact/家族前缀软匹配）——本地实现避免 require
    // dispatcher（其模块 init 会连生产打印机，轻量消费方/单测 require reservation 即被拖连）
    const materialMatch = (required, trayType) => {
      const a = String(required || '').trim().toUpperCase();
      const b = String(trayType || '').trim().toUpperCase();
      if (!a || !b) return false;
      if (a === b) return 'exact';
      if (b.startsWith(a + '-') || a.startsWith(b + '-')) return 'family';
      return false;
    };
    const verdicts = targets.map((p) => {
      const st = states.find((s) => String(s.id) === String(p.id));
      if (!st || st.stateStale || !Array.isArray(st.ams) || !st.ams.some((t) => t.type)) return { p, ok: null };
      const ok = lists.every((f) => st.ams.some((t) => materialMatch(String(f.type).toUpperCase(), t.type)));
      return { p, ok };
    });
    const anyTrusted = verdicts.some((v) => v.ok !== null);
    if (anyTrusted && !verdicts.some((v) => v.ok === true)) {
      const missing = lists.map((f) => f.type).join('、');
      errors.push(`同型号机（${targetNames}）机端料位没有本件所需耗材（${missing}）——请先上料，或用机端现有料型重新切片后再提交`);
      return { blocked: true, errors, warnings, targets: targetNames };
    }
    if (!anyTrusted) warnings.push(`同型号机（${targetNames}）状态失联，耗材初审跳过——以审批与分发时刻实况为准`);
  }
  // 占用告知（放行）：目标机打印中/持闸 → 提示将排队
  const qi = input.queueInfo || {};
  const busy = targets.some((p) => (qi.printing || []).includes(p.name))
    || (qi.holdPrinterIds || []).some((pid) => targets.some((t) => String(t.id) === String(pid)));
  if (busy) {
    warnings.push(`同型号机（${targetNames}）当前占用中，本件提交后将进入队列（当前队列 ${Number(qi.queueLength) || 0} 单）——已正常受理`);
  }
  return { blocked: false, errors, warnings, targets: targetNames };
}

module.exports.createSampleFromReservation = createSampleFromReservation;
module.exports.precheckSlicedSubmission = precheckSlicedSubmission;
