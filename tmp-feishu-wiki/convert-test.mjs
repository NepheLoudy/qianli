// 测 markdown 表格/代码块/任务列表转换支持
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

const md = [
  '# 一级标题',
  '## 二级标题',
  '普通段落 **加粗** `code`',
  '',
  '| 机型 | 品牌 | 特点 |',
  '| --- | --- | --- |',
  '| X1C | 拓竹 | 旗舰 |',
  '| A1mini | 拓竹 | 迷你 |',
  '',
  '- 无序列表项',
  '1. 有序列表项',
  '- [ ] 任务列表项',
  '',
  '> 引用块',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
  '---',
].join('\n');
const c = await fetch(`${BASE}/docx/v1/documents/blocks/convert`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ content_type: 'markdown', content: md }),
});
const cj = await c.json();
console.log('convert:', cj.code, cj.msg);
if (cj.code === 0) {
  const bt = {}; // block_type 统计
  for (const b of cj.data.blocks) bt[b.block_type] = (bt[b.block_type] || 0) + 1;
  console.log('block_type 分布:', JSON.stringify(bt));
  console.log('types: 1=page 2=text 3-11=headings 12=bullet 13=ordered 14=code 15=quote 17=todo 31=table 32=table_cell 34=divider');
}
