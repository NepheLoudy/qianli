# qianli 项目群 · 飞书机器人架构铁律

**除工单接单监听外，所有对话逻辑都由对话型机器人触发**（爆米花机-对话型 / knowledge-tracker / hub）。

- 消息事件统一经 feishu-gateway（唯一长连接）→ 对话型机器人（hub）判断分发；
- 对话型机器人把业务指令转发给专项服务的 `POST /api/chat/command`
  （/approval-* → approval-bot :3002，/print-* → bambu :3001）；
- **唯一例外**：工单域（@机器人+「接单」的接单确认、/ticket-* 指令）由 ticket-bot 处理；
- 专项机器人**不得**自行消费消息事件、直接回复对话，也不要在网关为它们加消息直连路由；
- 各机器人自己的**定时播报**（webhook）不受此限制。

详细规则与踩坑记录见 skill：`.agents/skills/qianli-chat-architecture/SKILL.md`
（涉及消息路由、@识别、指令转发的改动，先读它）。

# 晚间静默（播报时段限制）

**02:00–09:00（Asia/Shanghai，`[START, END)` 可配 `QUIET_HOURS_START/END`，`QUIET_HOURS_DISABLED=1` 关闭）窗口内，所有机器人的定时/自动播报不直接发送，统一积压到 09:00 整点补发**。duty-bot / ticket-bot / project-management-robot / approval-bot / bambu-print-reservation 五仓各自实现，通用模块为各仓 `src/utils/quietHours.js`（积压持久化 `.quiet-backlog.json`，重启不丢，启动过点即补冲刷）。

- **挤压要为挤压之后的事情负责**：可重扫任务（周报/DDL 播报/每日汇总等）冲刷时重跑整个任务函数，以补发时刻最新数据重查——夜里已了结的事不再播，标记/节流/轮次等时点逻辑以实际发送时刻为准；每小时整点重扫类（ticket-bot 超时/结单/追问）静默内整轮跳过，09:00 整点轮次天然就是冲刷；一次性事件通知（打印生命周期卡、多人单结束通告等）原样落盘载荷按序补发，业务动作（打印机控制/写表/审批通过）不延迟；
- **不受限**：对话/指令回复（接单确认等交互回路）与人工当下主动触发（/test-*、手动补播单条等）；
- 改动播报时机、新增播报点时必须过该闸门（新增定时播报接 `gateTask`，事件通知接 `gatePayload`），并把窗口行为写进对应 LOGIC-MAP/README。

# 运行时数据保护（删除前询问铁律）

**NAS/本机运行时的用户数据是生命资产：任何清空、删除、覆盖之前必须先备份并向用户确认，禁止静默覆盖。**（「NAS」为历史称呼：2026-09-14 起部署目标=小电脑 DESKTOP-FE1MIGI；部署连接键=各仓 `.env` 的 `DEPLOY_*`（2026-10-07 由 `NAS_*` 改名），见职能总表末的「部署目标」条）

- **界定**：权威编辑路径在小电脑（DESKTOP-FE1MIGI）侧或表格 UI、而本地只有副本/种子的文件与数据——duty-bot `config/members.json`、`config/whitelist.json`（运维台白名单/名册窗口经部署目标 SSH 直写，现=小电脑），hub `autoReplies*.local.json`（定制窗口直写部署目标），各仓静默积压/状态文件（`QUIET_BACKLOG_FILE`、`DUTY_STATE_FILE` 等，已挪项目外），以及多维表格业务数据；
- **对脚本（已落地）**：duty-bot / hub 的 push.js 上传私有配置前 ①把现网版本备份到项目外数据目录（NAS 时期为 `/home/qianli/<proj>-data/backup/`，小电脑侧对应目录待核实补记）②本地条目数少于现网时跳过上传并大声告警（`PUSH_FORCE_PRIVATE=1` 才允许覆盖，跳过时自动把现网内容回填本地消除种子落差）；其余项目如新增同类"本地种子 → 部署目标覆盖"上传，必须照此模式加守卫；
- **对 agent 会话（ZCode/TRAE 等）**：凡涉及删除、清空、重置、重写上述文件或表格数据的改动，动手前列出影响面**征询用户**；「先删后建」「顺手清理」「重新生成会覆盖旧文件」一律不允许不打招呼；
- **事故记录**（历史，当时目标机=旧 NAS 10.253.33.233，保持原貌）：2026-09-12 duty-bot v9 推送用本地空 `whitelist.json` 覆盖 NAS 侧用户编辑的 18 人值日排除名单（日志只记条数、文件不进 git、NAS 无快照，**不可恢复**，仅存 4 个无效名：Peiyu Wang/粟宇/Aouk/郑元斌）——本节由此设立；同批已在 duty-bot / hub push.js 落地备份+守卫。

