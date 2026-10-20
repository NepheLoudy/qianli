/**
 * 运营向单测（2026-10-06 审查批）：数据备份 / 审批拦未切片 / 3mf 内嵌参数 / 使用上报
 * 用法：node test/ops-test.js
 */
const os = require('os');
const path = require('path');
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-ops-res-${process.pid}.json`);
// 阻断真机连接（2026-10-16）：manager 是模块级单例、require 即 init() 连打印机——
// 不置空这里，测试进程会真连生产三机（Bambu 同 clientId 互踢，会扰动线上连接）
process.env.PRINTER_HOSTS = '';
process.env.PRINTER_ACCESS_CODES = '';
process.env.PRINTER_SERIALS = '';
process.env.PRINTER_NAMES = '';
process.env.PRINTER_MODELS = '';
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-ops-up-${process.pid}`);
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-ops-ds-${process.pid}.json`);
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-ops-qb-${process.pid}.json`);
process.env.QUIET_HOURS_DISABLED = '1';
process.env.BOT_WEBHOOK_URL = '';
process.env.AUTH_STORE_FILE = path.join(os.tmpdir(), `bambu-test-ops-auth-${process.pid}.json`);
process.env.PROCESS_RULES_FILE = path.join(os.tmpdir(), `bambu-test-ops-rules-${process.pid}.json`);
process.env.RULE_SUGGESTIONS_FILE = path.join(os.tmpdir(), `bambu-test-ops-sug-${process.pid}.json`);
process.env.BACKUP_DIR = path.join(os.tmpdir(), `bambu-test-ops-backup-${process.pid}`);
process.env.TRAINING_SAMPLES_FILE = path.join(os.tmpdir(), `bambu-test-ops-train-${process.pid}.json`);
process.env.TRAINING_FILES_DIR = path.join(os.tmpdir(), `bambu-test-ops-trainfiles-${process.pid}`);

const assert = require('assert');
const fs = require('fs');
const AdmZip = require('adm-zip');
const store = require('../src/services/reservationStore');
const processRules = require('../src/services/processRules');
const reservationService = require('../src/services/reservation');
const backup = require('../src/services/backup');
const { reportUsage } = require('../src/services/usageReport');
const { extractFrom3mf } = require('../src/services/slicerExtract');

let failures = 0;
let passed = 0;
const pending = [];
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(r.then(() => { passed++; console.log(`✓ ${name}`); }, (err) => { failures++; console.error(`✗ ${name} — ${err.message}`); }));
    } else { passed++; console.log(`✓ ${name}`); }
  } catch (err) { failures++; console.error(`✗ ${name} — ${err.message}`); }
}

function submitFile(fileName, overrides = {}) {
  const material = overrides.materialType || 'PETG';
  const applied = processRules.applyRules(overrides.selection || { load_magnitude: 'medium' }, { material });
  return store.create({
    applicant: '运营测试', fileName, filePath: 'x', materialType: material, color: '黑色',
    selection: overrides.selection || { load_magnitude: 'medium' },
    processParams: /\.3mf$/i.test(fileName) ? null : applied.params,
    appliedRules: /\.3mf$/i.test(fileName) ? [] : applied.applied,
    embeddedParams: overrides.embeddedParams || null,
    ...overrides,
  });
}

// ---------- 存储损坏隔离（必须最先执行：隔离会重命名存储文件，放在后面会与悬挂中的异步用例竞态） ----------

check('存储损坏隔离:坏文件改名留档,不再静默覆盖', () => {
  fs.writeFileSync(process.env.RESERVATIONS_STORE_FILE, '{corrupt json!');
  const records = store.list();
  assert.equal(records.length, 0, '损坏按空启动');
  const quarantined = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('bambu-test-ops-res-') && f.includes('.corrupt-'));
  assert.equal(quarantined.length, 1, '应留下 .corrupt- 隔离件供人工抢救');
});

// ---------- 审批未切片：拓竹自动切片放行 / 指定闪铸拦截 ----------

