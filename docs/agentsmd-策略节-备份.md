## 模型调用策略：均衡负载 · 供应商单元 · 三层降级（2026-11-03 曼波定，v3.2）

> ⚠ 本节已被外部进程回滚三次（时刻均与 ~/.zcode/agents/ 定义注册/配置变更强相关，疑似 ZCode 重载 agent 时以旧快照覆盖）：**每次新增/修改 agent 定义或 magpie 配置后必须复查本节**，消失即从自愈副本 `~/.agents/tools/pool-listener/agentsmd-策略节.md` 恢复；完整正本在 qianli 仓库 `docs/magpie-策略全量审查-20261103.md` 与 `docs/magpie-调用策略.md`。

### 核心架构：岗位 = 角色，模型不锁死，三层降级
- **岗位按供应商为单元，不按模型锁定**（曼波 2026-11-03 定）：AI 池持续波动（平台动态供给，当日实测 gpt-5.4 下架、deepseek-v4.1 上架、新账号入池），一切模型选择走**三层降级**：①网关层 magpie 路由组（无感，首选）→ ②监听器 advice（policy.json 降级链择优）→ ③主会话手工切档。
- **降级链唯一真源 = `~/.agents/tools/pool-listener/policy.json`**；派发前读监听器状态（schtasks「pool-listener」每 30 分钟自动刷新）。
- 派发规则：轻任务 Agent 工具按岗位定义（model 写 group/<id> 或链首模型）；并行流水线/精确控制用 CreateWorkflow `subagent_model` 动态传链上模型。

### 网关层降级组（magpie CLI 部署，2026-11-03）
- `group/dev`：workbuddy/glm-5.3 → trae-cn/glm-5.3-flash-max → workbuddy/glm-5.3-flash → workbuddy/hy3（免费兜底），routing=order
- `group/review`：trae-global/deepseek-v4.1-flash-max → trae-cn/glm-5.3-flash-max（gpt-5.4 目录恢复后 `magpie group set review models+=trae-global/gpt-5.4` 加回首位）
- `group/crosscheck`：trae-global/deepseek-v4.1-flash-max → -flash
- `group/dev-swarm`：workbuddy/glm-5.3 · trae-cn/glm-5.3-flash-max · workbuddy/glm-5.3-flash，**routing=rotate + stays=session**——并发分摊专用：单批并行 ≥3 个开发工位时改派这个组，每个工位被轮转到**不同平台成员**并钉死，**同 AI 模型跨平台躲避单平台并发上限**；小批（≤2）仍用 group/dev（order 降级）。
- magpie 原生 CLI：`magpie groups`（列组）、`group add/set`（routing=order|smart|drain|weight…、models+=/-、levels）、`provider fallback <id> <m…>`（供应商级 out-of-quota 降级）、`magpie usage --csv`（**按 session id 归因**）、`magpie quota history/wait`、`magpie sync`（目录刷新）。

### 十岗与降级链表（角色 → chain，真源以 policy.json 为准）
- 开发工位：dev-worker（主力，model=group/dev）/ dev-worker-b（二线，workbuddy 链，末端 hy3 免费兜底）/ dev-worker-cn（攻坚，trae-cn → workbuddy；两轮无进展必须上报）
- 评审/交叉：expert-review（model=group/review，跨供应商兜底时报告标注「异源变同源」）/ cross-check（直连 deepseek-v4-pro 优先 → group/crosscheck 兜底）
- 基础工位群：hy3-verifier / hy3-scout / hy3-reviewer / hy3-ideate / hy3-grader（免费恒定，只读不写）
- 监听器组感知：group/* 条目水位取组内最弱成员（瓶颈口径）；链上模型目录校验自动跳档。

### 接项目并行 SOP（v3.1 四域规则）
1. brainstorming 定需求（常驻第一站）→ 2. hy3-scout 侦察摘要 → 3. 主会话分割（**任务卡七要素**：id/目标/接口契约/**可执行验收标准**/文件范围/难度/工位；模块边界、无同文件双写、依赖单向）→ 4. hy3-grader 评难度 → 5. **波次分发**：依赖分层成 wave，波内单消息并行派发（单批 3~5，同池在途 ≤2），波间集成验收 + 重跑监听器；复杂 DAG 用 CreateWorkflow → 6. 验收三班（hy3-verifier 机械核查 + cross-check 异源交叉 + expert-review 评审）→ 7. 回炉（失败矩阵：重试 1 次→链下一档→上报拆任务）→ 8. 收工记账（派发批次与结论入 events/CONTEXT.md，ADR-lite）。
- **头脑风暴常驻**：hy3-ideate 标准视角集（架构=演进/复杂度/故障面；功能=体验/边界/滥用；算法=正确性/复杂度/假设；兜底=反方找茬）；实例数随 workbuddy 水位（≥0.6→3、0.3~0.6→2、<0.3→1）。
- **契约冻结**：分割后契约冻结，工位要改契约必须停手上报，主会话裁决广播。

