'use strict';

/**
 * geometryDNA · 几何结构实例级解析（v68 · 曼波令「自解析模型每一层策略、每个面、
 * 每个拐角、每个孔等所有几何特征」）——参数由「几何结构 + 物理工况 + 需求」共同
 * 决定，而全局统计量（孔数/悬垂%）丢失了结构：3 个 Ø5 竖直孔与 1 个 Ø15 孔在
 * 旧特征里几乎同貌。本模块把网格编译成**实例级结构描述**（结构化 DNA + 定长向量）：
 *
 *   · 孔实例增强：每个孔的深度/贯通性（ray cast）/边距（旧 circles 只到孔径）
 *   · 悬垂连通域：连续悬垂区域实例（面积/最险角/朝向），分散小悬垂与大板悬垂
 *     在旧特征里同貌，支撑策略实则完全不同
 *   · 凹角/圆角边：二面角扫描（法向对冲 = 凹角，应力集中/圆角缺失信号）
 *   · 薄壁采样：双向 ray 最近壁距分布（min/p10/med——薄壁变形与填充策略依据）
 *
 * 性能防线：ray 用 Möller–Trumbore；三角 >150k 时薄壁采样降频；DNA 全程无依赖。
 * 输出 vector 为定长 20 维（ML 直读），实例列表存档供审计/未来图网络消费。
 */

const { fitCircle2d } = (() => { try { return require('./modelFeatures'); } catch { return {}; } })();

const MAX_TRIANGLES_DNA = 150000;   // 超限降采样（薄壁/ray 频率减半再减半）
const RAY_SAMPLES = 120;            // 薄壁采样数
const OVERHANG_COS = Math.cos((50 * Math.PI) / 180);  // 法向与 +Z 夹角 >50° 记悬垂（zn < -cos50≈-0.64？见下）
// 悬垂判定沿用 modelFeatures 口径：面法线与 -Z 的夹角 ≤50°（即面朝下）为悬垂带。

/** Möller–Trumbore：ray(o,d) 与三角形 (a,b,c) 相交，返回 t>eps 或 null */
function rayTri(o, d, a, b, c, eps = 1e-6) {
  const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-9) return null;
  const inv = 1 / det;
  const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < -eps || u > 1 + eps) return null;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < -eps || u + v > 1 + eps) return null;
  const t = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return t > eps ? t : null;
}

/** 沿 dir 的最近命中距离（遍历全部三角，origin 自体面用 t>eps 跳过） */
function raycastNearest(positions, faces, o, d) {
  let best = null;
  const a = [0, 0, 0], b = [0, 0, 0], c = [0, 0, 0];
  for (let t = 0; t < faces.length; t += 3) {
    for (let k = 0; k < 3; k++) {
      const vi = faces[t + k] * 3;
      (k === 0 ? a : k === 1 ? b : c)[0] = positions[vi];
      (k === 0 ? a : k === 1 ? b : c)[1] = positions[vi + 1];
      (k === 0 ? a : k === 1 ? b : c)[2] = positions[vi + 2];
    }
    const hit = rayTri(o, d, a, b, c);
    if (hit !== null && (best === null || hit < best)) best = hit;
  }
  return best;
}

/**
 * 主入口：parsed 网格 + analyzeMesh 的孔检测输出 → 结构化 DNA。
 * @param {{positions,faces,triangles}} parsed
 * @param {{circles?:Array}} holesFeature analyzeMesh().holes（圆心/法向/半径实例）
 * @returns {Object} dna {holes, overhangs, concave, thinwall, vector}
 */
