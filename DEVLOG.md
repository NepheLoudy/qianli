# DEVLOG · qianli 顶层工作区（monorepo）

版本隔离单位：一次 push 归档提交。本仓库远程为 `github.com/NepheLoudy/bambu-print-reservation`——它由 bambu 独立仓库演化而来（v9 起转型 monorepo），故早期版本即 bambu 的早期历史（细节见 [bambu-print-reservation/DEVLOG.md](bambu-print-reservation/DEVLOG.md)）。v1~v25 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](AGENTS.md)）。

当前最新：**v161**（2026-11-03，bambu v59→v83 批量会话遗留归档+全量审查修复批联动——24 版积压入库、P0×1/P1×11/P2×18 修复、37 套测试全绿，bambu DEVLOG v83 详录）。上一版 v160（2026-11-03，ticket-bot v94（63c832c）对账卡死 48.8h 事故修复批联动——出站 fetch 无界清零 + 定时任务看门狗，LOGIC-MAP §1.4 同步）。上一版 v159（2026-10-30，运维台印刷品 UI 重置+人机工效迭代+netlog 复活按钮 401 修复+四仓全量审查修复批联动——ticket v93/pm v137/approval v90/gateway v40，各仓 DEVLOG 详录）。上一版 v158（2026-10-17，全量审查修复批：gateway v39 部署缺口回补 + duty v56 口径改定/部署链 P1 修复 + ticket-bot v92 补推 + 三层 gitlink 收编）。上一版 v157（2026-10-17，04efc29，运维台 push 链路回归修复批；approval 指针实录 3d63cee、本批勘误）。上一版 v156（2026-10-15，0ae4a37，ticket-bot v92 + pm-robot v132 联动批——DDL 播报「📨 已指派待确认」分栏）。上一版 v155（2026-10-14，34af792，迁移后全量审查修复批——bambu v54/gateway v38/duty v55/hub v131 等六仓，头部指针本批补正）。上一版 v154（2026-10-14，575d84a，dashboard keepalive.vbs 双机路径探测批——保活脚本硬编码笔记本路径改两机探测，修台式机每 10 分钟 WSH 弹窗）。上一版 v153（2026-10-14，迁移基础设施批——顶层仓正名 NepheLoudy/qianli+ticket-bot 转正第 6 子模块+大脑记忆链路 qianli-brain/brain-sync 落地，两机一致性达成）。

## 阶段一 · bambu 独立仓库时期（2026-07-15 ~ 07-21）

### v1 · 2026-07-15 · `38375b3` · init
**初始化拓竹3D打印预约系统**（含 `c5d83db` GitHub 初始化提交）

### v2 · 2026-07-15 · `ee474ca` · feat
**添加NAS部署脚本和Git配置**（含 `49c2a08` 合并远端）

### v3 · 2026-07-15 · `76bd78d` · docs
**更新README添加NAS部署说明**

### v4 · 2026-07-15 · `b36cd80` · feat
**适配飞书审批多维表格字段**

### v5 · 2026-07-15 · `dc84770` · fix
**预约表只保留飞书审批原生的8个字段**

### v6 · 2026-07-15 · `f4965f7` · fix
**移除打印控制指令，明确与项目看板区分**

### v7 · 2026-07-15 · `05452f5` · fix
**修复字段引用和术语一致性问题**

### v8 · 2026-07-21 · `17f3169` · chore
**更新部署脚本和指令处理**

## 阶段二 · 工作区化（2026-08-28）

### v9 · 2026-08-28 · `4c73e14` · feat
**添加工单系统机器人 ticket-bot**
- ticket-bot 首次入仓（后迁出为独立仓库，顶层留有旧快照副本）。

### v10 · 2026-08-28 · `c886f32` · chore
**自动部署更新：仓库转型 monorepo**
- bambu 移入子目录；approval-bot / project-management-robot 以 gitlink 挂载；project-configs/*.env、SOP 站点、tools 收纳入库。

### v11 · 2026-08-28 · `efb2280` · chore
**自动部署更新（ticket-bot 部署脚本微调）**

## 阶段三 · 网关架构落地（2026-09-01）

### v12 · 2026-09-01 · `55fb002` · feat
**新增 feishu-gateway 统一飞书事件网关；bambu 部署脚本与密钥分离**
- 「唯一长连接」架构起点。

### v13 · 2026-09-01 · `2c81f94` · fix
**（网关）审批群内 / 指令直接路由 approval-bot**——v15 即撤销

### v14 · 2026-09-01 · `bdfc053` · fix
**（网关）isMentioned 兼容 mentioned_type=bot**

### v15 · 2026-09-01 · `49fb4b7` · fix
**（网关）遵循架构铁律——撤销审批群消息直连路由，对话统一走 hub**

### v16 · 2026-09-01 · `9212b38` · docs
**新增 qianli-deploy skill（统一部署链路、env 规则、架构铁律与踩坑速查）**

### v17 · 2026-09-01 · `5e61ac3` · chore
**整理工作区——核心机器人项目留根目录，其余按功能归档**
- 顶层 AGENTS.md 与 qianli-chat-architecture skill 诞生；ticket-bot 换 push.js 统一部署；project-configs 移入 archive/。

## 阶段四 · 会话治理（2026-09-02 ~ 09-03）

### v18 · 2026-09-02 · `dd9d961` · docs
**feishu-gateway 增加项目职能边界声明**

### v19 · 2026-09-02 · `147d491` · docs
**bambu-print-reservation 增加项目职能边界声明**

### v20 · 2026-09-02 · `555556d` · docs
**顶层 AGENTS.md 增加项目职能划分总表（防需求发错会话）**

### v21 · 2026-09-03 · `adfdebb` · docs
**qianli-deploy 补充 NAS 重启后 pm2 服务恢复与自启配置说明**

### v22 · 2026-09-03 · `2864005` · docs
**feishu-gateway AGENTS.md 增加「顶层规则与交互性」段**

### v23 · 2026-09-03 · `ee5ad39` · docs
**bambu-print-reservation AGENTS.md 增加「顶层规则与交互性」段**

## 阶段五 · 审批事件直连联动（2026-09-04）

### v24 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 三项目联动：网关订阅审批实例事件；bambu 新增 dispatcher/approvalService 自动分发打印；ticket-bot 同步改造。同批建立顶层 .gitignore（忽略 .zcode/）。

### v25 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道——approval_instance + approval_task 转发 bambu/ticket（自动审批与工单接单联动）**
- 自动审批（bambu）与接单自动通过（ticket）两条联动链路当天打通。

## 阶段六 · DEVLOG 规则落地与全量同步（2026-09-04）

### v26 · 2026-09-04 · `37a59aa` · chore
**落地 DEVLOG 每push一版规则并同步工作区（AGENTS/skill 规则、六份开发历史建档、bambu 审批联调后续、子仓库指针）**
- 顶层 AGENTS.md 新增「开发日志（DEVLOG）」节、qianli-deploy skill 补记版要求；六份 DEVLOG.md 诞生（按各自 push 历史回溯编号）；
- 同批归档 bambu 审批联调后续 5 个 src 文件（其 SFTP 部署已先此上线，即 bambu v15）；ticket-bot 顶层快照同步至其自有仓库 v42+ 状态（含 approvalLinkService.js）；approval-bot → `5f4b8af`、pm-robot → `b57fae5` gitlink 指针更新；
- 本批各项目对应版本：pm-robot v48（`b57fae5`）、approval-bot v16（`5f4b8af`）、ticket-bot v43（`918a2d5`）、bambu v15、gateway v9（`7207c20`）；
- `tools/rm-battlescope` 为无 .gitmodules 的嵌套仓库（预存指针漂移），本次未纳入同步。

## 阶段七 · 指令边界收紧 + bambu 字段对齐（2026-09-05）

### v27 · 2026-09-05 · `5efc0ca` · feat
**指令仅群内触发（私聊白名单）多项目联动 + bambu 审批事件字段修正批次归档**
- 新规落地：指令只在群里触发并回复到对应群，私聊指令仅管理员白名单可用——ticket-bot v44（`47ac274`）与 pm-robot/hub v49（`220abba`）同套规则（`P2P_COMMAND_OPEN_IDS`/`P2P_COMMAND_CHAT_IDS`）；管理员账号为白名单管理员本人（open_id 见本地 .env）；本地 .env 已配置，push 随批上传 NAS。
- pm-robot v50（`e7b4a0b`）：会议提醒卡片识别对非 JSON content 安全降级（全量 debug 发现的 error 日志噪音，功能无损）。
- bambu v16（SFTP 已上线，归档锚点 `5efc0ca`）：审批事件字段对齐官方接口（instance_code/approval_code/open_id）、parseForm 兼容 JSON 字符串、终态扩充 REVERTED/OVERTIME_CLOSE、remainingMinutes 单位修正、分发重试上限+冷却、express.json 2mb、/api/printers/available 路由顺序修正。
- approval-bot v17（`5e3f31e`）：v16 建档条目补交；ticket-bot/pm-robot 同款「当前最新」头部残留随批补交。
- 全量 debug：bambu approval/dispatcher 两套测试、gateway smoke、全部项目语法扫描、门禁本地 9 项验证全部通过；部署后 NAS 五进程 online、健康检查 200。

## 阶段八 · 工单播报修复 + 多人接单联动批次（2026-09-05）

### v28 · 2026-09-05 · `dbbdaf5`（与 v29 同提交兑现）· feat
**ticket-bot v49（`9dcbc8d`）+ pm-robot/hub v53（`b0a3608`）：多组别漏播修复 + 多人接单 + 跨项目评审批修**
- ticket-bot v49：①**多组别工单漏播根因修复**——并行审批流把「审批节点」字段写成「；」拼接多段（5 组别单=同值×5），旧整串精确匹配漏判致创建不播报/对账不补播；新增 `config.matchNodeValue` 拆段匹配替换播报/对账/审批联动守卫/超时检查四处，存量漏播单 202609050003 部署后由对账自动补播（实测 reconcile 4/4 群）。②**多人接单续接窗口**——工单表「是否允许多人接单」=是 时接单不即时通过审批，开 6h 工单级计时器（源表「多人接单截止」字段跨重启），仅已有人接单的群收续接询问，再接单重置计时，到期对账自动通过全部并行节点任务+结束通告；补充负责人改合并写入。③审批联动改**批量通过**（并行分支任务全过才汇合，原单任务缓存会被覆盖）+ 非多人单接单后补通过对账补偿。④评审批修：接单确认整句精确匹配（防"还没人接单吗/我不想接单"误触发）、回退池仅触发节点+多候选入列、超时分支文案/字段配置化、发起时间统一。
- pm-robot v53：DDL 逾期确认防误判（p2p 确认仅私聊可回+整句解析，防群聊日常消息误改项目状态为 completed）、降级直读链路负责人口径对齐（指定→补充负责人，原取当前处理人）、DDL 播报「今日已播报」标记改至少一群送达后落盘（防全败当天静默丢失）、/test-ddl 非播报群守卫。
- 部署验证：ticket-bot/knowledge-tracker 均 online，health 3003/3000 均 200，分桶 API dry-run 正常，ticket-bot 对账新格式日志（多人单窗口关闭/审批补通过计数）就位。
- 待办：审批表单→多维表格同步自动化需映射「是否允许多人接单」（列已在、近期记录值为空），映射后多人单分支才生效。
- 说明：两项目独立仓库已推送 GitHub 并部署 NAS（pm-robot 走 SFTP 兜底，常态）；顶层 monorepo 既有未提交重组改动本次未触碰，本条归档提交留给顶层整理流程。

## 阶段九 · 六仓集中审查修复批次 + 兑现 v28 归档（2026-09-06）

### v29 · 2026-09-06 · dbbdaf5 · fix
**全项目文档对齐 + 确定性缺陷集中修复（gateway v12 / ticket-bot v50 / pm-robot v54 / approval-bot v28 / bambu v17），本提交同时兑现 v28 的顶层归档**
- 共性修复三类：①**文档失真**——gateway README 路由表还是 v4 撤销前的直连规则、pm-robot 关键词监听描述停在 v23 之前、bambu 工作流图与审批主通道自相矛盾、ticket-bot README 留着已删除的 deploy 脚本与命令、各 .env.example 缺键/错值（含 gateway hub 端口 2174 错误、pm-robot 长连接推荐 true 违反铁律）；②**确定性缺陷**——ticket-bot 审批联动申请编号口径（超链接渲染致自动通过链路失效风险）+ 接单守卫、bambu 缺料忙等死循环 + 分发链路无超时、approval-bot dry-run 消费回复 + 回执失败中断整轮、gateway wsClient.start() 未 catch 杀进程 + health 假绿、pm-robot Actions 部署与 push.js 双链路冲突；③**安全卫生**——approval-bot README 移除误提交的 webhook 完整地址、pm-robot 停用 Actions 部署、archive 三份 .env 已进 git 的警示写入顶层 AGENTS 与 deploy skill（密钥轮换待办）。
- 各项目明细见各自 DEVLOG vN；已汇报未改项（gateway /api/dispatch 无鉴权暴露面、event 投递 fire-and-forget、bambu 主通道重启丢队列、pm-robot gitlink 漂移等）见审查报告。
- 版本线备注：approval-bot（缺 v16~v27）、ticket-bot（缺 v43~v49）、pm-robot（缺 v48~v53）三家 DEVLOG 条目曾中断，本次随批补注版本线出处（以各自 git 提交消息为准），并恢复逐 push 记录。
- 部署顺序：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交 → gateway（push.js 跳过 commit 直接 SFTP 部署 + 发布顶层远端）；NAS 五进程验证见各项目记录。

## 阶段十 · 四仓晚间静默联动批次（2026-09-06）

### v30 · 2026-09-06 · cca9970（并入 v31 归档补交） · feat
**晚间静默（播报时段限制）：02:00–09:00 内定时/自动播报积压到 09:00 统一补发（ticket-bot v51 / pm-robot v55 / approval-bot v29 / bambu v19）**
- 规则入顶层 AGENTS.md 新「晚间静默」段：窗口 `[QUIET_HOURS_START, QUIET_HOURS_END)`（默认 2→9，Asia/Shanghai，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）；四仓各自落地 `src/utils/quietHours.js`，积压持久化 `.quiet-backlog.json`（五处 .gitignore 同步），重启不丢、启动过点即补冲刷、失败重试 ≤3 次。
- 挤压负责制三形态（挤压要为挤压之后的事情负责）：①可重扫任务（ticket-bot 每日汇总、approval-bot 周报/每日提醒/催发票、pm-robot DDL 播报含逾期确认）冲刷时重跑整个任务函数，以补发时刻最新数据重查——夜里已了结的事不再播，标记/节流状态以实际发送时刻为准；②小时级重扫（ticket-bot 超时/结单/确认追问）静默内整轮零副作用跳过，09:00 整点轮次天然冲刷；③一次性事件通知（bambu 生命周期卡/预约通知 11 处、ticket-bot 多人单结束通告）原样落盘载荷按序补发，业务动作（打印机控制/写表/审批自动通过）不延迟。
- 豁免：对话/指令回复（接单确认、/print-*、DDL 确认等交互回路）与人工当下主动触发（test-*/手动补播单条）。
- 文档：ticket-pm/LOGIC-MAP 新增 §1.7 + §2.2 第 6 条；approval-bot/bambu README 补静默说明；四仓 .env.example 补 `QUIET_HOURS_*`。
- 部署顺序建议：ticket-bot → pm-robot → approval-bot → bambu（SFTP）→ 顶层归档提交；bambu v19 锚点随本批归档提交回填。

---

**本 DEVLOG 自身**：v1~v25 为 2026-09-04 回溯建档；v26 起按「每次 push 记一版」规则持续追加（规则见 [AGENTS.md](AGENTS.md)，qianli-deploy skill 部署流程同有提醒）。

## 阶段十一 · 无负责人问询节流 + DDL 无人接单分栏（2026-09-06）

### v31 · 2026-09-06 · cca9970 · feat
**无负责人工单群内问询 6h×2 封顶（组长私聊持续升级）+ DDL 播报新增「无人接单」分栏（ticket-bot v51+v52 / pm-robot v55+v56；v30 晚间静默批次的 ticket-pm 两仓随本批实际上线）**
- ticket-bot v52：超时分支 2.2 群内重问询改**每 6h 一次、每单封顶 2 次**（≈发起后 6h/12h 各一次，内存计数重启清零）；封顶后由「无人接单升级」组长私聊（≥3h 间隔）承担持续提醒。多人单续接窗口不受限——有人接单即写补充负责人退出超时检查，续接询问/到期自动通过在 ticketService 接单与对账路径，不经此处。
- 两仓联动（§1.6 契约 additive 扩展）：ticket-bot `GET /api/tickets/unclosed-by-group` 每群新增 `unclaimed` 桶（触发节点 + 补充负责人为空 + 距发起 ≥6h，按「面向组别」分组、时长降序）；pm-robot DDL 卡在结单分栏前新增「🆘 无人接单工单」分栏（只列标题与发布时长不 @），/test-ddl 与降级直读链路同口径。
- 顺带整改（两仓同款）：结单分桶的服务端等值过滤改全量拉取 + 拆段匹配——并行分支「；」拼接节点值等值过滤匹配不上，会静默漏桶。
- 部署顺序：ticket-bot v52 → pm-robot v56 → 顶层归档提交。

## 阶段十二 · 全仓例行维护批次（2026-09-06）

### v32 · 2026-09-06 · 85e95cc · fix
**五仓例行 debug 扫描：代码纠偏 6 处 + 文档/锚点对齐（approval-bot v29 首推 + ticket-bot v53 / pm-robot v57 / bambu v20 / gateway v13）**
- approval-bot v29（存量改动随批首推）：晚间静默落地（三定时任务 gateTask 积压重跑）——v30 四仓批次中唯一未 push 的一仓，本批补齐上线。
- bambu v20：审批自愈②窗口列表兜底三处纠偏（响应字段 `instance_list`→`instance_code_list`、时间戳毫秒→秒、24h 窗口按官方 ≤10h 限制切片 + 分页）——自 v18 上线以来该兜底从未生效（生产未配 APPROVAL_CODE 休眠中，无线上影响）。
- ticket-bot v53：「；」拼接拆段匹配残留 2 处整改（结单提醒服务端等值过滤致多组别工单结单私聊永不触发、对账「回执单」整串比对致补搬运/状态推进跳过）+ cron-status「提前/过后」文案反义修正 + README 对齐 v50~v52。
- pm-robot v57：降级直读链路拆段分隔符补齐 `,` `，` `|`（与 ticket-bot splitNodeValues 同字符类）+ README/keywords/.env.example 文案与清单纠偏。
- gateway v13：README 幽灵部署脚本（deploy:sftp→push）、DEVLOG 指针 v10→v12、v11 锚点回填 `cebb767`；bambu v19 锚点回填 `cca9970`；bambu PRINTER-LAN-API dispatcher 行号回填。
- 意图不明未动（记录备查）：bambu approval_task 路径失败不登记自愈、对账重复拉详情噪音、数值 env 无 NaN 防护；四仓 QUIET_HOURS_DISABLED=1 时遗留积压不冲刷不清理；pm-robot 空 chatId 回落口径、静默冲刷中登记的调度窗口；gateway .env 死键 FEISHU_ENCRYPT_KEY 与未用依赖 cors。
- 部署顺序：approval-bot → ticket-bot → pm-robot → bambu（SFTP）→ gateway → 顶层归档提交。

### v33 · 2026-09-11 · 7789a3a · feat

**顶层归档：duty-bot v1 首推（Duty-Management）+ hub v65 值日联动 + 本地运维台 + 全仓隐私整改**

- duty-bot v1 首推上线（:3006，pm2 duty-bot，仓库 NepheLoudy/Duty-Management）：排班轮转（三岗均等）/私信闭环/值日助手/数据接口；M0 剩表格 token 回填与名册补全
- pm-robot v65：hub 值日分支 + 值日专用群（快递申领群，DUTY_CHAT_ID）仅放行「值日助手」+ 关键词回答 .local 私有覆盖
- approval-bot v30：提醒回落变量通用化 + 文档脱敏
- 新增 `dashboard/`：本地运维台（仅 127.0.0.1:3100）：端口职能/权限/指令/监听/状态/日志/更新可视化 + 本地测试进程启停 + npm push 快捷指令；`dashboard/registry.js` 为全项目权能清单单一事实来源
- 隐私整改（全仓）：archive/project-configs 旧 .env 退出 git 跟踪（密钥维持"已泄露待轮换"定性）；gateway nas-e2e-test 群号改 env；duty-bot-plan.md 入 gitignore；顶层 AGENTS.md 总表加 duty-bot 行 + 快递申领群裁定 + dashboard 条目；架构 skill 补 duty 分支
- ticket-bot 脱敏改动（DEVLOG/stub/注释人名）随其在途功能批同推，本批未动

### v34 · 2026-09-11 · 8693635 · fix

**顶层归档：全仓审计 debug 批（duty v2 / hub v66 / approval v31 / dashboard 修复）**

- 三路并行审计（文本/代码/逻辑三侧）六仓全量过一遍：3×P1 + 15×P2 + 20×P3；P1 与高危 P2 当批修复（明细见各仓 DEVLOG），P3 与行为取舍项汇总至桌面《设计意图待定项》文档
- dashboard：push 快捷指令 cwd 双重拼接修复（spawn 必失败且无人监听 error 会击垮运维台）、运行期日志封顶、registry 修正误写 API 与 gateway 不提供本地启动的说明（防本地实例抢唯一长连接）
- duty-bot v2：对账补收口（P1）、加罚双插入（P1）、附件并发锁、会话日期守卫、消息幂等、test-generate 默认 dryRun 等
- hub v66：/test-ddl 参数错位（P1，v53 回归）、值日群关键词回答关闭、DDL 确认 p2p 图片静默、.env.example 补 DUTY 键
- approval-bot v31：飞书客户端 15s 超时（催发票互斥锁卡死隐患）、积压文件外迁
- ticket-bot/bambu：client 超时与 quietHours 能力已改在工作区，随各自下一批推送（ticket-bot 在途功能批未动）

### v35 · 2026-09-11 · cbc7fd1 · feat

**顶层锚点：duty-bot v3——缺勤补偿规则确认（已请假/未做完全路径进下周队列，含 admin 手工标记补登记）；快递申领群=值日播报群已确认**

### v36 · 2026-09-11 · 24c6d24 · feat

**顶层联动：hub v68 值日群（快递申领群）关键词自动回答放行——群监听"占得太死"松绑**

- 用户反馈值日机器人"群监听占得太死"（实际闸门在 hub 值日分支，duty-bot 无消息监听）：v65/v66 的"仅放行值日助手"把关键词彩蛋一并拦死（日志实录 @「大狗大狗请叫叫」被 🧹 顶掉）。
- hub v68（pm-robot 仓 3501bb5）：@消息「值日助手」看板不变、关键词命中照常回答（未命中回新值日群引导语）、未@关键词照常回答；基础指令继续关闭。
- 文档同步：根 AGENTS.md 值日专用群裁定行、qianli-chat-architecture SKILL.md 架构图、dashboard/registry.js hub 权限、ticket-pm/LOGIC-MAP §2.4 值日分支条目。LOGIC-MAP 同文件随带上批已上线行为的在途文档补记（关键词回答管道③、多人接单 v57~v60 接单链路），在途代码（ticket-bot/bambu quietHours 等）仍未提交、随各自下一批。

### v37 · 2026-09-11 · a0d49a7 · feat

**顶层联动：值日域权限管辖归位——duty-bot v4 管辖策略下发 + hub v69 策略驱动消费**

- 用户要求：值日群的权限管辖范畴（管哪些群）与生效范畴（放行什么）应实现在开发中的机器人（duty-bot）后端，而非 hub 硬编码。
- duty-bot v4（316756b）：`GET /api/duty/policy` 单一事实来源下发管辖群（`DUTY_GROUP_CHAT_IDS`）+ 生效范畴（看板触发词/关键词放行/基础指令关闭/引导语/p2p 指令清单）；群看板加管辖校验。仍不消费消息事件，铁律不变。
- hub v69（5f0add5）：`dutyPolicyService` 短缓存消费策略，值日分支与未@关键词闸门全部策略化，duty-bot 失联按本仓 `DUTY_CHAT_ID` 兜底；改群/改规则今后只动 duty-bot 一侧。
- 文档同步：根 AGENTS.md 值日群裁定行、架构 SKILL.md、dashboard/registry.js（duty/hub 条目）、两仓 README/AGENTS、ticket-pm/LOGIC-MAP §2.4。测试：duty-bot 10 项新断言 + flow/schedule 回归；hub 27 项断言。NAS 实测策略接口下发正确、双服务 health 200。

### v38 · 2026-09-11 · 1e19e37 · chore

**顶层锚点 v37 补记：值日域权限管辖工作全部收口到顶层**

- duty-bot 仓 DEVLOG 回填 v4（316756b 管辖策略下发 → 9bd691b）；pm-robot 仓 DEVLOG 回填 v68/v69（3501bb5 关键词放行、5f0add5 策略驱动 → 372c18b）。
- 本笔更新 duty-bot / ticket-pm/project-management-robot 两个 gitlink 至含 DEVLOG 的最新 HEAD，顶层与嵌套仓状态对齐；此后值日域改权限口径只动 duty-bot 一侧。

### v39 · 2026-09-11 · 79bfaf1 · feat

**顶层联动：duty-bot v5 表格接线——值日看板表接入（M0 表格项完成）**

- 用户建好「值日看板」表（机器人项目看板库 tblhws89lrituaks，人员列已自行改为人员类型）；duty-bot 探测后完成匹配：应用身份补建文本「姓名」列、预置负责区域/完成状态单选选项，`.env` 写全 token/表 id/DUTY_FIELD_* 映射（列名不改动用户命名，全走 env）。
- duty-bot v5（d57aa0f，回填 931094f）：table:check 总状态列类型断言放宽为文本/单选皆收；校验 9 字段全过；NAS 实测 brief 读表 / generate dryRun / health 200。
- registry 销项：M0"表格 token 回填"完成；**名册待补全（当前仅 1 人）**——排班生成前必须补 members.json 并让队员发「绑定 姓名」，否则全排一人。

### v40 · 2026-09-11 · 39d25c2 · feat

**顶层联动：名册自动读通讯录 + 机器人后端定制窗口规则（首批三仓落地）**

- 需求：排班名册不手工维护——duty-bot 自动读飞书通讯录纳入所有队员；白名单类定制能力做成各机器人后端的"附属窗口"；规则写给所有机器人后端。
- duty-bot v6（d94c48f/9bbea91，回填 55d7847）：`contacts.js` 全租户部门×成员同步（停用不入册、多部门合并、open_id 直取），启动/生成排班前/手动 refresh 三时机；admin 标记按姓名保留，绑定降级兜底；定制窗口 roster 全景 + whitelist 增删。踩坑：find_by_department page_size 上限 50。NAS 实测 **63 人全员入册**（12 部门全绑 open_id）。
- hub v70（2c33716）+ approval-bot v32（0728e21）：`GET /api/hub/policy`、`GET /api/approval/policy` 只读定制窗口。
- 规则成文：顶层 AGENTS「机器人后端定制窗口（附属窗口）规则」——读窗口 policy 全景、写窗口热改、口径权威在各自后端、名册优先通讯录、先加窗口再登记 registry。ticket-bot/bambu 有在途批，policy 窗口随批补上（registry 已标注）。
- 测试：duty-bot 新增 test:roster（10 项）+ flow contacts stub，schedule/policy/roster 全过。

### v41 · 2026-09-11 · fc631d9 · feat

**顶层联动：hub v71 关键词回答表定制窗口 + 运维台「🧰 定制中心」界面**

- hub v71（a45d87b，回填 5a580e7）：`GET/POST /api/autoreplies/rules(/delete)`、`/api/autoreplies/enabled`——关键词回答表/@触发表增删改与启停，写 NAS `.local.json` 即时生效（push 以本地 xlsx 版覆盖，已在窗口响应与 README 注明）；NAS 实测 CRUD 全闭环。
- 运维台「🧰 定制中心」：registry 各项目新增 `windows` 清单；`/api/windows` + `/api/nas/api`（SSH curl 代理直达 NAS 本机接口）；界面支持 duty-bot 白名单增删（人名徽标即时回显）、名册全景/通讯录刷新、管辖与定制全景查看、hub 关键词表可视化编辑器（规则列表/删除/保存/整表启停/group↔mention 切换）。
- AGENTS「机器人后端定制窗口」规则补界面条目；ticket-bot/bambu 窗口仍随在途批。
- 运维台已重启生效（127.0.0.1:3100）。

