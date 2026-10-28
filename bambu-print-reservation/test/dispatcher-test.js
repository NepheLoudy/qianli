/**
 * 分发引擎匹配逻辑单测（不连打印机/飞书，纯逻辑验证）
 * 用法：node test/dispatcher-test.js
 */
const assert = require('assert');

// 隔离：让 manager 保持 0 台打印机、不触发外部调用
process.env.PLAZA_BITABLE_TABLE_ID = ''; // 测试禁用动态广场写表（防污染生产表）
process.env.PRINTER_HOSTS = '';

const { colorDistance, materialMatch } = require('../src/services/dispatcher');
const dispatcher = require('../src/services/dispatcher');
const config = require('../src/config');

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

// ---------- 色彩距离 ----------
check('白色 vs 米白 视为同色', () => {
  assert.ok(colorDistance('#FFFFFF', '#F2EFE9') < config.dispatch.colorDistanceThreshold);
});
check('白色 vs 黑色 距离极大', () => {
  assert.ok(colorDistance('#FFFFFF', '#000000') > config.dispatch.colorDistanceThreshold);
});
check('红色 vs 标准红 接近', () => {
  assert.ok(colorDistance('#E8261C', '#FF0000') < config.dispatch.colorDistanceThreshold);
});
check('红色 vs 橙色 不匹配', () => {
  assert.ok(colorDistance('#E8261C', '#FFA500') > config.dispatch.colorDistanceThreshold);
});
check('蓝色 vs 紫色 不匹配', () => {
  assert.ok(colorDistance('#0070C0', '#7030A0') > config.dispatch.colorDistanceThreshold);
});
check('非法 hex 返回 Infinity', () => {
  assert.ok(colorDistance('', '#FFFFFF') === Infinity);
});

// ---------- 材料匹配 ----------
check('PLA = PLA 精确匹配', () => {
  assert.equal(materialMatch('PLA', 'PLA'), 'exact');
});
check('PLA-CF 与 PLA 家族匹配', () => {
  assert.equal(materialMatch('PLA-CF', 'PLA'), 'family');
});
check('PETG 与 PLA 不匹配', () => {
  assert.ok(!materialMatch('PETG', 'PLA'));
});
check('大小写与空格归一', () => {
  assert.equal(materialMatch(' petg ', 'PETG-HF'), 'family');
});

// ---------- 选机逻辑 ----------
function fakePrinter(id, name, model, trays) {
  return {
    id, name, model,
    autoDispatch: true,
    status: '空闲',
    ams: trays.map((t, i) => ({
      slot: `AMS ${i + 1}`,
      type: t[0],
      colorHex: t[1],
      active: false,
      external: false,
    })),
  };
}

const X1C1 = fakePrinter(1, 'X1C-01', 'X1C', [['PLA', '#FFFFFF'], ['PETG', '#FF0000']]);
const X1C2 = fakePrinter(2, 'X1C-02', 'X1C', [['PLA', '#E8261C'], ['PLA', '#000000']]);
const H2D = fakePrinter(3, 'H2D', 'H2D', [['PETG', '#0070C0']]);

