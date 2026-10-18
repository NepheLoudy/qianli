// ============================================================
// 模型几何体检（2026-10-11 曼波需求：几何特征自拟合；2026-10-11 二批扩 3mf）
//
// 「模型自己会说话」：模型上传前先做一次几何分析，把通孔/悬空悬端/
// 曲面占比/底面接触面积等特征算出来，映射为 taxonomy「几何体检（自动
// 检测）」组的预勾选建议——用户可改，提交后照旧走勾选 → 规则引擎链路
// （几何数值不进 processRules 的 when，validateRule 的「字段必须在池内」
// 不被打穿）。
//
// 输入格式：
//   STL（二进制/ASCII）——焊接索引网格，单体分析；
//   3mf（Bambu Studio 工程）——几何在 3D/Objects/object_*.model 的
//     <mesh> XML（vertex/triangle），多零件**逐件分析**（各自局部坐标 =
//     设计姿态，比整板姿态更有训练语义），件数/三角数超限逐件降级。
//
// 纯 Node（3mf 解包用既有 adm-zip）。能力边界（v1，按需升级）：
//   ① 孔检测 = 拓扑亏格（genus，闭合网格精确数通孔；多体=亏格相加）
//      + 平面片内环拟圆（拿孔径；穿过曲面的孔拿不到半径但 genus 仍计数）；
//   ② 悬空 = 面法线与 -Z 夹角分带（面积加权）+ 上半程悬空（悬端代理）；
//   ③ 接触面 = 贴底（z≈zmin 一层内）朝下面积 vs 包围盒占地；
//   ④ 曲面占比 = 总面积 - 显著平面片面积；
//   ⑤ 壁厚/倒扣细节不做（网格精确壁厚要中轴线分析，成本不在 v1）。
// 坐标一律按「上传/设计姿态」（与 taxonomy 受力参照系同一约定：Z=竖直向上）。
// ============================================================

const AdmZip = require('adm-zip');

const MAX_BYTES = 80 * 1024 * 1024;   // 整文件进内存防线（与 3mf 提取同口径）
const MAX_TRIANGLES = 600 * 1000;     // 全分析算力防线，超出降级为 skipped
const LAYER_H = 0.3;                  // 贴底判定容差（mm，≈一层层高）

// 建议阈值（单一事实源：suggestFromFeatures 与测试共用）
const THRESHOLDS = {
  holeMinRadius: 0.8,            // <0.8mm 的环当网格噪声
  holeMaxRadius: 60,
  circleFitTolerance: 0.25,      // 拟圆残差容许 max(|r_i - r|)，取与 r*15% 较大者
  overhangSevereDeg: 25,         // 面法线与 -Z 夹角 ≤25° 记「重悬空」带
  overhangModerateDeg: 50,       // ≤50° 记「需关注」带
  overhangSeverePct: 8,          // 重悬空面积占比 ≥8% → 建议悬空支撑
  upperOverhangPct: 5,           // 上半程（悬端）重悬空占比 ≥5% → 同上
  curvedPct: 30,                 // 曲面面积占比 ≥30% → 建议曲面保护
  contactRatio: 0.15,            // 贴底接触/占地 <15% → 建议加裙边
  contactSmallArea: 150,         // 或接触面积 <150mm² 且件高 >40mm
  contactSmallHeight: 40,
};

const q = (v) => (Object.is(Math.round(v), -0) ? 0 : Math.round(v)); // 防 -0 污染聚类 key

/** 3x3 行列式（行优先展开） */
function det3(m) {
  return m[0] * (m[4] * m[8] - m[5] * m[7])
    - m[1] * (m[3] * m[8] - m[5] * m[6])
    + m[2] * (m[3] * m[7] - m[4] * m[6]);
}

/** 3x3 线性方程组求解（克莱姆法则，m 行优先），奇异返回 null */
function solve3(m, b) {
  const det = det3(m);
  if (Math.abs(det) < 1e-9) return null;
  return [
    det3([b[0], m[1], m[2], b[1], m[4], m[5], b[2], m[7], m[8]]) / det,
    det3([m[0], b[0], m[2], m[3], b[1], m[5], m[6], b[2], m[8]]) / det,
    det3([m[0], m[1], b[0], m[3], m[4], b[1], m[6], m[7], b[2]]) / det,
  ];
}

/** Kåsa 代数圆拟合（平面 2D 点集）：u²+v² = 2au + 2bv + c → 圆心 (a,b)、半径 √(a²+b²+c)
 *  正规方程 XᵀXθ=Xᵀw（X 行=[2u,2v,1]，θ=[a,b,c]，w=u²+v²）：
 *  [2Σu² 2Σuv Σu; 2Σuv 2Σv² Σv; 2Σu 2Σv n]·[a b c]ᵀ = [Σuw Σvw Σw]ᵀ
 *  @returns {{cx, cy, r, maxErr}|null} 残差信息随返，调用方按容差取舍 */
