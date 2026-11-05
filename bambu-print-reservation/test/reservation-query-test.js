/**
 * 预约分页查询单测（2026-11-04 审批台全量单据管理批：store.query() 存储层过滤/排序/分页）
 * 用法：node test/reservation-query-test.js
 * 注意：所有 env 必须在 require 之前设置（模块顶层读 env）；
 *       不 require dispatcher（会真连生产打印机）——纯存储层测试；
 *       QUIET_HOURS_DISABLED=1 防止凌晨跑测试触发静默积压落盘
 */
const os = require('os');
const path = require('path');
process.env.PROCESS_RULES_FILE = require('os').tmpdir() + `/bambu-test-rules-${process.pid}.json`;
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-resquery-${process.pid}.json`);
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-upquery-${process.pid}`);
process.env.DISPATCH_STATE_FILE = path.join(os.tmpdir(), `bambu-test-dispatch-${process.pid}.json`);
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-quiet-${process.pid}.json`);
process.env.QUIET_HOURS_DISABLED = '1';
process.env.TRAINING_SAMPLES_FILE = path.join(os.tmpdir(), `bambu-test-rq-train-${process.pid}.json`);
process.env.TRAINING_FILES_DIR = path.join(os.tmpdir(), `bambu-test-rq-trainfiles-${process.pid}`);
// 不向真实群 webhook 播报（照 local-reservation-test 隔离模式）
process.env.BOT_WEBHOOK_URL = '';

const assert = require('assert');
const fs = require('fs');
const store = require('../src/services/reservationStore');

let failures = 0;
let passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

// ---------- 造数：5-8 条不同状态/时间/发起人记录（直接写存储文件，精确控制 createdAt） ----------

function seed(count) {
  const records = [];
  const base = Date.UTC(2026, 10, 1, 8, 0, 0); // 2026-11-01T08:00:00Z 起步
  const ids = ['R20261101-001', 'R20261101-002', 'R20261102-001', 'R20261103-001', 'R20261103-002', 'R20261104-001'];
  const statuses = ['待审批', '排队中', '打印中', '已完成', '已驳回', '已取消'];
  const applicants = ['张三', '李四', '张三', '王五', 'Zhang', '李四'];
  const fileNames = ['bracket_v1.3mf', 'gear.stl', 'GBox.step', 'housing.3mf', 'panel.stl', 'cap.3mf'];
  for (let i = 0; i < Math.min(count, ids.length); i++) {
    records.push({
      id: ids[i],
      createdAt: new Date(base + i * 3600 * 1000).toISOString(), // 逐条 +1h
      updatedAt: new Date(base + i * 3600 * 1000).toISOString(),
      status: statuses[i],
      applicant: applicants[i],
      submittedBy: 'u-seed',
      fileName: fileNames[i],
      filePath: `/tmp/seed-${i}.stl`, // slim DTO 应剔除，测试顺带断言
      fileSize: 1024,
      materialType: 'PETG',
      color: '黑色',
      isUrgent: false,
      quantity: 1,
      estMinutes: null,
      selection: {},
      processParams: null,
      appliedRules: [],
      sourceRecordId: i % 2 === 0 ? 'R20261031-009' : undefined, // 一半带复刻血缘
      spatial: [{ tool: 1, loadType: '静载', loadNature: 'Z', loadMagnitude: 1000, extra: 'secret' }],
      embeddedParams: { estMinutes: 42, filaments: [], machineModel: 'X1C', params: { layer: 0.2, a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7 } },
      history: Array.from({ length: 5 }, (_, j) => ({ at: new Date(base + j).toISOString(), from: null, to: '待审批', note: `n${j}` })),
    });
  }
  fs.writeFileSync(
    process.env.RESERVATIONS_STORE_FILE,
    JSON.stringify({ savedAt: new Date().toISOString(), records }, null, 2)
  );
  return records.length;
}

const SEED_COUNT = seed(6);

// ---------- 分页切片 ----------

check('分页：page=1/pageSize=2 切片 + total=全量条数（6）', () => {
  const r = store.query({ page: 1, pageSize: 2 });
  assert.equal(r.total, SEED_COUNT, 'total 应为过滤后总条数而非页内条数');
  assert.equal(r.records.length, 2);
  assert.equal(r.page, 1);
  assert.equal(r.pageSize, 2);
});

check('分页：翻页不重叠不遗漏（page=2 接 page=1 尾）', () => {
  const p1 = store.query({ page: 1, pageSize: 4 });
  const p2 = store.query({ page: 2, pageSize: 4 });
  const all = [...p1.records.map((r) => r.id), ...p2.records.map((r) => r.id)];
  assert.equal(new Set(all).size, SEED_COUNT, '两页拼起来应恰好 6 条不重复');
});

check('分页：末页不满页（6 条 pageSize=4 → 第 2 页 2 条），total 不变', () => {
  const r = store.query({ page: 2, pageSize: 4 });
  assert.equal(r.records.length, SEED_COUNT - 4);
  assert.equal(r.total, SEED_COUNT);
  assert.equal(r.page, 2);
});

check('分页：超界页码返回空 records 但 total 保持', () => {
  const r = store.query({ page: 99, pageSize: 20 });
  assert.equal(r.records.length, 0);
  assert.equal(r.total, SEED_COUNT, 'total 与页内条数区分');
});

// ---------- 钳制 ----------

check('钳制：page=0 / 负数 / 非数字归 1', () => {
  for (const p of [0, -3, 'abc', null]) {
    const r = store.query({ page: p, pageSize: 2 });
    assert.equal(r.page, 1, `page=${p} 应钳为 1`);
    assert.equal(r.records.length, 2);
  }
});

check('钳制：pageSize 越界（0/负数→1；500→200；小数取整）', () => {
  assert.equal(store.query({ pageSize: 0 }).pageSize, 1);
  assert.equal(store.query({ pageSize: -10 }).pageSize, 1);
  assert.equal(store.query({ pageSize: 500 }).pageSize, 200);
  assert.equal(store.query({ pageSize: 2.9 }).pageSize, 2);
});

check('默认值：不传 page/pageSize → page=1、pageSize=20（全量 ≤20 时全出）', () => {
  const r = store.query({});
  assert.equal(r.page, 1);
  assert.equal(r.pageSize, 20);
  assert.equal(r.records.length, SEED_COUNT);
  assert.equal(r.total, SEED_COUNT);
});

// ---------- status 过滤 ----------

check('status 过滤：命中「打印中」只回该状态；total 同步', () => {
  const r = store.query({ status: '打印中' });
  assert.equal(r.total, 1);
  assert.ok(r.records.every((x) => x.status === '打印中'));
});

check('status 非法值忽略不做过滤（全量返回）', () => {
  const r = store.query({ status: '不存在的状态' });
  assert.equal(r.total, SEED_COUNT);
});

// ---------- q 模糊匹配三字段 ----------

check('q 匹配 id（大小写不敏感）', () => {
  const r = store.query({ q: 'r20261103-001' });
  assert.equal(r.total, 1);
  assert.equal(r.records[0].id, 'R20261103-001');
});

check('q 匹配 applicant（两个「张三」全中）', () => {
  const r = store.query({ q: '张三' });
  assert.equal(r.total, 2);
  assert.ok(r.records.every((x) => x.applicant === '张三'));
});

check('q 匹配 fileName 且大小写不敏感（gbox → GBox.step）', () => {
  const r = store.query({ q: 'gbox' });
  assert.equal(r.total, 1);
  assert.equal(r.records[0].fileName, 'GBox.step');
});

check('q 空串视为未提供（不过滤）', () => {
  const r = store.query({ q: '  ' });
  assert.equal(r.total, SEED_COUNT);
});

check('q 无命中 → 空结果 {records:[],total:0}', () => {
  const r = store.query({ q: '绝对不存在的关键词xyz' });
  assert.deepEqual(r.records, []);
  assert.equal(r.total, 0);
});

// ---------- from / to 时间边界 ----------

const T = (h) => new Date(Date.UTC(2026, 10, 1, 8, 0, 0) + h * 3600 * 1000).toISOString(); // 第 h 条的 createdAt

check('from 含边界：from=第 3 条 createdAt → 第 3 条起全部命中（4 条）', () => {
  const r = store.query({ from: T(2) });
  assert.equal(r.total, 4);
});

check('to 含边界：to=第 3 条 createdAt → 截止第 3 条（3 条）', () => {
  const r = store.query({ to: T(2) });
  assert.equal(r.total, 3);
});

check('from+to 闭区间：含两端（2 条）', () => {
  const r = store.query({ from: T(1), to: T(2) });
  assert.equal(r.total, 2);
});

check('from/to 非法日期忽略该侧条件（等价无过滤）', () => {
  assert.equal(store.query({ from: 'not-a-date' }).total, SEED_COUNT);
  assert.equal(store.query({ to: '' }).total, SEED_COUNT);
  assert.equal(store.query({ from: 'not-a-date', to: T(1) }).total, 2, '一侧非法另一侧仍生效');
});

// ---------- sort 双向 ----------

check('sort 默认 createdAt_desc：最新在前', () => {
  const r = store.query({});
  const ts = r.records.map((x) => new Date(x.createdAt).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
});

check('sort=createdAt_asc：最老在前', () => {
  const r = store.query({ sort: 'createdAt_asc' });
  assert.equal(r.records[0].id, 'R20261101-001');
  const ts = r.records.map((x) => new Date(x.createdAt).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
});

check('sort 非法值按默认 desc', () => {
  const r = store.query({ sort: 'id_asc' });
  const ts = r.records.map((x) => new Date(x.createdAt).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a));
});

// ---------- sourceRecordId 透传 ----------

check('sourceRecordId 字段透传（记录顶层，...r 展开自然带出）', () => {
  const r = store.query({ page: 1, pageSize: 200 });
  const withLineage = r.records.filter((x) => x.sourceRecordId);
  assert.equal(withLineage.length, 3, '造数一半带血缘 → 3 条');
  assert.ok(withLineage.every((x) => x.sourceRecordId === 'R20261031-009'));
});

// ---------- slim 配套字段回归（query 的 records 供列表 DTO 消费，顺带守住） ----------

check('query 记录含 filePath 原始字段（裁剪是路由 slimReservation 职责，存储层不动）', () => {
  const r = store.query({ page: 1, pageSize: 200 });
  assert.ok(r.records.every((x) => typeof x.filePath === 'string'));
});

// ---------- express 多值数组参数（verifier P1：q=a&q=b 会成数组，typeof 守卫会静默降级）----------
// 路由层 normalizeQueryValue 已归一为末值——store.query 直接收标量；这里测 store 层
// 收到数组时的行为（防御纵深：即使路由层漏归一，store 也应可预期地降级而非误过滤）

check('数组参数防御：q 传数组不误过滤（视为未提供，全量返回）', () => {
  const r = store.query({ q: ['张三', '李四'] });
  assert.equal(r.total, SEED_COUNT, 'q 数组应静默忽略而非误过滤');
});

check('数组参数防御：status 传数组不过滤（全量返回）', () => {
  const r = store.query({ status: ['打印中'] });
  assert.equal(r.total, SEED_COUNT, 'status 数组应静默忽略而非误过滤');
});

check('数组参数防御：page/pageSize 数组按 JS 转换规则钳制（不炸）', () => {
  // JS 怪癖：Number(['2'])（单元素数组）=== 2（toString 后转换），多元素才是 NaN。
  // 路由层 normalizeQueryValue 归一后 store 永远收标量；本用例锚定 store 直收数组
  // 的行为可预期（钳制范围内、不炸不越界），防未来重构引入抛错路径
  const r1 = store.query({ page: ['2'], pageSize: ['50'] });
  assert.equal(r1.page, 2, '单元素数组 ["2"] Number 化 = 2（JS toString 转换怪癖）');
  assert.equal(r1.pageSize, 50);
  const r2 = store.query({ page: ['2', '3'], pageSize: ['50', '60'] });
  assert.equal(r2.page, 1, '多元素数组 Number()=NaN → 归 1');
  assert.equal(r2.pageSize, 20, '多元素数组 Number()=NaN → 默认 20');
  const r3 = store.query({ page: ['0'], pageSize: ['999'] });
  assert.equal(r3.page, 1, 'page<1 钳 1');
  assert.equal(r3.pageSize, 200, 'pageSize 越界钳 200');
});

check('数组参数防御：sort 传数组按默认 desc（不炸）', () => {
  const r = store.query({ sort: ['createdAt_asc'] });
  const ts = r.records.map((x) => new Date(x.createdAt).getTime());
  assert.deepEqual(ts, [...ts].sort((a, b) => b - a), 'sort 数组不等合法值 → 默认 desc');
});

// ---------- 比较器 NaN 兜底（2026-11-05 P2 审查） ----------

check('排序防御：createdAt 非法记录不炸、NaN 比较器兜 0（双向均不崩）', () => {
  // 混入两条 createdAt 非法记录（脏数据/手写存储）：旧比较器 NaN 进 sort 语义未定义
  const raw = JSON.parse(fs.readFileSync(process.env.RESERVATIONS_STORE_FILE, 'utf8'));
  const bad = (id) => ({ ...raw.records[0], id, createdAt: 'not-a-date', history: [] });
  raw.records.push(bad('R-BAD-1'), bad('R-BAD-2'));
  fs.writeFileSync(process.env.RESERVATIONS_STORE_FILE, JSON.stringify(raw, null, 2));
  try {
    for (const sort of ['createdAt_asc', 'createdAt_desc', undefined]) {
      const r = store.query({ page: 1, pageSize: 200, ...(sort ? { sort } : {}) });
      assert.equal(r.total, SEED_COUNT + 2, `sort=${sort}：脏记录仍在 total（不过滤，与 from/to 语义区分）`);
      assert.equal(r.records.length, SEED_COUNT + 2, '全部记录可分页返回');
      assert.ok(r.records.some((x) => x.id === 'R-BAD-1'), '非法 createdAt 记录在结果中（兜 0 排序，不炸不丢）');
    }
    // 有序记录之间的相对顺序仍正确（脏记录兜 0 排最老端，不扰乱合法段排序）
    const asc = store.query({ sort: 'createdAt_asc', page: 1, pageSize: 200 }).records.map((x) => x.createdAt);
    const legal = asc.filter((t) => !Number.isNaN(new Date(t).getTime()));
    assert.deepEqual(legal, [...legal].sort(), '合法记录升序保持');
  } finally {
    fs.writeFileSync(process.env.RESERVATIONS_STORE_FILE, JSON.stringify(raw.records.slice(0, SEED_COUNT).map((x) => x), null, 2));
    // 恢复为标准 seed 形态（外层 {savedAt, records}）
    fs.writeFileSync(process.env.RESERVATIONS_STORE_FILE, JSON.stringify({ savedAt: new Date().toISOString(), records: raw.records.slice(0, SEED_COUNT) }, null, 2));
  }
});

// ---------- 收尾 ----------

console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
try { fs.unlinkSync(process.env.RESERVATIONS_STORE_FILE); } catch { /* 无则跳过 */ }
process.exit(failures === 0 ? 0 : 1);