# 机器人项目看板（多维表格）数据联动

**「机器人项目看板」（app_token `ZlVZbXDkRayUzSsFRiycznmZn5b`）是跨机器人的量化数据底座**，动态广场看板（仪表盘）与其联动表都在这里：

- **动态广场**（`tbld1zHXkTzko20p`）：**2026-09-20 用户拍板——动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责**。各仓 `src/services/plaza.js` 已加 `PLAZA_ENABLED` 停写开关（默认关，设 `1` 才恢复机器人写入），事件钩子代码保留、fire-and-forget 语义不变；「动态广场」表现不在 base（回收站），恢复/重建与后续维护都是用户操作，机器人不参与、也不得在无开关的情况下写入。表在回收站期间的 TableIdNotFound warn 已随停写终结。（历史写入约定备查：统一走 plaza.js，hub/ticket-bot/bambu 为 `bitableApi.createRecord`，duty-bot 走 requestAPI；失败仅 warn 绝不阻塞主流程；新增事件类型先改建表脚本再加钩子。）
- **网关日活跃**（唯一活跃表；**口径=机器人交互**：显式路由命中/私聊/@机器人，群内未 @ 闲聊不计）：gateway `src/bitable-sync.js` 每 30 分钟按日期签名 upsert（数据没变不写表），`POST /api/usage-sync/run?force=1` 手动补数（管理端点，需 `X-API-Token` 头，token 在 gateway `.env`）；「网关功能使用/网关队员活跃」两表已下线（2026-09-13 用户拍板监听只留机器人交互强相关，建表脚本同步移除，勿重建）；注意区分：运维台「队员活跃」看板为**正经使用口径**（抽奖/关键词回答等娱乐不计入，2026-09-22，见全局工程规则），本表与 `/api/usage` 的 `activeUsers` 仍为交互全量口径；
- **建表/改表**：一律改 `duty-bot/scripts/create-plaza-tables.js`（幂等，可重复执行；主键改名走 **PUT**——飞书更新字段接口不是 PATCH），禁止手改线上表结构不同步脚本；
- **仪表盘**：图表无法用开放 API 创建，搭建/调整按顶层《动态广场看板搭建指南.md》逐图表点选；既有业务表（工单系统/项目表/值日看板/tbl_keyword）可直接作为图表数据源；
- **铁律澄清**：机器人写多维表格属于**自身业务的数据落盘**（同 duty-bot 写值日表先例），不构成"消费消息事件"，不受对话铁律限制；但定时写表如属播报性质（未来若有）仍须过晚间静默闸门。

# 机器人后端定制窗口（附属窗口）规则

每个机器人后端必须把**定制类配置**（白名单/管辖范畴/权限人/群范围/回答表等）以 HTTP 窗口暴露，禁止只藏在代码或 `.env` 里：

