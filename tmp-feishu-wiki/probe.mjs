// 探测插入 API 的 children 格式要求
import { readFileSync } from 'node:fs';
const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';

async function tryInsert(label, children) {
  const r = await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}/children?document_revision_id=-1`, {
    method: 'POST', headers: H, body: JSON.stringify({ children, index: -1 }),
  });
  const j = await r.json();
  console.log(`${label}: ${j.code === 0 ? '✅ OK children=' + (j.data?.children?.length ?? j.data?.children_view?.length ?? '?') : '❌ ' + j.code + ' ' + String(j.msg).slice(0, 120)}`);
  return j.code === 0;
}

const textBlock = { block_type: 2, text: { elements: [{ text_run: { content: '探测一：无children字段' } }], style: {} } };
await tryInsert('p1 无children字段', [textBlock]);
await tryInsert('p2 空children数组', [{ ...textBlock, text: { elements: [{ text_run: { content: '探测二：空children数组' } }], style: {} }, children: [] }]);

// p3: 完整 table 树（模拟 convert 输出，去 id/parent_id）
const table = {
  block_type: 31,
  table: { property: { row_size: 2, column_size: 2, column_width: [100, 100], merge_info: [{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1},{row_span:1,col_span:1}] }, cells: [] },
  children: [
    { block_type: 32, table_cell: {}, children: [ { block_type: 2, text: { elements: [{ text_run: { content: 'A1' } }], style: {} } } ] },
    { block_type: 32, table_cell: {}, children: [ { block_type: 2, text: { elements: [{ text_run: { content: 'B1' } }], style: {} } } ] },
    { block_type: 32, table_cell: {}, children: [ { block_type: 2, text: { elements: [{ text_run: { content: 'A2' } }], style: {} } } ] },
    { block_type: 32, table_cell: {}, children: [ { block_type: 2, text: { elements: [{ text_run: { content: 'B2' } }], style: {} } } ] },
  ],
};
await tryInsert('p3 table嵌套树', [table]);
