# ticket-pm 播报 / 分支 / 事件触发逻辑总览

> 覆盖范围：`ticket-bot/`（工单域）与 `project-management-robot/`（对话枢纽 hub），含两项目联动契约。
> 行号以 2026-09-05 修复批次后的代码为准；重构后请同步更新本文件（它是两项目分支逻辑的权威速查）。
> 本文只描述"现在是什么"，改动决策记录在各项目 DEVLOG.md。

---

## 0. 全局架构与事件流

```
飞书开放平台
   │（长连接只属于 feishu-gateway；两项目一律 FEISHU_USE_LONG_CONNECTION=false）
   ▼
feishu-gateway（事件接入 + 路由分工，不在本工作区）
   │  POST /api/feishu/event  → 原始事件转发
   │  POST /api/chat/command  → hub 转发业务指令给 approval-bot / bambu（ticket-bot 无此端点，走上方原始事件转发）
   ├──────────────► ticket-bot  :3003  工单域例外（/ticket-* 指令、@机器人+接单、p2p+接单）
   └──────────────► pm-robot(hub):3000  其余全部消息（对话/指令分发/关键词/会议/DDL确认）
                        │ 转发 /approval-* → approval-bot:3002
                        │ 转发 /print-*    → bambu:3001
                        │ DDL 卡工单分栏取数 → ticket-bot GET /api/tickets/unclosed-by-group
                        │ 团队负载聚合取数 → ticket-bot GET /api/tickets/workload-by-person（v82 起）
                        ▼
 approval-bot / bambu-print-reservation / feishu-gateway（均在顶层，不归本工作区）
```

发送通道约定（"播报卡互不越界"）：
- **ticket-bot 播报**：应用机器人（对话型）IM API 优先（chat_id，能收 @ 事件），失败回退群自定义机器人 webhook（`ticket-bot/src/feishu/bot.js:108` `sendCardToTarget`；行号随版本漂移，以函数名为准）。
- **pm-robot 播报**：群自定义机器人 webhook（DDL 卡、多人单结束通告类）；对话回复走飞书 IM API（reply → chat_id 降级）。
- 工单播报卡 / 接单回执 / 超时问询 → ticket-bot；DDL 卡 / 逾期确认 / 会议提醒 / 语录 → pm-robot。"播报对象/@谁"跟着卡片走。

---

## 1. ticket-bot（工单域）

### 1.1 事件入口（`src/index.js` + `src/feishu/eventSubscription.js`）

`POST /api/feishu/event`（网关转发，`useLongConnection=false` 生效）按 `header.event_type` 分四路，全部 `setImmediate` 异步处理、立即回 `{code:0}`：

| 事件 | 处理 | 说明 |
| --- | --- | --- |
| `drive.file.bitable_record_changed_v1` | `processBitableEvent`：`record_added`→`handleRecordCreate`，`record_edited`→`handleRecordUpdate` | 只处理源表；V2 结构 `event.action_list[]` |
| `bitable.record.create` / `bitable.record.update` | 同上（V1 兼容分支） | 与上面互斥，实际走哪个取决于网关转发格式 |
| `approval_task` | `approvalLinkService.handleApprovalTaskEvent` | 缓存待审任务供接单自动通过 |
| `im.message.receive_v1` | `chatService.processChatMessage` | 接单确认 + /ticket-* 指令 |

长连接模式（本地调试用）走 `eventSubscription.js` 的 WSClient，同一套 handler；`FEISHU_USE_LONG_CONNECTION !== 'false'` 时 HTTP 回调跳过处理。

### 1.2 工单播报主链路（`src/services/ticketService.js`）

**总开关**：`isBroadcastEnabled()` = `BROADCAST_ON` 含 `create`（create/update 两条事件路径共用，无独立 update 开关）。

**创建事件 `handleRecordCreate`**：
1. 去重：`recentCreateEvents`（record_id，TTL 10 分钟）。
2. category 有值 → 搬运到项目看板（`syncIfCategoryPresent` → `syncService.syncRecord`，upsert 幂等）。**人员口径（2026-09-13）：看板人员一律来自「补充负责人」全员**（同组多人并集、跨组各归字段；指定负责人公示时即写入补充负责人，专项搬运废止——首次搬运到公示绑定之间存在秒级空窗，由绑定写表触发的更新事件与每分钟补搬运自然填上）。
3. 审批节点（`approvalNode.field`，默认「审批节点」）命中触发值（`acceptValues` = 「群内有组员接单后通过 / 有组员接单后通过 / 负责人确认消息后通过」）→ `broadcastTicket(record, 'create')`；未命中则只搬运不播报。

**更新事件 `handleRecordUpdate`**：搬运 + 节点命中触发值时 `broadcastTicket(record, 'publish')`（该记录从未播报过才会真播）。

**`broadcastTicket` 的五层防重播**（顺序）：
1. `broadcastedRecords` 内存 Set（进程内跨创建/更新事件去重）；
2. 源表标记字段「已播报」（`BROADCAST_MARK_FIELD`，写时间戳+场景，跨重启防重播）；
3. 发送前重查最新记录：**申请状态命中死亡终态 → 跳过（终态单不补播，2026-09-27 v88）**；补充负责人已有值 → 跳过（已有人接单）；节点已推进 → 跳过；
4. 发送后**至少一群成功**才写内存 Set + 源表标记（全败允许对账重试）；
5. 每分钟对账兜底（见 1.4）。

**播报分支（按「是否指定人员负责」）**：

| 分支 | 条件 | 播报目标 | 卡片 | 待接单登记 |
| --- | --- | --- | --- | --- |
| 未指定负责人 | `assign.field` = `assign.noValue`（否） | 按「面向组别」（`routeField`，多选并行分发）经 `GROUP_ROUTES` 映射；无命中回退 `DEFAULT_CHAT_ID` 兜底群 | `buildTicketOpenCard`（蓝，任一组员可接） | `expectedAssigneeId = null`（任一组员可确认） |
| 已指定负责人 | = `assign.yesValue`（是） | 负责人所属组别（`resolvePersonGroups`：USER_GROUPS → 飞书通讯录部门 → 工单面向组别兜底）→ `GROUP_ROUTES` | `buildTicketAssignCard`（蓝，@负责人本人） | `expectedAssigneeId = 负责人 open_id`（仅本人可确认） |
| 值无法识别 | 其它 | 不播报，留 history | — | — |

