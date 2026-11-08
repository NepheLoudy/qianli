import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// 27位 base62 随机 id
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function genId(n = 27) { let s = ''; for (let i = 0; i < n; i++) s += CHARS[Math.floor(Math.random() * 62)]; return s; }
const tid = genId(), c1 = genId(), c2 = genId(), c3 = genId(), c4 = genId();
const x1 = genId(), x2 = genId(), x3 = genId(), x4 = genId();
const ins = await api('POST', `/docx/v1/documents/${DOC}/blocks/${DOC}/descendant?document_revision_id=-1`, {
  index: -1,
  children_id: [tid],
  descendants: [
    { block_id: tid, block_type: 31, parent_id: DOC, children: [c1, c2, c3, c4], table: { cells: [c1, c2, c3, c4], property: { row_size: 2, column_size: 2, column_width: [120, 120], merge_info: [{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1}] } } },
    { block_id: c1, block_type: 32, parent_id: tid, children: [x1], table_cell: {} },
    { block_id: c2, block_type: 32, parent_id: tid, children: [x2], table_cell: {} },
    { block_id: c3, block_type: 32, parent_id: tid, children: [x3], table_cell: {} },
    { block_id: c4, block_type: 32, parent_id: tid, children: [x4], table_cell: {} },
    { block_id: x1, block_type: 2, parent_id: c1, text: { elements: [{ text_run: { content: 'A1' } }], style: {} } },
    { block_id: x2, block_type: 2, parent_id: c2, text: { elements: [{ text_run: { content: 'B1' } }], style: {} } },
    { block_id: x3, block_type: 2, parent_id: c3, text: { elements: [{ text_run: { content: 'A2' } }], style: {} } },
    { block_id: x4, block_type: 2, parent_id: c4, text: { elements: [{ text_run: { content: 'B2' } }], style: {} } },
  ],
});
console.log('v6:', ins.code === 0 ? '✅ OK created=' + JSON.stringify(ins.data).slice(0, 120) : '❌ ' + ins.code + ' ' + String(ins.msg).slice(0, 200));
