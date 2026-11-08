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
  p2s: 'p2s', // v64：P2S（曼波新切片机——队里没有但件可在拓竹机打，品牌族放行用）
  h2d: 'h2d',
  h2: 'h2',
  a1mini: 'a1mini',
  a1: 'a1',
  ad5mpro: 'ad5mpro',
  ad5m: 'ad5m',
  creator5pro: 'creator5pro',
  creator5: 'creator5',
};

// 机型 → 品牌族（v64 跨机型兼容：precheck「同品牌放行」的权威判定源——登记串
// 「H2D/A1 mini」不带品牌前缀，字符串正则咬不住，必须查表）
const BRAND_OF_KEY = {
  x1c: 'bambu', p1s: 'bambu', p1p: 'bambu', p1: 'bambu', p2s: 'bambu', h2d: 'bambu', h2: 'bambu', a1mini: 'bambu', a1: 'bambu',
  ad5mpro: 'flashforge', ad5m: 'flashforge', creator5pro: 'flashforge', creator5: 'flashforge',
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

/**
 * 切片件机型相容判定（2026-11-06 曼波令「锁死机型选择」唯一口径）：
 * 同型号（modelMatch）或 config.machineCompatGroups 组内互认——组表默认空=严格同型号，
 * 仅真机实证互打兼容后才登记。前后端两份同逻辑（浏览器无 require，挂 window），
 * **改一处必须同步另一处**（本文件头部注释的既有约定）。
 * @param {string} machineModel 切片内嵌机型串
 * @param {string} registeredModel 登记打印机型号串
 * @param {Record<string,string[]>} [compatGroups] 互打白名单（config.machineCompatGroups）
 */
function modelCompatible(machineModel, registeredModel, compatGroups) {
  if (modelMatch(machineModel, registeredModel)) return true;
  const a = modelKey(machineModel);
  const extra = (compatGroups && compatGroups[a]) || [];
  const b = modelKey(registeredModel);
  return extra.includes(b);
}

/** 机型串 → 品牌族（bambu/flashforge/unknown）：查表优先，未知 key 再按原始串前缀猜 */
function modelBrand(model) {
  const key = modelKey(model);
  if (BRAND_OF_KEY[key]) return BRAND_OF_KEY[key];
  const s = String(model || '').toLowerCase();
  if (/bambu/.test(s)) return 'bambu';
  if (/flashforge|adventurer|ad\d|creator/.test(s)) return 'flashforge';
  return 'unknown';
}

module.exports = { modelKey, modelMatch, modelCompatible, CANON, BRAND_OF_KEY, modelBrand };