### v42 · 2026-09-11 · bffe647 · fix

**顶层联动：定制面板集成主看板（🧰 折叠）+ 修复编辑器无响应 + 指令风格统一 + 宣运群回执排查**

- 运维台改版（用户反馈：定制栏不要分开放）：删除独立「定制中心」区块，定制窗口折进各项目主卡片——卡片右上角 🧰 按钮展开/收起；修复「打开编辑器」无响应（rulesEditor 容器 div 此前未渲染）；新增 duty 管辖策略在线编辑（输入管辖群 chat_id 即存即生效）。
- duty-bot v7（95f92b6）：指令风格统一——/值日助手、/我要请假 等 / 别名与裸词全等效；管辖策略 POST 在线改写（config/policy-override.json 优先于 env）。
- hub v72（e7871f9）：/help 值日段统一斜杠风格，兜底指令清单同步。
- 排查结论（详见会话报告）：① /help 在财务群外显示完整帮助为既有设计（财务群是切换 /approval-* 的特例），风格统一后体验一致；② 宣运群接单回执缺失根因 = ticket-bot 当时出站请求连不上飞书 API（错误日志「接单队列推导失败: fetch failed」连接超时），队列推导失败被兜底成「无待接单工单」；工单 202609110003 本身正常待接，网络恢复后重发「接单」即可出回执；在途批的 client 超时加固即是针对此问题，建议随下一批推送。
- ticket-bot / bambu 的 policy 窗口仍随在途批。

### v43 · 2026-09-11 · 2ab7050 · fix

**运维台定制窗口改浮层——修复 4 秒自动刷新把展开面板重置的问题**

- 用户反馈：定制面板展开后有时自己关闭（根因：页面每 4s 重建卡片网格，内嵌面板被重置回 display:none）；且期望的展开形态是"浮现一个略小的窗口覆盖卡片"。
- 改为全局悬浮窗 `#winFloat`：点卡片右上角 🧰 在该卡片上方浮现略小窗口（absolute 定位随页面滚动、内容超高滚动），独立于网格重建，输入中的表单不会被刷新清掉；再次点击 🧰 或点「收起 ✕」关闭，打开另一项目自动切换。
- 卡片仅保留 🧰 入口按钮；whitelist/规则编辑器/管辖群编辑等功能不变。

### v44 · 2026-09-11 · 5dd60e7 · fix

**顶层联动：窗口按键全量体检 + 名册同步加固 + 排除名单核验**

- 全量体检：运维台全部 11 个窗口接口经真实代理链路逐个探测（含耗时），全部健康；名册通讯录同步实测 5.9~6.5s。
- 用户反馈「手动刷新没用」根因：同步整链 ~17 次出站调用，单次网络抖动即整轮失败 + 代理 12s 超时余量偏紧 + 失败只有右上角 toast 无可见结果。修复：duty-bot v8（58237b8）同步失败自动重试一次；运维台代理超时 12s→30s；刷新按钮忙碌态 + 成功后自动弹出名册全景。
- 排除名单核验：用户已加 18 人，14 人生效（64 人名册、队列 50）；4 人无效（Peiyu Wang/粟宇/Aouk/郑元斌，通讯录查无此人——已退队或名字写法不同），已反馈用户。

### v45 · 2026-09-12 · 8822459 · fix

**顶层联动：值日链路全量修复（duty-bot v9 `f2220af` + hub v74 `106bc46`）——群看板斜杠门、每日播报静默跳过、打卡口径**

- P1（声明≠实现）：群内 @机器人「/值日助手」此前被 hub 全等匹配拦成引导语——duty-bot v7 的 NAS 实测系直 POST 绕过 hub 门，真实链路从未通过。hub v74 群门改裸词/带 / 双形态匹配，/help「带不带 / 均可」自此为真。
- P1（核实+修复）：「每日 12:00 看板自动播报」本地与 NAS `.env` 均未配置 `DUTY_BOARD_WEBHOOK_URL`，上线以来每天静默跳过（从未真正跑过）。duty-bot v9 改为回退应用身份直发管辖群（webhook 推送失败同样回退、播报不中断），并回填 duty-bot-plan.md 交接记录中的播报群 webhook——次日 12:00 起播报真正生效。
- 打卡口径：p2p 打卡确认增补口语变体（是的/好了/完成了/做完了/搞定 等——有当日询问会话才等同「是」，无会话交还 hub 走欢迎语）；看板 footer 明示「完成后请私信回复『是』」（原文案诱导群内回复，是「关键词和@指令撞了」观感的直接来源）；18:30 询问与 HELP 注明「若同时有 DDL 逾期确认，『是』会先被其占用，打卡未成功请再发一次」。
- 防撞车与口径统一：hub 回答表写窗口（upsertRule）对值日域保留词做双向子串冲突校验（命中即 400）；groupChatIds 空数组语义统一为「不限制」（原 hub=无管辖群 / duty-bot=放行，两边相反）；群看板转发载荷补 messageId（duty-bot 消息级幂等全路径生效）；非管辖群 @ 值日指令回「请到值日专用群或私信办理」；管辖群 @+纯图片静默吞掉不回引导语。
- 记录在案不动：gateway `contains:'接单'` 全局抢占（值日群含「接单」的 @ 消息进 ticket-bot，ticket-bot 群门禁兜底，后续单独批次按工单管辖群收窄路由）；`isMentionedBot` 把 @任何 app/bot 都算 @本机器人（共用应用妥协）；群看板限流命中静默（设计如此）。
- 验证：hub stub 测试 34 项 + duty-bot 五套件（policy/flow/board/schedule/roster）全过；NAS 两进程 online、health 200；真实群内 @（看板双形态/变体打卡/12:00 播报）待白天自然触发观察。
- 注：dashboard/registry.js 同文件携带 gateway v14 批次的在途文案改动一并归档（该批功能已随 b4aa03e 部署）；其余在途改动（dashboard 运维台、ticket-bot 多人接单批次等）不在本批收录范围。

### v46 · 2026-09-12 · 265a429 · fix

**顶层联动：全仓复查纠偏 + 剩余未推批次清理（ticket-bot v61 `f6f73e2` + bambu v21 + duty-bot v10）**

- 全量复查（TRAE-code-review，双校验代理 2/2 确认 7 项发现）：v45 批次（duty-bot v9 / hub v74）自检无阻断缺陷；ticket-bot 多人接单收尾批次审后随 v61 推送（出站 fetch 全量 15s 超时、审批人解析失败不缓存自愈、接单队列复用全量记录免二次拉表、历史文档隐私清洗）；dashboard 活跃看板批次（/api/stats /api/activity + 总览仪表台）审后随本提交归档。
- 复查发现 ①②③（静默积压挪址收尾，major+minor×2）：bambu/ticket-bot `.env` 补 `QUIET_BACKLOG_FILE`——bambu 纯 SFTP 部署每次清空项目目录、积压必丢（新代码此前对该仓形同虚设），ticket-bot SFTP 兜底部署路径同险；两仓 quietHours 加载时自动建项目外数据目录。NAS 实测：`/home/qianli/bambu-data`、`/home/qianli/ticket-bot-data` 随重启自动创建，ticket-bot/bambu health 200。
- 复查发现 ④：三仓 `.env.example` 补 `QUIET_BACKLOG_FILE` 键（「新增配置同步改 example」约定欠账）；duty-bot 随 v10 docs 推送，顺带回填 v9 锚点 `f2220af`。
- 复查发现 ⑤⑥（文档纠偏）：gateway DEVLOG 头部「当前最新」v13→v14（v13 条目刚修过同型漂移、属复发）；registry ticket 条目注记改写——多人接单批次已推 v61，**`/api/tickets/policy` 定制窗口仍未落地（待后续批次）**。
- 复查发现 ⑦（整理）：keep-awake.ps1 防休眠工具归档 `tools/`。
- gateway v14 DEVLOG 补交随本提交归档（v14 代码已随 b4aa03e 部署，本批不重部署、避免长连接无谓重启）；至此工作区无未收尾改动。

### v47 · 2026-09-12 · 64ce352 · feat

**顶层联动：动态广场看板落地（机器人项目看板）+ 运行时数据保护铁律 + duty-bot 白名单事故整改**

- 建表：机器人项目看板新增「动态广场 / 网关日活跃 / 网关功能使用 / 网关队员活跃」四表（duty-bot `scripts/create-plaza-tables.js` 幂等建表；主键改名走 PUT——飞书更新字段接口不是 PATCH）。
- 网关活跃同步：gateway v15 每 30 分钟按日期签名 upsert 三表 + 启动回填存量 + `POST /api/usage-sync/run` 手动补数；NAS 实测出数（09-12：237 条消息 / 23 名活跃队员，open_id 姓名自动解析成功）。
- 动态广场事件流：ticket-bot v62（工单播报/接单/结单/审批自动通过）、bambu v22（打印排队/开始/完成/失败）、duty-bot v11（值日完成/请假）、hub v75（DDL 播报）四仓钩子接入，失败仅 warn 不阻塞主流程；approval-bot 无写表客户端待后续批次。
- 交付《动态广场看板搭建指南.md》（顶层）：指标卡/分布/对比/趋势/Feed 逐图表清单——仪表盘图表因开放平台限制无法 API 创建，需在多维表格 UI 按清单点选（约 10 分钟）；wiki 参考文档因共享应用缺 `wiki:node:read` 暂无法读取，开通后可对照调整。
- 【运行时数据保护】duty-bot 白名单事故整改：v9 推送曾用本地空 `whitelist.json` 覆盖 NAS 侧用户编辑的 18 人排除名单（日志只记条数、不进 git、无快照，不可恢复）→ 顶层 AGENTS 新增「运行时数据保护（删除前询问铁律）」；duty-bot / hub push.js 上传私有配置前自动备份 NAS 现网 + 本地条目少于现网即跳过并回填本地（`PUSH_FORCE_PRIVATE=1` 强制）；实测 duty-bot push 时本地 members 测试桩被 NAS 64 人名册自动回填，守卫按设计生效。
- 验证：gateway 同步 stub、duty-bot flow/policy、ticket-bot 多人单 20/20、bambu dispatcher 回归全过；五仓 push 后全部 online、health 200。

### v48 · 2026-09-12 · 9e4422e · docs

**顶层联动：全仓状态/联动逻辑复核 + 开发规则与 agent 指示层优化（docs）**

- 复核结论：6 服务 NAS 全量 health 200、8 工作区 git 全净；联动逻辑（网关路由→hub 分发→专项转发、duty 管辖策略、unclosed-by-group、plaza 写表、usage 同步、静默闸门）逐一与文档核对一致。
- 顶层 AGENTS：新增「机器人项目看板（多维表格）数据联动」节（四表写入方约定/建表脚本幂等/写表≠消费消息的铁律澄清）；定制窗口现状纠偏（ticket-bot/bambu policy 窗口明确"仍未落地"，不再写"随在途批补上"）；M4 昨日值日播报标注"接口就绪无消费方 + hub 预留键"。
- ticket-pm/AGENTS：新增契约 6（动态广场写表约定 + 测试隔离要求）与契约 7（gateway 接单全局抢占记录在案）；部署顺序补 duty-bot 位次与 plaza 测试隔离。
- qianli-deploy skill：项目表补 duty-bot 行；.env 规则补私有配置守卫说明；已知坑补「push 冲掉运维台名单/回答表」条目；多项目同批部署顺序 + 顶层远端说明（origin 即 bambu 名下归档仓，历史遗留设计）。
- 配套修补推送：duty-bot v12 / hub v77——tar 打包排除私有配置，堵住「SFTP 兜底清目录绕过备份守卫」的漏洞（v76 恰走该路径暴露）；hub v76 的 .env.example 标注 M4 预留键。
- 遗留待办清单（已汇总在案）：ticket-bot `/api/tickets/policy` 与 bambu `/api/print/policy` 窗口、approval-bot 广场钩子、M4 值日播报消费方、bambu 生产 APPROVAL_CODE/PRINTER_HOSTS 配置、动态广场仪表盘 UI 点选、wiki 权限开通、duty-bot 白名单重录（等用户名单）、gateway v15/bambu v21-22 DEVLOG 锚点回填。

### v49 · 2026-09-12 · b5854f4 · fix

**动态广场看板纠偏：网关活跃三表「日期」改日期类型（gateway v16/v17），仪表盘动态筛选可用**

- 用户反馈指标卡无法按「今天」过滤：根因是三表「日期」建为文本字段（文本无动态日期；且实测 records/search 的过滤对 Date 字段所有 operator 均 InvalidFilter）。
- 修复：三表「日期」Text→Date 迁移（存量自动转换零丢失）；gateway v16 写入/检索改当日 0 点时间戳 → v17 进一步改**整表拉回内存比对**根治（`bitable.listAllRecords` 替代 searchRecords），队员表新增 `open_id` 稳定身份列（姓名解析升级不产生重复行）。
- NAS 实测：清理旧格式 24 行 + force 重同步后三表行数/日期值/唯一性全部正确；《搭建指南》对应筛选说明同步更新。

### v50 · 2026-09-12 · 649ac96 · docs

**值日群引导语纯行动指引口径（duty-bot v13 + hub v78 联动）**

- 值日管辖群 @未命中引导语删去「本群为值日/快递申领专用群」「关键词彩蛋照常有效」说明性内容，只保留行动指引（@我 发送「值日助手」查看今日值日 + 查询/请假/打卡请私信机器人）；duty-bot 下发 GROUP_GUIDANCE 与 hub 断联兜底 DEFAULT_GUIDANCE 同文案，hub stub 断言指纹随更。

### v51 · 2026-09-12 · 随本提交落地 · fix

**全量 debug + 文档修正批（duty v14 / hub v79 / approval v33 / ticket v63 联动）+ 上一批手册工作收尾**

**代码修复（三个真实缺陷）**
- duty-bot v14：白名单成员补偿义务丢失 bug——生成排表路径对不在值日队列成员的插入义务静默丢弃且被误标已安置，义务凭空消失（违反「白名单不豁免补偿」口径）；现改进未安置队列，生成回执如实上报、00:30 对账照常安置。同批：README 把未实施的 M4 写成进行时的纠偏、里程碑 M3 矛盾行合并、建表脚本补「网关队员活跃」open_id 列（与线上表对齐）、.env.example 去重。
- hub v79：值日管辖群会议提醒关闭（此前会议卡片提醒对所有群照常运行，与「值日群群级功能全关」口径不符；按 duty-bot 下发管辖群严格命中跳过，空列表不放大到全群）；静默积压外迁落地（QUIET_BACKLOG_FILE=/home/qianli/hub-data/quiet-backlog.json + quietHours 自建目录 + 旧积压一次性迁移）。
- approval-bot v33：quietHours 补启动自建目录（对齐 ticket/bambu/duty）、.env.example 补 QUIET_BACKLOG_FILE 键、README 补 /api/approval/policy 窗口行。
- ticket-bot v63：README 晚间静默变量表补 QUIET_BACKLOG_FILE 行（docs，无代码改动）。
- 回归：duty 五套 stub（schedule/policy/flow/board/roster）+ hub stub-test-duty-branch 全过。

**文档修正（全仓一致性）**
- registry.js：duty 定时任务补 12:00 今日看板播报、名册 63→64 人、hub 监听链路补会议跳过、dashboard 窗口清单补 /api/windows 与 /api/nas/api。
- dashboard/public/index.html：bambu/ticket policy 占位文案「随各自在途批补上」（被 AGENTS 明文禁止的措辞）改「未落地（已登记待办）」。
- ticket-pm/LOGIC-MAP：§2.1 管道图补值日分支与会议提醒管辖跳过、§1.7/§2.2 补 QUIET_BACKLOG_FILE、§3 契约补 6/7 引用、已知限制 #7「无接单N」过时条目订正（v57 已解决）。
- AGENTS.md：DEVLOG 规则补两条惯例成文——占位哈希由下一次 push 回填、纯回填提交不占版本号、历史复用版本号（duty v8/hub v62/ticket v50）以提交哈希为准不追溯改号。
- 《动态广场看板搭建指南》：网关队员活跃表补 open_id 稳定身份列说明。

**DEVLOG 锚点系统性回填（兑现待定项 #38）**
- 顶层 v29~v50 全部占位哈希回填（v30 晚间静默批并入 cca9970 归档补交）；duty v10~v13、hub v74~v78、approval v28~v31、ticket v54~v62、gateway v15~v17（v15 锚定其代码提交 8dd86d6）、bambu v21/v22；四仓 + bambu「当前最新」指针同步修正。09-05/09-06 回溯期更早条目按「历史条目不改写」保留。

**上一批收尾（同提交入库）**
- AGENTS「用户侧总指南（桌面 HTML）——同步义务」节、维护者手册《机器人总成使用指南.md》入库、dashboard/README 引用手册、duty-bot/hub gitlink 指针更新（v13 1d522cf / v78 6328555）——上批「值日群引导语纯行动指引」的文档侧未提交部分。

**用户侧同步（工作区外）**
- 桌面《机器人总成使用指南.html》：斜杠口径收窄为仅值日指令可省 /、值日群特殊规则补会议提醒关闭与 @+纯图片静默与引导语原文、工单节补无人接单升级私聊组长、审批节补「今日已催」卡（推送+卡片清单）、口语变体「完成」→「完成了」、运维台节去维护者内幕（xlsx 覆盖/部署链路/pm2 术语）、速查表 /test-ddl 标注管理员用。
- 桌面《qianli-设计意图待定项.md》：#16/#30/#34/#38 逐条订正 + 新增第六节（39~45）记录本批发现与处置。

### v52 · 2026-09-13 · 随本提交落地 · feat

**用户拍板批：M4 值日群昨日+今日同卡 / 请假当日抽调补位 / 接单并发修复 / 六仓定制窗口齐全（duty v15 + ticket v64 + bambu v23 + hub v80 联动）**

**四项拍板全部落地**
- **M4「昨日值日播报」= 值日群一张卡同时播昨天今天**：duty v15 看板卡增「昨日战报」段（12:00 播报与手动看板共用）；原 pm-robot 消费 brief 方案作废，brief 保留通用接口，hub 预留键降级（hub v80 注释更新）。
- **有人请假必须有当日补位（从远一点的排班抽调）**：duty v15 新增 arrangeReplacement——候选=值日队列中在其后仍有排班者，同岗优先、排班日最远者优先；加插非对调（被抽调者远期班次保留+私信告知），请假人仍进下周补偿总量守恒；未做完了无法当日补位仍走下周补偿。
- **接单冲突修复**：ticket v64 按群 chatId 串行化接单（读改写链路并发互覆丢人的窗口关闭）；并发回归用例入桩测试（22/22）。
- **后端定制窗口你先设计 → 六仓齐全**：ticket v64 `GET /api/tickets/policy`、bambu v23 `GET /api/print/policy`（只读全景），运维台「功能激活」接通两域真实数据（dashboard server.js 探针 + 前端渲染重写）。

**动态广场新口径**：不再主动扩展，后续数据需求由用户提出；旧待办（approval 钩子/仪表盘点选/wiki 权限/30 天留存）撤销挂起。

**文档同步**
- 顶层 AGENTS：定制窗口现状改「六仓窗口齐全」、M4/请假补位口径并入值日域裁定行。
- registry.js：ticket/bambu 增 windows 登记、notes 更新（v64 串行化）、duty 12:00 播报口径。
- ticket-pm/LOGIC-MAP：§1.3 补接单串行化；ticket README 补串行化说明与 policy 行；bambu README 补「定制窗口」节。
- 维护者手册《机器人总成使用指南.md》：duty 节 M4 落地/补位语义、定制中心表 ticket/bambu 行、ticket/bambu 节窗口行更新。
- 桌面《机器人总成使用指南.html》（用户侧）：12:00 值日卡改「今日+昨日战报」、值日看板卡描述更新、「我要请假」补位说明、FAQ 新增「我请假了今天谁顶」、运维台定制中心窗口现状。
- 桌面《qianli-设计意图待定项.md》**重构**：已完全解决条目全部删除（38 条清单收敛为 10 条待拍板），新记动态广场新口径与四项已定口径备忘。
- 测试：duty 五套 stub（含新增补位/卡片断言与日期敏感断言修正）+ ticket 22/22 + bambu dispatch/approval 全过。

### v53 · 2026-09-13 · 随本提交落地 · refactor

**工单搬运人员口径变更：废止指定负责人专项搬运，只搬补充负责人全员（ticket v65，用户拍板）**

- 口径：自指定负责人工单也走群内播报（公示即绑定写入补充负责人）后，源表「指定负责人」的搬运分支失去意义——看板人员一律由「补充负责人」驱动：同组多人并集、跨组各归字段、与看板已有人员合并不互覆；项目性质（category）门控保留。
- 顺带修复 `mergePersonFields` 折叠丢键（跨组多补充负责人折叠时累积侧的组别字段被丢）；新增 `stub-test-sync` 12 项回归（multi-accept 22/22 不受影响）。
- 时序：创建事件先搬运后公示绑定，指定工单首次搬运到绑定间存在秒级人员空窗，由绑定写表的更新事件与每分钟补搬运自然填上。
- 文档同步：ticket README 简介/测试清单、ticket-pm/LOGIC-MAP §1.2 口径与已知限制 #1 收窄（公示链路仍取首位）、registry ticket notes、桌面意图待定项销项（原 #3）并在已定口径表记一行。
- NAS 部署完成，pm2 ticket-bot online。

### v54 · 2026-09-13 · 随本提交落地 · refactor

**网关活跃监听口径收敛为机器人交互 + 动态广场活跃表单表化（gateway v18，用户拍板）**

- 用户确认「队员活跃监听过于敏感」：gateway v18 起使用统计只计**机器人交互**（显式路由命中 / 私聊 / 群内 @机器人）；群内未 @ 落默认目标的普通闲聊不再计数，**转发行为不变**（hub 照常收到、按门禁忽略），值日群未 @ 关键词等能力不受影响。
- 多维表格同步单表化：只留「网关日活跃」（列名沿用，图表无需重建，总消息数语义=机器人交互次数）；「网关功能使用 / 网关队员活跃」两表下线，表由用户在多维表格自行删除，仪表盘对应图表（功能使用 TopN / 队员活跃 TopN）随之撤销；duty-bot 建表脚本同步移除两表定义防重建（该仓本地提交 a843c5d 暂缓部署——仓内有另一批在途改动，随下次 duty-bot push 带 NAS）。
- 文档同步：搭建指南（数据源表/图表清单删 #10、#12，指标卡 #4 改「今日机器人交互」）、dashboard/registry.js notes、顶层 AGENTS 看板节、gateway README/`.env.example`、桌面用户 HTML（网关活跃两处描述、仪表盘面板表删两行）。
- 测试：usage-sync stub 改单表口径全过；新增门控用例（未@不计/@计/私聊计/显式路由计/接单计）全过。
- 部署：gateway 路径提交 800364e 已推远端并 SFTP 部署，pm2 online、ws running，启动日志确认新同步口径；日活跃表近 30 天存量行仍为旧口径，随留存自然滚出。

### v55 · 2026-09-13 · 5311839 · feat

**「是/否」双语义根治批：值日打卡主词改「打卡」+ DDL 确认 12 小时时效（duty v16 + hub v81，用户拍板）**

> 编号注记：本条提交信息误标 v54，与并发会话的网关活跃批（gateway v18，30c8e02）撞号——按「以提交哈希为准」改记 v55。

- **值日打卡主词改「打卡」**：从根上避开与 DDL 确认抢「是」——「打卡/打卡了」入路由与 policy 清单（含斜杠变体），「是/口语变体」兼容保留；duty 全量文案（HELP/D-1/18:30 询问/看板 footer/否补救/收口回执/补位通知）改「回复打卡」。
- **DDL 确认 12 小时时效**（N=12，`DDL_CONFIRM_WINDOW_HOURS` 可配）：确认私信发出后 12 小时内回复才认；**超时项目保持原状态、次日 12:00 播报重新询问**（原 7 天窗口废止）。
- **冲突额外提示**：有未过期 DDL 确认的成员，18:30 询问追加「回『是』会确认项目，值日请回『打卡』」——hub 新增 `GET /api/ddl/pending` 供数，duty `ddlConflictClient` 短缓存消费、失联静默降级。
- 测试：duty 五套 stub（flow 新增 4 断言 + policy 清单 20→24 词）+ hub duty-branch 回归全过。
- 文档：registry（duty 指令/hub 监听链路）、ticket-pm/LOGIC-MAP §2.3 时效口径、维护者手册、桌面 HTML（时间线/指令表/FAQ 三处）、意图待定项销项原 #2 并记入已定口径。

### v56 · 2026-09-13 · 随本提交落地 · feat

**打印预约队列持久化：重启不丢排队（bambu v24，用户拍板：后续有算力，预约可持久化）**

- 分发引擎队列/打印中映射/known/完成计数落盘 `DISPATCH_STATE_FILE`（生产 `/home/qianli/bambu-data/dispatch-state.json`，项目外数据目录与静默积压同址，部署清目录不再影响）；变更防抖 300ms 原子写入，`start()` 恢复，pm2 restart 的 SIGINT/SIGTERM 退出前强制冲刷。
- known 截尾 2000 条防无限增长（恢复时队列/打印中的活动 recordId 回加）；文件损坏按空队列启动（审批事件与对账重新入队）、缺失静默跳过。
- NAS 实测：pm2 restart 后状态文件生成、恢复闭环工作、health 200。
- 测试：新增 `test/dispatcher-persist-test.js` 9 项；dispatcher/approval 既有单测回归全过。
- 文档：bambu README「状态持久化」节 + 测试清单、`.env.example`/`.env` 键、registry bambu notes、桌面意图待定项销项（bambu 队列持久化条目）并记入已定口径。
- 同批 gitlink：duty-bot（DEVLOG 建表脚本条目撞号订正 v17）。

### v57 · 2026-09-13 · 随本提交落地 · fix

**人工指定与自动匹配分发互斥：bambu 分钟级 TOCTOU 竞态关闭（bambu v25，遗留待办销项）**

- 方案：按打印机的分发闸门——`dispatching` 集合在 dispatch 入口同步 check+add（单线程事件循环内原子），finally 释放（失败/重试路径也保证）；自动匹配候选过滤分发中打印机；manualDispatch busy 校验追加分发中判定 + dispatch 入口兜底二次拒绝。闸门刻意不持久化（崩溃后清零重新评估）。
- 病灶回顾：dispatch 的下载/上传/下发是分钟级 await 链、printing 占用登记在链尾，manualDispatch 绕过 matching 串行段且 busy 校验在链前——窗口期两路对同一台打印机双双下发（上传互覆/顶掉任务）。
- 测试：新增 `test/dispatcher-manual-race-test.js` 8 项（受控 deferred 模拟分钟级链路）；persist/dispatcher/approval 回归全过；NAS 部署后 health 200。
- 文档：bambu README「分发互斥」节、registry bambu notes、桌面意图待定项销项（原 bambu TOCTOU 条目）并记入已定口径。

### v58 · 2026-09-13 · 随本提交落地 · feat

**gateway 管理端点鉴权 + 长连接启动失败自动重试（gateway v19，用户拍板：现状不接受）**

- **鉴权**：`/api/dispatch` 与 `/api/usage-sync/run` 需带 `X-API-Token` 头（`GATEWAY_API_TOKEN` 存 gateway `.env` 随 push 下发 NAS，凭据存储沿用工作区 .env 约定；timingSafeEqual 防时序侧信道）；**fail-closed**——token 未配置时两端点整体锁定（503），健康检查与只读 `GET /api/usage` 不受限。手动补数 curl 示例已带头同步进 AGENTS/搭建指南/维护者手册。
- **长连接自动重试**：启动失败（凭证错误/网络故障）按指数退避自动重试（5s 起、翻倍封顶 5 分钟），每次尝试新建 WSClient（保证同一时刻至多一条连接），成功清零计数打恢复日志；120s 看门狗兜底「start 无响应」；health 的 ws 字段新增 `connecting` 态。
- NAS 实测：无 token 两端点 403；带 token usage-sync 200（真实同步 09-12/09-13 两天数据）、dispatch 200；health `ws: running`。
- 顺带：gateway v18 锚点回填（800364e，对方会话漏回填且头部指针停在 v17）；DEVLOG 头部指正 v19。
- 文档：gateway README、registry gateway notes、桌面意图待定项销项（原 #2 gateway 条目）并记入已定口径。

