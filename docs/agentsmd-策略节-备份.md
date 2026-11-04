## 模型调用策略：均衡负载 · 供应商单元 · 三层降级（2026-11-03 曼波定，v3.6）

> ⚠ 本节已被外部进程回滚五次（均与 agent 定义注册/客户端配置变更窗口强相关）。自愈三备份：本文件策略节 + ~/.agents/tools/pool-listener/agentsmd-策略节.md + D:/dev/qianli/docs/agentsmd-策略节-备份.md——**刷新备份必须过七 key 完整性校验，防残缺版污染备份**。每次新增/修改 agent 定义或 magpie 配置后必须复查本节。

### 核心架构：岗位 = 角色，模型不锁死，三层降级
- **岗位按供应商为单元，不按模型锁定**（曼波 2026-11-03 定）：模型由平台经 magpie 动态供给、目录波动是常态（当日实测 gpt-5.4 下架、deepseek-v4.1 上架、新账号入池）。
- **三层降级**：①网关层 magpie 路由组（无感，首选）→ ②监听器 advice（policy.json 降级链择优）→ ③主会话手工切档。
- **降级链唯一真源 = ~/.agents/tools/pool-listener/policy.json**（roles.*.chain）；派发前读监听器状态（schtasks「pool-listener」每 30 分钟刷新）。
- 派发规则：轻任务 Agent 工具按岗位定义；并行流水线/精确控制用 CreateWorkflow subagent_model 动态传链上模型。

### 网关层降级组（magpie CLI 部署）
- group/dev：workbuddy/glm-5.3 → trae-cn/glm-5.3-flash-max → workbuddy/glm-5.3-flash → workbuddy/hy3（免费兜底），routing=order
- group/dev-swarm：workbuddy/glm-5.3 · trae-cn/glm-5.3-flash-max · workbuddy/glm-5.3-flash，**routing=rotate + stays=session**——并发分摊：单批并行 ≥3 开发工位改派此组，每工位轮转钉到不同平台，同系模型跨平台躲避单平台并发上限；≤2 仍用 group/dev。
- group/review：trae-global/deepseek-v4.1-flash-max → trae-cn/glm-5.3-flash-max（gpt-5.4 目录恢复后 magpie group set review models+=trae-global/gpt-5.4 加回首位）
- group/crosscheck：trae-global/deepseek-v4.1-flash-max → -flash
- magpie 原生 CLI：magpie groups / group add / group set（routing=order|smart|drain|weight…、models+=/-、levels）、provider fallback <id> <m…>（供应商级 out-of-quota 降级）、magpie usage --csv（按 session id 归因）、magpie quota history/wait、magpie sync。

### 十岗与降级链表（真源以 policy.json 为准）
- 开发工位：dev-worker（主力，model=group/dev）/ dev-worker-b（二线，workbuddy 链末端 hy3 免费兜底）/ dev-worker-cn（攻坚，trae-cn → workbuddy，两轮无进展必须上报）
- 评审/交叉：expert-review（model=group/review，跨供应商兜底时报告标注「异源变同源」）/ cross-check（直连 deepseek-v4-pro 优先 → group/crosscheck 兜底）
- 基础工位群：hy3-verifier / hy3-scout / hy3-reviewer / hy3-ideate / hy3-grader / hy3-archivist（免费恒定，只读不写）
- 监听器组感知：group/* 条目水位取组内最弱成员；链上模型经 /v1/models 目录校验自动跳档。

### 接项目并行 SOP（v3.1 四域规则）
1. brainstorming 定需求（常驻第一站）→ 2. hy3-scout 侦察摘要 → 3. 主会话分割（**任务卡七要素**：id/目标/接口契约/**可执行验收标准**/文件范围/难度/工位；模块边界、无同文件双写、依赖单向）→ 4. hy3-grader 评难度 → 5. **波次分发**：依赖分层成 wave，波内单消息并行派发（单批 3~5，同池在途 ≤2），波间集成验收 + 重跑监听器；复杂 DAG 用 CreateWorkflow → 6. 验收三班（hy3-verifier + cross-check 异源 + expert-review）→ 7. 回炉（失败矩阵：重试 1 次 → 链下一档 → 上报拆任务）→ 8. 收工记账（派发批次与结论入 events/CONTEXT.md，ADR-lite）。
- **头脑风暴常驻**：hy3-ideate 标准视角集（架构=演进/复杂度/故障面；功能=体验/边界/滥用；算法=正确性/复杂度/假设；兜底=反方找茬）；实例数随 workbuddy 水位（≥0.6→3、0.3~0.6→2、<0.3→1）。
- **契约冻结**：分割后契约冻结，工位要改契约必须停手上报，主会话裁决广播。

