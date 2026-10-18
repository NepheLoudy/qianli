// ============================================================
// 已切片 3mf 的展示要素提取（2026-10-18 曼波反馈：切片产物在 3D 工房报「无对象网格」）
//
// Orca/Studio 的「已切片板 3mf」内部只有 plate_1.gcode + 切片器缩略图 + 空壳 3dmodel——
// 没有可渲染/可标注的模型网格。此时不应当报错，而应给出可用的替代视图：
//   · 切片器自带 plate 缩略图（与审批台预览同源）
//   · gcode 层概览（层数 / z 范围）——从真实刀轨解析
// 前端据此显示「已切片产物，3D 标注不可用」的友好降级，同时样本仍可正常入库。
// ============================================================

const AdmZip = require('adm-zip');
const { parseGcodeLayers } = require('./gcodeLayers');

// 解压炸弹护栏（2026-10-18 审查）：3mf 上传上限 200MB，但 zip 压缩比可做出
// GB 级解压；getData() 整份进内存前先看 header.size（未压缩大小）
const MAX_PNG_BYTES = 8 * 1024 * 1024;
const MAX_GCODE_BYTES = 128 * 1024 * 1024;
const entrySize = (e) => Number((e && e.header && e.header.size) || 0);

/**
 * @param {Buffer} buffer 3mf 文件内容
 * @returns {{sliced:true, message:string, thumbnail?:string, layers?:{count,zMin,zMax}} | null}
 *   无切片要素（缩略图与 gcode 都缺）返回 null，交由调用方保留原错误
 */
function extractSlicedArtifacts(buffer) {
  try {
    const zip = new AdmZip(buffer);
    const png = zip.getEntry('Metadata/plate_1.png') || zip.getEntry('Metadata/plate_1_small.png');
    const gcode = zip.getEntry('Metadata/plate_1.gcode');
    if (!png && !gcode) return null;
    const out = { sliced: true, message: '已切片产物（内嵌 gcode，不含模型网格）——3D 标注不可用' };
    if (png && entrySize(png) <= MAX_PNG_BYTES) out.thumbnail = `data:image/png;base64,${png.getData().toString('base64')}`;
    if (gcode && entrySize(gcode) <= MAX_GCODE_BYTES) {
      const layers = parseGcodeLayers(gcode.getData().toString('utf8'));
      if (layers.length) {
        const zs = layers.map((l) => l.z).filter((z) => Number.isFinite(z));
        out.layers = {
          count: layers.length,
          zMin: zs.length ? Math.min(...zs) : null,
          zMax: zs.length ? Math.max(...zs) : null,
        };
      }
    }
    return out;
  } catch {
    return null;
  }
}

module.exports = { extractSlicedArtifacts };
