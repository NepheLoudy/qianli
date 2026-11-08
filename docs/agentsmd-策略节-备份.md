## 模型调用策略：均衡负载 · 供应商单元 · 三层降级（v4.5.2，2026-11-06 恢复）

> ⚠ 本节累计回滚十次（更新/agent 注册/配置变更窗口触发）。自愈三备份：本节 + `~/.agents/tools/pool-listener/agentsmd-策略节.md` + `D:/dev/qianli/docs/agentsmd-策略节-备份.md`。**备份刷新必须过完整性 key 校验**。新增/修改 agent 定义或 magpie 配置后必须复查本节。

### 常驻 skill（意图命中即调）
- brainstorming（创造性工作前必跑、接项目第一站）、writing-plans、frontend-design、TRAE 三件套。常驻 = 触发即调，不是常驻上下文。

### 核心架构：岗位 = 角色，模型不锁死，三层降级
- **岗位按供应商为单元，不按模型锁定**：模型由平台动态供给（目录波动常态：gpt-5.4 下架、deepseek-v4.1 上架、raccoon/qoder 新平台接入）。**三层降级**：①网关组（无感，首选）→ ②listener advice（policy.json 降级链+嗅探）→ ③手工切档。
- **降级链唯一真源 = ~/.agents/tools/pool-listener/policy.json**；派发前读监听器状态（schtasks「pool-listener」每 30 分钟刷新）。
- 派发规则：轻任务按岗位定义派发；并行流水线/精确控制用 CreateWorkflow subagent_model 挂组。

### 网关层降级组（六个，magpie CLI 部署）
- group/dev（order：workbuddy glm-5.3→trae-cn max→wb flash）、group/dev-swarm（rotate+stays=session，≥3 并行跨平台摊并发）、group/aux（routing=free：hy3+raccoon 双免费+qoder 三兄弟+0.1× 兜底——勤务兵团，质量链禁入）、group/review（deepseek-v4.1→trae-cn max）、group/crosscheck（trae-global deepseek 双档）、group/grunt（rotate）。**质量链零免费模型**（v4.4.1 P0 已修）。
- magpie CLI：groups/group add/set（routing=order|smart|drain|rotate|free|cheap…）、provider fallback、usage --csv（按 session id 归因）、quota history/wait、sync。

### 十一岗与分发
- 开发/评审工位：dev-worker（group/dev）、dev-worker-b（workbuddy+codearts/autoclaw 溢出）、dev-worker-cn（harden 链，两轮无进展必须上报）、expert-review（group/review）、cross-check（直连 deepseek 优先）。
- 勤务兵团：hy3-verifier / scout / reviewer / ideate / grader / archivist（group/aux，免费/低倍率，只接侦察/核查/审校/头脑风暴/分级/记账/格式检查/批量摘要，**严禁流入质量链**）。
- 分发三重+平台相撞检查由 wave-board 机械强制；池限额已按并发嗅探实测（workbuddy 6/raccoon 4/trae-cn 3）。

