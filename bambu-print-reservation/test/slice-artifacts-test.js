/**
 * 已切片 3mf 展示要素提取单测（2026-10-18）
 * 用法：node test/slice-artifacts-test.js
 */
const assert = require('assert');
const AdmZip = require('adm-zip');
const { extractSlicedArtifacts } = require('../src/services/sliceArtifacts');

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

function makeSlicedZip({ withPng = true, withGcode = true } = {}) {
  const zip = new AdmZip();
  zip.addFile('3D/3dmodel.model', Buffer.from('<model/>'));
  if (withPng) zip.addFile('Metadata/plate_1.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (withGcode) {
    zip.addFile('Metadata/plate_1.gcode', Buffer.from([
      '; CHANGE_LAYER', '; Z_HEIGHT: 0.2', 'G1 X0 Y0 E1', 'G1 X5 Y5 E1.2',
      '; CHANGE_LAYER', '; Z_HEIGHT: 0.4', 'G1 X5 Y5 E1', 'G1 X9 Y9 E1.3',
    ].join('\n')));
  }
  return zip.toBuffer();
}

check('已切片 3mf：缩略图 + 层概览（层数/z 范围）', () => {
  const r = extractSlicedArtifacts(makeSlicedZip());
  assert.ok(r && r.sliced, '应识别为已切片产物');
  assert.ok(r.thumbnail && r.thumbnail.startsWith('data:image/png;base64,'), '应带缩略图 dataURL');
  assert.strictEqual(r.layers.count, 2);
  assert.strictEqual(r.layers.zMin, 0.2);
  assert.strictEqual(r.layers.zMax, 0.4);
  assert.ok(r.message.includes('3D 标注不可用'));
});

check('只有 gcode 无缩略图：仍返回层概览', () => {
  const r = extractSlicedArtifacts(makeSlicedZip({ withPng: false }));
  assert.ok(r && r.sliced);
  assert.strictEqual(r.thumbnail, undefined);
  assert.strictEqual(r.layers.count, 2);
});

check('两者都没有：返回 null（保留原错误路径）', () => {
  const r = extractSlicedArtifacts(makeSlicedZip({ withPng: false, withGcode: false }));
  assert.strictEqual(r, null);
});

check('坏 zip 不抛错：返回 null', () => {
  assert.strictEqual(extractSlicedArtifacts(Buffer.from('not a zip')), null);
});

console.log(`\n已切片 3mf 展示要素单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