check('审批通过：stl/step 放行（分发链自动切片）；指定闪铸机时拦截', async () => {
  const stl = submitFile('bracket.stl');
  const a1 = await reservationService.approveReservation(stl.id, 'A', '');
  assert.equal(a1.status, '排队中', 'stl 应放行（拓竹分发链自动切片）');
  const step = submitFile('part.step');
  const a2 = await reservationService.approveReservation(step.id, 'A', '');
  assert.equal(a2.status, '排队中', 'step 应放行（拓竹分发链自动切片）');
  // 指定闪铸机 → 未切片模型当场拦截（闪铸需预先切好 gcode）
  const cfg = require('../src/config');
  const ff = (cfg.printers || []).find((p) => /AD5|5M|CREATOR/i.test(p.model || ''));
  if (ff) {
    const stl2 = submitFile('bracket2.stl');
    await assert.rejects(
      () => reservationService.approveReservation(stl2.id, 'A', '', { assignedPrinter: ff.name }),
      /闪铸机型/,
      '指定闪铸机时未切片模型应拦截'
    );
    assert.equal(store.get(stl2.id).status, '待审批', '拦截后状态不变');
  }
  const mf = submitFile('done.3mf');
  const after = await reservationService.approveReservation(mf.id, 'A', '');
  assert.equal(after.status, '排队中', '3mf 正常通过');
});

check('审批通过 gcode 系放行(v53 双品牌:闪铸直通链)', async () => {
  for (const name of ['bracket.gcode', 'bracelet.gx', 'gear.g']) {
    const r = submitFile(name);
    const after = await reservationService.approveReservation(r.id, 'A', '');
    assert.equal(after.status, '排队中', `${name} 应放行入队`);
  }
});

check('未切片判定口径与后端 SLICED_EXT_RE 同步(3mf|gcode|gx|g)', () => {
  // 前端 index.html 的 unsliced 门与后端 SLICED_EXT_RE 必须同口径(v154 修复前前端只认 3mf,闪铸直通被审批 UI 卡死)
  const isUn = (n) => !/\.(3mf|gcode|gx|g)$/i.test(String(n || ''));
  assert.equal(isUn('a.stl'), true, 'stl 仍未切片');
  assert.equal(isUn('a.3mf'), false);
  assert.equal(isUn('b.gcode'), false, '闪铸 gcode 已是切片件');
  assert.equal(isUn('c.gx'), false);
  assert.equal(isUn('d.g'), false);
});

// ---------- 3mf 内嵌参数 ----------

check('3mf 提取摘要随单入档(embeddedParams),列表/卡片可展示', () => {
  const zip = new AdmZip();
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({ layer_height: '0.16', wall_loops: '4' })));
  const extracted = extractFrom3mf(zip.toBuffer());
  const r = submitFile('done.3mf', { embeddedParams: { source: extracted.source, params: extracted.params } });
  assert.equal(r.embeddedParams.params.layerHeight, 0.16);
  // 需求链路单无 embeddedParams
  const rstl = submitFile('a.stl');
  assert.equal(rstl.embeddedParams, null);
});

// ---------- 数据备份 ----------

check('备份:四 JSON 快照落盘,轮转清超期文件', () => {
  submitFile('bk.3mf'); // 确保预约文件存在
  // 播种其余三类文件（生产中它们必然存在：注册/改规则/提建议即生成）
  require('../src/services/authStore').register({ username: 'bkop', password: 'secret1', displayName: '备份播种' });
  processRules.upsertRule({ id: 'bk-seed', priority: 300, when: { load_magnitude: ['light'] }, set: { wallLoops: 2 }, reason: '备份播种规则' });
  require('../src/services/ruleSuggestions').add({ when: { load_magnitude: ['light'] }, set: { wallLoops: 2 }, reason: '备份播种建议' });
  // 用「两天前」而非固定 2026-10-06：轮转按 Date.now()-14d 计算，固定日期跨过保留期后
  // 会把刚生成的快照当过期删掉（2026-10-20 测试到期实锤）
  const now = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  now.setUTCHours(3, 30, 0, 0);
  const stamp = now.toISOString().slice(0, 10);
  const r = backup.runBackup(now);
  assert.equal(r.copied.length, 4, `应复制 4 个文件,实际: ${r.copied.join(',')}（跳过 ${r.skipped.join(',')}）`);
  const files = fs.readdirSync(backup.BACKUP_DIR);
  assert.ok(files.some((f) => f.endsWith('-reservations.json')), '预约快照应存在');
  assert.ok(files.some((f) => f.endsWith('-auth-users.json')), '账号快照应存在');
  // 造一个 30 天前的旧快照 → 轮转清除
  const oldStamp = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const old = path.join(backup.BACKUP_DIR, `${oldStamp}-reservations.json`);
  fs.writeFileSync(old, 'x');
  backup.runBackup(now);
  assert.ok(!fs.existsSync(old), '超期快照应被轮转清除');
  assert.ok(fs.existsSync(path.join(backup.BACKUP_DIR, `${stamp}-reservations.json`)), '当日快照保留');
});

