/**
 * 全量远控纯逻辑单测（不连打印机）：动机械状态门控 / client 参数校验 / 机型画面通道。
 * 用法：node test/printer-control-test.js
 */
const assert = require('assert');

// 隔离：让 manager 保持 0 台打印机、不触发外部连接（dotenv 不覆盖已存在 env）
process.env.PRINTER_HOSTS = '';
process.env.PRINTER_ACCESS_CODES = '';
process.env.PRINTER_SERIALS = '';
process.env.PRINTER_NAMES = '';
process.env.PRINTER_MODELS = '';
process.env.PLAZA_BITABLE_TABLE_ID = '';

const manager = require('../src/printer/manager');
const PrinterClient = require('../src/printer/client');

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

async function checkAsync(name, fn) {
  try {
    await fn();
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- canJogMachine：动机械状态门控 ----------
check('空闲/完成/故障态可动机械', () => {
  for (const s of ['IDLE', 'FINISH', 'FAILED', 'idle', 'Finish']) {
    assert.strictEqual(manager.canJogMachine(s), true, `gcodeState=${s} 应放行`);
  }
});
check('打印中/暂停/准备/切片禁止动机械', () => {
  for (const s of ['PRINTING', 'RESUME', 'PAUSE', 'PREPARE', 'SLICING']) {
    assert.strictEqual(manager.canJogMachine(s), false, `gcodeState=${s} 应拒绝`);
  }
});
check('未知/空状态保守拒绝', () => {
  assert.strictEqual(manager.canJogMachine(''), false);
  assert.strictEqual(manager.canJogMachine(undefined), false);
  assert.strictEqual(manager.canJogMachine('SOME_NEW_STATE'), false);
});

// ---------- 命令 topic：新老世代分路 ----------
check('命令 topic 修正：新世代切 request、老世代不动（回归：model 未定义曾致静默不切换）', () => {
  const topicFor = (model) => {
    const c = Object.create(PrinterClient.prototype);
    c.config = { name: 'T', model, serial: 'SN1' };
    const fake = { dataUpdateTopic: 'device/SN1/report' };
    c.client = { getMqttClient: () => fake };
    c._patchCommandTopic();
    return fake.dataUpdateTopic;
  };
  assert.equal(topicFor('X1C'), 'device/SN1/request');
  assert.equal(topicFor('H2D'), 'device/SN1/request');
  assert.equal(topicFor('P1S'), 'device/SN1/report');
  assert.equal(topicFor('A1 mini'), 'device/SN1/report');
});

// ---------- cameraKind：画面通道分型 ----------
check('机型画面通道分型', () => {
  assert.strictEqual(manager.cameraKind({ model: 'H2D' }), 'rtsp');
  assert.strictEqual(manager.cameraKind({ model: 'X1C' }), 'rtsp');
  // 2026-10-17 A1 mini 实机实证：P1/A1 → mjpeg（6000 TLS+认证包 JPEG 帧流）
  assert.strictEqual(manager.cameraKind({ model: 'P1S' }), 'mjpeg');
  assert.strictEqual(manager.cameraKind({ model: 'A1 mini' }), 'mjpeg');
  assert.strictEqual(manager.cameraKind({ model: 'AD5M' }), 'mjpeg');
  assert.strictEqual(manager.cameraKind({ model: '奇形怪状' }), null);
});

// ---------- client 参数校验（校验前置于连接检查，未连接也可测） ----------
const client = new PrinterClient({ id: 1, name: '测试机', model: 'H2D', host: '127.0.0.1', accessCode: '00000000', serial: 'TEST' });

(async () => {

checkAsync('速度档非法值拒绝', async () => {
  for (const bad of [0, 5, -1, 2.5, 'a', null, undefined]) {
    await assert.rejects(() => client.setSpeed(bad), /速度档/, `level=${bad} 应拒`);
  }
});
checkAsync('速度档合法值通过校验（卡在未连接）', async () => {
  await assert.rejects(() => client.setSpeed(3), /未连接/);
});

checkAsync('风扇类型与速度域校验', async () => {
  await assert.rejects(() => client.setFanSpeed('side', 10), /风扇类型/);
  await assert.rejects(() => client.setFanSpeed(null, 10), /风扇类型/);
  await assert.rejects(() => client.setFanSpeed('part', 256), /风扇速度/);
  await assert.rejects(() => client.setFanSpeed('part', -1), /风扇速度/);
  await assert.rejects(() => client.setFanSpeed('part', 1.5), /风扇速度/);
  await assert.rejects(() => client.setFanSpeed('CHAMBER', 128), /未连接/);
});

checkAsync('gcode 空与超长拒绝', async () => {
  await assert.rejects(() => client.sendGcode(''), /gcode 不能为空/);
  await assert.rejects(() => client.sendGcode('   '), /gcode 不能为空/);
  await assert.rejects(() => client.sendGcode('N'.repeat(801)), /过长/);
  await assert.rejects(() => client.sendGcode('M104 S220'), /未连接/);
});

checkAsync('轴移动参数域校验', async () => {
  await assert.rejects(() => client.moveAxis('w', 1), /轴必须/);
  await assert.rejects(() => client.moveAxis(null, 1), /轴必须/);
  await assert.rejects(() => client.moveAxis('x', 0), /非 0/);
  await assert.rejects(() => client.moveAxis('x', NaN), /非 0/);
  await assert.rejects(() => client.moveAxis('x', 101), /不能超过 100/);
  await assert.rejects(() => client.moveAxis('z', -101), /不能超过 100/);
  await assert.rejects(() => client.moveAxis('X', 10), /未连接/);
});

checkAsync('校准/回原点/退料未连接报错', async () => {
  await assert.rejects(() => client.calibration(), /未连接/);
  await assert.rejects(() => client.home(), /未连接/);
  await assert.rejects(() => client.unloadFilament(), /未连接/);
  await assert.rejects(() => client.cleanPrintError(), /未连接/);
});

check('decodeNozzleTemp:打印中打包值与空闲普通值（2026-10-16 实测编码）', () => {
  const { decodeNozzleTemp } = require('../src/printer/client');
  assert.deepEqual(decodeNozzleTemp(14418139), { current: 219, target: 220 }, '打包值：低16=当前219、高16=目标220');
  assert.deepEqual(decodeNozzleTemp(2752554), { current: 42, target: 42 }, '打包值：42/42');
  assert.deepEqual(decodeNozzleTemp(14418140), { current: 220, target: 220 }, '实测第二采样点');
  assert.deepEqual(decodeNozzleTemp(33), { current: 33, target: null }, '空闲普通值原样');
  assert.deepEqual(decodeNozzleTemp(null), { current: null, target: null });
});

checkAsync('灯控 lamp 参数归一（腔灯缺省/工作灯）', async () => {
  // 未连接会在连接检查处抛错，但 lamp 归一发生在组帧前——仅验证不抛参数错
  await assert.rejects(() => client.lightControl(true), /未连接/);
  await assert.rejects(() => client.lightControl(true, 'work_light'), /未连接/);
  await assert.rejects(() => client.lightControl(true, '奇怪的灯'), /未连接/); // 归一为 chamber_light
});

checkAsync('灯控节点按机型分型（H2D=chamber_light2 / X1C=chamber_light；两机工作灯同名）', async () => {
  // 2026-10-16 X1C 真机实证：X1C 只有 chamber_light/work_light，误发 chamber_light2 被拒
  // 「did not find the valid led: chamber_light2」（生产错误日志实锤）
  const mk = (model) => {
    const c = new PrinterClient({ name: model, model, host: '127.0.0.1', serial: 'S', accessCode: 'A' });
    c.client = {}; c.connected = true;
    const seen = [];
    c._sendChecked = (payload) => { seen.push(payload); return Promise.resolve(); };
    return { c, seen };
  };
  const h2 = mk('H2D');
  await h2.c.lightControl(true);
  await h2.c.lightControl(false, 'work_light');
  assert.strictEqual(h2.seen[0].system.led_node, 'chamber_light2', 'H2D 腔灯=副腔灯节点');
  assert.strictEqual(h2.seen[1].system.led_node, 'work_light');
  const x1 = mk('X1C');
  await x1.c.lightControl(true);
  await x1.c.lightControl(false, 'work_light');
  assert.strictEqual(x1.seen[0].system.led_node, 'chamber_light', 'X1C 无 chamber_light2 节点');
  assert.strictEqual(x1.seen[1].system.led_node, 'work_light');
  assert.strictEqual(typeof x1.seen[0].system.sequence_id, 'string', '新世代字符串 seq（X1C 实测格式）');
  assert.strictEqual(x1.seen[0].system.led_mode, 'on');
});

// ---------- 能力矩阵（2026-10-18 P0：机型能力单一事实源） ----------
check('能力矩阵：机型 → 品牌/世代/相机/命令通道', () => {
  const { capabilitiesFor } = require('../src/printer/capabilities');
  const h2 = capabilitiesFor('H2D');
  assert.equal(h2.brand, 'bambu');
  assert.equal(h2.generation, 'new');
  assert.equal(h2.camera, 'rtsp');
  assert.equal(h2.commandTopic, 'request');
  const p1 = capabilitiesFor('P1S');
  assert.equal(p1.generation, 'old');
  assert.equal(p1.camera, 'mjpeg');
  assert.equal(p1.commandTopic, 'report');
  assert.equal(capabilitiesFor('A1 mini').camera, 'mjpeg');
  const ff = capabilitiesFor('Creator 5 Pro');
  assert.equal(ff.brand, 'flashforge');
  assert.equal(ff.commandTopic, 'http');
  const unknown = capabilitiesFor('奇形怪状');
  assert.equal(unknown.brand, 'bambu');
  assert.equal(unknown.camera, null);
  assert.equal(unknown.commandTopic, 'report');
  assert.equal(capabilitiesFor('X1C').version, 'v1');
});

// 异步断言全部收尾后再退（checkAsync 不阻塞同步流程，直接 exit 会抢杀未决断言）
await Promise.resolve();
setTimeout(() => process.exit(failures ? 1 : 0), 50);
})();
