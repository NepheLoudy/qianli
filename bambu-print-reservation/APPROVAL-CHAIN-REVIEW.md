# 打印预约链路审查报告（v56 批，2026-10-15）

> 审查范围：页面提交 → 审批 → 入队 → 分发 → 打印 → 完成/失败/取消全链（reservation.js / dispatcher.js / reservationStore.js / index.js / auth / chatService）。
> 行号以 v56 批前工作区代码为准；标注 ✅ 已修 的条目随 v56 落地。
> 结论摘要：链路架构（本地存储 + 同进程直调 dispatcher + 事件驱动匹配）是健康的；风险集中在**审批关键路径上的 await 窗口**、**storeSafe 全量吞错造成的静默背离**、**鉴权面偏松**三块。

## 🔴 高危（可致资损/危险动作）

### 1. 审批↔取消竞态——已取消单真机开打 ✅ 已修（v56）
`reservation.js` approveReservation 原 in `await notifyReviewResult()`（webhook HTTP 调用，超时 15s）横在「已通过落库」与「入队」之间：窗口内用户 cancel 合法完成 已通过→已取消，恢复执行后照常 enqueue → `updateStatus(排队中)` 抛非法流转（已取消→排队中）→ 审批人拿到 400 但任务已进队列，最终真机开打一张已取消的单。
**修法（v56 已落地）**：入队关键路径内清空 await（JS 单线程无窗口），群播移到入队之后 fire-and-forget。

### 2. 打印中取消的停机失败静默吞掉 ✅ 已修（v56）
`dispatcher.js` dequeue 里 `stopPrintOnPrinter(...).catch(() => {})`——停机指令失败无人知晓，机器继续打已取消单。
**修法（v56 已落地）**：失败重试一次（3s），仍失败走 `announce()` 群播人工介入卡（过静默闸）。

### 3. enqueue 幂等命中后单据滞留「已通过」 ✅ 已修（v56）
`reservation.js` `enqueued=false`（known/queue 命中）时无任何处理，单据停在已通过且无提示。
**修法（v56 已落地）**：显式抛错回审批端点（400「任务已在分发队列中」）。

### 4. `POST /api/chat/command` 完全无鉴权
`index.js:1128`（`auth.js:7` 注释明确豁免）。当前命令表只读（5 个查看指令），但入口是通用 `executeCommand` 透传——新增任何写指令即成无鉴权写面。**建议**：与 hub /print-* 转发同批加共享 X-API-Token（单边加锁会断产线，需两仓同批，v54 起挂待办）。

### 5. 共享 API_TOKEN = 全能 admin
一个全工作区共用 token 可审批/分发/动打印机/改规则（`auth.js:50-53`）。token 已随 v38 网关批进过多仓 .env，轮换成本高；**建议**：至少把「打印机控制类端点」拆独立 token（DEPLOY_* 同级的 per-项目键）。

## 🟠 中危（状态一致性/审计）

### 6. storeSafe 全量吞错 ✅ 部分缓解（v56 停机重试+播报）
分发链所有本地状态回写失败仅打日志（`dispatcher.js` storeSafe；调用点 7 处）——记录状态与引擎实态可长期背离（如停「排队中」实为打印中）。**建议**：至少对「写打印中/写终态」两处失败加重试与告警卡；长期可加引擎实态 vs 商店态的对账巡检。

### 7. 重启恢复 inFlight 整链重发
`dispatcher.js:296-306`（v56 前行号）——重启后 inFlight 重发，若打印机已实际开打会覆盖在打任务。**建议**：恢复时先 probe 打印机当前 gcodeState/文件名，命中同一 recordId 则只登记不重发。

### 8. updateStatus 与 setReview 两次独立落盘
`reservation.js`（原 :100-101）中间崩溃则「已通过」无审批记录。**建议**：合并为单次原子写。

### 9. PUT 直改状态绕过审批语义
admin `PUT /api/reservations/:id` 泛用分支可把单直写「已完成」等（从未打印），不写 review、不发结果卡（`index.js:732`）。**建议**：收窄可直写的目标状态集，或直写也走 review 轨迹。

### 10. 审批人身份记 displayName（非唯一键）
`index.js:759,771` —— 审计轨迹弱（同名互认）。**建议**：记录 user.id + displayName 双字段。

