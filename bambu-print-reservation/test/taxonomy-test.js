/**
 * 需求标签池（taxonomy）单测（纯逻辑，不调 API）
 * 用法：node test/taxonomy-test.js
 */
const assert = require('assert');
const {
  TAXONOMY_VERSION,
  groups,
  CONFLICTS,
  validateSelection,
  selectionFromFormFields,
  getTaxonomy,
  isSceneSelected,
} = require('../src/services/taxonomy');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- 结构完整性 ----------

check('标签池版本为 v4（几何体检组批）', () => {
  assert.equal(TAXONOMY_VERSION, 'v6');
});

check('几何体检（自动检测）组：4 个 bool 字段齐备', () => {
  const auto = groups.find((g) => g.id === 'auto');
  assert.ok(auto, '缺 auto 组');
  const ids = auto.fields.map((f) => f.id);
  assert.deepEqual(ids, ['hole_comp_z', 'hole_comp_xy', 'overhang_heavy', 'curved_surface', 'small_footprint']);
  for (const f of auto.fields) {
    assert.equal(f.type, 'bool', `${f.id} 应为 bool`);
    assert.ok(f.tooltip.includes('自动检测'), `${f.id} tooltip 应说明自动检测语义`);
  }
});

check('每个字段具备 tooltip 与 mapsHint（可映射铁律）', () => {
  for (const g of groups) {
    for (const f of g.fields) {
      assert.ok(f.tooltip && f.tooltip.length > 5, `${f.id} 缺 tooltip`);
      assert.ok(Array.isArray(f.mapsHint) && f.mapsHint.length > 0, `${f.id} 缺 mapsHint（违反「每标签必须可映射」铁律）`);
    }
  }
});

check('single/multi 字段必有选项，formTitle 全池唯一', () => {
  const titles = new Set();
  for (const g of groups) {
    for (const f of g.fields) {
      if (f.type === 'single' || f.type === 'multi') {
        assert.ok(Array.isArray(f.options) && f.options.length > 0, `${f.id} 无选项`);
        const optIds = new Set(f.options.map((o) => o.id));
        assert.equal(optIds.size, f.options.length, `${f.id} 选项 id 重复`);
      }
      assert.ok(!titles.has(f.formTitle), `formTitle 撞车: ${f.formTitle}`);
      titles.add(f.formTitle);
    }
  }
});

check('v2 力学/耐久扩充字段在池', () => {
  const ids = new Set(groups.flatMap((g) => g.fields.map((f) => f.id)));
  for (const id of ['load_magnitude', 'service_life', 'deflection_scale', 'electrical_insulation', 'fastener']) {
    assert.ok(ids.has(id), `缺少扩充字段 ${id}`);
  }
  const loadType = groups.flatMap((g) => g.fields).find((f) => f.id === 'load_type');
  assert.ok(loadType.options.some((o) => o.id === 'contact'), '受力类型缺「滚压/点接触」');
  const loadNature = groups.flatMap((g) => g.fields).find((f) => f.id === 'load_nature');
  assert.ok(loadNature.options.some((o) => o.id === 'vibration'), '载荷性质缺「振动」');
  const dir = groups.flatMap((g) => g.fields).find((f) => f.id === 'load_direction');
  assert.ok(dir.type === 'multi', '受力方向应为多选');
  assert.ok(dir.options.some((o) => o.label === '多向拟合'), '多向选项应为「多向拟合」');
  assert.ok(!dir.options.some((o) => o.label.includes('工作时')), '工作朝向指引应在字段 tooltip,不藏在 Z 轴选项 label');
  const scale = groups.flatMap((g) => g.fields).find((f) => f.id === 'deflection_scale');
  assert.equal(scale.min, -3); assert.equal(scale.max, 3);
  const life = groups.flatMap((g) => g.fields).find((f) => f.id === 'service_life');
  assert.ok(life.options.some((o) => o.label === '上场件'), '使用寿命应有「上场件」');
});

// ---------- validateSelection ----------

check('空勾选通过（默认不勾=常规件一键提交）', () => {
  const r = validateSelection({});
  assert.deepEqual(r.errors, []);
});

check('合法勾选通过', () => {
  const r = validateSelection({
    load_direction: ['Z'],
    load_type: ['bending', 'shear'],
    load_magnitude: 'medium',
    appearance: true,
  });
  assert.deepEqual(r.errors, []);
});

check('未知字段与无效选项报错', () => {
  const r = validateSelection({ no_such_field: 1, load_magnitude: 'ultra' });
  assert.equal(r.errors.length, 2);
});

check('multi 非数组 / number 越界报错', () => {
  const r = validateSelection({ load_type: 'bending', quantity: 100 });
  assert.equal(r.errors.length, 2);
});

check('硬冲突：耐温≥80°C × PLA 拦截（需提供材料）', () => {
  const sel = { temp_class: 't80' };
  assert.deepEqual(validateSelection(sel).errors, [], '未提供材料时不判材料类冲突');
  const r = validateSelection(sel, { material: 'PLA-CF' });
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0], /PLA/);
  assert.deepEqual(validateSelection(sel, { material: 'PETG' }).errors, []);
});

check('硬冲突：电气绝缘 × CF 系拦截', () => {
  const r = validateSelection({ electrical_insulation: true }, { material: 'PAHT-CF' });
  assert.equal(r.errors.length, 1);
});

