// 打印机机型名归一（前端版）——与 src/utils/printerModelKey.js 同逻辑，**改一处必须同步另一处**
// 用途：审批台切片件机型级过滤（内嵌机型串 ↔ 登记机型号同型号判定）
(function () {
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
      .replace(/\d+(\.\d+)?(mm)?(nozzle)?$/, '');
    t = CANON[t] || t;
    return t;
  }
  function modelMatch(machineModel, registeredModel) {
    const a = modelKey(machineModel);
    const b = modelKey(registeredModel);
    if (!a || !b) return false;
    return a === b || a.startsWith(b) || b.startsWith(a);
  }
  window.printerModelKey = { modelKey, modelMatch };
})();