- **读窗口**：`GET /api/<域>/policy` 输出定制项全景只读；细分资源另有独立窗口；
- **写窗口**：可安全热改的项提供 POST（增删即时生效、不重启）；
- **管辖/权限口径的权威在各自机器人后端**，消费方短缓存 + 断联兜底（范例：hub 消费 duty-bot `GET /api/duty/policy`）；
- **名册类**优先自动读飞书通讯录（open_id 直取组织架构），手工名册/绑定只作兜底（范例：duty-bot `syncFromContacts`）；
- 新增定制项：先加窗口，再同步 `dashboard/registry.js` 登记与本文档；
- 现状（2026-09-12 全量 debug 批后五仓齐全；gateway 为纯路由层、无定制项，不设窗口）——duty-bot（`/api/duty/policy`、`/api/duty/roster`、`/api/duty/whitelist`、`/api/attendance/policy` 打卡周报全景 + `/api/attendance/members` 打卡名单增删）、hub（`/api/hub/policy` + 关键词回答表 CRUD `/api/autoreplies/rules*` + 抽奖配置 CRUD `/api/lottery/rules*`，写 `.local.json` 即时生效，push 会用本地 xlsx 版覆盖）、approval-bot（`/api/approval/policy` + OCR 字段规则 `/api/ocr/fields`，只读+热改）、ticket-bot（`/api/tickets/policy`，只读）、bambu（`/api/print/policy`、`/api/print/colors` 颜色字典，只读）；（2026-10-12 追记：wecom-attendance-bot 项目废止清理，原其名下的 `/api/attendance/policy`+`/api/attendance/members` 窗口随项目移除，打卡类窗口现仅 duty-bot ZKLink 口径）
- **界面**：本地运维台「🧰 定制中心」（registry `windows` 清单 + `/api/deploy/api` SSH 代理直达部署目标本机接口，2026-10-07 由 `/api/nas/api` 改名）——白名单增删、名册刷新、各域 policy 全景查看、关键词回答表可视化编辑（增删改/启停/切表）都在运维台点选完成。

# 开发日志（DEVLOG）——每次 push 记一版

每个项目（含 qianli 顶层工作区）根目录维护 `DEVLOG.md` 开发历史，**版本隔离单位 = 一次 `npm run push`（即一次 git 提交 + 一次部署）**。

- 任何一次 push（feat / fix / docs / chore 都算）完成时，必须在本项目 `DEVLOG.md` **文末追加**一节：
  `## vN · YYYY-MM-DD · <提交哈希> · <类型>`，正文为提交说明原文 + 本次实际改动要点（改了什么、影响面、踩坑）；
- vN 只增不复用；revert/回滚也是一次 push，照常记 vN 并注明回退对象；merge 提交不单独占版本号（并入相邻条目说明）；
- 「随本提交落地」的占位哈希由**下一次** push 顺手回填实际哈希（各仓惯例）；纯哈希回填的 docs 提交本身不另占版本号（既成惯例，2026-09-12 复核确认）；
- 历史上个别版本号曾复用（duty-bot v8、hub v62、ticket-bot v50 各出现两次；2026-11-22 git 体检批新登记：bambu v50/v84、顶层 v77/v103/v154 亦各两次）：以提交哈希为准区分，**不追溯改号**（改号会破坏哈希锚点与外部引用）；
- 多项目同批联动改动：各项目 DEVLOG 各记一条，顶层 `DEVLOG.md` 另记一条联动摘要；
- 新条目一律追加在文件末尾（最新在最下），历史条目不改写；
- bambu-print-reservation 的 push 无 git 步骤（纯 SFTP），版本锚点取顶层仓库中该路径的归档提交；
- 历史起点：各仓库 v1~vN 已于 2026-09-04 按提交历史回溯编号完毕，后续从当前最新版本续增。

# 全局工程规则（2026-09-13 深度审查批成文）

