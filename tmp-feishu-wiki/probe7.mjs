import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const at = (await (await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
})).json()).app_access_token;
const DOC = 'QP0KdwDnOouAljxSaZmcGuESnwg';
const r = await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks?page_size=500`, { headers: { Authorization: `Bearer ${at}` } });
const j = await r.json();
const cell = j.data.items.find(b => b.block_type === 32);
console.log('真实 cell 块:', JSON.stringify(cell, null, 2));