function fitCircle2d(pts) {
  const A = [0, 0, 0, 0, 0, 0, 0, 0, 0], B = [0, 0, 0];
  for (const [u, v] of pts) {
    const w = u * u + v * v;
    A[0] += 2 * u * u; A[1] += 2 * u * v; A[2] += u;
    A[3] += 2 * u * v; A[4] += 2 * v * v; A[5] += v;
    A[6] += 2 * u; A[7] += 2 * v; A[8] += 1;
    B[0] += u * w; B[1] += v * w; B[2] += w;
  }
  const sol = solve3(A, B);
  if (!sol) return null;
  const [a, b, c] = sol;
  const r2 = a * a + b * b + c;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  let maxErr = 0;
  for (const [u, v] of pts) {
    const err = Math.abs(Math.hypot(u - a, v - b) - r);
    if (err > maxErr) maxErr = err;
  }
  return { cx: a, cy: b, r, maxErr };
}

/** 解析 STL（二进制/ASCII 自判）→ 焊接索引网格。
 *  导出器自带的法线不可信，全部自行重算。 */
function parseStl(buffer) {
  const head = buffer.subarray(0, 1024).toString('latin1').toLowerCase();
  const isAscii = head.startsWith('solid') && head.includes('facet');

  const weld = new Map();
  const positions = [];
  const faces = [];
  let triCount = 0;

  // 三顶点 → 焊接索引（1e-4mm 量化；STL 同一顶点坐标逐位一致，量化只为兼容 ASCII 舍入）
  function feed(ax, ay, az, bx, by, bz, cx, cy, cz) {
    const idx = [];
    for (const [x, y, z] of [[ax, ay, az], [bx, by, bz], [cx, cy, cz]]) {
      const key = `${q(x * 10000)}|${q(y * 10000)}|${q(z * 10000)}`;
      let i = weld.get(key);
      if (i === undefined) {
        i = positions.length / 3;
        weld.set(key, i);
        positions.push(x, y, z);
      }
      idx.push(i);
    }
    faces.push(idx[0], idx[1], idx[2]);
    triCount++;
  }

  if (isAscii) {
    if (buffer.length > 40 * 1024 * 1024) return { error: 'ASCII STL 过大（>40MB），请用 Bambu Studio/CAD 另存为二进制 STL 再上传' };
    const text = buffer.toString('latin1');
    const re = /vertex\s+(-?[\d.]+(?:[eE][+-]?\d+)?)\s+(-?[\d.]+(?:[eE][+-]?\d+)?)\s+(-?[\d.]+(?:[eE][+-]?\d+)?)/g;
    const buf9 = [];
    let m;
    while ((m = re.exec(text)) !== null) {
      buf9.push(Number(m[1]), Number(m[2]), Number(m[3]));
      if (buf9.length === 9) {
        feed(...buf9);
        buf9.length = 0;
        if (triCount > MAX_TRIANGLES) return { error: `三角形数超过体检上限 ${MAX_TRIANGLES}（网格过密）` };
      }
    }
  } else {
    if (buffer.length < 84) return { error: '二进制 STL 过短（连文件头都不全）' };
    const n = buffer.readUInt32LE(80);
    if (84 + n * 50 > buffer.length) return { error: '文件长度与三角数不符（文件截断？）' };
    if (n > MAX_TRIANGLES) return { error: `三角形数 ${n} 超过体检上限 ${MAX_TRIANGLES}（网格过密）` };
    for (let i = 0; i < n; i++) {
      const off = 84 + i * 50 + 12; // 跳过 12 字节存储法线
      feed(
        buffer.readFloatLE(off), buffer.readFloatLE(off + 4), buffer.readFloatLE(off + 8),
        buffer.readFloatLE(off + 12), buffer.readFloatLE(off + 16), buffer.readFloatLE(off + 20),
        buffer.readFloatLE(off + 24), buffer.readFloatLE(off + 28), buffer.readFloatLE(off + 32),
      );
    }
  }

  if (triCount === 0) return { error: '未解析到任何三角面（不是有效 STL？）' };
  return {
    positions: Float64Array.from(positions),
    faces: Uint32Array.from(faces),
    triangles: triCount,
    vertices: positions.length / 3,
    bodies: 1,
  };
}

// ---------- 3mf（Bambu Studio 工程）对象网格解析 ----------

/** 单个 object_*.model XML → 索引网格。XML 顶点已共享索引，无需焊接；
 *  顶点/三角按出现顺序拼装，属性顺序无关（逐标签抓 x/y/z、v1/v2/v3） */
