// ============================================================
// 自动摆向（2026-10-19 曼波实锤：相机支座 STEP 按 CAD 朝向切片——底面接触
// 仅 600mm²、支撑面 3487mm²；放倒后接触 5290mm²、支撑 1944mm²、高度 44→31.5mm）
//
// 背景：processRules 一直有 directionStrategy（auto/avoid-z-load/keep），但切片桥从未
// 消费——规则说「自动」实际原样切片、只加支撑。本模块在切片前做几何摆向搜索：
//   · 24 种轴向摆向（轴置换 × 符号）逐一评估：底面接触面积、需支撑的悬空面积、高度；
//   · 评分 = 接触 − 0.5×支撑 − 0.002×高度（接触优先，支撑次之，高度微调）；
//   · 只有明显优于当前朝向（接触 +15% 或支撑 −25%）才转向，避免无意义旋转；
//   · directionStrategy=keep → 保持原朝向；用户手动放置（placement 四元数）→ 按用户
//     朝向烘焙，不再自动改向（人的选择优先）。
// 纯几何，无外部依赖；24 朝向的翻转用面顶点交换保持外法线朝向。
// ============================================================

const fs = require('fs');

/** 24 种轴向摆向：new[i] = s[i] * old[p[i]] */
const SIGN_COMBOS = [
  [1, 1, 1], [1, 1, -1], [1, -1, 1], [1, -1, -1],
  [-1, 1, 1], [-1, 1, -1], [-1, -1, 1], [-1, -1, -1],
];
function permSign(p) {
  // 置换符号（逆序数奇偶：偶 +1 / 奇 -1）
  let inv = 0;
  for (let i = 0; i < p.length; i++) for (let j = i + 1; j < p.length; j++) if (p[i] > p[j]) inv++;
  return inv % 2 ? -1 : 1;
}
function determinant(p, s) {
  return permSign(p) * s[0] * s[1] * s[2];
}
function allOrientations() {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const p of perms) {
    for (const s of SIGN_COMBOS) out.push({ p, s, flip: determinant(p, s) < 0 });
  }
  return out;
}
const IDENTITY = { p: [0, 1, 2], s: [1, 1, 1], flip: false };

/** 变换一组顶点（不写回原数组） */
function transformPositions(positions, o) {
  const out = new Float64Array(positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const v = [positions[i], positions[i + 1], positions[i + 2]];
    out[i] = o.s[0] * v[o.p[0]];
    out[i + 1] = o.s[1] * v[o.p[1]];
    out[i + 2] = o.s[2] * v[o.p[2]];
  }
  return out;
}

/** 平面朝下（底面接触/悬空）判定阈值：法线 z 分量 < -0.3（约 17° 以内的朝下面） */
const DOWN_Z = -0.3;

function metricsFor(parsed, o) {
  const { positions, faces, triangles } = parsed;
  const P = transformPositions(positions, o);
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 2; i < P.length; i += 3) { const z = P[i]; if (z < minZ) minZ = z; if (z > maxZ) maxZ = z; }
  let contact = 0;
  let support = 0;
  for (let t = 0; t < triangles; t++) {
    let ia = faces[t * 3];
    let ib = faces[t * 3 + 1];
    let ic = faces[t * 3 + 2];
    if (o.flip) { const tmp = ib; ib = ic; ic = tmp; }
    const ax = P[ia * 3], ay = P[ia * 3 + 1], az = P[ia * 3 + 2];
    const bx = P[ib * 3], by = P[ib * 3 + 1], bz = P[ib * 3 + 2];
    const cx = P[ic * 3], cy = P[ic * 3 + 1], cz = P[ic * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) continue;
    const area = len / 2;
    const zn = nz / len;
    const avgZ = (az + bz + cz) / 3;
    if (zn < DOWN_Z) {
      if (avgZ < minZ + 1.0) contact += area; // 贴床面（1mm 容差，吸收 CAD 公差）
      else support += area;                    // 悬空面 → 需要支撑
    }
  }
  return { contact, support, height: maxZ - minZ, minZ, maxZ };
}
function score(m) {
  return m.contact - 0.5 * m.support - 0.002 * m.height;
}

