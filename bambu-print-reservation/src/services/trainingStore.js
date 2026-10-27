// ============================================================
// 训练集样本库（2026-10-12 曼波定：直上训练集，录入即入库，无审批）
//
// 一条样本 = 三方合成：
//   模型特征（自动几何体检）× 工况特征（人工勾选，标注金标准）
//   × 专家切片参数（从已切片产物提取）
// 训练集是资产不是状态：文件归档到 bambu-data/training/files（push 清目录不丢），
// 样本索引默认项目根 .training-samples.json（TRAINING_SAMPLES_FILE 可改）。
// 无审批环节——录入人即标注权威（曼波本人），删除留 reviewer+ 门槛。
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const taxonomy = require('./taxonomy');

const FILE = process.env.TRAINING_SAMPLES_FILE || path.join(__dirname, '..', '..', '.training-samples.json');
const FILES_DIR = process.env.TRAINING_FILES_DIR || 'C:/home/qianli/bambu-data/training/files';

/** 几何家族 id（2026-10-18 LOFO 防泄漏）：几何特征量化签名——同一件的重复提交/多次标注
 *  归同族。量化：bbox 0.1mm、体积 1cm³、孔数、曲面占比整数——浮点噪声不拆族；
 *  特征缺失（老样本）退化为文件名族，宁粗勿细（同族误并只是少分一组，不会造成泄漏） */
function familyOf(features, fallbackName) {
  const f = features || {};
  if (f.bbox && Number(f.bbox.x) > 0) {
    const sig = [
      Math.round(Number(f.bbox.x) * 10),
      Math.round(Number(f.bbox.y) * 10),
      Math.round(Number(f.bbox.z) * 10),
      Math.round((Number(f.volume) || 0) / 1000),
      Number(f.holes && f.holes.count) || 0,
      Math.round(Number(f.curvedPct) || 0),
    ].join('|');
    return 'fam-' + crypto.createHash('md5').update(sig).digest('hex').slice(0, 10);
  }
  return 'fam-name-' + String(fallbackName || 'unknown').toLowerCase().trim();
}

function load() {
  try {
    if (!fs.existsSync(FILE)) return [];
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return Array.isArray(data.samples) ? data.samples : [];
  } catch (err) {
    // 样本是资产：损坏隔离另存，防下一次 save 静默覆盖（对齐 reservationStore 的 .corrupt-<ts> 口径）
    const quarantine = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(FILE, quarantine); console.error(`[训练集] 样本库损坏已隔离 → ${quarantine}`); }
    catch (mv) { console.error('[训练集] 样本库损坏且隔离失败（下次 save 将覆盖！）:', err.message, '|', mv.message); }
    return [];
  }
}

function save(samples) {
  const tmp = FILE + '.tmp';
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), samples }, null, 2));
  fs.renameSync(tmp, FILE);
}

function md5(buf) { return crypto.createHash('md5').update(buf).digest('hex'); }

/** 归档文件到训练资产目录，返回 {storedPath, size, md5}；超限只记元数据不落盘 */
function archiveFile(id, kind, originalName, buf, maxBytes) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const safe = String(originalName || 'file').replace(/[^\w.-]+/g, '_').slice(-60);
  const rec = { name: String(originalName || ''), size: buf.length, md5: md5(buf), storedPath: null };
  if (buf.length <= maxBytes) {
    rec.storedPath = path.join(FILES_DIR, `${id}-${kind}-${safe}`);
    fs.writeFileSync(rec.storedPath, buf);
  } else {
    rec.tooLargeToArchive = true;
  }
  return rec;
}