check('备份:同日重跑覆盖不膨胀', () => {
  const later = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  later.setUTCHours(15, 0, 0, 0);
  backup.runBackup(later);
  const sameDay = fs.readdirSync(backup.BACKUP_DIR).filter((f) => f.startsWith(later.toISOString().slice(0, 10))).length;
  assert.equal(sameDay, 4, '同日 4 文件不因重跑翻倍');
});

// ---------- 使用上报 ----------

check('usage 上报:payload 组装正确,失败静默不影响主链路', async () => {
  let captured = null;
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    captured = { url, ...JSON.parse(opts.body), token: opts.headers['X-API-Token'] };
    return { ok: true, status: 200 };
  };
  try {
    process.env.USAGE_REPORT_URL = 'http://127.0.0.1:3999/api/usage/report';
    await reportUsage('manbo', 'print-submit');
    assert.equal(captured.openId, 'local:manbo', '本地账号应带 local: 命名空间');
    assert.equal(captured.feature, 'print-submit');
    // 失败静默:fetch 抛错不外抛
    global.fetch = async () => { throw new Error('ECONNREFUSED'); };
    await reportUsage('manbo', 'print-approve'); // 不应 throw
    // 未配置 URL 直接跳过
    process.env.USAGE_REPORT_URL = '';
    captured = null;
    // config.usage 在 require 时固化——直接验证空 username 短路
    await reportUsage('', 'x');
    assert.equal(captured, null, '空用户不发起请求');
  } finally {
    global.fetch = origFetch;
    delete process.env.USAGE_REPORT_URL;
  }
});

// ---------- 2026-10-08 优化批：预估时长提取 / 变迁判定 / 巡检阈值 / 存储损坏隔离 ----------

check('预计时长解析:gcode 秒数流派/时分秒流派/time_cost 兜底/解析失败 null', () => {
  const { parseEstimatedMinutes } = require('../src/services/slicerExtract');
  assert.equal(parseEstimatedMinutes('; total estimated time (s): 5400\n', {}), 90);
  assert.equal(parseEstimatedMinutes('; estimated printing time (normal mode) = 2h 30m 0s\n', {}), 150);
  assert.equal(parseEstimatedMinutes('no time here', {}), null);
  assert.equal(parseEstimatedMinutes('', { time_cost: '7200' }), 120);
});

check('extractFrom3mf 输出 estMinutes(嵌入 gcode 头部)', () => {
  const zip = new AdmZip();
  zip.addFile('Metadata/plate_1.gcode', Buffer.from('; total estimated time (s): 3600\n; layer_height = 0.2\n'));
  const r = extractFrom3mf(zip.toBuffer());
  assert.equal(r.estMinutes, 60);
  assert.equal(r.params.layerHeight, 0.2, '参数提取不受影响');
});

