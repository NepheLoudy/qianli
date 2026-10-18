// ============================================================
// 工艺映射规则库（processRules）——「勾选 → 规则引擎 → 切片」体系的第二层
//
// 分层（与 taxonomy.js 的分工，2026-10-05 定稿口径）：
//   taxonomy.js   = 需求标签词汇表（用户勾什么），版本 TAXONOMY_VERSION
//   processRules.js = 标签 → 切片参数映射（勾了怎么切），版本 = 规则集内容 hash
//   两者版本号独立，共同进切片产物缓存 key（+ baseline/CLI 版本 = 四件套）
//
// 应用语义：
//   规则按 priority 升序应用（小者先铺、大者后覆盖）——同名参数冲突时
//   priority 大者赢，不另做参数冲突检测（标签级冲突由 taxonomy.validateSelection
//   在 applyRules 入口统一拦截，规则库不重复裁判）
// ============================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const taxonomy = require('./taxonomy');
const { FEATURE_NAMES } = require('./featureDerive');

// ---------- 参数白名单（切片器 CLI 可消费的核心参数，映射目标全集） ----------
const BASELINE = {
  directionStrategy: 'auto',   // auto | avoid-z-load | keep（打印朝向策略）
  layerHeight: 0.2,            // mm
  wallLoops: 2,                // 墙数（周壁圈数）
  topShellLayers: 4,           // 顶面实心层数
  bottomShellLayers: 3,        // 底面实心层数
  infillDensity: 20,           // %
  infillPattern: 'cubic',      // cubic | gyroid | grid | lines
  supportType: 'auto',         // none | auto
  supportThresholdAngle: 30,   // ° 悬垂角阈值（超过才加支撑；越大支撑越少）
  supportDensity: 25,          // % 支撑结构密度
  speedProfile: 'normal',      // precise | normal | fast
  seamPosition: 'aligned',     // aligned | hidden | nearest
  xyHoleComp: 0,               // mm（孔径补偿，负=缩小）
  xyContourComp: 0,            // mm（外轮廓补偿）
  ironing: false,
  brim: false,
  brimWidth: 0,                // mm 裙边宽度（brim=true 时生效）
  temperatureDelta: 0,         // °C 热床温度相对材料默认（层间强化用）
  nozzleTempDelta: 0,          // °C 喷嘴温度相对材料默认（层间粘结/外观微调）
  materialExclude: [],         // 字符串 regex 源（如 '^PLA'），命中即排除该材料
  materialPrefer: [],          // 同上，命中优先选用
};
const PARAM_NAMES = Object.keys(BASELINE);
// 数组型参数（append 而非覆盖？否——覆盖语义统一，规则里自己写全量数组；此处仅标记类型供校验）
const ARRAY_PARAMS = new Set(['materialExclude', 'materialPrefer']);