### 任务四层模型（v3.4，子代理与主工作并行常态——日常同样启用）
- **L0 主线**（主会话亲自同步）：调度、契约、验收裁决、核心件、不可逆操作。
- **L1 协作**（子代理同步等结果）：单点快查、小片段侦察。
- **L2 并行**（后台 run_in_background，与主工作同时跑）：scout 前置、verifier 随改随核、ideate 碰撞、reviewer 初审、dev 工位波内并行——完成通知到达后收编，不空等。
- **L3 自主任务树**（节点触发的后台长任务）：记忆整理树、文档补全树、技术债巡检树。

### 记忆生长·节点感知（v3.4，曼波定：感知到节点自行整理，不用催）
- **触发信号**（命中任一立即触发）：波次/wave 完成；git 归档提交或 push；版本锚点/DEVLOG 版本递增；接口契约变更；任务卡里程碑达成；会话收工；长会话每 ~2h 自检。
- **动作**：立即后台派 hy3-archivist（独立任务树，免费池）：依据 events/domains/git 变更/docs 产出「记忆整理包」（事件条目 JSON + CONTEXT.md 建议 + 文档草稿 + journal 素材）。
- **收编**：主会话校验后批量单事务落盘，域记忆协议不变（子代理只读）；无可整理增量如实记一句。
- **兜底**：Stop hook（node-stop-reminder）在「git 仓库 + 90min 内提交且晚于最后记账」时注入整理提醒。

### 多对话并行（v3.3，曼波定：最大化并行，主开发不被撞截停）
- **会话注册局**（~/.agents/tools/pool-listener/session-registry.js）：多对话同仓开发先 claim 抢注文件范围，冲突当场暴露（换范围/转只读/等待）；status 全局在册、release 注销、6h 无心跳 gc。
- **三色并行模式**：dev（写）必须 claim 成功才动文件，收工 release；consult（只读）评审/侦察/头脑风暴永不撞写免抢注——侧会话默认开这个；plan（只读）产出撞范围等对方 release。
- **配置变更单行道**：AGENTS.md、agent 定义、magpie 配置只在主控会话改；主开发被撞急停：侧会话立即转 consult。子代理不受注册局约束。

### 并行生命周期（v3.5，曼波定：并行是每个阶段重新评估的决定）
- **收尾/归档阶段同样是并行机会**：主会话只留 git add/commit（互斥）、版本锚点、最终裁决；一致性核查派 verifier 后台、记忆整理由 archivist 节点自动触发、文档联动工位起草主会话过目。
- **单干警戒线**（PostToolUse hook：node-solo-tripwire，Edit/Write/Bash 计数，阈值 10 次、30 分钟冷却）：连续亲自执行且未见并行派发时注入自检提醒；强串行互斥链允许单干但至少派伴随核查。警戒线是提醒不是禁令，默认倾向并行。
- 同文件反复小步编辑天然单线程——整包派给一个工位后台做，或主会话干 + archivist/verifier 伴随。