- **管理/写端点必须鉴权**：任何机器人新增 POST/写操作 HTTP 端点（改配置、触发动作类）必须挂 `X-API-Token` 鉴权中间件（模板：`feishu-gateway/src/auth.js`，timingSafeEqual + fail-closed——token 未配置端点整体锁定）；token 存各仓 `.env`（不进 git）。只读 GET 与健康检查不受限。
- **DEVLOG 头部指针随批维护**：每次 push 除文末追加条目外，必须同步更新本仓 DEVLOG 头部「当前最新」指针（含锚点哈希）——已三次发生指针滞后漂移（v12 前网关、hub v67、gateway v18/v20、顶层 v57-60），属高频复发项。
- **行为改动必须过桩测试**：改动任何业务逻辑（非纯 docs）后、push 之前，必须跑本仓全部 stub 测试并全过（各仓 README「测试」节有清单）；新增行为必须带新断言——只靠人眼审查已两次漏过回归（日期敏感断言、收口幂等）。
- **队员/功能统计上报规则**：新增面向成员的交互能力（指令/关键词/确认/卡片响应）时，必须在服务命中点向网关 `POST /api/usage/report`（X-API-Token）上报 `{openId, feature}`，让队员活跃/功能统计自动覆盖新功能——网关路由层只看得见 @/私聊/显式路由，hub 内部命中的功能（关键词回答、DDL 确认等）靠上报归因（hub `usageReport.js` 为范例）。
- **队员活跃口径=正经使用，娱乐功能不计入（2026-09-22）**：抽奖、关键词回答等娱乐类功能**不算队员活跃**（运维台「队员活跃」看板与总览「近24h活跃」KPI 均按正经口径展示），只进「功能使用分布」；网关日活跃多维表格口径不变（机器人交互全量）。实现：①上报娱乐命中必须带 `fun: true`；②抽奖（动态 `/触发词`，路由层会记成正经指令）另带 `learn: 触发词数组`，网关归一化为 `/触发词` 学进娱乐清单，连同静态清单（`feishu-gateway/src/usage.js` 的 `STATIC_FUN_FEATURES`：抽奖/关键词回答//lottery）持久化；③新增娱乐类功能时上报带 fun 标记 + 静态清单补一行；按人功能归因（日桶 `users[id].f`）是剔除依据，旧数据（无 f）按全量正经处理不回溯剔除。stub 断言：gateway `stub-test-usage-serious.js`、hub `stub-test-duty-branch.js` 统计上报三断言。
- **会话遗留改动回库与文档补链**：agent 会话产生的改动若未随当次 `npm push` 入库（运维台/脚本类纯本地工具、调试插桩、会话被打断等，如 2026-09-13 dashboard 开机自启 bat+README），**下一个** agent 开发会话在 `npm push`（或任何 git 提交）前必须先 `git status` 盘点工作区遗留：①合理的遗留改动并入本批提交、照常记 DEVLOG，不许长期漂在未提交状态；②纯调试残留先向用户说明再清理；③逐项核对这批改动牵出的文档义务——本仓 DEVLOG（文末条目+头部指针）、AGENTS.md 规则成文、README/LOGIC-MAP、`dashboard/registry.js` 登记、用户侧《机器人总成使用指南.html》——欠哪些同批补齐，禁止「代码入库、文档跨批悬空」。

# 项目职能划分总表（防需求发错会话）

每个项目目录有自己的 `AGENTS.md` 边界声明；各会话收到需求先对号入座，**发现发错立即提醒并停止开发**。
**ticket-bot 与 project-management-robot 已归拢到 `ticket-pm/`**（工单+对话枢纽/项目管理联动开发区，该目录有自己的 `AGENTS.md`，内含两项目联动契约）；两项目的 git、push、DEVLOG 版本仍**各自分立**，没有整目录部署；approval-bot、feishu-gateway、bambu-print-reservation 仍在本仓库根目录。