**公示即绑定 `bindAssignedTicket`**（仅指定负责人分支，播报成功后执行）：
- 写源表「补充负责人」= 指定负责人（幂等）；
- 按负责人组别合并写看板人员字段（机械→owner，电控/硬件→dkyjcontributers，视觉→sjcontributers，宣运→xycontributers，未识别→owner；merge 不清空其它组别）。
- **只做绑定**——状态推进和审批自动通过等本人确认后才触发。

组别→群映射关系（`GROUP_ROUTES`，`parseRouteTargets` 支持 `值=chat_id|webhook_url` 新格式与旧格式）：`config.broadcast.routes`；`collectTargets` 按值匹配并按 chatId/webhook 去重，一条工单可并行分发多个组群。

**终态联动撤回（2026-09-27 v88，用户需求「工单撤回时撤回接单提醒」）**：「申请状态」命中死亡终态（已撤回/已拒绝/已取消/已终止/已删除，`syncService.isDiedStatus` 与看板 `died` 映射同源）时三路联动：① `revokeTicketReminderCards` 按 `keywordCardRegistry` 登记撤回各群提醒卡（`bot.deleteMessage`，DELETE /im/v1/messages）——更新事件步骤 0 即时撤 + 每分钟对账补偿撤（`revoked` 计数），双路径幂等；② 播报守卫（上述防重播第 3 层）；③ `isTicketAwaitingKeyword` 终态短路（终态单不进队列不占「接单N」序号）。失败分支：230001/230020（消息不存在/已撤回）清登记不重试，瞬时失败保留登记对账重试至 KEYWORD_CARD_MAX_FAILS(5)。边界：登记为内存态且每群×工单只存最近一张卡，被覆盖的首播卡/重启前的卡无法追撤；webhook 卡无 message_id 不可撤。

### 1.3 接单确认（事件驱动，无轮询回扫）

**入口 A：群内 @机器人 + 「接单」**（网关宽口径路由：含「接单」且 @机器人 → 本项目；本服务二次校验 `isSelfMention`）。
**入口 B：负责人私聊回复「接单」**（网关 p2p+接单 路由）。

两个入口都要求**去空白后整句等于「接单 / 确认接单」**（`chatService.isExactAcceptText`）；含「接单」但非整句（如"还没人接单吗""我不想接单"）只回一条提示，**不触发任何写操作**。消息级去重：`processedMessages`（message_id，TTL 5 分钟）。`IGNORE_CHAT_IDS` 内的群整条跳过。**无单群静默（2026-09-13）**：群内接单类消息先查 `hasPendingAcceptInGroup(chatId)`——该群实时队列（`computeAcceptQueues`）为空即静默忽略（非工单群/当前无单的组别群都不再回「无待接单工单」与使用提示）；p2p 私聊确认入口不受此门禁影响。已知边界：门禁与 handleAcceptOrder 各拉一次全表（性能可接受，接单类消息低频）；两查之间队列清空会漏出一条「⚠️ 无待接单工单」——fail-safe（不会错误接单），保留。

**群内链路 `handleAcceptOrder(chatId, userId, ...)`**（v64 起进程内串行化，**v71 收敛为全局锁** `withAcceptLock('global')`：接单是「读全量记录 → 合并写补充负责人」链路，并发双读同底版会互相覆盖丢人；全局锁进一步兜住跨群写同一工单的边界竞态，串行后后到者读到先到者的写入再合并）：
1. 定位工单：按源表实时推导该群队列（`computeAcceptQueues`，v57 起无内存待接单映射）：**仅触发节点** + 补充负责人为空 / "指定即绑定未确认"（补充负责人==指定负责人）/ **多人单续接窗口内**（多人单补充负责人已有人也开放，截止已过则出队）+ 面向组别覆盖该群（或指定负责人的组别覆盖该群）；按创建时间倒序（**最新为「接单1」**），群内复数张时接单词带序号，裸「接单」被拒并提示序号范围。
2. 按序号（或唯一那张）定位目标：`expectedAssigneeId` 为空 → 任一组员；非空 → 仅指定负责人本人。
3. 重查源表守卫（拉取失败按拒绝处理）：指定负责人工单他人确认 → 拒绝；审批节点已推进 → 拒绝；非多人单已被他人接单 → 拒绝。**指定负责人本人（补充负责人==本人，即「公示即绑定」态）放行**——绑定≠已确认，本人确认正是该链路的既定动作（v59 修复：原守卫把绑定当已确认，本人被拒、工单永卡触发节点）；本人短窗重复消息由内存 `assigneeConfirmState`（10 分钟）拦截。
4. 副作用（顺序）：看板状态 → `in_progress`；**合并**写源表「补充负责人」（多人陆续接单不覆盖）；按接单人组别合并写看板人员字段；群内发绿色「接单确认」卡。（原「从待接单列表移除」一步已随内存映射废弃，出队由源表字段变化自然反映。）
5. 审批分支（见下）：多人单 → 开续接窗口不通过审批；其余 → 批量自动通过。
6. 失败时群内回 `⚠️ 原因`（无待接单工单 / 多张待接单工单时裸「接单」被拒并提示序号范围 / 序号不存在 / 已指定其他负责人仅限本人 / 已确认过或已有人接单 / 处理异常）。

**审批联动 `autoApproveForTicket`（批量通过）**：无指定负责人分支的审批流按「面向组别」**并行**展开（机械/电控/硬件/视觉/管理层/宣运各有「XX有组员接单后通过」节点），面向复数组别的工单会同时挂多个待审任务——缓存按 `{申请编号 → {taskId → 任务}}` 存集合，通过时**逐个同意全部任务**流程才能汇合。守卫：工单审批节点仍在触发值内；缓存优先，缺失按申请编号反查审批实例（14 天窗口）兜底；以白名单审批人（`APPROVAL_AUTO_APPROVER_ID(S)`）身份同意。