### 并行派发通道规则（v3.6，曼波定：撞上限要合理平衡负载）
- 并行 ≥2 禁止裸 general-purpose——它继承主会话模型挤单通道，start-plan 并发槽一满就排队截停（approval-bot 三审查工位实战教训）。三选一：①十岗工位定义（dev-worker=group/dev 等）②CreateWorkflow subagent_model=group/dev-swarm ③挂组岗位。
- 同名覆盖 general-purpose（model=group/dev-swarm）当前会话未生效（微任务实派仍走直连，疑似同名覆盖被客户端忽略），~/.zcode/agents/general-purpose.md 保留待重启复验。
- **撞限处置**：被截停工位不傻等——立即换组成员（group 内另一模型）或链下一档重派；审查/侦察类转 hy3 免费池分流；并发槽优先保 dev 工位。

### 常驻 skill 与实时参与
- 常驻 skill（意图命中即调）：brainstorming（创造性工作前必跑、接项目第一站）、writing-plans、frontend-design、TRAE 三件套。常驻 = 触发即调，不是常驻上下文。
- 子智能体实时参与起手式：会话起手后台派 hy3-scout（run_in_background）不阻塞；随改随核 verifier；关键设计 ideate×2~3；收尾 reviewer + checklist。产出必须经「## 建议记账」进 events/日志留痕。

### 监听与边界（如实）
- 实时水位仅 workbuddy/trae-cn/trae-global（magpie quotas，健康分/临期/ETA 粗估）；deepseek 与 bigmodel 不在 magpie 上游，水位本地不可查，用量看各平台控制台。
- 运营商限速优化 = magpie 网关内置自动行为（无公开开关）；表现数据 magpie usage --csv、quota history --json。
- **核心锁死**：本机 bigmodel 与 start-plan 永不参与切换；主会话走 BigModel 直连实锤（按 session id 归因）；account 池吃核心与主力，magpie 池吃外围与并行。

