/**
 * 工程 3mf 自解析单测（v64）：跨文件 components 拼装 / transform 级联 /
 * 多实体合并 / 空网格容器跳过 / 真实 MakerWorld 文件形态回归
 * 用法：node test/engine3mf-test.js
 */
const assert = require('assert');
const AdmZip = require('adm-zip');
const { parseEngineering3mf } = require('../src/utils/engine3mf');

let pass = 0;
let failures = 0;
function check(name, fn) {
  try { fn(); pass++; console.log(`✓ ${name}`); }
  catch (err) { failures++; console.error(`✗ ${name} — ${err.message}`); }
}

/** 合成工程 3mf：两个跨文件 object（各自 mesh），可选 build 段与平移 */
function makeEng3mf({ withBuild = false } = {}) {
  const zip = new AdmZip();
  const spec = `<?xml version="1.0"?><model>
    <resources>
      <object id="2"><components><component p:path="/3D/Objects/object_12.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 10 0 0"/></components></object>
      <object id="4"><components><component p:path="/3D/Objects/object_8.model" objectid="1" transform="1 0 0 0 1 0 0 0 1 0 20 0"/></components></object>
    </resources>
    ${withBuild ? '<build><item objectid="2"/><item objectid="4"/></build>' : ''}
  </model>`;
  zip.addFile('3D/3dmodel.model', Buffer.from(spec));
  const mesh = '<object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="5"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>';
  zip.addFile('3D/Objects/object_12.model', Buffer.from(mesh));
  zip.addFile('3D/Objects/object_8.model', Buffer.from(mesh));
  return zip.toBuffer();
}

check('跨文件 components 拼装 + transform 级联（平移 10,0 / 0,20）', () => {
  const r = parseEngineering3mf(makeEng3mf({ withBuild: true }));
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.parts, 2);
  assert.strictEqual(r.mesh.triangles, 2, '两实体各 1 三角');
  assert.strictEqual(r.mesh.vertices, 6);
  // 第一个件平移 (10,0,0)：顶点 (0,0,0)→(10,0,0)
  const xs = [];
  for (let i = 0; i < r.mesh.positions.length; i += 3) xs.push(`${r.mesh.positions[i]},${r.mesh.positions[i + 1]},${r.mesh.positions[i + 2]}`);
  assert.ok(xs.includes('10,0,0'), `实体 1 顶点应带 (10,0,0)：${xs.join(' | ')}`);
  assert.ok(xs.includes('0,20,0'), `实体 2 顶点应带 (0,20,0)：${xs.join(' | ')}`);
});

check('无 build（工程件常态）：顶层 object 全打', () => {
  const r = parseEngineering3mf(makeEng3mf({ withBuild: false }));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.parts, 2);
  assert.strictEqual(r.mesh.triangles, 2);
});

check('嵌套 components：容器 object 引用容器 object 引用外部 mesh，变换级联相乘', () => {
  const zip = new AdmZip();
  const spec = `<?xml?><model><resources>
    <object id="10"><components><component p:path="/3D/Objects/object_12.model" objectid="1" transform="2 0 0 0 2 0 0 0 2 5 0 0"/></components></object>
  </resources></model>`;
  zip.addFile('3D/3dmodel.model', Buffer.from(spec));
  // 外部文件里再套一层 components（引用同文件另一 object，平移 1,1,1）——级联缩放×2+平移
  zip.addFile('3D/Objects/object_12.model', Buffer.from(`<object id="1"><components><component objectid="7" transform="1 0 0 0 1 0 0 0 1 1 1 1"/></components></object>
    <object id="7"><mesh><vertices><vertex x="1" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object>`));
  const r = parseEngineering3mf(zip.toBuffer());
  assert.strictEqual(r.ok, true, r.error || '');
  // 顶点 (1,0,0)：先内层平移 → (2,1,1)，再外层缩放×2+平移 → (9,2,2)
  const got = `${r.mesh.positions[0]},${r.mesh.positions[1]},${r.mesh.positions[2]}`;
  assert.strictEqual(got, '9,2,2', `级联变换结果 ${got} 应为 (9,2,2)`);
});

check('空网格容器 object 跳过：纯 components 容器不计入 parts 网格', () => {
  const zip = new AdmZip();
  const spec = `<?xml?><model><resources>
    <object id="2"><components><component p:path="/3D/Objects/object_12.model" objectid="1" transform=""/></components></object>
    <object id="3"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object>
  </resources></model>`;
  zip.addFile('3D/3dmodel.model', Buffer.from(spec));
  zip.addFile('3D/Objects/object_12.model', Buffer.from('<object id="1"><mesh><vertices><vertex x="3" y="0" z="0"/></vertices><triangles><triangle v1="0" v2="0" v3="0"/></triangles></mesh></object>'));
  const r = parseEngineering3mf(zip.toBuffer());
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.mesh.triangles, 2, '两个实 mesh 各 1 三角');
});

check('引用落空 → 诚实报错（不静默空网格）', () => {
  const zip = new AdmZip();
  zip.addFile('3D/3dmodel.model', Buffer.from('<model><resources><object id="2"><components><component p:path="/3D/Objects/object_12.model" objectid="99" transform=""/></components></object></resources></model>'));
  const r = parseEngineering3mf(zip.toBuffer());
  assert.strictEqual(r.ok, false);
  assert.ok(/引用落空/.test(r.error), r.error);
});

check('同 object 多 build item 实例化：不同 transform 的多份几何都保留（v83 回归）', () => {
  // 3MF 标准实例化手段：一盘 N 个相同件 = N 个 item 引同一 objectid——
  // 旧 visited 裸 key（pathKey#objectId）会把第 2..N 份静默丢件
  const zip = new AdmZip();
  const spec = `<?xml?><model><resources>
    <object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="0" z="0"/><vertex x="0" y="10" z="5"/></vertices><triangles><triangle v1="0" v2="1" v3="2"/></triangles></mesh></object>
  </resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 0 0 0"/><item objectid="1" transform="1 0 0 0 1 0 0 0 1 50 0 0"/></build></model>`;
  zip.addFile('3D/3dmodel.model', Buffer.from(spec));
  const r = parseEngineering3mf(zip.toBuffer());
  assert.strictEqual(r.ok, true, r.error || '');
  assert.strictEqual(r.parts, 2, 'build 两个 item = 两份');
  assert.strictEqual(r.mesh.triangles, 2, '同一 object 两处引用的几何都拼进来');
  const xs = [];
  for (let i = 0; i < r.mesh.positions.length; i += 3) xs.push(r.mesh.positions[i]);
  assert.ok(xs.includes(50), `第二份应带 +50 平移：${xs.join(',')}`);
});

console.log(`\n工程 3mf 自解析单测: ${pass} 通过 / ${failures} 失败`);
process.exit(failures ? 1 : 0);
