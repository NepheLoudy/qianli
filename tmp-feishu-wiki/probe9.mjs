import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// v7: children API 最简 table 壳（只带 property 的 row/column size）
const v7 = await api('POST', `/docx/v1/documents/${DOC}/blocks/${DOC}/children?document_revision_id=-1`, {
  children: [{ block_type: 31, table: { property: { row_size: 2, column_size: 2 } } }],
  index: -1,
});
console.log('v7 最简table壳(children API):', v7.code === 0 ? '✅ OK id=' + v7.data.children[0].block_id : '❌ ' + v7.code + ' ' + String(v7.msg).slice(0, 200));
if (v7.code === 0) {
  const tid = v7.data.children[0].block_id;
  const blk = await api('GET', `/docx/v1/documents/${DOC}/blocks/${tid}?document_revision_id=-1`);
  console.log('table 块详情:', JSON.stringify(blk.data?.block, null, 2).slice(0, 800));
}