### 发言即分解（v3.7，曼波定：每条发言都要有多智能体+低价免费模型混合参与）
- **每条用户发言动手前先跑「分解三问」**：①哪些是 L0（必须我亲自：裁决/契约/核心件/不可逆/配置变更）？②哪些能立即后台派（读/查/核/审→hy3 免费岗；代码勘察→hy3-scout；开发→工位组）？③主线最小集是什么？——先派发再主线开工，两线同时跑。
- **混合参与最低标准**：涉及本仓代码/文档/记忆的发言 → 至少 1 个 hy3 后台伴随（scout 查证 / verifier 核对 / archivist 节点整理）；主线亲自 grep/读长文件前先想 scout；需要证据的回答派 scout 取证再综合，不自己埋头翻。
- 纯对话无工具需求的发言可单 agent 直答；涉及事实核查仍派 scout。配置变更类发言（AGENTS.md/agent/magpie 配置）属 L0 单行道，主会话亲自做是合规单干。
- UserPromptSubmit hook（node-inject-dispatch）每条发言注入一行分解提醒——机械兜底，不靠自觉。
- 展示要求：派发了什么、谁在跑，回复里让曼波看得见（子智能体工作必须可见，这是 v3.3 实时参与规则的发言级落实）。
- **派发模式规则（v3.8，曼波纠偏：同步派发堵主线）**：同步派发只用于**秒级**任务；预期分钟级及以上的子代理任务一律 `run_in_background: true`——主线绝不空等，派完继续干下一件事，完成通知到达再收编。「等子代理结果」不是主线停工的理由；主线空转等结果 = 分解失败。
- **波次看板（v3.9，开发阶段并发多线的持久化协调台）**：`node ~/.agents/tools/pool-listener/wave-board.js`——开发波次/任务卡入板（add：工位/模型/文件范围/依赖），开工前 start 跑三重机械检查（依赖完成 / 文件互斥无同文件双写 / 同池限额：默认 ≤2、group/dev-swarm ≤5 轮转摊并发），done/fail 收板，board 视图查在途池负载。**看板是开发阶段在途状态的唯一真源——跨压缩存活**，主会话压缩后重读 board 即恢复全场态势；`setpool` 可调池限额。接项目 SOP 第 5 步（波次分发）与本会话任何多工位开发都必须走板。
- **v4.0 全量审查修正（2026-11-03 夜）**：①单干警戒线 **Agent 派发重置计数**（PostToolUse matcher 含 Agent，stdin tool_name=Agent → 重置）——并行波次中子代理干活不再误报单干，派发即证明并行在发生；②wave-board **stale 机制**：in-flight 超 6h 自动排除限额与互斥计数（gc 转 stale 待人工复核），死会话不再永久占池；③listener **urgent 可靠性门**：burn 样本 <3 不触发「抢先消耗」（防稀疏 ETA 误报）；④workbuddy 池限额 3（3 账号轮询，hy3 免费群有余量）；⑤**波次收编批处理**：子代理完成通知在波间检查点批量收编，不逐条打断主线——效率核心：主线只在检查点停下。
- **v4.1 大更新适配（ZCode 3.17.2 / CLI 0.17.1，2026-11-04）**：①**五个网关组升级为 ZCode 一等模型**（ListModels 24 条含 magpie/group/*）——CreateWorkflow `subagent_model` 可直接挂组（verbatim 用 `magpie/group/dev-swarm` 等），DAG 工作流子代理全走网关路由；②**组 id 双命名**：ZCode 层（agent 定义 model 字段、subagent_model）用 `magpie/group/<id>`；magpie 网关层（/v1/models catalog、policy.json）用 `group/<id>`——policy.json 保持 group/* 不改（它对的是网关层）；③同名覆盖 general-purpose 在大更新后被读取（旧版完全忽略——报错从「无档位」变「Provider 不存在」实锤），model 已改 `magpie/group/dev-swarm`，待新会话复验；④agent 定义改文件不热载（会话内缓存），复验一律开新会话；⑤raccoon sensenova 档位为 disabled,enabled（非标准语义，组内最弱成员拉低组档位）——勿把它加进需要推理档位的组。
- **⚠ v4.0.2 hook 空转事故修复（2026-11-04，曼波揭发「新会话没用上子智能体协作」）**：hook 三件套自部署起**从未成功注入**——日志 hook.run.failed 铁证：0.17 的 hook stdout 按严格 JSON schema 解析，**裸文本输出整条效果被丢弃**（diagnosing-hooks 技能坑 #8）。已修复：三脚本全部改输出 `{"additionalContext": "..."}`，三态实测（注入/静默/构造节点触发）全过。**教训：写 hook 必须先读 diagnosing-hooks 的 output schema；「脚本手动跑通」≠「hook 生效」——必须查日志 hook.run.* 确认 outcome**。hook 生效验证三步：①脚本 stdout 是合法 JSON 且只含 additionalContext ②日志无 hook.run.failed ③真实会话 rollout 里搜注入文本。
- **v4.2 免费顺位制度（2026-11-04，曼波定：免费模型不止一个做平行顺位，失效自动嗅探最低倍率）**：①**网关组 group/free-swarm**（routing=free 原生策略：只用免费成员，hy3→raccoon 双免费→glm-5.3-flash 兜底；stays=session 钉定）——**base 基础工位群（hy3 六岗）与 grunt 已挂此组**；②**倍率嗅探**：catalog 的 pricing 字段机器可读（prompt/completion 单价），listener 输出 freeModels（pricing=0 清单，实测 5 个：hy3/trae 系三模型/raccoon sensenova）与 cheapestPaid（最低倍率付费模型，实测 auto/glm-5.3-flash 1.2e-7/tok）；③**免费失效自愈**：某免费模型下架/开始计价 → pricing≠0 自动移出 freeModels，组内 routing=free 自动跳过；新免费模型入目录 → magpie group set free-swarm models+=<id> 纳入（免费时效性波动的自适应闭环）；④注意：routing=free 语义是「只用免费成员」，组内兜底成员 glm-5.3-flash 是 0.08× 付费会被跳过——若要求纯免费顺位，改用 routing=order 并保持成员全免费。
- **v4.3 优先跨平台（2026-11-04，曼波定：防内部撞车——今天 Trae 线断两次实证单平台押注风险）**：派生工位选池/入板时**避开主线与兄弟工位正在用的平台**。实现：wave-board `--avoid <平台,..>`（任务声明避开平台）+ `--group <成员,..>`（组内成员清单参与平台集合计算），start 新增第四重检查「平台相撞」：任务平台集合（model provider + group 成员 provider + avoid 声明）与在途任务相交 → 拦截 exit 1 并给处置（换组/换链），`--cross-platform-ok` 显式放行。派发纪律：主线在 X 平台跑时，派生工位优先选非 X 的组/链；主任务平台由其任务卡 avoid 字段登记。**单平台断线风险**：任何平台都可能抽风（Trae 当日两断），关键路径不要全押一个平台。
- **v4.4 大扩容适配 + 免费定位纠偏（2026-11-04，曼波：模型池平台大扩张+「不是免费优先，是免费打杂，之前定义有问题」）**：①**平台 5→9**（新：qoder-cn/zed/qwenwork/codearts/autoclaw-zhipu，catalog 30 模型）；②**纠偏核心**：免费模型的价值不在省，在**外围打杂的多线产能**——组成独立**勤务兵团 group/aux**（hy3+sensenova 双子+lite+glm-5.3-flash，routing=free），只承接侦察/核查/审校/头脑风暴/分级/记账/格式检查/批量摘要，**严禁流入质量链**（dev/review/harden/crosscheck 链内零免费模型，此前 base 群混入 raccoon 免费模型属定义污染，已清除）；③质量链扩容：dev-b 入 codearts/autoclaw 同家族溢出位、harden 入 trae 5.3-max 顶位+zed/claude-sonnet-5 异源重炮、review 入 zed/gemini-3.5 真异源血统；④**升级/降级策略 v2**：升级阶梯=同家族溢出（codearts/autoclaw 0.08×）→ 异源重炮（zed claude/gemini）→ 上报；降级只沿本链走，质量链降级链内零免费模型；⑤free 顺位组改名 aux（free-swarm 已拆）；⑥pricing undefined 的新平台（trae/qoder/autoclaw）量纲未明，嗅探对它们按「订阅制不透明」处理，入 aux 需实测免费性。
- **v4.5 智能化分发 + 限速灵敏度 + 跨对话让路（2026-11-04，曼波：提高开发智能化与分发效率，最大化并行）**：
  - **并发嗅探**：listener 新增 poolLimits 嗅探数据（各平台「平滑并发档/拐点档」，由免费岗探测矩阵实测：并发 1→6 递增观察 ttft 中位数翻倍或 429/5xx 拐点），wave-board 的池限额从静态默认值改为**优先读嗅探值**（poolLimits 嗅探文件 > policy 默认）。
  - **限速/断线灵敏度**：健康分衰减窗口收紧（24h→4h，近因权重更大）；ttft 中位数 2× 基线 = 该池「降速警戒」（advice 标 throttle，排序自然下沉）；**换平台灵敏度**：出现 429/5xx/连续两次 ttft>60s → 该工位立即换组员重派（不等重试完），原任务标记 interrupted 由主线改派。
  - **跨对话让路协议**（多对话并行时防撞并发上限）：①各对话开工先在 session-registry 登记本对话「主战平台」（claim --avoid 已扩展为主战平台声明）；②后到对话**自动让路**：派发前读 registry，已有对话主战 workbuddy → 后到对话优先 trae/raccoon/codearts 等非主战平台（与 v4.3 的 --avoid 同机制，跨对话版）；③同主战平台撞上 → 后到对话转 aux 兵团或与先到对话错开波次；④让路是软规则：对话内所有波次完成后平台集合自然释放。
  - **效率定式**：探测数据驱动限额（不拍脑袋）、近因驱动换平台（不念旧情）、登记驱动让路（不靠默契）。