// ---------- 出厂种子规则（翻译自 taxonomy 各标签的 mapsHint；文件覆盖后仍可 reset 恢复） ----------
let RULE_SEQ = 0;
const seed = (id, priority, when, set, reason) => ({ id, priority, when, set, reason, builtin: true });
const DEFAULT_RULES = [
  seed('z-load-orient', 10, { load_direction: ['Z'] },
    { directionStrategy: 'avoid-z-load', layerHeight: 0.16, temperatureDelta: 5 },
    'Z 向受力≈沿层缝受力：优先改打印朝向避开层间；同时加密层高+热床 +5°C 强化层间粘结'),
  seed('multi-load-walls', 10, { load_direction: ['multi'] },
    { wallLoops: 4 },
    '多向受力不强行改朝向，按强度档补墙'),
  seed('shear-bend-structure', 20, { load_type: ['shear', 'bending'] },
    { wallLoops: 4, infillDensity: 40, infillPattern: 'cubic' },
    '剪切/弯曲载荷：墙承担弯矩、填充支撑腹板'),
  seed('torsion-gyroid', 20, { load_type: ['torsion'] },
    { infillPattern: 'gyroid' },
    '扭转工况：Gyroid 连续路径抗扭优于直线栅格'),
  seed('contact-pa', 20, { load_type: ['contact'] },
    { materialPrefer: ['PA'], infillDensity: 60 },
    '滚压/点接触：表面接触应力大，PA 系耐磨 + 接触区提高密实度'),
  seed('fatigue-gyroid', 25, { load_nature: ['fatigue'] },
    { infillPattern: 'gyroid', speedProfile: 'precise' },
    '动载疲劳：Gyroid 无直线应力集中路径；精密档降速减少内部缺陷'),
  seed('impact-tough', 25, { load_nature: ['impact'] },
    { materialPrefer: ['PETG'], wallLoops: 4, bottomShellLayers: 4 },
    '冲击载荷：韧性系材料吸能（CF 脆性不宜），加墙+底面加厚抗冲击剥离'),
  seed('vibration-gyroid', 25, { load_nature: ['vibration'] },
    { infillPattern: 'gyroid' },
    '振动工况：Gyroid 均匀阻尼、避开薄壁共振向填充'),
  seed('load-light', 30, { load_magnitude: ['light'] },
    { infillDensity: 20, wallLoops: 2 }, '轻载档：低填充薄墙够用，省料省时'),
  seed('load-medium', 30, { load_magnitude: ['medium'] },
    { infillDensity: 40, wallLoops: 3 }, '中载档：常规结构件强度基准'),
  seed('load-heavy', 30, { load_magnitude: ['heavy'] },
    { infillDensity: 60, wallLoops: 4, topShellLayers: 5, bottomShellLayers: 4 },
    '重载档：高填充+厚墙+顶底加实（表面下陷/压溃先发生在薄壳顶底）'),
  seed('temp-exclude-pla', 40, { temp_class: ['t80'] },
    { materialExclude: ['^PLA'] },
    '耐温 50–80°C 档：排除 PLA 系（60°C 即软化），PETG 起步；≥80°C 需求走人工评审（2026-10-16 曼波令移除高温档）'),
  seed('insulation-exclude-cf', 45, { electrical_insulation: [true] },
    { materialExclude: ['CF', '碳'] },
    '电气绝缘件禁用碳纤增强材料（碳纤维导电，安全级排除；与 taxonomy 硬拦截双保险）'),
  seed('creep-exclude-pla', 45, { service_life: ['long_term'], load_nature: ['static'] },
    { materialExclude: ['^PLA'], temperatureDelta: 5 },
    '长期静载：PLA 蠕变重灾区，排除并微升温床强化层间；与 taxonomy 硬拦截双保险'),
  seed('flexible-soft', 50, { deflection_scale: { max: -2 } },
    { materialExclude: ['CF', '碳'], infillDensity: 15, speedProfile: 'precise', supportDensity: 15 },
    '柔顺弹性件（标尺 ≤-2）：排除 CF（脆）、低填充留变形余量、精密档保证细节、疏支撑便于脱弹臂'),
  seed('rigid-cf-prefer', 50, { deflection_scale: { min: 2 } },
    { materialPrefer: ['CF'] }, '高刚度件（标尺 ≥+2）：优先 CF 增强系'),
  // 材料特性 → 耗材选择策略（2026-10-18 曼波令：本组只映射选料倾向，不改切片参数）
  seed('trait-self-lubricating', 60, { material_traits: ['self_lubricating'] },
    { materialPrefer: ['PA'] }, '自润滑/低摩擦：优先 PA 系（自润滑、滑动配合面友好）'),
  seed('trait-fiber-reinforced', 60, { material_traits: ['fiber_reinforced'] },
    { materialPrefer: ['CF'] }, '含纤维增强：优先 CF 增强系（高刚性/尺寸稳定；提示硬化喷嘴抗磨）'),
  seed('trait-wear-resistant', 60, { material_traits: ['wear_resistant'] },
    { materialPrefer: ['PA', 'PETG'] }, '高耐磨：耐磨序列 PA>PETG>PLA，优先 PA/PETG'),
  seed('trait-conductive', 60, { material_traits: ['conductive'] },
    { materialPrefer: ['CF'] }, '导电/抗静电：碳系增强导电（CF 系）；与电气绝缘互斥（taxonomy 硬拦截）'),
  seed('fit-precision-comp', 55, { fit_class: ['interference', 'precision'] },
    { xyHoleComp: -0.15, speedProfile: 'precise', supportThresholdAngle: 45 },
    '配合/精密面：孔径负补偿+外壁降速保尺寸；支撑阈值放宽减少配合面支撑疤'),
  seed('interlock-fit', 55, { fastener: ['printed_interlock'] },
    { xyHoleComp: -0.1, supportThresholdAngle: 45 },
    '打印件自配合（插接/卡扣）：插接面预留间隙（孔销负补偿）、配合面支撑避让，防插不进'),
  seed('fastener-walls', 55, { fastener: ['self_tapping', 'heatset_insert'] },
    { wallLoops: 3 },
    '螺钉/嵌件连接：孔周需 ≥2 圈实壁，全局墙数抬到 3 保底'),
  // 几何体检种子（2026-10-11，模型特征自拟合；priority 60 = 让位显式外观/重载勾选，压过默认档）
  // 注（2026-10-15 曼波定原则）：**学习型工艺因果一律动态拟合**——从「优秀切片样本 ×
  // 其几何特征」（featureDerive 产出）统计得出，经待审池采纳后进本规则库（ruleFitter.js）。
  // 孔补偿等因果不得手写（本轮曾短暂误加三条已撤，保留此注防再犯）。
  seed('overhang-support', 60, { overhang_heavy: [true] },
    { supportType: 'auto', supportDensity: 30 },
    '模型检出重悬空/悬端：支撑加密到 30%；悬端过高朝向不合理时转人工确认摆向'),
  seed('curved-surface-care', 60, { curved_surface: [true] },
    { supportThresholdAngle: 40, speedProfile: 'precise' },
    '模型曲面占比高：支撑阈值放宽减少曲面支撑疤、外壁降速保光顺（接触/外观语义请补勾对应标签）'),
  seed('small-footprint-brim', 60, { small_footprint: [true] },
    { brim: true, brimWidth: 5 },
    '模型贴底接触面小：加 5mm 裙边防倾倒防翘边'),
  seed('appearance-fine', 100, { appearance: [true] },
    { layerHeight: 0.12, seamPosition: 'hidden', speedProfile: 'precise', ironing: true,
      topShellLayers: 5, bottomShellLayers: 4, supportThresholdAngle: 45, nozzleTempDelta: 5 },
    '外观件：细层高+隐藏接缝+外壁慢速+熨烫；顶底加实防透光/下陷；支撑阈值放宽避支撑痕；喷嘴 +5°C 提光泽层间粘结'),
  seed('weight-light', 110, { weight_sensitive: [true] },
    { infillDensity: 15, infillPattern: 'gyroid', topShellLayers: 3, bottomShellLayers: 3 },
    '重量敏感：低填充+Gyroid 减重、顶底壳减层（壳厚是减重大头）'),
  seed('fast-mode-coarse', 200, { fast_mode: [true] },
    { layerHeight: 0.28, speedProfile: 'fast', supportDensity: 15 },
    '高速打印：粗层高+高速档换工期、支撑稀疏化省时（priority 最高后应用——用户显式选快，覆盖外观层高；taxonomy 已警告确认）'),
];