### v59 · 2026-09-13 · 随本提交落地 · feat

**接单按群门禁：无单群不监听接单及其变式（ticket v66，用户拍板）**

- 哪个群有单，哪个群才接单：群内接单类消息先查该群实时接单队列——**队列为空即静默忽略**，非工单群（如值日群）与当前无单的组别群不再收到「无待接单工单」/使用提示噪音；有单群行为不变；指定负责人 p2p 私聊确认不受影响。
- 设计取舍：网关路由不改（全局转发保留），响应收窄放在 ticket-bot 端用实时数据判定——比网关侧静态群清单更准（组别群当前没单时同样安静），也避免了「网关+工单管辖群联动批次」的配置耦合。
- 文档：ticket-pm/AGENTS 契约 7 改「已落地」、LOGIC-MAP §1.3/契约 6、registry、桌面 HTML FAQ、维护者手册、意图待定项销项并记入已定口径。

### v60 · 2026-09-13 · 随本提交落地 · refactor

**值日群未@关键词回答全群统一 + 值日助手仅 @/私聊（hub v82 + duty v18，用户拍板）**

- 口径：值日群的关键词回答与所有群完全一致（未@/@ 都生效，不再有放行开关）；「值日助手」看板仅 @ 或私聊触发（事实收敛——看板本就在 @ 路径，未@从来不出看板），保留词撞车校验整体移除（回答表用词不再受限，撞车根源已消失）。
- 实现：hub autoReplyService 删 `keywordAllowedInGroup` 门禁与 `assertNoDutyConflict` 校验；chatService ② 的 @关键词回答去 `keywordPassthrough` 条件；dutyPolicyService/duty policyService 双侧清死 flag；hub stub ⑩ 场景改「全群统一照常回答」、⑭ 改「含值日助手规则不再被拒」（upsert 后 deleteRule 清理不污染真实表）；duty policy 桩同步。
- 文档：hub README 回答表校验说明、LOGIC-MAP §2.4、registry hub notes、维护者手册 hub 管道行、桌面 HTML 值日群特殊规则行。

### v61 · 2026-09-13 · 随本提交落地 · docs

**全项目文档重审 + 机器人体系建设推荐（运维台不自启拍板收项；四仓 README 文档批联动：duty v19 / hub v83 / ticket v67 / gateway v20）**

- **文档重审**（两路并行审计：跨仓一致性 + 用户侧时效性）：共发现 20+ 处必修复——多数为 09-12/09-13 高频批次后的旧口径残留（打卡主词、DDL 12h、两表下线、M4 落地、搬运废止、policy 占位句），全部订正：顶层 AGENTS 三处（五仓静默清单/五仓窗口措辞/值日群裁定行新机制）、registry 四处（duty commands 打卡/值日群裁定行/bambu 状态路径/活跃看板描述）、duty/hub/ticket/gateway 四仓 README（各自带 DEVLOG 文档批推送上线）、维护者手册四处（单表化/policy 占位/hub 12h/bambu 可靠性）、搭建指南（approval-bot 改维持现状）、桌面 HTML 七处（12h/打卡/两表/M4/版本行等）。
- **顶层 DEVLOG 头部指针漂移订正**（v57→v60，连续批量中漏改）。
- **运维台拍板收项**：不自启维持、无口令维持——意图文档销项并记入已定口径；动态广场「四表」表述随 gateway v18 单表化订正为两表。
- **机器人体系建设推荐**：意图文档新增第四节，产出 7 条待拍板推荐（共享工具层收敛/写端点鉴权模板推广/网关投递 at-least-once/部署前测试闸门/NAS 数据每日快照/全链路 traceId/前瞻 LLM 兜底与双应用预案），每条含痛点→方案→成本→优先级，等你勾选排期。

### v62 · 2026-09-13 · 随本提交落地 · fix

**全项目深度代码审查批：五仓 20 处确认 bug 修复 + 工程规则成文（duty v20 / hub v84 / ticket v68 / gateway v21 / bambu v26）**

三路并行深度审查（duty、hub+gateway、ticket+bambu）确认 20 处真实 bug，全部修复：
- **duty v20（9 处）**：收口不幂等双计补偿、18:30 后补位者无会话被记未做完、看板 4 人日隐藏第 4 人、排班把未来插入日当 lastDuty、补位可落过去日期、placed 标记非原子、询问/提醒无逐人隔离、并发请假竞态、状态文件损坏自毁（原子写+损坏保留现场）。
- **hub v84（3 处）**：/api/ddl/pending 不过期清理（值日询问被永久错误附加冲突提示）、失败回退顺序丢记录、多项目待确认「是」恒完成第一条。
- **gateway v21（2 处）**：**v19 重试整体不可达**（SDK start() 永不 reject，改为 onError/getConnectionStatus 回调驱动 + 30s 巡检；hub/README 同步）、usage 只挂 SIGTERM 丢 60s 统计。
- **ticket v68（1 处）**：通讯录失败永久负缓存致组别解析终身退化——失败不缓存。
- **bambu v26（4 处）**：分发中重启任务永久丢失（in-flight 显式追踪，恢复重回队列）、printing 幽灵滞留（10 分钟巡检补收尾）、manualOnly 不移出队列被自动匹配覆盖、重试耗尽单人工恢复通道。
- **工程规则成文**（顶层 AGENTS 新节「全局工程规则」）：管理/写端点必须鉴权（auth.js 模板）、DEVLOG 头部指针随批维护（已三次漂移）、行为改动必须过桩测试。
- **文档补缺**：ticket-pm/LOGIC-MAP 接单门禁已知边界、bambu README「可靠性与自愈」节。
- 回归：duty 五套、hub duty-branch、ticket 22+12、gateway usage-sync、bambu 4 套全部通过。意图文档待拍板清单维持 3 条 + 体系推荐 7 条。

### v63 · 2026-09-13 · 随本提交落地 · feat

**体系推荐落地批：统计覆盖规则 + 写端点鉴权铺开 + 部署前测试闸门 + 投递可靠性 + traceId + NAS 快照（R2-R6 授权先做；hub v85 / duty v21 / ticket v69 / approval v34 / bambu v27 / gateway v22-v23 联动）**

- **队员/功能统计覆盖**（回答「队员活跃是否只读交互/能否扩覆盖」）：网关路由层只看得见 @/私聊/显式路由——新增 `POST /api/usage/report`（X-API-Token）归因通道（recordFeature 只加用户与功能计数不加 total 防双算）；hub 关键词回答命中（@与未@）与 DDL 确认回复已接入上报。AGENTS「全局工程规则」成文第四条：新交互能力必须在命中点上报，此后新功能自动被队员活跃/功能统计涵盖。
- **R2 写端点鉴权铺开五仓**：gateway auth.js 同款模板分发 duty/hub/ticket/approval/bambu（src/auth.js，API_TOKEN 全局共享值 fail-closed）；管理/写端点全部锁定（duty policy/whitelist/refresh/test-*、hub autoreplies/keywords/projects/logs、ticket sync/bot-*、approval test-*、bambu 打印机控制与对账）；`/api/chat/command` 与 `/api/feishu/event` 为用户可达链路不挂闸。运维台 /api/nas/api 代理对 POST 自动附共享头（凭据直读 approval-bot/.env）。NAS 实测：五仓无 token 全 403。
- **R4 部署前测试闸门**：六个 push.js 部署前自动跑本仓全部 stub 测试，失败中止（SKIP_TESTS=1 可跳）。自证有效：hub 首推即被闸门拦截一次。
- **R3 投递可靠性**：deliverTo 失败 3s 后重试一次 + 按消费者失败计数，/api/health 新增 delivery 字段。
- **R6 traceId（部分）**：网关路由层生成 evt_xxx 随转发载荷透传并打日志；各仓接入随改随加。
- **R5 NAS 快照**：/home/qianli/scripts/snapshot-data.sh（tar 各 *-data → backups/YYYY-MM-DD/，14 天滚动）+ crontab 每日 03:30，首拍已验证。
- **状态**：R1（共享工具层收敛）排下一批次（纯重构需整批回归）；R7 维持前瞻（LLM 需密钥决策、双应用需量级触发）。
- 鉴权值统一：网关 GATEWAY_API_TOKEN 与五仓 API_TOKEN 同值（gateway v23），运维只记一个。

## v64 · 2026-09-14 · 随本提交落地 · feat+docs+fix

**网络拓扑看板上线 + 部署目标迁移收尾 + 实验室网络 skill 与全局规则 + 联动 duty-bot v22(写表 bug 修复)**

- **运维台新增「🌐 网络拓扑看板」**：`GET /api/network` 五节点并行 TCP 探测（互联网/飞书云/主路由/小电脑/旧NAS，2.5s 超时封顶）+ 出口 IP（`/api/egress-ip`，5min 缓存）；前端分层拓扑图（云端/网关/本地设备）带端口时延徽标，30s 自动刷新。拓扑清单 = server.js `NET_TARGETS`（改拓扑先改它）。运维台 UI 口径全量「NAS」→「主机」（24 处；API 路径 `/api/nas/*` 与 `NAS_*` 键保留为历史命名）。
- **部署目标迁移收尾**：AGENTS 新增「部署目标」权威条目（小电脑 DESKTOP-FE1MIGI 192.168.31.57:22，旧 NAS 10.253.33.233 停用为备件）；qianli-deploy SKILL 与 9 个 README/指南全量「NAS」→「部署目标」表述清扫（历史命名标注）；运维台开机自启落地（启动文件夹 VBS + dashboard/autostart.bat 守卫启动器）。
- **全局规则新增**：AGENTS「会话遗留改动回库与文档补链」——agent 会话未随批入库的改动，下一会话 push 前必须 `git status` 盘点、合并提交、补齐文档。
- **新 skill**：`.agents/skills/qianli-lab-network/SKILL.md`——实验室网络拓扑/设备接入/断网排查手册（假 ping/TTL、路由环路、UAC 远程过滤、bat ASCII 铁律、MSI 静默失败、pm2 环境快照、bash & 链式陷阱、飞书 IP 白名单指纹）。
- **联动 duty-bot v22**：bitable.js `batchCreateRecords` 双层包裹修复（`{fields:{fields:{...}}}` → 飞书 FieldNameNotFound 1254045；排班批量写入自上线首次成功，值日表 90 条首落 2026-09-15~10-14，白名单 13 人含 Siu/汪沛宇 生效）——根因与排障全程见 duty-bot DEVLOG v22 与桌面《工作日志-2026-09-14-网络与机器人抢修.md》。
- **工具**：enable-sshd.bat / install-openssh.bat + OpenSSH-Win64.zip（小电脑 OpenSSH 离线安装组合，sshd 已上线 :22）、fix-duty-bot.bat（duty-bot pm2 环境重建）。

## v65 · 2026-09-14 · 随本提交落地 · feat

**抽奖系统上线（hub v86）：走关键词回答全群链路 + 本地抽奖配置表 + 运维台登记**

- **hub（ticket-pm/project-management-robot v86）**：新增抽奖能力——群消息包含触发词（默认示例「抽奖」）即按概率抽一条奖品文字原文回复，**无需 @机器人、全群生效**（@机器人时同样命中且优先级最高：抽奖 > @触发回答 > 关键词回答，互斥不双回；私聊不触发）。奖品/概率填项目根目录《抽奖配置表.xlsx》（触发词/奖品/概率三列，概率口径与「关键词回答」表一致：留空均分、不足 100 归一化、超 100 压缩、0=永不中），`scripts/syncLottery.js` 随 push 转 `lottery.json` 上线，运行时每消息重读即时生效。定制窗口 `/api/lottery/rules*`（读 + X-API-Token 写，热改 `.local.json`）；`/lottery` 指令查看奖池与概率；命中上报网关统计（feature=抽奖）；`LOTTERY_CHAT_IDS` 可收窄群范围。stub 测试新增抽奖场景全过；README/DEVLOG 同批。
- **联动改动**：dashboard/registry.js hub 登记（抽奖窗口 4 条 + 指令/监听/权限说明）；顶层 AGENTS（职能表归属信号 + 附属窗口现状行补 `/api/lottery/rules*`）；用户侧《机器人总成使用指南.html》与维护者 MD 指南同步抽奖用法；hub DEVLOG 头部指针修复（此前滞留 v82，实际已 v85）并顺手回填 v83/v84/v85 哈希。
- **遗留改动随批入库**（会话遗留改动回库规则盘点）：①hub `push.js` 部署目标迁移收尾路径改动（NAS→小电脑 Windows 路径，上一会话遗留）一并提交，私有上传清单泛化（autoReplies + lottery，同套现网备份+条数守卫）；②`.agents/skills/qianli-lab-network/SKILL.md` 校园网单会话生命线/互踢陷阱/出口 IP 漂移要点（v64 skill 的后续增补）；③**dashboard/server.js 修一个 HEAD 既有 bug**——`/api/network` 响应引用 `t0` 但从未定义（拓扑接口每次必抛 ReferenceError），工作区遗留的 `const t0 = Date.now();` 正是修复行，入库；④approval-bot v36（8dfccd9，纯 docs）：README「部署到 NAS」→「部署到部署目标」表述清扫收尾（v64 清扫漏网），submodule 指针随批更新。

## v66 · 2026-09-14 · 随本提交落地 · refactor

**抽奖改版联动（hub v87）：奖池一行=一个奖品 + 触发词升级为 /指令 + 群聊 /help 精简运维指令**

- hub v87 三连改（用户反馈）：①抽奖配置表改**一行=一个奖品**（触发词/奖品/概率，同一触发词多行=同一奖池，适配大量奖品）；②触发方式从「消息包含关键词（未@全群）」改为**@机器人 发 /触发词 的动态指令**（精确匹配不误伤闲聊；值日管辖群可用、审批群不开放、动态进 /help）；③群聊 /help 不再展示 /status /test-ddl /keywords /autoreply /history 五个运维/诊断指令（仍可直接使用）。stub 测试按指令口径重写全过；README/LOGIC-MAP/registry/用户指南 HTML+MD/顶层 AGENTS 同批。
- 联动登记：registry hub commands/listening/permissions/notes（抽奖指令口径 + help 精简记录）；AGENTS 职能表归属信号改「抽奖（/指令）」。

## v67 · 2026-09-15 · 随本提交落地 · refactor

**抽奖收敛单指令大奖池联动（hub v88）：表格只填 奖品|概率 两列，/抽奖 一个指令对应无限奖品**

- 用户澄清「一个抽奖指令对应无穷可填的奖品和概率」：hub v88 把抽奖配置表瘦身为奖品|概率两列（整表=/抽奖 的大奖池，一行=一个奖品、行数不限），指令名挪到 .env 的 LOTTERY_COMMAND（默认「抽奖」，可改名/配别名）；解析器兼容 v87 旧格式（旧表示例行仍为注释，0 有效奖品）。registry/AGENTS/用户指南/LOGIC-MAP 同批。

## v68 · 2026-09-15 · 随本提交落地 · refactor

**抽奖多奖池定稿联动（hub v90）：一个工作表 = 一个抽奖指令 = 一个奖池**

- 用户定稿：抽奖配置表按 sheet 组织，工作表名即指令名（复制表改名=新抽奖），表内奖品|概率两列行数不限；无「奖品」表头的表自动忽略；LOTTERY_COMMAND 废弃。hub v90（服务层无改动，stub 全过）；registry/AGENTS/用户指南/LOGIC-MAP 同批。

## v69 · 2026-09-15 · 99bdc4d · feat

**新项目 wecom-attendance-bot v1 诞生：企业微信考勤周报机器人（负责人群每周播报打卡数据）**

- 功能：定时（默认周一 09:30 上海时间）调企微 `checkin/getcheckindata` 拉上一完整周打卡记录（考勤机已同步进企微，不碰硬件）→ 按人聚合打卡天数/异常 → 群机器人 webhook 播报 markdown_v2 周报卡 + CSV 明细附件（替代手机手动导出）；补发看门狗每小时对表（漏播/失败自动补，水位防重复）；拉数失败向同群发告警卡（webhook 不走可信 IP，60020 附处理提示）；
- 架构裁定：**企业微信域项目**——不消费消息事件、不接 feishu-gateway、不受对话铁律/统计上报规则约束；部署共用顶层链路（repo:top 模式同 gateway，SFTP 直传小电脑，pm2 名 `wecom-attendance`，端口 3007）；members.json 沿用 duty-bot 备份+守卫；写端点 X-API-Token 照 gateway auth.js 模板；
- 四套桩测试 51 断言全过（窗口时区锚定/聚合渲染/存储/企微分批），push.js 内置测试闸门；开发期修三处真 bug：weekWindow 双重时区转换、分批断言边界、nextSendTime 前后方向（node-cron 3.x 无 nextDates，下次执行时刻自算）；
- 同批登记：dashboard/registry.js 新增 wecom-attendance 条目、qianli-deploy SKILL 项目清单收编（六个项目）、顶层 AGENTS 职能表加行、用户指南 HTML 增补；本批入库说明：v68 归档时本目录曾被误扫入库、由 `11fef0e` 撤出并留言待本项目会话规范入库，本批即该正式入库；
- 待办：企微管理后台建自建应用+「打卡-可调用接口的应用」授权+可信 IP 后回填 `.env` 的 WECOM 三项与成员名单，`POST /api/attendance/test-broadcast` 真发验证；「缺卡判定」留 v2。

## v70 · 2026-09-15 · 7c836f9 · fix

**全项目深度审查修复批：五路并行审查六域，P0 级纰漏当晚清零**

- 审查范围：gateway / ticket-bot / hub / approval-bot / bambu / duty-bot / wecom / dashboard / 顶层文档一致性（五路并行代码审查，逐条 file:line 证据）。各仓修复明细见各仓 DEVLOG 当批条目（wecom v2、pm-robot v91、ticket v70、duty v23、bambu v28、gateway v25），要点：
  - **数据保护**：wecom/duty 两仓 push.js 守卫时序缺陷修复（rm -rf 之后才读现网=守卫+备份整体失效，2026-09-12 白名单覆盖事故的完整复现路径）——盘点前置于目录替换、种子过期跳过并回写现网、policy-override.json 入保护清单；
  - **功能性 bug**：hub DDL 确认漏 require usageReport（ReferenceError 吞统计+中断事件链）；ticket 组长解析负缓存回归（v68 漏改第三处）；bambu 六写端点漏鉴权（可绕审批开打印）；wecom 部署路径/静默闸门/长度熔断/健康检查；
  - **安全**：dashboard 命令注入面关闭 + 裸 spawn 分支移除 + Host 校验；gateway 投递统计如实计数；
  - **部署链**：ticket/duty/wecom/gateway 四仓 push.js restart 步骤补 PATH（小电脑非交互 shell 无 node/pm2，代码已传服务不重启）；
  - **文档**：维护者手册 MD 补 wecom（六大→七大机器人）；registry 四处漂移；六仓 DEVLOG 指针与占位哈希全部落定；approval-bot 积压 commit 推上 GitHub；
  - **遗留改动入库**：ticket-bot 部署目标迁移适配（上次会话遗留 README+push.js 未提交）随本批规范入库。
- 桌面《qianli-设计意图待定项.md》同步：wecom 上线前置待办（凭据/名单，09-21 首播前）、已落地清单、新增建设推荐 R8~R14。
- duty-bot 白名单增补 3 人（洪博寰/郝骏锋/zyicome，值日排除名单 13→16，写窗口操作有备份）；值日助手全链路（gateway→hub→duty-bot→webhook）注入式实测通过。

## v71 · 2026-09-15 · 随本提交落地 · feat

**wecom-attendance-bot v3：播报并入现有飞书体系（用户拍板「应用也走现有应用」）**

- 用户提供飞书负责人群自定义机器人 webhook，播报主通道切到飞书群机器人（数据源仍=企微打卡 API）：新增 `src/feishu.js`（webhook 卡片+签名，对齐 duty-bot webhook.js；CSV 经现有应用 im API 可选）；调度器改每通道独立投递水位（重试只补未送达通道）；失败告警双通道；health/policy 增通道布尔。通道连通性已真发验证（code:0 入群成功）。
- 新增 stub-test-feishu（18 断言）六套全过；修异常明细行日期重复渲染。registry/项目 AGENTS/README/用户指南 HTML 同批改口径。

## v72 · 2026-09-15 · 8f8a4f9 · feat

**R8~R14 建设推荐全量落地批（接 v70 审查批；R13 运维项与 4 项部署待回站补做）**

- R8 bambu v29 分发可靠性包：failTask 运行期失败接入重试/让位通道（原只回写「排队中」不重排，单据永久滞留）；givenUp 落盘（人工恢复通道重启失效）；sweepStalePrinting 补审批源守卫；dispatcher-persist-test +6 断言。
- R9 hub v92 交互互扰治理：DDL 确认在 p2p 对值日词表让位——「打卡/打卡了」恒让位（不再误发「请回复是/否」），口语变体先转 duty-bot（有活跃值日会话才接管，否则回落 DDL 确认）；循环加载链改调用时惰性 require；stub +6 断言。
- R10 鉴权收尾：FEISHU_VERIFICATION_TOKEN 共享密钥补配到网关+四仓 .env（转发帧注入 token、消费方校验真实生效，event 端点 fail-open 关闭）；query token 传参废除（gateway/duty/wecom auth.js）；hub projects 写动词+logs+test-broadcast 补 X-API-Token；bambu useLongConnection 缺省翻转 false（空壳模式防误配）；gateway health 对非回环调用方收窄为存活摘要。
- R11 gateway v26 投递语义：事件模式下游 HTTP 失败与传输异常同款重试一次（消费方 messageId 幂等）；command 模式保持不重试（指令无幂等键防双执行）。
- R12 ticket v71 接单锁全局化：多组别工单跨群并发 chatId 锁盲区关闭，stub-test-multi-accept 新增跨群回归（24 项）。
- R13 卫生批：approval/bambu/ticket/duty 数据路径 POSIX→C:/home 显式化；wecom push 重启改 delete+应用目录 start（修 cwd/快照残留）。**待补**：pm2-logrotate 安装、开机自启复核、wecom cwd 修正重启（目标机不可达）。
- R14 dashboard 服务看门狗：逐时 SSH 巡检 registry 全部 pm2 服务 health，连续 2 轮异常/恢复推群 webhook（duty 群通道，WATCHDOG_WEBHOOK_URL 可覆盖），过静默闸门+12h 重提醒；GET /api/watchdog。
- **待补部署**（本机随用户离站、家庭 LAN 不可达，代码均已推 GitHub）：gateway v26、duty v24、wecom v4 三仓 SFTP 部署；回站后各仓 npm run push 即可（git 步骤无改动，直达部署）。

## v73 · 2026-09-16 · fb9abd7 · feat

**wecom v5 方案4：打卡数据源改人肉周导（名单问题随批解决）**

- 背景与拍板：企微自建应用配置可信 IP 被强制门槛拦截（须先有可信域名/接收消息回调，均需公网可达，家里 NAT 无解），用户拍板放弃 API 走方案4。凭据已验证有效（gettoken ✓，打卡接口 48002 待门槛，API 链路保留可切回）。
- wecom v5：新增 importService（xlsx/csv 报表解析，表头模糊匹配+上海时区三态换算）+ POST /api/attendance/import（X-API-Token，base64 上传；**解析即名单自动合并落盘——名单不再需要手工维护**）+ runWeekly 数据源分支（按播报窗口过滤，未导入/窗口未覆盖时给明确错误，cron 未导入走失败告警群内可见）；`ATTENDANCE_DATA_SOURCE=import` 已切。
- stub-test-import 15 断言（七套全过）；wecom 桩测试凭据隔离（真实凭据入 .env 后不再依赖"env 为空"前提）。
- registry 标注 import 端点；AGENTS/README 数据源口径更新。

## v74 · 2026-09-16 · 960ec4c · fix

**值日私信链补强（duty v25）+ 运维台看门狗误报修正（R14 v2）**

- duty v25（取证驱动）：09-15 六个定时任务全部正常触发、无发送失败，但 3 名成员全天零响应被收口未做完——缺口在触达频次与收口告知。新增 **21:00 临门提醒**（收口前 1 小时私信未完结队员，分态引导：已传照片只需打卡/未传引导照片+打卡/做不完告之后果）；**收口私信未做完者本人**（missNotices：补偿预告+值日助手引导；photoOnly 保留兼容）。stub-test-flow +8 断言；cron 任务 5→6。
- dashboard 看门狗 v2：修复 09-16 00:41 误报（本机随用户离站，SSH 失败被当成目标机故障，半夜告警进群）——**分层探测**：先探家庭网关 192.168.31.1，路由器不可达=本机离站，巡检挂起不告警；告警静默窗口加宽 02:00–09:00 → **23:00–09:00**（WATCHDOG_QUIET_START/END 可配）。附带清理：stub-test-board 退出竞态加固（libuv handle closing 崩溃致闸门闪失败）；运维台旧实例已重启换新代码。
- 运维持意：pm2-logrotate 轮转后 pm2 daemon 日志句柄不重开（新日志写进轮转文件、新文件 0 字节）——`pm2 reloadLogs` 重开，已执行；duty-bot 同批重启恢复正常日志。

## v75 · 2026-09-16 · 05d9226 · feat

**运维台改名「曼波大模型」+ 网络拓扑真图 + 路由器在线设备发现**

- 改名：页面标题/横幅/启动日志/registry 标签 → 「曼波大模型」（内部标识 dashboard/:3100 不变）。
- 拓扑树重画：云端（飞书/互联网）→ 出口 IP（主干标注）→ 主路由 → 分支（笔记本·曼波大模型/小电脑/旧NAS + 发现的在线设备），CSS 连线（rail/trunk/stub）替代原分层卡片。
- LAN 设备发现（GET /api/network/lan，60s 缓存）：ping 扫本机所在 /24 填充 ARP → 解析 arp -a → 已知设备（主路由/小电脑/旧NAS）合并标注，其余显示 IP+MAC 前缀+厂商猜测；本机不在家庭网段返回 offsite（前端挂起提示）。实测发现 11 台在线设备。
- NET_TARGETS 补 3007（wecom）端口探测。
- 附：approval-bot / pm-robot 有并行会话进行中的工作（未提交改动与默认信息提交），本批仅锚定其 gitlink 现状，未触碰其内容。

## v76 · 2026-09-16 · 8a877cc · fix

**全量 debug 回归批二：新代码复查修复（wecom v6 / duty v26 / gateway v27 / dashboard）**

- 两路并行代理复查今晚新代码，确认缺陷当晚全修：gateway deliverTo 重构（R11 重试失败误入传输 catch 致三连投递+failed 计数污染，改为统一按尝试计数）；wecom 导入防呆（≥2 时间列判定日报/统计模板直接报错、空姓名+空账号行跳过防幽灵用户）；duty 临门提醒会话补建（防打卡无人认领误记未做完）+ missNotices 幂等守卫（双跑私信不重发）+ 管理摘要标注未绑定未通知 + test-lastcall 端点；dashboard LAN 声明补齐（首屏 ReferenceError）、lanScan 错误缓存 TTL（防 30s 轮询重扫）、看门狗发送风暴守卫、Host 校验补 [::1]、shellSafe 剥 %。
- 遗留观察项（低危，详见桌面《设计意图待定项》）：xlsx 0.18.5 已知 CVE（输入面受控）、LAN 网段前缀硬编码、恢复通告静默丢弃、smoke-test 未附 token 失效等。
- 另发现并记录：昨晚消费方先上 token 而网关未注入的窗口期（约 23:40–00:45）转发事件会被 403 拒收——已自愈（网关 v26 注入验证 ✓），后续部署顺序应先网关后消费方。

## v77 · 2026-09-16 · 37c335c · fix

**运维台全交互审计修复：hub 快捷部署 cwd 错误（用户上报）**

- 用户从运维台点 hub「npm push 部署」报 Missing script "push"：registry hub.dir 指到 server/ 子目录（无 push 脚本）。修正 dir=项目根 + localRun.script=server/src/index.js + test-duty 动作 cwd=server（脚本在 server/scripts，依赖 server/src 相对路径）。
- 全交互审计：registry 全项目动作静态核验（push/install/test 脚本与 cwd 逐项存在性）+ 全部 HTTP 端点动态探测（overview/stats/activity/windows/network/lan/watchdog/egress-ip/action-log/nas-log + SSH 代理直达六服务 policy 与 hub 规则 CRUD 路由）全部 200；动作链以 hub test-duty 真实跑通（exit 0）。
- 目标机补 pm2 reloadLogs（logrotate 轮转后 daemon 日志句柄残留问题波及 wecom，已恢复）。

