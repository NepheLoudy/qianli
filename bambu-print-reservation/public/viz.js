'use strict';
/**
 * viz.js · 工程图纸风可视化组件库（v64 · 曼波令「细化并优化交互和艺术设计」）
 *
 * 设计语言（对齐 v58 印刷品/工程制图美学，不是俗气 dashboard）：
 *   · 墨线制图——1px 细实线、衬线数字、小字距大写眉题，图表长在「纸面」上；
 *   · 容器套 .viz-grid（styles.css 的蓝图纸网格底纹），数据色只用主题令牌
 *     （--accent/--ok/--warn/--bad），双主题自动适配；
 *   · 纯 SVG/CSS 零依赖，全部返回字符串（页面 esc 纪律自守：数据槽一律 Viz.esc）。
 *
 * 组件：sparkline（温度墨线）/ gauge（弧形仪表）/ donut（余量环）/ barDiff（参数指纹
 * 对称条）/ scatter（特征星图）/ heatmap（热力日历）/ timeline（队列 ETA 时间带）/
 * printerBay（线框模拟舱）/ maeBars（竞技场条形）/ countUp（数字滚动）/ confetti（克制纸屑）。
 */
(function () {
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 公共小件 ----------
  /** SVG 头（viewBox 自适应 + class） */
  function svgWrap(w, h, inner, cls = '') {
    return `<svg class="viz-svg ${cls}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">${inner}</svg>`;
  }
  /** 工程图网格底（画在 SVG 内的细线网，无 CSS 依赖） */
  function gridLines(w, h, step = 16) {
    let s = '';
    for (let x = step; x < w; x += step) s += `<line x1="${x}" y1="0" x2="${x}" y2="${h}" class="viz-gridline"/>`;
    for (let y = step; y < h; y += step) s += `<line x1="0" y1="${y}" x2="${w}" y2="${y}" class="viz-gridline"/>`;
    return s;
  }
  const fmtTemp = (v) => (Number.isFinite(v) ? `${Math.round(v)}°` : '—');
  const fmtMins = (m) => {
    m = Math.round(m);
    if (!Number.isFinite(m) || m <= 0) return '—';
    return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? (m % 60) + 'm' : ''}` : `${m}m`;
  };

  // ---------- 1. 温度墨线图 ----------
  /**
   * @param {Array<{ts,nozzle,bed,nozzleTarget,bedTarget}>} points
   * @param {Object} opts {width,height,showTarget}
   * @returns {string} svg
   */
  function sparkline(points, opts = {}) {
    const W = opts.width || 260;
    const H = opts.height || 84;
    const pts = (points || []).filter((p) => p && (Number.isFinite(p.nozzle) || Number.isFinite(p.bed)));
    if (pts.length < 2) {
      return svgWrap(W, H, gridLines(W, H) + `<text x="${W / 2}" y="${H / 2}" text-anchor="middle" class="viz-empty">采样中——数据积累约 1 分钟后成线</text>`, 'viz-sparkline');
    }
    const t0 = pts[0].ts;
    const t1 = pts[pts.length - 1].ts;
    const span = Math.max(1, t1 - t0);
    let maxV = 60;
    for (const p of pts) {
      for (const v of [p.nozzle, p.bed, opts.showTarget ? p.nozzleTarget : null, opts.showTarget ? p.bedTarget : null]) {
        if (Number.isFinite(v)) maxV = Math.max(maxV, v);
      }
    }
    maxV = Math.ceil((maxV + 10) / 50) * 50; // 取整到 50——工程图纸的整数标尺
    const X = (ts) => 4 + ((ts - t0) / span) * (W - 8);
    const Y = (v) => H - 6 - (v / maxV) * (H - 16);
    const path = (key) => {
      let d = '';
      let pen = false;
      for (const p of pts) {
        const v = p[key];
        if (!Number.isFinite(v)) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${X(p.ts).toFixed(1)},${Y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    };
    let g = gridLines(W, H);
    // y 轴刻度（三道：0 / 半 / 顶）
    for (const v of [0, maxV / 2, maxV]) {
      g += `<line x1="4" y1="${Y(v)}" x2="${W - 4}" y2="${Y(v)}" class="viz-axisline"/><text x="6" y="${Y(v) - 2}" class="viz-tick">${v}°</text>`;
    }
    if (opts.showTarget) {
      g += `<path d="${path('nozzleTarget')}" class="viz-line viz-line-target"/><path d="${path('bedTarget')}" class="viz-line viz-line-target viz-line-bed"/>`;
    }
    g += `<path d="${path('bed')}" class="viz-line viz-line-bed"/>`;
    g += `<path d="${path('nozzle')}" class="viz-line viz-line-nozzle"/>`;
    const last = pts[pts.length - 1];
    if (Number.isFinite(last.nozzle)) g += `<circle cx="${X(last.ts)}" cy="${Y(last.nozzle)}" r="2.4" class="viz-dot viz-dot-nozzle"/>`;
    return svgWrap(W, H, g, 'viz-sparkline');
  }

  /** 图例 */
  sparkline.legend = () =>
    `<span class="viz-legend"><i class="viz-swatch viz-swatch-nozzle"></i>喷嘴</span>` +
    `<span class="viz-legend"><i class="viz-swatch viz-swatch-bed"></i>热床</span>` +
    `<span class="viz-legend"><i class="viz-swatch viz-swatch-target"></i>目标（虚线）</span>`;

  // ---------- 2. 弧形仪表（层高/进度） ----------
  function gauge(pct, opts = {}) {
    const size = opts.size || 92;
    const label = opts.label != null ? esc(opts.label) : `${Math.round(pct)}%`;
    const sub = opts.sub != null ? esc(opts.sub) : '';
    const r = size / 2 - 8;
    const cx = size / 2;
    const cy = size / 2;
    const a = Math.PI * (1 - Math.max(0, Math.min(1, pct / 100))); // 上半弧，左起
    const x2 = cx + r * Math.cos(a);
    const y2 = cy - r * Math.sin(a);
    const large = pct > 50 ? 1 : 0;
    const arcPath = `M ${cx - r} ${cy} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
    return svgWrap(size, size * 0.68, [
      `<path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" class="viz-gauge-track"/>`,
      pct > 0.5 ? `<path d="${arcPath}" class="viz-gauge-arc"/>` : (pct > 0 ? `<line x1="${cx - r}" y1="${cy}" x2="${x2}" y2="${y2}" class="viz-gauge-arc viz-gauge-arc-line"/>` : ''),
      `<text x="${cx}" y="${cy - 4}" text-anchor="middle" class="viz-gauge-num">${label}</text>`,
      sub ? `<text x="${cx}" y="${cy + 12}" text-anchor="middle" class="viz-tick">${sub}</text>` : '',
    ].join(''), 'viz-gauge');
  }

  // ---------- 3. 余量环（料盘） ----------
  function donut(pct, opts = {}) {
    const p = Math.max(0, Math.min(100, Number(pct) || 0));
    const color = opts.color || (p <= 15 ? 'var(--bad)' : p <= 35 ? 'var(--warn)' : 'var(--ok)');
    return `<div class="viz-donut" style="--p:${p};--dc:${color}" title="${esc(opts.title || '')}剩余 ${p}%"><span class="viz-donut-num">${p}<i>%</i></span></div>`;
  }

  // ---------- 4. 参数指纹（对称差异条） ----------
  /**
   * items: [{label, value, base, min, max}]——value≠base 的参数画中轴对称条。
   * 偏离量按 (value-base)/(max-min) 归一，右=高于基线、左=低于。
   */
  function barDiff(items, opts = {}) {
    const rows = (items || []).filter((it) => Number.isFinite(it.value) && Number.isFinite(it.base) && it.value !== it.base && Number.isFinite(it.min) && it.max > it.min);
    if (!rows.length) return '<div class="viz-empty viz-empty-box">本单参数与全局基线一致——标准件，无指纹。</div>';
    const W = opts.width || 420;
    const half = (W - 150) / 2 - 8;
    const body = rows.map((it) => {
      const span = it.max - it.min;
      const dev = (it.value - it.base) / span; // -1..1（通常远小于 1）
      const w = Math.min(1, Math.abs(dev) / 0.5) * half; // 50% 满幅
      const dir = dev > 0 ? 1 : -1;
      const valTxt = it.fmt ? it.fmt(it.value) : it.value;
      const baseTxt = it.fmt ? it.fmt(it.base) : it.base;
      const bar = dir > 0
        ? `<rect x="0" y="3" width="${w.toFixed(1)}" height="10" class="viz-fp-bar viz-fp-up"/>`
        : `<rect x="${(-w).toFixed(1)}" y="3" width="${w.toFixed(1)}" height="10" class="viz-fp-bar viz-fp-down"/>`;
      return `<div class="viz-fp-row">` +
        `<span class="viz-fp-label">${esc(it.label)}</span>` +
        `<svg class="viz-fp-svg" viewBox="-${half} 0 ${half * 2} 16" preserveAspectRatio="none">` +
        `<line x1="0" y1="0" x2="0" y2="16" class="viz-fp-axis"/>${bar}</svg>` +
        `<span class="viz-fp-val"><b>${esc(valTxt)}</b> <i>(基线 ${esc(baseTxt)})</i></span></div>`;
    }).join('');
    return `<div class="viz-fp">${body}<div class="viz-fp-note">◀ 低于基线 ｜ 高于基线 ▶ —— 相对出厂默认档的归一化偏离（审查弹层快照口径）</div></div>`;
  }

  // ---------- 5. 特征星图 ----------
  /**
   * points: [{x, y, color('ok'|'bad'|'muted'), r, name, tip}]
   * 对数 x 域（体积跨三个量级是常态）。
   */
  function scatter(points, opts = {}) {
    const W = opts.width || 460;
    const H = opts.height || 220;
    const P = (points || []).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (!P.length) return '<div class="viz-empty viz-empty-box">暂无可绘样本（需样本带几何特征）。</div>';
    const PAD = { l: 44, r: 12, t: 10, b: 26 };
    const xs = P.map((p) => Math.log10(Math.max(0.01, p.x)));
    const ys = P.map((p) => p.y);
    let x0 = Math.floor(Math.min(...xs)) - 0.2;
    let x1 = Math.ceil(Math.max(...xs)) + 0.2;
    let y0 = 0;
    let y1 = Math.max(10, Math.ceil(Math.max(...ys) / 10) * 10);
    const X = (v) => PAD.l + ((Math.log10(Math.max(0.01, v)) - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
    const Y = (v) => H - PAD.b - ((v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
    let g = gridLines(W, H, 20);
    // 轴与刻度
    for (let e = Math.ceil(x0); e <= Math.floor(x1); e++) {
      const v = Math.pow(10, e);
      g += `<line x1="${X(v)}" y1="${H - PAD.b}" x2="${X(v)}" y2="${PAD.t}" class="viz-axisline"/>` +
        `<text x="${X(v)}" y="${H - PAD.b + 12}" text-anchor="middle" class="viz-tick">${v < 1 ? v.toFixed(1) : v}cm³</text>`;
    }
    for (let v = 0; v <= y1; v += y1 / 2) {
      g += `<text x="${PAD.l - 6}" y="${Y(v) + 3}" text-anchor="end" class="viz-tick">${Math.round(v)}%</text>`;
    }
    g += `<text x="${(W + PAD.l) / 2}" y="${H - 4}" text-anchor="middle" class="viz-axislabel">模型体积（对数轴）</text>` +
      `<text x="12" y="${PAD.t + 8}" class="viz-axislabel">悬垂%</text>`;
    g += P.map((p) => {
      const c = p.color === 'bad' ? 'viz-pt-bad' : p.color === 'ok' ? 'viz-pt-ok' : 'viz-pt-muted';
      const r = Number.isFinite(p.r) ? Math.max(2.5, Math.min(7, p.r)) : 4;
      return `<circle cx="${X(p.x).toFixed(1)}" cy="${Y(p.y).toFixed(1)}" r="${r}" class="viz-pt ${c}"><title>${esc(p.tip || p.name || '')}</title></circle>`;
    }).join('');
    return svgWrap(W, H, g, 'viz-scatter');
  }

  // ---------- 6. 热力日历（近 N 周按天） ----------
  /** days: Map/对象 'YYYY-MM-DD' → count；weeks=12 */
  function heatmap(countByDay, opts = {}) {
    const weeks = opts.weeks || 12;
    const cell = opts.cell || 9;
    const gap = 3;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    // 对齐到本周周一，从 12 周前的周一开始
    const dow = (today.getDay() + 6) % 7; // 周一=0
    const end = new Date(today.getTime() + (6 - dow) * 86400000);
    const start = new Date(end.getTime() - (weeks * 7 - 1) * 86400000);
    const maxC = Math.max(1, ...Object.values(countByDay || {}).map(Number));
    const level = (c) => (c <= 0 ? 0 : Math.ceil((c / maxC) * 4));
    let cells = '';
    for (let w = 0; w < weeks; w++) {
      for (let d = 0; d < 7; d++) {
        const day = new Date(start.getTime() + (w * 7 + d) * 86400000);
        // v83：本地日期键——此前 toISOString 把本地零点折成 UTC（=本地日期-1），
        // UTC+8 下热力图整体错位一天、当天数据落进「future」透明格
        const key = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0');
        const c = Number((countByDay || {})[key]) || 0;
        const future = day > today;
        cells += `<rect x="${w * (cell + gap)}" y="${d * (cell + gap)}" width="${cell}" height="${cell}" rx="2" class="viz-hm viz-hm-l${future ? 'x' : level(c)}"><title>${key} · ${c} 单</title></rect>`;
      }
    }
    const W = weeks * (cell + gap) - gap;
    const H = 7 * (cell + gap) - gap;
    return svgWrap(W, H, cells, 'viz-heatmap');
  }

  // ---------- 7. 队列 ETA 时间带 ----------
  /**
   * segments: [{name, minutes, estimate(bool), urgent}]——顺序队列；
   * 渲染成横向带，段宽∝分钟；estimate 段画斜纹（估算语义）。
   */
  function timeline(segments, opts = {}) {
    const S = (segments || []).filter((s) => s && s.minutes > 0);
    const box = opts.container;
    if (!S.length) return '<div class="viz-empty viz-empty-box">队列空——打印机闲着，来一单？</div>';
    const total = S.reduce((s, x) => s + x.minutes, 0);
    const rows = S.map((s, i) => {
      const pct = (s.minutes / total) * 100;
      const cls = `viz-tl-seg ${s.urgent ? 'viz-tl-urgent' : ''} ${i === 0 ? 'viz-tl-now' : ''} ${s.estimate ? 'viz-tl-est' : ''}`;
      const title = `${esc(s.name)}｜≈${fmtMins(s.minutes)}${s.estimate ? '（粗估）' : ''}`;
      // 窄段（占比 <9%）只显示分钟——长名塞进去会把布局挤爆（v81 实测修复）
      const narrow = pct < 9;
      return `<div class="${cls}" style="flex:${Math.max(0.5, s.minutes).toFixed(1)}" title="${title}">` +
        `<span class="viz-tl-name">${narrow ? '' : esc((i === 0 ? '▶ ' : '') + s.name).slice(0, 15)}</span>` +
        `<span class="viz-tl-min">${fmtMins(s.minutes)}</span></div>`;
    }).join('');
    const eta = new Date(Date.now() + total * 60000);
    const hh = `${String(eta.getHours()).padStart(2, '0')}:${String(eta.getMinutes()).padStart(2, '0')}`;
    return `<div class="viz-tl">${rows}</div><div class="viz-tl-foot">总排空 ≈ <b>${fmtMins(total)}</b>｜预计 <b>${hh}</b> 清空（斜纹 = 无预估时长的粗估段）</div>`;
  }

  // ---------- 8. 线框模拟舱 ----------
  /**
   * state: {progress(0-100), layerNum, totalLayers, nozzleTemp, bedTemp, status, printing}
   * SVG 线框打印机：龙门 + 喷头随 Z（层进度）下移 + 热床温度染色 + 已打印部分填充。
   */
  function printerBay(state, opts = {}) {
    const W = opts.width || 150;
    const H = opts.height || 130;
    const s = state || {};
    const printing = s.printing && Number.isFinite(s.progress);
    const prog = Math.max(0, Math.min(100, Number(s.progress) || 0));
    // 舱体几何
    const frameL = 18;
    const frameR = W - 18;
    const topY = 22;
    const bedY = H - 22;
    const gantryY = topY + 6;
    const hotY = printing ? gantryY + (bedY - gantryY - 6) * (prog / 100) : gantryY;
    // 已成型件（从热床长起的方块）
    const partH = printing ? (bedY - 4 - hotY) * 0.8 : 0;
    const bedHeat = Math.max(0, Math.min(1, (Number(s.bedTemp) || 0) / 110));
    const nozzleHot = Math.max(0, Math.min(1, ((Number(s.nozzleTemp) || 0) - 25) / 280));
    let g = gridLines(W, H, 14);
    // 外框（龙门立柱 + 顶梁）
    g += `<rect x="${frameL - 6}" y="${topY}" width="${frameR - frameL + 12}" height="${bedY - topY + 8}" class="viz-bay-frame"/>`;
    g += `<line x1="${frameL}" y1="${gantryY}" x2="${frameR}" y2="${gantryY}" class="viz-bay-gantry"/>`;
    // 热床（温度染色）
    g += `<rect x="${frameL + 6}" y="${bedY}" width="${frameR - frameL - 12}" height="7" class="viz-bay-bed" style="fill-opacity:${(0.15 + bedHeat * 0.55).toFixed(2)}"/>`;
    // 已打印件（斜纹填充——工程剖面线）
    if (partH > 2) {
      g += `<rect x="${(frameL + frameR) / 2 - 26}" y="${hotY + 4}" width="52" height="${partH.toFixed(1)}" class="viz-bay-part"/>`;
    }
    // 喷头（沿 Z 移动的滑块 + 喷嘴尖）
    g += `<rect x="${(frameL + frameR) / 2 - 9}" y="${hotY - 8}" width="18" height="8" class="viz-bay-head"/>` +
      `<path d="M ${(frameL + frameR) / 2 - 3} ${hotY} L ${(frameL + frameR) / 2 + 3} ${hotY} L ${(frameL + frameR) / 2} ${hotY + 5} Z" class="viz-bay-nozzle" style="fill-opacity:${(0.3 + nozzleHot * 0.7).toFixed(2)}"/>`;
    // 标注（层号/进度）
    const layerTxt = printing && s.totalLayers > 0 ? `L${s.layerNum || '?'}/${s.totalLayers}` : (s.status || '');
    g += `<text x="${W / 2}" y="${bedY + 20}" text-anchor="middle" class="viz-tick">${esc(layerTxt)}</text>`;
    return svgWrap(W, H, g, 'viz-bay' + (printing ? ' viz-bay-live' : ''));
  }

  // ---------- 9. 竞技场条形（模型 MAE 对比） ----------
  /** rows: [{label, mine, base, unit}]——mine/base 已是数字，横条+基线刻度 */
  function maeBars(rows, opts = {}) {
    const list = (rows || []).filter((r) => Number.isFinite(r.mine));
    if (!list.length) return '<div class="viz-empty viz-empty-box">暂无择优参数。</div>';
    const maxV = Math.max(...list.map((r) => Math.max(r.mine, r.base || 0))) || 1;
    const body = list.map((r) => {
      const w = (r.mine / maxV) * 100;
      const bw = Number.isFinite(r.base) ? (r.base / maxV) * 100 : null;
      return `<div class="viz-mae-row">` +
        `<span class="viz-mae-label">${esc(r.label)}</span>` +
        `<div class="viz-mae-track"><div class="viz-mae-base" style="width:${bw != null ? bw.toFixed(1) : 0}%"></div>` +
        `<div class="viz-mae-bar" style="width:${w.toFixed(1)}%"></div>` +
        `<span class="viz-mae-num">${r.mine}${r.unit || ''}<i>vs ${r.base}${r.unit || ''}</i></span></div></div>`;
    }).join('');
    return `<div class="viz-mae">${body}<div class="viz-fp-note">墨条 = 模型 LOFO MAE ｜ 灰条 = 中位数基线（短于灰条 = 学得比瞎猜准）</div></div>`;
  }

  // ---------- 10. 数字滚动 ----------
  function countUp(el, to, opts = {}) {
    const from = Number(el && el.dataset.vizNum) || 0;
    const dur = opts.duration || 600;
    const t0 = performance.now();
    const dec = opts.decimals || 0;
    const suffix = opts.suffix || '';
    function frame(t) {
      const k = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      const v = from + (to - from) * eased;
      if (el) {
        el.textContent = v.toFixed(dec) + suffix;
        el.dataset.vizNum = String(v);
      }
      if (k < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  // ---------- 11. 克制版纸屑 ----------
  function confetti(container) {
    const host = typeof container === 'string' ? document.querySelector(container) : container;
    if (!host) return;
    const colors = ['var(--accent)', 'var(--ok)', 'var(--warn)', 'var(--ink)'];
    for (let i = 0; i < 24; i++) {
      const p = document.createElement('i');
      p.className = 'viz-confetti';
      p.style.left = 20 + Math.random() * 60 + '%';
      p.style.background = colors[i % colors.length];
      p.style.animationDelay = (Math.random() * 0.3) + 's';
      p.style.animationDuration = (1.1 + Math.random() * 0.7) + 's';
      p.style.setProperty('--dx', (Math.random() * 120 - 60) + 'px');
      p.style.setProperty('--rot', (Math.random() * 360) + 'deg');
      host.appendChild(p);
      setTimeout(() => p.remove(), 2200);
    }
  }

  // ---------- 异步按钮自动 loading（交互底层）：任何 button 点击即转圈锁定 2.5s——
// 双击防重 + 状态反馈二合一；页面重渲染时按钮 DOM 被替换，无残留
if (typeof document !== 'undefined' && !window.__vizBtnWired) {
  window.__vizBtnWired = true;
  document.addEventListener('click', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('button') : null;
    if (!b || b.disabled || b.classList.contains('btn-loading') || b.hasAttribute('data-no-loading')) return;
    if (b.form && b.type === 'submit') return; // 表单提交按钮由浏览器原生流程管
    b.classList.add('btn-loading');
    setTimeout(() => b.classList.remove('btn-loading'), 2500);
  }, true);
}
  // ---------- 12. PCA 主成分投影（多元特征的诚实降维——数据自己选轴） ----------
  /**
   * rows: [{name, color, r, tip, dims:[number,...]}]（dims 等长，NaN 视为缺失）
   * 返回 {svg, variance}——PC1/PC2 轴带方差解释率标注；缺失维度按列均值填补。
   * 协方差矩阵幂迭代求主特征向量（d 维小矩阵，幂迭代 40 轮足够收敛）。
   */
  function pcaScatter(rows, opts = {}) {
    const W = opts.width || 620;
    const H = opts.height || 260;
    const valid = (rows || []).filter((r) => Array.isArray(r.dims) && r.dims.some((v) => Number.isFinite(v)));
    if (valid.length < 4) return { svg: '<div class="viz-empty viz-empty-box">带特征的样本不足 4 条——PCA 需要最小样本量</div>', variance: null };
    // v83：维度宽度取全体最大——混代际样本（15/22/26 维）不再因短行 undefined 污染协方差
    const d = Math.max.apply(Math, valid.map((r) => r.dims.length));
    const cols = Array.from({ length: d }, (_, j) => valid.map((r) => r.dims[j]).filter((v) => Number.isFinite(v)));
    const mean = cols.map((c) => (c.length ? c.reduce((s, v) => s + v, 0) / c.length : 0));
    const std = cols.map((c, j) => {
      const m = mean[j];
      const v = c.reduce((s, x) => s + (x - m) * (x - m), 0) / Math.max(1, c.length - 1);
      return Math.sqrt(v) || 1;
    });
    const Z = valid.map((r) => Array.from({ length: d }, (_, j) => {
      const v = r.dims[j];
      return ((Number.isFinite(v) ? v : mean[j]) - mean[j]) / std[j];
    }));
    const C = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const z of Z) for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] += z[i] * z[j];
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) C[i][j] /= Math.max(1, Z.length - 1);
    function powerIteration(M, exclude) {
      let v = Array.from({ length: d }, (_, i) => Math.sin((i + 1) * 12.9898) * 0.5 + 0.5);
      if (exclude) {
        const dot = v.reduce((s, x, i) => s + x * exclude[i], 0);
        v = v.map((x, i) => x - dot * exclude[i]);
      }
      for (let it = 0; it < 40; it++) {
        let nv = new Array(d).fill(0);
        for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) nv[i] += M[i][j] * v[j];
        if (exclude) {
          const dot = nv.reduce((s, x, i) => s + x * exclude[i], 0);
          nv = nv.map((x, i) => x - dot * exclude[i]);
        }
        const norm = Math.hypot.apply(Math, nv);
        if (norm < 1e-12) break;
        v = nv.map((x) => x / norm);
      }
      let lam = 0;
      for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) lam += v[i] * M[i][j] * v[j];
      return { v, lam: Math.max(0, lam) };
    }
    const pc1 = powerIteration(C, null);
    const pc2 = powerIteration(C, pc1.v);
    const totalVar = C.reduce((s2, row, i) => s2 + row[i], 0) || 1;
    const v1 = Math.round((pc1.lam / totalVar) * 100);
    const v2 = Math.round((pc2.lam / totalVar) * 100);
    const proj = Z.map((z) => ({
      x: z.reduce((s2, v, i) => s2 + v * pc1.v[i], 0),
      y: z.reduce((s2, v, i) => s2 + v * pc2.v[i], 0),
    }));
    const xs = proj.map((p) => p.x);
    const ys = proj.map((p) => p.y);
    const PAD = { l: 40, r: 14, t: 12, b: 26 };
    const xExt = [Math.min.apply(Math, xs), Math.max.apply(Math, xs)];
    const yExt = [Math.min.apply(Math, ys), Math.max.apply(Math, ys)];
    const sx = (v) => PAD.l + ((v - xExt[0]) / Math.max(1e-9, xExt[1] - xExt[0])) * (W - PAD.l - PAD.r);
    const sy = (v) => H - PAD.b - ((v - yExt[0]) / Math.max(1e-9, yExt[1] - yExt[0])) * (H - PAD.t - PAD.b);
    let g = gridLines(W, H, 20);
    g += '<line x1="' + PAD.l + '" y1="' + (H - PAD.b) + '" x2="' + (W - PAD.r) + '" y2="' + (H - PAD.b) + '" class="viz-axisline"/>';
    g += '<line x1="' + PAD.l + '" y1="' + PAD.t + '" x2="' + PAD.l + '" y2="' + (H - PAD.b) + '" class="viz-axisline"/>';
    g += '<text x="' + W / 2 + '" y="' + (H - 6) + '" text-anchor="middle" class="viz-axislabel">PC1（解释 ' + v1 + '% 方差）</text>';
    g += '<text x="12" y="' + (PAD.t + 8) + '" class="viz-axislabel">PC2（' + v2 + '%）</text>';
    g += proj.map((p, i) => {
      const r = valid[i];
      const c = r.color === 'bad' ? 'viz-pt-bad' : r.color === 'ok' ? 'viz-pt-ok' : 'viz-pt-muted';
      const rad = Number.isFinite(r.r) ? Math.max(2.5, Math.min(7, r.r)) : 4;
      return '<circle cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="' + rad + '" class="viz-pt ' + c + '"><title>' + esc(r.tip || r.name || '') + '</title></circle>';
    }).join('');
    return { svg: svgWrap(W, H, g, 'viz-pca'), variance: { v1, v2 } };
  }

  // ---------- 13. 雷达图（单样本几何指纹） ----------
  /** axes: [{label, value(0-1)}]；opts.compare 可选对照多边形（灰线） */
  function radar(axes, opts = {}) {
    const size = opts.size || 210;
    const cx = size / 2, cy = size / 2 + 4, R = size / 2 - 26;
    const n = (axes || []).length;
    if (n < 3) return '';
    const pt = (i, r) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
    };
    let g = '';
    for (const frac of [0.25, 0.5, 0.75, 1]) {
      g += '<polygon points="' + axes.map((_, i) => pt(i, R * frac).map((v) => v.toFixed(1)).join(',')).join(' ') + '" class="viz-radar-ring"/>';
    }
    g += axes.map((_, i) => '<line x1="' + cx + '" y1="' + cy + '" x2="' + pt(i, R)[0].toFixed(1) + '" y2="' + pt(i, R)[1].toFixed(1) + '" class="viz-radar-spoke"/>').join('');
    const poly = (cls) => '<polygon points="' + axes.map((a, i) => pt(i, R * Math.max(0, Math.min(1, a.value))).map((v) => v.toFixed(1)).join(',')).join(' ') + '" class="' + cls + '"/>';
    if (opts.compare) g += poly('viz-radar-cmp');
    g += poly('viz-radar-main');
    g += axes.map((a, i) => {
      const x = pt(i, R + 12);
      return '<text x="' + x[0].toFixed(1) + '" y="' + x[1].toFixed(1) + '" text-anchor="middle" class="viz-tick">' + esc(a.label) + '</text>';
    }).join('');
    return svgWrap(size, size, g, 'viz-radar');
  }

  window.Viz = {
    esc, sparkline, gauge, donut, barDiff, scatter, heatmap, timeline, printerBay, maeBars, countUp, confetti, pcaScatter, radar,
    _fmt: { fmtTemp, fmtMins },
  };
})();