**多人接单分支（`config.multiAccept`，仅无指定负责人工单）**：
- 条件：工单表字段「是否允许多人接单」（`MULTI_ACCEPT_FIELD`）=「是」。与「是否指定人员负责」同模式，**审批表单字段需同步到工单多维表**，缺列/为空按「否」走现状（接单即通过）。
- 有人接单时：**不通过审批**；写窗口截止 = now + `MULTI_ACCEPT_WINDOW_HOURS`（默认 6h）到源表字段「多人接单截止」（自动创建，**文本型，值为带 +08:00 的 ISO 文本**——写毫秒数字会被飞书拒收 TextFieldConvFail 1254060，v57~v58 窗口截止从未落库、到期永不触发的根因，v59 修复；读取兼容 ISO 文本与历史数字串）；向**已有人接单的群**发「👥 多人接单进行中」卡（当前 N 人、截止时间、续接方式）。
- **截止写入失败 → 降级为「接单即自动通过」**（不发续接询问）：窗口是假的，绝不能据此卡住工单（v59）。
- 窗口内再有人接单：合并补充负责人 → 重置窗口（再来 6 小时）→ 再次群内通告（"再次播报再来6小时"）。**计时器为工单级**：面向复数组别共享同一窗口；续接询问只发已有人接单的群，不广播全部面向组别。
- 窗口到期（每分钟对账检查，10 分钟节流）：自动通过该实例**全部**触发节点任务，并向已接单的群发「✅ 多人接单结束」卡；通过失败（任务未到达等）下轮重试。**截止缺失**（修复前存量单/字段被清）→ 重新计时兜底（now+6h 回写，写失败下轮重试），保证窗口最终闭合；到期后该单立即出队（卡片不再提示接单）。
- 指定负责人工单即使字段=是也不走多人分支（走「负责人确认消息后通过」单人确认）。

**私聊链路 `handleAssigneeDmConfirm(userId, userName)`**：扫描源表定位"节点仍在「负责人确认消息后通过」+ 指定负责人==发送者 + 补充负责人==发送者"（即已绑定未确认）的最新工单 → 找到公示群 → **显式指定工单 ID** 调 `handleAcceptOrder`（不走群内排队序号，私聊语境无歧义）复用群内链路完成全部副作用（群内回执 + 审批联动）。无候选回 `no-pending` 引导去群里 @机器人。

### 1.4 定时任务（`src/cron/index.js`，均 Asia/Shanghai）

| 任务 | 调度 | 条件 | 分支与动作 |
| --- | --- | --- | --- |
| 播报对账 | 每分钟 | 源表全量扫描，节点 ∈ 触发节点 ∪ 「回执单：是否结单」 | 回执单节点：只补搬运；触发节点：无标记 → 补播（含补绑定），有标记 → 跳过（**已播报指定工单的补偿绑定只作用于触发节点工单**）；另挂**审批联动补偿**——多人单窗口到期自动通过（+结束通告）、非多人单接单后审批未通过的补通过（10 分钟节流，指定负责人工单不代通过；**v87 起该行必须有机器人自写的『接单确认时间』痕迹（`ACCEPT_TRACE_FIELD`）才允许代通过**，无痕迹本轮不动作——防对账扫到非本机器人确认的行误代通过）。背景：共用应用多条长连接随机分发事件，约 1/N 丢失由这里兜底 |
| 超时检查 | 每小时 | 节点 ∈ 触发节点 + 补充负责人为空 + 当前处理人有值 + 距发起时间 > 6h | **轮次计数（内存，重启清零）**：第 1 轮走既有分支——分支1 当前处理人==发起人 → 私信发起人"无人接单，是否仍需要/去审批界面撤回或结单"；分支2.1 指定负责人 → 私信当前处理人引导"接单确认"；分支2.2 无指定负责人 → 群内重问询卡（@组长；**每 6h 一次、每单封顶 2 次**，≈发起后 6h/12h 各一次，内存计数重启清零，至少一群发送成功才占额度；封顶或间隔未到的轮次跳过群内卡）。**第 2 轮起叠加「无人接单升级」**：私聊面向组别对应的组长（`GROUP_LEADERS`；多组别多组长各一条、同一组长名下多组合并为一条；组长值兼容 open_id/user_id，user_id 经通讯录解析 open_id 带缓存，解析失败 fail-closed 跳过），文案含组名/标题/超时小时/接单指引/工单链接；同一工单对组长私聊间隔 ≥3h，**不随群内封顶停止**——群内问询封顶后由它承担持续提醒。**注意**：绑定成功的指定工单天然被跳过；多人单有人接单即写补充负责人退出本检查（续接询问/到期自动通过不经此处，不受问询封顶限制），本任务实际覆盖"公示后无人响应"的工单 |
| 结单提醒 | 每小时 | 节点 =「回执单：是否结单」+ 当前处理人有值 + 已过「理想结单时间」+ `CLOSE_REMINDER_LEAD_DAYS` 天 | **只私聊**：私聊当前处理人一次即止（「先私聊后转群」兜底已按需求移除，2026-09-05）；未结单工单的持续曝光由 pm-robot 每日 DDL 播报的「工单结单」分栏承担。状态在内存（重启会重私聊一轮） |
| 指定负责人确认追问 | 每小时 | 节点 =「负责人确认消息后通过」+ 已绑定（补充负责人==指定负责人）+ 距发起时间 > `ASSIGN_NUDGE_HOURS`（默认24h） | 私聊负责人提醒确认（群 @机器人 或私聊「接单」均可完成）；同工单追问间隔不小于 N 小时；追问记录 7 天淘汰 |
| 搬运缺行修补（v76） | 每小时 :15 | 源表 category 有值但看板缺对应行 | 纯数据对账补搬运，无任何播报（**不过晚间静默闸门**，写表动作不属播报） |

上表除「搬运缺行修补」外，所有任务（含工单播报与结束通告）统一受 **晚间静默闸门**（§1.7）约束。

**互斥闸门 + 看门狗（2026-11-03 v94）**：五个定时任务各自持互斥闸门（src/utils/taskGate.js）——上一轮未结束时重叠 tick 跳过，防扫描堆叠；并挂看门狗：单轮持续超过阈值（对账 10 分钟、缺行修补 30 分钟、三个整点任务 3 小时）仍未结束时强制复位放行新一轮并打 ⚠️ 告警（旧轮僵尸 promise 有界、重启即清，令牌机制保证迟到的旧轮 finally 不会误清新一轮标志）。背景：2026-11-01 网络故障窗口内一轮对账的出站请求永久悬挂，互斥标志恒 true，兜底补播停摆 48.8h；同批出站 fetch 已全量挂 AbortSignal.timeout(15s)（含 token 请求），看门狗为不依赖挂点实锤的最后防线。

### 1.5 指令（`/ticket-*`，`src/services/chatService.js`）

