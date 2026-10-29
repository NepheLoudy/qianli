// 打印机机型名归一（2026-10-29 热修63，X1C「没有该机型」误拦案）：切片文件内嵌机型串
// （Bambu Studio/FlashPrint 各写各的）与登记机型号串的匹配统一口径——
//   ① 小写、去品牌前缀（bambu lab / flashforge）、adventurer→ad 缩写；
//   ② 去空格/连字符/下划线、剥尾部喷嘴直径（"x1 carbon 0.4" → "x1carbon"）；
//   ③ 别名表收敛全称↔缩写（x1carbon→x1c 等）；
//   ④ 匹配=canon 相等，或前缀互吞（兜底 "x1carbon0.4nozzle" 之类带尾缀的长串）。
// 后端 utils 与前端 public 两份同逻辑（浏览器无 require，挂 window），**改一处必须同步另一处**。
// 已知取舍：A1 与 A1 mini 前缀互吞（机队无 A1，实国内嵌串均为完整机型名）；审批台人工把关兜底。

const CANON = {
  x1carbon: 'x1c',
  x1c: 'x1c',
  p1s: 'p1s',
  p1p: 'p1p',
  p1: 'p1',
  h2d: 'h2d',
  h2: 'h2',
  a1mini: 'a1mini',
  a1: 'a1',
  ad5mpro: 'ad5mpro',
  ad5m: 'ad5m',
  creator5pro: 'creator5pro',
  creator5: 'creator5',
};

function modelKey(x) {
  let t = String(x || '').toLowerCase()
    .replace(/^(bambu lab|flashforge|flashforge adventurer)\s+/, '')
    .replace(/^adventurer\s+/, 'ad')
    .replace(/[\s_-]+/g, '')
    .replace(/\d+(\.\d+)?(mm)?(nozzle)?$/, ''); // 剥喷嘴直径尾缀（0.4 / 0.4mm / 0.4nozzle）
  t = CANON[t] || t;
  return t;
}

/** 内嵌机型串与登记机型号是否同型号 */
function modelMatch(machineModel, registeredModel) {
  const a = modelKey(machineModel);
  const b = modelKey(registeredModel);
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

module.exports = { modelKey, modelMatch, CANON };
