/* ============================================================
   千里战队 3D 打印预约 · 机队悬浮坞（Fleet Dock）
   右侧悬浮缩略状态列：每机状态点/进度/待取件标记，点击直达回执；
   可折叠成边缘细条。四页共享（status.html 观察台除外——那里有机队全景）。
   自包含组件：注入 DOM、10s 轮询 /api/printers、不依赖页面既有 JS。
   ============================================================ */
(function () {
  if (window.__qliFleetDock) return; // 防重复注入
  window.__qliFleetDock = true;

  var HIDE_ON = ['/status.html'];           // 观察台已有机队全景，不注入
  if (HIDE_ON.some(function (p) { return location.pathname.endsWith(p); })) return;

  var STATE_COLOR = {
    '空闲': 'ok', '已完成': 'info', '打印中': 'accent',
    '暂停': 'warn', '故障': 'bad', '未连接': 'dim', '离线': 'dim',
  };
  var expanded = true;
  var timer = null;
  var root = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function statusClass(status) { return STATE_COLOR[status] || 'dim'; }

  function render(printers) {
    if (!root) return;
    var list = Array.isArray(printers) ? printers : [];
    var rows = list.map(function (p) {
      var cls = statusClass(p.status);
      var prog = (p.status === '打印中' && Number(p.progress) > 0) ? Math.min(100, Number(p.progress)) + '%' : '';
      var hold = p.receiptHold ? '<span class="fd-hold" title="打完待取件——点击确认取件">📦</span>' : '';
      var stale = p.stateStale ? '<span class="fd-stale" title="状态过期（可能失联）">?</span>' : '';
      return '<div class="fd-row" data-id="' + esc(p.id) + '" data-record="' + esc((p.receiptHold && p.receiptHold.recordId) || '') + '" data-name="' + esc(p.name) + '">'
        + '<span class="fd-dot fd-dot--' + cls + (p.status === '打印中' ? ' fd-pulse' : '') + '"></span>'
        + '<span class="fd-name">' + esc(p.name) + '</span>'
        + '<span class="fd-status">' + esc(p.status || '—') + (prog ? ' ' + prog : '') + '</span>'
        + hold + stale
        + '</div>';
    }).join('');
    root.querySelector('#fdList').innerHTML = rows
      || '<div class="fd-empty">登录后查看机队</div>';
    var busy = list.filter(function (p) { return p.status === '打印中'; }).length;
    root.querySelector('#fdSummary').textContent = list.length
      ? (busy + '/' + list.length + ' 打印中')
      : '';
  }

  function refresh() {
    fetch('/api/printers', { credentials: 'same-origin' })
      .then(function (r) {
        if (r.status === 401) return 'unauth';
        return r.ok ? r.json() : [];
      })
      .then(function (data) {
        if (data === 'unauth') { renderUnauth(); return; }
        render(data);
      })
      .catch(function () { /* 网络抖动忽略，下轮再试 */ });
  }
  function renderUnauth() {
    if (!root) return;
    root.querySelector('#fdList').innerHTML = '<div class="fd-empty">登录后查看机队</div>';
    root.querySelector('#fdSummary').textContent = '';
  }

  // 回执（dock 内直达）：本人或 reviewer 可成功，其他人后端 403 提示
  function acknowledge(recordId, machineName) {
    var dlg = document.createElement('dialog');
    dlg.innerHTML = '<h3>📦 确认取件（' + esc(machineName) + '）</h3>'
      + '<div class="detail">确认已取走 <b>' + esc(recordId) + '</b> 打完的件——'
      + '确认后清该机取件闸并清理机端状态，队列下一件开打。</div>'
      + '<div class="actions"><button class="primary" id="fdAckOk">确认取件</button>'
      + '<button id="fdAckNo">取消</button></div>';
    document.body.appendChild(dlg);
    dlg.querySelector('#fdAckNo').onclick = function () { dlg.close(); dlg.remove(); };
    dlg.querySelector('#fdAckOk').onclick = function () {
      fetch('/api/reservations/' + encodeURIComponent(recordId) + '/receipt', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
        .then(function (res) {
          dlg.remove();
          var t = document.getElementById('toast');
          if (t) { t.textContent = res.ok ? ('📦 已回执 ' + recordId + (res.d.queueResumed ? '，队列继续' : '')) : ('❌ ' + (res.d.error || '回执失败')); t.style.display = 'block'; setTimeout(function () { t.style.display = 'none'; }, 4000); }
          refresh();
        })
        .catch(function () { dlg.remove(); });
    };
    dlg.showModal();
  }

  function build() {
    root = document.createElement('div');
    root.id = 'fleetDock';
    root.className = 'fd expanded';
    root.innerHTML =
      '<div class="fd-head" id="fdHead">'
      + '<span class="fd-title">FLEET</span>'
      + '<span class="fd-summary" id="fdSummary"></span>'
      + '<button class="fd-fold" id="fdFold" title="折叠/展开">»</button>'
      + '</div>'
      + '<div class="fd-body" id="fdList"><div class="fd-empty">加载中…</div></div>';
    document.body.appendChild(root);
    root.querySelector('#fdFold').onclick = function () {
      expanded = !expanded;
      root.className = 'fd ' + (expanded ? 'expanded' : 'collapsed');
      this.textContent = expanded ? '»' : '«';
      this.title = expanded ? '折叠' : '展开';
    };
    root.querySelector('#fdList').addEventListener('click', function (e) {
      var row = e.target.closest('.fd-row');
      if (!row) return;
      var record = row.getAttribute('data-record');
      if (record) { acknowledge(record, row.getAttribute('data-name')); return; }
      // 非持闸机：跳观察台看全景
      location.href = '/status.html';
    });
    // 观察台从首页跳转时 URL 带 hash 的场景不特殊处理——dock 不在观察台注入
    refresh();
    timer = setInterval(refresh, 10000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
  else build();
})();