## v78 · 2026-09-16 · f324145 · docs

**push.js 部署目标文案清扫（gateway/bambu，docs）**

- 用户问「真的是传到 NAS 吗」——核实：hub 实际目标=小电脑 192.168.31.57（server/.env NAS_HOST，/c/qianli/opt/knowledge-tracker，文件时间戳佐证），「NAS」仅为历史命名残留文案。四仓 push.js 用户可见文案统一清扫为「部署目标」（hub 15 处/ticket 13 处/gateway 3 处/bambu 7 处）；NAS_* 变量名保留（顶层 AGENTS 已成文其语义）。
- 联动：hub v93（6a3e228）、ticket v72（8f40cb7）各自仓库已推；gateway/bambu 随本提交归档。

## v79 · 2026-09-16 · dcf3759 · docs

**NAS 残留全链清扫（docs；approval/hub 因并行会话占用跳过待补）**

- .env.example 五份里的四份（gateway/ticket/duty/bambu）：旧 NAS 地址端口用户（10.253.33.233:8500/qianli）→ 小电脑实际值（192.168.31.57:22/mechax），注释统一「NAS_ 为历史命名，语义=部署目标」——照抄模板的新部署不会再连去旧 NAS。approval/hub 的 example 因并行会话占用未动。
- 文案：duty push.js 头注释与 init-duty-table 输出、gateway auth 注释、dashboard 拓扑注释 → 部署目标口径。
- bambu push.js 移除旧 NAS 时代的 sudo/chown qianli:qianli（新机不存在该用户，此前全靠 `;` 容错；顺带消除命令行带密码的泄露面）。
- 联动 duty v27。

## v80 · 2026-09-16 · 08bd733 · feat

**运维台 UI：拓扑卡片统一栅格 + 未识别设备踢出/封禁**

- 拓扑卡片改统一栅格（auto-fill 176px 等宽、等高裁剪、端口芯片超出折叠 +N），消除大小不一；样式与暗色主题统一。
- 未识别设备新增「踢出/封禁/解封」：走小米路由器管理 API（router-xiaomi.js，社区公开登录算法：key→nonce→sha1 链→stok；设备列表 devicelist；禁用上网按固件候选端点尝试并带回原始响应）。封禁名单持久化 .banned-devices.json（离线也展示、解封恢复），凭据=approval-bot/.env 的 ROUTER_PASSWORD（未配置时按钮返回明确引导，不发路由器）。GET /api/router/status。
- 已实测：登录算法需真实密码验证（待用户提供 ROUTER_PASSWORD 后联调端点命中情况）。

## v81 · 2026-09-16 · 随本提交落地 · docs

**duty-bot v28 锚点归档：照片凭证下载接口修复**

- duty-bot v28（随本提交归档）：照片收录「传不上去」根因修复——旧下载接口 `im/v1/images/{key}` 只能下机器人自传图，用户图片一律 234001（功能上线以来零成功）；换消息资源接口 `im/v1/messages/{id}/resources/{key}?type=image`。取证→线上实弹验证（旧接口复现基线/新接口形状被接受/drive 上传权限已具备）→五套桩测试全过→部署重启全绿。
- 本批仅 duty-bot 单仓行为变更，顶层无代码改动，纯锚点归档。

## v82 · 2026-09-17 · 随本提交落地 · feat

**全量 debug 批（七仓联动）+ duty-bot v29 快递助手上线**

五路并行代码审查（gateway+hub / ticket / duty+wecom / approval+bambu / dashboard+文档）→ 修复实现 → 各仓 stub 全绿（duty 6 套含新 express 29 项 / ticket 24+12 / wecom 7 套 / approval v39 扩充 / bambu 4 套 / gateway）。要点：

- **duty-bot v29 快递助手**（新功能）：快递申领群 @「/快递」开 5 分钟登记窗口（群内非@取件码/照片经 hub 观察转发收集，架构铁律不破），写「机器人项目看板」base「快递」表（用户手工建表+脚本补 登记时间/取件时间/消息ID）；每小时整点未取播报（过静默闸门）；「已取n/全部已取」确认回写；「查询当前快递」；词形/指令子集经 duty policy 下发 hub 消费。
- **hub v94**：值日分支④误拦口语词修复（groupCommands 拆分）；快递助手路由+观察转发+duty 转发 8s 超时；P0 修复 .gitignore/*.local.json 通配 + push 私有清单补 mention 表（真实姓名不再进 git）；plaza appToken 死配置修活；auth 废 query token；权重 0 语义；broadcast-state 可外迁；.env.example NAS 收口。
- **ticket-bot v73**：广场文案 undefined 修复；搬运不再打回 priority 编辑；reconcile 防重入+broadcast per-record 锁（双播关闭）；webhook URL 脱敏；审批反查翻页；event fail-closed；字段名接 config；push 远端 node 探测；DEVLOG 指针 v69→v73 + 三版哈希回填。
- **approval-bot v40（含 v39 工作区批收口上线）**：催发票 parseDeferDays 复合中文数字/间隔闸日历日比较/当日新增关注不再吞卡 三处逻辑 bug；桩扩到 ×16+48h 边界。
- **bambu v30**：审批直连重启 trigger('restore')；sweepStalePrinting 落盘；approval_task 失败可重试；webhook 超时；配置收口。
- **wecom v7**：import const 崩溃修复（09-21 首播前关键）；push 名册守卫补「本地缺文件→远端回填」；CSV 落盘兑现；cron 过静默闸；policy 不漏打卡明细；+8h 口径；fetch 超时；quietHours 双格式。
- **dashboard/registry**：抽奖编辑器错表 P1 修复；wecom action 窗口 registry 驱动；ROUTER_PASSWORD 闭环；router-xiaomi AbortSignal；看门狗恢复过闸+host 键回写；registry 漂移修正+快递助手登记。
- **文档**：桌面《机器人总成使用指南.html》+《使用指南.md》同步（七大口径、duty 21:00/快递助手、approval v39 节奏、快递播报卡/快递表、定制中心 wecom/抽奖行）；ticket-pm/LOGIC-MAP 四处修正；AGENTS.md 值日 bullet+职能总表加快递助手。
- **运维发现（待拍板，见桌面意图文档 #5）**：「动态广场」表已不在 base（TableIdNotFound + 重建重名=回收站占名），各仓广场事件写入自删除起静默失败；建表脚本已加容错+大声告警。桌面《qianli-设计意图待定项.md》新增本批落地清单（八）与建设推荐 R15~R24（九）。
- 部署顺序：duty → hub → ticket → approval → bambu → wecom → 顶层。

### v77 · 2026-09-19 · 随本提交落地 · fix

**四仓联动修复批：R25/R26/R27 落地 + 杨杨文琦请假事件修复 + 日志基建回归处置**

- **hub v100（d195062）**：DDL 播报错峰 `CRON_SCHEDULE` 12:00→12:05（09-18 当日播报被限频炸掉的治本补丁，生产已验证下次执行 12:05:00）；duty 转发超时 8s→15s + 超时文案改「可能已受理，以私信回执为准」。
- **duty-bot v32（d6fef48）**：补偿义务满周自动顺延下周（deferCount+对账报告可见，不再静默留队到过期）；请假回执不再 await 被抽调人私信；flow 断言定向 D+新增顺延断言（09-18 日期敏感误报第三次复发的根因修复）。
- **approval-bot v41（158034a）/ bambu v31**：`npm test` 由 echo 占位改为与 push.js 闸门同一清单（R27），纯元数据批。
- **杨杨文琦请假事件结论（09-18）**：私聊 4 次交互（20:07、21:56×3）全部 hub 转发超时误报失败——duty 侧实际把 3 条补偿义务（09-19/09-27×2 含连续缺勤加罚）全部登记成功，属「回执超时误报失败」而非功能坏；本批 hub+duty 双侧修复。
- **运维事件：日志基建回归**——意图文档六.5 已判「不可用」的 pm2-logrotate 模块实际仍在跑（09-16 15:50 起 uptime 2.78 天），retain:7+高频轮转把 09-18 白天前的全部日志吃光（qianli-log-truncate 的 archive 归档因轮到它时日志已被清空而恒空）；已 `pm2 delete pm2-logrotate`+save，qianli-log-truncate（每小时 14 分，归档 14 天）为唯一轮转通道，日志恢复积累。教训：模块卸载后需复核进程表。
- 文档：hub README/LOGIC-MAP §2.2/指南 MD/桌面 HTML DDL 播报时刻 12:00→12:05；duty README 补偿/对账节；意图文档 R25~R27 落地标注。
- 部署顺序：duty → hub → approval → bambu → 顶层。

## v83 · 2026-09-20 · 随本提交落地 · fix

**全量 debug 批（六仓联动）：两处 P1 生产 bug 根因修复 + 限频/写放大治本 + 网关部署悬空收口**

五路并行代码审查（四路子代理分仓 + 网关本地深审）+ 部署目标实机盘点（pm2/健康/日志/文件指纹/七仓 .env 键名比对），修复全部过桩测试后按 gateway→hub→ticket→duty→approval→wecom 顺序部署。

- **P1 · approval-bot v42**：催发票回复轮询 230001 根因——`start_time` 毫秒误用（接口收秒级）+ `end_time` 缺失，凡私聊催过的用户回复轮询必失败、「延期/无法提交」永不识别（上线以来即病，v40 修的是同模块别处、桩未覆盖该路径故漏网）；另补会话消息/通讯录部门翻页。桩新增 230001 回归锁。
- **P1 · hub v101**：关键词监听图片转存仍用旧 `im/v1/images` 接口（用户图一律 234001，生产 error 刷屏、发言表图片静默丢），换消息资源接口（duty v28 同款）；快递观察转发富文本图文分离（v97 透传实为无操作，图全丢）改先文后图借 duty 配对逻辑补挂；DDL 卡 week 桶修复（此前 `daysLeft<=7` 全进 urgent，「7日内」栏恒空、降级链路错标加急）；approval/print/webhook 三处转发补 15s 超时。
- **ticket-bot v77**：每分钟对账无条件重写目标行的写放大加 diff 门控（`unchanged` 跳写，治理共享应用配额压力——duty 1254290 与查父项目超时同源）；缺行修补扩展「缺 parentId」双条件；过滤公式值转义（项目名含引号致永久缺挂）。
- **duty-bot v33**：快递表读取 1254290 短退避重试（读幂等，写路径维持不重试）；cron 状态计数失真修复（快递任务加入后 7 任务判 ===6，`running` 恒 false）。
- **wecom v8**（09-21 首播前收尾）：feishu.js fetch 补 15s 超时（防占死 guardedRun 锁）；发送失败告警文案修正（首启无水位不自动补发，补手动 test-broadcast 提示）。
- **gateway v28**：字段结构变更事件（`bitable_field_changed_v1`）补注册+静默忽略（SDK warn 曾淹没 error 日志）；**v82 批 gateway 改动未部署的悬空收口**（内容级 diff 核实仅注释/测试脚本差异，运行时行为一致）；DEVLOG 指针 v25→v27 漂移修正。
- **实机盘点结论**：七进程全绿、网关 ws running、投递 2506/0 失败；ticket v76/bambu v31/wecom v7 部署与本地逐字节一致（bambu 仅 package-lock、wecom 仅 DEVLOG 差异）；七仓本地 vs 目标 .env 键名集合全对齐。
- **运维发现（记桌面意图文档）**：桌面《qianli-设计意图待定项.md》与《机器人总成使用指南.html》双双丢失（桌面/回收站均无，不可本地恢复）——意图文档本批重建，HTML 待用户定性后重建；bambu `APPROVAL_CODE` 未配（审批对账②腿窗口兜底不生效，需用户从审批后台取定义 code）；运维笔记本双网卡同网段+SSH 源 IP 显示主路由（hairpin NAT）现象记入 qianli-lab-network skill §十；4A OpenWrt 入网后需补运维台 NET_TARGETS。
- 测试：duty 六套 / hub 三套 / ticket 24+18+16 / wecom 七套 / approval（含新回归锁）/ bambu 四套全绿。遗留：`.agents/skills/qianli-lab-network/SKILL.md` 上会话 4A 拓扑改动随本批入库并补 §十（双网卡/SSH 源 IP/部署目录路径核实）。
- 部署顺序：gateway → hub → ticket → duty → approval → wecom → 顶层。

## v85 · 2026-09-20 · 随本提交落地 · docs

**网关批：裁判系统路由器入网（第三网段）+ 根目录《网关拓扑文档.md》新建 + skill §十一**。记账修正：上一批锚点提交（6661aa6，"顶层锚点 v84"）未建 DEVLOG 条目且头部指针滞留 v83，本批一并修正——v84 内容已并入 v83 条目尾部 bullet，不再补拆条目。

- **裁判系统路由器（第三网段 192.168.3.1/24）入网**：wan=DHCP 实测 `192.168.31.80`（MAC `CC:C4:B2:46:16:2F`，在线稳定）；WiFi `裁判系统` 已启用（密码用户设，不入库）。定位=机甲大师物理机器人 + 裁判端电脑专用——**术语澄清**：与六仓飞书软件机器人无任何关联，文档已立术语区分。
- **小电脑跨区防火墙**：SSH（IS-ADMIN 实证）加 `Referee-Zone-192.168.3.0-24` 入站全协议放行 → **物理机器人→小电脑后端链路全通**；反向（小电脑→物理机器人）🟡 待裁判系统官方软件发布后在裁判路由器加端口转发（主网关 miwifi 无静态路由功能，3.x 无回程路由）。
- **4A 打印隔离区收尾定稿**：三条防火墙规则由设计稿 192.168.1.x 编址改指现实网段（Mgmt/主网→打印区/打印区→小电脑回推，回推目标=192.168.31.57）；`Printer` 2.4G WiFi 启用（ap_isolate=1）；与 v84 批已入库的保活脚本铲除、错位租约/旧 DNAT 清理合并为完整改造记录。
- **文档**：新建根目录《网关拓扑文档.md》（术语约定/三网段总表/总览图/设备与防火墙台账/通信矩阵/运维台账，密码零入库）；skill 追加 §十一 裁判路由器节。
- **运维台账**：主网设备全量清单改用主网关 miwifi API `misystem/devicelist`（运维台 `/api/network/lan` 代理读取漂移实测 total 0/3/9/12/21 不定）；路由器静态地址固化走客户端侧（wan 改静态 IP），miwifi 静态租约无公开 API 端点；笔记本拓展坞静态 IP 迁 3.2 需 UAC（两次弹窗未成，转用户手动或待办）；4A `/root/test.clc` 遗留文件待用户定性。
- 待办（承接）：4A wan 插线验证 + 运维台 `NET_TARGETS` 补录（4A/裁判路由器条目）；打印机入区五连；裁判系统端口转发（待发布）；bambu `PRINTER_HOSTS` 填 2.x 地址。
- **运维台拓扑看板**：`NET_TARGETS` 新增裁判系统路由器条目——其 wan 侧 TCP 管理口被自身防火墙挡（设计如此），TCP 探测恒红会误报断网，故新增 `icmpProbe`（spawn ping）探活类型并前端加树位（ICMP 实测 2/2 通）；4A 条目待其 wan 入网配静态地址后补。
- **拓扑追记（同批）**：NAS 挪入交换机后 DHCP 由 .151 重分配为 **.153**（2222/3923 双开实测），运维台 `NET_TARGETS` oldnas 目标已同步；总览图补 5 口千兆交换机层（有线汇聚，大流量本地交换不过主网关）与主网关全 2.5G 口规格（BE6500 Pro：4×2.5G，LAN1=笔记本拓展坞 2.5G、LAN2=交换机上行）。

## v86 · 2026-09-20 · 随本提交落地 · docs

**拓扑勘误**：总览图 LAN1 的"运维笔记本拓展坞 31.2"条目删除——该线为 4A 配置时代遗留未拔，并非专用运维通道（用户澄清）；笔记本日常走 WiFi（31.182），LAN1 转预留，需网线直连 2.x/3.x 时临时改拓展坞 IP 即可。skill §十 双网卡现象随之自然消解（收敛后复测待办保留）。

## v87 · 2026-09-20 · 随本提交落地 · docs

**勘误批：裁判系统路由器归属纠正 + 运维台误报条目撤除**。用户复核"你确定裁判系统在线？？？"触发三路实证（探测/ARP/SSID 空中扫描）：用户已拔线，但 31.80 仍被 MAC `cc:c4:b2:46:16:2f` 应答（ping 延迟 171ms 反常、SSID 已消失）——证实该设备**不是**裁判路由器，v85 的归属属误判（当时仅凭"新出现 MAC+插线时间吻合"归因，违反本 skill §三"MAC 前缀级证据"原则的教训入档）。

- **运维台**：撤除 referee 探测条目与前端树位（`icmpProbe` 能力保留，4A 部署时可复用）；`/api/network` 复核 referee 不在列。
- **skill §十一 重写**：裁判路由器=已配置（LAN 3.x + WiFi）待部署；误归属勘误入档；新路由器"先脱机改段再入网"教训保留。
- **《网关拓扑文档.md》**：裁判区改"已配置·待部署"，通信矩阵改"部署后即通"；新增 §四.1 待认领设备（31.80 / cc:c4:b2:46:16:2f）。
- 待认领：31.80 未知设备请用户按 MAC 定性。

## v88 · 2026-09-20 · 随本提交落地 · docs

**《网关拓扑文档.md》补 §二.1 双子路由对照表**：主网关下将同时挂 4A 打印区（2.x）与裁判区（3.x）两台子路由，按网段/机型/服务对象/状态/出向策略/小电脑侧放行/管理入口/看板条目/入网铁律九维对照成表——本会话曾发生 4A↔主网关、未知设备↔裁判路由器两次归属混淆，表格即防混淆工程。

## v89 · 2026-09-21 · 随本提交落地 · fix

**运维台看门狗 SSH 探测加重试（链路抖动误报修正）**

- 事故背景：2026-09-21 中午校园网链路劣化窗口（网关 self-signed certificate 指纹、飞书 API 面性超时）致 hub 12:05 DDL 播报超时丢失（补播与 hub 侧重试修复见 project-management-robot v103）；当晚 18:38 看门狗单轮 SSH 握手超时（`Timed out while waiting for handshake`）把「部署目标(SSH)」误标 degraded——实际目标机健康、7 进程全在线，用户侧表现为"很多机器人状态死了"。
- 修复：`dashboard/server.js` `watchdogCheck` 的 SSH 巡检失败后隔 15s 重试一次，两连败才判整机失联（此后各端口 health 巡检与 2 连击告警逻辑不变）。
- 同批运维动作（不入库）：12:05 丢失的 DDL 播报已于 19:02 经 hub `/api/bot/test-broadcast` 补播（4 群卡 + 6 逾期确认私聊全送达）；wecom-attendance 09:30 播报失败为企微打卡明细未导入（人工流程，待用户补数）。

## v90 · 2026-09-21 · 随本提交落地 · docs

**《机器人总成使用指南.md》同步 DDL 逾期确认编号定向回复口径**

- 随 project-management-robot v104（45a75db）的成员可感知改动同批：确认私信带确认编号、多项目回复「编号+是/否」定向确认（如 `2 是`）、裸回「是/否」多项目时引导定向、单项目不变。
- 勘误记录：桌面版《机器人总成使用指南.html》本次维护时发现不存在（AGENTS 约定的 `C:\Users\0d00\Desktop\机器人总成使用指南.html` 缺失），待用户定性后补建/恢复；本轮用户侧口径先行落 MD 维护者手册。

## v91 · 2026-09-21 · `67f7dc3` 后续批次 · docs

**使用指南 MD 同步 v105 远程状态口径 + 桌面 HTML 重建 + v105 部署挂起记录**

- MD：hub 节新增「远程状态查看」（/status 舰队健康快照，随 pm-robot v105 / `8b743af`，**部署挂起**——提交已推 GitHub，但用户已携笔记本离站（当前 CQU_WiFi，31.x 不可达），回实验室后任意一次 `npm run push` 自动补部署，push.js 空提交跳过逻辑已核对）；手册头部补 HTML 重建记录。
- 桌面版《机器人总成使用指南.html》已按本手册成员向内容重建（工作区外，不入 git）——v90 的「HTML 缺失待定性」就此销项。
- 运维插曲：19:5x 起笔记本离开 31.x，运维台/watchdog 依设计进入「离站」状态不告警；小电脑最后一次全量检查（19:47）7 进程全在线。

## v92 · 2026-09-22 · `41b2ec8` · docs

**hub v106 负责人群整合播报上线（含挂起的 v105 补部署）+ 使用指南双端同步**

- 主改动随 project-management-robot v106（`211ce96`）：DDL 每日播报在各群常规卡之后，把「逾期 + 临期 2 天内」跨播报群汇总（各人员字段并集，filter=all）再发负责人群，卡头 @章子赫（open_id 经通讯录接口核验姓名/在职，另真发测试卡 code 0 验证卡片 @ 语法）；只含逾期/临期两栏，全空当日不发；与各群同轮重试去重，目标与播报群重复自动跳过；policy 窗口与 /status 同步暴露。v105（8b743af）的部署挂起就此销项——本次部署目标 git 同步 45a75db→211ce96 一次带上。
- 部署后验证：health 200、pm2 knowledge-tracker online、cron 下次执行 2026-09-23 12:05、/api/hub/policy 线上 leaderGroup 配置正确（webhook 只出 hasWebhook 布尔不泄漏原文）。
- 同批文档：`机器人总成使用指南.md` hub 节定时任务补负责人群整合播报口径；桌面版《机器人总成使用指南.html》DDL 卡片同步（成员向一句话，工作区外不入 git）；`dashboard/registry.js` hub 条目 role/notes 更新 + 负责人群 stub 测试快捷按钮。
- hub push.js 测试闸门补齐全量六套桩（v104/v105 两套此前漏挂，一并入闸）；新增 stub-test-ddl-leader 30 断言全过。

## v93 · 2026-09-22 · 随本提交落地 · feat

**队员活跃口径修正（用户拍板：抽奖/关键词等娱乐功能不计活跃）——gateway v29（`d990b1e`）+ hub v107（`5b80e39`）+ 运维台/规则同批**

- 需求：运维台「队员活跃」此前把抽奖、关键词回答等娱乐命中也算活跃，纯娱乐玩家撑高活跃数；改为只算正经使用，并成文为长期规则。
- gateway v29（已部署，health 200 / ws running）：`/api/usage` 双口径——`activeUsers`=机器人交互全量（网关日活跃表同口径，不变），新增 `seriousActiveUsers`/`seriousUsers`=正经使用（运维台消费）；日桶按人功能归因 `users[id].f` 为剔除依据，旧数据（无 f）按全量正经处理不回溯剔除、自然老化；娱乐清单=静态（`usage.js` STATIC_FUN_FEATURES：抽奖/关键词回答//lottery）+ 上报自学习（`/api/usage/report` 新字段 `fun:1` 学功能名、`learn:[触发词]` 学 `/触发词` 形态——堵住抽奖动态触发词被路由层记成正经 `/指令` 的漏洞；清单随 stats 持久化）；新增 `stub-test-usage-serious` 并入 push 测试闸门；README 使用统计节同步。
- hub v107（已部署，health 200）：上报四处调用点带标——抽奖两处（chatService 值日群/普通群）`{fun:true, learn:keywords}`、关键词回答两处（chatService/autoReplyService）`{fun:true}`（DDL 确认正经不动）；stub-test-duty-branch 新增统计上报三断言，六套桩全过。
- 运维台（本地，不部署）：「队员活跃」看板与总览「近24h活跃」KPI 切 `seriousActiveUsers`（`??` 兜旧口径），成员榜用 `seriousUsers`，卡头标注口径；「功能使用分布」仍全量展示娱乐命中；`registry.js` dashboard 条目与 `dashboard/README.md` 同步。
- 规则成文：顶层 AGENTS 全局工程规则新增「队员活跃口径=正经使用（2026-09-22）」条（上报 fun/learn 约定 + 静态清单位置 + 旧数据兼容口径），「网关日活跃」条补双口径区分备注。
- 杂项：`.zcodeignore`（前会话遗留忽略清单：`.zcode/`、晚间静默积压文件、值日规划文档、历史密钥备份等不入库项）并入本批入库。

## v94 · 2026-09-22 · `e1932d5` · docs

**验收批：裁判路由器确认入网（wan=192.168.31.84）+ 4A 缺席记录**。（编号/日期勘误：本条原误标 v89·09-20——v89 已被 09-21 条目占用且实际提交日为 09-22，现更正为 v94 并锚定 `e1932d5`；同批 v85~v88 条目的"09-20"日期均为误标，实际提交亦为 09-22，历史条目按不改写原则保留原样仅此备注。本批 e1932d5 还顺带携入并行会话的 `dashboard/keepalive.vbs` 与 README 增补——其 v93 批提交后的新增文件，被本批 `git add -A` 顺带入库，特此记明。）交换机重排后验收：外网 200 / NAS .153 通 / 裁判 SSID 复播——`裁判系统` SSID 回归空中证明 `.84`（EC:C1:AB:E4:B6:56）即裁判路由器 wan，v87 的勘误维持有效（.80 的 cc:c4:b2 为另一台未知设备）。4A（d4:da:21 前缀零命中 + 新设备管理口无开启）仍未入网，待用户核对其 wan 线位（蓝 WAN 口）。文档：拓扑文档总览图/网段表/对照表/§四 与 skill §十一 同步"已入网"状态；裁判区静态绑定（EC:C1:AB:E4:B6:56→31.84）待主网关 UI 执行。

## v95 · 2026-09-22 · 6e480c7 · docs

**4A 打印隔离区正式入网 + 运维台收录**。wan 插交换机（初插误 LAN 口，纠正后）DHCP 拿到 `192.168.31.98`，随即客户端侧固化为静态（proto=static + 网关/DNS 192.168.31.1、223.5.5.5）；实测 wan up、到小电脑/外网/主网关 0% 丢包、管理口 22/80/443 对 31.x 全开（Allow-Mgmt-MainLAN 规则首次实战生效）。运维台 `NET_TARGETS` 加 `print4a` 条目（31.98，22/80/443 TCP 探测）+ 前端树位，看板七节点全绿；《网关拓扑文档.md》与 skill §九 同步"已入网"。**剩余**：打印机入区五连（局域网模式+静态租约+PRINTER_HOSTS+分发实测）；`/root/test.clc` 待定性；31.80 未知设备待认领。
- **v95 追记（4A 遗留物定性）**：`/root/test.clc`（255KB）经 `.bash_history` 还原定性=Clutch 云游戏数据残留（前用户装过 `.clutch-server/`+`snake.sh` 贪吃蛇并反复 rm 未净），用户批准后已删，原件归档 `qianli-backups/4a-test-clc-archive-20260922.bin`；NAS 地址漂移评估为不严重（当前无业务依赖 .153，将来配 rsync 冷备时须先固化）暂不修；31.80（Trolink 白牌设备）用户不认识，留观+拔设备法待查。

## v96 · 2026-09-22 · 9b9c73a · feat

**运维台拓扑看板新增「子路由 · 隔离区」独立分区**。原拓扑树为"云→主路由→终端"两段式硬编码：4A 被混排在终端行（层级不符），裁判路由器未部署无渲染位。本批重构为三段式——云端 / 主网关 / 主网终端（笔记本·小电脑·NAS+未识别设备）/**子路由·隔离区**（4A 打印区实时探测卡 + 裁判系统路由器"未部署"静态卡，灰点状态新增 up=null 支持）；《网关拓扑文档.md》§四 同步注明看板静态卡。

## v97 · 2026-09-23 · 随本提交落地 · docs

**归档 ticket-bot v79 搬运可靠性批 + lab-network skill 增补排查经验**。ticket-bot v79（嵌套仓 108e025，已部署）：李妍基建支持工单「长期未接单→一接单搬运就坏」事故链根治——parentId diff 门控归一化修复（v77 门控被关联字段读回形态击穿 → 每分钟重写看板行烧共享配额 → 1254607/查父项目超时风暴）、查父项目降频（仅建行/缺 parentId/父项目改名时查）、建行 key 落库校验自愈、无 key 孤儿行收养（严格匹配防认错行）；部署后实测每分钟重写已变 unchanged。skill 增补：排查手册新增第 0 步「先查本机连的哪个网」（曼波网关开发常连成自己的校园网账号直连认证，顶掉主路由会话 → ping 不进 31.57，先 `ipconfig` 再折腾）；并入 09-22 遗留的小电脑 IP 静态固化条目。

## v98 · 2026-09-24 · 随本提交落地 · docs

**归档全仓深度复查修复批（六仓联动）+ superqianli 网络事件记录 + 遗留文档批入库**

- **复查批**（09-24 五路并行全仓复查：代码/接口/意图/逻辑 + 鉴权/闸门/守卫三铁律核查，全部桩测试回归后才部署）：duty-bot v35（3ab00b6，快递图片窗口守卫+排班补偿义务逐日即时落账，新增 generate-place 桩入闸门）、ticket-bot v80（e6e66a4，auth 废除 ?token=，部署后以 POST query-token 403 探针实测）、pm-robot v108（429a5c1，事件端点 fail-closed + 普通群@关键词命中补 usage 上报）、approval-bot v43（432e8a0，fail-closed + 废 ?token=，探针实测 403）、bambu v33（SFTP，manualDispatch 审批源守卫+fail-closed+废 ?token=）；gateway v30（smoke-test 鉴权同步，仅工具链零运行时改动，不部署不重启）；运维台 dashboard/registry.js duty 测试链补齐全量 7 套。
- **网络事件**：09-24 凌晨 superqianli 主网（校园网会话）再被踢，按 lab-network skill §四 常态自愈无需人工；实测七节点全绿、网关 uptime 29h+ 未重启、出口 IP 222.178.10.186 已记录备白名单比对。
- **遗留文档批随本提交入库**（09-20/09-22 拍板与部署路径迁移的文档追平，前会话遗留）：qianli-deploy/qianli-lab-network 两个 SKILL.md、bambu PRINTER-LAN-API/README、dashboard/README、ticket-pm/LOGIC-MAP、wecom-attendance README、《动态广场看板搭建指南》《机器人总成使用指南》《网关拓扑文档》。
- 部署顺序：duty → ticket（一次 SFTP 同步未生效重推自愈）→ pm → approval → bambu(SFTP) → 顶层归档；部署后七进程 online、各 health 200、gateway 长连接未动。

## v99 · 2026-09-24 · 随本提交落地 · docs

**归档 ticket-bot v81（移除工单每日汇总播报）的 LOGIC-MAP 同步**

- ticket-bot v81（9817e8b，独立仓）按用户拍板移除从未启用的工单每日汇总播报：cron 任务链（含 RETRY_CONFIG/isFrequencyLimitError/sleep 辅助）、buildDailySummaryCard、/api/bot/test-summary 端点、/api/bot/history summary 字段、CRON_SCHEDULE 配置键全链清理；保留了 broadcastHistory、ticketService 数据接口与 quietHours gateTask 机制本体。三套桩 71 断言 + 模块加载冒烟后部署，线上实测 cron-status 无 summary 字段、test-summary 404、health 200。
- 本批为 ticket-pm/LOGIC-MAP.md 四处同步随顶层归档（webhook 通道说明改多人单结束通告、定时任务表删行、运维 API 清单去 test-summary、静默闸对照表改写）。使用指南 MD/HTML 从未记载该功能，成员无感知，不需同步。

## v100 · 2026-09-24 · 随本提交落地 · feat

**运维台新增「团队负载」看板（三仓联动：ticket v82 + pm v109 + dashboard）**

- 用户需求（曼波）：负载同时算工单系统未结单 + 项目看板进行中项目，评分结合 DDL 距发起时间的时效/重要性/组别/项目状态做复核算法，**产出仅到本地运维台**（不做群播报——静默闸门天然不涉及，运维台本机轮询非机器人播报）。
- **链路**：ticket-bot `GET /api/tickets/workload-by-person`（按人未结单明细，负载视角不做播报路由过滤，v82）→ pm-robot `GET /api/hub/workload`（workloadService 双源评分聚合，ticket-bot 失败降级仅项目侧，v109）→ dashboard `GET /api/team-load`（SSH 通道 curl 部署目标 hub 端点，300s 缓存）→ 前端「⚖️ 团队负载」卡片（Top10 分值条形 🔴≥8/🟠≥4/🟢 分档、点名字展开项目/工单明细、组别切面、待接单榜、工单侧离线黄标；5 分钟轮询）。
- **评分算法**（口径在 pm-robot workloadService，权重随 API weights 透出）：状态折减 × DDL 时效（消耗比分档、逾期递增封顶 2.7）× 重要性（项目 priority/工单分桶代理）× 角色（owner 1.3），多人单按负责人摊薄，unclaimed 归组不计人。
- registry.js 三处登记（hub/ticket windows + dashboard commands 与 role）；各仓 README/DEVLOG 同批；测试 ticket 4 套 + pm 7 套桩全过（pm 闸门收录 workload）。《机器人总成使用指南.html》不动——运维台为维护者工具，成员无感知。
- 部署顺序：ticket-bot → pm-robot（消费方在后，照 ticket-pm 联动契约）→ dashboard 本地重启。

## v101 · 2026-09-24 · `97bd02b` · feat

**负载算法升级批（用户拍板三项）：宣运×0.5 / 重装·步兵·哨兵×1.2 / 被@每 0.01 分——四仓联动（gateway v31 + ticket v82 补丁 + pm v110 + dashboard）**

- **组别系数**（pm workloadService GROUP_COEFF）：按任务归属组别乘——项目 category、工单单级面向组别（ticket-bot workload-by-person 同批补 groups 出参，不动 unclosed-by-group 契约）；宣经/宣运/宣运组 ×0.5，重装/步兵/哨兵 ×1.2（兵种分组只在项目 category，工单面向组别是职能组枚举）。
- **被@接量（新数据源）**：网关 routeMessage 入口对全群消息 mentions 按人按天累计（@机器人/@所有人/私聊不计，任何路由判断之前、不命中规则也计），`GET /api/usage/mentions?days=7` **自然日滑窗**聚合（不沿用 usage 桶数滑窗——负载输入不能带稀疏老计数）；pm 侧第三源（5s 超时降级 `mentionsSource` 标注），每被@一次 +0.01 分，零任务纯被@的协调型角色也入榜。
- dashboard 负载卡：KPI 加「近7天被@」、行内 `@N` 标注、明细加被@行、被@侧离线黄标；registry 三处同步（gateway listening/hub windows 描述）。
- 测试：gateway 三套（新增 mentions stub）、ticket 4 套 19 断言（补 groups 断言）、pm 七套（workload 扩到 41 断言）全过；pm push 闸门收录。
- 部署顺序：gateway → ticket-bot → pm-robot → dashboard 本地重启。被@计数自部署起累积，7 天窗口渐进趋真。

## v102 · 2026-09-24 · `7aae41e` · feat

**值日公平性修复批：duty v36 + pm v111 两仓联动——加罚只计未做完 / 补位按近期密度 / 请假两步确认 / D-7 值日预告**

- **背景**：排查某队员被排 7 次（全员第一）确认为规则叠加雪球而非错账：一次请假触发「连续两次缺勤加罚」翻倍补偿，加罚插入的多班次又使其成为补位抽调「远期班次最远」首选，再被抽调 +1。
- **duty-bot v36**：①handleAbsence 加罚只计「未做完」（请假不计数）；②arrangeReplacement 补位第二键改「近 14 天已值次数最少」（弃「远期班次最远」假余量）；③请假两步确认（`我要请假`→`确认请假`/`取消请假`，pendingLeaves 10 分钟过期，policy p2pCommands +4 词形）；④新增 D-7 值日预告（每日 20:05 私信一周后值日队员，duty_week_remind 过静默闸门 + test-week-remind 手动端点）。
- **pm-robot v111**：dutyPolicyService fallback 词形同步 4 词（失联兜底期间新词形可放行）。
- 测试：duty 7 套（flow 重构两步请假+新增加罚/补位密度/D-7 断言、policy 清单 32→36）+ pm duty-branch 全过。
- 文档：duty README、registry（duty commands/定时描述）、用户侧《机器人总成使用指南.html》（播报节奏/请假两步/时刻总表）与维护者 MD 同批。
- 部署顺序：duty-bot → pm-robot（词形消费方在后，照 ticket-pm 联动契约）。

## v103 · 2026-09-24 · 随本提交落地 · feat

**approval-bot v44 发票图像 OCR 转录（飞书免费 OCR）+ registry 登记 + gitlink 快照**

- **approval-bot v44**（`e3bc757`，已部署小电脑并验证）：发票图像 OCR 转录服务端能力——引擎选飞书开放平台「识别图片中的文字」（**免费**，20 QPS，图片 <5MB，识别在飞书侧完成、数据不经第三方，图片内存直传不落盘）；「某些区域转录」用可配置字段规则实现（anchor 锚点 same/next/same_or_next + occurrence / regex），内置发票默认规则集（号码/日期/买卖方/价税合计），`GET/POST /api/ocr/fields` 定制窗口热改（规则存 `.ocr-fields.local.json`，push.js 打包排除+gitignore 防本地种子覆盖部署目标）；`POST /api/ocr/transcribe`（X-API-Token）+ policy 增 ocr 段；桩测试 stub-test-ocr 并入 npm test 与 push 闸门（抓出并修复 take=same 误跨段回落 bug）。权限待开通：`im:resource` + `optical_char_recognition`（高级权限）；消息侧入口待需求方定接口形态后另批接入。
- dashboard/registry.js：approval-bot 条目同步（role/listening/windows ×2/permissions/notes）。
- 本批纯 approval-bot 单仓 + 顶层登记，无跨仓行为联动；用户侧《使用指南》待消息入口定了随批补。

## v103 · 2026-09-25 · `19695bd` · feat

**值日体系全面检修：duty v37 单仓批——请假当日空缺/安置优先级/周插入容量/排班重排**

- 用户拍板①请假当日空缺（废补位抽调）；②检修同日超员存量（09-19~09-24 雪球：09-27/09-28 各 5 人）。
- duty-bot v37：①删 arrangeReplacement，请假当日该岗空缺由同日队员兼顾；②planInsertion 安置优先级重构——目标周内「请假空缺位」优先（同岗回填不超员），无请假位才落密度最低日；③周级插入容量 DUTY_WEEKLY_INSERTION_ALLOWANCE=2（非请假位插入每周限 K 条超出顺延，填请假位不占），placePending/generate 同受约束，根除欠账集中安置雪球；④POST /api/bot/rebalance 重排端点（自动全量备份+dryRun 预览+confirm 执行）。
- 重排已执行：删 72 条未来未完成班次、重置 14 条义务、重新生成 09-26~10-25 共 94 条——10 月起每天严格 3 人，09-26~09-30 过渡期残余 4 人日为欠账按容量消化的预期代价；旧规则「请假加罚」义务一并作废。
- 测试 duty 7 套全过（flow 新增请假空缺位/周容量/rebalance 三组断言）；文档 README/registry/用户侧 HTML/MD 同批。

## v104 · 2026-09-25 · `cef9b2f` · feat

**approval-bot v45 发票采集全链路 + 报销批次三件套（hub 同批联动）+ registry 登记 + gitlink 快照**

- **approval-bot v45**（`8f312d8`，已部署小电脑并验证）：发票采集对接重庆大学财务/小翼Plus 流程——队员私聊/催办私聊直接回发票（数电票 PDF/二维码截图/拍照），三通道识别（PDF 文本层 > 发票二维码 > OCR 兜底，非发票图特征词静默忽略）→ 查重双闸（号码精确+三元组近似）→ 抬头校验（INVOICE_ALLOWED_BUYERS 可配）→ 金额归类匹配（精确唯一自动归/唯一候选直归+金额比对闸 ±5%/¥10/多候选转人工；候选排除台账已收录——「发票/补交发票/采集台账」三口径等价）→「发票采集」表（真源）+补交发票栏镜像回写→私聊回执/打回提醒。
- **财务三件套 /approval-batch**：preview 拟批（票池按项目分组）→ lock 锁定（回写采集表批次+审批表「报销单」栏，锁定后顺序不可变）→ 自动生成打印件 PDF（录入序、A4 竖版一页两票，pdf-lib）+ BOM xlsx（exceljs）落「报销批次」表附件 → submit/paid/reject 状态流转。周报卡新增「报销台账」段。
- **存量回溯**：POST /api/invoice/backfill——审批实例附件探测式下载识别回填（路径待真机联调验证）。
- **hub 同批**（pm-robot `4739bd7`，已部署）：p2p 图片/文件 fire-and-forget 转发 approval-bot 采集端点，值日线不受影响。
- **依赖**（免费 npm）：sharp/jsqr/pdf-parse/pdf-lib/exceljs。**权限待后台开通**：approval:approval:readonly、drive:drive（v44 批的 im:resource、optical_char_recognition 一并）。
- 测试：approval-bot npm test（×7 语法+3 套桩）全绿、pm-robot 7 套桩全绿；部署顺序 approval-bot → pm-robot。

## v105 · 2026-09-25 · 随本提交落地 · fix

**approval-bot v46 全量复查修复批 + OCR 兼容性演练（独立审查+演练双保险）**

- **独立代码复查**：P1×6 全修——近似查重闸因日期毫秒/字符串口径不一致恒失效（改毫秒比对）；PDF 识别失败被静默丢票（改打回）；`looksLikeInvoice: like || true` 恒真致任意二维码图误打回（parseQrPayload 加 invoiceShape 形状判定）；镜像回写裸 requestAPI 读失败清空「补交发票」列（改带 code 校验的 getRecord）；lockBatch 半途失败死局（先建批次记录再打标+regen 自愈子指令）；查重/落表与 lock 的 TOCTOU（按发票号/批次号互斥锁）。P2 系列：hub 转发超时 60s、双入口重复回执静默、金额差字段两入口统一、日期解析钳制、reject 退回票回池、body limit 10mb、/api/invoice/collect 移除 OCR 开关一刀切、端点失败补队员回执。
- **OCR 兼容性演练**（drill-ocr-compat.js，12/12 过）：真发票 QR 全链路解码（数电票/老票）、非发票码不误判、OCR 噪声变体（全角/半角/混排/千分位）、特征词静默、两票一页打印件几何验证；**演练抓出 pdf-parse v2.4.5 API 断裂并修复**（v1 函数调用已废弃）。
- **在线真机演练**（drill-online.js）：端点/鉴权/负例全过；transcribe 真调 404 判定为「图片识别」权限未生效（路径经官方 OpenAPI 核实），待权限开通复测；backfill 实测表格 SourceID 非审批 OpenAPI instance_id（1390003），重构为 APPROVAL_CODE 驱动（审批管理后台获取，一次性配置）。
- **抬头校验落地**：INVOICE_ALLOWED_BUYERS=重庆大学|12100000400002697C。
- 提交：approval-bot `8f312d8`/`c1b0284`/`3c2f2bb`/`dd855f2`（v45/v46+演练脚本）；pm-robot `4739bd7`/`046174e`（hub 转发+超时修复）。均已部署小电脑并在线复测。

## v106 · 2026-09-25 · 随本提交落地 · fix+docs

**全项目群全量代码审查 + 文档对齐批（八项目、五处行为修复、七仓部署）**

- 提交说明：fix+docs: 全量审查批——hub 发票文件分支死代码修复等五处行为修复 + 八项目文档对齐 + duty 隐私历史抹除 + registry 同步
- **审查方式**：八个项目并发只读子代理全量审查（代码 vs 文档逐条比对），产出差异清单后分仓修复。
- **行为修复五处（均过桩测试）**：① hub v114（`4fb1388`）extractFileContent 双形状兼容——p2p 文件（数电票 PDF）发票采集自 v112 起死代码，改读事件帧 message.content + 采集 usage 上报（铁律⑧）+ 桩断言四条；② duty-bot v38（`7781ee1`）D-7 预告/请假确认两处「补位」残留文案改同日兼顾口径 + 对账报告区分容量顺延；③ approval-bot v48（`24617de`）/approval-batch status 排序比较器失效修复（状态机分组+金额降序）；④ ticket-bot v84（`eba5451`）getCronStatus 补报 syncRepairTask；⑤ wecom v9（`922ae36`）dataSource 默认值 api→import（env 缺失落生产档）。
- **隐私历史抹除**：duty-bot reb_*.json（含全员真实姓名的 rebalance 运维输出，v37 哈希回填提交误入库）amend 进原 docs 提交后 force push（b8c1d59→`ceeb77b`），远端历史不再含姓名；.gitignore 补 reb_*.json。
- **文档对齐（约 30 处）**：八仓 README/LOGIC-MAP/AGENTS/.env.example 漂移修正（gateway 鉴权三端点、approval regen+脚本清单、duty D-7/词形/API 表、bambu PRINTER-LAN-API 行号+fail-closed、wecom import 主口径、ticket 全局锁+workload 契约、hub README/LOGIC-MAP 发票链路+v105/106/109 特性）；dashboard/registry.js 补登 hub 发票转发/duty rebalance+周容量键/approval v46/v47/dashboard 网络拓扑+看门狗；顶层 AGENTS 定制窗口五仓→六仓；网关拓扑文档 bambu 命名勘误+补 3010；《机器人总成使用指南》MD/HTML 同批（发票私聊直交入口等）。
- **hub v112/v113 补档**：4739bd7/046174e 两提交此前漏记 DEVLOG，已补条目。
- **部署验证**：七服务 pm2 全 online；gateway ws=running；:3000/:3002/:3003 health 200。各仓桩测试全绿（hub 7/duty 7/approval 3+语法/ticket 4/wecom 7）。
- 提交：duty `7781ee1`/`2d7768d`（回填）；hub `4fb1388`/`f161c72`；ticket `eba5451`/`6d54f8a`；approval `24617de`/`79e5886`；wecom `922ae36`；gateway `50f3029`；bambu v34 顶层归档随批。

## v107 · 2026-09-25 · 随本提交落地 · feat（联动摘要）

**报销交付包跨仓批：approval-bot v49 + hub v115 + registry 登记与表结构迁移**

- 财务交付包落地（照曼波给的实样文件夹《20260920-对抗赛-飞镖-第二十四笔-237.04》）：approval-bot v49 在锁定批次后自动生成**物料清单（校格式，严格复刻财务模板排版）**与**投递底单（学校投递单字段全预填，含大写金额/转卡收款人）**两份 xlsx，摘要/笔序自动拼装，paid 回执附归档文件夹名建议；审批群交付卡 + 裸词「接取」领取（hub v115 转发透传 senderName）。
- 生产 base 迁移已完成（create-collect-tables 补 10 列，本地直连飞书云执行）；`.env` 补 BATCH_*/CQ_* 实值（自实样投递单，敏感不进 git）。
- 部署状态：两仓代码随各自提交入库，**部署待笔记本回实验室网段后各自 `npm run push` 补上**。