function parse3mfObjectXml(xmlText) {
  const positions = [];
  const vRe = /<vertex\b[^>]*>/gi;
  const attrRe = /(x|y|z)\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = vRe.exec(xmlText)) !== null) {
    const tag = m[0];
    let x = 0, y = 0, z = 0, ok = 0;
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(tag)) !== null) {
      const v = Number(a[2]);
      if (!Number.isFinite(v)) continue;
      if (a[1] === 'x') { x = v; ok++; } else if (a[1] === 'y') { y = v; ok++; } else if (a[1] === 'z') { z = v; ok++; }
    }
    if (ok === 3) positions.push(x, y, z);
  }
  const triCount = (xmlText.match(/<triangle\b/gi) || []).length;
  if (positions.length === 0 || triCount === 0) return { error: '对象网格为空（components 装配体或非网格对象）' };
  const faces = new Uint32Array(triCount * 3);
  const tRe = /<triangle\b[^>]*>/gi;
  const vAttrRe = /(v[123])\s*=\s*"([^"]+)"/gi; // 三角属性是 v1/v2/v3，别和顶点的 x/y/z 混用
  let fi = 0;
  while ((m = tRe.exec(xmlText)) !== null) {
    const tag = m[0];
    const idx = {};
    vAttrRe.lastIndex = 0;
    let a;
    while ((a = vAttrRe.exec(tag)) !== null) {
      idx[a[1]] = Number(a[2]);
    }
    if (idx.v1 === undefined || idx.v2 === undefined || idx.v3 === undefined) { faces[fi++] = 0; faces[fi++] = 0; faces[fi++] = 0; continue; }
    faces[fi++] = idx.v1; faces[fi++] = idx.v2; faces[fi++] = idx.v3;
  }
  return {
    positions: Float64Array.from(positions),
    faces,
    triangles: triCount,
    vertices: positions.length / 3,
    bodies: 1,
  };
}

/** 3mf（Buffer）→ 逐对象网格列表。一个 3mf 工程常含多个零件，
 *  每件独立分析（各自局部坐标 = 设计姿态）。超限对象降级跳过不拖垮整文件 */
function parse3mfModel(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch (err) { return { error: `3mf 解包失败: ${err.message}` }; }
  const objects = [];
  const skipped = [];
  const pushParsed = (name, xmlText) => {
    const parsed = parse3mfObjectXml(xmlText);
    if (parsed.error) { skipped.push({ name, reason: parsed.error }); return; }
    if (parsed.triangles > MAX_TRIANGLES) { skipped.push({ name, reason: `三角数 ${parsed.triangles} 超上限 ${MAX_TRIANGLES}` }); return; }
    objects.push({ name, ...parsed });
  };
  const objEntries = zip.getEntries().filter((e) => /^3D\/Objects\/.*\.model$/i.test(e.entryName));
  for (const e of objEntries) {
    const name = e.entryName.replace(/^3D\/Objects\//i, '').replace(/\.model$/i, '');
    if (e.header.size > MAX_BYTES) { skipped.push({ name, reason: '对象过大' }); continue; }
    let xmlText;
    try { xmlText = e.getData().toString('utf8'); } catch (err) { skipped.push({ name, reason: `解压失败: ${err.message}` }); continue; }
    pushParsed(name, xmlText);
  }
  if (objects.length === 0) {
    // 3MF 标准布局兜底（2026-10-16 修复）：切片器保存的工程/直通 3mf 几何在 **3D/3dmodel.model**，
    // 而非 Bambu 内部 3D/Objects/* 目录——此前只认后者，直通单几何特征全体「未提取」（曼波真单实测）。
    // 逐 <object> 分块解析保持各件局部坐标（components 装配/build 变换暂不施加，后续按需烘焙）
    const spec = zip.getEntry('3D/3dmodel.model');
    if (!spec) return { error: '3mf 内无几何（既无 3D/Objects/*.model 也无 3D/3dmodel.model）', skipped };
    if (spec.header.size > MAX_BYTES) return { error: '3dmodel.model 过大', skipped };
    let xmlText;
    try { xmlText = spec.getData().toString('utf8'); } catch (err) { return { error: `3dmodel.model 解压失败: ${err.message}`, skipped }; }
    const blocks = xmlText.match(/<object\b[\s\S]*?<\/object>/gi) || [];
    for (const block of blocks) {
      const nm = /<object\b[^>]*\bid\s*=\s*"([^"]+)"/i.exec(block);
      pushParsed(nm ? `object_${nm[1]}` : 'model', block);
    }
    if (blocks.length === 0) pushParsed('model', xmlText); // 无 <object> 分块的极简文件：整体当一件
  }
  if (objects.length === 0) return { error: '3mf 内没有可分析的对象网格', skipped };
  return { objects, skipped };
}

/** 面法线（未归一）与有向面积；朝向一致性由调用方按体积符号校正 */
function faceGeometry(positions, faces, t) {
  const a = faces[t * 3] * 3, b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
  const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
  const ux = positions[b] - ax, uy = positions[b + 1] - ay, uz = positions[b + 2] - az;
  const vx = positions[c] - ax, vy = positions[c + 1] - ay, vz = positions[c + 2] - az;
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return { nx, ny, nz, len, area: len / 2, ax, ay, az };
}