- 仅群内触发；私聊仅白名单（`P2P_COMMAND_OPEN_IDS` / `P2P_COMMAND_CHAT_IDS`，open_id 与 p2p chat_id 任一命中），与 hub 同套规则同套环境变量。
- `/ticket-help` `/ticket-list` `/ticket-pending` `/ticket-status` `/ticket-sync`（全量同步源表→看板）。
- 另有运维 API：`POST /api/bot/rebroadcast`（按 recordId 补播，走同一去重）、`POST /api/bot/reconcile`（手动对账）、`POST /api/bot/test-nudge`。

### 1.6 未结单工单 API（供 hub DDL 分栏，两项目唯一直接调用）

`GET /api/tickets/unclosed-by-group`（`src/services/unclosedService.js`）：
- 全量拉取源表后按审批节点**本地拆段匹配**分两类（服务端等值过滤对「；」拼接节点值静默失效）；
- 结单分桶判定：节点 =「回执单：是否结单」+「理想结单时间」在 7 日内（含已超期）；
- **结单分桶播报对象：指定负责人 → 补充负责人（去重并集），不取发起人/当前处理人**；两者都空不播；分组按负责人组别（USER_GROUPS → 通讯录 → 面向组别兜底）→ `GROUP_ROUTES` 映射为群 chatId（并集，一票多组会出现在多群）；分桶 ≤2 天 `urgent`、2–7 天 `week`；
- **无人接单分桶 `unclaimed`**：节点 ∈ 触发节点（拆段匹配）+ 补充负责人为空（有人接单/公示即绑定都不在此列）+ 距发起时间 ≥ 6h（与超时检查阈值对齐，刚发布的不曝光）；无负责人可解析，按工单「面向组别」直接映射播报群；按已发布时长降序；
- **已指派待确认分桶 `unconfirmed`（2026-10-15）**：公示即绑定后滞留指定负责人确认节点的工单——节点 =「负责人确认消息后通过」（拆段匹配）+ 是否指定负责人=是 + 补充负责人已含指定负责人 + 距发起时间 ≥ 24h（与确认追问 `ASSIGN_NUDGE_HOURS` 同口径：私聊追问过一轮还没确认的，次日 DDL 公开曝光）。此前该状态两头不进（unclaimed 按「已接单」跳过、closing 只收回执节点），DDL 完全不可见；多人单续接中（触发节点+已绑定但非指定负责人流）与未绑定单（对账补绑前）不进本桶；按工单「面向组别」直分播报群（与无人接单桶同款兜底）；按滞留时长降序；**不计负载**（人还没确认接单，与 unclaimed 同口径归组别待接）；
- **waiting 等回执桶（2026-09-17）**：回执结单节点上不满足 urgent/week 条件的其余工单（无负责人 / 未填理想结单时间 / 超 7 日窗口）全部进 `waiting`——用户口径「等回执=没做完，不允许静默漏播」；无负责人按「面向组别」直分播报群（与无人接单桶同款兜底）；行渲染 `⏳ 👤负责人（或 无负责人） 「编号」**需求** - 📅日期/未填/已超期`。
- 返回 `{ result: { [chatId]: { urgent, week, unclaimed, unconfirmed, waiting } } }`（`unclaimed`/`waiting`/`unconfirmed` 为 additive 扩展，旧读法兼容）。
- **字段细则（2026-09-17 口径）**：`title`=需求文本优先（需求1/需求，截 40 字防爆行）/编号兜底，`code`=申请编号（此前 title 直接取申请编号，分栏每行只显示编号看不到需求，2026-09-17 修复）；结单桶带 `handlerName/daysLeft/deadlineFormatted`，无人接单桶带 `elapsedHours/groups`（面向组别），已指派待确认桶带 `assigneeName/elapsedHours/groups`。hub 卡片渲染：`👤负责人 「编号」**需求** - DDL 状态（📅 日期）`／`🆘（组别）「编号」**需求** - 已发布时长`／`📨 👤负责人 「编号」**需求** - 已滞留时长`。
- 口径说明：管理层/未匹配到播报群组别的工单不出现在任何 DDL 分栏（管理层群只做工单发布/问询播报）。

`GET /api/tickets/workload-by-person`（v82/v83，同文件 `unclosedService.js`，负载视角）：
- 共享 `collectUnclosedTickets` 取数层，但口径刻意分化：**不做播报路由过滤**（管理层等无路由工单的负责人照样计负载）、无负责人回执单进 `orphanTickets`、无人接单单列 `unclaimed`；
- 返回 `{ persons: { [openId]: { name, groups[], tickets[] } }, orphanTickets, unclaimed }`；ticket 带 `bucket/daysLeft/deadlineMs/deadlineFormatted/createdMs/shareCount/groups`（shareCount=负责人总数供摊薄，`groups`=单级面向组别供组别系数）；
- 消费方：pm-robot `/api/hub/workload`（三源评分聚合）→ 运维台「团队负载」看板。

### 1.7 晚间静默（跨任务播报闸门，`src/utils/quietHours.js`）

**02:00–09:00（Asia/Shanghai，`QUIET_HOURS_START/END` 可配、`QUIET_HOURS_DISABLED=1` 关闭）窗口内，定时/自动播报一律积压到 09:00 整点补发**；积压持久化 `.quiet-backlog.json`（默认项目根，`QUIET_BACKLOG_FILE` 可挪项目目录外——SFTP 部署清目录不再丢积压；重启不丢；启动时过点立即补冲刷、未过点调度到 09:00）。按任务形态分三种处理（「挤压要为挤压之后的事情负责」）：

| 播报路径 | 静默窗口内行为 | 09:00 补发机制 |
| --- | --- | --- |
| 超时检查 / 结单提醒 / 确认追问（每小时） | **整轮跳过**（无任何副作用：不计轮次、不写提醒/节流状态） | 09:00 整点那一轮天然就是冲刷；轮次与间隔节流从 09:00 起算 |
| 工单播报（`broadcastTicket`，事件 create/update + 对账补播） | **直接顺延且零副作用**（不发送、不写播报标记、不公示即绑定、不登记待接单），同一工单顺延日志只打一次 | 每分钟对账在 09:00 后第一个 tick 自然补播（补播走同一入口，播报前重查兜住夜间已接单/节点推进） |
| 多人单结束通告 | `gatePayload` 原样落盘卡片载荷 | 按入队顺序补发通告卡 |