## v108 · 2026-09-25 · 随本提交落地 · feat（联动摘要）

**approval-bot v50 报销台账电子表格同步归档（registry 登记 + approval gitlink）**

- 《2027年千里团队报销台账》（飞书 Sheets）由 approval-bot v50 在批次生命周期点自动维护：submit 追加行（摘要/金额/收款人/经办人自动填，投递单号可带参数）、paid/reject 按批次摘要精确回填状态；幂等与 not_found 保护不误改财务手填行；`/approval-batch ledger` 手动补同步。
- 本仓改动：registry approval 条目 notes + approval-bot gitlink。部署状态同 v107：待实验室网段恢复后 approval-bot `npm run push`。

## v109 · 2026-09-25 · 随本提交落地 · fix（联动摘要）

**财务机器人全量安全审查修复批归档：approval-bot v51 + hub v116 + 拓扑探测清单同步**

- 曼波要求的「涉及钱的全量对抗性审查」完成（审查报告+管理混乱清单见当日会话），P0/P1 已修复：approval-bot 仅回环监听（HIGH：堵死 LAN 未鉴权调资金指令的整条攻击链）、资金指令操作人 open_id 反查通讯录实名并落批次表留痕（MEDIUM：防接取/经办人冒名）、台账读改写互斥锁（MEDIUM：并发追加丢行竞态）；hub /approval-* 全量透传身份。
- 本仓改动：registry approval notes、NET_TARGETS 摘除 3002（回环后 LAN 探测恒 ✗ 属预期）、approval-bot gitlink。
- 遗留排期（管理清单，非代码漏洞）：共享 API_TOKEN 按仓拆分、群 webhook 签名校验、台账/批次每日对账（周报带 drift 段）、审批多维表格成员编辑权限盘点、`archive/project-configs` 旧密钥轮换。
- 部署状态：approval-bot/hub 均待实验室网段恢复后各自 `npm run push`。

## v110 · 2026-09-26 · 随本提交落地 · fix（联动摘要）

**七机器人项目全量审查批归档（代码审查/意图分析/结构评估/全量 debug）**

- 方法：7 个只读审查子代理并行（意图-实现对照+代码审查+全量测试+结构评估），主会话甄别后派修复代理落地、主会话独立复跑全部测试把关。修复前七仓测试已全绿——问题全部藏在「意图覆盖不到的组合路径」上。
- 战果：**P1×11**（approval regen 排序失效/笔序并发/markBatch 无状态机；bambu 打印机幽灵空闲/AMS 位图错位；duty 幂等键丢照片/补偿义务不回退/请假错班/静默冲刷连发 7 遍；wecom 周报超字节必败/水位回拨重复轰炸）+ **P2×约 40**（含安全收口×2：ticket-bot 事件帧 fail-closed + 回环监听对齐 approval v51），全部修复，各仓测试全绿、新增回归断言约 40 组。
- 各仓版本：approval v53 / gateway v33 / duty v40 / ticket v85 / hub v117 / wecom v10 / bambu v35（明细见各仓 DEVLOG）。
- 本仓改动：gateway+wecom+bambu 三项目代码（顶层跟踪）、dashboard/registry.js（wecom 出站口径 import 为主）、dashboard/server.js NET_TARGETS（3002/3003 回环化后摘出 LAN 探测）、各项目 DEVLOG。
- 结构优化：低风险项已随批落地（fetchWithTimeout 工具、映射收敛、闸门自动发现等）；中高风险项（chatService 拆分、dispatcher 拆分、排班 rebalance 同日冲突、usage.js 拆分等）记录在各仓 DEVLOG，另批处理。
- 部署状态：七仓全部待实验室网段恢复后各自 npm run push（approval v49-v53、hub v115-v117 两笔大队列一并上线）。

## v111 · 2026-09-26 · 随本提交落地 · fix（联动摘要）

**团队负载宣运域系数再调批归档（pm-robot v119 + ticket-bot v86）**

- pm-robot v119（`f707379`）：`GROUP_COEFF` 宣运域三键（项目 category「宣经」/「宣运」、工单面向组别「宣运组」）0.5 → 0.25——2026-09-24 拍板 ×0.5 后曼波再拍收紧；重装/步兵/哨兵 ×1.2 不变；`weights.groupCoeff` 引用透出自动跟随。stub-test-workload 期望重算（B3 0.1/D2 0.26/D4 0.2）41/41，九套全绿。
- ticket-bot v86（`4bb8baf`）：`unclosedService` 消费侧注释系数示例同步 ×0.25（纯 docs，无行为变化）。
- 本仓改动：`dashboard/registry.js` 与 `dashboard/public/index.html`「团队负载」看板口径说明同步 ×0.25、两项目归档（pm-robot gitlink 前移至 v119，ticket-bot 文件跟踪同步）。
- 部署状态：部署目标实测可达，pm-robot 本批 `npm run push` 连同其 v115-v118 待部署批一并上线；ticket-bot v86 纯注释随下次部署；其余五仓（approval/gateway/duty/wecom/bambu）仍待部署（bambu 缺 APPROVAL_CODE）。

## v112 · 2026-09-26 · 随本提交落地 · chore（部署批归档）

**五仓部署批归档（曼波口令 PUSH）——网关/审批/值日/工单/考勤全部上线**

- 部署顺序：gateway → approval → duty → ticket → wecom（先网关后业务机器人）。各仓 DEVLOG 占位哈希随批回填：gateway v32/v33（`50f3029`/`66dc3a3`）、approval v50-v53（`d0331bd`/`3507af0`/`a1fe3ba`/`1379f0c`）、duty v39/v40（`60654f0`/`33ab617`）、ticket v86（`4bb8baf`）、wecom v9/v10（`922ae36`/`66dc3a3`）。
- **duty-bot v41 计划外修复**：v40 的私有配置守卫只认字符串 `'ENOENT'`，而 ssh2 原生 SFTP 对远端缺文件抛数字码 2（SSH_FX_NO_SUCH_FILE）——`config/policy-override.json` 两端均不存在的正常场景被误判「无法确认现网内容」中止部署，首次部署两次卡死且无提示面。补数字码放行后部署走通（members/whitelist 守卫路径正常备份比对）。
- 部署体检：七进程 pm2 全 online；网关长连接唯一启动（ws:running，hub/approval/bambu/ticket 四消费者在册，投递 ok 无失败）；approval/ticket/knowledge-tracker「不使用长连接」日志确认；功能抽查 ticket `unclosed-by-group` 200 带真实数据、hub workload 透出宣运 0.25（v111 批实测）。wecom health ok（首启水位空=首启保护，不补发历史周）。
- 本仓改动：三 gitlink 前移（approval `90cd50d`、duty `f90e56a`、pm-robot `c67d1de`——含 v119 部署时 push.js 抽奖同步尾巴提交）+ ticket-bot DEVLOG 文件同步。
- **bambu v35 仍卡 APPROVAL_CODE**（待曼波从飞书审批后台取 code），本批未动。

## v113 · 2026-09-27 · 随本提交落地 · fix（联动摘要）

**第二轮全量对抗审查批归档（代码/接口/设计意图/逻辑 + 攻击性假设，曼波点名；拿不准项已同步桌面《qianli-审查存疑与待裁定清单-20260927.md》）**

- 方法：7 个按攻击面切的审查代理（approval 资金路径深审 / hub 播报对话链 / duty+wecom / gateway+dashboard+密钥链 / ticket / bambu / 资金链路跨服务横向），全部带对抗性假设逐条验证（多个假设以可复现实验证实）；主会话甄别后派 5 个修复代理落地，主会话独立复跑全部测试（approval 5/duty 7/wecom 7/hub 9/ticket 5/bambu 4/gateway 3+冒烟，全绿）。
- 战果：**P0×1**（顶层 git 历史泄露值=当前活跃密钥且轮换从未执行——已出轮换清单置顶桌面文档，待曼波执行）；**P1×15**（bambu manualDispatch 审批绕过驱动真机、approval 票池并发双批/markBatch TOCTOU/reject 卡票/收款方不进底单/regen 金额漂移、hub 播报卡注入、ticket 表编辑代通过审批、duty 绑定劫持/生成双写、wecom push 守卫漏同步、duty test:flow 日期敏感误报卡闸门）；P2 约 30（含 hub/ticket/duty 三仓回环化收口、hub 官方卡注入消毒、ticket 对账代通过痕迹 gating、静默冲刷竞态两仓同修）；新增回归断言 60+ 组。
- 本仓改动：gateway v34 / wecom v11 / bambu v36 代码与 DEVLOG、dashboard POST 防跨站中间件+前端补头、顶层 .gitignore 全局 .env 规则、七仓 push.js tar/闸门补洞。
- 各仓版本：approval v54 / gateway v34 / duty v42 / ticket v87 / hub v120 / wecom v11 / bambu v36。
- 部署状态：待实验室网段恢复后各仓 npm run push；ticket 上线前先跑 ensure-ticket-fields.js；密钥轮换（桌面文档第一节）优先级最高。

## v114 · 2026-09-27 · 随本提交落地 · fix（联动摘要）

**扩展范围审查批归档（曼波扩围：qianli 全路径全机器人补完）**

- 补审前两轮未覆盖面：dashboard 全量（router-xiaomi/前端/registry/自启链）、sop/site-sop-planet 公开站（独立仓，ps1 部署链+CI+页面 JS）、tools（keep-awake + rm-battlescope 3720 行 Python）、hub widget/auto-deploy/sync 脚本、bambu 外围、gateway nas-e2e、顶层三 bat。
- 战果：**P1×1**（sop 公开站整仓发布——部署脚本/编辑版 html 公网可下载，两条 CI 改白名单 dist + OSS incremental:false 清历史对象 + dev-helper Origin 防跨站写，sop 独立仓已随批推送修复线上）；P2×4（dashboard push cwd 路径逃逸、旧 NAS IP 标注漂移、sop dev-helper CSRF、widget 写功能 403 变砖定性）；P3×20+ 记录桌面文档第七节。
- 本仓改动：dashboard（cwd 越界校验/LAN_KNOWN .153/mac 格式校验/watchdog 回调）、gateway nas-e2e-test 废弃横幅、tools .gitignore 补 .deps/。
- 各仓版本：hub v121（外围横幅+NaN 清理）、sop 独立仓安全批；dashboard/tools 由本仓跟踪。
- 关机：曼波指示审查完成后关机一次，已执行。