/** STL Buffer → 几何特征 + 预勾选建议 */
function analyzeStl(buffer) {
  if (buffer.length > MAX_BYTES) return { ok: false, skipped: true, reason: `文件 ${Math.round(buffer.length / 1048576)}MB 超过体检上限 80MB` };
  const parsed = parseStl(buffer);
  if (parsed.error) return { ok: false, skipped: true, reason: parsed.error };
  return analyzeMesh(parsed);
}

/**
 * 已切片 3mf → 几何特征**估计**（2026-10-16 曼波令）：切片导出件（.gcode.3mf）**不含网格**
 * （3dmodel.model 为空壳，曼波真单实测）——几何特征只能从 gcode/切片元数据估计：
 * 包围盒（G1 移动坐标扫描 + 头注释 max_z_height）、层数、体积（切片重量 ÷ 密度）、用料数。
 * 孔/悬垂/曲面等网格级特征无法估计（置 null）；调用方按「低权重」存档（featureSource='gcode-estimate'）。
 */
function estimateFromSliced3mf(buffer) {
  if (buffer.length > MAX_BYTES) return { ok: false, skipped: true, reason: `文件 ${Math.round(buffer.length / 1048576)}MB 超过体检上限 80MB` };
  let zip;
  try { zip = new AdmZip(buffer); } catch (err) { return { ok: false, skipped: true, reason: `3mf 解包失败: ${err.message}` }; }
  const gcode = zip.getEntry('Metadata/plate_1.gcode');
  const raw = {};
  try {
    const ps = zip.getEntry('Metadata/project_settings.config');
    if (ps && ps.header.size <= 8 * 1024 * 1024) { const j = JSON.parse(ps.getData().toString('utf8')); for (const [k, v] of Object.entries(j)) raw[k] = String(v); }
  } catch { /* 容忍 */ }
  if (!gcode) return { ok: false, skipped: true, reason: '无可估计的 gcode（既无网格也无 plate_1.gcode）' };
  if (gcode.header.size > 128 * 1024 * 1024) return { ok: false, skipped: true, reason: 'gcode 解压后超过 128MB，跳过估计' };
  let text;
  try { text = gcode.getData().toString('utf8'); } catch (err) { return { ok: false, skipped: true, reason: `gcode 解压失败: ${err.message}` }; }
  // 头部注释：最大高度/层数（Orca/Bambu 均有）；移动坐标：X/Y 范围
  const zH = Number((/;\s*max_z_height:\s*([\d.]+)/.exec(text) || [])[1]) || 0;
  const layers = Number((/;\s*total layer number:\s*(\d+)/.exec(text) || [])[1]) || 0;
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  const mv = /^G[01]\s([^\n]*)$/gm;
  let m;
  while ((m = mv.exec(text)) !== null) {
    const seg = m[1];
    if (seg.length > 200) continue; // 超长行（成形起始）跳过
    const x = /X(-?[\d.]+)/.exec(seg);
    const y = /Y(-?[\d.]+)/.exec(seg);
    if (x) { const v = Number(x[1]); if (v < mnX) mnX = v; if (v > mxX) mxX = v; }
    if (y) { const v = Number(y[1]); if (v < mnY) mnY = v; if (v > mxY) mxY = v; }
  }
  // 体积估计：切片重量 ÷ 密度（slice_info 的 weight + project_settings filament_density）
  let volumeCm3 = 0;
  try {
    const si = zip.getEntry('Metadata/slice_info.config');
    const w = si ? Number((/<metadata key="weight" value="([\d.]+)"/.exec(si.getData().toString('utf8')) || [])[1]) || 0 : 0;
    const dens = Number(((raw.filament_density || '').match(/[\d.]+/) || [])[0]) || 0;
    if (w > 0 && dens > 0) volumeCm3 = +(w / dens).toFixed(2);
  } catch { /* 容忍 */ }
  const filaments = (() => { try { return JSON.parse(raw.filament_colour || '[]').length || 1; } catch { return 1; } })();
  return {
    ok: true,
    source: 'gcode-estimate',
    layers,
    totalLayers: layers,
    bbox: {
      x: Number.isFinite(mnX) ? +(mxX - mnX).toFixed(1) : null,
      y: Number.isFinite(mnY) ? +(mxY - mnY).toFixed(1) : null,
      z: zH || null,
    },
    volumeCm3: volumeCm3 || null,
    filaments,
    holes: null, overhang: null, contact: null, curvedPct: null, mesh: null,
    note: '已切片 3mf 不含网格——几何特征由 gcode/切片元数据估计（孔/悬垂/曲面等网格级特征不可估计）',
    suggestions: { selection: {}, notes: ['几何特征为 gcode 估计值（低权重）'] },
  };
}