// ---------- 规则校验（引用自洽：字段必须在 taxonomy 池内、参数必须在白名单内） ----------
function validateRule(rule) {
  const problems = [];
  if (!rule || typeof rule !== 'object') return ['规则不是对象'];
  if (!rule.id || typeof rule.id !== 'string') problems.push('缺 id');
  if (!Number.isFinite(rule.priority)) problems.push('缺 priority（数字）');
  if (!rule.when || typeof rule.when !== 'object' || Object.keys(rule.when).length === 0) problems.push('when 为空');
  if (!rule.set || typeof rule.set !== 'object' || Object.keys(rule.set).length === 0) problems.push('set 为空');
  if (!rule.reason || String(rule.reason).length < 4) problems.push('缺 reason（可审计要求）');

  if (rule.when) {
    for (const [fieldId, cond] of Object.entries(rule.when)) {
      // feat.* = 派生特征（featureDerive.js）：校验键在已知特征清单内（池内字段走 taxonomy）
      if (fieldId.startsWith('feat.')) {
        const fname = fieldId.slice(5);
        // annot_* = 空间标注工具计数（deriveFeatures 动态产出，任意工具名合法）；其余查固定清单
        if (!fname.startsWith('annot_') && !FEATURE_NAMES.includes(fname)) { problems.push(`when 引用了未知派生特征 ${fieldId}`); continue; }
      } else {
        const field = taxonomy.groups.flatMap((g) => g.fields).find((f) => f.id === fieldId);
        if (!field) { problems.push(`when 引用了池外字段 ${fieldId}`); continue; }
      }
      const isEnum = Array.isArray(cond) && cond.length > 0;
      const isRange = cond && typeof cond === 'object' && !Array.isArray(cond)
        && (cond.min !== undefined || cond.max !== undefined);
      if (!isEnum && !isRange) problems.push(`when.${fieldId} 应为非空数组或 {min,max} 范围`);
    }
  }
  if (rule.set) {
    for (const [param, value] of Object.entries(rule.set)) {
      if (!PARAM_NAMES.includes(param)) { problems.push(`set 引用了白名单外参数 ${param}`); continue; }
      if (ARRAY_PARAMS.has(param)) {
        if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) problems.push(`set.${param} 应为字符串数组`);
      } else if (param === 'layerHeight') {
        if (!(Number(value) >= 0.08 && Number(value) <= 0.32)) problems.push('set.layerHeight 超出 0.08–0.32');
      } else if (param === 'wallLoops') {
        if (!(Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 6)) problems.push('set.wallLoops 应为 1–6 整数');
      } else if (param === 'infillDensity' || param === 'supportDensity') {
        if (!(Number(value) >= 0 && Number(value) <= 100)) problems.push(`set.${param} 超出 0–100`);
      } else if (param === 'topShellLayers' || param === 'bottomShellLayers') {
        if (!(Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 10)) problems.push(`set.${param} 应为 1–10 整数`);
      } else if (param === 'supportThresholdAngle') {
        if (!(Number(value) >= 10 && Number(value) <= 60)) problems.push('set.supportThresholdAngle 超出 10–60°');
      } else if (param === 'brimWidth') {
        if (!(Number(value) >= 0 && Number(value) <= 10)) problems.push('set.brimWidth 超出 0–10mm');
      } else if (param === 'temperatureDelta' || param === 'nozzleTempDelta') {
        if (!(Number(value) >= -20 && Number(value) <= 20)) problems.push(`set.${param} 超出 ±20°C`);
      }
    }
  }
  return problems;
}

