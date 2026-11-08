// 读飞书 wiki：get_node -> 列子节点 -> raw_content，全部落盘
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const APP_ID = env.APP_ID, APP_SECRET = env.APP_SECRET;
if (!APP_ID || !APP_SECRET) throw new Error('no APP_ID/APP_SECRET in .env');

const BASE = 'https://open.feishu.cn/open-apis';

async function getToken() {
  const r = await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const j = await r.json();
  if (!j.app_access_token) throw new Error('token fail: ' + JSON.stringify(j));
  return j.app_access_token;
}

const token = await getToken();
const H = { Authorization: `Bearer ${token}` };

async function api(path) {
  const r = await fetch(`${BASE}${path}`, { headers: H });
  const j = await r.json();
  return j;
}

// 1. 解析两个 wiki token
const targets = ['V4hnw4PE2iisrOk1oR0cJdaLnog', 'J1PKwtWZviQqHlkTgXBc5SZmn4d'];
const nodeMap = {};
for (const t of targets) {
  const j = await api(`/wiki/v2/spaces/get_node?token=${t}`);
  console.log('get_node', t, '=>', j.code, j.msg);
  if (j.code === 0) {
    nodeMap[t] = j.data.node;
    console.log('  title:', j.data.node.title, '| obj_type:', j.data.node.obj_type, '| obj_token:', j.data.node.obj_token, '| space_id:', j.data.node.space_id, '| has_child:', j.data.node.has_child);
  }
}

const spaceId = Object.values(nodeMap)[0]?.space_id;
console.log('space_id =', spaceId);

// 2. 递归列子节点
const allNodes = [];
async function listChildren(parentToken, depth) {
  let pageToken = '';
  do {
    const q = new URLSearchParams({ parent_node_token: parentToken, page_size: '50' });
    if (pageToken) q.set('page_token', pageToken);
    const j = await api(`/wiki/v2/spaces/${spaceId}/nodes?${q}`);
    if (j.code !== 0) { console.log('list children fail:', j.code, j.msg); return; }
    for (const n of j.data.items || []) {
      allNodes.push(n);
      console.log('  '.repeat(depth) + `- ${n.title} [${n.node_token}] obj=${n.obj_type} has_child=${n.has_child}`);
      if (n.has_child) await listChildren(n.node_token, depth + 1);
    }
    pageToken = j.data.page_token || '';
    hasMore = j.data.has_more;
  } while (hasMore && pageToken);
}
let hasMore = false;
for (const [t, n] of Object.entries(nodeMap)) {
  console.log(`\n== children of ${n.title} (${t}) ==`);
  await listChildren(t, 1);
}

writeFileSync('D:/dev/qianli/tmp-feishu-wiki/nodes.json', JSON.stringify({ nodeMap, allNodes }, null, 2));

// 3. 拉所有 docx 的 raw_content
mkdirSync('D:/dev/qianli/tmp-feishu-wiki/content', { recursive: true });
const docs = Object.values(nodeMap).concat(allNodes).filter(n => n.obj_type === 'docx');
for (const d of docs) {
  const j = await api(`/docx/v1/documents/${d.obj_token}/raw_content`);
  const safe = (d.title || 'untitled').replace(/[\/:*?"<>|]/g, '_');
  if (j.code === 0) {
    writeFileSync(`D:/dev/qianli/tmp-feishu-wiki/content/${safe}.txt`, j.data.content || '');
    console.log(`saved: ${safe} (${(j.data.content || '').length} chars)`);
  } else {
    console.log(`FAIL ${safe}: ${j.code} ${j.msg}`);
  }
}
console.log('\nDONE');