| 项目（会话） | 职能 | 归属信号（需求关键词） |
| --- | --- | --- |
| ticket-bot | 工单域：播报到组别群、@接单确认、搬运看板、结单提醒、未结单按负责人组别分桶 API | 工单、接单、结单、面向组别、指定/补充负责人 |
| approval-bot | 财务审批域：审批群 `/approval-*`、催办周报（发票/报销单/转账）、每日待审批提醒 | 审批、发票、报销、转账、财务、采购 |
| project-management-robot | 对话枢纽+项目管理：各群 @对话与指令分发、关键词、抽奖（一个工作表=一个指令=一个奖池，2026-09-14）、DDL 播报与逾期确认、会议提醒、项目表 | DDL、逾期、项目表、对话、关键词、抽奖（/指令）、会议、语录 |
| bambu-print-reservation | 打印预约域：`/print-*`、预约审批、打印机控制 | 打印、预约、打印机、Bambu |
| duty-bot | 值日域：排班生成与轮转/缺勤补偿、值日私信提醒与收口、照片凭证写表、值日助手（私信说明/群看板）、值日数据接口、快递助手（登记窗口/未取播报/取件确认）、ZKLink 打卡时长周报（v48 归并：每周统计打卡时长→值日群 webhook+云文档留档） | 值日、排班表、轮岗、值日请假、总负责/工位区/装配区、值日照片凭证、值日看板、昨日值日播报、快递、取件码、未取/已取、打卡机、ZKLink、打卡时长 |
| feishu-gateway | 事件接入层：唯一长连接、消息路由规则、表格事件广播、消费者登记 | 事件被抢、指令没到、@无响应（跨项目）、接入新机器人 |
| ~~wecom-attendance-bot~~（2026-10-12 曼波拍板废止，项目已删除） | 企业微信考勤域（历史）：负责人群每周播报考勤打卡数据 | 相关新需求 → ZKLink 打卡时长归 duty-bot；企微考勤机数据类需求先与曼波确认去向 |
| netlog | 网络层监测域（2026-09-27 v1 上线，pm2 `qianli-netlog` :3016）：主路由/校园网出口持续探测落盘、断网复活引擎（账号池×Dr.COM eportal :801×慢速降级×月度弃用）、事件分级通知（机器人本体私聊，恢复后汇总卡补发）；v15/v16 检测细化：wan 双源 DoH AND 三态（ok/restricted/down）、routerWatch 低频观测主路由（管理面/射频/DHCP 探测/设备数旁证）、探针矩阵；v17 探针勘误（2026-10-07）：DHCP 3 秒慢应答=RD08 陌生设备检查机制非故障，探针改固定 MAC+5s 超时，dhcp_down 报警=服务真挂可信；v18 被抢持续垫底（同日）：复活成功 30min 内又掉线=账号被抢，持久垫底 24h 跨轮跨重启避开、到期自动复位——「首选只是优先不是拉锯」（曼波定）；主路由无线半死类救场=周二 04:03 定时重启（小电脑 schtask） | 断网、网络日志、探针、复活引擎、出口 IP、eportal 重认证 |
| qianli 顶层 | 跨项目：部署链路 push.js、架构、工作区整理、多项目联调 | 部署、推送、架构、整理 |