// ---------- 规则存储：内置种子 + 外部文件覆盖（PROCESS_RULES_FILE，部署不丢；热改即写回） ----------
// 2026-10-18 种子增量同步（P0 框架修正）：文件一旦存在就整体替代内置种子，导致「代码新增
// 种子到不了线上」——改为**按 id 合并**：文件缺的内置种子自动补入；手动删除内置记入
// removedBuiltins 墓碑（不复活）；upsert 同 id 视为重新启用（清墓碑）。
const RULES_FILE = process.env.PROCESS_RULES_FILE || path.join(__dirname, '..', '..', '.process-rules.json');

function loadRulesFromFile() {
  try {
    if (!fs.existsSync(RULES_FILE)) return null;
    const data = JSON.parse(fs.readFileSync(RULES_FILE, 'utf-8'));
    if (!Array.isArray(data.rules)) throw new Error('rules 不是数组');
    return { rules: data.rules, removed: Array.isArray(data.removedBuiltins) ? data.removedBuiltins : [] };
  } catch (err) {
    // 损坏隔离（对齐 reservationStore/authStore 口径）：留档后再按出厂种子启动，
    // 否则下一条规则保存会把人工调过的规则集整体覆盖（无备份可救）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      fs.renameSync(RULES_FILE, `${RULES_FILE}.corrupt-${stamp}`);
      console.error(`[规则库] 规则文件损坏已隔离到 ${RULES_FILE}.corrupt-${stamp}，回退出厂种子（${err.message}）`);
    } catch {
      console.warn('[规则库] 规则文件加载失败且隔离失败，回退出厂种子:', err.message);
    }
    return null;
  }
}

