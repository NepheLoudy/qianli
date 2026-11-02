'use strict';

/**
 * 参数模型存档（v60）：candidate（训练产出待采纳）/ active（已采纳生效）双槽，
 * 语义对齐 orientationPolicyStore——训练不生效，admin adopt 才落地；
 * adopt 可选 shadow（建议只透出审批台）/ active（真实修正参数）两种生效模式。
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.PARAM_MODEL_FILE || path.join(__dirname, '..', '..', '.param-model.json');
const MODES = ['shadow', 'active'];

let _cache = null; // {mtimeMs, state} 进程内读缓存（v83）：每次提交 getActive 全量 JSON.parse
                   // 随模型体积增长成热点；写路径 save() 即失效，外部直改靠 mtime 失配剔除。
                   // 约定：本模块的变更函数一律以 save() 收尾（缓存一致性前提）

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const st = fs.statSync(FILE);
    if (_cache && _cache.mtimeMs === st.mtimeMs) return _cache.state;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    const state = data && typeof data === 'object' ? data : {};
    _cache = { mtimeMs: st.mtimeMs, state };
    return state;
  } catch (err) {
    // v62 口径对齐（v83）：仅 JSON 损坏才隔离改名——瞬时 fs 错误（EPERM/EBUSY，杀软扫描）
    // 上抛保留现场，防把好档误隔离后 saveCandidate 以空态覆盖抹掉 active 槽
    if (!(err instanceof SyntaxError)) throw err;
    const quarantine = `${FILE}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try { fs.renameSync(FILE, quarantine); console.error(`[参数模型] 存档损坏已隔离 → ${quarantine}`); }
    catch { /* 隔离失败按空启动 */ }
    _cache = null;
    return {};
  }
}

function save(state) {
  const tmp = `${FILE}.tmp`;
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...state }, null, 2));
  fs.renameSync(tmp, FILE);
  _cache = null; // 写后失效，下次 load 重读新档
}

module.exports = {
  FILE,
  MODES,
  /** 训练产出 → candidate 槽（不生效） */
  saveCandidate(model, stats) {
    const state = load();
    state.candidate = { model, stats, savedAt: new Date().toISOString() };
    save(state);
    return { ok: true, version: model.version, savedAt: state.candidate.savedAt };
  },
  /** 采纳 candidate → active（mode=shadow|active）；无 candidate 报错 */
  adopt({ mode = 'shadow', adoptedBy = '' } = {}) {
    if (!MODES.includes(mode)) throw new Error(`mode 必须是 ${MODES.join('/')}`);
    const state = load();
    if (!state.candidate || !state.candidate.model) throw new Error('无候选模型——先训练（POST /api/training/param-model/fit）');
    state.active = {
      model: state.candidate.model,
      stats: state.candidate.stats,
      mode,
      adoptedAt: new Date().toISOString(),
      adoptedBy: String(adoptedBy || '').slice(0, 64),
    };
    delete state.candidate;
    save(state);
    return { ok: true, version: state.active.model.version, mode, adoptedAt: state.active.adoptedAt };
  },
  /** 调整已采纳模型的生效模式（shadow↔active），不重训 */
  setMode(mode) {
    if (!MODES.includes(mode)) throw new Error(`mode 必须是 ${MODES.join('/')}`);
    const state = load();
    if (!state.active || !state.active.model) throw new Error('无已采纳模型');
    state.active.mode = mode;
    save(state);
    return { ok: true, version: state.active.model.version, mode };
  },
  /** 当前生效模型（消费端取用）；无则 null */
  getActive() {
    const state = load();
    return state.active && state.active.model ? state.active : null;
  },
  getSnapshot() {
    const state = load();
    return {
      candidate: state.candidate ? {
        version: state.candidate.model.version, stats: state.candidate.stats, savedAt: state.candidate.savedAt,
        mlp: state.candidate.model.mlp ? { arch: state.candidate.model.mlp.arch, nNets: state.candidate.model.mlp.nNets, importance: state.candidate.model.mlp.importance } : null,
      } : null,
      active: state.active ? {
        version: state.active.model.version, mode: state.active.mode,
        adoptedAt: state.active.adoptedAt, adoptedBy: state.active.adoptedBy,
        stats: state.active.stats,
        choices: state.active.model.choices,
        mlp: state.active.model.mlp ? { arch: state.active.model.mlp.arch, nNets: state.active.model.mlp.nNets, importance: state.active.model.mlp.importance } : null,
      } : null,
    };
  },
  /** 下线已采纳模型（消费端立即回退规则库口径） */
  deactivate() {
    const state = load();
    if (!state.active) return { ok: true, note: '本就无生效模型' };
    delete state.active;
    save(state);
    return { ok: true };
  },
};
