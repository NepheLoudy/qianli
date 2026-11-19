// common.js · 三页公共 helper（v121 P3 抽取：index.html / approve.html / status.html 原内联定义收编于此）
// 页面通过 <script src="/common.js?v=20261120"> 最先加载；注意 __pollTimer 是本文件
// 的全局 let 绑定——页面内不要再声明（会撞 Identifier redeclaration），也不要直接引用。

/** HTML 转义：displayName/文件名/理由等用户可控字段一律过这里再进 innerHTML（防存储型 XSS） */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// v106 时区修复（曼波令「时间完全对不上」）：数据库时间戳是 UTC ISO，此前 slice 裸串
// 直显慢 8 小时——统一转本地时区。withYear=true 输出 "2026-11-09 21:52"，默认 "11-09 21:52"
function fmtLocalTime(iso, withYear) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso);
  const p = (n) => String(n).padStart(2, '0');
  const md = `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return withYear ? `${d.getFullYear()}-${md}` : md;
}

// 轮询守卫（审查修复 v62，四页同款口径）：interval 防叠加（页内重登会重复 enter）+
// 页面隐藏暂停、恢复时立即拉一轮——后台标签页不再持续打服务端
let __pollTimer = null;
function startPolling(fn, ms) {
  if (__pollTimer) clearInterval(__pollTimer);
  __pollTimer = setInterval(fn, ms);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInterval(__pollTimer); __pollTimer = null; }
    else if (!__pollTimer) { fn(); __pollTimer = setInterval(fn, ms); }
  });
}