let removedBuiltins = new Set();

function saveRules(rules) {
  try {
    const tmp = RULES_FILE + '.tmp';
    fs.mkdirSync(path.dirname(RULES_FILE), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({
      savedAt: new Date().toISOString(),
      rules,
      removedBuiltins: [...removedBuiltins],
    }, null, 2));
    fs.renameSync(tmp, RULES_FILE);
    return true;
  } catch (err) {
    console.warn('[规则库] 规则文件保存失败（内存态仍生效）:', err.message);
    return false;
  }
}

const stripBuiltin = (r) => ({ ...r, builtin: false });
const withSeqId = (r) => (r.id ? r : { ...r, id: `rule-${Date.now()}-${++RULE_SEQ}` });

const DEFAULT_RULES_BY_ID = new Set(DEFAULT_RULES.map((r) => r.id));

/** 文件规则 + 缺失内置种子合并（墓碑保护；同 id 以文件为准——保留人工编辑） */
function mergeSeeds(file) {
  const have = new Set(file.rules.map((r) => r.id));
  const merged = file.rules.slice();
  for (const seed of DEFAULT_RULES) {
    if (have.has(seed.id) || file.removed.includes(seed.id)) continue;
    merged.push(seed);
  }
  return merged.sort((a, b) => a.priority - b.priority);
}

const fileState = loadRulesFromFile();
let rules;
if (fileState) {
  removedBuiltins = new Set(fileState.removed);
  rules = mergeSeeds(fileState);
} else {
  rules = DEFAULT_RULES.slice().sort((a, b) => a.priority - b.priority);
}

/** 规则集版本：内容 hash 短码（进切片产物缓存 key；规则一改即变） */
function rulesVersion() {
  const hash = crypto.createHash('md5').update(JSON.stringify(rules)).digest('hex');
  return `r-${hash.slice(0, 8)}`;
}

// ---------- 应用引擎 ----------
// 条件值：数组=枚举（multi 任一命中）；{min,max}=数值范围（标尺类字段，如挠度标尺）
// feat.* 前缀 = 派生特征（featureDerive.js 产出：孔轴向/孔径/悬垂%/空间标注计数等），
// 让「Z 向孔 → XY 孔补偿」这类空间因果可被规则条件引用（2026-10-15 曼波令）
function whenMatches(when, selection, feat = {}) {
  return Object.entries(when).every(([fieldId, cond]) => {
    const isFeat = fieldId.startsWith('feat.');
    const v = isFeat ? feat[fieldId.slice(5)] : selection[fieldId];
    if (Array.isArray(cond)) {
      if (Array.isArray(v)) return v.some((x) => cond.includes(x));
      return cond.includes(v);
    }
    if (cond && typeof cond === 'object') {
      const n = Number(v);
      if (!Number.isFinite(n)) return false;
      if (cond.min !== undefined && n < cond.min) return false;
      if (cond.max !== undefined && n > cond.max) return false;
      return true;
    }
    return false;
  });
}

/**
 * 标签勾选 → 切片参数集。
 * @param {Object} selection taxonomy 标准化勾选（fieldId → value）
 * @param {Object} [opts] opts.material 材料字符串；提供时做材料类冲突判定与材料 verdict
 * @returns {Object} { blocked, errors, warnings, params, applied, materialVerdict, rulesVersion, taxonomyVersion }
 *   blocked=true 时 params 为 null（表单端/分发链应中止）
 */
