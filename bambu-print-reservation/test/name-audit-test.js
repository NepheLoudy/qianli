/**
 * 源文件名称对账单测（2026-11-15 v111 曼波令「名称架构对账：对上放行，对不上询问」）
 * 从 public/index.html 抽取 parseSliceBase/nameMatchLevel/verifySourceNames 真身，
 * 用历史真单文件名跑行为断言（含曼波截图实件 HVB_depart1_PETG_1h34m）。
 * 用法：node test/stub-test-name-audit.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
const start = html.indexOf('const SLICE_MATERIAL_WORDS');
const end = html.indexOf('function confirmSourceMismatch');
assert.ok(start > 0 && end > start, '对账函数段必须在页面脚本内');
const factory = new Function(html.slice(start, end) + '\nreturn { parseSliceBase, nameMatchLevel, verifySourceNames };');
const { parseSliceBase, nameMatchLevel, verifySourceNames } = factory();

let pass = 0;
let failures = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

check('parseSliceBase：剥「_材料_时长」尾巴（真实单名集）', () => {
  assert.strictEqual(parseSliceBase('HVB_depart1_PETG_1h34m.gcode.3mf'), 'HVB_depart1', '曼波截图实件');
  assert.strictEqual(parseSliceBase('线规限位_PETG_45m52s.gcode.3mf'), '线规限位');
  assert.strictEqual(parseSliceBase('零部件21_PETG-CF_2h2m.gcode.3mf'), '零部件21', '带连字符材料段');
  assert.strictEqual(parseSliceBase('底部三角件(x4)_PETG_9h40m.gcode.3mf'), '底部三角件(x4)', '本体含括号');
  assert.strictEqual(parseSliceBase('3.7_PLA_19m41s.gcode.3mf'), '3.7', '纯数字本体');
  assert.strictEqual(parseSliceBase('7单元U段八木_第二版(2)_PETG_1h17m.3mf'), '7单元U段八木_第二版(2)', '多段尾巴只剥最后两段');
});

check('parseSliceBase：无规范尾巴返回 null（无从对照，放行）', () => {
  assert.strictEqual(parseSliceBase('电控板件.gcode.3mf'), null, '无材料/时长段');
  assert.strictEqual(parseSliceBase('H2多色.3mf'), null);
  assert.strictEqual(parseSliceBase('Poop-Bucket-Plain-H-Series_5h30m.gcode.3mf'), null, '本体大写尾（Series 不在词表）不得被误剥成 Poop-Bucket-Plain-H');
  assert.strictEqual(parseSliceBase(''), null);
  assert.strictEqual(parseSliceBase(null), null);
});

check('nameMatchLevel：exact / loose（版本差异）/ mismatch / unknown', () => {
  assert.strictEqual(nameMatchLevel('HVB_depart1', 'HVB_depart1.step'), 'exact');
  assert.strictEqual(nameMatchLevel('HVB_depart1', 'HVB_depart1 v2.STEP'), 'loose', '大小写/版本差异=loose');
  assert.strictEqual(nameMatchLevel('拨弹盘衔接打印件(打一个)', '拨弹盘衔接.step'), 'loose', '包含关系=loose');
  assert.strictEqual(nameMatchLevel('齿轮保护壳', '完全无关件.step'), 'mismatch');
  assert.strictEqual(nameMatchLevel(null, 'x.step'), 'unknown');
});

check('verifySourceNames：单源 mismatch 拦截、对上放行', () => {
  const slice = 'HVB_depart1_PETG_1h34m.gcode.3mf';
  assert.deepStrictEqual(verifySourceNames([{ name: 'HVB_depart1.step' }], slice), [], '对上放行');
  const bad = verifySourceNames([{ name: '完全无关件.step' }], slice);
  assert.strictEqual(bad.length, 1, 'mismatch 必须拦下待询问');
});

check('多模型兼容：多源任一对上即整体放行（一盘多件源名不同是正常）', () => {
  const slice = '组合体_PETG_8h15m.gcode.3mf';
  const two = [{ name: '组合体.step' }, { name: '盘里另一件.step' }];
  assert.deepStrictEqual(verifySourceNames(two, slice), [], '多源任一 match → 整体放行');
  const allBad = verifySourceNames([{ name: '件A.step' }, { name: '件B.step' }], slice);
  assert.strictEqual(allBad.length, 2, '多源全 mismatch → 整批询问');
});

check('静态锚：双路径接线（弹窗 change + 主框多选分流）', () => {
  assert.ok(html.includes('const mism = verifySourceNames(SOURCE_FILE, file.name)'), '弹窗路径必须接对账');
  assert.ok(html.includes('const mism = verifySourceNames(sources, pick.name)'), '主框多选路径必须接对账');
  assert.ok(html.includes('confirmSourceMismatch'), '确认框必须存在');
});

process.exit(failures > 0 ? 1 : 0);
