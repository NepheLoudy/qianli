/**
 * 打印机上传通道分流单测（2026-10-07 FTPS 批）：
 * P1/A1 新固件只开官方 FTPS(990)（21 明文口已关，实测）——FTPS 优先、FTP(21) 回退、
 * X1/H2D 仍走 SFTP(22)。mock basic-ftp 验证 connectFTPS 连接参数（端口/implicit TLS/凭证）。
 * 用法：node test/printer-upload-channel-test.js
 */
// 在 client.js 加载前把 basic-ftp 替换成 mock（client.js 顶层 require basic-ftp）
const basicFtpPath = require.resolve('basic-ftp');
class MockFTPSClient {
  constructor(timeout) { this.timeout = timeout; MockFTPSClient.instances.push(this); }
  async access(opts) {
    MockFTPSClient.accessCalls.push(opts);
    if (MockFTPSClient.accessShouldFail) throw new Error('mock access fail');
  }
  async uploadFrom(buf, remote) {
    MockFTPSClient.uploads.push(String(remote));
    if (MockFTPSClient.uploadShouldFail) throw new Error('mock upload fail');
  }
  close() { this.closed = true; }
}
MockFTPSClient.instances = [];
MockFTPSClient.accessCalls = [];
MockFTPSClient.uploads = [];
MockFTPSClient.accessShouldFail = false;
MockFTPSClient.uploadShouldFail = false;
require.cache[basicFtpPath] = {
  id: basicFtpPath, filename: basicFtpPath, loaded: true, exports: { Client: MockFTPSClient },
};

const assert = require('assert');
const PrinterClient = require('../src/printer/client.js');

let failures = 0;
let passed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`  ✗ ${name}\n    ${err.message}`);
  }
}

function reset() {
  MockFTPSClient.instances = [];
  MockFTPSClient.accessCalls = [];
  MockFTPSClient.uploads = [];
  MockFTPSClient.accessShouldFail = false;
  MockFTPSClient.uploadShouldFail = false;
}

function makeClient(model) {
  return new PrinterClient({
    id: 1, name: `测试-${model}`, model,
    host: '192.168.2.189', accessCode: '12345678', serial: '00M09TEST',
  });
}

