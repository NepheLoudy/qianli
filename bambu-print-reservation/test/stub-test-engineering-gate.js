/**
 * 工程 3mf 分发闸单测（2026-11-08 v100 曼波令「为什么阻拦没有触发」实案收口）
 * 实案：R20261107-001/-002（A面.3mf 工程件）审批后分发——现场切片触发条件只认
 * stl/step 后缀，34KB 无刀轨原件直通上传 → H2D 秒 FAILED / X1C 553 重试耗尽。
 * 修复：①分发触发条件补工程 3mf（autoSlice 的 prepareModelPath 3mf 分支 v64 就绪）
 * ②直通上传前 hasSlicedGcode fail-closed（noRetry 确定性失败直接退出队列）。
 * 用法：node test/stub-test-engineering-gate.js（PRINTER_HOSTS='' 隔离）
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

process.env.PLAZA_BITABLE_TABLE_ID = '';
process.env.PRINTER_HOSTS = '';
process.env.DISPATCH_STATE_FILE = path.join(require('os').tmpdir(), `bambu-test-state-eng-${Date.now()}.json`);

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

check('autoSlice.prepareModelPath 支持工程 3mf（v64 分支健在，不因本次修复退化）', () => {
  const src = fs.readFileSync(path.join(__dirname, '../src/services/autoSlice.js'), 'utf8');
  assert.ok(src.includes("require('../utils/engine3mf').parseEngineering3mf"), '工程 3mf 自解析分支必须存在');
  assert.ok(src.includes("if (/\\.3mf$/i.test(fileName || ''))"), '3mf 后缀入口必须健在');
});

check('分发触发条件补工程 3mf（modelFeatures.engineering / embeddedParams.source 双判）', () => {
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('isEngineering3mf'), '工程件判定变量必须存在');
  assert.ok(disp.includes('task.modelFeatures && task.modelFeatures.engineering === true'), '必须认提交口入档的 engineering 标记');
  assert.ok(disp.includes("(isUnslicedFileName(task.fileName || '') || isEngineering3mf) && isLocalTask(task)"), '现场切片触发必须覆盖工程 3mf');
});

check('fail-closed 双保险：无刀轨 3mf 绝不直通上机 + noRetry 快速终局', () => {
  const disp = fs.readFileSync(path.join(__dirname, '../src/services/dispatcher.js'), 'utf8');
  assert.ok(disp.includes('!slicerExtract.hasSlicedGcode(buffer)'), '上传前必须验刀轨数据');
  assert.ok(disp.includes('gateErr.noRetry = true'), '确定性拦截必须带 noRetry');
  assert.ok(disp.includes('err.noRetry ? config.dispatch.maxRetries'), '重试计数必须识别 noRetry 直接终局');
});

check('真件回归（可选）：A面.3mf 若仍在服务器/本地，hasSlicedGcode 必须判 false', () => {
  const { hasSlicedGcode } = require('../src/services/slicerExtract');
  const zip = new (require('adm-zip'))();
  zip.addFile('3D/3dmodel.model', Buffer.from('<model/>'));
  zip.addFile('Metadata/model_settings.config', Buffer.from('<config/>'));
  assert.strictEqual(hasSlicedGcode(zip.toBuffer()), false, '工程件（无 plate gcode）必须判否');
  const sliced = new (require('adm-zip'))();
  sliced.addFile('Metadata/plate_1.gcode', Buffer.from(';gcode\n'));
  assert.strictEqual(hasSlicedGcode(sliced.toBuffer()), true, '切片产物必须判真');
});

process.exit(failures > 0 ? 1 : 0);
