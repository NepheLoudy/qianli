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

  checks.push(['机队无同型号机：禁止提交', async () => {
    const v = precheckSlicedSubmission({ machineModel: 'Bambu Lab X1C', filaments: [{ type: 'PLA' }], printers: [printers[0]], apiStates: [] });
    assert.strictEqual(v.blocked, true);
    assert.ok(/同型号登记机/.test(v.errors[0]));
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