### 接项目并行 SOP（四域规则）
1. brainstorming → 2. hy3-scout 侦察摘要 → 3. 主会话分割（任务卡七要素：id/目标/接口契约/**可执行验收标准**/文件范围/难度/工位；无同文件双写、依赖单向）→ 4. hy3-grader 评难度 → 5. **波次分发**（**波次看板** wave-board 入板；单批 3~5；复杂 DAG 用 CreateWorkflow subagent_model 挂组 magpie/group/*）→ 6. 验收三班 → 7. 失败矩阵（重试 1 → 链下一档 → 上报）→ 8. 收工记账（ADR-lite）。
- 头脑风暴：hy3-ideate 视角集（架构=演进/复杂度/故障面；功能=体验/边界/滥用；算法=正确性/复杂度/假设；兜底=反方）；实例数随 workbuddy 水位弹性。
- 契约冻结：工位要改契约必须停手上报，主会话裁决广播。

### 任务四层模型（L0-L3）
- **L0 主线**（主会话亲自）：调度、契约、验收裁决、核心件、不可逆、配置变更。
- **L1 协作**（同步等结果）：单点快查。
- **L2 并行**（后台 run_in_background，与主线同时）：scout 前置/verifier 随改随核/ideate 碰撞/reviewer 初审/dev 工位波内并行——**日常小任务同样启用**。
- **L3 自主任务树**（节点触发的后台长任务）：记忆整理树/文档补全树/技术债巡检树。

### 记忆生长·节点感知
- 触发信号：波次完成/归档提交或 push/版本锚点/契约变更/里程碑/会话收工/~2h 自检 → 后台派 **hy3-archivist** 出整理包（事件 JSON+CONTEXT 建议+文档草稿+journal 素材），主会话校验后批量单事务落盘。
- Stop hook（node-stop-reminder）：git 仓库+90min 内提交+晚于最后记账 → 注入整理提醒。

### 多对话并行 + 让路
- **会话注册局**（session-registry）：claim 圈地（文件范围+主战平台）、三色模式（dev 写/consult 只读/plan 只读）、配置变更单行道（只在主控会话改）。
- **让路协议**：后到对话读 registry 避开先到对话主战平台；同平台撞上转 aux 或错波次；让路是软规则，波次完成自然释放。
- SessionStart hook（node-session-start）：开场注入并行态势（在册对话+池水位+dev 推荐）。
- 单干警戒线（PostToolUse Edit|Write|Bash|Agent）：**Agent 派发重置计数**；10 次/30min 冷却注入提醒；强串行互斥链允许单干+伴随核查。

### 发言即分解 + 派发模式
- **每条发言动手前跑分解三问**（UserPromptSubmit hook 注入）：①L0 ②可立即后台派（免费岗/工位组）③主线最小集。**混合参与是默认，单干需要理由**；派发可见（谁在跑要说）。
- **派发模式规则**：秒级才同步，分钟级一律 run_in_background——主线绝不空等。

### 机器级禁区（v4.5.3，曼波定：告知其他工作区不要编辑的区域）
### 监听与边界（如实）
- 实时水位仅 magpie 内平台（deepseek/bigmodel 直连不可查）；运营商限速优化=网关内置（无开关）；表现数据 magpie usage --csv（**按 session id 归因**）、quota history/wait。
- **核心锁死**：本机 bigmodel 与 start-plan 永不参与切换；主会话 BigModel 直连实锤（session 聚合）；account 池吃核心，magpie 池吃外围。


### 并行生命周期 + 并行派发通道规则（v3.5-v3.9 规则索引）
- **并行生命周期**：并行是每个阶段重新评估的决定——收尾/归档阶段同样并行（主会话只留 commit/锚点/裁决），同文件反复小步编辑整包派一个工位或伴随核查。
- **并行派发通道规则**：并行 ≥2 禁裸 general-purpose（继承主会话挤单通道）——三选一：工位定义 / CreateWorkflow subagent_model 挂组 / 挂组岗位；撞限立即换组员或链下一档重派，审查侦察类转 aux 分流。
- **波次看板**（wave-board）：开发阶段在途状态唯一真源（跨压缩存活）——add/start 三重+平台相撞检查/done/fail/board/setpool/gc；池限额已按并发嗅探实测灌入。
- **v4.0 全量审查修正**：警戒线 Agent 派发重置计数；wave-board stale 6h；listener urgent 样本门；波次收编批处理（完成通知波间批量收编，主线只在检查点停）。
- **v4.1 大更新适配**：五网关组升一等模型（magpie/group/*），CreateWorkflow subagent_model 挂组；组 id 双命名（ZCode 层 magpie/group/、网关层 group/）；同名覆盖 general-purpose 被读取（model=magpie/group/dev-swarm 待新会话复验）；agent 定义不热载。
- **v4.0.2 hook 空转事故**：0.17 hook stdout 严格 JSON schema，裸文本整条丢弃——三脚本已改 additionalContext；验证三步=stdout 合法 JSON+日志无 hook.run.failed+真实会话 rollout 搜注入文本；「脚本手动跑通」≠「hook 生效」。
- **v4.2 免费顺位制度**→**v4.3 优先跨平台**（--avoid/--group+平台相撞拦截，--cross-platform-ok 放行）→**v4.4 大扩容适配**（平台 5→9、catalog 30、勤务兵团 group/aux 8 成员、质量链扩容 codearts/autoclaw/zed 异源重炮）——细节见 qianli docs 全量审查报告。
### v4.x 修正档案
- v4.2 免费顺位→v4.3 优先跨平台（--avoid/--group+相撞拦截）→v4.4 大扩容+免费定位纠偏（免费=外围打杂勤务兵团，质量链零免费）→v4.4.1 P0（dev 链混入 hy3 已摘）→v4.5 智能化分发（并发嗅探灌限额 workbuddy6/raccoon4/trae-cn3、限速灵敏度 4h 窗+ttft2×/立即换组员、跨对话让路）→v4.5.1 嗅探数据收编→**v4.5.2 本次恢复**。
