import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
async function tryDesc(label, body) {
  const ins = await api('POST', `/docx/v1/documents/${DOC}/blocks/${DOC}/descendant?document_revision_id=-1`, body);
  console.log(`${label}: ${ins.code === 0 ? '✅ OK' : '❌ ' + ins.code + ' ' + String(ins.msg).slice(0, 200)}`);
  return ins;
}
const tid = 'v5-table-' + Date.now();
const c1 = tid + '-c1', c2 = tid + '-c2', c3 = tid + '-c3', c4 = tid + '-c4';
const x1 = tid + '-x1', x2 = tid + '-x2', x3 = tid + '-x3', x4 = tid + '-x4';
await tryDesc('v5 table.cells 字段', {
  index: -1,
  children_id: [tid],
  descendants: [
    { block_id: tid, block_type: 31, table: { cells: [c1, c2, c3, c4], property: { row_size: 2, column_size: 2, column_width: [120, 120], merge_info: [{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1}] } } },
    { block_id: c1, block_type: 32, children: [x1], table_cell: {} },
    { block_id: c2, block_type: 32, children: [x2], table_cell: {} },
    { block_id: c3, block_type: 32, children: [x3], table_cell: {} },
    { block_id: c4, block_type: 32, children: [x4], table_cell: {} },
    { block_id: x1, block_type: 2, text: { elements: [{ text_run: { content: 'A1' } }], style: {} } },
    { block_id: x2, block_type: 2, text: { elements: [{ text_run: { content: 'B1' } }], style: {} } },
    { block_id: x3, block_type: 2, text: { elements: [{ text_run: { content: 'A2' } }], style: {} } },
    { block_id: x4, block_type: 2, text: { elements: [{ text_run: { content: 'B2' } }], style: {} } },
  ],
});
