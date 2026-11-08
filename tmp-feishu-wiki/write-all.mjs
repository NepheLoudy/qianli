// 批量写入飞书 wiki 文档：删旧顶级块 -> convert markdown -> 递归插入（table 两步法）
// 用法：node write-all.mjs [all|docKey]
import { readFileSync, existsSync } from 'node:fs';

const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const BASE = 'https://open.feishu.cn/open-apis';

const appResp = await fetch(`${BASE}/auth/v3/app_access_token/internal`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ app_id: env.APP_ID, app_secret: env.APP_SECRET }),
});
const appTok = (await appResp.json()).app_access_token;
let tok = appTok;
let tokKind = 'app';
if (existsSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json')) {
  const ut = JSON.parse(readFileSync('D:/dev/qianli/tmp-feishu-wiki/user-token.json', 'utf8'));
  if (ut.access_token) {
    tok = ut.access_token;
    tokKind = 'user(' + ut.access_token.slice(0, 8) + '...)';
  }
}
console.log(`token kind: ${tokKind}`);
const H = { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
let reqCount = 0;

async function api(method, path, body) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    reqCount++;
    if (reqCount % 4 === 0) await sleep(220); // 节流防限速
    const resp = await fetch(`${BASE}${path}`, {
      method, headers: H, body: body === undefined ? undefined : JSON.stringify(body),
    });
    let j;
    try {
      j = await resp.json();
    } catch {
      // bad json：多半是限速 HTML 或瞬时网络错误，退避重试
      console.log(`  bad json (http ${resp.status}), retry ${attempt} after ${attempt * 1500}ms`);
      await sleep(attempt * 1500);
      continue;
    }
    if (j.code === 1254043 || j.code === 99991400) { // 限速：退避重试
      console.log(`  rate-limited, retry ${attempt} after ${attempt * 1500}ms`);
      await sleep(attempt * 1500);
      continue;
    }
    if (j.code !== 0) console.log(`  [${method} ${path.split('?')[0]}] code=${j.code} msg=${String(j.msg).slice(0, 140)}`);
    return j;
  }
  throw new Error('retries exhausted: ' + path);
}

// 文档 obj_token（应用身份提前解析好的）
const DOCS = {
  zhiNan:   { doc: 'MhztdVIfVoFbC0xbKLgcQnbLnVe', file: '02-使用指南.md' },
  tuozhu:   { doc: 'Vph1wKfpsiM9U5kFelbc9AtNn9t', file: '03-维修指南拓竹.md' },
  chuangxiangToShanzhu: { doc: 'KbspwjwItiUffIkmbYUcETnynxf', file: '04-维修指南闪铸.md' },
  haocai:   { doc: 'LcQxwgz8KipRmnkrqebcHEQ7nJg', file: '05-耗材管理与通识.md' },
  rizhi:    { doc: 'GL0FwImTTieQNVknTndcTiC1nqd', file: '06-维护日志.md' },
  yuyue:    { doc: 'SBuzwLCwai2ezFk7b6ScSKscn6e', file: '01-预约系统.md' },
};

async function listTopBlockCount(docId) {
  const root = await api('GET', `/docx/v1/documents/${docId}/blocks/${docId}?document_revision_id=-1`);
  if (root.code !== 0) throw new Error('get root fail: ' + root.msg);
  return (root.data.block.children || []).length;
}

async function deleteAllTop(docId, topCount) {
  if (topCount === 0) return;
  const j = await api('DELETE',
    `/docx/v1/documents/${docId}/blocks/${docId}/children/batch_delete?document_revision_id=-1`,
    { start_index: 0, end_index: topCount });
  if (j.code !== 0) throw new Error('batch_delete fail: ' + j.msg);
  console.log(`  deleted ${topCount} top blocks`);
}

// markdown -> convert 树（顶层块数组，children 为嵌套对象）
async function mdToTree(md) {
  const j = await api('POST', '/docx/v1/documents/blocks/convert', {
    content_type: 'markdown', content: md,
  });
  if (j.code !== 0) throw new Error('convert fail: ' + j.msg);
  const { first_level_block_ids, blocks } = j.data;
  const byId = new Map(blocks.map(b => [b.block_id, b]));
  function buildTree(b, depth = 0) {
    if (depth > 12) return null;
    const { block_id, parent_id, children = [], ...rest } = b;
    rest.children = children.map(cid => buildTree(byId.get(cid), depth + 1)).filter(Boolean);
    return rest;
  }
  return first_level_block_ids.map(id => buildTree(byId.get(id))).filter(Boolean);
}

