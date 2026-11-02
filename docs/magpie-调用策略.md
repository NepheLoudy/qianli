# magpie 模型调用策略 v2.4（均衡负载 · 并行开发 · 健康感知版，已落地）

> 台式机 DESKTOP-PCOONE5，2026-11-03。模型清单来自本机 `ListModels` 实测，配额数据来自 magpie 网关 `/v1/magpie/quotas` 实测。
> 修订记：v1「频率分级省积分」被曼波否决 → v2 改均衡负载；v2.1 自排查 + 实测修正；v2.2 监听器动态化（policy 驱动）；v2.3 三连拷问补齐（健康感知、限速调取、ideate 常驻、实时参与）；v2.4 收尾——**hy3-grader 任务难度自动分级（免费识别难度，曼波定）、监听器定时注册、agent model 路由实跑验证、首次后台侦察演示**。
> **落地状态：AGENTS.md 底层策略（五岗位 + 实时参与起手式）、pool-listener v0.2（schtasks 每 30 分钟已注册）、qianli 后台侦察演示。**

## 1. 枪柜盘点（按池分组，工位化定位）

| 池 | 模型 id | 推理档 | 定位 |
|---|---|---|---|
| **核心池（锁定）** | `account:bigmodel-start-plan/GLM-5.3-Flash` | low/high/max | 主会话当前档 `[current]`，永不切换 |
| | `account:bigmodel-individual-coding-plan/GLM-5.3`（及 -Flash） | low/high/max | 核心重活档：主会话切档 + 核心模块亲自 |
| | `account:bigmodel-offpeak-idle-plan/GLM-5.3`（及 -Flash） | low/high/max | 闲时批处理工位 |
| | `account:bigmodel-highspeed-card/GLM-5.3`（及 -Flash） | low/high/max | 赶时间工位 |
| **workbuddy 池**（2 账号，实测） | `magpie/workbuddy/hy3` | **low/high（免费）** | 基础工位群：核查/侦察/审校，全程并行 |
| | `magpie/workbuddy/glm-5.3`（及 -flash） | low/high/max | 二线开发工位：独立模块完整开发 |
| **trae 池** | `magpie/trae-cn/glm-5.3-flash-max` | low/high/**xhigh** | 攻坚工位：难模块、硬骨头 |
| | `magpie/trae-global/gpt-5.4` | low/med/high/**xhigh** | 异源评审工位（**$1/周期**，档位随项目量级调） |
| **auto（定性完毕）** | `magpie/auto/glm-5.3`（及 -flash） | low/high/max | **路由组（routing group），非账号**——`/v1/models` display_name 实锤；扣组内实际账号积分，可作溢出承接 |
| **DeepSeek** | `deepseek/deepseek-v4-pro`（及 -flash） | low/high/max | 异源交叉验证工位（ZCode 直连，不经 magpie） |

## 2. 角色与负载模型

- **主会话（bigmodel/startplan 核心）= 架构师 + 调度者 + 总验收**。接项目后亲自写码让位给并行子代理，主会话只保留：分割、接口契约、验收、合并、调整。**降低自身负载是第一目标。**
- **三池 = 常设工位群**。bigmodel 池出主力开发工位，workbuddy 出二线开发 + 免费基础工位群，trae 出攻坚 + 异源评审工位。没有「供着省着用」的池。
- 主会话档位只有用户能切（ZCode 实锤）——「bigmodel 作为主力」由曼波选档：日常 Flash、重项目切 coding-plan full GLM-5.3。

## 3. 均衡负载设计原则

1. **各池常设工位**：任务按「能力匹配 × 水位高低」摊到各池，目标吞吐最大化。
2. **免费工位吃最大基础负载**：hy3 工位群承接量最大的核查/侦察/审校流，它跑满就是给其他池减负。
3. **主会话上下文最稀缺**：能下放的（读大文件、找代码、初稿、初审）全下放子代理。
4. **验收常设三班**：hy3 机械核查（免费）→ deepseek 异源交叉 → gpt-5.4 异源评审（常设，档位随项目量级 low~xhigh）。
5. **弹性溢出**：某池水位告急 → 新任务溢到能力近似邻池（workbuddy glm-5.3 ↔ trae-cn ↔ auto 组），在途任务不中断。
6. **临期积分优先消耗**（v2.1 自排查新增）：magpie 积分有有效期（实测 1,500 积分将于 12-02 过期、周期重置 11-30、签到 +100/天补充）——省着用反而过期作废，监听器 advice 自动把工位派向有临期积分的池。

## 4. 并行开发流水线（接项目 SOP）

1. **接单**：brainstorming 常驻必跑，产出确认后才进分割。
2. **分割**：主会话切模块任务卡——接口契约 + 验收标准 + 建议工位。切分铁律：模块边界、**无同文件双写**、依赖单向。
3. **并行派发**：独立模块 Agent 单消息多派发；依赖拓扑用 CreateWorkflow（`subagent_model` 按工位表）。hy3 支撑工位同批起跑。单批并行度 3~5。
4. **整体验收**：主会话合并 + 验收三班（§3.4）。
5. **调整回炉**：小问题原工位修，核心问题主会话亲自。
6. **收工记账**：域记忆协议落盘（子代理只读 + `## 建议记账`，主会话收编）。

## 5. hy3 常驻岗位 = 基础工位群（免费，只读不写）

| 岗位 | 定义文件（已落地） | 干什么 |
|---|---|---|
| **hy3-verifier** | `~/.zcode/agents/hy3-verifier.md` | diff/文档/数据一致性、code-review 双验证、出单前 checklist |
| **hy3-scout** | `~/.zcode/agents/hy3-scout.md` | 找代码/找文件、读长文档出摘要、web 检索汇总 |
| **hy3-reviewer** | `~/.zcode/agents/hy3-reviewer.md` | webnovel 初审、去 AI 味初筛、文风 lint |
| **hy3-ideate** | `~/.zcode/agents/hy3-ideate.md` | 多视角头脑风暴（性能/可维护/风险），必须给反例 |
| **hy3-grader** | `~/.zcode/agents/hy3-grader.md` | 任务难度评估 S/M/L（免费识别难度），供工位自动匹配 |

铁律：**只读不写 + 末尾 `## 建议记账`**，主会话校验收编。改文件/不可逆操作永不派 hy3。
> `~/.zcode/agents/` 若客户端不识别，复制到项目 `.zcode/agents/` 或走 Settings → Subagents 指定模型 `magpie/workbuddy/hy3`。已知漏洞如实说：Bash 理论可写，靠 prompt 约束 + 收编校验双保险兜底。

## 6. 工位分配表

| 工位 | 模型 | 接什么活 |
|---|---|---|
| 调度/契约/合并/核心件 | 主会话（核心池） | 分割、契约、总验收、最难核心亲自 |
| 主力开发工位 | coding-plan GLM-5.3 子代理 | 核心模块、跨模块胶水 |
| 二线开发工位 | workbuddy glm-5.3 子代理 | 独立模块完整开发 |
| 攻坚工位 | trae-cn flash-max（xhigh） | 难模块、性能/算法硬骨头 |
| 异源评审工位 | trae-global gpt-5.4 | 项目验收评审（常设；$1/周期，档位随量级） |
| 异源交叉工位 | deepseek-v4-pro | 关键结论复核、验收互证 |
| 基础工位群 | hy3 × 3 岗（verifier/scout/reviewer）+ ideate 参谋 | 核查/侦察/审校/头脑风暴，全程并行 |
| 溢出承接 | auto 路由组 | 邻池水位告急时承接 |

保留硬规则：安全审查置信度 <0.8 丢弃；跨机关单「多元验证」协议照旧；夜间批量 offpeak、赶时间 highspeed-card。

## 7. 监听接口 pool-listener（v0.2 动态化 + 健康感知，已落地并验证）

- **数据源（实测）**：magpie 本地网关 `http://127.0.0.1:3425`（端口经 netstat 实锤）。`GET /v1/magpie/quotas` 吐结构化配额（provider/user/windows[used/remaining/limit/resetsAt/runsOut/runsOutAt]/readAt），`GET /v1/magpie/usage` 吐 30 天统计；`/v1/magpie/route` 需会话头（写操作类，不碰）。magpie 自动签到插件已开（日志实锤 +100/天入账）。
- **脚本（已落地）**：`~/.agents/tools/pool-listener/pool-listener.js`（Node 无依赖）+ 同目录 `policy.json`。`node pool-listener.js` 拉数写 `model-pool-status.json`；`--check` 供定时任务（水位 <0.2 exit 1）。
- **动态扩容设计（v0.1，曼波定：账号池持续扩容，算法不得硬编码）**：
  - 池聚合完全由 quotas 返回驱动——**新账号自动并入所属池聚合，新平台自动成池**并标 `needsPolicy: true`，stdout 提示「待分配角色」；
  - 角色 → 模型候选、静态池（bigmodel 锁死/auto 路由组/deepseek 直连）、水位阈值全部在 `policy.json` 配置，**扩容只改配置不改脚本**；
  - advice 按角色输出 `{model, provider, watermark, reason}`（reason = 临期积分优先 / 水位最高），不再拼接池名。
- **切换规则 v0（已实现）**：watermark = 余量水位 0~1（多账号 limit 加权）；enabled = watermark ≥ 0.2；advice 排序 = 临期积分优先 > 综合分（水位×0.6 + 健康×0.4）；**bigmodel locked 核心永不参与切换**。
- **健康感知（v0.2，曼波定：分流要智能）**：从 `/v1/magpie/usage/requests`（样本 200 条）按池聚合实测 ttft/耗时/错误率 → health 0~1 参与选池，样本 <5 记中性不惩罚。实测快照：workbuddy health 0.888（ttft 10.4s、错误率 1%）。
- **运营商限速优化调取（曼波问，已查实）**：限速优化是 magpie 网关内置自动行为（实测抓到现行：`auto/glm-5.3-flash` 请求被路由组自动改写 served `glm-5.3-flash`；多账号轮询同属此层），**无公开设置开关**（settings 75 项无相关键）。可调取其表现数据与恢复手段：`magpie usage --csv`（逐请求 ttft/耗时/状态/积分，含 provider/account/host）、`magpie quota history --json`（45 天水位历史，趋势预测素材）、`magpie quota wait <账号>`（阻塞等额度恢复）、`magpie settings get/set`（设置编程调取）、HTTP `/v1/magpie/quotas` 与 `/usage/requests`（只读）。
- **实测快照（2026-11-03）**：workbuddy 水位 98%（2 账号加权）、临期 6000 积分@12-02 → advice.dev = workbuddy/glm-5.3（临期优先）；trae-cn 100%；trae-global 100%（$1 盘子）→ verify = gpt-5.4。
- **扩容操作流**：magpie 加新账号 → 无需任何操作（自动并入聚合）；接新平台 → ListModels 看 id → policy.json 的 staticPools/roles 加一条 → 重跑监听器即生效。
- **待办**：定时注册（如 `schtasks /create /tn pool-listener /tr "node C:\Users\nebula\.agents\tools\pool-listener\pool-listener.js" /sc minute /mo 30`，待点头）；笔记本侧同款部署。

## 8. skill 常驻 + 子智能体实时参与（已写入 ~/.zcode/AGENTS.md 底层策略）

brainstorming（创造性工作前必跑、接项目第一站）、writing-plans、frontend-design、TRAE 三件套——意图命中即调。原则：常驻 = 触发即调，不是常驻上下文。

**子智能体实时参与（v2.3 新增，曼波定：经常看到子智能体在帮忙干活）**：
- 开发会话起手：后台派 hy3-scout 侦察（`run_in_background: true`），主会话同步开工不阻塞。
- 开发中：每完成一块后台派 hy3-verifier 随改随核；关键设计前并行派 **hy3-ideate ×2~3 视角**（性能/可维护/风险）头脑风暴——**头脑风暴常驻化**，从接项目一次性仪式升级为开发全程的多视角碰撞，免费池吃下这份负载。
- 收尾：hy3-reviewer 初审 + hy3-verifier 出单前 checklist。
- 可见性：子代理产出经「## 建议记账」收编进 events 与每日日志，实时参与必须留下可见痕迹。

## 9. 落地清单（2026-11-03 v2.4 更新）

1. [x] hy3 五岗位 agent 定义（verifier/scout/reviewer/ideate/grader，`~/.zcode/agents/`；ZCode 已注册）
2. [x] `~/.zcode/AGENTS.md` 底层策略（SOP + 五岗位 + 实时参与起手式 + 调取口；含回滚自愈指引）
3. [x] pool-listener v0.2 动态化 + 健康感知 + **schtasks 定时注册（每 30 分钟，2026-11-03 落地）**
4. [x] `magpie/auto/*` 定性：路由组（`/v1/models` 实锤）
5. [x] 首次实时参与演示：qianli 后台侦察（general-purpose 代跑；hy3 路由待档位选择后复验）
6. [ ] **曼波动作（2 分钟）**：ZCode 客户端里给 `magpie/workbuddy/hy3` 选思考档位（或重启会话使 `$high` 定义生效）→ 派 hy3-scout 复验路由（看 magpie usage/requests 的 served model）
7. [ ] 本文档移入脑仓库 docs/（D 盘浅层未定位到脑仓库，待曼波给路径）
8. [ ] 笔记本侧同步（AGENTS.md 节 + agent 定义 + 本文档 + 监听器 + policy.json）
9. [ ] qianli 全流程试点：小项目跑并行 SOP（分割 → grader 分级 → 并行派发 → 验收 → 记账）
10. [ ] 扩容跟进：新账号自动纳管；新平台在 policy.json 分配角色

## 10. 风险与限制（如实）

- 并行写冲突靠切分铁律规避（模块边界、无同文件双写、依赖单向），合并冲突主会话裁决——SOP 成立的前提，不是可选项。
- 并行度 3~5 是经验起点：多了验收跟不上、免费通道易撞限速；hy3 工位按需起。
- hy3 免费通道的速率/稳定性/上下文上限以 magpie 实际扣费与限速为准；任务切片小、失败重试 1 次即上报。
- agent `model` frontmatter 实跑结论（2026-11-03）：字段被 ZCode 读取实锤（派发报错 `No reasoning level selected [selection=magpie/workbuddy/hy3]`），卡点在客户端层的模型思考档位选择——hy3 需在客户端选档或会话重启使 `$high` 定义生效；会话内 agent 类型定义有缓存，改文件不热载。复验方法：派 hy3-scout 后查 `magpie usage --csv` 的 served model。
- AGENTS.md 有过一次外部回滚（原因未定论），节内已嵌自愈指引，副本在 `~/.agents/tools/pool-listener/agentsmd-策略节.md`（每次修改 AGENTS.md 策略节后需同步刷新副本）。
- 监听器 `needsPolicy` 分支（未知池自动纳管）未实测——当前 4 个 provider 都已分配角色，等首次真扩容时验证。
- magpie 客户端端口 3425 若变更（重装/升级），监听器支持 `MAGPIE_GATEWAY` 环境变量或 policy.json 覆盖。
- trae-global 是 $1/周期美元盘子——gpt-5.4 工位天然短板容量，评审档位按项目量级调低档更省。
- 链路事实（2026-11-03 实测更正）：主会话走 BigModel 直连实锤——按 session 聚合 magpie 24h 记录，本场会话零命中；workbuddy 积分消耗来自曼波并行会话主动选 magpie 通道的 glm-5.3-flash（143 次/206 credits）。auto 组账号轮询优先级在客户端「路由」页签配置，CLI settings 无对应键。教训：按 session id 归因，不按时间窗猜。
- 开发/评审工位岗位定义（2026-11-03 补齐）：dev-worker=主力(coding-plan GLM-5.3)、dev-worker-b=二线(workbuddy glm-5.3)、dev-worker-cn=攻坚(trae-cn xhigh)、expert-review=异源评审(gpt-5.4)、cross-check=交叉(deepseek)——加 hy3 五岗位合计十岗；模型档位均带 $ 后缀，路由待首次实派验证。deepseek/bigmodel 不在 magpie 上游清单，水位本地不可查（直连标注），用量看各平台控制台。
- 架构变更 v3.0（2026-11-03 曼波定）：岗位=角色按供应商为单元，模型不锁死——降级链唯一真源=policy.json（roles.*.chain 有序数组），监听器按「水位×健康+临期优先」从链上择优输出 advice；派发规则=轻任务 Agent 工具按岗位定义、并行流水线/精确降级用 CreateWorkflow subagent_model 动态传链上模型；模型变动只改 policy.json 不改岗位定义；进阶可在 magpie 路由页签建自定义路由组（group/<组名> 写进岗位 model）实现网关层无感降级。各角色降级链见 policy.json（dev-core/dev-b/harden/review/crosscheck/base 六链）。