(async () => {
  console.log('== 上传通道分流 ==');

  await test('P1S：FTPS(990) 成功时不碰 FTP(21)（2026-10-18 实证：写 SD 根，剥 /sdcard 前缀）', async () => {
    reset();
    const c = makeClient('P1S');
    let ftpCalled = 0;
    c.ftpPut = async () => { ftpCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/a.3mf');
    assert.strictEqual(MockFTPSClient.uploads[0], '/a.3mf', 'P1S FTP 根=SD 卡根，应写根路径');
    assert.strictEqual(ftpCalled, 0, 'FTP(21) 不应被调用');
  });

  await test('P1S：FTPS 失败回退 FTP(21) 且断开坏 FTPS 会话', async () => {
    reset();
    MockFTPSClient.uploadShouldFail = true;
    const c = makeClient('P1S');
    let ftpCalled = 0;
    c.ftpPut = async () => { ftpCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/b.3mf');
    assert.strictEqual(ftpCalled, 1, 'FTP(21) 回退应被调用');
    assert.strictEqual(c.ftpsClient, null, 'FTPS 坏会话应被置空');
    assert.strictEqual(MockFTPSClient.instances[0].closed, true, 'FTPS 客户端应被 close');
  });

  await test('P1S：FTPS 与 FTP 双失败时错误信息含两个通道', async () => {
    reset();
    MockFTPSClient.uploadShouldFail = true;
    const c = makeClient('P1S');
    c.ftpPut = async () => { throw new Error('ECONNREFUSED 21'); };
    await assert.rejects(
      () => c.uploadBuffer(Buffer.from('x'), '/sdcard/c.3mf'),
      (err) => /FTPS\(990\)/.test(err.message) && /FTP\(21\)/.test(err.message) && /mock upload fail/.test(err.message)
    );
  });

  // v56 勘误（2026-10-15 真机 H2D 实测 22/21 全关）：全机型统一 FTPS(990) 优先、FTP(21) 回退，
  // 「X1C/H2D 走 SFTP(22)」旧假设作废——uploadBuffer 不再按机型分流
  await test('X1C：统一走 FTPS(990) 优先，不碰 SFTP', async () => {
    reset();
    const c = makeClient('X1C');
    let sftpCalled = 0;
    let ftpsCalled = 0;
    c.sftpPut = async () => { sftpCalled++; };
    c.ftpsPut = async () => { ftpsCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/d.3mf');
    assert.strictEqual(ftpsCalled, 1);
    assert.strictEqual(sftpCalled, 0);
  });

  await test('H2D：统一走 FTPS(990) 优先（22/21 真机全关）', async () => {
    reset();
    const c = makeClient('H2D');
    let sftpCalled = 0;
    let ftpsCalled = 0;
    c.sftpPut = async () => { sftpCalled++; };
    c.ftpsPut = async () => { ftpsCalled++; };
    await c.uploadBuffer(Buffer.from('x'), '/sdcard/e.3mf');
    assert.strictEqual(ftpsCalled, 1);
    assert.strictEqual(sftpCalled, 0);
  });

  // 2026-10-18 P1S 实证：老世代 project_file URL 与上传路径同口径改根（ftp:///<name>），
  // `ftp:///sdcard/...` 指向不存在的目录（P1S FTP 根=SD 卡根，实测 550）
  await test('P1S：project_file URL 用根路径 ftp:///<name>', async () => {
    reset();
    const c = makeClient('P1S');
    c.connected = true;
    let captured = null;
    c.client = {
      getMqttClient: () => ({
        sendCommand: async (json) => { captured = JSON.parse(json); return { print: { result: 'success' } }; },
      }),
    };
    await c.startProjectFile('j.gcode.3mf', '测试任务', false, null, {});
    assert.strictEqual(captured.print.command, 'project_file');
    assert.strictEqual(captured.print.url, 'ftp:///j.gcode.3mf');
  });

  console.log('== connectFTPS 连接参数 ==');

  await test('FTPS 连接：990 / implicit TLS / bblp + Access Code / 跳过自签校验', async () => {
    reset();
    const c = makeClient('P1S');
    await c.connectFTPS();
    const opts = MockFTPSClient.accessCalls[0];
    assert.strictEqual(opts.host, '192.168.2.189');
    assert.strictEqual(opts.port, 990);
    assert.strictEqual(opts.user, 'bblp');
    assert.strictEqual(opts.password, '12345678');
    assert.strictEqual(opts.secure, 'implicit');
    assert.strictEqual(opts.secureOptions.rejectUnauthorized, false);
    // 2026-10-19 实锤：2.37MB 自动切片上传耗时 29.6s——控制通道 15s 会误判超时；
    // 放宽到 ≥120s（Client(timeout) 同时管连接与传输期控制通道空闲）
    assert.ok(MockFTPSClient.instances[0].timeout >= 120000, `控制通道超时应 ≥120s，实际 ${MockFTPSClient.instances[0].timeout}`);
  });

  await test('FTPS 连接失败时不残留客户端', async () => {
    reset();
    MockFTPSClient.accessShouldFail = true;
    const c = makeClient('P1S');
    await assert.rejects(() => c.connectFTPS(), /mock access fail/);
    assert.strictEqual(c.ftpsClient, null);
    assert.strictEqual(MockFTPSClient.instances[0].closed, true);
  });

  console.log('== disconnectFileSession 清理 ==');

  await test('disconnectFileSession 会同时清理 FTPS 会话', async () => {
    reset();
    const c = makeClient('P1S');
    await c.connectFTPS();
    assert.ok(c.ftpsClient);
    await c.disconnectFileSession();
    assert.strictEqual(c.ftpsClient, null);
    assert.strictEqual(MockFTPSClient.instances[0].closed, true);
  });

  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
})();
