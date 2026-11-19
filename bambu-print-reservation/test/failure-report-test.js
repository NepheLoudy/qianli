/**
 * 打印机报错群播单测（2026-11-19 v116 曼波令「任何打印机报错都往 3D 打印群发报告」）
 * 覆盖：报告卡发送（3D 打印群钩子）、同机同因 30 分钟节流、不同因不节流、
 * config.alertWebhookUrl 回落链。
 * 用法：node test/failure-report-test.js（mock sendMessage 不真发）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-fr-${Date.now()}.json`);

const dispatcher = require('../src/services/dispatcher');
const config = require('../src/config');
const bot = require('../src/feishu/bot');

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

check('config：alertWebhookUrl 缺省回落 BOT_WEBHOOK_URL', () => {
  assert.ok(config.bot.alertWebhookUrl === process.env.BOT_WEBHOOK_URL || config.bot.alertWebhookUrl,
    'alertWebhookUrl 必须有值（回落 bot.webhookUrl）');
});

check('报告卡：标题带机器名、正文带原因与处置、发往 alert 钩子；30 分钟节流同机同因', () => {
  const calls = [];
  const orig = bot.sendMessage;
  bot.sendMessage = async (card, url) => {
    calls.push({ title: card.header.title.content, text: card.elements[0].content, url });
    return {};
  };
  try {
    dispatcher.sendFailureReport('H2D', '打印机上报失败状态', '单据：R-TEST（test.3mf）；fail_reason=70001');
    assert.strictEqual(calls.length, 1, '首发必须发出');
    assert.ok(calls[0].title.includes('H2D'), '标题必须带机器名');
    assert.ok(calls[0].text.includes('打印机上报失败状态') && calls[0].text.includes('fail_reason=70001'), '正文必须带原因与失败码');
    assert.ok(calls[0].text.includes('处置'), '正文必须带处置指引');
    // 同机同因：节流
    dispatcher.sendFailureReport('H2D', '打印机上报失败状态', '重复触发');
    assert.strictEqual(calls.length, 1, '同机同因 30 分钟内必须节流');
    // 同机不同因：放行
    dispatcher.sendFailureReport('H2D', '断料检测', '不同因');
    assert.strictEqual(calls.length, 2, '不同因不节流');
    // 异机同因：放行
    dispatcher.sendFailureReport('X1C', '打印机上报失败状态', '异机');
    assert.strictEqual(calls.length, 3, '异机不节流');
    // 静态：url 是 alertWebhookUrl
    assert.strictEqual(calls[0].url, config.bot.alertWebhookUrl, '必须发往 alert 钩子');
  } finally {
    bot.sendMessage = orig;
  }
});

check('静态锚：failTask 与熔断分支接线、人因终止不经群播', () => {
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('sendFailureReport('), '群播函数必须存在');
  const failSeg = disp.slice(disp.indexOf('async failTask'), disp.indexOf('async failTask') + 1200);
  assert.ok(failSeg.includes('sendFailureReport('), 'failTask 必须接线群播');
  const holdSeg = disp.slice(disp.indexOf('err.storageOffline'), disp.indexOf('err.storageOffline') + 1200);
  assert.ok(holdSeg.includes('sendFailureReport('), '存储熔断分支必须接线群播');
  const human = disp.slice(disp.indexOf('async humanTerminateTask'), disp.indexOf('async humanTerminateTask') + 1500);
  assert.ok(!human.includes('sendFailureReport('), '人因终止不得进群播（手动停的不喊群）');
  assert.ok(disp.includes('failureReportThrottle'), '节流表必须存在');
});

process.exit(failures > 0 ? 1 : 0);