### 11. 复刻无属主校验
任何 member 可复刻任何人的已完成单到自己名下（`reservation.js:164`）——「帮同学打同款」设计如此，但事实是无门槛克隆他人文件与参数。**建议**：加「属主或 reviewer」开关（曼波定口径）。

### 12. 审批关键路径 await 外部 webhook（竞态根因的另一半）
notifyReviewers/notifyReviewResult 虽内部 try/catch，但 webhook 本身超时 15s（`bot.js:52`）——提交端点也 await 它（`index.js:703` 是 fire-and-forget ✅，approve 已修 ✅；reject 仍 await，`reservation.js:122`——驳回无入队风险，仅体验问题，降中危）。

## 🟡 低危（信息面/健壮性/文案）

13. 无鉴权只读端点泄露内部信息：`/api/health`（存储大小/打印机数/静默状态）、`/api/print/policy`（机队/队列/配置全景）、`/api/print/taxonomy`、`/api/print/colors`、`/api/print/process-rules` GET 全量规则库——内网可接受，公网暴露前必须收紧。
14. 会话 cookie 无 Secure 标志 + `cors()` 全开（`index.js:115-116,29`）。
15. 任意 member 可见全部单据全字段，含服务端 `filePath` 绝对路径（`index.js:569-577`）——建议输出前剔除路径键。
16. `/api/auth/login` 无速率限制（authStore 内有 5 次锁 10 分钟，但按用户名计——攻击者换名无限试）。
17. GET 读接口改状态：`getQueueSnapshot()` 调 `sortQueue` 补 `enqueuedAt`（读路径副作用，无害违直觉）。
18. **闪铸单带材料类型则永远匹配不上**：闪铸料槽 type 是「余量约Xg」非材料名（`flashforge.js:177-183`），materialMatch 恒 false → 填材料的 gcode 单永不自动分发且周期性触发缺料提醒。**建议**：闪铸匹配跳过材料判定（ trays.find(t=>t.type) 即可）。
19. 缺料恢复无自愈触发：全员空闲时人工上料不产生事件，队列滞留——**建议**：打印机 IDLE 事件时对缺料队列补一轮 match。
20. 未知机型默认按拓竹处理 + isAutoDispatchable 恒 true（`manager.js:13,18-20`）——「未知品牌仅登记」分支死代码，型号配错静默起 MQTT。**建议**：显式品牌白名单，未知只登记。
21. 未切片闸正则双份维护 ✅ 已修（v56 合一至 `utils/fileTypes.js`）。
22. 过期文案两处：manualDispatch 未切片报错说「仅支持 3mf」（`dispatcher.js:978`，与双品牌批矛盾）；multer fileFilter 报错漏列 gcode 系（`index.js:54` vs `:45`）。
23. `known` Set 运行期无界（仅落盘时截 2000）。
24. quiet-hours 积压单条补发 3 次失败即静默丢弃（`quietHours.js:28,229-232`）。
25. 审批提醒/结果卡发起人 id 恒空串——永不 @ 当事人（`reservation.js:66-75` + `bot.js` buildAtTag）。
26. 孤儿上传文件：multer 落盘后 store.create 前异常路径无主文件无人清（保留期清理只扫终态登记单）。
27. `completedCount` 只写不读（负载选机未实现）。
28. 入队卡 position 是 push 序，未按加急排序——与实际出队顺序可能不一致。
29. manualDispatch 业务错误统一返 500（`index.js:1162-1165`）。
30. chatService 帮助文案仍指引已移除的 /print-dispatch（`chatService.js:101`）——死指引。

## 修复状态账（v56 批）

| 项 | 状态 |
|---|---|
| #1 竞态 / #2 停机静默 / #3 enqueue 滞留 / #21 正则合一 | ✅ v56 修复 |
| #4 chat 鉴权 | ✅ 已修（2026-10-18：`chatCommandGuard` 本机回环默认门 + 跨机 X-API-Token，`index.js`） |
| #13 policy 窗口鉴权 | ✅ 已修（v62：`GET /api/print/policy` 挂 `requireUser`，`index.js`） |
| 其余 | 📋 本报告留档，按需开批次 |