check('硬冲突：长期静载 × PLA 蠕变拦截', () => {
  const r = validateSelection(
    { service_life: 'long_term', load_nature: 'static' },
    { material: 'PLA' }
  );
  assert.equal(r.errors.length, 1);
  // 只满足一腿不拦
  assert.deepEqual(
    validateSelection({ service_life: 'long_term', load_nature: 'impact' }, { material: 'PLA' }).errors,
    []
  );
});

check('警告级：高速 × 外观件放行但带警告', () => {
  const r = validateSelection({ fast_mode: true, appearance: true });
  assert.deepEqual(r.errors, []);
  assert.equal(r.warnings.length, 1);
});

check('警告级：柔性弹性 × CF（材料条件）', () => {
  assert.equal(validateSelection({ deflection_scale: -3 }).warnings.length, 0);
  assert.equal(validateSelection({ deflection_scale: -3 }, { material: 'PLA-CF' }).warnings.length, 1);
  // 范围条件边界：-2 也命中柔性（max:-2），+1 不命中
  assert.equal(validateSelection({ deflection_scale: -2 }, { material: 'PLA-CF' }).warnings.length, 1);
  assert.equal(validateSelection({ deflection_scale: 1 }, { material: 'PLA-CF' }).warnings.length, 0);
});

check('收缩量要求标尺已下架（2026-10-10 曼波需求，池内不得残留）', () => {
  const shrink = groups.flatMap((g) => g.fields).find((f) => f.id === 'shrink_scale');
  assert.ok(!shrink, 'shrink_scale 应已从标签池移除');
  // 历史勾选残留：未知标签按既有口径拦截，不静默放行
  assert.equal(validateSelection({ shrink_scale: -2 }).errors.length, 1, '池外字段应报「未知需求标签」');
});

// ---------- selectionFromFormFields ----------

const FORM_FIELDS = [
  { title: '受力方向', value: 'Z 轴' },
  { title: '受力类型', value: '弯曲、剪切' },
  { title: '载荷量级', value: '中载' },
  { title: '使用寿命', value: '上场件' },
  { title: '电气绝缘', value: '是' },
    { title: '外观件', value: '否' },
  { title: '材料类型', value: 'PETG' },
];

check('表单字段 → 标准化勾选（中文 label 反查 id）', () => {
  const { selection } = selectionFromFormFields(FORM_FIELDS);
  assert.deepEqual(selection.load_direction, ['Z']); // 受力方向 2026-10-05 改多选
  assert.deepEqual(selection.load_type, ['bending', 'shear']);
  assert.equal(selection.load_magnitude, 'medium');
  assert.equal(selection.service_life, 'long_term');
  assert.equal(selection.electrical_insulation, true);
    assert.ok(!('appearance' in selection), '显式为否不写入勾选');
});

check('表单提取不带非本池字段（材料类型由既有解析负责）', () => {
  const { selection } = selectionFromFormFields(FORM_FIELDS);
  assert.ok(!('materialType' in selection) && !('材料类型' in selection));
});

check('无法识别的选项进 unmatched（宽容不丢字段）', () => {
  const { selection, unmatched } = selectionFromFormFields([{ title: '受力方向', value: '斜着' }]);
  assert.ok(!('load_direction' in selection));
  assert.equal(unmatched.length, 1);
  assert.match(unmatched[0], /受力方向/);
});

check('提取结果可直接过校验并与材料联动', () => {
  const { selection } = selectionFromFormFields(FORM_FIELDS);
  const r = validateSelection(selection, { material: 'PETG' });
  assert.deepEqual(r.errors, [], '样例表单勾选组合应无冲突');
});

// ---------- 窗口输出 ----------

check('getTaxonomy 输出全景：version/groups/conflicts，正则转字符串', () => {
  const t = getTaxonomy();
  assert.equal(t.version, TAXONOMY_VERSION);
  assert.ok(Array.isArray(t.groups) && t.groups.length >= 9);
  assert.ok(Array.isArray(t.conflicts) && t.conflicts.length >= 6);
  for (const c of t.conflicts) {
    assert.ok(c.materialMatch === null || typeof c.materialMatch === 'string');
    assert.ok(['block', 'warn'].includes(c.level));
  }
  assert.ok(t.convention.includes('Z'));
});

check('冲突规则引用的字段/材料正则自洽（防规则库写错字段名）', () => {
  const ids = new Set(groups.flatMap((g) => g.fields.map((f) => f.id)));
  for (const rule of CONFLICTS) {
    for (const fieldId of Object.keys(rule.when)) {
      assert.ok(ids.has(fieldId), `冲突规则 ${rule.id} 引用了不存在的字段 ${fieldId}`);
    }
    assert.ok(rule.message && rule.message.length > 5, `冲突规则 ${rule.id} 缺 message`);
  }
});

check('使用场景置顶 + 必填判定（2026-10-18 曼波令）', () => {
  const t = getTaxonomy();
  assert.equal(t.groups[0].id, 'scene', 'taxonomy 首组必须是使用场景（两页同源渲染）');
  assert.equal(t.groups.filter((g) => g.id === 'scene').length, 1, '场景组不得重复');
  assert.equal(isSceneSelected({ scene_usage: ['robot'] }), true);
  assert.equal(isSceneSelected({ scene_usage: [] }), false);
  assert.equal(isSceneSelected({}), false);
  assert.equal(isSceneSelected(null), false);
});

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
