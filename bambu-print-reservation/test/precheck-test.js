// 提交初审单测（2026-10-28 曼波令「程序初审」）：3mf 内嵌机型/耗材/占用三维预检
const assert = require('assert');
// 阻断真机连接（2026-10-16 二踩教训：依赖链 require manager 即 init 连生产）
const process_env_guard = { hosts: '', codes: '', serials: '', names: '', models: '' };
process.env.PRINTER_HOSTS = process_env_guard.hosts;
process.env.PRINTER_ACCESS_CODES = process_env_guard.codes;
process.env.PRINTER_SERIALS = process_env_guard.serials;
process.env.PRINTER_NAMES = process_env_guard.names;
process.env.PRINTER_MODELS = process_env_guard.models;
const { precheckSlicedSubmission } = require('../src/services/reservation');

let pass = 0;
let fail = 0;
const checks = [];
function check(name, fn) { checks.push([name, fn]); }

async function main() {
  const printers = [
    { id: '1', name: 'A1mini', model: 'A1 mini', autoDispatch: true },
    { id: '2', name: 'X1C', model: 'X1C', autoDispatch: true },
  ];
  const a1Online = { id: '1', stateStale: false, ams: [{ slot: '外部料架', type: 'PLA', amsId: 254, trayId: 0 }] };

  checks.push(['机队无同品牌机：禁止提交（跨品牌铁律，v64 前为「无同型号」口径）', async () => {
    const ff = { id: '5', name: 'A5P', model: 'Flashforge Adventurer 5M Pro', autoDispatch: true };
    const v = precheckSlicedSubmission({ machineModel: 'Bambu Lab P1S', filaments: [{ type: 'PLA' }], printers: [ff], apiStates: [] });
    assert.strictEqual(v.blocked, true);
    assert.ok(/同品牌登记机/.test(v.errors[0]));
    assert.ok(/现有机型/.test(v.errors[0]), '报错带机队现有机型清单');
  }]);

  checks.push(['X1 Carbon 全称↔X1C 缩写：放行（2026-10-29 误拦案回归）', async () => {
    const x1c = { id: '2', name: 'X1C', model: 'X1C', autoDispatch: true };
    const x1cStates = [{ id: '2', stateStale: false, ams: [{ slot: 'AMS 0', type: 'PLA' }] }];
    const v1 = precheckSlicedSubmission({ machineModel: 'X1 Carbon', filaments: [{ type: 'PLA' }], printers: [x1c], apiStates: x1cStates });
    assert.strictEqual(v1.blocked, false, 'X1 Carbon 应归一匹配 X1C');
    const v2 = precheckSlicedSubmission({ machineModel: 'Bambu Lab X1 Carbon 0.4 nozzle', filaments: [{ type: 'PLA' }], printers: [x1c], apiStates: x1cStates });
    assert.strictEqual(v2.blocked, false, '带喷嘴尾缀的长串同样放行');
    const v3 = precheckSlicedSubmission({ machineModel: 'X1 Carbon', filaments: [{ type: 'PLA' }], printers: [printers[0]], apiStates: [a1Online] });
    assert.strictEqual(v3.blocked, false, 'v64 品牌族放行：Bambu 件在 Bambu 队不再硬拦');
    assert.ok(v3.warnings.some((w) => /不在机队/.test(w)), '应带机型不在队的兼容警告');
  }]);

  checks.push(['v64 P2S 实案：队内无 P2S 但有拓竹机 → 放行+警告（Poop-Bucket 实案回归）', async () => {
    const h2d = { id: '9', name: 'H2D', model: 'H2D', autoDispatch: true };
    const v = precheckSlicedSubmission({ machineModel: 'Bambu Lab P2S', filaments: [{ type: 'PLA' }], printers: [h2d, printers[0]], apiStates: [] });
    assert.strictEqual(v.blocked, false, 'P2S 切的件应放行到拓竹机');
    assert.ok(v.warnings.some((w) => /P2S/.test(w) && /兼容/.test(w)), '应提示按同品牌兼容处理');
  }]);

  checks.push(['v64 跨品牌仍拦：P2S 切片对纯闪铸队 → 硬拦', async () => {
    const ff = { id: '3', name: 'A5P', model: 'Flashforge Adventurer 5M Pro', autoDispatch: true };
    const v = precheckSlicedSubmission({ machineModel: 'Bambu Lab P2S', filaments: [{ type: 'PLA' }], printers: [ff], apiStates: [] });
    assert.strictEqual(v.blocked, true, '品牌不符铁律不变');
  }]);

  checks.push(['同型号有机但无对应耗材：禁止提交', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'Bambu Lab A1 mini', filaments: [{ type: 'PETG' }],
      printers: [printers[0]], apiStates: [a1Online],
    });
    assert.strictEqual(v.blocked, true);
    assert.ok(/没有本件所需耗材/.test(v.errors[0]));
  }]);

  checks.push(['耗材齐全：放行', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'Bambu Lab A1 mini', filaments: [{ type: 'PLA' }],
      printers: [printers[0]], apiStates: [a1Online],
    });
    assert.strictEqual(v.blocked, false);
    assert.strictEqual(v.errors.length, 0);
  }]);

  checks.push(['家族软匹配：PLA-CF 用料对 PLA 料位按 family 放行', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'A1 mini', filaments: [{ type: 'PLA-CF' }],
      printers: [printers[0]], apiStates: [a1Online],
    });
    assert.strictEqual(v.blocked, false, 'family 级放行（与分发映射同口径）');
  }]);

  checks.push(['状态失联：耗材初审降级为警告不误杀', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'A1 mini', filaments: [{ type: 'PETG' }],
      printers: [printers[0]], apiStates: [{ id: '1', stateStale: true, ams: [] }],
    });
    assert.strictEqual(v.blocked, false);
    assert.ok(v.warnings.some((w) => /失联/.test(w)));
  }]);

  checks.push(['目标机占用：放行并告知排队', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'A1 mini', filaments: [{ type: 'PLA' }],
      printers: [printers[0]], apiStates: [a1Online],
      queueInfo: { printing: ['A1mini'], holdPrinterIds: [], queueLength: 2 },
    });
    assert.strictEqual(v.blocked, false);
    assert.ok(v.warnings.some((w) => /进入队列/.test(w)));
    assert.ok(v.warnings.some((w) => /2 单/.test(w)));
  }]);

  checks.push(['持闸也算占用', async () => {
    const v = precheckSlicedSubmission({
      machineModel: 'A1 mini', filaments: [{ type: 'PLA' }],
      printers: [printers[0]], apiStates: [a1Online],
      queueInfo: { printing: [], holdPrinterIds: ['1'], queueLength: 0 },
    });
    assert.ok(v.warnings.some((w) => /占用中/.test(w)));
  }]);

  checks.push(['无内嵌机型：初审跳过不误杀', async () => {
    const v = precheckSlicedSubmission({ machineModel: null, filaments: [], printers, apiStates: [] });
    assert.strictEqual(v.blocked, false);
  }]);

  for (const [name, fn] of checks) {
    try { await fn(); console.log(`✓ ${name}`); pass++; }
    catch (err) { console.error(`✗ ${name}\n  ${err.message}`); fail++; }
  }
  console.log(`\n提交初审单测: ${pass} 通过 / ${fail} 失败`);
  if (fail) process.exit(1);
}
main().catch((err) => { console.error(err); process.exit(1); });
