// ============================================================
// 切片 gcode → 分层截面（2026-10-18 审批台预览 · P0）
//
// 目的：审批人核对「切片产物真实刀轨」——按 Z 层查看每层挤出路徑（截面视图），
// 而不是只看一张缩略图。解析两种主流风味：
//   · Bambu/Orca BBL 风味：`; CHANGE_LAYER` + `; Z_HEIGHT: 0.2`（本机队实锤）
//   · PrusaSlicer 风味：`;LAYER_CHANGE` + `;Z:0.2`
// 只收挤出段（G1 带正 E 且 XY 有位移）；空驶/回抽/换料忽略。输出紧凑 [x1,y1,x2,y2]。
// 纯函数（单测覆盖），上限保护（层数/每层段数），防病态文件打爆内存。
// ============================================================

const MAX_LAYERS = 600;
const MAX_SEGMENTS_PER_LAYER = 20000;

/**
 * @param {string} gcodeText
 * @returns {Array<{i:number,z:number|null,segs:number[][],bounds:number[]}>}
 *   bounds = [minX,minY,maxX,maxY]（该层）；无挤出段的层被丢弃（i 按保留后的顺序重编）
 */
function parseGcodeLayers(gcodeText) {
  const layers = [];
  let cur = null;
  let x = null;
  let y = null;
  const flush = () => {
    if (cur && cur.segs.length) layers.push(cur);
    cur = null;
  };
  const lines = String(gcodeText || '').split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/^;\s*(CHANGE_LAYER|LAYER_CHANGE)\b/i.test(line)) {
      flush();
      cur = { z: null, segs: [] };
      continue;
    }
    const mz = /^;\s*(Z_HEIGHT|Z):\s*(-?\d+(?:\.\d+)?)/i.exec(line);
    if (mz) {
      if (!cur) cur = { z: null, segs: [] };
      cur.z = Number(mz[2]);
      continue;
    }
    if (line[0] !== 'G' && line[0] !== 'g') continue;
    if (!/^G1\b/i.test(line)) continue;
    // 数值格式：Bambu/Orca 会省略前导零（E.02789、E-.4）——\d*\.?\d+ 兼容三种写法
    const mx = /(?:^|\s)X(-?\d*\.?\d+)/i.exec(line);
    const my = /(?:^|\s)Y(-?\d*\.?\d+)/i.exec(line);
    const me = /(?:^|\s)E(-?\d*\.?\d+)/i.exec(line);
    const nx = mx ? Number(mx[1]) : x;
    const ny = my ? Number(my[1]) : y;
    const extruding = me !== null && Number(me[1]) > 0;
    if (cur && extruding && x != null && y != null && nx != null && ny != null && (nx !== x || ny !== y)) {
      if (cur.segs.length < MAX_SEGMENTS_PER_LAYER) cur.segs.push([x, y, nx, ny]);
    }
    x = nx;
    y = ny;
  }
  flush();
  return layers.slice(0, MAX_LAYERS).map((l, i) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [a, b, c, d] of l.segs) {
      if (a < minX) minX = a;
      if (b < minY) minY = b;
      if (c > maxX) maxX = c;
      if (d > maxY) maxY = d;
    }
    return { i, z: Number.isFinite(l.z) ? l.z : null, segs: l.segs, bounds: [minX, minY, maxX, maxY] };
  });
}

module.exports = { parseGcodeLayers, MAX_LAYERS, MAX_SEGMENTS_PER_LAYER };