/** 已切片 3mf 特征获取统一入口：优先网格分析（完整工程 3mf 含网格），无网格回落 gcode 估计。
 *  @returns {{ features, featureSource: 'auto'|'gcode-estimate' }} */
function featuresFromSliced3mf(buffer) {
  const mesh = analyze3mf(buffer);
  if (mesh && mesh.ok) return { features: mesh, featureSource: 'auto' };
  return { features: estimateFromSliced3mf(buffer), featureSource: 'gcode-estimate' };
}

/** 3mf Buffer → 逐对象几何特征（多零件工程每件一条；件级失败进 skippedObjects 不拖垮整文件） */
function analyze3mf(buffer) {
  if (buffer.length > MAX_BYTES) return { ok: false, skipped: true, reason: `文件 ${Math.round(buffer.length / 1048576)}MB 超过体检上限 80MB` };
  const model = parse3mfModel(buffer);
  if (model.error) return { ok: false, skipped: true, reason: model.error, skippedObjects: model.skipped || [] };
  const objects = model.objects.map((obj) => ({ name: obj.name, ...analyzeMesh(obj) }));
  return { ok: true, objectCount: objects.length, objects, skippedObjects: model.skipped || [] };
}

/** 索引网格 → 几何特征 + taxonomy 预勾选建议（STL/3mf 共用核心）。
 *  分析不了返回 { ok:false, skipped:true, reason }（调用方降级，不阻塞提交）。 */
/** STEP/IGES Buffer → 几何特征（2026-10-15 曼波令；occt WASM 网格化，async）。
 *  与 STL/3mf 走同一 analyzeMesh 核心。 */
async function analyzeStep(buffer, fileName = '') {
  if (buffer.length > MAX_BYTES) return { ok: false, skipped: true, reason: `文件 ${Math.round(buffer.length / 1048576)}MB 超过体检上限 80MB` };
  const parsed = await require('../utils/stepMesh').parseCadToParsed(buffer, fileName);
  if (parsed.error) return { ok: false, skipped: true, reason: parsed.error };
  return analyzeMesh(parsed);
}