## v115 · 2026-09-27 · 随本提交落地 · feat（联动摘要）

**工单撤回联动 + netlog 网络日志探针开仓（曼波双需求批）**

- 需求①「工单被撤回时把接单提醒也撤回」：ticket-bot **v88**（独立仓 `502ad50`，已推 GitHub）——「申请状态」命中死亡终态（已撤回/已拒绝/已取消/已终止/已删除，`syncService.isDiedStatus` 与 died 映射同源）三路联动：事件路径即时撤回各群提醒卡（bot.deleteMessage，DELETE /im/v1/messages）+ 每分钟对账补偿撤（幂等，防长连接 1/N 漏事件）；播报守卫（终态单不补播，防「撤了提醒又冒新卡」）；队列剔除（不占「接单N」序号）。新增 stub-test-revoke.js 19 断言，六套全绿 125 断言；multi-accept 的 syncService 桩补 isDiedStatus。已知边界：registry 内存态只存每群×工单最近一张卡，被覆盖的首播卡/重启前的卡无法追撤。
- 需求②「给 superqianli 做网络日志」：**netlog v1 开仓**（本仓 `netlog/`，随本提交归档）——superqianli（主路由 31.1）+ 校园网出口连通性探针跑生产机（pm2 `qianli-netlog`，:3016，零 npm 依赖）；防抖记 lan/wan 断与恢复（带历时）；断网事件积压、wan 恢复瞬间飞书汇总补发（通知通道与被监控网络同生死，落盘+补报是唯一正确语义）；出口 IP 变化告警（白名单风险信号）；数据落盘部署目标 C:/qianli/data/netlog（项目外）；GET /api/health、/api/netlog/summary 只读端点。stub 14 断言全绿 + 本地真实冒烟（本机校园网直连场景 lan=false/wan=true 与现场画像一致）。
- 配套：dashboard/registry.js 登记 netlog 卡 + ticket-bot role 更新；lab-network skill §八补「断网排查先看 netlog」；用户侧《机器人总成使用指南》HTML+MD 同批同步（工单撤回行为，成员视角）。
- 本仓教训修复：顶层 .gitignore 补全局 `**/node_modules/`——netlog 新项目漏建本地 .gitignore，node_modules 曾混入 v1 首推（本提交移出跟踪）。
- 部署状态：两批 git 均已推 GitHub（笔记本当下在校园网直连 CQU_WiFi，192.168.31.57 SSH 不可达，SFTP 部署步待连回主路由内网后补跑——届时 ticket-bot 会把 v87+v88 一起带上，**上线前先跑 ensure-ticket-fields.js**；netlog 重跑 `npm run push` 即补部署，无改动会跳过 commit 直走部署）。git push 首次因 GitHub 不可达失败，Watt Toolkit 加速生效后补推成功。

## v116 · 2026-09-27 · 随本提交落地 · docs（网络探测归档批）

**校园网认证探测归档 + 断网重连需求挂账（曼波三项需求，按其指示等回内网后按网关插件规则再工作）**

- 曼波三项需求入账：①网关断网复活能力强化；②账号登录策略池扩充（31108753 首选项，共 5 账号）；③触发重连时延时探针、限速账号打「本月不再使用」标记。**曼波明确叫停本轮另写引擎**——回内网后以主路由/小电脑上的既有插件为底改造。
- 本轮探测战果（全部归档 lab-network skill §十二）：认证系统=Dr.COM（`Server: DrcomServer1.0`，login.cqu.edu.cn→10.10.8.162:80/443，eportal 客户端 a41.js，portal_api=/eportal/portal/ 端口待插件校准）；受限会话指纹（UDP 53 全拒/223.5.5.5:443 可用作 DoH 通道）；自适应基线慢速判定方案已拍板（3 次探针中位数>健康基线 3 倍即弃用换号）。
- 账号策略池落盘 `campus-accounts.local.json`（工作区根，凭据不进 git）；本批顺带把 `**/*.local.json` 加进全局 .gitignore（本地私有凭据命名惯例，防后续项目把账号/密钥类 local 文件带上车）。
- 半成品 node 版账号池代码按曼波指示删除，未提交。

## v117 · 2026-09-27 · 随本提交落地 · feat（联动摘要）

**断网复活三项设计落地：netlog v2 上线（曼波「网关实现途径」考古批）**

- **考古结论**（侦查链：miwifi API（曼波 stok 实查）→ 4A SSH → 桌面归档 → ping.sh 原文）：主路由 WAN=纯 DHCP，自愈=Dr.COM MAC 无感知认证；重连真身=4A 时代 ping.sh（两账号无脑发/不验证/失败 reboot），归档于桌面 `qianli-backups/4a-root-ping-archive-20260920.tar.gz`（=曼波所说「存两个现有账号的地方」）；协议实锤 `10.10.8.162:801/eportal/portal/`（801=API 端口），online_list 实测通过。
- **netlog v2**（随本提交归档，已部署生产机）：wanGuard 复活状态机（首选项 31108753 永远先试 → priority 轮换 → wan 真恢复裁决 → 用尽通知+30min 冷却）+ campusAuth eportal 协议层 + accountPool 策略池（7 账号；bannedThisMonth 当月弃用自然月自动失效）+ 自适应慢速判定（恢复后 20s 宽限、3 次探针中位数>基线×3 →「本月不再使用」+自动换号）+ `POST /api/netlog/revive` 手动触发（X-API-Token fail-closed）。stub 两套 32 断言全绿。
- **重要路径归档**（曼波指定记录）：lab-network skill §十二/§十二.1 全面更新 + ZCode 记忆区新增「实验室重要路径与校园网认证」条目（桌面归档/账号池/协议/通道速查）。
- 配套：registry.js netlog 卡升级 v2 能力与 revive 端点；netlog README/DEVLOG v2。
- 备注：曼波口述主路由管理密码 cquqianli 实测 not auth（冷却重试仍拒），miwifi 通道待其核实密码；本批全部查询经其浏览器 stok 完成。ticket-bot v88/ensure-ticket-fields 已在本批前上线。

## v118 · 2026-09-27 · 随本提交落地 · fix（联动摘要）

**netlog v2 实测反馈批：空池 bug 修复 + 慢速判定实测通过（曼波验收批）**

- **实测抓 bug**：手动触发 forceRevive 首击即 `revive_no_candidates`——push.js 全量覆盖 .env 把本地调试路径带上小电脑（无此文件→引擎静默读空池）。修：push.js 上传后强制校准目标侧 NETLOG_ACCOUNT_POOL=数据目录路径（netlog v3）。
- **全链路实测通过**（修复后二次触发）：首选项 31108753 先试 → 真实 login（authIp=主路由 WAN IP）→ 44s wan 判定 → 慢速判定运行（探针 17ms≤基线×3 通过不 ban）——三项设计（复活强化/首选项/慢速换号判定）全部实机工作。
- **实测新知**：eportal 对已在线 IP 拒二次认证（ret_code:2「已经在线」）——换号只在真断网（IP 无会话）时可行，账号密码正确性留待真断网实战；wanGuard 动作日志已带响应 msg（netlog v4），断网时每账号失败原因可诊断。
- 现网连接确认：20230104@10.253.32.177（主路由，14:29 起在线）——无感知认证持续工作。
- 文档：netlog DEVLOG v3/v4、lab-network skill §十二.1、ZCode 记忆区「实验室重要路径与校园网认证」同步。

## v119 · 2026-09-27 · 随本提交落地 · fix

**router-xiaomi.js 适配新固件 SHA256 登录算法（「密码错误」误判平反）**

- 曼波坚持密码 cquqianli 正确（多次 not auth 后仍未改口）→ 复查发现根因：RD08 新固件登录页内联代码用 **SHA256(nonce + SHA256(password+key))**，而 router-xiaomi.js 还是老固件的 SHA1 组合——算法代际问题，**密码从头到尾没错**，此前多次 not auth 全是算法不匹配。
- 修：login 按登录页内联代码自动识别算法代际（含 `SHA256(this.nonce` 字样=新固件走 SHA256，否则回落 SHA1 老固件）；nonce 的 deviceId 从登录页服务端渲染值提取（回落 mac/'test'）。
- 实测：cquqianli + 新算法 LOGIN OK，wan_info 查询正常（dhcp/10.253.32.177/331h 未断）。运维台拓扑看板的踢出/封禁（miwifi API）随之恢复可用。
- 教训入记忆区：第三方社区算法实现「not auth」未必是凭据问题，先抓登录页官方 JS 对比哈希代际再怀疑密码。

## v120 · 2026-09-28 · 随本提交落地 · fix（联动摘要）

**财务群刷屏事故根治（netlog v5）——本地残留进程定罪 + 事件分级 + 通知静音**

- 事故与定责：曼波报告财务群被 `[netlog] revive_no_candidates` 持续刷屏；全量数据对质证明生产机清白（0 断采样/0 ban/积压空），真凶=本地开发残留 netlog 进程（09-27 22:45 kill %1 未杀到，活一夜）跟着笔记本网络状态每分钟触发空池复活并以本地 .env 的财务群 webhook 轰炸。残留进程已处决。
- 根治：netlog v5 三连——事件分级（NOTIFY_IMMEDIATE 白名单外全部只落盘+积压，恢复汇总卡带上，平时零打扰）、空池 30 分钟冷却、本地与目标 webhook 全部置空静音（等曼波指定通知群）。
- 教训归档：bash 后台 kill %1 不可靠需 netstat 复核；本地 .env 共键 webhook 调试前置空；「一直在播报」先数据对质再定责。

## v122 · 2026-09-28 · 随本提交落地 · fix

**运维台定制中心加减白名单乱码根治——远端 mingw64 curl 按 GBK 转码命令行参数（实测定罪）**

- 根因（三路探针实测定罪）：`/api/nas/api` 代理把 POST body 以 `-d '中文'` 拼进 SSH 命令行，远端 git-bash PATH 默认 curl 是 Git 自带 mingw64 版（8.21.0），它把命令行参数按系统 ANSI 码页(GBK)转码后才发 HTTP——「张三」到 HTTP 层已是 GBK 字节 `d5c5c8fd`，duty-bot 收到无效 UTF-8，存进白名单的就是乱码。SSH 命令行/sshd/远端 bash 三环经 hex 探针排除（UTF-8 保真）；Windows 自带 system32 curl 无此问题。
- 修复：POST body 改走 base64+stdin 管道（`printf b64 | base64 -d | curl --data-binary @-`）——SSH 命令行全 ASCII 无码页可糊，远端解码后字节级原样进 HTTP body，修复后同构探针复验字节一致；同批修 `sshExec` 逐 chunk `toString()` 的多字节劈裂隐患（改攒 Buffer 一次性解码，中文响应窗口显示保真同步受益）。
- 影响：运维台所有经 `/api/nas/api` 的中文读写（白名单增删/名册/hub 关键词回答表/抽奖规则编辑）全部免疫码页转码；dashboard 仅本机工具，无部署动作，重启进程即生效（已重启，端到端实测通过）。
- 遗留：现网 duty 白名单存有一条历史乱码残骸（含 U+FFFD 替换符，原始人名不可恢复），按运行时数据保护铁律待曼波确认后再删；工作区 netlog 三处未提交改动系并行会话（netlog v6）进行中的工作，未并入本批。版本号注记：netlog v6 批与本批曾短暂并存两个 v121 文案，按「vN 只增不复用」运维台批改为 v122。

## v121 · 2026-09-28 · 随本提交落地 · feat（联动摘要）

**netlog v6：通知切换机器人本体私聊（曼波拍板「不用 webhook 用机器人本体」）**

- netlog 通知出口重构：新增 src/feishu.js（共用应用 tenant_token 缓存 + IM API 私聊），sendNotify 多目标分派（open_id 私聊，webhook 通道整体移除）；事件分级保持——关键事件（断/通/IP 变化/账号用尽）即时私聊，过程事件只落盘+恢复汇总卡。
- 配置：NETLOG_FEISHU_APP_ID/SECRET（共用应用同源凭据）+ NETLOG_NOTIFY_OPEN_IDS（审批域两个候选 open_id，已实测两条测试私聊发送成功，等曼波确认收件后收敛）。
- 踩坑归档：.env 键名解析正则 `[A-Z_]+` 漏数字（`_1` 后缀键匹配失败返回空值——改 `[A-Z_0-9]+`）；bash heredoc `\n` 多层转义折叠真实换行（chr()/cache 桩绕行）。
- 刷屏事故（v5）闭环：财务群自 v5 起零 netlog 消息，v6 私聊通道上线后通知直达曼波本人。

## v123 · 2026-09-28 · 随本提交落地 · docs（配置收敛）

**netlog 通知 open_id 定稿：A/B 实测确认曼波本人=ou_249993fe...**

- A/B 标记私聊实测：曼波收到 B（ou_249993fe，审批自动通过人/私聊白名单配置位）；ou_54493ce1（催办兜底人位）非其本人。NETLOG_NOTIFY_OPEN_IDS 已收敛，v7 部署上线（01:42）+ 定稿验证私聊发送成功。
- netlog README 通知通道节同步定稿说明。通知最终形态：关键事件（断网/恢复/出口IP变化/账号用尽）机器人本体私聊曼波；过程事件只落盘，断网恢复后汇总卡一并送达。

## v124 · 2026-09-28 · 随本提交落地 · chore（联动摘要）

**抢修 bat 归档 + duty-bot v43 指针联动**

- 曼波拍板归档：`enable-sshd.bat` / `install-openssh.bat` / `fix-duty-bot.bat` 三个抢修工具 git mv 进 `archive/`（小电脑 OpenSSH 离线安装组合与 duty-bot pm2 环境重建的历史工具，出处见历史条目；部署链路早已统一 `npm run push`，挪档防误用，真要救火翻 archive 即用）。`qianli-deploy` skill「已知坑速查」的 enable-sshd.bat 引用路径同步改 `archive/`。
- 联动归档：duty-bot **v43**（快递表「备注」列建表脚本补列+生产 base 已执行，`af19a14`）gitlink 指针随本提交入库——「已取n/全部已取」确认自此自动记录确认人。
- sop 公开站 link_token 位置核查（曼波反馈「没看到」）：token 非页面可见元素，藏在 `site-sop-planet/index.html:434`「千里论坛」按钮的跳转链接（源稿 qianli_sop_planet.html 同带）；实际为 applink `chatter/add_by_link`＝**添加联系人**（点击=向绑定人发好友申请），非审查初判的「入群邀请」——风险低一档，去留待曼波复核拍板。

## v125 · 2026-09-29 · 随本提交落地 · docs（联动摘要）

**Radmin VPN 远控通道建成 + qianli-lab-network skill 沉淀批**

- **Radmin 远控通道**：曼波预见开发联网条件变差，要求给小电脑增跨网段远控且全程代办。`qianli-mesh` 网络建成（笔记本 26.33.107.52 / 小电脑 26.6.74.79，实测 6ms P2P 直连），防火墙放行 26.0.0.0/8→22/3389，SSH 公钥免密（ed25519 → administrators_authorized_keys），RDP 凭据缓存+桌面双 .rdp，重启自愈链（服务自启+GUI HKCU Run 自启+AutoAdminLogon）。小电脑 2.1.4951.1 静默安装（验签 Famatech Corp. Valid）、「加入网络」GUI 五段自动化（RDP 自动登录→EnumWindows 拉隐藏主窗→SetWindowPos 挪窗→剪贴板粘贴填表，全程截图闭环）——全程经验沉淀为 skill §十三。
- **skill 更新**（qianli-lab-network）：§三新增 0.5 条「本机连上却没网先查 Watt Toolkit」（Watt 开着换网=代理端口僵死全断，同网他人正常=本机问题指纹）；§九/§十一 4A 打印路由器与裁判系统路由器标注「已物理拔离」（曼波因消息迷路拔下，重接走检查单）；§八 netlog 探针条目既有。
- **凭据归属勘定**（曼波纠偏）：Radmin 组网凭据归大脑仓库 `config/radmin-mesh.local.env`（gitignore 已排除），不进 approval-bot/.env——已迁移并清零。
- **联动 gitlink**：approval-bot **v60**（`ca9e9b5`，approval 指令通道鉴权配套，与 hub v122 跨仓同批，已推 GitHub）；ticket-pm/project-management-robot `ab7e81e`（v122 条目提交）+ `63313e0`（关键词回答表/抽奖配置表运行时回写同步）随本提交入库。
- 相关：真断网乌龙（Watt 案）排查与 netlog 09-28 12:43 实战自愈首秀验证（55s 首选项一发命中）详见大脑仓库 network 域与 skill §三 0.5。

## v126 · 2026-10-04 · 随本提交落地 · docs

**三仓联动批归档：netlog v8 复活通知滞留根治 + approval-bot v67 小时级回复轮询 + hub v123 催办回复静默（10-03/10-04 实况复盘批）**

- 曼波两问的排查结论：①「网关状态播报」**基本是真断**——10-04 凌晨 02:29–07:02 多轮 lan+wan 同时失败（机器活着在记录，路径级故障）、20:21 认证掉线由复活引擎 55s 自愈（第二次实战胜）；10-03 目标机白天**断电停机约 10h**（RTC 停在 09-30、16:22 NTP 校时跳变 3.4 天，断电窗口 netlog 同机无记录属「通知与被监控网络同生死」固有盲区；校时跳变另诱发 approval-bot qrcode crash 风暴 44 次，pm2 4D uptime 为虚胖）；②陈方硕「延期7天」识别链路正常、坏在「每日一轮轮询 + hub 欢迎语干扰」；「制作报销单零生效」= 票池自 09-29 首单后为空（dry-run checked:0），非链路 bug。
- **联动 gitlink**：netlog 顶层路径 `3d7295e`（v8：wanOk 每轮冲刷积压根治复活通知滞留 + DownSince 清零 + 22+18 断言）；approval-bot `8d24899`（v67：小时级回复轮询 `0 45 * * * *` + pollAllReplies 互斥 + 部署后健康检查）；hub `2c5a503`（v123：私聊催办回复强词形静默让位 + 部署后健康检查）。三仓健康检查闸门同批上线（qrcode crash 一类「部署成功但进程起不来」从此部署期即炸）。
- 用户侧同步：《机器人总成使用指南.html》财务催办段补「回复每小时自动确认（≤1h 回执），机器人静默属正常」。
- 运维待办（曼波知悉）：目标机 DESKTOP-FE1MIGI 的 RTC/供电待查（10-03 无故停机 10h + RTC 停摆），pm2 小电脑日志轮转 max_size 配置过小（碎片化）可顺带看一眼。

## v127 · 2026-10-05 · `408593f`（netlog 顶层路径提交）· docs

**netlog v9 真实流量探测批归档 + 拓扑口径更新**

- netlog v9（`408593f`）：traffic 探测维度（generate_204 HTTP 全链路，握手通流量断的软踢可见）+ 复活引擎软踢触发（wan+traffic 双通才判成功）；stub 29+23=52 断言。起因：10-04 晚曼波体验断网但 netlog 全绿——TCP 握手测不出软踢/限速。
- **拓扑口径更新（曼波 2026-10-05 口述，覆盖 skill §九旧状态）**：4A 打印隔离区方案未启用——现网=打印机直连主路由（superqianli，192.168.31.1，小米固件）2.4G 上外网，主路由校园网会话=曼波本人账号 20251852（10-04 23:37 手动登录接管，eportal onlineList 实证单会话）；出口 IP 随会话切换 222.178.10.186→222.178.10.242（无 IP 白名单依赖，无影响）。曼波侧「打印机/自己设备 2.4G 时通时断、有线与 5G 正常」——共同因子=主路由 2.4G 频段，待查信道/负载（router admin 密码待曼波核实，skill §十三）。
- **打印预约域悬案揭雷**：bambu-print-server 部署 .env 的 PRINTER_HOSTS 本地/目标/归档三处全空，服务自 09-16 起所有日志「打印机数量: 0」——/print-* 聊天链路正常但**打印机调度从未接真机**；v35 幽灵空闲修复系代码加固。打印机入主网流程（LAN 模式+静态租约+PRINTER_HOSTS 填 31.x 地址）待曼波在打印机屏幕侧配合，未排期。

## v128 · 2026-10-05 · 随本提交落地 · docs

**4A 打印网关整治（曼波拍板「打印机直连外网」+「都搞一下」批）**

- 拓扑实况（曼波口述 + 实测吻合）：4A 已由曼波 10-03 ~16:25 亲手重接主网（wan 静态 192.168.31.98，主网设备列表在线 32h+）；定位改为**打印机直连外网网关**（不再走 09-20 的隔离区方案）。
- 病因定案：「打印机有时连不上互联网」主因=**4A 防火墙只有三规则、没有 lan→wan 转发，打印区在配置层面就出不了外网**（不是 2.4G 信号问题）；次因=4A 2.4G（ch1）与主路由 2.4G（auto→ch1）同频互扰。
- 整治动作（root SSH 经小电脑跳板）：①补 `firewall.@forwarding[1]`（lan→wan），fw4 重载后 nft 数据面验证 `br-lan→forward_lan→dest_wan→oifname wan accept` 通路开放、NAT masq 正常；②radio0 信道 1→6（校园频谱扫描：ch11 邻居 24 个最挤、ch6 16、ch1 13——1 虽最空但被自家双 AP 占用，错到 6；主路由保持 auto，若日后跳 6 需再错开）；③验证 4A 自身出网（ping 223.5.5.5 12.9ms）与 DNS（bambulab.com 解析正常）。
- 现状与剩余：Printer SSID（ch6 HT20）就绪待打印机入网（当前未关联，通电连 SSID 即出网）；入网后按 MAC 配静态租约；接打印机器人的 `PRINTER_HOSTS` 流程仍未排期（见 v127）。
- skill 沉淀：qianli-lab-network §九状态重写（重接+新定位+本次整治+剩余清单）、§十三「cquqianli not auth 待核实」陈旧记录勘正（09-27 已定性为登录算法代际问题，密码无误）。
- netlog v9（`408593f`，v127 归档）同日上线：traffic 探测维度 + 复活引擎软踢触发，主网会话级「握手通流量断」从此可见自愈。

## v129 · 2026-10-05 · 随本提交落地 · docs

**主路由 Wi-Fi6（ax）全局关闭——竹子连不上 WiFi 的兼容性整改（曼波「有的能连上有的连不上」批）**

- 病因排查（多台拓竹打印机分流实测）：两台在线竹子（31.194 稳定 32h / 31.94 新近入网）都在 superqianli 2.4G 上——**「连不上」的那部分根本没关联进网**；同 AP 同密钥下设备级分流，最一致的解释=主路由 2.4G 开着 11ax，老 11n 物联芯片兼容性玄学（wifi_detail_all 实证 wifimode=11ax/ax=1）。
- 修复：`POST /api/xqnetwork/set_wifi_ax` body `ax=0`，双频全局生效（2.4G/5G ax 均 0，5G 客户端回落 11ac，无感）。端点由前端 JS 挖掘未果后按社区已知穷举命中；`set_wifi` 全量回显测试证明其 `wifimode` 参数被固件无视（已记 skill 防再踩）。
- 现场状态：ax 关闭瞬间 14 台客户端全部自动重连成功（含两台竹子），无新竹子立即入网（未通电/未重试者后续观察）。打印机清点：全网段 8883/6000/990 指纹扫描仅两台在线，4A Printer SSID 空置。
- skill 沉淀：qianli-lab-network 主路由小节补 set_wifi_ax 端点知识 + ax 关闭记录 + 信道错开备忘。

## v130 · 2026-10-05 · `b04dcc4`（netlog 顶层路径提交）· docs

**netlog v10 被踢轮换批归档 + 主网会话切回首选项**

- netlog v10（`b04dcc4`）：复活引擎近期被踢轮换——复活成功 30 分钟内又掉线=账号被抢，本轮把它排队尾换下一个（不做互踢对拍，曼波定）；窗口外掉线仍按优先级首选开始；连带修 startRevive 清遗留 pendingSlow。stub 29+29=58 断言。README/skill 语义成文。
- 主网校园会话已切回首选项 31108753（曼波指示不用本人账号）：logout(20251852)→login(31108753)「Portal协议认证成功」，15 秒窗口，会话与复活引擎账号池从此一致。

## v131 · 2026-10-05 · 随本提交落地 · docs

**netlog v11 断电感知批归档（曼波「断电自活」软件侧配套）**

- netlog v11：启动时与上一进程最后心跳间隔超 15 分钟 → `boot_after_offline` 通知卡（离线时长+疑似断电提示+BIOS/电池自检指引）；网络未就绪自动落积压随恢复补发。stub 35+29=64 断言。
- 断电自活的自动通电=硬件侧待办（需现场一次）：目标机 Intel NUC10i7FNK，BIOS F2 → Power → **After Power Failure = Power On**；CMOS 电池疑失效（RTC 曾停在 09-30），同场换 CR2032（不换则 BIOS 设置断电即丢、来电自启白设）；可顺带初始化 MEBx/AMT（LMS 服务在跑，vPro 具备远程开机潜力，留档待议）。

## v132 · 2026-10-05 · 随本提交落地 · fix

**netlog v12 复活引擎假阳性根治批 + 凌晨打印机断网全案 skill 沉淀**

- 联动：netlog/DEVLOG.md v12（详录）——05:28 掉线事故复盘三连修：①guard 挂载接线丢 trafficOk（v9 软踢复活从未生效的元凶）；②wan 探测升级「TCP 预检+HTTPS DoH 数据面验证」戳穿认证网关代答假阴性，probeLatency 基线同步走 TLS；③复活成功判定新增 online_list 会话归属核验（verifySession 注入），归属非本账号发 `revive_session_mismatch` 即时卡+30 分钟冷却防刷屏，接口异常降级放行。stub 39+38=77 断言全绿（+13）。
- skill 沉淀（`.agents/skills/qianli-lab-network/SKILL.md`）：ax 切换偶发 2.4G 射频半死（配置开/信标停，修复=ax=1→0 重启射频，验收必须空中扫描）；4A dnsmasq 进程上游陈旧 SERVFAIL（restart 即愈）；设备两网漂移定案；主路由 10-04 夜间假死病史；手动换号 SOP（logout→login 首选→online_list 终验）。
- 顶层 AGENTS.md 补 netlog 职能总表行（2026-09-27 上线时漏登记的历史欠账，本批顺带补齐）。
- 未并入的遗留（保留待各自批次）：dashboard/server.js、feishu-gateway/DEVLOG.md、ticket-pm 三文件、duty-bot 子仓——均为其它会话批次的小尾巴，与本批无关。


## v133 · 2026-10-05 · `6fefe11` · fix

**netlog v13 通知节流 + gateway v35 bambu 收口（「60 条私信」事故批，曼波指令：一并修复）**

- 联动一：netlog/DEVLOG.md v13（详录）——当日校园网软踢拉锯，翻转事件+mismatch 即时私聊轰炸曼波 59+ 条。翻转改事故聚合（`*_down/*_up` 只落盘；`*_down_sustained` 持续 ≥10min 报警+2h 复报；`*_recovered` 抖动群恢复卡：30min 窗口累计 ≥5min 或 ≥3 次）；mismatch 4h 通知冷却；积压补发三条件限频（wan 恢复旁路/攒 10 条/超 2h）。stub 53+38=91 断言全绿（+14）。
- 联动二：feishu-gateway/DEVLOG.md v35（详录）——bambu 路线 A（同日 v37）退役 `/api/feishu/event` 后网关侧没收口，表格事件广播对其全天 404 500+ 笔、投递统计污染。`DEFAULT_CONSUMERS` 移除 bambu、审批事件默认只发 ticket、`.env`（本地=部署源头）同步收口；部署后 health 消费者=hub/approval/ticket、计数归零、ws running。
- registry：gateway 监听描述与 bambu 条目（role/listening）同步路线 A 现实（断飞书事件链、指令唯一出口）。
- 归档 v132 批明确遗留的未提交项：`.agents/skills/qianli-lab-network/SKILL.md`（v132 已记档但 netlog push 只暂存 netlog/ 路径，漏归档）、dashboard/README.md 与 server.js 的「NAS→部署目标」称谓/看门狗静默窗注释对齐。
- 仍未归档（待各自批次）：ticket-pm 三文件、duty-bot/approval-bot 子仓改动、顶层未跟踪 memory/（领域记忆目录，不进 git）。

