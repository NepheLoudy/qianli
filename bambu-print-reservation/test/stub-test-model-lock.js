/**
 * 切片件机型锁定单测（2026-11-06 曼波令「交切片文件锁死机型选择」）
 * 覆盖：modelCompatible 三态（同型号/互打组内/组外拒）、config.machineCompatGroups 默认空、
 *       probe-model 端点与提交/审批链 fail-closed 的静态契约锚。
 * 用法：node test/stub-test-model-lock.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { modelKey, modelCompatible } = require('../src/utils/printerModelKey');
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

check('同型号放行（含别名/前缀收敛）：H2D 全称↔登记 H2D、X1 Carbon↔X1C', () => {
  assert.ok(modelCompatible('Bambu Lab H2D', 'H2D'));
  assert.ok(modelCompatible('X1 Carbon', 'X1C'));
  assert.ok(modelCompatible('A1 mini', 'A1mini'));
});

check('跨型号拒：H2D 切片 → P1S/A1mini/闪铸 A5P 一律不兼容', () => {
  assert.ok(!modelCompatible('Bambu Lab H2D', 'P1S'));
  assert.ok(!modelCompatible('Bambu Lab H2D', 'A1 mini'));
  assert.ok(!modelCompatible('Bambu Lab H2D', 'FlashForge Adventurer 5M Pro'));
});

check('互打白名单组：组内放行、组外仍拒、默认空表=严格同型号', () => {
  assert.ok(!modelCompatible('P1P', 'P1S')); // 默认空表：跨型号一律拒
  const groups = { p1p: ['p1s'] };
  assert.ok(modelCompatible('P1P', 'P1S', groups)); // 登记后组内互认
  assert.ok(!modelCompatible('P1P', 'A1mini', groups)); // 组外照拒
  assert.deepStrictEqual(config.machineCompatGroups, {}, '默认互打表必须为空（严格同型号）');
});

check('probe-model 端点与 fail-closed 链静态锚：路由/指纹/兼容组三处接线', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(idx.includes('/api/print/probe-model'), 'probe-model 探测端点必须存在');
  assert.ok(idx.includes('modelCompatible(probeModel, pr.model, config.machineCompatGroups)'), '提交路由机型锁定必须接兼容组');
  assert.ok(idx.includes('probeModel && isSlicedFinal'), 'v98 修复：机型锁死必须只咬切片直通件（工程件交审批链）');
  assert.ok(!idx.includes('isUnslicedFinal'), 'v98 修复：未声明变量 isUnslicedFinal 不得残留');
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes('无法识别内嵌机型指纹'), '审批链无指纹必须 fail-closed 拦截');
  assert.ok(resv.includes('modelCompatible(embeddedModel, pr.model, config.machineCompatGroups)'), '审批链机型校验必须接兼容组');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(front.includes('probeSlicedModel'), '预约台必须接探测锁定');
  assert.ok(/else \{ releaseSlicedLocks\(\); SLICED_PROBE = null/.test(front), 'v98 修复：切回模型直投必须释放表单锁死');
});

check('modelKey 回归：无指纹/空串安全返回（不抛）', () => {
  assert.strictEqual(modelKey(''), '');
  assert.strictEqual(modelKey(null), '');
});

check('纯 gcode 封死（2026-11-06 曼波令终裁）：提交/probe/复刻三处锚', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(idx.includes('不再接受纯 .gcode 文件'), '提交口必须拒收纯 gcode');
  assert.ok(idx.includes('不再接受纯 .gcode——请在切片软件'), 'probe-model 必须拒收纯 gcode');
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes('系统已不再支持该格式'), '复刻链必须拒纯 gcode 存量单');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(front.includes('不再接受纯 .gcode'), '预约台文案必须说明纯 gcode 封死');
});

check('闪铸 .gcode.3mf 实例指纹（曼波 2026-11-06 实件）：extractFrom3mf 咬出闪铸机型——品牌不靠扩展名', () => {
  const fixture = path.join(__dirname, 'fixtures/flashforge-sample.gcode.3mf');
  if (!fs.existsSync(fixture)) return; // fixture 缺失时跳过（不因二进制未入库而红）
  const { extractFrom3mf } = require('../src/services/slicerExtract');
  const ext = extractFrom3mf(fs.readFileSync(fixture));
  assert.strictEqual(ext.machineModel, 'Flashforge Adventurer 5M Pro');
  assert.strictEqual(ext.sliced, true);
  assert.ok(ext.filaments && ext.filaments.length >= 1, '闪铸件用料清单应可提取');
  // 机型锁定链对闪铸件生效：与拓竹机不同型号 → 拒；与闪铸登记机兼容 → 过
  assert.ok(!modelCompatible(ext.machineModel, 'H2D'));
  assert.ok(modelCompatible(ext.machineModel, 'FlashForge Adventurer 5M Pro'));
});

process.exit(failures > 0 ? 1 : 0);
