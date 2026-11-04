/**
 * 复刻（reprint）血缘标记单测（2026-11-04 任务卡 B：审批台全量单据管理批）
 * 用法：node test/reprint-lineage-test.js
 * 隔离照 test/local-reservation-test.js：所有 env 必须在 require 之前设置（模块
 * 顶层读 env）；本文件**只 require reservation.js**——它对 dispatcher/manager 全是
 * 惰性 require，reprint 链路只碰 store/fs/processRules，不拉起打印机连接。
 * QUIET_HOURS_DISABLED=1 防止凌晨跑测试触发静默积压落盘。
 */
const os = require('os');
const path = require('path');
process.env.PROCESS_RULES_FILE = path.join(os.tmpdir(), `bambu-test-reprint-rules-${process.pid}.json`);
process.env.RESERVATIONS_STORE_FILE = path.join(os.tmpdir(), `bambu-test-reprint-res-${process.pid}.json`);
process.env.RESERVATIONS_UPLOAD_DIR = path.join(os.tmpdir(), `bambu-test-reprint-up-${process.pid}`);
process.env.QUIET_BACKLOG_FILE = path.join(os.tmpdir(), `bambu-test-reprint-quiet-${process.pid}.json`);
process.env.QUIET_HOURS_DISABLED = '1';

const assert = require('assert');
const fs = require('fs');
const store = require('../src/services/reservationStore');
const reservationService = require('../src/services/reservation');

let failures = 0;
let passed = 0;
const pending = [];
// 同步用例立即判；async 用例进 pending，末尾 Promise.all 收齐再总结——
// 异步 rejection 必须计为失败，不得变成 unhandledRejection 假绿
function check(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      pending.push(
        r.then(
          () => { passed++; console.log(`✓ ${name}`); },
          (err) => { failures++; console.error(`✗ ${name} — ${err.message}`); }
        )
      );
    } else {
      passed++;
      console.log(`✓ ${name}`);
    }
  } catch (err) {
    failures++;
    console.error(`✗ ${name} — ${err.message}`);
  }
}

/** 组装一份合法提交（3mf 直通，无需规则定档），返回记录 */
function submit(overrides = {}) {
  return store.create({
    applicant: '血缘测试员',
    fileName: 'lineage.3mf',
    filePath: 'unused',
    fileSize: 1024,
    materialType: 'PETG',
    color: '黑色',
    selection: {},
    processParams: null,
    appliedRules: [],
    ...overrides,
  });
}

/** 造一条已完成源单（带真实临时源文件，复刻要复制它） */
function completedSource(fileName, selection = {}) {
  const srcFile = path.join(os.tmpdir(), `bambu-lineage-src-${process.pid}-${Math.random().toString(36).slice(2, 8)}${path.extname(fileName)}`);
  fs.writeFileSync(srcFile, 'fake-content');
  const rec = submit({ fileName, filePath: srcFile, selection });
  for (const s of ['已通过', '排队中', '打印中', '已完成']) store.updateStatus(rec.id, s, 't');
  return { rec, srcFile };
}

check('reprint 血缘:新单 sourceRecordId === 源单 id,文件独立副本', async () => {
  const { rec, srcFile } = completedSource('origin.3mf');
  const copy = await reservationService.reprintReservation(rec.id, { id: 'u-x', displayName: '复刻人' }, {});
  assert.equal(copy.sourceRecordId, rec.id, '新单应携带 sourceRecordId（store 侧透传或返回值兜底）');
  assert.notEqual(copy.id, rec.id, '复刻应生成新单号');
  assert.notEqual(copy.filePath, srcFile, '复刻单应持有独立文件副本');
  assert.ok(fs.existsSync(copy.filePath), '文件副本应存在');
  assert.equal(copy.applicant, '复刻人', '发起人=当前登录者');
  // 持久化层断言（verifier P1-3，2026-11-04）：真持久化只认 store.get——若 store.create
  // 白名单（sourceRecordId 透传）未来被误删，返回值兜底会掩盖持久化缺失，此断言守住回归点
  assert.equal(store.get(copy.id).sourceRecordId, rec.id, '复刻单存储内应持久化 sourceRecordId（create 白名单透传）');
  // 返回值是浅拷贝副本——改它不得写回存储（缓存污染防护）
  copy.sourceRecordId = 'tampered';
  assert.notEqual(store.get(copy.id).sourceRecordId, 'tampered', '改返回值不应影响存储内记录');
  try { fs.unlinkSync(copy.filePath); } catch { /* 收尾 */ }
  try { fs.unlinkSync(srcFile); } catch { /* 收尾 */ }
});