## v134 · 2026-10-07 · 随本提交落地 · chore

**NAS_*→DEPLOY_* 连接键全面改名批（旧 NAS 残留清理，曼波定）+ 旧 NAS 实测探查收口**

- 探查（曼波供密码，一发命中）：旧 NAS（qianli-NAS 192.168.31.153:2222）机器人零在跑——pm2 空、`pm2-qianli` disabled+inactive、docker 空、dump.pm2 为 9-13 关停日快照且 env 仅系统键；残留两条 cron 已注释停用——campus-keepalive.sh（每分钟，硬编码 10.253 时期学号密码+写死旧 IP，账号 20230104 与主路由同号有互顶风险）与 snapshot-data.sh（每日 3:30 备份本地 *-data，小电脑侧新版数据面快照已接管）；原样备份 `/home/qianli/backups/crontab.bak-20261007`，脚本与数据目录未动，探查拉起的 pm2 daemon 已 kill；
- 改名（防误导自查；历史 DEVLOG/事故记录保持原貌）：连接键 NAS_*→DEPLOY_*（8 仓 .env+.env.example+push.js，含 pm-robot 运行时 .env 解析正则）；运维台 `/api/nas/*`→`/api/deploy/*`（readDeployConfig/deployStatus 响应键 deploy·deployOnline/前端 deployApi·deployRestart/registry deployDir）；ticket-bot verify-nas.js→verify-deploy.js；6 仓 AGENTS.md+README×5+两 skill+机器人总成使用指南.md+网关拓扑文档.md 活性引用宽松终查清零；
- 8 仓同批上线：netlog v14 / wecom v12 / gateway v36 / bambu v44 / duty v44 / ticket v89 / hub v124 / approval v69（收口 v68 部署混入的改名半成品）；网关 ws:running 复验通过；运维台 /api/overview deploy 键实测在线；部署目标 7 目录 .env 复核全 4 DEPLOY/0 NAS；
- 遗留并入：ticket-pm/LOGIC-MAP.md 功能描述补链（v87/v115/v120/v122）、ticket-bot DEVLOG 重复句修正、duty-bot README 快递备注列/cron 口径对齐（v43 批欠账）；
- 已知保留：nas-e2e-test.js（2026-09-27 定性废弃存档，保持原貌）；approval-bot/.tmp-dryrun.js 未跟踪调试残留待定夺。

## v135 · 2026-10-07 · `9e1a7d5` · fix

**DHCP 探针勘误批（曼波质疑成案）：RD08「3 秒慢应答」定性翻案 + netlog v17 + lab-network skill 勘误**

- 事件：上午 v16 上线后 netlog 报两次 `router_dhcp_down`（11:01/11:31），配合曼波报「打印机连 SuperQianLi 拿到裁判内网 192.168.3.x」排查；曼波质疑「会不会是网关架构/设置问题」引发定性重审，三组实验翻案——①已知 MAC（有租约）DHCP DISCOVER 恒 4-6ms 秒答；②新 MAC 首次 3.0-3.9s、同一 MAC 第二次起 4ms（RD08 固件**陌生设备检查路径**，查过进快表）；③31.1 dnsmasq 应答 1-5ms、校园网 DNS UDP53 通（「DNS 拖死 DHCP」不成立）。**结论：DHCP 服务从未挂过，v16 的 down/recover 振荡全是「随机 MAC × 3 秒检查 × 3000ms 超时」探针伪影**；真半死判据=已知 MAC 也慢/无应答（上午 ax toggle 后那种才是）；
- HP M232「拿裁判内网 IP」定案：**投奔满格「裁判系统」SSID**（设备按信号挑已记忆网，裁判 2.4G 100% 满格），拿裁判 3.x 租约（网关=死地址 192.168.5.1）必没网；rogue DHCP 排除证据=5 轮 DISCOVER 唯一应答者 31.1（发全 31.x）+ SendARP 二层直探 3.1/5.1/1.1/2.1 全无应答；devicelist 僵尸条目实锤（HP 31.105 / AMPAK 31.88，ARP/端口全无应答）；修复=HP 删「裁判系统」profile 或裁判 SSID 改名隐藏（与改段 1.x 同批，曼波手动项）；
- netlog v17（详见其 DEVLOG）：`dhcpProbe.js` 参数化 mac+导出 DEFAULT_PROBE_MAC/PROBE_TIMEOUT_MS(5000)/parseProbeMac，`index.js` 组装固定探针 MAC（NETLOG_DHCP_PROBE_MAC 可覆盖）+5000ms 超时，routerWatch down 文案改固定探针语义；routerwatch 桩 26→33 断言，三套合计 131 全绿；
- skill 勘误：`qianli-lab-network` §十四 追加两条（陌生设备检查机制指纹+真半死判据 / 僵尸条目与投网鉴别三连含 SendARP 坑）；长期记忆同步（lab-device-jumps-to-neighbor-ssid）；
- 「新设备连上没网」机制性残余：新设备首答 3~4 秒，超时紧的客户端会放弃；消除=关主路由「新设备接入确认/防蹭网」类开关（安全权衡曼波定，本批未动路由器设置）。

## v136 · 2026-10-07 · `58d739a` · feat

**被抢持续垫底批：netlog v18（「首选只是优先不是拉锯」，曼波 2026-10-07 定）+ registry/skill 同步**

- 提交说明：feat: netlog v18 被抢持续垫底——复活成功 30min 内又掉线=账号被抢，持久垫底 24h 跨轮跨重启避开、到期自动复位；同批顶层 registry netlog v18 条目 + lab-network skill §十二.1 垫底语义 + auto-memory 拉锯实锤归档
- **背景**：当天 15:24-15:25 断网 55s=三方拉锯（31108753 疑似本主两度顶掉引擎会话 → 引擎换号复活与曼波手动登录 20251852 赛跑 → mismatch 让位收场）。复盘发现 v10「被踢轮换」只记 lastRevive 单值+30min 窗口，窗口一过就回首选跟人对拍——曼波拍板首选语义=优先不是拉锯，被抢就换下一个持续避开
- **改动**：netlog v18（详见 netlog/DEVLOG.md：demoteStore 持久垫底+rankWithDemotions 排序+account_demoted 即时私聊，wanguard 52 断言三套 145 全绿）；dashboard/registry.js netlog role 补 v18；skill §十二.1 补「被抢持续垫底」段（含与「本月不再使用」两档区分）；memory 归档「曼波账号=20251852/31108753 疑被本主抢用/mismatch 让位实战生效」三条实锤
- 部署：qianli-netlog pm2 重启在线，健康检查 lan/wan 全绿（egress 222.178.10.242）；账号池种子未动（垫底状态在数据目录独立文件，部署不覆盖）

## v137 · 2026-10-07 · `43a6dd8` · chore

**遗留盘点批：duty-bot v45-v47 指针归档 + gitignore 敏感残留拦截 + 顶层远端补推（曼波令「盘点项目栈，push 和部署」）**

- 盘点结论：五业务仓工作区全净且已推 GitHub；顶层 ahead 2（netlog v18 `5cb1224`/v136 `58d739a` 未推远端）；`M duty-bot`=指针漂移（顶层归档 d8557a6=v44，duty-bot 实际已 v47 `54d1c76`）；
- duty-bot 联动 docs 批 `b5b11f3`（纯文档不占版本号）：DEVLOG 头部指针 v44→v47 + v44-v47 占位哈希回填（又一次头部指针滞后复发），随批 `npm run push` 重部署，线上=本地=`b5b11f3`（health 响应含 v47 新增字段 `pendingFailureReports:0`，新代码上线实锤）；部署目标逐仓核对：duty `b5b11f3`/approval `9f2ce86`/pm `af1ebbe` 与本地全对齐，ticket-bot 目录为 SFTP 降级形态无 .git，以进程 uptime（与全批同刻重启）+health ok 判定=v134 批版本；8 服务 health 全绿（网关 ws:running、netlog lan/wan 全绿 egress 222.178.10.242、duty 静默积压 0/待补报 0）；
- gitignore 补三类拦截（均为今日网络排查会话 untracked 残留，不拦截则下次顶层 push.js 的 git add -A 会卷进 GitHub）：`memory/`（她的记忆目录，家在大脑仓库经 brain-sync 同步，内含私人事件流不入公开归档仓）、`WLAN-*.xml`（WLAN profile 导出内含明文 WiFi 密码=裁判路由器凭据）+`.tmp-*`（裁判 WiFi/MAC 调试脚本与核对脚本）+`.dashboard-run.log`（旧规则 `dashboard-run.log` 没盖住带点变体）；**文件本体留本地未删，待曼波处置**；
- 顶层远端补推：netlog v18+v136+v137 一并推 GitHub；
- 遗留并入：运维台拓扑看板「裁判系统路由器」卡描述一行——同步曼波 2026-10-07 拍板（SSID 关停隐身不广播、链路未部署等 Engine 联调 PHY 墙待破）。

## v138 · 2026-10-07 · 随本提交落地 · feat

**bambu v45 FTPS 上传通道 + 4A 隔离区 31→2 路由打通批（曼波令「都做」：打印机双用途链路收口）**

- 起因：曼波问 4A（192.168.31.98）要不要加「桥接」以兼顾打印机临时外网 + 打印预约 LAN 模式通信。评估结论=**不需要桥接**，4A 路由模式（LAN 2.x + wan 31.98）本就是双用途正确形态；bambu LAN 模式通信方向=机器人主动连打印机（MQTT 8883/FTPS 990），只需主网→2.x 可达。
- **「31→2 转发待修」悬案销案（10-05 遗留）**：4A 侧防火墙/转发/nft 从来正常（规则②在内核实测在位），根因=**主网缺去程路由**——发往 192.168.2.0/24 的包在主路由被默认路由扔进校园网（4A nft counter 0 包不达实证）；解法=主网各机本地加静态路由 `192.168.2.0/24 → 192.168.31.98`（笔记本 UAC route add -p + 小电脑 SSH route add -p，**主路由零改动**；主网新机器要管打印机照加即可），小电脑→2.189:8883/990、2.133:8883 实测全 OPEN。
- **打印机双机实锤（免上屏鉴定法沉淀进 skill）**：2.x 现役 6 台里两台 Bambu P1 系已连 Printer SSID（**云模式**，曼波未开 LAN 模式——实测云模式下 LAN 端口集 8883/990/6000 照样常开，机器人可先联调）；`openssl s_client` 证书 issuer=BBL Technologies、CN=SN：`00M09D541710031`=printer-189、`00M09A371900389`=printer-133，4A DHCP 静态租约同批固化。**旧铁指纹「21+80+1883」勘误**：真指纹=8883+990+6000，两台真机 21/22/80/443/1883 全 REFUSED。
- bambu v45（详录该仓 DEVLOG）：新固件砍了社区明文上传通道（21/22 全关），`uploadBuffer` P1/A1 分流改 FTPS:990 优先（basic-ftp implicit TLS）+FTP:21 回退；新增 8 项分流单测，十一套 141 项全绿；`npm run push` 部署（printers:0 无行为变化，health ok）；PRINTER-LAN-API.md §1.4/§5、README 测试节同步。
- lab-network skill §九三处更新：31→2 销案+路由方案、打印机双机状态、铁指纹勘误+证书鉴定法。
- 顺手归档：duty-bot 指针 b5b11f3→`9f1d4fa`（他批 v47 部署须知拍板 docs，duty-bot 本仓 HEAD 干净）。
- 遗留（唯一）：两台打印机 Access Code 待曼波上屏抄取 → `.env` 四列（PRINTER_HOSTS=192.168.2.189,192.168.2.133 / ACCESS_CODES / SERIALS / NAMES+MODELS=P1S）填入重启即联调；「打印机切局域网模式」可选（上线时切，断云防双通道打架）。

## v139 · 2026-10-07 · 随本提交落地 · feat

**zklink-attendance-bot 开仓批：ZKLink 打卡时长周报机器人（值日群播报 + 云文档留档）**

- 起因：实验室新增 ZKTeco 打卡机，数据上传 ZKLink 云考勤（`zklink.zktecoiot.com`，曼波已建好考勤组+规则），要求每周自动统计打卡时长 → 值日群 webhook 播报一次 → 云文档留档本次全部记录。留档目标曼波指定 wiki 节点（cquqianli.feishu.cn/wiki/NFUS…）。
- 新仓 `zklink-attendance-bot/`（:3017，pm2 `zklink-attendance`，repo:top）：周播周一 09:30 上海 + 每小时补发看门狗（首启保护；播报/留档独立水位）；晚间静默闸门全过（同 wecom 口径）；时长口径=按人按上海挂钟日「末卡−首卡」，孤条不计，跨零点切断；本地 archive/ JSON 全量+CSV 兜底。
- 数据源双通道：`import` 默认（ZKLink 网页端考勤组维度导出上传，容错列匹配，兼容「打卡时间」单列与「日期+时间」分列，多时间列统计模板明确报错挡下）；`http` 直拉（无凭据侦查结论：平台=qiankun 微前端壳 zlink_pc_cn_front + OAuth Bearer 指纹，考勤模块 zkbio_att 动态挂载；真实端点候选写入 zklink.js，凭据到位后 `scripts/zklink-probe.js` 一键校准回填再切）。
- 云文档留档：ARCHIVE_DOC_TOKEN 兼容 wiki 节点 token（自动 get_node 换算+缓存）与 docx token；应用身份 blocks 追加分批 50/请求；未配置时本地兜底、卡片照发。
- 登记同步：dashboard/registry.js 新条目、顶层 AGENTS.md 职能总表新行+定制窗口现状（六仓→七仓）、《机器人总成使用指南》MD+桌面 HTML 各加卡片/播报行、本仓 README/LOGIC-MAP/DEVLOG/AGENTS 四件套。
- 测试：8 套 147 断言全绿（window 17 / duration 22 / import 24 / quiethours 8 / feishu 18 / archiver 17 / zklink 29 / store 12）；桩测试拦下一个真 bug——`toShanghaiMs` 漏 `v instanceof Date` 分支导致 Date 单元格整行静默跳过（wecom 版同款分支补齐）；踩坑沉淀：Excel 序列号浮点往返 ±1s、`node -e` 子进程相对 require 以 cwd 为基。
- 顺手归档：`.agents/skills/qianli-lab-network/SKILL.md` rogue DHCP 事故档案段（并行网络会话遗留，evt_008/009 已结案）；顶层 DEVLOG 头部指针修正（v138 滞留 v137）。
- 遗留（激活前置，待曼波）：①ZKLink 账号密码（→ 跑 probe 校准 http 通道，可选）；②值日群新建自定义机器人 webhook URL；③飞书应用凭据（docx 权限 + wiki 只读 + 加为留档文档协作者）。三者入 `.env` 后 `npm run push` 即激活；未激活前部署只落进程不播报（首启保护，无水位不自动补发）。

## v140 · 2026-10-07 · 随本提交落地 · feat

**zklink 打卡周报归并批（曼波定「复用现有应用和分发以及触发逻辑，归并到 dutybot」）**

- 曼波同批给齐：值日群 webhook（=duty-bot 现役 `DUTY_BOARD_WEBHOOK_URL` 同一条，实测比对确认）+ 归并指令 + 「登录链接我来登」的 ZKLink 账号意向。据此当日两连批：v139 开的独立仓 `zklink-attendance-bot/`（:3017）整体**删除**，功能并入 duty-bot v48（详录该仓 DEVLOG）——`src/zklink/` 八模块（config/report/importService/zklinkClient/store/feishuDoc/card/service）、cron 双任务挂 gateTask（静默/积压/失败补报全自动继承）、端点挂 :3006 复用 API_TOKEN、云文档留档复用 APP_ID/SECRET（wiki token=NFUS… 已在 duty-bot .env）、webhook 复用 BOARD 同条；13 套桩测试全绿（新 6 套 120 断言）。
- 本仓改动：`git rm -r zklink-attendance-bot`；registry.js 删独立条目、duty-bot 条目全面更新（role/listening/commands/permissions/windows+5/quickActions/notes）；顶层 AGENTS.md 职能总表并回 duty-bot 行（六仓口径恢复）、定制窗口现状行回改；《机器人总成使用指南》MD 独立节改 duty-bot 归并模块节、端口表删 3017 行（桌面 HTML 用户视角不变未动）。
- duty-bot 侧遗留：共用应用 docx 权限 + wiki 只读 + 文档协作者待飞书后台人工配置（未配时留档走本地兜底、播报照发）；ZKLink 账号待曼波登录提供（http 直拉 probe 校准，可选）；ZKLink 网页端导出→导入的首周人工喂数。

## v141 · 2026-10-08 · 随本提交落地 · docs

**HP LaserJet MFP M232dwc 配网+打印通道收官批（纯文档/记忆沉淀，无代码改动）**

- 背景即 2026-10-08 凌晨打印机抢修实战（详见本批详录）：「卸载设备失败 -2081883393」罗生门 → setupapi.dev.log 定案老 Full Webpack 52.4.4998 × Win11 25H2（26200）不兼容（驱动本体装上、打印类配置 0x0d 失败 → 安装器删光 USB 实例）；IPP-over-USB 触发打印机固件 49.0111 崩（=面板 Er61）；最终走无线 Standard TCP/IP 端口（IP_192.168.31.107，RAW 9100）+ 内置 IPP 驱动验收出纸。配网走手机 HP SMART + HP=Setup 开放热点（主路由 BE6500 Pro 无 WPS）。
- 本仓改动：`.agents/skills/qianli-lab-network/SKILL.md` §二 设备接入速查——新增 HP M232dwc 行（三坑勿踩：老包勿装/USB 打印勿用/WSD 假死换 TCP/IP）与主路由行更新（补 BE6500 Pro 型号/固件/无 WPS 事实）；`memory/domains/network/`——events.jsonl 追加 network-lp-evt_011（配网收官全档+三坑实锤）+ CONTEXT.md 头部收官节（updated 刷新 2026-10-08T05:00:03+0800）。
- 关联长期记忆：ZCode auto-memory `hp-m232dwc-printer-setup`（跨会话注入层，与本批内容一致）。
- 遗留待办：打印机 DHCP 静态绑定（miwifi 管理页，IP 漂移则队列失效）；扫描通道已可用（WSD/HP SMART）无需动作。

## v142 · 2026-10-08 · 随本提交落地 · feat

**论坛功能迭代联动批——hub v125 千里论坛只记 #话题 帖子**

- 曼波发张郭浩《论坛机器人使用指南 v1.0.0》定稿口径，曼波两处拍板：①千里论坛群记录规则从「全量发言」改为**仅记录「#话题 + 空格/换行」开头的帖子**；②话题数据落论坛发言表、动态广场不恢复写入（维持 2026-09-20 用户自维护拍板）。
- hub v125（`ded68e0`，独立仓已推 GitHub）：keywordService 话题判定（12 话题整段命中开头/清单热改即生效）+「话题」单选字段落表+图片/话题逐字段降级+清单空兜底全量；新脚本 add-keyword-topic-field.js 幂等补字段（dotenv 解析修复 `0e71050`，线上表已建 fld0eW0Pch）；stub-test-keyword-post 25 断言+全量 10 套绿；部署 knowledge-tracker online+健康检查过。详见 hub DEVLOG v125。
- 顶层随批：dashboard/registry.js（hub role+keywords 窗口描述改论坛口径）、《机器人总成使用指南.md》hub 段（论坛迭代条目）+ 桌面 HTML（工作区外不进 git）新增「🗣️ 千里论坛」卡；hub gitlink 锚定 v125。
- 遗留：动态广场热力图图表本身由用户在飞书仪表盘按「话题」字段自配（图表 API 建不了）。

### v143 · 2026-10-09 · 随本提交落地 · feat
**bambu v46 归档批（2026-10-08 深夜~10-09 凌晨会话遗留补归档，本批=工作区残留清理）**

- bambu-print-reservation v46「全链路优化批+收缩量标尺」27 文件补归档（内容详见 bambu-print-reservation/DEVLOG.md v46 条目）：收缩量标尺 shrink_scale（-3~+3→轮廓补偿三档互斥种子规则）、完成事件首报文补收尾、巡检阈值动态化（预估×2 且 ≥1h）、真机 debug 端点（GET /api/printers/:id/debug admin）、建议池撞 id 修复、颜色字典窗口 GET /api/print/colors+提交端 datalist、指定打印机校验、用户可控字段 XSS 转义、存储损坏隔离（.corrupt-<ts> 留档）、上传进度条、打印机卡 admin 控制按钮、已完成单复刻、队列 ETA、审批链遗留文件清理（approvalService/eventSubscription/approval-test 删除，路线 A 起零接线）；同批二次交付页面展示优化 11 项（状态语义色+打印中脉冲/打印机失联标注 stateStale/队列条全员可见+前 4 单明细/轨迹与参数折叠/已选摘要 chips/组折叠/材料 datalist/移动端 <720px 卡片化/行内实时进度/微交互/表头 thead 语义修正）。
- 测试：十套 158 项，本批入库前（2026-10-09 17:30）复跑全绿。
- **v46 部署未执行**：部署目标 bambu-print-server 仍为 10-07 v45 代码（src/index.js mtime 10-07 09:12、/api/print/colors 404 实证）——归档≠上线，上线待跑 `npm run push`。
- 文档联动同批：dashboard/registry.js（bambu windows 补 colors 窗口+notes v46 口径）、顶层 AGENTS.md（定制窗口现状 bambu 行补 `/api/print/colors`）、《机器人总成使用指南.md》（bambu 段路线 A 页面主链路口径+/print-dispatch 移除标注）。
- duty-bot gitlink 锚更新至 v48f（`d20043f`，提前预告当日去重批，10-08 22:22 提交当晚已上线；duty-bot 仓远端同步）；duty-bot 仓 DEVLOG 头部指针回填 `a3b7666`（10-09，纯回填不占版本号）。
- 哈希回填：v142=`dd57f77`。

### v144 · 2026-10-09 · 随本提交落地 · docs
**bambu v46 部署上线追记（v143 归档批收尾）**

- bambu-print-reservation `npm run push`（纯 SFTP，无 git 步骤）执行，v46 正式上线：pm2 restart 后 bambu-print-server online；部署后验证三项全过——`/api/health` 200、`/api/print/colors` 返回 14 色名字典（v46 特征端点，部署前 404）、启动日志静默窗口/每日快照/服务监听 3001 正常。
- 部署前核对：本地 `.env` 与线上快照逐键 diff 全等（本地自 10-07 v45 部署后未动），覆盖无害；`.env` 上传按 push.js 内建步骤完成。
- 启动日志「injecting env (0)」为无害老常态：主配置走 `src/config.js` 显式 path（`__dirname/../.env`）正常加载，v45 同款；v46 未触碰该文件。
- 打印机 configured:0 维持现状——两台 4A P1 Access Code 待曼波上屏抄取（既有遗留，非本批回归）。
- 哈希回填：v143=`51ef6b3`。

## v145 · 2026-10-10 · <随本提交回填> · feat

全量审查修复批（曼波令：记忆同步+全量审查代码实现链路+debug+桌面优化拓展方案文档+push 一并完成）。5 路只读审查子代理扫全部 10 个单元（源码/测试/部署脚本/文档口径交叉核对），8 仓桩测试基线跑批后逐项定修。

- **P0（bambu v47）**：dispatcher.start() 自 v37 起从未被调用——分发引擎在生产从未启动（队列恢复/完成收尾/失败重排/幽灵巡检/退出冲刷全死代码），startServer 接线 + 新增生产入口级 bootstrap-test 锁死盲区。
- **P1×2**：bambu usage 上报默认端口 :3000→:3010（打印域活跃统计开始归因）；duty v49 zklink 云文档归档门控变量名错恒 skipped（runWeekly 级两态测试补齐）。
- **quietHours 家族五仓联动（ticket v90/hub v126/approval v70/duty v49/bambu v47）**：积压身份键唯一化（毫秒级 queuedAt 同毫秒碰撞互吞——基线跑批在 ticket 实测偶发失败揪出的产线级缺陷）+ pm/approval/duty 三仓移植 ticket-bot 的冲刷收尾竞态修复，各配移植版 stub-test-quiet-flush。
- **netlog v19**：慢速换号分支未清 pendingSlow（重复 ban/重复 login 死循环）修复 + 3b 场景断言。
- **gateway v37（纯 docs）**：README/.env.example 对齐 v35 收口现状；deploy skill 项目清单补 netlog 行。
- 杂项：approval push 闸门对齐 npm run test、bambu push 闸门自动发现+僵尸依赖清理+文案修正（/print-dispatch 指引改页面、/help 补 /print-ams）。
- **部署状态：小电脑双路不可达**（本机在校园网侧 CQU_WiFi、实验 WiFi 不在覆盖；Radmin 对端 26.6.74.79 离线——疑 NUC 断电未自启，对应遗留清单待办）——duty/ticket/hub/approval 的 git 已推各远端，bambu/netlog/gateway 与本批顶层归档先行入库；**小电脑上线后逐仓重跑 npm run push 补部署，无新版本**。各仓 npm test 全绿后入库。
- 桌面交付：《qianli-全量审查与优化拓展方案-20261010.md》（实现链路/设计思路精要、本批修复清单、遗留台账 9 项待拍板+代码类下批、优化管理方案、拓展路线图）。

## v146 · 2026-10-12 · 随本提交落地 · chore

**wecom-attendance-bot 项目废止清理批（曼波令：「企业微信的全部清理，不用了」）**

- **删除**：`wecom-attendance-bot/` 整目录（企微考勤周报，:3007，pm2 wecom-attendance）；删前整目录打包备份至 `Desktop/qianli-backups/wecom-attendance-bot-final-20261012.tar.gz`（含 .env 与 config/members.json 本地种子；git 历史永存可回溯）。
- **顶层联动清理**：dashboard registry 条目（余 8 项目）、dashboard server/index.html 注释、顶层 AGENTS.md（职能总表行改废止占位+定制窗口现状去 wecom 段+追记）、机器人总成使用指南.md（窗口表/端口表 3007 行/专节改废止注/「七大」→「六大」/zklink 节「平行勿混」句）、网关拓扑文档.md（七仓→六仓、拓扑图去 :3007）、qianli-deploy SKILL.md（七项目→六+部署清单行）、qianli-lab-network SKILL.md（.env 子层布局历史注）；bambu-print-reservation/AGENTS.md 职能速览行同步。桌面《机器人总成使用指南.html》零 wecom 引用，无需改动。
- **四仓同步提交**：duty-bot v50（bcab87c，quietHours 注释+README 文档级+quiet-flush 测试静默假挂修复 9/0）、ticket-bot v91（010e5c7，AGENTS 速览行+revoke 测试静默假挂修复 19/0）、project-management-robot v127（ac09c6a，状态舰队移除 3007 条目+stub 7→6 断言，11 套全绿）、approval-bot v74（6a7df97，AGENTS 速览行）；顶层 gitlink 随批锚定四仓最新（duty bcab87c / pm ac09c6a / approval 6a7df97——approval 指针同时收编并行批次 v71-73 的既有漂移）。
- **有意保留**：各仓 DEVLOG 历史条目中的 wecom 记载（历史不改写铁律）、duty-bot zklink 模块注释中 wecom 2026-09-16 导入事故教训引用、netlog/push.js 来源注释。
- **测试疑云已破（凌晨跑批假挂，已随批修复）**：duty-bot `test:quiet-flush` 1/8 与 ticket-bot `test:revoke` 16/3 的失败均=**静默窗口假挂**——02:00-09:00 期间播报类测试被静默闸门顺延/跳过致断言挂（duty runFlush「防越窗兜底」守卫直接 return、ticket 播报顺延），实现全部无罪，各仓 v49/v90 批注无虚言；两测试补 `QUIET_HOURS_DISABLED=1`（require 前设，模块加载时读取）后 9/0 与 19/0 全绿。**系统性教训：播报类桩测试凌晨跑批必假挂，应在 require 前统一禁用静默**。
- **待办挂账**：①小电脑侧清理——pm2 删 wecom-attendance、删 /c/qianli/opt/wecom-attendance-bot 与项目外数据目录（当日凌晨已执行完毕：SFTP 先拉回权威 .env/members.json/水位到 qianli-backups，pm2 dump 零残留验证过）；②曼波自办——企微管理后台停用/删除自建应用（打卡授权+可信 IP）、移除负责人群企微群机器人 webhook；③部署队列：小电脑已恢复在线，v145 批+本批六仓（duty/ticket/pm/approval/netlog/gateway）当批补部署（bambu 暂缓——并行会话有未提交半成品，防 SFTP 全目录直传带半成品上线）。

