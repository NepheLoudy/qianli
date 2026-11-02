'use strict';

/**
 * 工程 3mf 自解析（v64 · 曼波令「纯 3mf 自解析能力」）：
 * Bambu Studio/MakerWorld 保存的**工程 3mf**（无 plate gcode 条目）没有可下发的刀轨，
 * 但内含完整网格——本模块把它解成单个合并网格，交给摆向/切片链（autoSlice），
 * 实现「MakerWorld 下载 → 平台直接自动切片」。
 *
 * 结构实锤（Poop-Bucket-Plain-H-Series 实案）：
 *   · 3D/3dmodel.model 只有 <object><components><component p:path="/3D/Objects/object_N.model"
 *     objectid transform>，mesh 在外部 Objects/*.model 文件（跨文件引用）；
 *   · 工程件通常无 <build> 段（未布盘）——顶层 object 全部视为待打印实体；
 *   · component/object transform 是 3MF 规范的 12 值行主序 4x3（v' = [x y z 1]·M，
 *     m30..32 = 平移），递归拼装时子先父后级联相乘。
 *
 * 合并语义：全部顶层 object 合成**单网格**（MakerWorld「一模型多 part」的普遍预期
 * ——Studio 打开也是全选布盘）；parts 数量随结果透出供审计。真装配分件打印属
 * 未来需求，v1 不拆。
 */

const AdmZip = require('adm-zip');

const MAX_TRIANGLES = 600 * 1000; // 与 modelFeatures 同口径的算力防线

/** 3MF 12 值 transform → 4x3 行主序数组（v' = [x y z 1]·M）；缺省单位阵 */
function parseXform(str) {
  const identity = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
  if (!str) return identity;
  const n = String(str).trim().split(/\s+/).map(Number);
  if (n.length !== 12 || n.some((v) => !Number.isFinite(v))) return identity;
  return n;
}

/** 4x3 行主序矩阵合成：v·C·P 的等效 M（先 child 后 parent） */
function mulXform(child, parent) {
  // 4x4 行向量约定展开：C4 = [[c0..c2,0],[c3..c5,0],[c6..c8,0],[c9..c11,1]]，P4 同构
  const C = [[child[0], child[1], child[2], 0], [child[3], child[4], child[5], 0], [child[6], child[7], child[8], 0], [child[9], child[10], child[11], 1]];
  const P = [[parent[0], parent[1], parent[2], 0], [parent[3], parent[4], parent[5], 0], [parent[6], parent[7], parent[8], 0], [parent[9], parent[10], parent[11], 1]];
  const M = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) M[r][c] += C[r][k] * P[k][c];
  return [M[0][0], M[0][1], M[0][2], M[1][0], M[1][1], M[1][2], M[2][0], M[2][1], M[2][2], M[3][0], M[3][1], M[3][2]];
}

function applyXform(positions, M) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    out[i] = x * M[0] + y * M[3] + z * M[6] + M[9];
    out[i + 1] = x * M[1] + y * M[4] + z * M[7] + M[10];
    out[i + 2] = x * M[2] + y * M[5] + z * M[8] + M[11];
  }
  return out;
}

/** 解析单个 model XML：object id → {meshXml | components} */
function parseModelXml(xmlText) {
  const objects = new Map();
  const blocks = xmlText.match(/<object\b[\s\S]*?<\/object>/gi) || [];
  for (const block of blocks) {
    const idM = /<object\b[^>]*\bid\s*=\s*"([^"]+)"/i.exec(block);
    if (!idM) continue;
    const meshM = block.match(/<mesh\b[\s\S]*?<\/mesh>/i);
    const comps = [];
    if (/<components\b/i.test(block)) {
      const compBlock = block.match(/<components\b[\s\S]*?<\/components>/i);
      for (const m of (compBlock ? compBlock[0] : '').matchAll(/<component\b([^>]*)\/?>/gi)) {
        const attrs = {};
        for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
        comps.push({ path: attrs['p:path'] || attrs.path || '', objectid: attrs.objectid, transform: parseXform(attrs.transform) });
      }
    }
    objects.set(idM[1], { meshXml: meshM ? meshM[0] : null, components: comps });
  }
  return objects;
}

/**
 * 主入口：工程 3mf → 合并网格。
 * @returns {{ok:true, mesh:{positions:Float64Array,faces:Uint32Array,triangles:number,vertices:number}, parts:number}
 *          |{ok:false, reason:'empty'|'too-complex'|'multi-part-refs-broken', error:string}}
 */
