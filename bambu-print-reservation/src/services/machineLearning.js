'use strict';

/**
 * 机型/耗材选择学习器（v85 · 曼波令「机型和耗材选择的学习架构也完成」）：
 * 自动分发开启后，切片直通单的机型路由与耗材槽位选择从「硬规则」升级为「历史统计学习」。
 *
 * 机型选择（chooseMachineForSliced）：
 *   输入：内嵌机型串（P2S 等）+ 同品牌候选机列表 + 预约历史
 *   信号：①同型号优先（modelMatch）②各机历史成功/失败率（outcome 统计）
 *         ③最近使用时间（冷机回避：久未用的机器料位数据可能过期）
 *   输出：选中的打印机名 + 依据说明（可审计）；无同型号按品牌族降级（v65 口径）
 *
 * 耗材选择（chooseTrayForTask）：
 *   输入：任务所需耗材（类型/颜色）+ 候选机 AMS 料位 + 该机历史槽位使用统计
 *   信号：①类型 exact>family ②颜色 redmean 近似 ③同分时优先「历史上成功率高的槽位」
 *         ④余量高的槽（避免半途断料）
 *   输出：槽位号 + 依据；无可用槽返回 null（调用方走缺料路径）
 *
 * 学习信号全部来自已有数据（预约单 outcome / 分发完成记录），不引入新存储——
 * 统计函数纯读 reservationStore，天然随数据增长而「更准」。
 */

const { modelMatch } = require('../utils/printerModelKey');

/** 打印机历史统计：成功/失败/最近使用（从预约单轨迹聚合）。
 *  v88 审查修复（P1）：失败统计改扫 history 全量备注命中真实失败语义——
 *  「打印失败重排」「分发失败回滚」都落「排队中」而非已取消，旧口径 fail 恒 0。 */
const FAILURE_NOTE_RE = /打印失败重排|分发失败|失败重排|转人工|断料/;
function machineStats(records, printerName) {
  let ok = 0, fail = 0, lastAt = 0;
  for (const r of records) {
    if (r.printer !== printerName) continue;
    if (r.status === '已完成') { ok++; const t = Date.parse(r.updatedAt || r.createdAt || '') || 0; if (t > lastAt) lastAt = t; }
    // 失败 = history 里有真实失败语义的备注（failTask 回滚/分发失败），非用户取消
    const notes = (r.history || []).map((h) => h.note || '').join(';');
    if (FAILURE_NOTE_RE.test(notes)) fail++;
  }
  return { ok, fail, lastAt, successRate: ok + fail > 0 ? ok / (ok + fail) : null };
}

/**
 * 切片直通件机型选择（v85）。
 * @param {string} machineModel 内嵌机型串（Bambu Lab P2S 等）
 * @param {Array} candidates 候选打印机（已过品牌/空闲/回执闸过滤，元素含 name/model/status）
 * @param {Array} records 预约单全量（outcome 统计源）
 * @returns {{name:string, basis:string, lowConfidence:boolean}|null} null=无可选
 */
function chooseMachineForSliced(machineModel, candidates, records) {
  if (!candidates || !candidates.length) return null;
  // ① 同型号优先（热修63 归一口径）
  const same = candidates.filter((p) => modelMatch(machineModel, p.model));
  if (same.length) {
    // 同型号多台：按历史成功率 + 最近使用排序
    const ranked = same.map((p) => ({ p, st: machineStats(records, p.name) }))
      .sort((a, b) => (b.st.successRate ?? 0.5) - (a.st.successRate ?? 0.5) || b.st.lastAt - a.st.lastAt);
    const top = ranked[0];
    const basis = ranked.length === 1
      ? `同型号机（${machineModel}）唯一`
      : `同型号 ${ranked.length} 台中按历史成功率${top.st.successRate != null ? `（${Math.round(top.st.successRate * 100)}%）` : ''}择优`;
    return { name: top.p.name, basis, lowConfidence: false };
  }
  // ② 无同型号：品牌族降级（v65 口径）——选历史成功率最高的同品牌机
  const { modelBrand } = require('../utils/printerModelKey');
  const brand = modelBrand(machineModel);
  const brandMachines = candidates.filter((p) => modelBrand(p.model) === brand);
  if (!brandMachines.length) return null;
  const ranked = brandMachines.map((p) => ({ p, st: machineStats(records, p.name) }))
    .sort((a, b) => (b.st.successRate ?? 0.5) - (a.st.successRate ?? 0.5) || b.st.lastAt - a.st.lastAt);
  const top = ranked[0];
  return {
    name: top.p.name,
    basis: `机型「${machineModel}」不在机队——按同品牌兼容降级到 ${top.p.name}（历史成功率${top.st.successRate != null ? ` ${Math.round(top.st.successRate * 100)}%` : ' 无记录'}）`,
    lowConfidence: true, // 跨机型 = 打印幅面/喷嘴可能有差，审批台标警示
  };
}

