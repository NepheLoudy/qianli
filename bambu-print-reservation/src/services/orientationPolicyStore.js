// ============================================================
// 摆向策略工件存储（2026-10-19）
//
// 学习产物与规则库同源治理：拟合只写 candidate，人工采纳后 status=adopted，
// autoSlice 只使用 adopted 的策略；没有 adopted 就回退冷启动启发式。
// 文件放项目外数据目录（ORIENTATION_POLICY_FILE），部署清目录不丢。
// ============================================================

const fs = require('fs');
const path = require('path');

const FILE = process.env.ORIENTATION_POLICY_FILE || path.join(__dirname, '..', '..', '.orientation-policy.json');

function load() {
  try {
    if (!fs.existsSync(FILE)) return null;
    const data = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    if (!data || !data.policy || typeof data.policy !== 'object') return null;
    return data;
  } catch (err) {
    // 损坏隔离：坏文件留档，避免下一次写入覆盖（对齐 reservationStore/authStore 口径）
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    try { fs.renameSync(FILE, `${FILE}.corrupt-${stamp}`); } catch { /* 留在原地 */ }
    console.warn(`[摆向策略] 策略文件损坏已隔离（${err.message}），回退冷启动`);
    return null;
  }
}

function save(data) {
  const tmp = FILE + '.tmp';
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify({ savedAt: new Date().toISOString(), ...data }, null, 2));
  fs.renameSync(tmp, FILE);
  return data;
}

function saveCandidate(policy, stats) {
  return save({ status: 'candidate', policy, stats: stats || null });
}

function adopt() {
  const data = load();
  if (!data) throw new Error('没有待采纳的摆向策略（先运行拟合）');
  data.status = 'adopted';
  data.adoptedAt = new Date().toISOString();
  save(data);
  return data;
}

function getSnapshot() {
  return load();
}

/** 仅采纳后的策略参与切片；candidate 不生效 */
function getActive() {
  const data = load();
  return data && data.status === 'adopted' ? data.policy : null;
}

module.exports = { FILE, load, saveCandidate, adopt, getSnapshot, getActive };