/**
 * 模型坐标朝上轴 → 「模型→打印」旋转四元数（自举标签用，2026-10-27 特征标签批）。
 * 语义对齐 orientationFitter：标签 q 满足 rotateVec(q⁻¹, [0,0,1]) = up，
 * 即 q 是把 up 转到打印 +Z 的最短弧旋转。up 非零向量（不要求单位）。
 */
function quaternionFromUpAxis(up) {
  const len = Math.hypot(up[0], up[1], up[2]);
  if (len < 1e-9) return [0, 0, 0, 1];
  const a = [up[0] / len, up[1] / len, up[2] / len];
  const b = [0, 0, 1];
  const d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 1 - 1e-9) return [0, 0, 0, 1]; // 已朝上
  if (d < -(1 - 1e-9)) {
    // 180° 翻转：叉积退化，任取与 a 正交的水平轴
    const axis = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return [axis[0], axis[1], axis[2], 0];
  }
  const axis = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  // 最简式：q = normalize([a×b, 1+a·b])——恒等展开即 [axis_hat·sin(θ/2), cos(θ/2)]
  const w = 1 + d;
  const norm = Math.hypot(axis[0], axis[1], axis[2], w);
  return [axis[0] / norm, axis[1] / norm, axis[2] / norm, w / norm];
}

/** 候选朝上轴（模型坐标的 +Z 对应轴）：new[i]=s[i]*old[p[i]] → old[p[2]]=s[2] */
function candidateUpAxis(o) {
  const v = [0, 0, 0];
  v[o.p[2]] = o.s[2];
  return v;
}

/**
 * 选择摆向。
 * @param {{positions, faces, triangles}} parsed
 * @param {{strategy?: string, placement?: number[]|null}} opts
 *   strategy: auto/avoid-z-load（同自动）| keep（保持原朝向）
 *   placement: [x,y,z,w] 用户放置四元数；非空 = 尊重用户朝向（返回 placement 标记，由调用方烘焙）
 */
function chooseOrientation(parsed, opts = {}) {
  const current = metricsFor(parsed, IDENTITY);
  if (opts.placement) {
    return { ...IDENTITY, ...current, changed: false, placement: true, note: '按用户放置朝向切片（尊重手动摆向）' };
  }
  if (String(opts.strategy || 'auto').toLowerCase() === 'keep') {
    return { ...IDENTITY, ...current, changed: false, note: '保持原始朝向（directionStrategy=keep）' };
  }
  const candidates = allOrientations().map((o) => ({ ...o, ...metricsFor(parsed, o) }));
  let best;
  if (opts.policy && opts.policy.weights) {
    // 学习策略（orientationFitter 产出）：候选度量归一化后按学到的权重打分；
    // 接触不足下限由 policy.minContactRatio 控制。这是「几何特征→取舍」的认知层。
    const maxContact = Math.max(1e-6, ...candidates.map((c) => c.contact));
    const maxSupport = Math.max(1, ...candidates.map((c) => c.support));
    const maxHeight = Math.max(1e-6, ...candidates.map((c) => c.height));
    const minContact = Number(opts.policy.minContactRatio) || 0;
    const scoreOf = (c) => (opts.policy.weights.contact || 0) * (c.contact / maxContact)
      - (opts.policy.weights.support || 0) * (c.support / maxSupport)
      - (opts.policy.weights.height || 0) * (c.height / maxHeight);
    const eligible = candidates.filter((c) => c.contact / maxContact >= minContact);
    best = (eligible.length ? eligible : candidates).reduce((a, b) => (scoreOf(b) > scoreOf(a) ? b : a));
  } else {
    // 冷启动启发式（无学习策略时兜底）：接触≥最大接触 35% 后优先支撑最少
    const maxContact = Math.max(...candidates.map((c) => c.contact));
    const minContact = Math.max(50, maxContact * 0.35);
    const eligible = candidates.filter((c) => c.contact >= minContact);
    eligible.sort((a, b) => a.support - b.support || b.contact - a.contact || a.height - b.height);
    best = eligible[0] || candidates[0];
  }
  const policyTag = opts.policy && opts.policy.version ? `学习策略 ${opts.policy.version} · ` : '';
  // 冷启动专用的「零支撑且接触够用就不折腾」；有学习策略时交给策略判断
  if (!opts.policy && current.support === 0 && current.contact >= 200) {
    return { ...IDENTITY, ...current, changed: false, note: '原始朝向已零支撑且接触充足（未改向）' };
  }
  const improved = opts.policy ? true : (best.support < current.support * 0.8 || best.contact > current.contact * 1.5);
  if (!improved) {
    return { ...IDENTITY, ...current, changed: false, note: '原始朝向已较优（未改向）' };
  }
  return {
    ...best,
    changed: true,
    note: `${policyTag}自动摆向：底面 ${Math.round(best.contact)}mm²（原 ${Math.round(current.contact)}mm²），支撑面 ${Math.round(best.support)}mm²（原 ${Math.round(current.support)}mm²），高 ${best.height.toFixed(1)}mm（原 ${current.height.toFixed(1)}mm）`,
  };
}