check('PLA×白色 → 匹配装白 PLA 的 X1C-01', () => {
  const task = { materialType: 'PLA', color: '白色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'X1C-01');
});
check('PLA×红色 → 匹配装红 PLA 的 X1C-02', () => {
  const task = { materialType: 'PLA', color: '红色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'X1C-02');
});
check('PETG×蓝色 → 匹配 H2D', () => {
  const task = { materialType: 'PETG', '颜色': '蓝色', color: '蓝色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]).name, 'H2D');
});
check('ABS 无机装载 → 匹配不到', () => {
  const task = { materialType: 'ABS', color: '白色' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, X1C2, H2D]), null);
});
check('未填材料 → 任意有料打印机', () => {
  const task = { materialType: '', color: '' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1]).name, 'X1C-01');
});
check('指定打印机优先', () => {
  const task = { materialType: 'PLA', color: '白色', assignedPrinter: 'H2D' };
  assert.equal(dispatcher.matchPrinter(task, [X1C1, H2D]).name, 'H2D');
});
check('指定打印机=钉死（2026-10-16 曼波真机反馈「选 A5P 却被分到 X1C」）：不可用时滞留不改派', () => {
  // ① 品牌不符：3mf 单指定闪铸机——候选里没有它，必须返回 null（绝不落到 X1C 顶替）
  const ffAssigned = { ...H2D, name: '闪铸A5P', model: 'AD5M Pro' };
  const t1 = { materialType: 'PLA', color: '白色', assignedPrinter: '闪铸A5P', fileName: 'x.gcode.3mf' };
  assert.equal(dispatcher.matchPrinter(t1, [ffAssigned, X1C1]), null, '品牌不符→滞留等人工');
  // ② 指定机忙碌（不在候选）：等待，不派他机
  const busy = { ...X1C1, name: 'X1C-01', status: '打印中' };
  const t2 = { materialType: 'PLA', color: '白色', assignedPrinter: 'X1C-01', fileName: 'a.3mf' };
  assert.equal(dispatcher.matchPrinter(t2, [busy, H2D]), null, '指定机忙碌→等待');
  // ③ 指定机可用：照常命中（既有行为不回归）
  const t3 = { materialType: 'PLA', color: '白色', assignedPrinter: 'X1C-02', fileName: 'a.3mf' };
  assert.equal(dispatcher.matchPrinter(t3, [X1C1, X1C2, H2D]).name, 'X1C-02');
});
check('brandForFileWithMeta：切片文件内嵌机型优先于扩展名（2026-10-16 曼波真机）', () => {
  assert.equal(dispatcher.brandForFileWithMeta('x.gcode.3mf', 'Flashforge Adventurer 5M Pro'), 'flashforge', '拿闪铸机子切的 3mf → 闪铸');
  assert.equal(dispatcher.brandForFileWithMeta('x.gcode.3mf', 'Bambu Lab H2D'), 'bambu');
  assert.equal(dispatcher.brandForFileWithMeta('x.gcode.3mf', null), 'bambu', '无内嵌机型时退回扩展名');
  assert.equal(dispatcher.brandForFileWithMeta('y.gcode', null), 'flashforge');
  // 内嵌机型 + 指定闪铸机 → 命中（2026-10-28 曼波令：切片件不做自动分发，指定即权威）
  const ff = { ...H2D, name: '闪铸A5P', model: 'AD5M Pro', ams: [{ slot: '进料口', type: 'PLA', colorHex: '', active: true, external: true }] };
  const t = { materialType: 'PLA', color: '白色', fileName: 'x.gcode.3mf', machineModel: 'Flashforge Adventurer 5M Pro', assignedPrinter: '闪铸A5P' };
  assert.equal(dispatcher.matchPrinter(t, [ff, X1C1]).name, '闪铸A5P', '内嵌闪铸机型 + 指定 → 命中闪铸机');
  assert.equal(dispatcher.matchPrinter({ ...t, assignedPrinter: undefined }, [ff, X1C1]), null, '切片件留空不自动分发（滞留等指定）');
});
check('占用中的打印机不在候选（快照只传空闲）', () => {
  const printingX1C1 = { ...X1C1, status: '打印中' };
  const task = { materialType: 'PLA', color: '白色' };
  // 模拟 getAvailablePrinters 已过滤打印中的机器
  assert.equal(dispatcher.matchPrinter(task, [printingX1C1, H2D]), null);
});
check('静止残留故障（FAILED 挂态）同空闲可派单（2026-10-16 方案B）', () => {
  const task = { materialType: 'PETG', color: '蓝色' };
  const residueH2D = { ...H2D, status: '故障', gcodeState: 'FAILED', activeTask: null, progress: 0 };
  assert.equal(dispatcher.matchPrinter(task, [residueH2D]).name, 'H2D', '残留挂态放行（新任务开打自动顶掉残留）');
  const midFail = { ...H2D, status: '故障', gcodeState: 'FAILED', activeTask: null, progress: 47 };
  assert.equal(dispatcher.matchPrinter(task, [midFail]), null, '中途失败（进度>0）不放行');
  const tracedTask = { ...H2D, status: '故障', gcodeState: 'FAILED', activeTask: { id: 1 }, progress: 0 };
  assert.equal(dispatcher.matchPrinter(task, [tracedTask]), null, '有在册任务不放行');
});

// ---------- 队列排序 ----------
check('加急任务排在普通任务前', () => {
  dispatcher.queue = [
    { recordId: 'a', isUrgent: false, enqueuedAt: 100 },
    { recordId: 'b', isUrgent: true, enqueuedAt: 200 },
  ];
  dispatcher.sortQueue();
  assert.equal(dispatcher.queue[0].recordId, 'b');
  dispatcher.queue = [];
});

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