check('reprint 血缘:血缘指向语义（复刻单的复刻仍指向其源单）', async () => {
  // 链式复刻：B 复刻自 A → B.sourceRecordId=A；C 复刻自 B → C.sourceRecordId=B
  // 血缘语义=「复刻自哪单」，指向直接源（不做祖先追溯）
  const { rec: a, srcFile: srcA } = completedSource('chain-a.3mf');
  const b = await reservationService.reprintReservation(a.id, { id: 'u-x', displayName: 'B' }, {});
  const c = await reservationService.reprintReservation(b.id, { id: 'u-x', displayName: 'C' }, {});
  assert.equal(b.sourceRecordId, a.id, 'B 的血缘应指向 A');
  assert.equal(c.sourceRecordId, b.id, 'C 的血缘应指向 B（直接源，非祖先）');
  for (const f of [b.filePath, c.filePath, srcA]) {
    try { fs.unlinkSync(f); } catch { /* 收尾 */ }
  }
});

check('reprint 血缘:源单 history 轨迹（appendHistory 若落地则含「被复刻」note）', async () => {
  const { rec, srcFile } = completedSource('history.3mf');
  const before = store.get(rec.id).history.length;
  const copy = await reservationService.reprintReservation(rec.id, { id: 'u-x', displayName: '复刻人' }, {});
  const srcAfter = store.get(rec.id);
  // store.appendHistory 合并落地（补丁②）前：reservation.js 侧已防御式调用，store 未
  // 支持时静默跳过——本用例在「落地后」断言 note 落档，「落地前」只断言不炸不丢
  if (typeof store.appendHistory === 'function') {
    assert.ok(srcAfter.history.length > before, '源单 history 应追加一条');
    const last = srcAfter.history[srcAfter.history.length - 1];
    assert.ok(
      /被复刻为新单/.test(last.note) && last.note.includes(copy.id),
      `末条轨迹应为「被复刻为新单 ${copy.id}」，实际: ${last.note}`
    );
    assert.equal(last.from, srcAfter.status, 'from=源单当前状态');
    assert.equal(last.to, srcAfter.status, 'to=源单当前状态（状态不变）');
  } else {
    assert.equal(srcAfter.history.length, before, 'store 未支持 appendHistory 时源单轨迹不动（静默跳过）');
    console.log('  （store.appendHistory 未落地——按补丁②合并后本用例升级为全断言）');
  }
  try { fs.unlinkSync(copy.filePath); } catch { /* 收尾 */ }
  try { fs.unlinkSync(srcFile); } catch { /* 收尾 */ }
});

check('reprint 血缘:分字段隔离——源单自身不带 sourceRecordId', async () => {
  // 普通提交的单（含被复刻过的源单）存储内不带 sourceRecordId：血缘只写新单，
  // 防 store 侧补丁①前「返回值兜底」被误当持久化（真持久化只认 store.get）
  const { rec, srcFile } = completedSource('iso.3mf');
  const copy = await reservationService.reprintReservation(rec.id, { id: 'u-x', displayName: '复刻人' }, {});
  assert.equal(store.get(rec.id).sourceRecordId ?? null, null, '源单存储内不应带 sourceRecordId');
  try { fs.unlinkSync(copy.filePath); } catch { /* 收尾 */ }
  try { fs.unlinkSync(srcFile); } catch { /* 收尾 */ }
});

