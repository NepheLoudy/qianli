// ============================================================
// 数据面备份（2026-10-06 流程债清偿：五类数据全在小电脑单机单副本）
//
// 每日快照三类 JSON（预约/账号/规则）到 BACKUP_DIR（默认数据目录同盘
// backup/ 子目录），保留最近 BACKUP_KEEP_DAYS 天（默认 14）；启动即备一份保底。
// uploads 源文件目录不备份（体积大且可由队员重传）——README 记录此边界。
// 2026-11-05 P2 审查：移除 rule-suggestions.json 备份项——待审池 v84 已退役
// （服务本体仅备份/测试在引用，生产路由已删；ruleSuggestions.js 文件本体保留）。
// 失败仅 warn，绝不影响主链路。
// ============================================================

const fs = require('fs');
const path = require('path');
const reservationStore = require('./reservationStore');

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(path.dirname(reservationStore.STORE_FILE), 'backup');
const KEEP_DAYS = Number(process.env.BACKUP_KEEP_DAYS || 14);

/** 三类 JSON 源文件路径（authStore/processRules 的 AUTH_FILE 惰性取,避免循环依赖） */
function sourceFiles() {
  return {
    'reservations.json': reservationStore.STORE_FILE,
    'auth-users.json': require('./authStore').AUTH_FILE,
    'process-rules.json': require('./processRules').getRulesSnapshot().rulesFile,
    // rule-suggestions.json 不再备份：待审池已退役（v84），ruleSuggestions 服务保留但无生产写入
  };
}

function runBackup(now = new Date()) {
  const result = { copied: [], skipped: [], dir: BACKUP_DIR };
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = now.toISOString().slice(0, 10); // 按天一份（同日覆盖）
    for (const [name, src] of Object.entries(sourceFiles())) {
      try {
        if (!fs.existsSync(src)) { result.skipped.push(name); continue; }
        fs.copyFileSync(src, path.join(BACKUP_DIR, `${stamp}-${name}`));
        result.copied.push(name);
      } catch (err) {
        result.skipped.push(`${name}(${err.message})`);
      }
    }
    // 轮转：删除超过保留期的日期快照
    const cutoff = Date.now() - KEEP_DAYS * 24 * 3600 * 1000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      const m = /^(\d{4}-\d{2}-\d{2})-/.exec(f);
      if (m && new Date(`${m[1]}T00:00:00Z`).getTime() < cutoff) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch { /* 竞争删除忽略 */ }
      }
    }
    if (result.copied.length > 0) {
      console.log(`[备份] 快照完成 ${stamp}: ${result.copied.join(', ')}${result.skipped.length ? `（跳过 ${result.skipped.length}）` : ''}`);
    }
  } catch (err) {
    console.warn('[备份] 备份失败（不影响主链路）:', err.message);
  }
  return result;
}

let timer = null;
let lastRun = null; // health 露出用
/** 启动即备一份（保底），此后每 24h 一轮 */
function scheduleBackup() {
  if (timer) return;
  lastRun = runBackup();
  timer = setInterval(() => { lastRun = runBackup(); }, 24 * 3600 * 1000);
  console.log(`[备份] 每日快照已启用 → ${BACKUP_DIR}（保留 ${KEEP_DAYS} 天）`);
}

function getLastRun() { return lastRun; }

module.exports = { runBackup, scheduleBackup, getLastRun, BACKUP_DIR, KEEP_DAYS, _sourceFiles: sourceFiles };
