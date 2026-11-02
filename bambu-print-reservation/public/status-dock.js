/* ============================================================
   千里战队 3D 打印预约 · 状态侧坞（Status Dock，v71 重构）
   左翼定位（曼波令「来点有意义的设计」）：右坞管**空间**（哪台机在干嘛），
   左坞管**事情**——①待我处理（待取件/待审批/放弃池，单据级直达按钮）
   ②最新动态（单据轨迹聚合的事件流，相对时间）。不再放机队计数（与右坞重复）。
   数据：/api/reservations 30s + 放弃池（reviewer）；相对时间本地算。
   ============================================================ */
(function () {
  if (window.__qliStatusDock) return;
  window.__qliStatusDock = true;

  var HIDE_ON = ['/status.html'];           // 观察台有快捷操作面板
  if (HIDE_ON.some(function (p) { return location.pathname.endsWith(p); })) return;

  var expanded = true;
  var root = null;
  var me = null;
  var records = [];
  var givenUpIds = [];
  var timer = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function build() {
    root = document.createElement('div');
    root.id = 'statusDock';
    root.className = 'ld expanded';
    root.innerHTML =
      '<div class="ld-head">'
      + '<span class="ld-title">PULSE</span>'
      + '<span class="ld-summary" id="ldSummary"></span>'
      + '<button class="ld-fold" id="ldFold" data-no-loading="1" title="折叠/展开">«</button>'
      + '</div>'
      + '<div class="ld-body" id="ldBody"><div class="ld-empty">加载中…</div></div>';
    document.body.appendChild(root);
    root.querySelector('#ldFold').onclick = function () {
      expanded = !expanded;
      root.className = 'ld ' + (expanded ? 'expanded' : 'collapsed');
      this.textContent = expanded ? '«' : '»';
    };
    document.getElementById('ldBody').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      if (act === 'receipt') qkReceipt(id);
      if (act === 'review') location.href = '/approve.html';
    });
    refresh();
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (timer) { clearInterval(timer); timer = null; } }
      else if (!timer) { refresh(); timer = setInterval(refresh, 30000); }
    });
    timer = setInterval(refresh, 30000);
  }

  function qkReceipt(id) {
    fetch('/api/reservations/' + encodeURIComponent(id) + '/receipt', { method: 'POST' })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (r) {
        if (r.ok && window.toast) window.toast('📦 已回执 #' + id);
        else if (window.toast) window.toast('❌ ' + (r.d.error || '回执失败'));
        refresh();
      }).catch(function () { if (window.toast) window.toast('❌ 回执请求失败'); });
  }

  function relTime(iso) {
    var t = Date.parse(iso);
    if (!Number.isFinite(t)) return '';
    var m = Math.max(0, Math.round((Date.now() - t) / 60000));
    if (m < 1) return '刚刚';
    if (m < 60) return m + 'm';
    var h = Math.floor(m / 60);
    return h < 24 ? h + 'h' + (m % 60 ? (m % 60) + 'm' : '') : Math.floor(h / 24) + 'd';
  }

  function render() {
    if (!root) return;
    var isReviewer = me && (me.role === 'reviewer' || me.role === 'admin');
    var html = '';

    var pickup = records.filter(function (r) { return r.status === '已完成' && !r.receipt; });
    var pending = isReviewer ? records.filter(function (r) { return r.status === '待审批'; }) : [];
    var givenUp = isReviewer ? givenUpIds : [];
    html += '<div class="ld-sec">待我处理</div>';
    if (!me) {
      html += '<div class="ld-empty">未登录——登录后查看你的待办</div>'; // v83：与「没有待办」区分开
    } else if (!pickup.length && !pending.length && !givenUp.length) {
      html += '<div class="ld-empty">全部安好——没有要处理的事</div>';
    } else {
      pickup.slice(0, 3).forEach(function (r) {
        html += '<div class="ld-todo"><span class="ld-tmark">📦</span>'
          + '<span class="ld-tid" title="' + esc(r.fileName || '') + '">' + esc(r.id) + '</span>'
          + '<button class="ld-act" data-act="receipt" data-id="' + esc(r.id) + '">取件</button></div>';
      });
      pending.slice(0, 2).forEach(function (r) {
        html += '<div class="ld-todo"><span class="ld-tmark">⚡</span>'
          + '<span class="ld-tid" title="' + esc(r.fileName || '') + '">' + esc(r.id) + '</span>'
          + '<button class="ld-act" data-act="review">去审批</button></div>';
      });
      givenUp.slice(0, 2).forEach(function (id) {
        html += '<div class="ld-todo"><span class="ld-tmark">⚠️</span>'
          + '<span class="ld-tid">' + esc(id) + '</span>'
          + '<button class="ld-act" data-act="review" title="去预约中心放弃池恢复">恢复</button></div>';
      });
    }

    var events = [];
    records.forEach(function (r) {
      (r.history || []).forEach(function (h) {
        if (h && h.at) events.push({ at: h.at, to: h.to, id: r.id, note: h.note || '' });
      });
    });
    events.sort(function (a, b) { return Date.parse(b.at) - Date.parse(a.at); });
    html += '<div class="ld-sec">最新动态</div>';
    if (!events.length) html += '<div class="ld-empty">暂无动态</div>';
    else {
      html += events.slice(0, 6).map(function (e) {
        var icon = e.to === '已完成' ? '✅' : e.to === '打印中' ? '🖨' : e.to === '待审批' ? '📋' : e.to === '已取消' ? '🚫' : e.to === '已驳回' ? '❌' : '·';
        return '<div class="ld-evt"><span class="ld-eicon">' + icon + '</span>'
          + '<span class="ld-etext"><b>' + esc(e.id) + '</b> ' + esc(e.to) + (e.note ? ' <i>' + esc(e.note).slice(0, 26) + '</i>' : '') + '</span>'
          + '<span class="ld-etime">' + relTime(e.at) + '</span></div>';
      }).join('');
    }
    document.getElementById('ldBody').innerHTML = html;
    var sum = document.getElementById('ldSummary');
    var todoN = pickup.length + pending.length + givenUp.length;
    if (sum) sum.textContent = todoN ? todoN + ' 待办' : '空闲';
  }

  function refresh() {
    fetch('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (u) {
      me = u;
      if (!u) return [];
      return fetch('/api/reservations').then(function (r) { return r.ok ? r.json() : []; });
    }).then(function (list) {
      records = Array.isArray(list) ? list : [];
      if (!me || !(me.role === 'reviewer' || me.role === 'admin')) { givenUpIds = []; return null; }
      // v83 修复：放弃池数据在 /api/dispatch/queue 载荷的 givenUp 字段——原
      // /api/dispatch/given-up 端点不存在，每 30s 白打一个 404、恢复待办永不显示
      return fetch('/api/dispatch/queue').then(function (r) { return r.ok ? r.json() : null; }).then(function (q) {
        var g = q && Array.isArray(q.givenUp) ? q.givenUp : [];
        givenUpIds = g.map(function (x) { return x.recordId || x.id || ''; }).filter(Boolean);
        return null;
      });
    }).then(function () { render(); })
      .catch(function () { /* 静默——下一轮再试 */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
