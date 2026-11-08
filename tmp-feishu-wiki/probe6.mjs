import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
// 用应用身份读（只读权限已通），目标：3D打印实训文档里的真实表格块
const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const at = (await (await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
})).json()).app_access_token;
const DOC = 'QP0KdwDnOouAljxSaZmcGuESnwg'; // 3D打印实训
const r = await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks?page_size=500`, { headers: { Authorization: `Bearer ${at}` } });
const j = await r.json();
if (j.code !== 0) { console.log('fail', j.code, j.msg); process.exit(1); }
const table = j.data.items.find(b => b.block_type === 31);
console.log(JSON.stringify(table, null, 2));