const trainingStore = {
  FILE,
  FILES_DIR,

  /**
   * 录入一条训练样本（无审批，直接入库）。
   * @param {Object} input
   *   createdBy, notes,
   *   model:  { originalName, buffer, features }  必填（features=几何体检结果，允许 ok:false）
   *   slice:  { originalName, buffer, extraction } 可空（extraction=slicerExtract 结果）
   *   selection: 人工工况勾选（taxonomy 标准化），至少 1 项
   */
  create(input) {
    const selection = input.selection || {};
    const selKeys = Object.keys(selection);
    if (selKeys.length === 0) throw new Error('工况勾选不能为空——没有人工标注的样本不构成训练数据');

    const gate = taxonomy.validateSelection(selection, { material: input.materialType || '' });
    if (gate.errors.length > 0) {
      const err = new Error(gate.errors.join('；'));
      err.details = { errors: gate.errors };
      throw err;
    }

    const samples = load();
    const now = new Date().toISOString();
    const dateTag = now.slice(0, 10).replace(/-/g, '');
    // 序号取当日**最大号+1**（原 count+1 在删除过样本后会重号，覆盖历史 id 引用）
    const maxSeq = samples.reduce((max, s) => {
      const m = new RegExp(`^T${dateTag}-(\\d+)$`).exec(String(s.id || ''));
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const id = `T${dateTag}-${String(maxSeq + 1).padStart(3, '0')}`;

    // 文件归档（模型必存，切片可选存；超 80MB 只记元数据）
    const MAX_ARCHIVE = 80 * 1024 * 1024;
    let modelRec = null;
    if (input.model && input.model.buffer) {
      modelRec = archiveFile(id, 'model', input.model.originalName, input.model.buffer, MAX_ARCHIVE);
      modelRec.kind = /\.3mf$/i.test(input.model.originalName || '') ? '3mf' : 'stl';
    }
    let sliceRec = null;
    if (input.slice && input.slice.buffer && input.slice.buffer.length > 0) {
      sliceRec = archiveFile(id, 'slice', input.slice.originalName, input.slice.buffer, MAX_ARCHIVE);
      sliceRec.kind = '3mf';
    }
    // 同产物去重（2026-10-16 审批入库）：3mf 直通单的「模型」与「切片」是同一份文件，
    // 归档一次两处引用（省每样本一份文件体积）；切片侧仍带 extraction 供训练消费
    if (modelRec && sliceRec && modelRec.md5 === sliceRec.md5) {
      try { if (sliceRec.storedPath && sliceRec.storedPath !== modelRec.storedPath) fs.unlinkSync(sliceRec.storedPath); } catch { /* 已不存在 */ }
      sliceRec.storedPath = modelRec.storedPath;
      sliceRec.dedupFrom = 'model';
    }

    const record = {
      id,
      createdAt: now,
      createdBy: String(input.createdBy || ''),
      // 源单引用（2026-10-16 审批入库链）：预约单号——打印完成/失败时按此回填 outcome
      sourceRecordId: String(input.sourceRecordId || '').slice(0, 64),
      // 机型隔离（2026-10-12 曼波：多品牌机队，工艺链路按机型隔离；几何链路全机通用）
      machine: String(input.machine || '').trim(),
      // 几何家族 id（2026-10-18 LOFO 防泄漏）：同件多次提交/多标注归同族，拟合评估按族留出
      family: familyOf(input.model && input.model.features, input.model && input.model.originalName),
      notes: String(input.notes || '').slice(0, 500),
      // 人工标注（金标准）
      selection,
      // 空间工况标注（3D 标注工房：人直接在模型上点选复杂几何特征，修正几何链路盲区）
      spatial: Array.isArray(input.spatial) ? input.spatial.slice(0, 200) : [],
      // 放置平面四元数（2026-10-16）：标注坐标在放置后的朝向帧里，此值即换算桥
      placement: Array.isArray(input.placement) && input.placement.length === 4 ? input.placement.map(Number) : null,
      // 专家摆向标签（2026-10-19 学习回路）：quaternion=[x,y,z,w] + 来源。
      // 预约的 Place on Face 是人工强标签；专家 3mf 变换是弱标签；烘焙型切片无标签。
      orientation: (() => {
        const o = input.orientation;
        if (!o || !Array.isArray(o.quaternion) || o.quaternion.length !== 4 || o.quaternion.some((v) => !Number.isFinite(Number(v)))) return null;
        return {
          quaternion: o.quaternion.map(Number),
          source: String(o.source || 'unknown').slice(0, 32),
          note: o.note ? String(o.note).slice(0, 200) : '',
        };
      })(),
      materialType: String(input.materialType || '').trim(),
      // 自动几何特征（原样存档；ok:false 也存——负样本也是数据）
      model: modelRec ? { ...modelRec, features: input.model.features || null } : null,
      // 专家切片参数（从切片产物提取）
      slice: sliceRec ? { ...sliceRec, extraction: input.slice.extraction || null } : null,
      // 几何体检当时的自动建议（将来训「自动 vs 人工」一致性用）
      autoSuggestion: (input.model && input.model.features && input.model.features.suggestions) || null,
      // 几何特征来源（2026-10-16）：'auto'=3mf 直通单全自动提取（配合低权重 confidence 判读）；空=常规录入
      featureSource: String(input.featureSource || '').slice(0, 32),
      // 人工可信度（0-100，训练加权用；与自动拟合度 fit 分离）——3mf 直通自动提取样本按低权重落 40
      confidence: Number.isFinite(Number(input.confidence)) ? Math.max(0, Math.min(100, Math.round(Number(input.confidence)))) : null,
      // 拟合度快照（2026-10-12 曼波纠正语义：引擎(工况)参数 vs 专家(切片)参数的贴合程度，
      // 差异项=可被记忆的参数——知识库覆盖缺口直接度量）
      fit: input.fit || null,
    };
    samples.push(record);
    save(samples);
    return { ...record };
  },

  /** 几何特征回填/重提取（2026-10-16 修复工具）：老样本因解析缺口特征未提取——按归档模型重算 */
  setFeatures(id, { features, autoSuggestion, featureSource, confidence } = {}) {
    const samples = load();
    const s = samples.find((x) => x.id === id);
    if (!s) throw new Error(`样本不存在: ${id}`);
    if (s.model) s.model.features = features || null;
    if (autoSuggestion !== undefined) s.autoSuggestion = autoSuggestion || null;
    if (featureSource) s.featureSource = featureSource;
    if (Number.isFinite(Number(confidence)) && s.confidence == null) s.confidence = Math.min(100, Math.max(0, Math.round(Number(confidence))));
    save(samples);
    return { ...s };
  },

  /** 按源单回填打印结果（2026-10-16 审批入库链）：dispatcher 完成/失败钩子调用；无对应样本返回 null */
  setOutcomeBySource(sourceRecordId, outcome) {
    const s = load().find((x) => x.sourceRecordId === String(sourceRecordId || ''));
    if (!s) return null;
    return this.setOutcome(s.id, outcome);
  },

  /**
   * 自举摆向标签回填（2026-10-27 特征标签批）：自动摆向打印成功 = 该朝向经现实验证——
   * 把实际生效摆向（autoSlice 返回的 orientation，含候选轴 p/s）转成四元数记弱标签
   * （source=auto-confirmed，fitter 低权重防偏见强化）。人工/专家标签优先：已有
   * orientation 或 placement 时不覆盖。无对应样本返回 null（未入库单不强行入库）。
   */
  setOrientationBySource(sourceRecordId, orientation) {
    const s = load().find((x) => x.sourceRecordId === String(sourceRecordId || ''));
    if (!s) return null;
    if (s.orientation || (Array.isArray(s.placement) && s.placement.length === 4)) {
      return { skipped: true, reason: '已有更强标签（专家/人工），自举不覆盖', id: s.id };
    }
    const q = orientation && Array.isArray(orientation.quaternion) ? orientation.quaternion : null;
    if (!q || q.length !== 4 || q.some((v) => !Number.isFinite(Number(v)))) {
      throw new Error('orientation.quaternion 必须是 [x,y,z,w]');
    }
    s.orientation = {
      quaternion: q.map(Number),
      source: String(orientation.source || 'auto-confirmed').slice(0, 32),
      note: orientation.note ? String(orientation.note).slice(0, 200) : '',
    };
    save(load().map((x) => (x.id === s.id ? s : x)));
    return { ok: true, id: s.id, orientation: s.orientation };
  },

  /**
   * 切片统计标签回填（2026-10-27 特征标签批）：estMinutes=切片预估时长、
   * actualMinutes=首件实际耗时、filamentGrams=切片产物申报用量——训练侧校准
   * 时间/耗材模型的原始素材。仅记结构化数字，缺失维度传 null 即不覆盖。
   */
  setSliceStatsBySource(sourceRecordId, stats) {
    const s = load().find((x) => x.sourceRecordId === String(sourceRecordId || ''));
    if (!s) return null;
    const next = {
      estMinutes: Number.isFinite(Number(stats && stats.estMinutes)) && Number(stats.estMinutes) > 0 ? Number(stats.estMinutes) : (s.sliceStats && s.sliceStats.estMinutes) || null,
      actualMinutes: Number.isFinite(Number(stats && stats.actualMinutes)) && Number(stats.actualMinutes) > 0 ? Number(stats.actualMinutes) : (s.sliceStats && s.sliceStats.actualMinutes) || null,
      filamentGrams: Number.isFinite(Number(stats && stats.filamentGrams)) && Number(stats.filamentGrams) > 0 ? Number(stats.filamentGrams) : (s.sliceStats && s.sliceStats.filamentGrams) || null,
      machine: String((stats && stats.machine) || (s.sliceStats && s.sliceStats.machine) || '').slice(0, 40),
      recordedAt: new Date().toISOString(),
    };
    s.sliceStats = next;
    save(load().map((x) => (x.id === s.id ? s : x)));
    return { ok: true, id: s.id, sliceStats: s.sliceStats };
  },

  list() {
    // 老样本（family 字段上线前）按特征即时派生族 id——非破坏性，不写回
    return load().slice().reverse().map((s) => (s.family ? s : { ...s, family: familyOf(s.model && s.model.features, s.model && s.model.originalName) }));
  },
  get(id) { return load().find((s) => s.id === id) || null; },

  /** 回填打印结果（学习信号的奖励通道：成功/失败/问题样本要分开对待） */
  setOutcome(id, outcome) {
    const samples = load();
    const sample = samples.find((s) => s.id === id);
    if (!sample) throw new Error(`样本不存在: ${id}`);
    const status = String(outcome && outcome.status || '');
    if (!['未打印', '成功', '失败', '部分成功'].includes(status)) {
      throw new Error('outcome.status 必须是 未打印/成功/失败/部分成功 之一');
    }
    sample.outcome = {
      status,
      issues: String(outcome && outcome.issues || '').slice(0, 500),
      failCode: Number.isFinite(Number(outcome && outcome.failCode)) ? Number(outcome.failCode) : null, // 结构化失败码（HMS/fail_reason，2026-10-27 特征标签批）
      recordedAt: new Date().toISOString(),
      recordedBy: String(outcome && outcome.recordedBy || ''),
    };
    save(samples);
    return { ...sample };
  },

  remove(id) {
    const samples = load();
    const idx = samples.findIndex((s) => s.id === id);
    if (idx < 0) throw new Error(`样本不存在: ${id}`);
    const [removed] = samples.splice(idx, 1);
    save(samples);
    // 归档文件保留（训练资产不因索引删除而丢；人工清理走 bambu-data/training/files）
    return removed;
  },

  stats() {
    const samples = load();
    return {
      total: samples.length,
      withSlice: samples.filter((s) => s.slice).length,
      withFeatures: samples.filter((s) => s.model && s.model.features && s.model.features.ok).length,
      withOutcome: samples.filter((s) => s.outcome && s.outcome.status && s.outcome.status !== '未打印').length,
      conditionCoverage: samples.reduce((acc, s) => {
        for (const k of Object.keys(s.selection || {})) acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    };
  },

  /** 训练管线消费格式：一行一样本的 JSONL（含 outcome 奖励通道与机型隔离） */
  dumpJsonl() {
    return load().map((s) => JSON.stringify({
      id: s.id,
      createdAt: s.createdAt,
      machine: s.machine || null,
      selection: s.selection,
      spatial: s.spatial || [],
      materialType: s.materialType,
      modelFeatures: s.model && s.model.features ? { bbox: s.model.features.bbox, holes: s.model.features.holes, overhang: s.model.features.overhang, contact: s.model.features.contact, curvedPct: s.model.features.curvedPct, volumeCm3: s.model.features.volumeCm3 } : null,
      autoSuggestion: s.autoSuggestion ? s.autoSuggestion.selection : null,
      expertParams: s.slice && s.slice.extraction ? s.slice.extraction.params : null,
      paramDiff: s.slice && s.slice.extraction ? s.slice.extraction.diff : null,
      estMinutes: s.slice && s.slice.extraction ? s.slice.extraction.estMinutes : null,
      fit: s.fit ? { score: s.fit.score, matches: s.fit.matches, total: s.fit.total } : null,
      confidence: Number.isFinite(Number(s.confidence)) ? Number(s.confidence) : null,
      featureSource: s.featureSource || null,
      outcome: s.outcome || { status: '未打印' },
      modelFile: s.model ? s.model.storedPath : null,
    })).join('\n') + '\n';
  },
};

module.exports = trainingStore;
module.exports.familyOf = familyOf;
