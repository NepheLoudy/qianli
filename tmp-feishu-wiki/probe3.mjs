// 验证 convert + descendant 接口组合
import { readFileSync } from 'node:fs';
const BASE = 'https://open.feishu.cn/open-apis';
const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
const H = { Authorization: `Bearer ${ut.access_token}`, 'Content-Type': 'application/json' };
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
async function api(method, path, body) {
  const r = await fetch(`${BASE}${path}`, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  return r.json();
}
const md = '# 嵌套探测\n\n| 列甲 | 列乙 |\n| --- | --- |\n| 甲1 | 乙1 |\n\n- 列表项\n';
const conv = await api('POST', '/docx/v1/documents/blocks/convert', { content_type: 'markdown', content: md });
console.log('convert:', conv.code, conv.msg);
const { first_level_block_ids, blocks } = conv.data;
// descendant: descendants 保留 id，去掉 parent_id（避免引用不存在的父块）
const descendants = blocks.map(b => { const { parent_id, ...rest } = b; return rest; });
const ins = await api('POST', `/docx/v1/documents/${DOC}/blocks/${DOC}/descendant?document_revision_id=-1`, {
  index: -1,
  children_id: first_level_block_ids,
  descendants,
});
console.log('descendant:', ins.code === 0 ? '✅ OK created=' + (ins.data.children?.length ?? '?') : '❌ ' + ins.code + ' ' + String(ins.msg).slice(0, 200));