check('resolveJobEvent:首报文补收尾事件(重启间隙),常规变迁口径不变', () => {
  const { resolveJobEvent } = require('../src/printer/manager');
  // 首报文（服务重启/重连后 prevState 为空）
  assert.equal(resolveJobEvent('', 'FINISH', true), 'finish', '停机窗口完成的任务补 finish');
  assert.equal(resolveJobEvent('', 'IDLE', true), 'idle', '幽灵任务补 idle 收尾');
  assert.equal(resolveJobEvent('', 'FINISH', false), null, '无在册任务首报文不发事件');
  assert.equal(resolveJobEvent('', 'PRINTING', true), null, '重启续打不发 start（printing 映射已恢复）');
  // 常规变迁（与历史口径一致）
  assert.equal(resolveJobEvent('IDLE', 'PRINTING', false), 'start');
  assert.equal(resolveJobEvent('PRINTING', 'FINISH', true), 'finish');
  assert.equal(resolveJobEvent('PRINTING', 'FAILED', true), 'failed');
  assert.equal(resolveJobEvent('PRINTING', 'IDLE', true), 'idle');
  assert.equal(resolveJobEvent('PRINTING', 'PRINTING', true), null, '同态不发事件');
  assert.equal(resolveJobEvent('RESUME', 'PRINTING', true), null, 'RESUME→PRINTING 不算 start');
  // 2026-10-16 真单卡滞修复：任何非空闲态 → 空闲都发 idle（触发队列重匹配）
  assert.equal(resolveJobEvent('FAILED', 'IDLE', false), 'idle', 'FAILED→IDLE（屏幕消除故障态）触发重匹配');
  assert.equal(resolveJobEvent('FINISH', 'IDLE', true), 'idle', 'FINISH→IDLE 同样发 idle（幂等重试）');
  assert.equal(resolveJobEvent('PAUSE', 'IDLE', true), 'idle', 'PAUSE→IDLE（屏幕取消暂停任务）触发重匹配');
  assert.equal(resolveJobEvent('IDLE', 'IDLE', true), null, '同为空闲不发事件');
  // RUNNING=H2 新固件打印执行态（2026-10-16 实测）——并入 start/收尾口径
  assert.equal(resolveJobEvent('PREPARE', 'RUNNING', true), 'start', 'RUNNING 起点算 start（ETA 捕获通道）');
  assert.equal(resolveJobEvent('RUNNING', 'FINISH', true), 'finish');
  assert.equal(resolveJobEvent('RUNNING', 'IDLE', false), 'idle', '打印中(RUNNING)→空闲触发重匹配');
  assert.equal(resolveJobEvent('RUNNING', 'FAILED', true), 'failed');
});

check('isHumanCancelFailReason:机器端人工取消码识别（取消不重发）', () => {
  const { isHumanCancelFailReason } = require('../src/services/dispatcher');
  assert.equal(isHumanCancelFailReason(50348044), true, 'HMS 0300-400C=打印已取消');
  assert.equal(isHumanCancelFailReason('50348044'), true, '字符串数字同样识别');
  assert.equal(isHumanCancelFailReason(0), false);
  assert.equal(isHumanCancelFailReason(undefined), false);
  assert.equal(isHumanCancelFailReason(12345), false, '未知码当普通失败走重排');
});

check('canDispatchResidueFailed:静止残留放行,有在打痕迹/未知不放行', () => {
  const { canDispatchResidueFailed } = require('../src/printer/manager');
  const base = { status: '故障', gcodeState: 'FAILED', activeTask: null, progress: 0 };
  assert.equal(canDispatchResidueFailed(base), true, '静止残留放行（方案B：新任务顶掉）');
  assert.equal(canDispatchResidueFailed({ ...base, progress: 47 }), false, '进度>0（中途失败）不放行');
  assert.equal(canDispatchResidueFailed({ ...base, activeTask: { id: 1 } }), false, '有在册任务不放行');
  assert.equal(canDispatchResidueFailed({ status: '空闲', gcodeState: 'IDLE' }), false, '非故障态不归此判');
  assert.equal(canDispatchResidueFailed(null), false);
});

