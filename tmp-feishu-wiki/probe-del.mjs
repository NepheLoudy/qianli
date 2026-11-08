import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
// 先看根块 children 确认数量
const root = await (await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}?document_revision_id=-1`, { headers: H })).json();
const kids = root.data?.block?.children || [];
console.log('根块 children 数:', kids.length);
// 变体 A: snake_case
let r = await (await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}/children/batch_delete?document_revision_id=-1`, {
  method: 'DELETE', headers: H, body: JSON.stringify({ start_index: 0, end_index: kids.length }),
})).json();
console.log('snake_case:', r.code, r.msg);
if (r.code !== 0) {
  // 变体 B: camelCase 再试一次（打印完整报错）
  r = await (await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}/children/batch_delete?document_revision_id=-1`, {
    method: 'DELETE', headers: H, body: JSON.stringify({ startIndex: 0, endIndex: kids.length }),
  })).json();
  console.log('camelCase:', r.code, r.msg);
}
