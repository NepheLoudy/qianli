// 闪铸局域网客户端桩测试（2026-10-14 双品牌纯内网批）：
// mock 全局 fetch 校验 8898 REST 报文形状 + 状态归一化 + 品牌/画面/文件分派纯函数。
// 协议参照：Parallel-7/flashforge-api-docs（AD5M/5M Pro 固件 3.2.7）
const assert = require('assert');
const FlashforgeClient = require('../src/printer/flashforge');
const printerManager = require('../src/printer/manager');
const dispatcher = require('../src/services/dispatcher');

const PRINTER = { id: 9, name: '闪铸测试机', model: 'AD5M Pro', host: '192.168.2.90', serial: 'SN90', accessCode: 'CHK90' };

let passed = 0;
function ok(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((err) => { console.error(`  ✗ ${name}:`, err.message); process.exitCode = 1; });
}

// ---- fetch mock 基座：按路径挂处理器，记录最近请求 ----
const calls = [];
function mockFetch(routes) {
  global.fetch = async (url, opts = {}) => {
    const path = new URL(url).pathname;
    calls.push({ path, url, opts });
    const handler = routes[path];
    if (!handler) return { ok: false, status: 404, text: async () => 'no route' };
    const [status, body] = Array.isArray(handler) ? handler : [200, handler];
    return { ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
}

// 真机 /detail 信封（2026-10-16 A5P 实测 {code:0, detail:{...}}）——v53 桩误用内层直存，
// 漏掉解包 bug（真机上状态/温度/进料口全空）；桩按真机形状建模让解包路径进入回归
const DETAIL_INNER = {
  status: 'printing', printProgress: 0.42, estimatedTime: 1500, printDuration: 3600,
  printFileName: 'benchy.gcode', printLayer: 88, targetPrintLayer: 210,
  platTemp: 61, platTargetTemp: 60, rightTemp: 221, rightTargetTemp: 220, leftTemp: 26, leftTargetTemp: 0,
  cameraStreamUrl: 'http://192.168.2.90:8080/?action=stream', nozzleCnt: 1,
  pid: '36', doorStatus: 'close', lightStatus: 'on', tvoc: 0.08,
  estimatedLeftWeight: 850.5, estimatedRightWeight: 912.3,
  firmwareVersion: '3.2.7', ipAddr: '192.168.2.90', macAddr: 'aa:bb:cc:dd:ee:ff',
};
const DETAIL = { code: 0, detail: DETAIL_INNER };

(async () => {
  console.log('== 闪铸客户端（flashforge.js）==');

  await ok('品牌/画面/文件分派纯函数', () => {
    assert.strictEqual(printerManager.brandOf('AD5M'), 'flashforge');
    assert.strictEqual(printerManager.brandOf('AD5M Pro'), 'flashforge');
    assert.strictEqual(printerManager.brandOf('Creator 5 Pro'), 'flashforge');
    assert.strictEqual(printerManager.brandOf('P1S'), 'bambu');
    assert.strictEqual(printerManager.brandOf('X1 Carbon'), 'bambu');
    assert.strictEqual(printerManager.brandOf('H2D'), 'bambu');
    assert.strictEqual(printerManager.cameraKind({ model: 'AD5M Pro' }), 'mjpeg');
    // 2026-10-17 A1 mini 实机实证：P1/A1=6000 TLS+认证包 JPEG 帧流 → mjpeg 代理
    // （原「p1stream 裸 H.264」假设作废）
    assert.strictEqual(printerManager.cameraKind({ model: 'P1S' }), 'mjpeg');
    assert.strictEqual(printerManager.cameraKind({ model: 'X1C' }), 'rtsp');
    assert.strictEqual(printerManager.cameraKind({ model: 'A1 mini' }), 'mjpeg');
    assert.strictEqual(dispatcher.brandForFile('a.gcode'), 'flashforge');
    assert.strictEqual(dispatcher.brandForFile('b.GX'), 'flashforge');
    assert.strictEqual(dispatcher.brandForFile('c.g'), 'flashforge');
    assert.strictEqual(dispatcher.brandForFile('d.3mf'), 'bambu');
    assert.strictEqual(dispatcher.brandForFile('e.stl'), 'bambu');
  });

  await ok('无凭据 connect 拒绝（fail-closed）', async () => {
    const c = new FlashforgeClient({ ...PRINTER, serial: '', accessCode: '' });
    await assert.rejects(() => c.connect(), /序列号|检查码/);
  });

  await ok('/detail 轮询 → 状态归一（printing→PRINTING，进度/剩余/温度）', async () => {
    mockFetch({ '/detail': DETAIL });
    const c = new FlashforgeClient(PRINTER);
    c.on('connect', () => {});
    await c.connect();
    // pollOnce 首轮是同步发起的，但 fetch 是微任务——等一拍
    await new Promise((r) => setTimeout(r, 20));
    const st = c.getPrintStatus();
    assert.strictEqual(c.connected, true);
    assert.strictEqual(st.gcodeState, 'PRINTING');
    assert.strictEqual(st.status, '打印中');
    assert.strictEqual(st.progress, 42);
    assert.strictEqual(st.remainingMinutes, 25); // 1500s → 25min
    assert.strictEqual(st.currentFile, 'benchy.gcode');
    assert.strictEqual(st.nozzleTemp, 221);
    assert.strictEqual(st.bedTemp, 61);
    assert.strictEqual(st.nozzleTargetTemp, 220);
    assert.strictEqual(c.isStateStale(), false);
    await c.disconnect();
  });

  await ok('AMS 归一：双进料口机出左右两条；单口机出「进料口」一条', async () => {
    mockFetch({ '/detail': DETAIL });
    const c = new FlashforgeClient(PRINTER);
    await c.connect();
    await new Promise((r) => setTimeout(r, 20));
    const trays = c.getAmsTrays();
    assert.strictEqual(trays.length, 2);
    assert.strictEqual(trays[0].slot, '左进料口');
    // 2026-10-22 曼波反馈「A5P 没有 AMS」：余量走独立克数字段，不冒充材料类型
    assert.strictEqual(trays[0].type, '', '5M 系无机端料名，type 不得装余量字符串');
    assert.strictEqual(trays[0].remain, 851, '左口余量克数: ' + trays[0].remain);
    assert.strictEqual(trays[0].remainUnit, 'g');
    assert.strictEqual(trays[1].slot, '右进料口');
    assert.strictEqual(trays[1].remain, 912, '右口余量克数: ' + trays[1].remain);
    assert.strictEqual(trays[1].active, true);
    await c.disconnect();
    // 单口机型（5M 基础款无 left 字段）→ 单条「进料口」
    const single = new FlashforgeClient(PRINTER);
    single.state = { ...DETAIL_INNER, leftTemp: null, leftTargetTemp: null, estimatedLeftWeight: null };
    const t1 = single.getAmsTrays();
    assert.strictEqual(t1.length, 1);
    assert.strictEqual(t1[0].slot, '进料口');
    assert.strictEqual(t1[0].remain, 912);
  });

  await ok('cameraUrl：优先 /detail 下发，回退 8080 出厂默认', async () => {
    mockFetch({ '/detail': DETAIL });
    const c = new FlashforgeClient(PRINTER);
    await c.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(c.getCameraUrl(), 'http://192.168.2.90:8080/?action=stream');
    const c2 = new FlashforgeClient(PRINTER); // 无 /detail 数据（未连接）
    assert.strictEqual(c2.getCameraUrl(), 'http://192.168.2.90:8080/?action=stream');
    await c.disconnect();
  });

  await ok('getDeviceInfo：与拓竹同形状（manager.handleStateChange 直调契约）', async () => {
    const c = new FlashforgeClient(PRINTER);
    assert.strictEqual(typeof c.getDeviceInfo, 'function', '缺失会让状态事件整链被 TypeError 吞掉（2026-10-16 真机接入事故）');
    const info = c.getDeviceInfo();
    assert.ok(info && typeof info === 'object', '应返回对象');
    await c.disconnect();
  });

  await ok('暂停/恢复/停止 → /control jobCtl_cmd payload（cmd/args 信封，JSON 字符串化）', async () => {
    mockFetch({ '/detail': DETAIL, '/control': { code: 0, message: 'success' } });
    const c = new FlashforgeClient(PRINTER);
    await c.connect();
    await new Promise((r) => setTimeout(r, 20));
    calls.length = 0;
    await c.pausePrint();
    await c.resumePrint();
    await c.stopPrint();
    const ctrls = calls.filter((x) => x.path === '/control');
    assert.strictEqual(ctrls.length, 3);
    const bodies = ctrls.map((x) => JSON.parse(x.opts.body));
    bodies.forEach((b) => {
      assert.strictEqual(b.serialNumber, 'SN90');
      assert.strictEqual(b.checkCode, 'CHK90');
      assert.strictEqual(typeof b.payload, 'string', 'payload 必须是 JSON 字符串（协议要求）');
    });
    const payloads = bodies.map((b) => JSON.parse(b.payload));
    // 2026-10-16 协议实锤：信封必须是 {cmd, args}——旧「{jobCtl_cmd:{...}}」形态被固件当
    // 未知命令名静默忽略（仍回 Success，A5P 真机实证按钮点了没反应）
    payloads.forEach((p) => assert.strictEqual(p.cmd, 'jobCtl_cmd', 'cmd/args 信封结构'));
    assert.strictEqual(payloads[0].args.jobID, '');
    assert.strictEqual(payloads[0].args.action, 'pause');
    assert.strictEqual(payloads[1].args.action, 'continue');
    assert.strictEqual(payloads[2].args.action, 'cancel');
    await c.disconnect();
  });

  await ok('灯控 → lightControl_cmd open/close（cmd/args 信封）', async () => {
    mockFetch({ '/control': { code: 0 } });
    const c = new FlashforgeClient(PRINTER);
    c.state = DETAIL; c.connected = true; // 跳过 connect 直测指令
    calls.length = 0;
    await c.lightControl(true);
    await c.lightControl(false);
    const payloads = calls.filter((x) => x.path === '/control').map((x) => JSON.parse(JSON.parse(x.opts.body).payload));
    assert.strictEqual(payloads[0].cmd, 'lightControl_cmd');
    assert.strictEqual(payloads[0].args.status, 'open');
    assert.strictEqual(payloads[1].args.status, 'close');
  });

  await ok('清屏弹窗/摄像头流 → stateCtrl_cmd / streamCtrl_cmd（A5P 实证件）', async () => {
    mockFetch({ '/control': { code: 0 } });
    const c = new FlashforgeClient(PRINTER);
    c.state = DETAIL; c.connected = true;
    calls.length = 0;
    await c.clearScreenDialog();
    await c.startCameraStream();
    await c.stopCameraStream();
    const payloads = calls.filter((x) => x.path === '/control').map((x) => JSON.parse(JSON.parse(x.opts.body).payload));
    assert.strictEqual(payloads[0].cmd, 'stateCtrl_cmd');
    assert.strictEqual(payloads[0].args.action, 'setClearPlatform');
    assert.strictEqual(payloads[1].cmd, 'streamCtrl_cmd');
    assert.strictEqual(payloads[1].args.action, 'open');
    assert.strictEqual(payloads[2].cmd, 'streamCtrl_cmd');
    assert.strictEqual(payloads[2].args.action, 'close');
  });

  await ok('uploadBuffer → /uploadGcode multipart（serialNumber/checkCode/fileSize/printNow 头）', async () => {
    mockFetch({ '/uploadGcode': { code: 0, message: 'ok' } });
    const c = new FlashforgeClient(PRINTER);
    const buf = Buffer.from('FAKEGCODE');
    await c.uploadBuffer(buf, 'print_r123.gcode', { printNow: false });
    const call = calls.find((x) => x.path === '/uploadGcode');
    assert.ok(call, '未发出 uploadGcode');
    assert.strictEqual(call.opts.headers.serialNumber, 'SN90');
    assert.strictEqual(call.opts.headers.checkCode, 'CHK90');
    assert.strictEqual(call.opts.headers.fileSize, String(buf.length));
    assert.strictEqual(call.opts.headers.printNow, 'false');
    assert.strictEqual(call.opts.headers.levelingBeforePrint, 'false');
    assert.ok(call.opts.body instanceof FormData, 'multipart FormData');
    assert.ok(call.opts.body.has('gcodeFile'));
  });

  await ok('startFile → /printGcode（fileName + leveling 关）', async () => {
    mockFetch({ '/printGcode': { code: 0 } });
    const c = new FlashforgeClient(PRINTER);
    await c.startFile('print_r123.gcode');
    const call = calls.find((x) => x.path === '/printGcode');
    const body = JSON.parse(call.opts.body);
    assert.strictEqual(body.serialNumber, 'SN90');
    assert.strictEqual(body.fileName, 'print_r123.gcode');
    assert.strictEqual(body.levelingBeforePrint, 'false');
  });

  await ok('gcodeList → gcodeFileList', async () => {
    mockFetch({ '/gcodeList': { code: 0, gcodeFileList: [{ name: 'a.gcode', size: 1 }] } });
    const c = new FlashforgeClient(PRINTER);
    const files = await c.listFiles();
    assert.strictEqual(files.length, 1);
    assert.strictEqual(files[0].name, 'a.gcode');
  });

  await ok('失联判定：无数据=失联；HTTP 失败不抛到引擎（轮询容错）', async () => {
    mockFetch({});
    const c = new FlashforgeClient(PRINTER);
    assert.strictEqual(c.isStateStale(), true);
    await c.connect();
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(c.connected, false, '连续失败应保持未连接');
    assert.strictEqual(c.isStateStale(), true);
    await c.disconnect();
  });

  await ok('状态映射全集：非打印态归 IDLE（含取消中——走幽灵收尾=失败重排）', () => {
    const M = FlashforgeClient.STATUS_MAP;
    assert.strictEqual(M.printing, 'PRINTING');
    assert.strictEqual(M.pause, 'PAUSE');
    assert.strictEqual(M.pausing, 'PAUSE');
    assert.strictEqual(M.completed, 'FINISH');
    assert.strictEqual(M.error, 'FAILED');
    ['ready', 'busy', 'heating', 'canceling', 'cancel', 'calibrate_doing', 'downloading', 'cloud_slicing', 'sending', 'unzipping']
      .forEach((s) => assert.strictEqual(M[s], 'IDLE', s));
  });

  console.log(`\n闪铸客户端桩测试: ${passed} 项通过${process.exitCode ? '（有失败）' : ''}`);
  // 显式退出：require 链（bambu-link/ssh2 等）有常驻句柄，靠自然退出会挂住部署闸门
  process.exit(process.exitCode || 0);
})();
