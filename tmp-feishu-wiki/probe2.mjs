import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
// p4: 只插 table 壳（2x2），不带 children
const ins = await api('POST', `/docx/v1/documents/${DOC}/blocks/${DOC}/children?document_revision_id=-1`, {
  children: [{ block_type: 31, table: { property: { row_size: 2, column_size: 2, column_width: [120, 120], merge_info: [{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1}] } } }],
  index: -1,
});
console.log('p4 table壳:', ins.code === 0 ? '✅ OK' : '❌ ' + ins.code + ' ' + String(ins.msg).slice(0, 150));
if (ins.code !== 0) process.exit(1);
const tableBlockId = ins.data.children[0].block_id;
console.log('table block_id:', tableBlockId);
// 拉 table 块详情，看 cells 是否自动生成
const blk = await api('GET', `/docx/v1/documents/${DOC}/blocks/${tableBlockId}?document_revision_id=-1`);
const cells = blk.data.block.children || [];
console.log('table 块 children (cells):', JSON.stringify(cells));
// 往第一个 cell 里插内容
if (cells.length > 0) {
  const cellIns = await api('POST', `/docx/v1/documents/${DOC}/blocks/${cells[0]}/children?document_revision_id=-1`, {
    children: [{ block_type: 2, text: { elements: [{ text_run: { content: 'A1 内容' } }], style: {} } }],
    index: -1,
  });
  console.log('cell 内容插入:', cellIns.code === 0 ? '✅ OK' : '❌ ' + cellIns.code + ' ' + String(cellIns.msg).slice(0, 150));
}