### 常驻 skill 与实时参与
- 常驻 skill（意图命中即调）：brainstorming（创造性工作前必跑）、writing-plans、frontend-design、TRAE 三件套。常驻 = 触发即调，不是常驻上下文。
- 子智能体实时参与起手式：会话起手后台派 hy3-scout（run_in_background）不阻塞；随改随核 verifier；关键设计 ideate×2~3；收尾 reviewer + checklist。产出必须经「## 建议记账」进 events/日志留痕。

### 多对话并行（v3.3，2026-11-03 曼波定：最大化并行，主开发不被撞截停）
- **会话注册局**（`~/.agents/tools/pool-listener/session-registry.js`）：多对话同仓开发前先 `claim` 抢注文件范围（glob），冲突当场暴露并给处置（换范围/转只读/等待），不靠 Edit 报错后截停；`status` 全局在册、`release` 收工注销、6h 无心跳自动 gc。冲突判定：同工作区 + dev 模式 + glob 交集。
- **三色并行模式**：
  - **dev（写）**：必须先 claim 成功才动文件；范围 = 任务卡的文件范围；收工 release。
  - **consult（只读）**：评审/侦察/查资料/头脑风暴——永不撞写，免抢注（默认开侧会跑这些最安全）。
  - **plan（只读）**：规划/写文档/大纲——同 consult；产出文件若与 dev 会话范围重叠，等对方 release 或征得同意。
- **配置变更单行道**：AGENTS.md、agent 定义（~/.zcode/agents/）、magpie 配置只在**一个会话**（主控）里改；改完其他会话重启生效——多会话同时改配置是 AGENTS.md 三次回滚的最可能真凶。
- **主开发被撞急停处置**：侧会话立即转 consult 模式（只读），等主会话 release 后再 claim 写权限。
- 派子代理不受注册局约束（子代理共享主会话身份与 scope）。

### 任务四层模型（v3.4，子代理与主工作并行常态——日常同样启用，不只接项目）
- **L0 主线**（主会话亲自同步）：调度、契约、验收裁决、核心件、不可逆操作。
- **L1 协作**（子代理同步等结果）：单点快查、小片段侦察。
- **L2 并行**（后台子代理 run_in_background，与主工作同时跑）：scout 前置、verifier 随改随核、ideate 碰撞、reviewer 初审、dev 工位波内并行——完成通知到达后收编，主会话不空等。
- **L3 自主任务树**（节点触发的后台长任务）：记忆整理树、文档补全树、技术债巡检树——见下节。

### 记忆生长·节点感知（v3.4，曼波定：感知到节点自行整理记忆与文档，不用催）
- **触发信号**（命中任一立即触发）：波次/wave 完成；git 归档提交或 push 完成；版本锚点/DEVLOG 版本递增；接口契约变更；任务卡里程碑达成；会话收工；长会话每 ~2h 周期自检。
- **动作**：主会话立即后台派 **hy3-archivist**（独立任务树，免费池，不阻塞主线）：依据 events/domains/git 变更/docs 现状产出「记忆整理包」（事件条目 JSON + CONTEXT.md 更新建议 + 文档草稿 + journal 素材）。
- **收编**：主会话校验整理包后**批量落盘**（单事务写入 events/CONTEXT/docs），保持域记忆协议（子代理只读、主会话收编）；无可整理增量则如实记一句，不硬凑。
- **兜底**：Stop hook（node-stop-reminder）在「git 仓库 + 90min 内有提交且晚于最后记账」时自动注入整理提醒——会话收尾不漏节点。

### 监听与边界（如实）
- 实时水位仅 workbuddy/trae-cn/trae-global（magpie quotas，含健康分/临期/ETA 粗估）；deepseek 与 bigmodel 不在 magpie 上游，水位本地不可查，用量看各平台控制台。
- 运营商限速优化 = magpie 网关内置自动行为（无公开开关）；表现数据 `magpie usage --csv`、`magpie quota history --json`。
- **核心锁死**：本机 bigmodel 与 start-plan 永不参与切换；主会话走 BigModel 直连实锤（按 session id 归因，2026-11-03 更正）；account 池吃核心与主力，magpie 池吃外围与并行。


### 并行生命周期（v3.5，曼波定：并行不是接项目一次性决定，每个阶段重新评估）
- **收尾/归档阶段同样是并行机会**，标准切法：主会话只留 git add/commit（互斥）、版本锚点、最终裁决；可并行部分照常派发——DEVLOG/registry/文档一致性核查（hy3-verifier 后台）、记忆整理（v16x 归档提交=版本锚点，hy3-archivist 自动触发）、跨文件联动草稿（dev-worker-b 起草主会话过目）。
- **单干警戒线**（PostToolUse hook：node-solo-tripwire，Edit/Write/Bash 计数，阈值 10 次、30 分钟冷却）：连续亲自执行且未见并行派发时注入自检提醒——可拆的立即派 L2/L3；**强串行互斥链（如同文件连续编辑+提交链）允许单干**，但至少并行派出伴随核查。警戒线是自检提醒，不是禁令；默认倾向并行。
- 同文件反复小步编辑（如 DEVLOG 连续追加）天然单线程——这类活**整包派给一个工位**后台做（主会话只验收），或主会话干但派 archivist/verifier 伴随，两不耽误。