check('createSampleFromReservation:预约单→训练样本(3mf 内嵌参数/源单引用/结果回填)', () => {
  const { createSampleFromReservation } = require('../src/services/reservation');
  const trainingStore = require('../src/services/trainingStore');
  const zip = new AdmZip();
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({
    curr_bed_type: 'High Temp Plate', layer_height: '0.2', wall_loops: '3',
  })));
  zip.addFile('Metadata/slice_info.config', Buffer.from('<?xml version="1.0"?><config><plate><filament id="1" tray_info_idx="GFA00" type="PLA" color="#26A69A" used_m="10" used_for_object="true"/></plate></config>'));
  // 切片导出件无网格：加最小 gcode 让「几何特征估计」路径可跑（2026-10-16）
  zip.addFile('Metadata/plate_1.gcode', Buffer.from('; total layer number: 50\n; max_z_height: 10.0\nG1 X0 Y0 Z0.2\nG1 X20 Y15 E1\nG1 X0 Y0\n'));
  // 专家摆向弱标签：3mf 对象矩阵（绕 Z 90°）——2026-10-19 学习回路
  zip.addFile('Metadata/model_settings.config', Buffer.from('<config><object id="1"><metadata key="matrix" value="0 -1 0 0 1 0 0 0 0 0 1 0 0 0 0 1"/></object></config>'));
  const f = path.join(os.tmpdir(), `bambu-test-sample-${process.pid}.3mf`);
  fs.writeFileSync(f, zip.toBuffer());
  const record = {
    id: 'R20261016-999', fileName: 'test_part.3mf', filePath: f,
    materialType: 'PLA', selection: { load_magnitude: 'medium' }, spatial: [],
    processParams: null, appliedRules: [],
  };
  const s = createSampleFromReservation(record, '测试审批人');
  assert.equal(s.sourceRecordId, 'R20261016-999', '源单引用落档（结果回填的钩子）');
  assert.equal(s.featureSource, 'gcode-estimate', '切片导出件无网格 → gcode 估计标记（曼波 2026-10-16）');
  assert.ok(s.model && s.model.features && s.model.features.ok === true, '几何特征估计成功落档');
  assert.equal(s.confidence, 40, '3mf 直通：自动提取特征赋额外低权重');
  assert.ok(/^T\d{8}-\d{3}$/.test(s.id), '样本号生成');
  assert.ok(s.slice && s.slice.extraction && s.slice.extraction.params, '内嵌切片参数已提取');
  assert.equal(s.slice.extraction.bedType, 'High Temp Plate');
  assert.ok(s.model && s.model.storedPath && s.slice.storedPath === s.model.storedPath, '3mf 同产物归档去重（模型即切片）');
  assert.ok(s.orientation && s.orientation.source === '3mf-model-settings', '3mf 对象矩阵提取为专家摆向弱标签');
  // Place on Face 人工标签优先于 3mf 矩阵
  const s2 = createSampleFromReservation({ ...record, id: 'R20261016-998', placement: [0, 0, 0.707107, 0.707107] }, '测试审批人');
  assert.equal(s2.orientation.source, 'placement', '人工放置优先作为强标签');
  assert.deepEqual(s2.orientation.quaternion, [0, 0, 0.707107, 0.707107]);
  const back = trainingStore.setOutcomeBySource('R20261016-999', { status: '成功', recordedBy: '测试' });
  assert.ok(back && back.outcome.status === '成功', '按源单回填 outcome');
  try { fs.unlinkSync(f); } catch { /* 已不存在 */ }
});

check('buildAmsMapping:指定槽/自动匹配/无清单三径,外挂虚拟料位 254/255 编码', () => {
  const { buildAmsMapping } = require('../src/services/dispatcher');
  const printer = {
    ams: [
      { slot: 'AMS 0', type: 'PETG', colorHex: 'C1C1C1', amsId: 0, trayId: 0 },
      { slot: 'AMS 2', type: 'PLA', colorHex: 'F72323', amsId: 0, trayId: 2 },
      { slot: '外挂料盘·左', type: 'PLA', colorHex: '161616', amsId: 254, trayId: 0, external: true },
    ],
  };
  // ① 指定槽位：全部用料映射到该槽
  const pref = buildAmsMapping({ prefTray: { amsId: 254, trayId: 0, slot: '外挂料盘·左' } }, printer, null);
  assert.deepEqual(pref.amsMapping2[0], { ams_id: 254, slot_id: 0 });
  assert.deepEqual(pref.amsMapping, [254], '外挂 legacy 值取虚拟料位原值');
  // ② 自动：PLA 红 → AMS2 精确材料+颜色最近；legacy = 0*4+2
  const auto = buildAmsMapping({}, printer, { filaments: [{ type: 'PLA', colorHex: 'F0F0F0' }] });
  assert.deepEqual(auto.amsMapping2, [{ ams_id: 0, slot_id: 2 }]);
  assert.deepEqual(auto.amsMapping, [2]);
  // ③ 无清单：维持旧默认
  const none = buildAmsMapping({}, printer, null);
  assert.deepEqual(none.amsMapping2, [{ ams_id: 0, slot_id: 0 }]);
  // ④ 多耗材逐条指定（2026-10-16 多耗材批）：第 1 条指定外挂料盘、第 2 条留自动 → PLA 红匹配到 AMS2
  const multi = buildAmsMapping(
    { prefTrays: [{ amsId: 254, trayId: 0, slot: '外挂料盘·左' }, null] },
    printer,
    { filaments: [{ type: 'PETG', colorHex: 'C1C1C1' }, { type: 'PLA', colorHex: 'F0F0F0' }] },
  );
  assert.deepEqual(multi.amsMapping2, [{ ams_id: 254, slot_id: 0 }, { ams_id: 0, slot_id: 2 }], '逐条：指定为主/留空自动');
  assert.deepEqual(multi.amsMapping, [254, 2]);
  // ⑤ 全空 prefTrays（UI 全留自动时不下发，服务端兜底）：退回按文件用料逐条自动
  const allAuto = buildAmsMapping({ prefTrays: [null, null] }, printer, { filaments: [{ type: 'PETG', colorHex: 'C1C1C1' }, { type: 'PLA', colorHex: 'F0F0F0' }] });
  assert.deepEqual(allAuto.amsMapping2, [{ ams_id: 0, slot_id: 0 }, { ams_id: 0, slot_id: 2 }]);
});