function computeDNA(parsed, holesFeature) {
  const { positions, faces, triangles } = parsed;
  const triCount = triangles || faces.length / 3;
  const downscale = triCount > MAX_TRIANGLES_DNA;

  // ---------- 预计算：面法线（归一）+ 面积 + 质心 ----------
  const nrm = new Float64Array(triCount * 3);
  const area = new Float64Array(triCount);
  const cent = new Float64Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const i0 = faces[t * 3] * 3, i1 = faces[t * 3 + 1] * 3, i2 = faces[t * 3 + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const ux = positions[i1] - ax, uy = positions[i1 + 1] - ay, uz = positions[i1 + 2] - az;
    const vx = positions[i2] - ax, vy = positions[i2 + 1] - ay, vz = positions[i2 + 2] - az;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-12) {
      nrm[t * 3] = nx / len; nrm[t * 3 + 1] = ny / len; nrm[t * 3 + 2] = nz / len;
      area[t] = len / 2;
    }
    cent[t * 3] = (ax + positions[i1] + positions[i2]) / 3;
    cent[t * 3 + 1] = (ay + positions[i1 + 1] + positions[i2 + 1]) / 3;
    cent[t * 3 + 2] = (az + positions[i1 + 1] + positions[i2 + 2]) / 3;
  }

  // ---------- 边表（悬垂连通域/二面角共用） ----------
  const edgeMap = new Map(); // "min_max" → [faceIdx...]
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const v1 = faces[t * 3 + k], v2 = faces[t * 3 + (k + 1) % 3];
      const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
      let arr = edgeMap.get(key);
      if (!arr) { arr = []; edgeMap.set(key, arr); }
      arr.push(t);
    }
  }

  // ---------- ① 悬垂连通域（朝下面 BFS） ----------
  let zmin = Infinity;
  for (let i = 2; i < positions.length; i += 3) if (positions[i] < zmin) zmin = positions[i];
  const overhangFaces = [];
  for (let t = 0; t < triCount; t++) {
    if (nrm[t * 3 + 2] >= 0) continue;
    // 贴床面（法向朝下且紧贴 zmin）是打印底面不是悬垂
    let zAvg = 0;
    for (let k = 0; k < 3; k++) zAvg += positions[faces[t * 3 + k] * 3 + 2];
    if (zAvg / 3 < zmin + 0.5 && nrm[t * 3 + 2] < -0.98) continue;
    overhangFaces.push(t);
  }
  const regions = [];
  const seen = new Uint8Array(triCount);
  const overhangSet = new Set(overhangFaces);
  const adj = new Map(); // faceIdx → [faceIdx]（仅悬垂面之间）
  for (const [, flist] of edgeMap) {
    if (flist.length < 2) continue;
    for (let i = 0; i < flist.length; i++) {
      for (let j = i + 1; j < flist.length; j++) {
        const A = flist[i], B = flist[j];
        if (overhangSet.has(A) && overhangSet.has(B)) {
          let la = adj.get(A); if (!la) { la = []; adj.set(A, la); }
          let lb = adj.get(B); if (!lb) { lb = []; adj.set(B, lb); }
          la.push(B); lb.push(A);
        }
      }
    }
  }
  for (const start of overhangFaces) {
    if (seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let a2 = 0, wAngle = 0, minZn = 0;
    let mnx = 1e9, mny = 1e9, mnz = 1e9, mxx = -1e9, mxy = -1e9, mxz = -1e9;
    while (stack.length) {
      const t = stack.pop();
      a2 += area[t];
      const zn = nrm[t * 3 + 2];
      wAngle += zn * area[t];
      if (zn < minZn) minZn = zn;
      for (let k = 0; k < 3; k++) {
        const vi = faces[t * 3 + k] * 3;
        const vx = positions[vi], vy = positions[vi + 1], vz = positions[vi + 2];
        if (vx < mnx) mnx = vx; if (vx > mxx) mxx = vx;
        if (vy < mny) mny = vy; if (vy > mxy) mxy = vy;
        if (vz < mnz) mnz = vz; if (vz > mxz) mxz = vz;
      }
      for (const nb of adj.get(t) || []) if (!seen[nb]) { seen[nb] = 1; stack.push(nb); }
    }
    if (a2 >= 20) { // 20mm² 以下的碎域忽略（网格噪声）
      const tiltDeg = Math.round(Math.acos(Math.max(-1, Math.min(1, -minZn))) * 180 / Math.PI); // 最险点倾角（0°=完全朝下）
      regions.push({ area: Math.round(a2), tiltDeg, up: Math.abs(wAngle / Math.max(1e-9, a2)) });
    }
  }
  regions.sort((a, b) => b.area - a.area);

  // ---------- ② 凹角/圆角边（二面角扫描，采样防超限） ----------
  const concave = [];
  const edgeStep = downscale ? 3 : 1;
  let ei = 0;
  for (const [, flist] of edgeMap) {
    ei++;
    if (flist.length !== 2) continue; // 非流形边跳过
    if (ei % edgeStep !== 0) continue;
    const [A, B] = flist;
    const d = nrm[A * 3] * nrm[B * 3] + nrm[A * 3 + 1] * nrm[B * 3 + 1] + nrm[A * 3 + 2] * nrm[B * 3 + 2];
    if (d > 0.999) continue; // 平展（共面同向）跳过——凸凹由下方质心投影区分
    // 凹凸确认：两质心连线中点偏向哪一侧——法向彼此相对为凹
    const cdx = cent[B * 3] - cent[A * 3], cdy = cent[B * 3 + 1] - cent[A * 3 + 1], cdz = cent[B * 3 + 2] - cent[A * 3 + 2];
    const s = nrm[B * 3] * cdx + nrm[B * 3 + 1] * cdy + nrm[B * 3 + 2] * cdz;
    const s2 = nrm[A * 3] * cdx + nrm[A * 3 + 1] * cdy + nrm[A * 3 + 2] * cdz;
    if (!(s < 0 && s2 > 0) && !(s > 0 && s2 < 0)) continue;
    const key = edgeMapKeysGet(faces, A, B);
    if (!key) continue;
    const [pa, pb] = key;
    const len = Math.hypot(positions[pa * 3] - positions[pb * 3], positions[pa * 3 + 1] - positions[pb * 3 + 1], positions[pa * 3 + 2] - positions[pb * 3 + 2]);
    // 二面角内角 θ：凹时 θ = 180° + acos(dot)（法向夹角 φ 的补关系）——L 形 90° 凹角 φ=90° → θ=270°
    concave.push({ angleDeg: Math.round(180 + Math.acos(Math.max(-1, Math.min(1, d))) * 180 / Math.PI), length: Math.round(len * 10) / 10 });
  }
  concave.sort((a, b) => b.length - a.length);

  // ---------- ③ 孔实例增强（深度/贯通/边距——基于 analyzeMesh 的 circles） ----------
  const circles = (holesFeature && Array.isArray(holesFeature.circles)) ? holesFeature.circles : [];
  const holes = circles.slice(0, 8).map((c) => {
    const n = c.n.map(Number);
    const o = [c.c[0] + n[0] * 0.4, c.c[1] + n[1] * 0.4, c.c[2] + n[2] * 0.4]; // 开口外偏 0.4mm
    const dir = [-n[0], -n[1], -n[2]];
    const hit = raycastNearest(positions, faces, o, dir);
    const depth = hit != null ? Math.round(hit * 10) / 10 : null;
    const through = hit == null || depth > 400; // >400mm 视作贯通（大件盲深罕见）
    // c/n 必须随实例带出：⑧ 最小孔周壁段要从孔口圆心+法向起探（v83 审查修复：
    // 此前只回 axis/r/depth/through，带孔件在 ⑧ 处 TypeError 致整个 DNA 降级为无）
    return { axis: Math.abs(n[2]) > 0.7 ? 'z' : 'xy', r: c.r, depth, through, c: [c.c[0], c.c[1], c.c[2]], n };
  });

  // ---------- ④ 薄壁采样（双向 ray 最近壁距） ----------
  const samples = [];
  const step = Math.max(1, Math.floor(triCount / (downscale ? 60 : RAY_SAMPLES)));
  for (let t = 0; t < triCount && samples.length < RAY_SAMPLES; t += step) {
    if (area[t] <= 1e-9) continue;
    const o = [cent[t * 3], cent[t * 3 + 1], cent[t * 3 + 2]];
    const n = [nrm[t * 3], nrm[t * 3 + 1], nrm[t * 3 + 2]];
    const d1 = raycastNearest(positions, faces, [o[0] + n[0] * 0.3, o[1] + n[1] * 0.3, o[2] + n[2] * 0.3], n);
    const d2 = raycastNearest(positions, faces, [o[0] - n[0] * 0.3, o[1] - n[1] * 0.3, o[2] - n[2] * 0.3], [-n[0], -n[1], -n[2]]);
    const dists = [d1, d2].filter((x) => x != null && x > 0.3).map((x) => x + 0.3);
    if (dists.length) samples.push(Math.min(...dists));
  }
  samples.sort((a, b) => a - b);
  const pct = (p) => (samples.length ? Math.round(samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] * 10) / 10 : null);
  const thinwall = { min: samples.length ? samples[0] : null, p10: pct(0.1), med: pct(0.5) };

  // ---------- ⑤+⑥⑦⑧ DNA 向量（v79 扩至 22 维）+ 截面剖面/环岛/孔周壁计算 ----------
  const holesArr = holes.filter((h) => Number.isFinite(h.r));
  // ---------- ⑥ 截面剖面（v79 DNA v2）：沿 Z 采样多层，统计每层截面三角分布——
  // 层间面积/周长变化的「阶梯谱」是切片层策略的核心结构信号（突变=强悬垂边界） ----------
  let zminAll = Infinity, zmaxAll = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    if (positions[i] < zminAll) zminAll = positions[i];
    if (positions[i] > zmaxAll) zmaxAll = positions[i];
  }
  const height = Math.max(1e-6, zmaxAll - zminAll);
  const layersN = downscale ? 8 : 16;
  const profileArea = [];
  for (let li = 0; li < layersN; li++) {
    const zc = zminAll + height * ((li + 0.5) / layersN);
    let a = 0;
    for (let t = 0; t < triCount; t++) {
      const z1 = positions[faces[t * 3] * 3 + 2], z2 = positions[faces[t * 3 + 1] * 3 + 2], z3 = positions[faces[t * 3 + 2] * 3 + 2];
      const zLo = Math.min(z1, z2, z3), zHi = Math.max(z1, z2, z3);
      if (zc >= zLo && zc <= zHi) a += area[t]; // 穿越该层的三角面积和（截面占据度的代理）
    }
    profileArea.push(a);
  }
  // 剖面突变：相邻层面积对数比的最大绝对值（阶梯陡度）
  let maxJump = 0;
  for (let i = 1; i < profileArea.length; i++) {
    const ja = Math.abs(Math.log10(Math.max(1e-3, profileArea[i])) - Math.log10(Math.max(1e-3, profileArea[i - 1])));
    if (ja > maxJump) maxJump = ja;
  }

  // ---------- ⑦ 悬垂环岛（v79 DNA v2）：悬垂域里的「岛」数——朝下面中的封闭内环
  // 区域（孔口法兰/悬空平台的边缘环）数出支撑剥离难度 ----------
  // 实现：悬垂面集合里，与顶点邻居关系形成的连通域中「内部孔洞」计数（Euler 特征：
  // V - E + F 对悬垂子图统计；环岛数 = 1 - χ（单连通域 χ=1 无洞））
  let ringIslands = 0;
  {
    const vSet = new Set();
    for (const t of overhangFaces) for (let k = 0; k < 3; k++) vSet.add(faces[t * 3 + k]);
    const eSet = new Set();
    for (const t of overhangFaces) {
      for (let k = 0; k < 3; k++) {
        const a = faces[t * 3 + k], b = faces[t * 3 + (k + 1) % 3];
        eSet.add(a < b ? a + '_' + b : b + '_' + a);
      }
    }
    // 逐悬垂连通域算 Euler 特征（复用 BFS 的 adj/overhangFaces 已建图）
    const seen2 = new Uint8Array(triCount);
    for (const start of overhangFaces) {
      if (seen2[start]) continue;
      const stack = [start];
      seen2[start] = 1;
      let f = 0, vLoc = new Set(), eLoc = new Set();
      while (stack.length) {
        const t = stack.pop();
        f++;
        for (let k = 0; k < 3; k++) {
          const vi = faces[t * 3 + k];
          vLoc.add(vi);
          const vj = faces[t * 3 + (k + 1) % 3];
          eLoc.add(vi < vj ? vi + '_' + vj : vj + '_' + vi);
        }
        for (const nb of adj.get(t) || []) if (!seen2[nb]) { seen2[nb] = 1; stack.push(nb); }
      }
      const chi = vLoc.size - eLoc.size + f;
      if (1 - chi > 0) ringIslands += 1 - chi; // χ<1 的洞数
    }
  }

  // ---------- ⑧ 最小特征尺寸（v79 DNA v2）：全局薄壁之外，孔口最小壁距——
  // 小孔周围壁太薄时打印会破，钻孔/自攻场景的关键判据 ----------
  let minAroundHole = null;
  {
    for (const h of holesArr) {
      if (!Number.isFinite(h.r) || h.r <= 0) continue;
      const o = [h.c[0] + h.n[0] * (h.r + 0.3), h.c[1] + h.n[1] * (h.r + 0.3), h.c[2] + h.n[2] * (h.r + 0.3)];
      // 从孔口沿孔轴垂直方向探 4 向最近壁
      const dirs = [[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]];
      for (const d of dirs) {
        const hit = raycastNearest(positions, faces, o, d);
        if (hit != null && hit > 0.05) {
          const w = hit;
          if (minAroundHole == null || w < minAroundHole) minAroundHole = Math.round(w * 10) / 10;
        }
      }
    }
  }

  // ---------- ⑤ 定长 DNA 向量（v79 扩至 22 维，ML 直读；缺失维度 NaN → impute 层处理） ----------
  const safe = (v) => (Number.isFinite(v) ? v : NaN);
  const vector = [
    safe(holesArr.length),
    safe(holesArr.length ? Math.max(...holesArr.map((h) => h.r)) : NaN),
    safe(holesArr.length ? Math.min(...holesArr.map((h) => h.r)) : NaN),
    safe(Math.max(...holesArr.map((h) => (h.depth != null ? h.depth : 0)), 0)),
    safe(holesArr.length ? holesArr.filter((h) => h.through).length / holesArr.length : NaN),
    safe(regions.length),
    safe(regions.reduce((s2, r) => s2 + r.area, 0)),
    safe(regions.length ? regions[0].area : NaN),
    safe(regions.length ? Math.min(...regions.map((r) => r.tiltDeg)) : NaN),
    safe(concave.length),
    safe(concave.reduce((s2, c) => s2 + c.length, 0)),
    safe(concave.length ? Math.min(...concave.map((c) => c.angleDeg)) : NaN),
    safe(thinwall.min != null ? thinwall.min : NaN),
    safe(thinwall.p10 != null ? thinwall.p10 : NaN),
    safe(thinwall.med != null ? thinwall.med : NaN),
    safe(maxJump),
    safe(profileArea[0] || NaN),
    safe(profileArea[profileArea.length - 1] || NaN),
    safe(ringIslands),
    safe(minAroundHole != null ? minAroundHole : NaN),
    safe(layersN),
    safe(height),
  ];
  return { holes, overhangs: regions.slice(0, 8), concave: concave.slice(0, 12), thinwall, profileArea, ringIslands, minAroundHole, maxJump, vector: vector.map((v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null)) };
}

function edgeMapKeysGet(faces, A, B) {
  for (let k = 0; k < 3; k++) {
    const v1 = faces[A * 3 + k], v2 = faces[A * 3 + (k + 1) % 3];
    for (let j = 0; j < 3; j++) {
      const w1 = faces[B * 3 + j], w2 = faces[B * 3 + (j + 1) % 3];
      if ((v1 === w1 && v2 === w2) || (v1 === w2 && v2 === w1)) return [v1, v2];
    }
  }
  return null;
}

module.exports = { computeDNA, rayTri, raycastNearest };