function analyzeMesh(parsed) {
  const { positions, faces, triangles, vertices, bodies: nBodies = 1 } = parsed;

  // ---- 包围盒 ----
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertices; i++) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const size = { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };

  // ---- 逐面：面积/法线/重心z + 体积（有号四面体累加，符号判整体朝向）----
  const faceArea = new Float64Array(triangles);
  const faceCz = new Float64Array(triangles);
  const faceDown = new Float32Array(triangles); // 校正后的「朝下程度」= cos(法线,-Z)，>0 朝下
  let volume6 = 0, totalArea = 0;
  for (let t = 0; t < triangles; t++) {
    const g = faceGeometry(positions, faces, t);
    faceArea[t] = g.area;
    totalArea += g.area;
    faceCz[t] = g.az; // 重心 z 用第一顶点近似（分带用，误差可接受）
    const b = faces[t * 3 + 1] * 3, c = faces[t * 3 + 2] * 3;
    volume6 += g.ax * (positions[b + 1] * positions[c + 2] - positions[b + 2] * positions[c + 1])
      + g.ay * (positions[b + 2] * positions[c] - positions[b] * positions[c + 2])
      + g.az * (positions[b] * positions[c + 1] - positions[b + 1] * positions[c]);
    // 「朝下程度」= cos(法线与 -Z 夹角)：外向网格的朝下面法线 nz<0，取负号让 >0 = 朝下
    faceDown[t] = g.len > 0 ? -(g.nz / g.len) : 0;
  }
  const volume = volume6 / 6;
  if (volume < 0) { for (let t = 0; t < triangles; t++) faceDown[t] = -faceDown[t]; } // 朝向翻转的网格整体翻回

  // ---- 悬空分带 + 贴底接触 ----
  const cosSevere = Math.cos((THRESHOLDS.overhangSevereDeg * Math.PI) / 180);
  const cosModerate = Math.cos((THRESHOLDS.overhangModerateDeg * Math.PI) / 180);
  let severeArea = 0, moderateArea = 0, upperOverhangArea = 0, contactArea = 0;
  const zSpan = Math.max(size.z, 1e-6);
  for (let t = 0; t < triangles; t++) {
    const down = faceDown[t];
    if (down <= 0) continue;
    const area = faceArea[t];
    const onPlate = faceCz[t] <= minZ + LAYER_H;
    if (onPlate) { contactArea += area; continue; } // 贴底层=打印板托着，不算悬空
    if (down >= cosSevere) {
      severeArea += area;
      if (faceCz[t] > minZ + 0.35 * zSpan) upperOverhangArea += area; // 悬端代理：上半程的重悬空
    } else if (down >= cosModerate) {
      moderateArea += area;
    }
  }
  const pct = (x) => (totalArea > 0 ? (x / totalArea) * 100 : 0);

  // ---- 边表 → 流形性 + 亏格（通孔数） ----
  const edgeMap = new Map(); // "小顶点_大顶点" → 邻接面数组（1=开边，2=正常，>2=非流形）
  for (let t = 0; t < triangles; t++) {
    for (let e = 0; e < 3; e++) {
      const v1 = faces[t * 3 + e], v2 = faces[t * 3 + (e + 1) % 3];
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      const arr = edgeMap.get(key);
      if (arr) { if (arr.length < 2) arr.push(t); } else edgeMap.set(key, [t]);
    }
  }
  let openEdges = 0, nonManifoldEdges = 0;
  for (const arr of edgeMap.values()) {
    if (arr.length === 1) openEdges++;
    else if (arr.length > 2) nonManifoldEdges++;
  }
  const closed = openEdges === 0 && nonManifoldEdges === 0;
  // 欧拉示性数：V - E + F = 2k - 2g（k = 独立闭合体数）→ 亏格 = 通道数（无内空腔假设）
  const genus = closed ? Math.max(0, Math.round((2 * nBodies - (vertices - edgeMap.size + triangles)) / 2)) : null;

  // ---- 平面片聚类（量化法线 + 平面偏移）→ 曲面占比 ----
  const clusters = new Map();
  for (let t = 0; t < triangles; t++) {
    if (faceArea[t] <= 0) continue;
    const g = faceGeometry(positions, faces, t);
    let nx = g.nx / g.len, ny = g.ny / g.len, nz = g.nz / g.len;
    if (nx + ny + nz < 0) { nx = -nx; ny = -ny; nz = -nz; } // 法线定向归一，防同面正反两张皮
    const d = nx * g.ax + ny * g.ay + nz * g.az;
    const key = `${q(nx * 100)}_${q(ny * 100)}_${q(nz * 100)}_${q(d * 10)}`;
    let cl = clusters.get(key);
    if (!cl) { cl = { area: 0, faces: [] }; clusters.set(key, cl); }
    cl.area += faceArea[t];
    cl.faces.push(t);
  }
  const sigArea = Math.max(20, totalArea * 0.002); // 显著平面片门槛（按面积过滤剖分噪声；粗网格一个面只有 2 个三角，不能按面数卡）
  let planarArea = 0;
  const bigPatches = [];
  for (const cl of clusters.values()) {
    if (cl.area >= sigArea) {
      planarArea += cl.area;
      if (cl.area >= Math.max(80, totalArea * 0.01)) bigPatches.push(cl); // 孔口只长在像样的面上
    }
  }
  const curvedPct = totalArea > 0 ? 100 - (planarArea / totalArea) * 100 : 0;

  // ---- 大平面片边界环 → 内环拟圆 → 孔口候选 ----
  const facesCluster = new Int32Array(triangles).fill(-1);
  bigPatches.forEach((cl, ci) => { for (const f of cl.faces) facesCluster[f] = ci; });

  const holeLoops = [];
  bigPatches.forEach((cl, ci) => {
    // 片边界边：邻面不在同片（开边/非流形视作边界）
    const boundary = new Map();
    for (const f of cl.faces) {
      for (let e = 0; e < 3; e++) {
        const v1 = faces[f * 3 + e], v2 = faces[f * 3 + (e + 1) % 3];
        const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
        const nb = edgeMap.get(key) || [];
        const other = nb.find((x) => x !== f);
        if (other === undefined || facesCluster[other] !== ci) boundary.set(key, [v1, v2]);
      }
    }
    if (boundary.size === 0 || boundary.size > 4096) return;

    // 片级共享投影基（法线 + u/v 轴 + 原点）——所有环投到同一 2D 坐标系，
    // 内环判定（环心是否落进另一环）才可比
    const g0 = faceGeometry(positions, faces, cl.faces[0]);
    let nx = g0.nx / g0.len, ny = g0.ny / g0.len, nz = g0.nz / g0.len;
    if (nx + ny + nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    const gx = Math.abs(nx) <= Math.abs(ny) && Math.abs(nx) <= Math.abs(nz) ? 1 : 0;
    const gy = gx === 0 ? (Math.abs(ny) <= Math.abs(nz) ? 1 : 0) : 0;
    const gz = gx + gy === 0 ? 1 : 0;
    let ux = gy * nz - gz * ny, uy = gz * nx - gx * nz, uz = gx * ny - gy * nx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const wx = ny * uz - nz * uy, wy = nz * ux - nx * uz, wz = nx * uy - ny * ux;
    const o0 = faces[cl.faces[0] * 3] * 3;
    const originU = positions[o0] * ux + positions[o0 + 1] * uy + positions[o0 + 2] * uz;
    const originW = positions[o0] * wx + positions[o0 + 1] * wy + positions[o0 + 2] * wz;
    const proj2d = (vi) => {
      const px = positions[vi * 3], py = positions[vi * 3 + 1], pz = positions[vi * 3 + 2];
      return [
        px * ux + py * uy + pz * uz - originU,
        px * wx + py * wy + pz * wz - originW,
      ];
    };

    const vertEdges = new Map();
    for (const [key, [v1, v2]] of boundary) {
      if (!vertEdges.has(v1)) vertEdges.set(v1, []);
      if (!vertEdges.has(v2)) vertEdges.set(v2, []);
      vertEdges.get(v1).push({ key, other: v2 });
      vertEdges.get(v2).push({ key, other: v1 });
    }

    const visited = new Set();
    for (const [startKey, startEnds] of boundary) {
      if (visited.has(startKey)) continue;
      // 注意起始边不预标记：闭合靠「下一跳回到起点」判定，预标记会让闭合边
      // 提前进 visited，最后一跳 cands 为空断链（首版 bug，全部环误判开链）
      const loop = [startEnds[0]];
      let prevV = startEnds[1], curV = startEnds[0];
      let closedLoop = false;
      while (loop.length <= 512) {
        const cands = (vertEdges.get(curV) || []).filter((x) => !visited.has(x.key) && x.other !== prevV);
        const next = cands[0];
        if (!next) break;
        visited.add(next.key);
        if (next.other === loop[0]) { closedLoop = true; break; }
        loop.push(next.other);
        prevV = curV; curV = next.other;
      }
      if (!closedLoop || loop.length < 6) continue; // 开链/微环不拟圆

      const pts = loop.map(proj2d);
      const fit = fitCircle2d(pts);
      if (!fit) continue;
      const tol = Math.max(THRESHOLDS.circleFitTolerance, fit.r * 0.15);
      if (fit.r < THRESHOLDS.holeMinRadius || fit.r > THRESHOLDS.holeMaxRadius || fit.maxErr > tol) continue;
      let cenX = 0, cenY = 0, cenZ = 0;
      for (const vi of loop) {
        cenX += positions[vi * 3]; cenY += positions[vi * 3 + 1]; cenZ += positions[vi * 3 + 2];
      }
      holeLoops.push({
        ci, r: fit.r, n: loop.length,
        center: [cenX / loop.length, cenY / loop.length, cenZ / loop.length],
        normal: [nx, ny, nz],
        ptsLocal: pts, // 片级共享坐标系
        fitCx: fit.cx, fitCy: fit.cy,
      });
    }
  });

  // 内环判定：环心落在同片另一个环内（局部 2D 射线法）＝这是孔口不是外轮廓
  function pointInLoop(pt, loopPts) {
    let inside = false;
    for (let i = 0, j = loopPts.length - 1; i < loopPts.length; j = i++) {
      const [xi, yi] = loopPts[i], [xj, yj] = loopPts[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  // 内环判定：本环整体落在同片另一个环内 ⟺ 两环心距 + 本环半径 ≤ 对方半径
  // （同心环反例：外轮廓环心恰在内孔多边形里，只测「环心在内」会内外颠倒）
  const holes = [];
  for (const h of holeLoops) {
    if (!holeLoops.some((o) => o !== h && o.ci === h.ci
      && Math.hypot(h.fitCx - o.fitCx, h.fitCy - o.fitCy) + h.r <= o.r + 0.1
      && pointInLoop([h.fitCx, h.fitCy], o.ptsLocal))) continue;
    // 同孔去重：另一端对合口（中心几乎同轴、半径一致）或同一位置重复检出
    const dup = holes.find((x) => Math.abs(x.r - h.r) <= Math.max(0.25, h.r * 0.2) && (() => {
      const dx = x.center[0] - h.center[0], dy = x.center[1] - h.center[1], dz = x.center[2] - h.center[2];
      const dist = Math.hypot(dx, dy, dz);
      if (dist < 0.5) return true;
      const along = Math.abs(dx * h.normal[0] + dy * h.normal[1] + dz * h.normal[2]);
      return along / dist > 0.995; // 中心差与孔轴平行 = 同一孔的两端
    })());
    if (dup) continue;
    holes.push({ r: h.r, center: h.center, normal: h.normal });
  }
  holes.sort((a, b) => a.r - b.r);
  // 孔数取「亏格」与「拟圆检出」的较大者：genus 稳但含曲面孔，拟圆准但只覆盖平面片
  const holeCount = Math.max(holes.length, genus || 0);
  // 圆口全参数（3D 标注工房的线标注候选：孔口环 = 识别直接投给标注层的产物）
  const circles = holes.slice(0, 8).map((h) => ({
    c: h.center.map((v) => +v.toFixed(2)),
    n: h.normal.map((v) => +v.toFixed(3)),
    r: +h.r.toFixed(2),
  }));

  // ---- 汇总 ----
  const footprint = size.x * size.y;
  const features = {
    ok: true,
    triangles, vertices,
    bbox: { x: +size.x.toFixed(2), y: +size.y.toFixed(2), z: +size.z.toFixed(2) },
    volumeCm3: +(Math.abs(volume) / 1000).toFixed(2),
    surfaceAreaCm2: +(totalArea / 100).toFixed(1),
    overhang: {
      severePct: +pct(severeArea).toFixed(1),
      moderatePct: +pct(moderateArea).toFixed(1),
      upperOverhangPct: +pct(upperOverhangArea).toFixed(1),
    },
    contact: { areaMm2: Math.round(contactArea), footprintPct: +(footprint > 0 ? (contactArea / footprint) * 100 : 0).toFixed(1) },
    curvedPct: +curvedPct.toFixed(1),
    mesh: { closed, openEdges, nonManifoldEdges, genus },
    holes: {
      count: holeCount,
      genusCount: genus,
      loopCount: holes.length,
      radii: holes.slice(0, 8).map((h) => +h.r.toFixed(2)), // 升序，最小孔在前
      circles, // 圆口全参数（圆心/法向/半径）——3D 标注工房线标注候选
      openMesh: !closed,
    },
  };
  return { ...features, suggestions: suggestFromFeatures(features) };
}

/** 特征 → taxonomy「几何体检」组预勾选建议 + 人话说明。
 *  只在有把握时给 true，绝不替用户给 false；勾了仍可改。 */
function suggestFromFeatures(features) {
  if (!features || !features.ok) {
    return { selection: {}, notes: features && features.skipped ? [`体检跳过：${features.reason}`] : [] };
  }
  const t = THRESHOLDS;
  const notes = [];
  const selection = {};

  if (features.holes.count > 0) {
    // 孔补偿分轴向（2026-10-16 曼波令）：竖直孔（轴≈Z）与水平孔（轴在 XY）补偿机理不同——
    // 按孔口拟圆法向逐一判别各自给建议；无圆口明细（非闭合网格按亏格计）时保守给 Z 向
    const circles = Array.isArray(features.holes.circles) ? features.holes.circles : [];
    const isVertical = (n) => Math.abs(Number(n && n[2]) || 0) > 0.9;
    let hasZ = false;
    let hasXy = false;
    for (const c of circles) { if (isVertical(c.n)) hasZ = true; else hasXy = true; }
    if (!circles.length) hasZ = true;
    if (hasZ) selection.hole_comp_z = true;
    if (hasXy) selection.hole_comp_xy = true;
    const axisLabel = hasZ && hasXy ? '·Z 向+XY 向' : hasZ ? '·Z 向' : '·XY 向';
    notes.push(`检测到 ${features.holes.count} 个孔特征${features.holes.radii[0] !== undefined ? `（最小半径 ${features.holes.radii[0]}mm）` : ''}${features.holes.openMesh ? '；⚠️ 网格不闭合，孔数按圆口检出计' : ''}——打印孔径会缩，已预勾「通孔补偿${axisLabel}」`);
  }
  if (features.overhang.severePct >= t.overhangSeverePct || features.overhang.upperOverhangPct >= t.upperOverhangPct) {
    selection.overhang_heavy = true;
    notes.push(`重悬空面积 ${features.overhang.severePct}%${features.overhang.upperOverhangPct >= t.upperOverhangPct ? `、上半程悬端 ${features.overhang.upperOverhangPct}%` : ''}——已预勾「悬空支撑」，建议顺手确认打印朝向`);
  }
  if (features.curvedPct >= t.curvedPct) {
    selection.curved_surface = true;
    notes.push(`曲面/过渡面占比 ${features.curvedPct}%——已预勾「曲面保护」；若曲面是接触面/外观面，请再补勾对应工况标签`);
  }
  const smallByRatio = features.contact.footprintPct < t.contactRatio * 100;
  const smallByAbs = features.contact.areaMm2 < t.contactSmallArea && features.bbox.z > t.contactSmallHeight;
  if (smallByRatio || smallByAbs) {
    selection.small_footprint = true;
    notes.push(`贴底接触 ${features.contact.areaMm2}mm²（占占地比 ${features.contact.footprintPct}%）${features.bbox.z > t.contactSmallHeight ? `、件高 ${features.bbox.z}mm` : ''}——已预勾「小接触面加裙边」防倾倒翘边`);
  }
  return { selection, notes };
}

module.exports = { analyzeStl, analyze3mf, analyzeStep, analyzeMesh, estimateFromSliced3mf, featuresFromSliced3mf, suggestFromFeatures, fitCircle2d, parseStl, parse3mfModel, parse3mfObjectXml, THRESHOLDS, MAX_TRIANGLES, MAX_BYTES };
