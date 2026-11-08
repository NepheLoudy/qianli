/**
 * 切片喷嘴/告警闸单测（2026-11-06 v97 曼波令「喷嘴和打印板错误拒绝预约」）
 * 实案：0.2 喷嘴切片落 0.4 实装 H2D，机端秒 FAILED（print_error 83902535）且无回报，
 * 幽灵占用同型号机导致后续正确单转人工（R20261106-008/-009/-010）。
 * 口径（曼波裁决）：喷嘴直径 vs 机队实装=硬拦（提交初审/选机/审批三道）；
 * slice_info <warning>（热床 1000C001/喷嘴硬度 1000C002 等）=建议级红标不拦
 * （昨晚成功件同样携带照打成功的实证）。
 * 用法：node test/stub-test-nozzle-gate.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

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

/** 构造迷你切片 3mf（真件形态：slice_info 含 nozzle_diameters 与 error_code 空格形态告警） */
function buildSliced3mf({ nozzle = '0.4,0.4', warnings = true, bed = 'Textured PEI Plate' } = {}) {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from('<?xml version="1.0" encoding="UTF-8"?><Types/>'));
  zip.addFile('Metadata/plate_1.gcode', Buffer.from('; model printing time: 40m 13s\n; total estimated time: 50m 48s\nM104 S250\n'));
  zip.addFile('Metadata/slice_info.config', Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<config>
  <plate>
    <metadata key="index" value="1"/>
    <metadata key="printer_model_id" value="O1D"/>
    <metadata key="nozzle_diameters" value="${nozzle}"/>
    <filament id="1" tray_info_idx="GFG00" type="PETG" color="#26A69A" used_m="1.10" used_g="3.32" used_for_object="true"/>
    ${warnings ? '<warning msg="bed_temperature_too_high_than_filament" level="3" error_code ="1000C001"  />' : ''}
    ${warnings ? '<warning msg="the_actual_nozzle_hrc_smaller_than_the_required_nozzle_hrc" level="3" error_code ="1000C002"  />' : ''}
    <nozzle id="1" extruder_id="2" nozzle_diameter="0.4" volume_type="Standard"/>
  </plate>
</config>`));
  zip.addFile('Metadata/project_settings.config', Buffer.from(JSON.stringify({
    printer_model: 'Bambu Lab H2D',
    curr_bed_type: bed,
    filament_type: ['PETG'],
    filament_colour: ['#26A69A'],
  })));
  return zip.toBuffer();
}

const { extractFrom3mf } = require('../src/services/slicerExtract');
const { chooseMachineForSliced, nozzlesCover } = require('../src/services/machineLearning');

check('extractFrom3mf 提取 nozzle_diameters（多喷头逗号形态）+ 双告警（error_code 空格形态实锤）', () => {
  const ext = extractFrom3mf(buildSliced3mf({ nozzle: '0.4,0.4' }));
  assert.deepStrictEqual(ext.nozzleDiameters, [0.4, 0.4]);
  assert.strictEqual(ext.sliceWarnings.length, 2, '两条 level-3 告警都应咬中');
  assert.strictEqual(ext.sliceWarnings[0].msg, 'bed_temperature_too_high_than_filament');
  assert.strictEqual(ext.sliceWarnings[0].errorCode, '1000C001', 'error_code 后带空格的实件形态必须解析到');
  assert.strictEqual(ext.sliceWarnings[1].errorCode, '1000C002');
  assert.strictEqual(ext.sliced, true);
});

check('extractFrom3mf 单值口径与无告警件', () => {
  const ext = extractFrom3mf(buildSliced3mf({ nozzle: '0.4', warnings: false }));
  assert.deepStrictEqual(ext.nozzleDiameters, [0.4]);
  assert.deepStrictEqual(ext.sliceWarnings, []);
});

check('extractFrom3mf 异常安全：无 slice_info 条目不抛、字段缺省空', () => {
  const zip = new AdmZip();
  zip.addFile('Metadata/plate_1.gcode', Buffer.from('; x\n'));
  const ext = extractFrom3mf(zip.toBuffer());
  assert.deepStrictEqual(ext.nozzleDiameters, []);
  assert.deepStrictEqual(ext.sliceWarnings, []);
});

check('nozzlesCover：文件每档口径都被机端覆盖才匹配；未知实装不拦', () => {
  assert.ok(nozzlesCover([0.4], [0.4]));
  assert.ok(!nozzlesCover([0.2, 0.2], [0.4, 0.4]), '0.2 件落 0.4 机=实案主因，必须不匹配');
  assert.ok(nozzlesCover([0.4], [0.4, 0.2]), '单口径文件只需机端有一支能打');
  assert.ok(nozzlesCover([0.2], [0.4, 0.2]));
  assert.ok(nozzlesCover([], [0.4]));
  assert.ok(nozzlesCover([0.4], []), '机端未知实装不拦（提交口对已知值硬拦，别把失联变全队不可用）');
  assert.ok(nozzlesCover(undefined, [0.4]));
});

check('chooseMachineForSliced：同型号全不匹配 → noSameModel + 原因带喷嘴（绝不静默改派）', () => {
  const choice = chooseMachineForSliced(
    'Bambu Lab H2D',
    [{ name: 'H2D', model: 'H2D', nozzleDiameters: [0.4] }],
    [],
    [0.2, 0.2],
  );
  assert.strictEqual(choice.name, null);
  assert.strictEqual(choice.noSameModel, true);
  assert.ok(/喷嘴/.test(choice.basis), `basis 应说明喷嘴原因：${choice.basis}`);
  assert.ok(/0\.4/.test(choice.basis) && /0\.2/.test(choice.basis), '原因应带两侧口径');
});

check('chooseMachineForSliced：口径匹配照常选机；机端未知实装不误杀', () => {
  const hit = chooseMachineForSliced(
    'Bambu Lab H2D',
    [{ name: 'H2D', model: 'H2D', nozzleDiameters: [0.4, 0.2] }],
    [],
    [0.2],
  );
  assert.strictEqual(hit.name, 'H2D');
  const unknown = chooseMachineForSliced(
    'Bambu Lab H2D',
    [{ name: 'H2D', model: 'H2D' }],
    [],
    [0.2, 0.2],
  );
  assert.strictEqual(unknown.name, 'H2D', '实装未知（老报文/缺字段）不拦');
  const legacy = chooseMachineForSliced('Bambu Lab H2D', [{ name: 'H2D', model: 'H2D' }], []);
  assert.strictEqual(legacy.name, 'H2D', '不传 fileNozzles 保持 v85 旧行为');
});

check('chooseMachineForSliced：已知不匹配 + 未知同型号并存 → 选未知机而非失败', () => {
  const choice = chooseMachineForSliced(
    'Bambu Lab H2D',
    [
      { name: 'H2D-旧报文', model: 'H2D' },
      { name: 'H2D-0.4', model: 'H2D', nozzleDiameters: [0.4] },
    ],
    [],
    [0.2, 0.2],
  );
  assert.strictEqual(choice.name, 'H2D-旧报文');
});

const reservationService = require('../src/services/reservation');

check('precheckSlicedSubmission：0.2 件对 0.4 实装 H2D → blocked + 可操作文案', () => {
  const verdict = reservationService.precheckSlicedSubmission({
    machineModel: 'Bambu Lab H2D',
    filaments: [{ type: 'PETG' }],
    nozzleDiameters: [0.2, 0.2],
    sliceWarnings: [{ msg: 'bed_temperature_too_high_than_filament', level: 3, errorCode: '1000C001' }],
    printers: [{ id: 'p1', name: 'H2D', model: 'H2D' }],
    apiStates: [{ id: 'p1', stateStale: false, nozzleDiameters: [0.4], ams: [{ type: 'PETG' }] }],
    queueInfo: {},
  });
  assert.strictEqual(verdict.blocked, true, `0.2 vs 0.4 必须拦：${JSON.stringify(verdict)}`);
  assert.ok(/喷嘴/.test(verdict.errors[0]) && /0\.4/.test(verdict.errors[0]));
  assert.ok(verdict.warnings.some((w) => /切片器告警/.test(w)), '告警应透出为建议级 warnings');
});

check('precheckSlicedSubmission：口径匹配/实装未知 → 放行', () => {
  const ok = reservationService.precheckSlicedSubmission({
    machineModel: 'Bambu Lab H2D',
    filaments: [{ type: 'PETG' }],
    nozzleDiameters: [0.4, 0.4],
    printers: [{ id: 'p1', name: 'H2D', model: 'H2D' }],
    apiStates: [{ id: 'p1', stateStale: false, nozzleDiameters: [0.4], ams: [{ type: 'PETG' }] }],
    queueInfo: {},
  });
  assert.strictEqual(ok.blocked, false);
  const unknownFleet = reservationService.precheckSlicedSubmission({
    machineModel: 'Bambu Lab H2D',
    nozzleDiameters: [0.2],
    printers: [{ id: 'p1', name: 'H2D', model: 'H2D' }],
    apiStates: [{ id: 'p1', stateStale: false, ams: [] }],
    queueInfo: {},
  });
  assert.strictEqual(unknownFleet.blocked, false, '机端实装未知不拦（不误杀）');
});

check('precheckSlicedSubmission：无内嵌机型初审跳过（老文件不误杀）', () => {
  const skip = reservationService.precheckSlicedSubmission({ machineModel: null, nozzleDiameters: [0.2] });
  assert.strictEqual(skip.blocked, false);
});

check('静态锚：三道闸接线（提交初审/选机过滤/审批硬校验）与前端红标', () => {
  const idx = fs.readFileSync(path.join(__dirname, '../src/index.js'), 'utf8');
  assert.ok(idx.includes('nozzleDiameters: extracted.nozzleDiameters'), '提交链 embeddedParams 必须带喷嘴口径');
  assert.ok(idx.includes('nozzleDiameters: embeddedParams.nozzleDiameters'), '提交初审必须传喷嘴口径');
  assert.ok(idx.includes('nozzleDiameters: ext.nozzleDiameters'), 'probe-model 必须透出喷嘴口径');
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  assert.ok(resv.includes('nozzlesCover(fileNozzles, installed)'), '审批链必须接喷嘴硬校验');
  assert.ok(resv.includes('nozzleDiameters: p.nozzleDiameters'), '学习选机候选必须带机端实装口径');
  const ml = fs.readFileSync(path.join(__dirname, '../src/services/machineLearning.js'), 'utf8');
  assert.ok(ml.includes('function nozzlesCover'), 'nozzlesCover 必须存在');
  const client = fs.readFileSync(path.join(__dirname, '../src/printer/client.js'), 'utf8');
  assert.ok(client.includes('nozzle_diameter'), '机端实装口径解析必须读 print.nozzle_diameter');
  const manager = fs.readFileSync(path.join(__dirname, '../src/printer/manager.js'), 'utf8');
  assert.ok(manager.includes('nozzleDiameters: status.nozzleDiameters'), '状态透出必须带实装口径');
  const front = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.ok(front.includes('喷嘴口径不匹配'), '预约台必须红标口径不匹配');
  const approve = fs.readFileSync(path.join(__dirname, '../public/approve.html'), 'utf8');
  assert.ok(approve.includes('切片告警'), '审批台必须红标切片告警');
});

check('真件回归（可选）：曼波实单 45m52s 若在本地则提取 0.4/0.4 + 1000C001', () => {
  const real = 'C:/Users/nebula/Downloads/线规限位_PETG_45m52s.gcode.3mf';
  if (!fs.existsSync(real)) return; // 文件不在（换机/清理）就跳过，不因环境红
  const ext = extractFrom3mf(fs.readFileSync(real));
  assert.deepStrictEqual(ext.nozzleDiameters, [0.4, 0.4], '正确件必须按 0.4,0.4 提取');
  assert.ok(ext.sliceWarnings.some((w) => w.errorCode === '1000C001'), '正确件同样携带热床告警（建议级口径的实证）');
});

check('v101 回归锚：选机调用不得引用未定义变量（R20261108-001 实案——非严格模块裸变量=静默 ReferenceError）', () => {
  const resv = fs.readFileSync(path.join(__dirname, '../src/services/reservation.js'), 'utf8');
  const at = resv.indexOf('chooseMachineForSliced(');
  const seg = resv.slice(at, at + 700);
  assert.ok(!/\(embeddedParams &&/.test(seg), '选机参数不得裸写 embeddedParams（必须 reservation.embeddedParams）');
  assert.ok(seg.includes('reservation.embeddedParams && reservation.embeddedParams.nozzleDiameters'), 'v101 修复必须就位');
});

process.exit(failures > 0 ? 1 : 0);