// 递归插入一个块（含嵌套子块），table 块由 insertTable 处理、不走这里，返回新块 id
async function insertTree(docId, parentId, node, label) {
  const bt = node.block_type;
  if (bt === 31) throw new Error(`[${label}] table 块应在 insertTable 处理`);
  // 普通块：裸块插入（不带 children）
  const { children = [], ...bare } = node;
  const ins = await api('POST',
    `/docx/v1/documents/${docId}/blocks/${parentId}/children?document_revision_id=-1`,
    { children: [bare], index: -1 });
  if (ins.code !== 0) throw new Error(`[${label}] insert bt=${bt} fail: ${ins.msg}`);
  const newId = ins.data.children[0].block_id;
  // 递归插子块
  for (let i = 0; i < children.length; i++) {
    await insertTree(docId, newId, children[i], `${label}.c${i}`);
  }
  return newId;
}

// table 拉壳的正确实现
async function getBlock(docId, blockId) {
  const j = await api('GET', `/docx/v1/documents/${docId}/blocks/${blockId}?document_revision_id=-1`);
  if (j.code !== 0) throw new Error('get block fail: ' + j.msg);
  return j.data.block;
}

const TABLE_MAX_ROWS = 9; // 飞书 API 建表行上限（实测 9 过 10 不过）

async function buildAndFillTable(parentId, docId, rows, colSize, cellNodes, label) {
  const shell = await api('POST',
    `/docx/v1/documents/${docId}/blocks/${parentId}/children?document_revision_id=-1`,
    { children: [{ block_type: 31, table: { property: { row_size: rows, column_size: colSize } } }], index: -1 });
  if (shell.code !== 0) throw new Error(`[${label}] table shell fail (${rows}x${colSize}): ${shell.msg}`);
  const tid = shell.data.children[0].block_id;
  const detail = await getBlock(docId, tid);
  const cells = detail.table?.cells || [];
  for (let i = 0; i < Math.min(cells.length, cellNodes.length); i++) {
    for (let k = 0; k < (cellNodes[i].children || []).length; k++) {
      await insertTree(docId, cells[i], cellNodes[i].children[k], `${label}.cell${i}.${k}`);
    }
  }
  return tid;
}

async function insertTable(parentId, docId, node, label) {
  const prop = node.table?.property || {};
  const rowSize = prop.row_size, colSize = prop.column_size;
  const cellNodes = node.children || []; // 行优先
  if (rowSize <= TABLE_MAX_ROWS) {
    return buildAndFillTable(parentId, docId, rowSize, colSize, cellNodes, label);
  }
  // 大表拆分：每张 ≤9 行，续表第 1 行重复原表头
  const header = cellNodes.slice(0, colSize);
  const chunks = [];
  let r0 = 0;
  while (r0 < rowSize) {
    const take = chunks.length === 0 ? TABLE_MAX_ROWS : TABLE_MAX_ROWS - 1;
    const r1 = Math.min(r0 + take, rowSize);
    chunks.push([r0, r1]);
    r0 = r1;
  }
  for (let ci = 0; ci < chunks.length; ci++) {
    const [a, b] = chunks[ci];
    const fill = [];
    if (ci > 0) fill.push(...header);
    for (let r = a; r < b; r++) {
      fill.push(...cellNodes.slice(r * colSize, (r + 1) * colSize));
    }
    await buildAndFillTable(parentId, docId, fill.length / colSize, colSize, fill, `${label}.part${ci}`);
  }
  return null;
}

async function insertTopSequence(docId, topNodes) {
  let count = 0;
  for (let i = 0; i < topNodes.length; i++) {
    const node = topNodes[i];
    if (node.block_type === 31) {
      await insertTable(docId, docId, node, `top${i}`);
    } else {
      await insertTree(docId, docId, node, `top${i}`);
    }
    count++;
    if (count % 10 === 0) console.log(`    ...${count}/${topNodes.length}`);
  }
  return count;
}

async function writeDoc(key, conf) {
  console.log(`== ${key} (${conf.file}) ==`);
  const docId = conf.doc;
  const topCount = await listTopBlockCount(docId);
  console.log(`  doc=${docId} topBlocks=${topCount}`);
  if (topCount > 0) await deleteAllTop(docId, topCount);
  const md = readFileSync(`D:/dev/qianli/tmp-feishu-wiki/drafts/${conf.file}`, 'utf8');
  const tree = await mdToTree(md);
  console.log(`  tree ready: ${tree.length} top-level blocks`);
  const n = await insertTopSequence(docId, tree);
  console.log(`  ✅ written ${n} top blocks`);
}

const only = process.argv[2] || 'all';
for (const [key, conf] of Object.entries(DOCS)) {
  if (only !== 'all' && only !== key) continue;
  try {
    await writeDoc(key, conf);
  } catch (e) {
    console.error(`❌ ${key}: ${e.message}`);
    process.exitCode = 1;
  }
}
console.log('DONE');
