import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function trySize(r, c) {
  const resp = await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}/children?document_revision_id=-1`, {
    method: 'POST', headers: H, body: JSON.stringify({ children: [{ block_type: 31, table: { property: { row_size: r, column_size: c } } }], index: -1 }),
  });
  const j = await resp.json();
  console.log(`${r}x${c}: ${j.code === 0 ? '✅' : '❌ ' + String(j.msg).slice(0, 60)}`);
  return j.code === 0;
}
await trySize(8, 8);
await trySize(13, 8);
await trySize(13, 7);
await trySize(13, 6);