**易混裁定**：
- DDL 卡片"未结单工单分栏"的**数据口径/负责人取值** → ticket-bot；分栏**展示样式/卡片其它栏** → project-management-robot；
- "播报对象/@谁" → 看哪张卡：工单播报卡 → ticket-bot，DDL 卡 → project-management-robot，催办周报 → approval-bot；
- "指令时灵时不灵/@没反应" → 先查 feishu-gateway（连接/路由/消费者），再查业务机器人；
- 工单审批联动：**接单→审批任务自动通过、审批人白名单、审批节点配置、24h 追问** → ticket-bot；**审批群指令、催办周报、催发票私聊、审批实例链接** → approval-bot；
- 工单×项目管理联动：DDL 分栏取数是 pm-robot 调 ticket-bot 的 HTTP API（`unclosed-by-group`），改出入参两边同批；两项目同住 `ticket-pm/`，联动契约见 `ticket-pm/AGENTS.md`；
- approval_instance / approval_task 审批事件"收不到/重复" → 先查 feishu-gateway 的 EVENT_TYPES 订阅与消费者登记（同"指令时灵时不灵"规则）；
- 值日域需求（排班/轮岗/值日请假/值日照片/值日看板）→ duty-bot；「昨日值日播报」已落地为 duty-bot 自身看板卡的「昨日战报」段（12:00 与手动看板同卡，值日群播报；原 pm-robot 方案作废，hub 的 `DUTY_WEBHOOK_URL`/`DUTY_BROADCAST_SCHEDULE` 降级为预留未接线键）；**请假当日补位**（从较远排班抽调，duty-bot v15 起）同为 duty-bot 域；
- 值日专用群（快递申领群）：hub 基础指令关闭，看板「值日助手」**仅 @ 或私聊触发**（未@不出看板）；关键词回答全群统一（未@也生效，不再经值日策略放行，2026-09-13）。**管辖范畴/生效范畴以 duty-bot `GET /api/duty/policy` 下发为准，群变更只改 duty-bot `.env` 的 `DUTY_GROUP_CHAT_IDS`**（hub 的 `DUTY_CHAT_ID` 仅失联兜底）；**快递助手（2026-09-17 起）同为 duty-bot 域**：「/快递」开 5 分钟登记窗口、每小时整点未取播报（过静默闸门）、「已取n/全部已取」确认写「机器人项目看板」base 的「快递」表——窗口内**非@**登记素材由 hub 观察转发（`maybeForwardExpressObserve`）收集，duty-bot 仍不消费消息事件；词形放行清单（groupCommands/p2pCommandPatterns）由 duty policy 下发、hub 消费；
- 各机器人权能/指令/监听/权限全景与端口：看 `dashboard/registry.js`（单一事实来源，改权能须同步）与本地运维台；
- **部署目标（2026-09-14 起从旧 NAS 10.253.33.233:8500 迁移）＝小电脑 DESKTOP-FE1MIGI（192.168.31.57，SSH 22，用户 mechax，Windows + PortableGit + pm2，ssh 默认 shell = git-bash）**。部署连接键为 `DEPLOY_HOST/DEPLOY_PORT/DEPLOY_USER/DEPLOY_PASSWORD`（各仓 `.env`），运维台代理端点为 `/api/deploy/*`——**2026-10-07 曼波定，由历史 `NAS_*`、`/api/nas/*` 全面改名**，代码与活性文档中不再出现 NAS 命名；历史 DEVLOG/事故记录里的「NAS」字样为迁移前旧称，保持原貌、读时注意区分。旧 NAS（qianli-NAS，192.168.31.153:2222）=纯存储备件：2026-10-07 实测探查机器人零在跑（pm2 空、`pm2-qianli` disabled、docker 空），残留的两条 cron（campus-keepalive / snapshot-data）已注释停用（原样备份在其 `/home/qianli/backups/crontab.bak-20261007`），登录密码与主路由/裁判路由器同族（曼波持有）。
- 部署一律 `npm run push`（见 `.agents/skills/qianli-deploy/SKILL.md`），部署失败排查放顶层会话。

# 用户侧总指南（桌面 HTML）——同步义务

面向全体成员的《机器人总成使用指南.html》放桌面（**按机落点：笔记本 `C:\Users\0d00\Desktop\`，台式机 `C:\Users\nebula\Desktop\`**——权威副本随大脑仓库 `docs/qianli/`，两机桌面副本改动后须回灌权威副本，工作区外、不进 git）。**机器人的职能、指令、播报时刻、卡片样式、联动、看板/面板发生用户可感知的改动时，必须同批把变化同步进该 HTML**（保持"面向成员"口吻；DEVLOG/部署/registry 登记等维护者流程不搬进去）。工作区根目录《机器人总成使用指南.md》是维护者手册：HTML 给用户、MD 给维护；事实口径权威仍是 `dashboard/registry.js` 与各仓 README/LOGIC-MAP。

# 顶层非项目目录（勿与现役项目混淆）

- `archive/`：历史归档。`archive/project-configs/` 存有 approval-bot / bambu-print-server / knowledge-tracker 的旧 `.env` 备份（**已退出 git 跟踪，仅本地与历史提交留存；历史提交中的密钥应视为已泄露、待轮换**；勿把新配置备份进去）；`widget-*.json` 是旧小组件配置存档。
- `tools/`：与飞书机器人业务无关的独立工具（`rm-battlescope` 为 RoboMaster 赛事数据分析工具，自带 README 与依赖）。
- `dashboard/`：本地运维台（仅本机 `127.0.0.1:3100`，不部署）：全机器人端口职能/权限/指令/服务状态/日志/更新可视化、本地测试进程启停、npm push 快捷指令；部署目标凭据直读 approval-bot/.env（现指向小电脑 DESKTOP-FE1MIGI 192.168.31.57:22），不入库。
- `sop/`：SOP 静态页（`site-sop-planet` 带 Windows 一键部署脚本；`sop-misc` 为散页 HTML）。需求落在这些目录时先与用户确认再动。