不受限：对话/指令回复（接单确认等交互回路）、人工当下主动触发（`/api/bot/rebroadcast` 单条补播带 `bypassQuiet`、`/test-*` 接口）。`/api/bot/cron-status` 已附 `quietHours` 状态（窗口/是否静默/积压条数/下次冲刷）。

---

## 2. project-management-robot（对话枢纽 hub）

### 2.1 消息处理管道（`server/src/feishu/eventSubscription.js` `handleMessageEvent`，HTTP 回调与长连接共用）

```
p2p 消息：  ① DDL逾期确认(handleP2PReply) → handled? 终止
            ② chatService（私聊无需@；指令需私聊白名单；非指令命中任一回答表 → 只提示"仅面向群聊"；
               图片/文件在 chatService 内双线：duty 照片凭证直传 + 发票采集观察转发 approval-bot
               /api/invoice/collect（fire-and-forget 不 await，回执由 approval-bot 私聊发，v112））
群聊消息：  ① chatService（必须@机器人；值日管辖群分支先行：看板词/值日指令/图片转 duty-bot
                           （带 messageId 幂等），未接管落回常规流；审批群(APPROVAL_CHAT_ID)指令整体
                           切换为 /approval-*；@我时指令：静态指令表未命中再查 抽奖动态指令（一个工作表=一个指令=一个奖池，如 /抽奖），仍未命中落 /print-* 与未知指令；非指令命中 → 先查 @触发回答表，未命中回落 关键词回答表）
            ② DDL逾期确认(handleReply，仅4个播报群；确认必须来源匹配：p2p发的只能私聊回、群发的只能同群回)
            ③ 关键词自动回复·关键词回答表（未@消息命中 autoReplies.json 即回；AUTO_REPLY_CHAT_IDS 收窄，留空=全群）
            ④ 关键词监听（KEYWORD_CHAT_ID 限定，未配置则全部群）
            ⑤ 会议提醒（所有群，仅会议卡片消息，5分钟/群去重，@所有人；值日管辖群跳过——群级功能全关，严格按
                           duty-bot 下发 groupChatIds 命中判定，空列表不放大到全群）
```

每一环 handled 即终止管道；DDL 确认"未识别回复"在群聊静默放行给后续环节；③ 自动回复命中也不终止（发言记录照常往下走）。

### 2.2 DDL 每日播报（`server/src/cron/index.js` `runDDLBroadcast`，默认每天 12:05；2026-09-19 起 12:00→12:05 与 duty-bot 12:00 值日播报错峰，防 bitable 读限频互踢）

1. 防重：`.broadcast-state.json` 记 `lastBroadcastDate`，同日跳过。**标记在至少一群送达后才落盘**——全败当天可 `/test-broadcast` 重跑；部分成功用各群 `/test-ddl` 补发（它不受标记限制）。
2. 频控错误指数退避重试 ≤3 次；`deliveredGroups` 跨重试持久，重试只补失败群；同 webhook / 同 chatId 去重防一卡多发。
3. 逐群（`broadcastGroups`：owner / dkyj / sj / xy 四群，各对应项目表一个人员字段）：只播该字段有人的项目，树形层级渲染逾期（@）/ 2日内（@）/ 本周概览 / 意外暂停；另向**负责人群**（`LEADER_WEBHOOK_URL`/`LEADER_CHAT_ID`，v106 起）发一张整合卡（跨四群全量逾期/紧急汇总，供管理层一眼看全局）。
4. **未结单工单分栏**（跨项目）：
   - 主链路：`ticketCloseService.getGroupedBuckets()` → ticket-bot `/api/tickets/unclosed-by-group`（10s 超时，冷缓存余量），按群取 `groupedTickets[chatId]`，各组只看到自己负责人的工单；
   - 分栏内容：结单分桶（加急/7日内，列负责人姓名）+ **等回执分桶**（`waiting`，回执结单节点上其余全部——无负责人/未填理想结单时间/超 7 日，2026-09-17 起，等回执=没做完不允许漏播）+ **无人接单分桶**（`unclaimed`，超 6h 无人响应，只列标题与发布时长不 @，分栏头部带接单引导「@工单机器人 发接单N」——群内问询与组长私聊升级由 ticket-bot 超时检查承担）+ **已指派待确认分桶**（`unconfirmed`，2026-10-15：公示即绑定后超 24h 未确认，列负责人姓名与滞留时长不 @，头部带确认引导「@工单机器人 发接单N / 私聊回接单」——私聊追问由 ticket-bot 确认追问承担；此前该状态两头不进、DDL 完全不可见）；
   - 降级①：接口失败 → `getUnclosedBuckets()` 直读工单表，全群共用同一份（不分组），**播报对象与分桶口径与主链路一致：指定负责人 → 补充负责人、触发节点+补充负责人为空+≥6h、unconfirmed 桶（是否指定负责人=是+节点=负责人确认消息后通过+已绑定+≥24h，字段名/阈值 `TICKET_ASSIGN_*`/`TICKET_ASSIGN_NUDGE_HOURS` 可调，默认对齐 ticket-bot 现网）**；
   - 降级②：直读也失败 → 本次无工单分栏，DDL 播报不受影响。
5. 逾期确认：基于 owner 字段数据递归收集逾期项目 → 逐项目私聊 owner（见 2.3）。
6. **晚间静默**：触发落在播报静默窗口（默认 02:00–09:00，`server/src/utils/quietHours.js`）内时登记积压（`.quiet-backlog.json`，`QUIET_BACKLOG_FILE` 可外迁项目目录外），窗口结束整点**重跑整个播报任务**（含第 5 步逾期确认私聊，以补发时刻数据重查）；「今日已播报」标记在至少一群送达后才落盘，冲刷补跑与当天正常触发天然互斥。`/test-ddl`、`/test-broadcast` 人工触发不受限。对话/指令回复（DDL 确认"是/否"）不在播报闸门范围内。

卡片工单分栏只列负责人姓名不 @（结单提醒由 ticket-bot 私聊完成）。

### 2.3 DDL 逾期确认（`server/src/services/ddlConfirmService.js`）