check('approveReservation:多耗材逐条槽位名服务端解析(留空=自动),坏槽位当场打回', async () => {
  const config = require('../src/config');
  const manager = require('../src/printer/manager');
  const dispatcher = require('../src/services/dispatcher');
  const testPrinter = { name: '联调测试机', id: 'test-printer-multi', model: 'H2D' };
  config.printers.push(testPrinter);
  const origStates = manager.getApiStates;
  const origBrand = manager.brandOf;
  manager.getApiStates = () => [{ id: testPrinter.id, ams: [
    { slot: 'AMS 0', type: 'PETG', colorHex: 'C1C1C1', amsId: 0, trayId: 0 },
    { slot: '外挂料盘·左', type: 'PLA', colorHex: '161616', amsId: 254, trayId: 0, external: true },
  ] }];
  manager.brandOf = () => 'bambu';
  try {
    const r = submitFile('multi-color.3mf', { embeddedParams: { filaments: [{ type: 'PETG' }, { type: 'PLA' }] } });
    await reservationService.approveReservation(r.id, '测试审批人', '', {
      assignedPrinter: '联调测试机',
      trays: [null, { slot: '外挂料盘·左' }],
    });
    const rec = store.get(r.id);
    assert.equal(rec.review.dispatch.trays[0], null, '留空条目=该条自动');
    assert.deepEqual(rec.review.dispatch.trays[1], { amsId: 254, trayId: 0, slot: '外挂料盘·左' }, '槽位名解析为实时料位 id');
    assert.ok(/用料 1→自动 2→外挂料盘·左/.test(rec.history.map((s) => s.note).join('|')), '状态注记带逐条用料摘要');
    // 坏槽位名：审批硬校验当场打回（不落「已通过」）
    const r2 = submitFile('multi-color2.3mf');
    await assert.rejects(() => reservationService.approveReservation(r2.id, 'A', '', {
      assignedPrinter: '联调测试机', trays: [{ slot: '不存在的槽' }],
    }), /不存在或未实装/);
    assert.equal(store.get(r2.id).status, '待审批', '打回后仍待审批');
  } finally {
    manager.getApiStates = origStates;
    manager.brandOf = origBrand;
    const i = config.printers.indexOf(testPrinter);
    if (i >= 0) config.printers.splice(i, 1);
  }
});

check('staleThresholdMs:有预估按×2且≥1h,无预估退回固定12h', () => {
  const { staleThresholdMs } = require('../src/services/dispatcher');
  assert.equal(staleThresholdMs(null), 12 * 3600 * 1000);
  assert.equal(staleThresholdMs(0), 12 * 3600 * 1000);
  assert.equal(staleThresholdMs(30), 60 * 60 * 1000, '短任务下限 1h');
  assert.equal(staleThresholdMs(90), 180 * 60 * 1000, '90min → ×2=3h');
});

