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
const H = { Authorization: `Bearer ${at}` };
const DOCS = {
  '3D打印机使用指南': 'MhztdVIfVoFbC0xbKLgcQnbLnVe',
  '3D打印机维修指南（拓竹）': 'Vph1wKfpsiM9U5kFelbc9AtNn9t',
  '3D打印机维修指南（创想）': 'KbspwjwItiUffIkmbYUcETnynxf',
  '3D打印耗材管理与通识': 'LcQxwgz8KipRmnkrqebcHEQ7nJg',
  '3D打印机维护日志': 'GL0FwImTTieQNVknTndcTiC1nqd',
  '3D打印机预约系统': 'SBuzwLCwai2ezFk7b6ScSKscn6e',
};
for (const [title, doc] of Object.entries(DOCS)) {
  const r = await fetch(`${BASE}/docx/v1/documents/${doc}/raw_content`, { headers: H });
  const j = await r.json();
  const len = j.code === 0 ? (j.data.content || '').length : -1;
  console.log(`${title}: ${len} chars ${j.code === 0 ? '✅' : '❌ ' + j.msg}`);
}
// 改名：创想节点 → 闪铸（用户身份）
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const rename = await fetch(`${BASE}/wiki/v2/spaces/7312000199243792387/nodes/KbspwjwItiUffIkmbYUcETnynxf/update_title`, {
  method: 'POST', headers: { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ title: '3D打印机维修指南（闪铸）' }),
});
const rj = await rename.json();
console.log('节点改名:', rj.code === 0 ? '✅ 已改为「3D打印机维修指南（闪铸）」' : `❌ ${rj.code} ${rj.msg}`);
