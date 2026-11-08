// 验证 mdToTree 嵌套组装（只调 convert，不写入）
import { readFileSync } from 'node:fs';
const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const BASE = 'https://open.feishu.cn/open-apis';
const r = await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
});
const tok = (await r.json()).app_access_token;
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

const md = '# 标题\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n- 列表项\n';
const resp = await fetch(`${BASE}/docx/v1/documents/blocks/convert`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ content_type: 'markdown', content: md }),
});
const j = await resp.json();
console.log('convert:', j.code, j.msg);
const { first_level_block_ids, blocks } = j.data;
console.log('first_level_block_ids:', JSON.stringify(first_level_block_ids));
for (const b of blocks) {
  console.log(`block ${b.block_id} type=${b.block_type} children=${JSON.stringify(b.children || [])}`);
}
// 顶层块是 page(1) 吗？
const topTypes = first_level_block_ids.map(id => blocks.find(b => b.block_id === id)?.block_type);
console.log('top types:', JSON.stringify(topTypes));