- 发送：仅私聊（`sentMode: 'p2p'`）；每 owner 每项目一条待确认记录；**确认时效 12 小时**（`DDL_CONFIRM_WINDOW_HOURS` 可配）——时效内回复「是/否」才认，超时记录清除、项目保持原状态、次日 12:05 播报重新询问；重复发送去重只对未过期记录生效；230013（离队/未激活）/230053（拒收）安静跳过，**不再群聊降级**。
- 回复：**来源必须匹配**——p2p 发的确认只能私聊回；解析只认整句确认/否认词（是/是的/确认/完成/做完了/好/没问题/done/ok… ↔ 否/不/不是/没完成/还没/not yet…），**不做 contains 宽松匹配**（防"你是谁""是的（附和别人）"误改项目状态）。
- 回复"是" → 项目状态写 `completed`（失败回滚待确认记录并告知）；"否" → 状态不变；未识别 → 私聊引导（群聊静默）。
- 指令消息（`/` 开头）不进确认流程。
- **值日打卡让位（R9，2026-09-15 hub v92）**：存在未过期确认时，值日主词「打卡/打卡了」及口语变体让位给 duty-bot（转发出站，hub 不当项目确认处理）；「打卡」加入确认直通词表。

### 2.4 对话与指令分发（`server/src/services/chatService.js`）

- 群聊需 @机器人（`isMentionedBot` 兼容 mentioned_type app/bot/self/名称）；私聊白名单同 ticket-bot 同套环境变量。
- 本项目指令：`/help` `/status`（v105 起附**舰队健康快照**：部署目标 7 服务 health 并发探测 + 网关长连接/投递深度）`/test-ddl` `/keywords` `/autoreply` `/history` `/lottery`（看奖池）；`/print-*` → 转发 bambu `POST /api/chat/command`；**审批群**（`APPROVAL_CHAT_ID`）内 `/help` 与其余指令整体切换为 `/approval-*` → 转发 approval-bot（转发带 `X-API-Token` 头，v122），其它指令提示"本群仅财务指令"；审批群**裸词「接取 / 接取 批次号」**先于指令解析直转 approval-bot（v115 `matchApprovalTake`，senderName/senderId 透传，senderId 空 fail-closed 拒发 v120）；p2p 图片/文件 → 发票采集观察转发 approval-bot（v112，`forwardInvoiceCollect`，60s 超时 fire-and-forget；`extractFileContent` 读 `message.content ?? message.body?.content` 双形状兼容——v114 修复了原只读 body 形态导致文件分支死代码的问题，回执由 approval-bot 私聊发）。
- 值日管辖群值日分支先于一切能力（`handleDutyBranch` + `dutyPolicyService`）：**管辖范畴/生效范畴以 duty-bot `GET /api/duty/policy` 下发为准**（`DUTY_GROUP_CHAT_IDS`、看板触发词、基础指令关闭开关、引导语、p2p 指令清单；hub 60s 短缓存，duty-bot 失联时按本仓 `DUTY_CHAT_ID` 兜底；groupChatIds 空=不限制。关键词回答放行开关与值日域保留词校验已移除——2026-09-13 口径：值日助手仅 @ 与私聊触发、未@/@ 关键词回答全群统一，与值日部件无撞车面）。p2p 值日指令/图片按策略直转 duty-bot（带 messageId，duty-bot 侧消息级幂等生效；duty-bot 未接管如无会话口语变体→落回常规流程）；管辖群内 @消息：看板触发词（带不带 `/` 均可）出看板（载荷带 messageId）、群内指令子集+取件词形（2026-09-17 快递助手：策略 `groupCommands`=`值日助手/快递助手/快递/查询当前快递` 裸词与带 `/` 双形态 + `p2pCommandPatterns`=`已取n/全部已取`，转发 duty-bot；开窗→群发非@取件码/照片经 `maybeForwardExpressObserve` 观察转发进「快递」表，每小时整点未取播报过静默闸门）、@+纯图片窗口期转 duty-bot 登记（无窗口静默）、抽奖动态指令（/抽奖）先于基础指令关闭的引导语（2026-09-14）、关键词命中照常回答（同款 `buildMentionReplyForText`），其余回策略引导语；**非管辖群** @ 值日指令（`groupCommands` 指令子集，2026-09-17 修复——此前吃整份 p2pCommands 把「是/好/完成」口语词也拦成值日提示）回办理路径提示；未@消息照常走管道③（关键词回答全群统一，无值日群特殊放行开关）。已知边界（记录在案）：gateway `contains:'接单'` 全局抢占、`isMentionedBot` 把 @任何 app/bot 都算 @本机器人（共用应用妥协）、群看板限流命中静默。
- 关键词自动回复分流（非指令）：群里 @我 → `buildMentionReplyForText`（先「@触发回答」表，命中即止；未命中回落「关键词回答」表）；私聊命中任一表 → 只回"仅面向群聊开放"提示，不返回答案。指令优先于自动回复。
- `/test-ddl` 守卫：非播报群的群聊里拒绝执行（防止测试卡经 owner webhook 兜底跨群打到 owner 群）；私聊管理员保留 owner 群兜底。
- 普通对话：审批群回财务引导文案，其余回 popcorn 引导文案；回复用 message reply，失败降级 chat_id 直发。
- `/test-ddl` 在播报群内按该群 webhook + mentionField 测试，返回逾期/紧急/本周计数。
- **僵尸父项目召回（2026-09-17）**：父项目默认只当 📁 容器不单独播报；但名下子项目全部终态（completed/died）而父项目自身未完成且 DDL 已进窗口（逾期/加急/7 日内）时，恢复为叶子行参与对应分栏，行尾「🧟 子项目均已收尾，父项目待结」——防未完成父项目静默变僵尸。子项目仅暂停（pending）不算收尾；父项目 DDL 在窗口外暂不播，临近自动浮现。

### 2.5 关键词监听、自动回复与会议提醒（简）