/** 颜色距离（redmean 简化版——与 dispatcher 同口径的近似；hex → rgb） */
function hex2rgb(hex) {
  const h = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function colorDist(a, b) {
  const ra = hex2rgb(a), rb = hex2rgb(b);
  if (!ra || !rb) return Infinity;
  const rm = (ra[0] + rb[0]) / 2;
  const dr = ra[0] - rb[0], dg = ra[1] - rb[1], db = ra[2] - rb[2];
  return Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db);
}

/**
 * 耗材槽位选择（v85）。
 * @param {Object} task { materialType, color }
 * @param {Array} trays 候选机 AMS 料位 [{slot, type, colorHex, remain, active}]
 * @param {Object} slotStats 槽位历史 {slotKey: {ok, fail}}（从预约记录聚合，可空）
 * @returns {{slot, basis}|null} null=无可用槽（缺料路径）
 */
function chooseTrayForTask(task, trays, slotStats = {}) {
  const want = String(task.materialType || '').trim().toUpperCase();
  if (!want || !Array.isArray(trays)) return null;
  const familyOf = (a, b) => {
    const x = String(a || '').trim().toUpperCase(), y = String(b || '').trim().toUpperCase();
    if (!x || !y) return false;
    if (x === y) return 'exact';
    if (y.startsWith(x + '-') || x.startsWith(y + '-')) return 'family';
    return false;
  };
  const cands = trays.filter((t) => t.type && Number(t.remain ?? 1) > 5); // 余量 ≤5% 的槽不选（防半途断料）
  if (!cands.length) return null;
  const scored = cands.map((t) => {
    const level = familyOf(want, t.type);
    if (!level) return null;
    // 颜色：任务带颜色才判（色差 > 阈值当 family 降级处理，不硬排除）
    // 颜色：色名与 hex 都可能传入——hex2rgb 吃到色名返回 null → 色差 0（不惩罚），
    // 与分发匹配层的「无颜色=不判色」语义一致；色名↔hex 精确映射待颜色字典统一后接
    const cd = task.color ? colorDist(String(task.color || '').replace('#', '').slice(0, 6), t.colorHex) : 0;
    const st = slotStats[`${t.slot}`] || { ok: 0, fail: 0 };
    const successRate = st.ok + st.fail > 0 ? st.ok / (st.ok + st.fail) : 0.5;
    const remain = Math.min(100, Number(t.remain) || 50) / 100;
    // 综合分：匹配级别（exact 1.0 / family 0.6）+ 色差惩罚 + 槽位历史 + 余量
    const score = (level === 'exact' ? 1 : 0.6)
      - Math.min(0.3, cd / 1000)
      + successRate * 0.2
      + remain * 0.15
      + (t.active ? 0.05 : 0);
    return { t, level, score, cd };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
  if (!scored.length) return null;
  const top = scored[0];
  const basis = `${top.level === 'exact' ? '精确匹配' : '家族匹配'} ${top.t.type}｜余 ${Math.round(top.t.remain)}%${top.cd ? `｜色差 ${Math.round(top.cd)}` : ''}`;
  return { slot: top.t.slot, basis };
}

/** 从预约单聚合各机槽位使用统计（成功/失败）——chooseTrayForTask 的学习信号源。
 *  v88 审查修复（P1）：遍历 dispatch.trays（多耗材主路径）+ dispatch.tray（旧单槽）双形态；
 *  task.colorHex 不存在（buildLocalTask 只有色名）——槽位统计不依赖色值。 */
function slotStatsFromRecords(records, printerName) {
  const stats = {};
  for (const r of records) {
    if (r.printer !== printerName) continue;
    const dispatch = (r.review && r.review.dispatch) || {};
    const slots = [];
    if (Array.isArray(dispatch.trays)) dispatch.trays.forEach((t) => { if (t && t.slot != null) slots.push(t.slot); });
    else if (dispatch.tray && dispatch.tray.slot != null) slots.push(dispatch.tray.slot);
    const failNote = FAILURE_NOTE_RE.test((r.history || []).map((h) => h.note || '').join(';'));
    for (const slot of slots) {
      const key = String(slot);
      const cur = stats[key] || { ok: 0, fail: 0 };
      if (r.status === '已完成') cur.ok++;
      else if (failNote || r.status === '已取消') cur.fail++;
      stats[key] = cur;
    }
  }
  return stats;
}

module.exports = { chooseMachineForSliced, chooseTrayForTask, machineStats, slotStatsFromRecords, colorDist };