/** 套用轴向摆向：保持外法线（负行列式时交换 b/c 顶点） */
function applyOrientation(parsed, o) {
  const positions = transformPositions(parsed.positions, o);
  let faces;
  if (o.flip) {
    faces = new Uint32Array(parsed.faces.length);
    for (let t = 0; t < parsed.triangles; t++) {
      faces[t * 3] = parsed.faces[t * 3];
      faces[t * 3 + 1] = parsed.faces[t * 3 + 2];
      faces[t * 3 + 2] = parsed.faces[t * 3 + 1];
    }
  } else {
    faces = Uint32Array.from(parsed.faces);
  }
  return { positions, faces, triangles: parsed.triangles, vertices: positions.length / 3 };
}

/** 按四元数 [x,y,z,w] 旋转（与前端 annotator 的 rotVec 同口径） */
function applyQuaternion(parsed, q) {
  const [x, y, z, w] = q.map(Number);
  const n = Math.hypot(x, y, z, w) || 1;
  const ux = x / n, uy = y / n, uz = z / n, uw = w / n;
  const positions = new Float64Array(parsed.positions.length);
  for (let i = 0; i < positions.length; i += 3) {
    const vx = parsed.positions[i], vy = parsed.positions[i + 1], vz = parsed.positions[i + 2];
    const tx = 2 * (uy * vz - uz * vy);
    const ty = 2 * (uz * vx - ux * vz);
    const tz = 2 * (ux * vy - uy * vx);
    positions[i] = vx + uw * tx + (uy * tz - uz * ty);
    positions[i + 1] = vy + uw * ty + (uz * tx - ux * tz);
    positions[i + 2] = vz + uw * tz + (ux * ty - uy * tx);
  }
  return { positions, faces: Uint32Array.from(parsed.faces), triangles: parsed.triangles, vertices: positions.length / 3 };
}

/** 归一化：XY 居中、Z 最低点=0（摆向搜索后模型可能偏离原点） */
function normalize(parsed) {
  const P = parsed.positions;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) minX = P[i];
    if (P[i] > maxX) maxX = P[i];
    if (P[i + 1] < minY) minY = P[i + 1];
    if (P[i + 1] > maxY) maxY = P[i + 1];
    if (P[i + 2] < minZ) minZ = P[i + 2];
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  for (let i = 0; i < P.length; i += 3) {
    P[i] -= cx;
    P[i + 1] -= cy;
    P[i + 2] -= minZ;
  }
  return parsed;
}

/** 二进制 STL 写出（法线由顶点重算；与 slice 桥输入同格式） */
function writeBinaryStl(parsed, outPath) {
  const { positions, faces, triangles } = parsed;
  const buf = Buffer.alloc(84 + 50 * triangles);
  buf.writeUInt32LE(triangles, 80);
  for (let t = 0; t < triangles; t++) {
    const off = 84 + t * 50;
    const pts = [faces[t * 3], faces[t * 3 + 1], faces[t * 3 + 2]].map((i) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
    const u = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]];
    const w = [pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    n.forEach((v, j) => buf.writeFloatLE(v / l, off + j * 4));
    pts.forEach((p, j) => p.forEach((v, k) => buf.writeFloatLE(v, off + 12 + j * 12 + k * 4)));
  }
  fs.writeFileSync(outPath, buf);
  return { outPath, size: buf.length };
}

module.exports = {
  chooseOrientation, applyOrientation, applyQuaternion, normalize, writeBinaryStl,
  metricsFor, allOrientations, IDENTITY, quaternionFromUpAxis, candidateUpAxis,
};