- 发言记录（`keywordService`，原关键词监听）：v23 起记录 `KEYWORD_CHAT_ID` 群的**全部消息**（父记录固定「全部发言」，`keywords.json`/`/keywords` 仅展示兼容），每条消息写一条子记录；群内 @机器人 的消息走对话链路不记录。
- 抽奖（`lotteryService`，v86 全群关键词链路 → v87 动态指令 → **v90 一个工作表=一个指令=一个奖池**）：`抽奖配置表.xlsx` 每个带「奖品|概率」表头的工作表 = 一个独立抽奖指令（**工作表名即指令名**），表内一行=一个奖品、行数不限；无「奖品」表头的表（如「使用说明」）自动忽略（`scripts/syncLottery.js` → `lottery.json`）——群里 @机器人 发「`/工作表名`」即按概率加权随机抽一条该表奖品原文回复（精确匹配不误伤闲聊）。触发路径：chatService 指令分支静态指令表未命中 → 抽奖动态指令 → /print-* → 未知指令；值日管辖群分支同样放行（先于引导语）；审批群不开放；私聊按指令白名单口径。`LOTTERY_CHAT_IDS` 可收窄（留空=全群）。窗口 `/api/lottery/rules*`（写端点 X-API-Token）热改 `.local.json`；`/lottery` 看奖池；动态指令自动进 `/help`；命中上报统计 feature=抽奖。属对话回路，不受晚间静默限制。
- 关键词自动回复（`autoReplyService`）：两张本地回答表，同为 `关键词回答表.xlsx` 的两个工作表、经 `scripts/syncAutoReplies.js` 转成 JSON（**工作表名精确匹配，缺失即跳过该表**，不回落第一个工作表）。
  - 「关键词回答」→ `autoReplies.json`：未@群消息路径（管道③）命中即回，`AUTO_REPLY_CHAT_IDS` 可收窄（留空/`*`=全群）；同时是 @我 时的回落表。
  - 「@触发回答」→ `autoRepliesMention.json`：只在群里 @机器人 时参与，优先级高于上表；两表都未命中才回欢迎语。跨表不合并（先命中的表胜出），表内多命中才合并。
  - 两表都属对话回路，不受晚间静默限制；改动 JSON 即时生效（每条消息重读）。
- 会议提醒（`meetingReminderService`）：所有群仅识别会议卡片（share_calendar / calendar_event / video_chat / interactive 卡片特征；**share_chat 群聊分享卡片明确排除**，README 口径为准），5 分钟窗口去重后 @所有人提醒。

---

## 3. 跨项目联动契约（改接口前逐条核对）