function applyRules(selection, opts = {}) {
  const gate = taxonomy.validateSelection(selection, { material: opts.material });
  if (gate.errors.length > 0) {
    return { blocked: true, errors: gate.errors, warnings: gate.warnings, params: null, applied: [], rulesVersion: rulesVersion(), taxonomyVersion: taxonomy.TAXONOMY_VERSION };
  }

  const params = { ...BASELINE, materialExclude: [], materialPrefer: [] };
  const applied = [];
  const feat = opts.feat || {};
  for (const rule of rules) {
    if (!whenMatches(rule.when, selection, feat)) continue;
    // 数组参数跨规则**并集**（2026-10-18 修复）：materialExclude/materialPrefer 是累积语义，
    // 原 Object.assign 会让后应用规则整体覆盖前一条的排除/优先项（例：耐温排 PLA 被绝缘
    // 排 CF 覆盖 → PLA 漏网；多材料特性同选时自润滑 PA 被含纤维 CF 挤掉）
    for (const [param, value] of Object.entries(rule.set)) {
      if (ARRAY_PARAMS.has(param)) {
        params[param] = [...new Set([...(params[param] || []), ...(Array.isArray(value) ? value : [value])])];
      } else {
        params[param] = value;
      }
    }
    applied.push({ id: rule.id, priority: rule.priority, reason: rule.reason });
  }

  // 材料裁定：exclude/prefer regex 对材料字符串求值（选机匹配层与人工介入提示消费）
  let materialVerdict = null;
  if (opts.material) {
    const mat = String(opts.material);
    const excluded = params.materialExclude.some((src) => { try { return new RegExp(src, 'i').test(mat); } catch { return false; } });
    const preferred = params.materialPrefer.some((src) => { try { return new RegExp(src, 'i').test(mat); } catch { return false; } });
    materialVerdict = { material: mat, excluded, preferred };
  }

  return {
    blocked: false,
    errors: [],
    warnings: gate.warnings,
    params,
    applied,
    materialVerdict,
    rulesVersion: rulesVersion(),
    taxonomyVersion: taxonomy.TAXONOMY_VERSION,
  };
}

// ---------- 写窗口操作（内存热改 + 文件写回；规则文件不持久化的环境退化为运行期生效） ----------
function listRules() {
  return rules.map((r) => ({ ...r }));
}

function upsertRule(input) {
  const problems = validateRule(input);
  if (problems.length > 0) return { ok: false, errors: problems };
  const rule = withSeqId(stripBuiltin(input));
  removedBuiltins.delete(rule.id); // 同 id upsert = 重新启用被删内置（清墓碑）
  const idx = rules.findIndex((r) => r.id === rule.id);
  if (idx >= 0) rules[idx] = rule; else rules.push(rule);
  rules.sort((a, b) => a.priority - b.priority);
  saveRules(rules);
  return { ok: true, rule };
}

function removeRule(id) {
  const idx = rules.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, errors: [`规则不存在: ${id}`] };
  rules.splice(idx, 1);
  if (DEFAULT_RULES_BY_ID.has(id)) removedBuiltins.add(id); // 内置删除进墓碑（加载合并不复活）
  saveRules(rules);
  return { ok: true };
}

function resetRules() {
  // 与初始加载同口径排序（2026-10-18 修复：DEFAULT_RULES 书写顺序不再强依赖优先级，
  // 否则 reset 后 upsert 的 sort 会让规则顺序漂移、rulesVersion 误变）；墓碑一并清空
  removedBuiltins.clear();
  rules = DEFAULT_RULES.slice().sort((a, b) => a.priority - b.priority);
  saveRules(rules);
  return { ok: true, count: rules.length };
}

function getRulesSnapshot() {
  return {
    rulesVersion: rulesVersion(),
    taxonomyVersion: taxonomy.TAXONOMY_VERSION,
    rulesFile: RULES_FILE,
    paramWhitelist: PARAM_NAMES,
    baseline: BASELINE,
    rules: listRules(),
  };
}

module.exports = {
  BASELINE,
  PARAM_NAMES,
  DEFAULT_RULES,
  validateRule,
  applyRules,
  listRules,
  upsertRule,
  removeRule,
  resetRules,
  getRulesSnapshot,
  rulesVersion,
  _setRulesForTest: (arr) => { rules = arr.slice().sort((a, b) => a.priority - b.priority); },
};