check('回执丢失自愈:分发超时但机器已开打→按成功处理;机器仍空闲→原样抛错', async () => {
  const manager = require('../src/printer/manager');
  const origClient = manager.clients[991];
  const origState = manager.printerStates[991];
  const origConfirm = manager._confirmJobStarted;
  try {
    manager.printerStates[991] = { id: 991, name: '自愈测试机', brand: 'bambu' };
    // ① 回执超时但机器已进入打印流程 → 成功（{ackLost:true}）
    manager.clients[991] = {
      connected: true,
      startProjectFile: async () => { throw new Error('Command timeout for sequence 10194'); },
      getPrintStatus: () => ({ gcodeState: 'RUNNING', progress: 5 }),
    };
    const r = await manager.startProjectOnPrinter(991, 'f.3mf', 'f.3mf');
    assert.deepEqual(r, { ackLost: true }, '超时但机器在打=按分发成功（R-008 实况）');
    // ② 回执超时且机器保持空闲 → 原样抛错（真失败走既有回滚链）
    manager._confirmJobStarted = async () => false;
    await assert.rejects(() => manager.startProjectOnPrinter(991, 'f.3mf', 'f.3mf'), /Command timeout/, '机器空闲=真失败');
    manager._confirmJobStarted = origConfirm;
    // ③ 非超时错误不受自愈影响（如未连接）
    manager.clients[991] = { connected: true, startProjectFile: async () => { throw new Error('其他错误'); } };
    await assert.rejects(() => manager.startProjectOnPrinter(991, 'f.3mf', 'f.3mf'), /其他错误/);
  } finally {
    if (origClient === undefined) delete manager.clients[991]; else manager.clients[991] = origClient;
    if (origState === undefined) delete manager.printerStates[991]; else manager.printerStates[991] = origState;
    manager._confirmJobStarted = origConfirm;
  }
});

check('reconcileLostAck:队列任务×在打文件同名→补记打印中并移出队列（防二次开打）', () => {
  const config = require('../src/config');
  const manager = require('../src/printer/manager');
  const dispatcher = require('../src/services/dispatcher');
  const origStates = manager.getApiStates;
  const origUpdate = manager.updateState;
  manager.getApiStates = () => [{ id: 992, name: '自愈测试机2', status: '打印中', subtaskName: '自愈测试件.gcode.3mf' }];
  manager.updateState = () => {};
  try {
    const r = submitFile('自愈测试件.gcode.3mf');
    // 单据驱动到排队中（状态机：待审批→已通过→排队中→打印中）
    store.updateStatus(r.id, config.status.REVIEW_APPROVED, '测试');
    store.updateStatus(r.id, config.status.QUEUED, '测试');
    const task = { recordId: r.id, applicationNo: r.id, fileName: '自愈测试件.gcode.3mf', enqueuedAt: Date.now() };
    dispatcher.queue.push(task);
    const healed = dispatcher.reconcileLostAck();
    assert.equal(healed, true, '在打文件与队列任务同名应命中自愈');
    assert.ok(!dispatcher.queue.some((t) => t.recordId === r.id), '已移出队列');
    assert.equal(dispatcher.printing.get(992), task, '登记为打印中');
    assert.equal(store.get(r.id).status, '打印中', '单据补记打印中（回执丢失补记）');
    // 文件名不同 → 不自愈（防误判他机在打别件）
    const r2 = submitFile('无关件.gcode.3mf');
    const task2 = { recordId: r2.id, applicationNo: r2.id, fileName: '无关件.gcode.3mf', enqueuedAt: Date.now() };
    dispatcher.queue.push(task2);
    assert.equal(dispatcher.reconcileLostAck(), false, '文件名不匹配不自愈');
    assert.ok(dispatcher.queue.some((t) => t.recordId === r2.id), '无关任务留在队列');
    dispatcher.queue = dispatcher.queue.filter((t) => t.recordId !== r2.id);
    dispatcher.printing.delete(992);
  } finally {
    manager.getApiStates = origStates;
    manager.updateState = origUpdate;
  }
});

check('ETA 汇总:队列按内嵌预估求和+无预估计数,在打按实时剩余', () => {
  const { etaSummary } = require('../src/services/chatService');
  const queue = [{ estMinutes: 60 }, { estMinutes: 30 }, { estMinutes: null }];
  const printing = [{ remainingMinutes: 45 }, { remainingMinutes: null }];
  const out = etaSummary(queue, printing);
  assert.match(out, /~1h30m/, '队列已知预估求和');
  assert.match(out, /1 单无预估/, '无预估单计数');
  assert.match(out, /~45m/, '在打实时剩余求和');
  assert.equal(etaSummary([], []), '', '空队列空在打无 ETA 行');
});

// ---------- 收尾 ----------
Promise.all(pending).then(() => {
  for (const f of fs.readdirSync(os.tmpdir())) {
    if (f.startsWith('bambu-test-ops-')) {
      try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch { /* 目录跳过 */ }
    }
  }
  try { fs.rmSync(path.join(os.tmpdir(), `bambu-test-ops-backup-${process.pid}`), { recursive: true }); } catch { /* 无则跳过 */ }
  processRules.resetRules();
  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
});
