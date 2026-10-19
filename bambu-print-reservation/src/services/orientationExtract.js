// ============================================================
// 专家摆向标签提取（2026-10-19 学习回路补链）
//
// 训练样本里的「专家怎么摆」有两个来源：
//   ① 预约单的 Place on Face 四元数（人工强标签，reservation.placement）；
//   ② 专家切片 3mf 的对象变换（Bambu/Orca 的 model_settings.config matrix 或
//      3D/3dmodel.model 的 build/item transform）。
// 旧样本是纯切片产物（几何已烘焙、无变换矩阵）→ 无法反推，返回 null；
// 新样本（STEP/STL + 人工放置）会带上 ①。
// 矩阵口径：16 值 4x4 行主序（实测 Bambu `1 0 0 0 0 1 0 0 0 0 1 15.75 0 0 0 1`）
// 或 12 值 3x4 行主序；只取旋转部分转四元数。
// ============================================================

const AdmZip = require('adm-zip');

const IDENTITY_EPS_DEG = 0.5;

/** 3x3 旋转矩阵（行主序 m00,m01,m02,m10,...）→ 单位四元数 [x,y,z,w] */
function quatFromMatrix(m) {
  const m00 = m[0], m01 = m[1], m02 = m[2];
  const m10 = m[4], m11 = m[5], m12 = m[6];
  const m20 = m[8], m21 = m[9], m22 = m[10];
  const tr = m00 + m11 + m22;
  let x, y, z, w;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  const n = Math.hypot(x, y, z, w) || 1;
  return [x / n, y / n, z / n, w / n];
}

/** 矩阵字符串 → {quaternion, identity} */
function parseMatrixTransform(text) {
  const nums = String(text || '').trim().split(/\s+/).map(Number);
  if (![9, 12, 16].includes(nums.length) || nums.some((n) => !Number.isFinite(n))) return null;
  // 12/16 是 3x4/4x4 行主序，取前 12 个（3 行 × 4 列）的旋转 3x3
  const m = nums.slice(0, 12);
  const q = quatFromMatrix(m);
  const angleDeg = 2 * Math.acos(Math.min(1, Math.abs(q[3]))) * 180 / Math.PI;
  return { quaternion: q, identity: angleDeg < IDENTITY_EPS_DEG, angleDeg };
}

/**
 * 从 3mf 提取专家摆向。
 * @param {Buffer} buffer
 * @returns {{quaternion:number[], source:string, identity:boolean, angleDeg:number}|null}
 *   null = 没有任何可提取的变换（烘焙型切片/无 matrix）
 */
function extractOrientationFrom3mf(buffer) {
  let zip;
  try { zip = new AdmZip(buffer); } catch { return null; }
  const candidates = [];
  try {
    const ms = zip.getEntry('Metadata/model_settings.config');
    if (ms) {
      const text = ms.getData().toString('utf8');
      for (const m of text.matchAll(/key="matrix"\s+value="([^"]+)"/g)) {
        const t = parseMatrixTransform(m[1]);
        if (t) candidates.push({ ...t, source: '3mf-model-settings' });
      }
    }
  } catch { /* 损坏则继续找 build transform */ }
  try {
    const dm = zip.getEntry('3D/3dmodel.model');
    if (dm) {
      const text = dm.getData().toString('utf8');
      for (const m of text.matchAll(/<item\b[^>]*\btransform="([^"]+)"/g)) {
        const t = parseMatrixTransform(m[1]);
        if (t) candidates.push({ ...t, source: '3mf-build-item' });
      }
    }
  } catch { /* 忽略 */ }
  if (!candidates.length) return null;
  // 优先非单位旋转（真正记录了专家摆向）；全是单位矩阵则如实返回 identity
  const hit = candidates.find((c) => !c.identity) || candidates[0];
  return {
    quaternion: hit.quaternion,
    source: hit.source,
    identity: hit.identity,
    angleDeg: Math.round(hit.angleDeg * 10) / 10,
  };
}

module.exports = { extractOrientationFrom3mf, parseMatrixTransform, quatFromMatrix };