// ---------- 收尾：异步用例全部落定后清理与总结 ----------
// appendHistory 契约预演必须串行在全部用例落定之后跑：它 monkey-patch 共享 store
// 单例，与并发在飞的其它 async 用例互踩（其它用例的 reprint 恢复执行时也会调到
// 补丁方法，calls 被污染）——等 Promise.all 收齐再打补丁，跑完即还原
Promise.all(pending).then(() => {
  check('reprint 血缘:appendHistory 契约预演（monkey-patch 模拟 store 补丁②落地形态）', async () => {
    // reservation.js 对 store.appendHistory 防御式探测——本用例模拟合并补丁②落地后
    // store 提供的方法形态，验证调用侧契约（id + note 含新单号）正确
    const calls = [];
    store.appendHistory = (id, note) => {
      calls.push({ id, note });
      const records = store.list();
      const record = records.find((r) => r.id === id);
      if (!record) throw new Error(`预约不存在: ${id}`);
      const at = new Date().toISOString();
      record.history.push({ at, from: record.status, to: record.status, note });
      record.updatedAt = at;
      return record;
    };
    try {
      const { rec, srcFile } = completedSource('patched.3mf');
      const copy = await reservationService.reprintReservation(rec.id, { id: 'u-x', displayName: '复刻人' }, {});
      assert.equal(calls.length, 1, '复刻成功应恰好调用一次 appendHistory');
      assert.equal(calls[0].id, rec.id, '应记在源单上');
      assert.ok(calls[0].note.includes(copy.id), `note 应含新单号（实际: ${calls[0].note}）`);
      const srcAfter = store.get(rec.id);
      const last = srcAfter.history[srcAfter.history.length - 1];
      assert.ok(/被复刻为新单/.test(last.note), '源单末条轨迹应含「被复刻」note');
      assert.equal(last.from, '已完成', 'from=源单当前状态');
      assert.equal(last.to, '已完成', 'to=源单当前状态（状态不变）');
      try { fs.unlinkSync(copy.filePath); } catch { /* 收尾 */ }
      try { fs.unlinkSync(srcFile); } catch { /* 收尾 */ }
    } finally {
      delete store.appendHistory; // 还原
    }
  });

  check('reprint 血缘:REPRINT_ALLOWED_STATUSES 端点权限契约（与前端显隐对齐，v91 cross-check B3）', () => {
    // 路由层常量：只有终态单可复刻——锚死 index.js 的 REPRINT_ALLOWED_STATUSES 与
    // 前端 canReprint（approve.html 已完成/已取消）两处清单不漂移
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const m = indexSrc.match(/const REPRINT_ALLOWED_STATUSES = (\[[^\]]+\])/);
    assert.ok(m, 'index.js 应声明 REPRINT_ALLOWED_STATUSES 常量');
    const allowed = eval(m[1]); // 测试内受控 eval：常量是字面量数组
    assert.deepEqual(allowed.sort(), ['已取消', '已完成'], '后端可复刻状态=已完成/已取消（与前端显隐一致）');
    assert.ok(indexSrc.includes('assertCanManage(req.user, srcRecord)'), 'reprint 路由应挂 assertCanManage（本人||reviewer）');
  });

  check('reprint 血缘:复刻链路接入自动分发（与提交链同款语义，v91 续曼波反馈）', () => {
    // 静态契约锚：reprint 路由在 config.dispatch.autoDispatch 开启时必须走
    // approveReservation(…, { auto: true })——v88 P0 教训：漏传 auto 会触发切片闸
    // 「仅对模型直投有效」静默回退人工；且人工模式分支才 notifyReviewers（自动模式不催审批人）
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
    const routeIdx = indexSrc.indexOf("app.post('/api/reservations/:id/reprint'");
    assert.ok(routeIdx > 0, 'reprint 路由应存在');
    const routeBody = indexSrc.slice(routeIdx, indexSrc.indexOf("app.post('/api/reservations/:id/cancel'"));
    assert.ok(/config\.dispatch\.autoDispatch/.test(routeBody), 'reprint 路由应判 autoDispatch 开关');
    assert.ok(/approveReservation\([\s\S]*?\{\s*auto:\s*true\s*\}/.test(routeBody), '自动通过必须传 { auto: true }（切片闸豁免+机型学习信号，v88 P0）');
    assert.ok(/setImmediate/.test(routeBody), '自动通过应 setImmediate 异步执行（响应不被审批链阻塞）');
    // notifyReviewers 合法出现位：①catch 内（自动通过失败转人工的兜底通知）②else 人工分支；
    // 非法位：紧跟 reprintReservation 的无条件 fire-and-forget（自动模式下催审批人=打扰）
    const afterReprint = routeBody.indexOf('reprintReservation');
    const firstNotify = routeBody.indexOf('notifyReviewers');
    assert.ok(firstNotify > afterReprint + routeBody.slice(afterReprint).indexOf('if (config.dispatch.autoDispatch)'), 'reprintReservation 之后应先判 autoDispatch 分支，不再无条件 notifyReviewers');
    assert.ok(/catch[\s\S]*?notifyReviewers[\s\S]*?\} else \{\s*reservationService\.notifyReviewers/.test(routeBody), 'notifyReviewers 应只在 catch 转人工兜底与 else 人工分支出现');
  });
  return Promise.all(pending);
}).then(() => {
  for (const f of [process.env.RESERVATIONS_STORE_FILE, process.env.QUIET_BACKLOG_FILE]) {
    try { fs.unlinkSync(f); } catch { /* 无则跳过 */ }
  }
  console.log(failures === 0 ? `\n全部通过（${passed} 项）` : `\n${failures} 项失败`);
  process.exit(failures === 0 ? 0 : 1);
});
