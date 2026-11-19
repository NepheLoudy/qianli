/**
 * 切片颜色分发/降级单测（2026-11-06 v98 曼波令「切片栏锁死，只留颜色可指定」——原注释笔误 v97，
 * v97 条目仅喷嘴闸；「切片栏锁死+颜色分发/降级」在 DEVLOG 记 v98）
 * 口径：用户指定色（仅 hex 通道）优先作为匹配目标——色差≤阈值命中；超阈值=颜色降级
 * （材料匹配里取最近色槽，colorNotes 供播报+单据轨迹）；未指定用户色维持内嵌色最近。
 * 用法：node test/stub-test-color-dispatch.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 隔离：让 manager 保持 0 台打印机、不触发外部调用（同 dispatcher-test 口径）
process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';

const { buildAmsMapping, colorDistance } = require('../src/services/dispatcher');
const config = require('../src/config');

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

const TASK = (color, extra = {}) => ({ color, materialExclude: [], ...extra });
const PRINTER = (trays) => ({ ams: trays });
const tray = (id, type, colorHex) => ({ slot: `AMS 0·槽${id}`, type, colorHex, amsId: 0, trayId: id, remain: 50, external: false });

check('用户色精确命中：红槽/黑槽并存，选红（无降级记录）', () => {
  const fm = buildAmsMapping(
    TASK('#FF0000'),
    PRINTER([tray(1, 'PETG', '1B1B1B'), tray(2, 'PETG', 'FF0000')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 2 }]);
  assert.deepStrictEqual(fm.colorNotes, [], '阈值内命中不记降级');
});

check('用户色降级：只有黑槽时选最近黑槽并记 colorNotes（请求红→黑）', () => {
  const fm = buildAmsMapping(
    TASK('#FF0000'),
    PRINTER([tray(1, 'PETG', '1B1B1B')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 1 }]);
  assert.strictEqual(fm.colorNotes.length, 1);
  const n = fm.colorNotes[0];
  assert.strictEqual(n.requested, '#FF0000');
  assert.strictEqual(n.trayType, 'PETG');
  assert.strictEqual(n.trayColorHex, '#1B1B1B');
  assert.ok(n.dist > config.dispatch.colorDistanceThreshold, `红黑距离应超阈值：${n.dist}`);
  assert.ok(colorDistance('FF0000', '26A69A') > config.dispatch.colorDistanceThreshold);
});

check('未指定用户色：维持内嵌色最近（原口径，不记降级）', () => {
  const fm = buildAmsMapping(
    TASK(''),
    PRINTER([tray(1, 'PETG', '1B1B1B'), tray(2, 'PETG', '2BBBAD')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 2 }], '内嵌青色应选最近的青槽');
  assert.deepStrictEqual(fm.colorNotes, []);
});

check('色名不参与直通映射（仅 hex 通道）：「黑色」走内嵌色路径', () => {
  const fm = buildAmsMapping(
    TASK('黑色'),
    PRINTER([tray(1, 'PETG', '1B1B1B'), tray(2, 'PETG', '2BBBAD')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 2 }]);
  assert.deepStrictEqual(fm.colorNotes, []);
});

check('多用料件：用户色对第一条生效，其余随文件内嵌色', () => {
  const fm = buildAmsMapping(
    TASK('#FF0000'),
    PRINTER([tray(1, 'PETG', 'FF0000'), tray(2, 'PLA', '1B1B1B'), tray(3, 'PLA', 'FFFFFF')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }, { type: 'PLA', colorHex: 'FFFFFF' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [
    { ams_id: 0, slot_id: 1 }, // f0：用户红
    { ams_id: 0, slot_id: 3 }, // f1：内嵌白
  ]);
  assert.deepStrictEqual(fm.colorNotes, []);
});

check('审批逐条指定（prefTrays）指定即权威：不吃用户色映射、无降级记录', () => {
  const fm = buildAmsMapping(
    TASK('#FF0000', { prefTrays: [{ amsId: 0, trayId: 1 }] }),
    PRINTER([tray(1, 'PETG', '1B1B1B'), tray(2, 'PETG', 'FF0000')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2[0], { ams_id: 0, slot_id: 1 });
  assert.deepStrictEqual(fm.colorNotes, []);
});

check('材料家族降级兜底：无 exact 材料时 family 匹配仍可用', () => {
  const fm = buildAmsMapping(
    TASK(''),
    PRINTER([tray(1, 'PETG-CF', '1B1B1B')]),
    { filaments: [{ type: 'PETG', colorHex: '26A69A' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 1 }]);
});

check('静态锚：切片栏锁死三处接线（probe 用料/colors RGB 表/提交口材料份数）+ 前端色板', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(idx.includes('filaments: ext.filaments || []'), 'probe-model 必须带用料清单');
  assert.ok(idx.includes('colorMap: config.colorReference'), 'colors 端点必须带色名↔RGB 表');
  assert.ok(idx.includes('materialType: slicedMaterial || body.materialType'), '切片件材料必须随文件锁定');
  assert.ok(idx.includes('quantity: isSlicedFinal ? 1 : body.quantity'), '切片件份数必须固定 1');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(front.includes('renderColorSwatches'), '预约台必须有机端实时色板');
  assert.ok(front.includes('applySlicedLocks'), '切片栏锁死必须接线');
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('user-downgrade'), '降级档位必须存在');
  assert.ok(disp.includes('颜色降级'), '降级播报必须落日志/轨迹');
});

process.exit(failures > 0 ? 1 : 0);