## v147 · 2026-10-12 · 随本提交落地 · feat

**hub v128 联动批——论坛收录 #小贴士 全群特例（曼波拍板：全群监听）**

- **hub v128（199ed7f，已部署上线）**：`#小贴士` 帖子不限千里论坛群，任意群命中都落表（hub 闸门 `inKeywordScope` 放行，网关零改动——未 @ 群消息本就全量转发 hub）；keywords.json 12→13 话题；下辖正文与图片须在同一条消息（富文本帖）才一并入库；落表链路/降级链全复用零改动；stub-test-keyword-post 25→36 断言、11 套全绿；npm run push 全程过闸（测试→git→部署→健康检查 ✅，收尾 pm2 list 断连为噪音）。
- **顶层同步**：dashboard/registry.js hub role+keywords 窗口描述补全群特例口径；《机器人总成使用指南.md》论坛段更新（13 话题+特例细则）；桌面《机器人总成使用指南.html》千里论坛卡同批改（工作区外不入 git）；hub gitlink 锚 199ed7f。
- **有意不卷入**：bambu-print-reservation 并行半成品（v47 防直传）与 duty-bot 指针漂移保持原状，归各自批次。

## v148 · 2026-10-12 · 随本提交落地 · feat

**hub v129 联动批——论坛历史补录工具 + 培训群实验收尾**

- **实验结论（曼波拉机器人进「机械组27赛季梯队培训」群）**：群内已发小贴士全部在入群（22:53:39）之前，飞书硬限制机器人只能拉入群后的历史消息，**无法 API 补录**，需原发人重发（实时链路自动收录，v128 已在该群生效验证）；hub v129 新工具 `scripts/backfill-topic-from-history.js`（历史消息 API 补录 GLOBAL_TOPICS 特例帖子，落表与实时链路同款，--dry 支持）用于入群后缺口修复，限制成文 README §五+脚本头注释。
- **v127→v128 勘误残余收尾**：README×5/使用指南 MD/registry.js×2/桩测试注释随批修正。
- hub gitlink 随批锚定 v129（42b8169；v128 特例批 199ed7f + 勘误 c34707e）；registry.js/使用指南 MD 勘误同批入库。

## v149 · 2026-10-12 · 随本提交落地 · feat

**sop-site SOP 星球补 27 赛季文档集新内容批（sop.cquqianli.cn）**

- **背景**：章子赫飞书《27 赛季项目管理 SOP 建设文档集》（wiki `Wj7twLUQeiynbBk3DCuci7PBnTv`，今日更新）与 SOP 星球站点同源同树，逐项对照站点 `DEFAULT_NODES` 后补齐 5 处缺口。
- **五处补充**（全部为填空/新增，既有内容零改动）：工单系统、审批系统补链《27赛季工单审批制度》（`ETHxwSvg`）；值日系统补链《千里战队卫生值日管理制度》（`Aap2wtnw`，原 extraParents 跨链保留）；新增「兵种组 xx.xx 组会模板」节点（`Kjcjw4G8`，项目完整生命流程下、会议模板旁）；新增「27赛季战队管理责任人公示」ref-box 节点（`L4GQw3X2`，特别设备/消耗品管理条例下、原 person 公示看板旁——看板「负责人：张郭浩」公示文本保持原样）。
- **部署**：`deploy-sop-site.ps1` 一键（index.html 剥离编辑面板重生成）→ sop-site 仓 commit `e9c57b6`（16f887d..e9c57b6）→ GitHub Pages CI 白名单 dist → 线上验证 HTTP 200 且新节点 id/链接全部在站。本地部署产物渲染验收：52 节点 / 22 可跳转 / 1 负责人 / 51 连线，与数据层核算一致。
- **顶层联动**：本批锚定 `sop/site-sop-planet` gitlink 至 `e9c57b6`。

## v150 · 2026-10-13 · 随本提交落地 · feat

**hub v130 负责人群整合卡拆独立 10:00 定时——联动批（registry 同步）**

- 曼波需求：负责人群的「逾期+临期」汇总提前到 10 点。pm-robot（hub/knowledge-tracker）v130 已 `npm run push` 上线：`runLeaderBroadcast` 独立任务（`LEADER_CRON_SCHEDULE`，默认 `0 0 10 * * *`）先于 12:05 各群常规卡送达；双当日标记独立（拆分防互阻塞专项回归）；新增 `POST /api/bot/test-leader-broadcast` 手动补发；全 11 套桩测试绿；目标机实证 cron-status：leader 任务 running、下次 10/14 10:00。
- 顶层本批仅 `dashboard/registry.js` 联动（pm-robot 条目 role+notes：整合卡时刻描述改 10:00 独立定时）；桌面《机器人总成使用指南.html》同批改（工作区外，不进 git）。
- 本批随提交锚定 hub gitlink 至 `facdbb0`（pm-robot v130）；duty-bot gitlink 变更为并行会话产物，不卷入本批。

## v152 · 2026-10-14 · 随本提交落地 · feat

**bambu v53 双品牌纯内网批归档——闪铸局域网适配 + 状态观察台 + 文件分发品牌隔离（4A 拔线批）**

- 曼波令：4A 打印机路由器拔 wan 线转纯内网前，把打印机内网文件分发、显式可选 UI、状态观察 UI（画面/AMS/操作指令、拓竹+闪铸双品牌）全部做好。bambu-print-reservation v53 已 `npm run push` 上线（pm2 online、health ok、/status.html 200），15 套桩测试全绿。要点：①`src/printer/flashforge.js` 闪铸适配层（8898 REST 轮询+uploadGcode/printGcode 分发+jobCtl 控制+8080 MJPEG，serialNumber+checkCode 认证复用 .env 五件套）；②manager 品牌分派（brandOf/cameraKind）+dispatcher 文件格式↔品牌隔离（3mf→拓竹/gcode→闪铸，跨品牌匹配不可见）；③拓竹补腔灯 ledctrl+TCP6000 H.264 WS 中继（前端 WebCodecs 解码）；④`public/status.html` 状态观察台（机队卡片/双品牌画面/AMS 槽位盘/admin 指令条）+主网免路由代理端点；⑤v47 训练架构半成品与 v48~v52 修补随本批首次上线。详录 bambu DEVLOG v53。
- 联动：`.agents/skills/qianli-lab-network/SKILL.md` §九 补 4A 纯内网形态与闪铸协议档案；network 域 evt_013（踢线服务影响）/evt_014（纯内网批落地）；桌面《机器人总成使用指南.html》补观察台+双品牌条目（工作区外）。
- 本批锚定 bambu 目录（顶层普通目录，无 gitlink）至 v53 内容；hub（`ticket-pm/project-management-robot/server/.env` 子层）凭据在位未动。

## v153 · 2026-10-14 · 随本提交落地 · chore

**迁移基础设施批（曼波令：保证两机开发体验一致性）——顶层仓正名 + ticket-bot 转正 + 大脑记忆链路落地**

- **顶层仓正名**：GitHub 仓 `NepheLoudy/bambu-print-reservation` → **`NepheLoudy/qianli`**（gh repo rename，旧名自动重定向零断链；两机 origin 已更新）。此前全家桶宿在 bambu 旧仓名下属迁移过渡态。
- **ticket-bot 转正第 6 个子模块**（`88f3d98`）：此前双重身份（顶层普通目录+本地独立仓未注册，clone 后无 .git）；gitlink 锚 `61512b1`（v91）。台式机侧 pull 后残留目录挡接线，.env 先保出→重接→放回（零损失）。
- **大脑记忆链路落地**（AGENTS.md 记忆协议的基础设施件，此前 brain-sync.sh/大脑仓库均未实落）：①建私有仓 `NepheLoudy/qianli-brain`；②两机 `memory/` 入 git（笔记本首推 f4eae42，台式机 scp 整目录含 .git 接入）；③`brain-sync.sh`+`brain-sync.cmd`（cmd/双击入口自动定位 git-bash+切仓库根）进顶层仓分发；④`.gitattributes` 锁 `*.sh` LF；⑤台式机 winget 装 GitHub CLI+token 灌入（私有仓读写凭据）。双向同步实测闭环：台式机写探针→save→GitHub→笔记本 pull 收到→清理。
- **踩坑沉淀**：git-over-SSH 到 Windows cmd 默认 shell 的远端路径引号不通（scp-style 前导斜杠被拒）——整目录 scp 最省；裸 `bash.exe` 无 PATH（dirname 不可用）→ pwd 定位；`D:\` 盘符路径经 BASH_SOURCE 进 bash 落错目录 → cmd 包装器 `cd /d %~dp0` 绕开；WSL `System32\bash.exe` 抢 PATH → 包装器定位 git 自带 bash。
- 联动：两机私配对齐（凭据台账.local.md / campus-accounts.local.json 已补送台式机，仍不入 git）。

## v154 · 2026-10-14 · 随本提交落地 · fix

dashboard keepalive.vbs 双机路径探测批：保活脚本第 3 行原硬编码笔记本绝对路径（`C:\Users\0d00\Desktop\qianli\...`），台式机（qianli 在 `D:\dev\qianli`）计划任务每 10 分钟触发 WSH 报 80070002「系统找不到指定的文件」弹窗。改为 `Scripting.FileSystemObject.FileExists` 探测：台式机 `D:\dev\qianli` 优先，回退笔记本桌面路径——两机同版可用，运维台宿主移交后的保活链路双机对齐。实测台式机 cscript 触发无报错、端口守卫幂等跳过（3100 已监听不重复启动）、运维台在岗（127.0.0.1:3100）。踩坑沉淀：①计划任务传递的 vbs 含硬编码路径，跨机分发文件（tar 中文名丢件同批）必须探测或模板化；②vbs 修改后走 cscript //nologo 手动触发 + 独立 netstat 验证（管道 grep 计数退出码会骗 && 链，两次踩同一坑）。

## v154 · 2026-10-14 · 575d84a · fix

dashboard keepalive.vbs 双机路径探测批：保活脚本硬编码笔记本绝对路径（`C:\Users\0d00\...`），台式机计划任务每 10 分钟 WSH 80070002 弹窗（运维台宿主移交时 tar 传输文件，路径未本地化）。改 `Scripting.FileSystemObject.FileExists` 探测：台式机 `D:\dev\qianli` 优先、回退笔记本路径，两机同版。实测 cscript 触发零报错、端口守卫幂等、运维台 :3100 在岗。踩坑：tar 中文名长路径丢件同批（feishu-novel 8 文件由 git 对象恢复）；验证管道里 grep 计数/head 退出码会骗 && 链（两踩）。

## v155 · 2026-10-14 · 34af792 · fix

迁移后全量审查修复批（6 路只读审查产出，v154 时点）：**bambu v54**（4 P1：axis NOTE_OK 半成品/重置密码正则丢反斜杠/gcode 审批门未跟双品牌/载荷勾选联动断链；P2：_aid 发号/清会话真身/训练样本损坏隔离；测试 14 套全绿+gcode 审批断言锁）——e8f608d；**gateway v38**（connecting 恒挂兜底落地：死常量 WS_START_WATCHDOG_MS 本来语义实现，超 5 分钟自退交 pm2 重建；command 投递附共享 X-API-Token——approval 已挂鉴权裸转发 403；cors 死依赖清理）——cf2e12c；**duty-bot v55**（独立仓：隐私 dump .tmp-kaoqin-roster.json 清理三处+gitignore 补 .tmp-*（历史清洗待裁决）、README NAS 字样、ZKLink 模板 17 键、push.js PATH 精简、zklink 原子写，17 套全绿）——f4b1a4a；**hub v131**（独立仓：兜底策略补「确认全部已取」两处词形，11 套全绿）——7664ff0；**ticket-bot**（独立仓：DEVLOG 指针校正 v91+.env.example 补 ACCEPT_TRACE_FIELD）——8e14329；**netlog**（本机 .env 账号池路径改 D:/dev 种子；v19 补部署实际成功——pm2 online+health 全绿，push.js 末步健康检查连接被 sshd 频率保护 ECONNRESET 误报失败，人工 SSH 验证为准）；**approval-bot**（.env 补 OCR_FIELDS_FILE 到项目外；detached HEAD 归位 main）；**dashboard**（台式机 Startup 补开机自启 vbs）；顶层 AGENTS.md 使用指南 HTML 双机落点。未动待办：bambu /api/chat/command 鉴权需与 hub /print-* 两仓同批；duty git 历史清洗待裁决。测试总账：全群 9 组套件全绿。

## v156 · 2026-10-15 · 0ae4a37 · feat

**工单×项目管理联动批：DDL 播报新增「📨 已指派待确认」分栏（曼波需求：未接单/指定负责人未确认要次日曝光并引导完成）**

- **ticket-bot v92**（9eaa001）：`unclosedService` 拆分出第三类工单 `unconfirmed`——指定负责人公示即绑定后滞留「负责人确认消息后通过」超 24h 未确认（与确认追问同口径），此前该状态两头不进、DDL 完全不可见；`/api/tickets/unclosed-by-group` additive 扩展同名桶（assigneeName/elapsedHours/groups，面向组别直分、滞留降序、不计负载）；五套测试全绿（125 断言）。部署后 dry-run 实测已命中真实滞留单（202610130002，徐进，42h）。
- **pm-robot v132**（59dac78）：DDL 卡新增「📨 已指派待确认」分栏（负责人姓名/滞留时长，头部带确认引导「@工单机器人 发接单N / 私聊回接单」，只列名字不 @）；「🆘 无人接单」分栏头部补接单引导；降级直读链路同口径加桶（`TICKET_ASSIGN_*`/`TICKET_ASSIGN_NUDGE_HOURS` 可调，默认对齐 ticket-bot 现网）；新增 stub-test-ticket-buckets 14 断言，13 套全绿。
- 文档同批：两仓 README、ticket-pm/LOGIC-MAP（§1.6/§2.2）、ticket-pm/AGENTS.md 契约第 1 条（五桶口径+两仓同步义务）、桌面使用指南 HTML 双副本（台式机桌面+大脑仓库权威副本）。
- 部署：按联动顺序先 ticket-bot 后 pm-robot（knowledge-tracker），两进程 pm2 online + health 200 + 启动关键行全绿；push.js 末步「SSH 连接失败 read ECONNRESET」复现 v155 已定性误报（sshd 频率保护），人工 SSH 验证为准。本机备注：pm-robot 仓根 node_modules 缺 ssh2 致 push 首跑 MODULE_NOT_FOUND，`npm install` 后重推成功（推送机环境问题，非代码问题）；头部指针补正（v155 批漏更，本高频复发项第 5 次）。
- **v56 全量复查补记（同日）**：17 套 218 断言回归全绿；台式机→H2D 三通道（MQTT/FTPS/RTSPS）全 OPEN；生产 pm2 九进程 online、队列零滞留；H2D 夜间真实完成打印（plate_7.gcode 100%）；踢线实验持续安静。自审修复：观察台文件列表渲染假上下文致按钮假禁用（FLEET 全局缓存）。错误日志中「AMS 槽位必须是 0-3」为开发期坏参数探针留痕，非现场故障。
- **v56 现场热修（同日，曼波观察台实测暴露）**：画面「已断开」根因=5s 重渲染逐轮重建会话且旧 WS 不关——每 5s 泄漏一条 WS+RTSPS 会话，打满 LIVE555 会话额后新会话被拒。修复：活会话防重入 + 解码器画布动态寻址跨重渲染续画 + loadFleet 只复活死会话。部署机侧 rtsps 实测 1.1MB/4.3s 正常（服务端无恙，纯前端会话管理锅）；生产 WS 中继 E2E 实测 STREAM PASS（1.35MB/6s）。

## v157 · 2026-10-17 · 04efc29 · fix

**运维台 push 链路回归修复批（09-27 安全加固批遗留回库）+ 两处 gitlink 收编**

- **dashboard/server.js（本地运维台，不入部署）**：`runAction` 的 `path.join(ROOT, cwdRel)` 改 `path.resolve(ROOT, cwdRel)`——09-27 越界校验批把调用方 cwd 换成 `path.resolve` 绝对路径后，join 对盘符路径再拼一次前缀（`D:\dev\qianli\D:\dev\qianli\...`），运维台全部快捷指令（push/install/test）自那以后 ENOENT 全灭。resolve 对绝对路径原样返回、相对路径仍按 ROOT 解析；顺带校正 route 处陈旧注释（join→resolve 调用链表述）。修复后实测：经运维台 push 按钮链路完整推送 pm-robot v133——13 套桩测试全绿 → git commit/push → 部署目标 SFTP 直传 → .env 上传 → pm2 重启 + save，一条龙全通。
- **gitlink 收编**：approval-bot → `6b93efe`（v75——backfill 全链修复打通：枚举三硬伤/精确匹配/附件免登直链/回溯落表即时触发金额线）；ticket-pm/project-management-robot → `2e5b4d7`（v133——关键词回答表新增「嘉豪→蔡明铮」规则 1 条 + 补推 10-15 detached HEAD 遗漏的 v132；其 GitHub 远端此前静默停在一版之前，已快进补齐）。
- **排障备忘（防误判）**：①运维台动作日志末尾 `[结束] code=1` 为收尾 SSH 连接被目标机 sshd 频率保护掐断（ECONNRESET），实质步骤（提交/同步/.env/重启）均已完成，以人工 SSH 复核 pm2 与 /api/health 为准——v155/v156 已两次定性；②部署目标端 GitHub 拉取失败改走 SFTP 兜底为常态（小电脑够不着 GitHub），非本地推送失败。
- **文档同步**：qianli-deploy skill「已知坑速查」补一行——push 收尾 ECONNRESET/code=1 误报，人工复核为准（同备忘①，防第四次误判）。
- **不卷入**：duty-bot 工作区 zklink「两两配对」口径改动（10-15 曼波改定、未提交的并行产物）与其落后 origin 1 提交的状态保持原状，归其自有批次。
- 哈希回填：v156=`0ae4a37`。

## v158 · 2026-10-17 · 随本提交落地 · fix

**全量审查修复批（曼波令「全量审查并push」）——部署缺口回补 + 部署链 P1 修复 + 两层游离头收编**

- **部署态实证（不以进程 online 为准）**：以「版本特征串 + 文件 mtime」逐仓对照小电脑现网代码，抓到两类真实缺口——①**gateway 停在 2026-09-27（v34 时代）**：v35 代码收口、v36 连接键改名、v38 connecting 兜底/command token 从未上线（v37 纯 docs 按设计不部署）；本批上 **v39** 实证通过（目标机 src mtime 16:03、`WS_CONNECTING_GIVE_UP_MS` 特征串在、`/api/health` `ws:"running"`、消费者=hub/approval/ticket 三仓）。②**duty 的 v55 部署从未真正完成**（见下 P1）。其余仓按重启时刻+特征串核实在新版（approval v76、pm v133、ticket v92、bambu 热修26、netlog v19）。gateway v39 同时修复其自身 v38 引入的 `wsConnectingSince` 跨尝试不复位缺陷（connecting 兜底计时按「本次尝试」起算），并补 README/AGENTS 三仓口径与 cors 锁文件、冒烟起服竞态加固（轮询≤15s）。
- **P1（v55 引入，live 实锤）**：duty `push.js` 的 `export PATH=/c/Program Files/nodejs:…` 未加引号——路径含空格被 bash 劈开、export 报 `not a valid identifier`、npm 找不到，**部署在 npm install 步 exit 127**（15:55 运维台 push 的 32KB 动作日志全程实录：17 套测试闸门全绿 → 提交 → SFTP 落盘 → npm install 炸 → .env/重启未执行）。修复：PATH 值整体加引号；approval/netlog/ticket 同段写法核查无恙（仅 duty 中招）。**连带回放**：15:55 那次点击把当时工作区的 5 个 zklink 文件 commit 成「update: 运维台快捷部署」（未推 GitHub），本批 `reset --soft` 后统一收编为 **duty v56**（`68d7a11`，已推 GitHub + 部署实证：restart 0s、17 套全绿）。
- **duty v56（曼波 10-15 定口径）**：ZKLink 打卡时长「末卡−首卡」→**当日打卡顺序两两配对（1→2、3→4…）求和、落单卡不计**（leftover 标记；跨天不配对、孤条仍计 0）；CSV 加「落单卡」列（8→9 列）；卡面/云文档/口径行同步。文档联动同批：duty README 两处、`dashboard/registry.js` duty notes、本指南 §四 zklink 段、桌面 HTML（工作区外）——旧「末卡−首卡」表述清零。
- **两层游离头收编**：①ticket-bot v92（`9eaa001`，10-15 detached 提交）**从未进 GitHub**（远端停在 v91+docs `8e14329`，与 pm v132 同款事故）——重挂 main + 快进 + 推送补上（历史零改写）；②sop/site-sop-planet、tools/rm-battlescope 两个子模块游离头重挂 main（同点重挂，内容零变化）。
- **gitlink 收编**：approval-bot → `564d366`（v77——识别链全票覆盖；本批 staging 窗口内并行会话连推 v76→v77，锚点实录即当时最新；**v157 勘误**：该批实录为 `3d63cee`＝v76，与并行会话竞速于 v75→v76 之间抓拍，条目所称 6b93efe 从未被顶层锚定）；ticket-pm/project-management-robot → `8632b21`（15:32 运维台快捷部署产生的关键词表数据提交，已部署未推 GitHub——本批补推；其工作区另有一版 xlsx 视图状态噪音：仅 activeCell/窗口几何变化、sheet 内容零变化，**未提交未覆盖**，待曼波确认）。
- **时钟事故（记录在案）**：本机系统时钟在 15:5x 前慢了约 13 小时（显示 02:5x 实为 15:5x），期间产生的 mtime/日志时间戳需按绝对 epoch 解读；已自动校回（GitHub Date 头锚定）。此前「凌晨」类判断作废；两机当前时钟一致。
- 测试总账：gateway 三桩+冒烟全绿、duty 17 套全绿；其余仓本轮无改动。
- 哈希回填：v157=`04efc29`。

## v159 · 2026-10-30 · 随本提交落地 · feat

**运维台印刷品 UI 重置 + 人机工效迭代 + 四仓全量审查修复批联动**

- **运维台 UI 重置（曼波令，参照 bambu v58 印刷品风格，bambu 侧零改动）**：index.html style 块整体重写为同源设计系统——衬线字体/1px 硬边框/无圆角/亮色品牌粉 #ed2174 ↔ 暗色荧光绿 #5cfc90 双主题/大字距眉题/印刷表格；class 名与 id 全部保留，业务 JS 零改动；主题切换胶囊 localStorage 键 qli-theme 与打印预约台共享（全站联动）；head 预置脚本防闪，无存储默认暗。旧 CSS 变量名（--txt/--dim/--err 等）作为别名映射保留，内联 style 的 var() 引用不受影响。补 `color-scheme` 声明（亮/暗各一）——浏览器正确渲染滚动条/表单控件并关掉强制暗化误判。browser 双主题三屏截图验收（首屏/状态矩阵/团队负载榜/网络拓扑树）全过。
- **人机工效迭代**：停用整张回答表加确认（影响线上自动回答）；值日管辖群在线改写保存前列出变更内容确认（即时生效影响 hub 群闸门）；页面隐藏（document.hidden）暂停全部五路轮询、回前台立即刷一轮。
- **运维台 P1 修复 · netlog 复活按钮 401**：定制中心 /api/deploy/api 统一附全局 API_TOKEN，而 netlog 校验独立键 NETLOG_API_TOKEN（实测两值不等）——registry 窗口条目支持声明 tokenKey，server 按目标项目 .env 取键（白名单字符校验+读不到回落全局），前端 deployApi 透传。stopLocal 的 taskkill 结果接进进程日志（此前失败无声 UI 恒显示已停）。
- **registry 补登三处**：duty quickAction 测试数 13→20 套（zklink 系列扩容后漂移）；ticket windows 补 GET /api/tickets/unclosed-by-group（两仓联动契约端点漏登记）；hub permissions 补 /print-bind、/print-pickup 私聊豁免两条（v135/v136 文档欠账）。
- **四仓全量审查修复批（四个只读子代理分仓审查 + 主会话修复，各自 DEVLOG 详录）**：ticket-bot v93 播报卡消毒（hub 修了下游没修源头的跨仓缺口）+ pm v137 消毒一致性/关键词防互答/文档同步 + approval v90 form_alert_live 冲刷注册（P1）/回执诚实性/台账白名单/时区统一/消毒补网/.env.example 补 17 键 + gateway v40 统计落盘原子写/日桶钉东八区/health 透出 SDK 真实态。全部桩测试全绿（新增 stub-test-card-sanitize 11 断言、stub-test-form-alert-live 4 断言、keyword-post 补断言）。
- 审查遗留待确认清单见各仓 DEVLOG（approval 静默重跑 7 次/gateway reconnecting 行为面/pm 宽口径 @判定 等——均按「不揣测设计意图」原则记录两种读法，未擅动）。

### v160 · 2026-11-03 · 随本提交落地 · fix

**ticket-bot v94 对账卡死 48.8h 事故修复批联动（顶层同步 LOGIC-MAP）**

- **事故**：11-01 00:04 实验室网络故障窗口内，ticket-bot 一轮播报对账的出站请求永久悬挂，互斥标志 reconcileRunning 恒 true，每分钟兜底对账停摆 48.8h；同窗口网关长连接反复断连，曼波 11-01 18:17 提的宣运组工单（reczz28UVdw6cZmI）create 事件被吞——事件路径+对账兜底双通道全灭，工单不播报。11-03 排障定位后手动 /api/bot/reconcile 补播成功 + restart 清场恢复。
- **ticket-bot v94 修复**（63c832c，详见该仓 DEVLOG）：client.js token fetch 补 AbortSignal.timeout(15s)（出站 fetch 无界清零）+ 新增 utils/taskGate.js 互斥看门狗闸门（单轮悬挂超阈值强制复位放行 + 令牌防误复位）五定时任务全接入 + stub-test-task-gate 6 断言全量 8 套绿；v93 批的 bot.js sanitize 与 webhook signal 此前未部署成功，随本批补落地现网（md5 已核对一致）。
- 顶层 ticket-pm/LOGIC-MAP.md §1.4 补「互斥闸门+看门狗」段；本条为顶层联动归档。

### v161 · 2026-11-03 · 随本提交落地 · fix

**bambu v59→v83 批量会话遗留归档 + 全量审查修复批（bambu v83）联动——24 版积压入库，37 套测试全绿**

- **归档主体**：bambu-print-reservation v59~v82 共 24 版（均已 SFTP 上线但从未入库，v160 批声明遗留）随本提交全部归档——机队悬浮坞（v59）/印刷品 UI 重构（v58 风格系）/viz「工程图纸」组件库（v64）/参数智能层 kNN+岭回归（v60）→MLP 化（v61）/全量审查修复批（v62）/平台使用手册（v63）/多模型批量上传+几何指纹自动配对（v76）/预约单多源全链适配（v80）等。
- **v83 全量审查修复批**（曼波令「全量审查+debug 修复一块提交」）：三域（训练ML/前端/核心服务）并行子代理审查×双源交叉验证（hy3-verifier+deepseek cross-check），32 项发现 31 证实（1 项推翻、1 项两验各对一半），修复 P0×1/P1×11/P2×18——带孔件 DNA 必炸（v68 起坏）/多模型配对排列爆栈+贪心泄漏/多源入库回填断链/切片签名死零/3mf 实例化丢件/PCA 混维 NaN/热力图 UTC+8 错位/放弃坞 404/工程件闸门 catch 旁路等；新增 geometry-dna-test + 7 条回归断言，37 套全绿。逐条详录见 bambu DEVLOG v83。
- **文档收尾**：bambu DEVLOG 头部指针 v64→v83 补正（漂移 19 版，高频复发项再现）+ v58/v59 锚点哈希回填（ee34bda/39fc504）；USER-GUIDE.md 补一盘多件多选口径（§2/§5）；registry bambu 段补参数智能层与训练端点登记；桌面《机器人总成使用指南.html》核对无需同步（本批无指令/播报/卡片变化，OBJ 打回不涉及指南既有陈述）。
- **会话遗留清理**：`.ref-site.html`/`.ref-styles.css`（v58 UI 对齐用战队官网参考快照，使命完成）与 `scripts/fix-viz.tmp.js`（v81 一次性修图脚本）删除。