1. **DDL 分栏取数**（唯一直接调用）：pm-robot → ticket-bot `GET /api/tickets/unclosed-by-group`。数据口径、负责人取值（指定→补充，不取发起人/当前处理人）、分桶规则在 ticket-bot；分栏展示与卡片其它栏目在 pm-robot。**两边降级直读链路的负责人口径必须一致**。pm-robot 侧 10s 超时降级，不影响 DDL 播报本身。
2. **网关路由分工互斥**：ticket-bot 只做工单域例外（`/ticket-*`、@机器人+接单、p2p+接单）；hub 接其余全部并转发 `/approval-*`、`/print-*`。改路由时两项目 `IGNORE_CHAT_IDS` / 群门禁要与网关路由表一起核对。
3. **指令门禁同套**：指令仅群内 + 私聊白名单（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`），两项目同款同值。
4. **播报卡互不越界**：工单播报/接单回执/超时问询/结单提醒 → ticket-bot；DDL 卡/逾期确认/会议提醒/语录 → pm-robot。
5. **事件全经网关**：两项目 `FEISHU_USE_LONG_CONNECTION=false`，收 `POST /api/feishu/event`；hub 转发指令走 `POST /api/chat/command`。
6. **动态广场写表 / gateway 接单抢占**：动态广场写表约定（各仓 `src/services/plaza.js`、失败仅 warn、测试隔离 `PLAZA_BITABLE_TABLE_ID=''`）与 gateway `{contains:'接单', mention:true}` 全局转发（**无单群静默**：ticket-bot 按该群实时接单队列门禁，无可接单工单的群静默忽略，2026-09-13 起）见 `ticket-pm/AGENTS.md` 联动契约 6/7。

审批节点值（两项目各自配置，需保持一致）：触发播报/联动 = 「群内有组员接单后通过」「有组员接单后通过」「负责人确认消息后通过」（指定负责人的公示即绑定只作用于最后一个）；结单相关 = 「回执单：是否结单」。无指定负责人分支的审批流按「面向组别」并行展开（每组一个「XX有组员接单后通过」节点，需全部通过流程才汇合），联动侧按任务集合批量通过。

---

## 4. 已知限制与待核实（本次评审未改，改前先确认业务）

| # | 事项 | 位置 | 说明 |
| --- | --- | --- | --- |
| 1 | 指定负责人工单公示只取第一个 assignee | `ticket-bot/src/services/ticketService.js` broadcastTicket | `f[assigneeField]?.[0]`；多负责人时仅第一人被公示/绑定/限权（搬运链路 2026-09-13 起已改为补充负责人全员，不受此限；未结单 API 亦为多负责人并集） |
| 2 | 超时分支依赖「当前处理人」字段取值 | `ticket-bot/src/cron/index.js` checkTimeoutTickets | 若审批流在未接单阶段把当前处理人留空或留为审批管理员，分支1/2.1 的对象判断会失真、2.2（群内重问询@组长）可能不可达。需结合实际审批流核实字段语义 |
| 3 | 结单提醒只私聊一次，无后续自动升级 | `ticket-bot/src/cron/index.js` closingRemindState | 「先私聊后转群」兜底已按需求移除（2026-09-05，私聊链路已跑通）；处理人忽略私聊时的持续曝光依赖每日 DDL 卡「工单结单」分栏。状态仅内存，重启会重私聊一轮 |
| 4 | 逾期确认"是"直接写 completed | `pm-robot ddlConfirmService` | 私聊一句整句"是"就会改项目表状态（现在已限定只能私聊回复 + 整句匹配）；如需二次确认可加待确认快照/撤销窗口 |
| 5 | owner 群的工单分栏取决于 GROUP_ROUTES 映射 | 两项目 | hub 的 owner 群（mentionField=owner）只有在 ticket-bot `GROUP_ROUTES` 把某组别映射到同一 chatId 时才有工单分栏；否则该群 DDL 卡永远无工单栏 |
| 6 | `/test-ddl` 私聊执行时测试卡发到 owner 群 webhook | `pm-robot chatService` | 管理员私聊测试的既定行为，注意别在正式时间误触发 |
| 7 | ~~待接单多工单同群时"接单"默认作用于最新一张~~ 已解决（v57） | `ticket-bot ticketService` handleAcceptOrder | v57 起按源表实时推导队列，「接单」须带序号（最新为「接单1」），裸「接单」被拒并提示序号范围；详见 §1.3 |
| 8 | 「是否允许多人接单」依赖审批表单 → 工单表同名字段同步 | `ticket-bot config.multiAccept` | 工单表缺列/为空时按「否」处理（接单即通过，现状）；存量单列值恒为空，仅新提交的审批会带值 |
| 9 | 无人接单升级的轮次/间隔状态仅内存 | `ticket-bot/src/cron/index.js` timeoutRoundState/leaderNudgeState | 重启后轮次清零，组长私聊升级最多推迟一轮（1~2 小时）；不涉及写库，故不落表 |
| 10 | 超时重问询卡对组长的 @ 可能无效 | `ticket-bot/src/feishu/bot.js` buildReannounceCard | `GROUP_LEADERS` 当前配的是 user_id，而卡片 `<at id>` 语法要求 open_id（无人接单升级的私聊链路已做 user_id→open_id 解析，群卡 @ 沿用旧写法未动；该分支本身很少触达） |
| 11 | 指定负责人本人确认成功、但审批联动当时失败时无持久重试 | `ticket-bot ticketService` handleAcceptOrder | 对账不代通过指定负责人单（必须等本人确认，源表无可判"已确认"的持久标记），本人短窗 10 分钟后可重发「接单」再触发一次联动；正常流程下审批任务早于确认到达，链路会一次成功 |

---

## 5. 修复记录（2026-09-05 批次，评审驱动的行为修正）

| # | 修复 | 项目 / 文件 | 行为变化 |
| --- | --- | --- | --- |
| 1 | 接单确认改**整句精确匹配**（接单/确认接单），含"接单"但非整句只回提示不触发 | ticket-bot `chatService.js` | "还没人接单吗""我不想接单"等不再误触发接单/审批自动通过 |
| 2 | 接单回退匹配池**只收触发节点**（原含回执单节点）；命中的**全部候选升序入列**（原只入一条） | ticket-bot `ticketService.js` | 重启后 stray"接单"不再作用到已接单工单；共群多工单时授权检查可落到发送者真正可接的那张 |
| 3 | 超时分支文案按"无人接单"语义修正；「补充负责人/是否指定人员负责/面向组别」改走 config；发起时间统一 `getCreatedTime`（发起时间→创建时间回退） | ticket-bot `cron/index.js`、`utils/fields.js`、`ticketService.js` | 分支1 不再误导发起人去"结单"；字段改名时不再静默失效 |
| 4 | 播报开关收敛为 `isBroadcastEnabled()`（含注释说明 create/update 共用） | ticket-bot `ticketService.js` | 行为不变，消除 `includes('create')` 裸判语义陷阱 |
| 5 | DDL 逾期确认：p2p 发出的确认**只能私聊回复**；解析删除 contains 宽松分支、只认整句词表 | pm-robot `ddlConfirmService.js` | 群里/私聊的日常消息不再被误判成"已完成"而改项目状态 |
| 6 | 降级直读链路播报对象改为**指定负责人→补充负责人**（原取当前处理人），与主链路及两项目文档口径对齐；新增可选 env `TICKET_ASSIGNEE_FIELD` / `TICKET_SUPPLEMENT_FIELD`（有默认值，NAS `.env` 无需必配） | pm-robot `ticketCloseService.js`、`config.js` | ticket-bot 挂掉降级那天，DDL 卡工单分栏的负责人口径与平时一致 |
| 7 | DDL 播报"今日已播报"标记改为**至少一群送达后落盘**（原进门即写） | pm-robot `cron/index.js` | 全败当天不再被标记吞掉，可 `/test-broadcast` 重跑；部分成功用各群 `/test-ddl` 补发 |
| 8 | `/test-ddl` 在未配置播报的群聊里拒绝执行（私聊保留 owner 群兜底） | pm-robot `chatService.js` | 测试卡不再意外跨群打到 owner 群 |
| 9 | **审批节点值改拆段匹配**（`config.matchNodeValue`，按 `;；,，、|` 拆段任一命中） | ticket-bot `config.js`、`ticketService.js`、`approvalLinkService.js`、`syncService.js`（mapStatus）、`cron/index.js` | **线上漏播报根因**：按组别并行的新审批流把多个分支节点名以「；」拼接写入「审批节点」字段（如 5 组工单 = 5 段重复），原整串精确匹配对不上 → 创建事件不播报、对账不补播、审批联动拒绝。修后该工单部署即被对账自动补播 |

## 6. 功能新增：多人接单（2026-09-05，需求方提供审批流截图）

无指定负责人工单在审批表单勾选「是否允许多人接单」=是 时的续接窗口机制（`ticket-bot config.multiAccept` + `ticketService` + `approvalLinkService`）：

```
公开问询播报（现状不变）
   └─ 有人 @接单 → 合并写补充负责人 + 看板人员字段（状态 in_progress，现状不变）
        ├─ 「是否允许多人接单」≠是 → 接单即批量通过全部触发节点审批（原行为，扩展为批量）
        └─ =是 → 不通过审批；写「多人接单截止」= now+6h（工单级计时器，多组别共享）
                 → 向已有人接单的群（接单人组别群 ∪ 接单发生群）发「👥 多人接单进行中」卡
                 ├─ 窗口内又有人接单 → 合并补充负责人 → 重置 6h → 再次群内通告（循环）
                 └─ 窗口到期无人续接 → 每分钟对账自动通过全部触发节点任务（10 分钟节流，
                                        失败下轮重试）→ 向已接单的群发「✅ 多人接单结束」卡
                                        → 审批流汇合推进到「回执单：是否结单」（走既有结单提醒）
```

配套改动：审批联动缓存改 `{申请编号 → {taskId → 任务}}` 集合并**批量通过**（并行分支全部任务才能汇合流转，原单任务缓存会被后到任务覆盖）；接单回退池放行"多人单窗口期"工单（补充负责人已有人仍可续接）；对账新增非多人单"接单后审批补通过"补偿。配置与环境变量见 `.env.example`「多人接单」段。

> **上线前提（2026-09-05 核查）**：工单表已有「是否允许多人接单」列（单选，列名与 `MULTI_ACCEPT_FIELD` 默认值一致），但近期记录该列取值均为空——审批表单 → 多维表格的同步自动化尚未映射该字段。**映射补上并确认新单有值前，多人单分支不生效**（一律按"否"走接单即通过）。

> **并行分支节点值格式**：按组别并行的审批流会把该层多个分支的节点名以「；」拼接写入「审批节点」字段（实测 5 组工单 = `群内有组员接单后通过；×5`）。所有触发节点判断统一走 `config.matchNodeValue` 拆段匹配（播报/对账/审批联动守卫/超时检查），新增判断处不要再用整串精确比对。
