// 测试 markdown convert + 插入写权限
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

// 1. markdown -> blocks
const md = '## 写入链路测试\n\n这一段由预约系统机器人写入，用于验证编辑权限。\n\n- 列表项甲\n- 列表项乙\n';
const c = await fetch(`${BASE}/docx/v1/documents/blocks/convert`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ content_type: 'markdown', content: md }),
});
const cj = await c.json();
console.log('convert:', cj.code, cj.msg);
if (cj.code !== 0) process.exit(1);
const blocks = cj.data.blocks.map(b => { const { id, ...rest } = b; return rest; });
console.log('blocks:', blocks.length, 'types:', blocks.map(b => b.block_type).join(','));

// 2. 插入到「3D打印耗材管理与通识」(obj_token=LcQxwgz8KipRmnkrqebcHEQ7nJg)
const DOC = 'LcQxwgz8KipRmnkrqebcHEQ7nJg';
const ins = await fetch(`${BASE}/docx/v1/documents/${DOC}/blocks/${DOC}/children?document_revision_id=-1`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ children: blocks, index: -1 }),
});
const ij = await ins.json();
console.log('insert:', ij.code, ij.msg);
if (ij.code === 0) console.log('✅ 写权限 OK，已插入测试段');