function parseEngineering3mf(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch (err) { return { ok: false, reason: 'empty', error: `3mf 解包失败: ${err.message}` }; }
  const specEntry = zip.getEntry('3D/3dmodel.model');
  if (!specEntry) return { ok: false, reason: 'empty', error: '3mf 内无 3D/3dmodel.model' };
  if (specEntry.header.size > 32 * 1024 * 1024) return { ok: false, reason: 'too-complex', error: '3dmodel.model 超过 32MB 解析上限' };

  // 注册表：pathKey（'' = 主 spec，其余 = Objects 条目名）→ Map(objectId → obj)
  const registry = new Map();
  const loadModel = (pathKey, xmlText) => {
    if (registry.has(pathKey)) return;
    registry.set(pathKey, parseModelXml(xmlText));
  };
  loadModel('', specEntry.getData().toString('utf8'));
  for (const e of zip.getEntries()) {
    if (/^3D\/Objects\/.*\.model$/i.test(e.entryName)) {
      if (e.header.size > 32 * 1024 * 1024) continue; // 与主 spec 同款解压护栏，防高压缩比 zip 打爆内存
      loadModel(e.entryName.replace(/^\//, ''), e.getData().toString('utf8'));
    }
  }

  // 顶层实体：有 <build> 用其 item 序列；无 build（工程件常态）用主 spec 全部顶层 object
  const specXml = specEntry.getData().toString('utf8');
  const buildM = specXml.match(/<build>[\s\S]*?<\/build>/i);
  const tops = [];
  if (buildM) {
    for (const m of buildM[0].matchAll(/<item\b([^>]*)\/?>/gi)) {
      const attrs = {};
      for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
      if (attrs.objectid) tops.push({ path: '', objectid: attrs.objectid, transform: parseXform(attrs.transform) });
    }
  }
  if (!tops.length) {
    for (const id of registry.get('').keys()) tops.push({ path: '', objectid: id, transform: parseXform('') });
  }
  if (!tops.length) return { ok: false, reason: 'empty', error: '工程 3mf 内没有可打印实体' };

  // 递归拼装（跨文件 component + transform 级联）
  const out = { positions: [], faces: [], triangles: 0, vertices: 0 };
  const resolve = (pathKey, objectId, xform, depth, visited) => {
    if (depth > 16) throw new Error('components 嵌套超过 16 层（疑似循环引用）');
    // visited 键必须含 transform：同一 object 以不同 transform 多处引用是 3MF 标准实例化
    // 手段（一盘 N 个相同件），裸 key 会把第 2..N 份静默丢件（v83 审查修复）
    const key = `${pathKey}#${objectId}#${xform.join(',')}`;
    if (visited.has(key)) return;
    visited.add(key);
    const obj = (registry.get(pathKey) || new Map()).get(String(objectId));
    if (!obj) throw new Error(`object 引用落空：${pathKey || '(spec)'}#${objectId}`);
    if (obj.meshXml) {
      // mesh 块解析（与 modelFeatures.parse3mfObjectXml 同款属性口径，本地轻量实现）
      const positions = [];
      let m;
      const vRe = /<vertex\b[^>]*>/gi;
      const attrRe = /(x|y|z)\s*=\s*"([^"]+)"/gi;
      while ((m = vRe.exec(obj.meshXml)) !== null) {
        const tag = m[0];
        let x = 0, y = 0, z = 0, ok = 0, a;
        attrRe.lastIndex = 0;
        while ((a = attrRe.exec(tag)) !== null) {
          const v = Number(a[2]);
          if (!Number.isFinite(v)) continue;
          if (a[1] === 'x') { x = v; ok++; } else if (a[1] === 'y') { y = v; ok++; } else if (a[1] === 'z') { z = v; ok++; }
        }
        if (ok === 3) positions.push(x, y, z);
      }
      const triCount = (obj.meshXml.match(/<triangle\b/gi) || []).length;
      if (!positions.length || !triCount) return; // 空网格 object（纯容器）跳过
      const placed = applyXform(Float64Array.from(positions), xform);
      const offset = out.vertices;
      for (let i = 0; i < placed.length; i++) out.positions.push(placed[i]);
      const tRe = /<triangle\b[^>]*>/gi;
      const vAttrRe = /(v[123])\s*=\s*"([^"]+)"/gi;
      let a; // 第二个循环的游标（第一个循环的 a 是其块级局部）
      while ((m = tRe.exec(obj.meshXml)) !== null) {
        const tag = m[0];
        const idx = {};
        vAttrRe.lastIndex = 0;
        while ((a = vAttrRe.exec(tag)) !== null) idx[a[1]] = Number(a[2]);
        out.faces.push(offset + (idx.v1 || 0), offset + (idx.v2 || 0), offset + (idx.v3 || 0));
        out.triangles++;
      }
      out.vertices += positions.length / 3;
      if (out.triangles > MAX_TRIANGLES) throw Object.assign(new Error(`网格 ${out.triangles} 三角超过切片上限 ${MAX_TRIANGLES}`), { code: 'too-complex' });
    }
    for (const comp of obj.components || []) {
      const childPath = comp.path ? String(comp.path).replace(/^\//, '') : pathKey;
      resolve(childPath, comp.objectid, mulXform(comp.transform, xform), depth + 1, visited);
    }
  };

  try {
    const visited = new Set();
    let m, a; // vRe/tRe 与属性正则的游标（strict mode 必须声明）
    for (const t of tops) resolve(t.path, t.objectid, t.transform, 0, visited);
  } catch (err) {
    const reason = err.code === 'too-complex' ? 'too-complex' : 'empty';
    return { ok: false, reason, error: err.message };
  }

  if (!out.triangles) return { ok: false, reason: 'empty', error: '工程 3mf 内没有可解析网格' };
  return {
    ok: true,
    parts: tops.length,
    mesh: {
      positions: Float64Array.from(out.positions),
      faces: Uint32Array.from(out.faces),
      triangles: out.triangles,
      vertices: out.vertices,
    },
  };
}

module.exports = { parseEngineering3mf, parseXform, mulXform, MAX_TRIANGLES };
