/**
 * AMS 特种槽位隔离单测（2026-11-20 v124 曼波令）
 * 语义：特种槽（AMS 未录入特种料、机端料型占位）从自动分发全链路排除——
 * ①buildAmsMapping 自动映射不选 ②amsCoversColors 多色判定不认 ③precheck 料位初审不判；
 * 唯一入口=提单「特种耗材开关」手动指定（prefTray 随单走审批/分发「指定即权威」通道）。
 * 用法：node test/special-slots-test.js（环境隔离不连生产）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-ss-${Date.now()}.json`);
process.env.PRINTER_SPECIAL_SLOTS_FILE = path.join(os.tmpdir(), `bambu-test-ss-store-${Date.now()}.json`);

const specialSlotsStore = require('../src/services/specialSlotsStore');
const { buildAmsMapping } = require('../src/services/dispatcher');

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

check('store：set 全量覆盖/去重/get/isSpecial/all 基本语义', () => {
  const r = specialSlotsStore.set('H2D', ['AMS 0·槽3', 'AMS 0·槽3', '']);
  assert.deepStrictEqual(r.specialSlots, ['AMS 0·槽3'], '重复与空串去重');
  assert.deepStrictEqual(specialSlotsStore.get('H2D'), ['AMS 0·槽3']);
  assert.ok(specialSlotsStore.isSpecial('H2D', 'AMS 0·槽3'));
  assert.ok(!specialSlotsStore.isSpecial('H2D', 'AMS 0·槽1'));
  assert.ok(!specialSlotsStore.isSpecial('X1C', 'AMS 0·槽3'), '按机隔离不串机');
  assert.ok(specialSlotsStore.all()['H2D']);
  specialSlotsStore.set('H2D', []);
  assert.deepStrictEqual(specialSlotsStore.get('H2D'), [], '空清单=清空（delete 键）');
  assert.throws(() => specialSlotsStore.set('', ['x']), /printerName/);
});

check('分发自动映射：特种槽被排除——普通槽照选', () => {
  specialSlotsStore.set('H2D', ['AMS 0·槽2']);
  const fm = buildAmsMapping(
    { color: '', materialExclude: [] },
    { name: 'H2D', ams: [
      { slot: 'AMS 0·槽1', type: 'PETG', colorHex: 'FF0000', amsId: 0, trayId: 1 },
      { slot: 'AMS 0·槽2', type: 'PETG', colorHex: '00FF00', amsId: 0, trayId: 2 }, // 特种隔离槽（显示绿 PETG 实为特种料）
      { slot: 'AMS 0·槽3', type: 'PETG', colorHex: '0000FF', amsId: 0, trayId: 3 },
    ] },
    { filaments: [{ type: 'PETG', colorHex: '00FF00' }] }, // 内嵌色恰好=隔离槽显示色（旧逻辑会选中它=废料）
  );
  assert.notStrictEqual(fm.amsMapping2[0].slot_id, 2, '必须跳过隔离槽（同色特种槽不得被自动选中）');
  assert.ok([1, 3].includes(fm.amsMapping2[0].slot_id), '在剩余普通槽中取最近色');
  specialSlotsStore.set('H2D', []);
});

check('分发自动映射：全部槽被隔离 → 回落默认槽（自动系统宁可默认也不碰特种槽）', () => {
  specialSlotsStore.set('H2D', ['AMS 0·槽1', 'AMS 0·槽2']);
  const fm = buildAmsMapping(
    { color: '', materialExclude: [] },
    { name: 'H2D', ams: [
      { slot: 'AMS 0·槽1', type: 'PETG', colorHex: 'FF0000', amsId: 0, trayId: 1 },
      { slot: 'AMS 0·槽2', type: 'PETG', colorHex: '00FF00', amsId: 0, trayId: 2 },
    ] },
    { filaments: [{ type: 'PETG', colorHex: '00FF00' }] },
  );
  assert.deepStrictEqual(fm.amsMapping2, [{ ams_id: 0, slot_id: 0 }], '全隔离回落 AMS0·0 告警路径');
  specialSlotsStore.set('H2D', []);
});

check('静态锚：隔离三处接线（自动映射/多色判定/初审）+ 提单 prefTray 全链 + 观察台/预约台 UI', () => {
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes("require('./specialSlotsStore')"), 'dispatcher 必须接特种隔离');
  assert.ok(disp.includes('prefTray: reservation.prefTray || null'), 'buildLocalTask 必须透传提单预存槽');
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes('traySource = reservation.prefTray'), 'approve 链必须读单据预存（审批显式可覆盖）');
  assert.ok(resv.includes("_special.includes(t.slot)"), '初审料位覆盖必须排除特种槽');
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(idx.includes('special-slots'), '设置/查询端点必须存在');
  assert.ok(idx.includes('prefTrayField'), '提交口必须接收 prefTray');
  const mgr = fs.readFileSync(path.join(__dirname, '../src/printer/manager.js'), 'utf8');
  assert.ok(mgr.includes('specialSlots'), 'getApiStates 必须透出隔离清单');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const st = fs.readFileSync(path.join(__dirname, '../public/status.html'), 'utf8');
  if (!front.includes('specialTrayToggle') && !front.includes('specialTrayPanel')) console.log('  ⧗ 预约台特种开关待前端工位落地（软等待）');
  if (!st.includes('special-slots')) console.log('  ⧗ 观察台隔离开关待前端工位落地（软等待）');
});

process.exit(failures > 0 ? 1 : 0);
