# DEVLOG · bambu-print-reservation（拓竹 3D 打印预约机器人）

版本隔离单位：一次 `npm run push`（= 一次部署）。本项目 push.js 为纯 SFTP 直传、无 git 步骤，**版本锚点取顶层 monorepo 中触碰本路径的归档提交**——两次归档之间的个别部署可能无版本记录。v1~v14 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v57**（2026-10-16，真单系列热修共 22 批：真单卡滞修复/清残留状态验证链/方案B 残留放行/人工取消不重发/RUNNING 态收录/喷嘴温度打包解码与左右实证/双机接入（X1C+闪铸A5P）/放置平面 Place on Face/直通单机型全链（内嵌机型权威+指定钉死）/通知分流重整/3mf 几何特征估计链/画面显式连接/多耗材 3mf 逐条栏位全链/双新机观察台按钮（X1C 灯节点+闪铸 cmd/args 信封+摄像头开流）/回执丢失自愈（超时状态验证+队列对账），测试 229 项全绿）。上一版 v56（2026-10-15，设备化观察台+预约页重构批，测试 17 套全绿）。更早版本见下文历史条目。

## 阶段五 · 审批事件字段对齐与分发健壮化（2026-09-05）

### v16 · 2026-09-05 · 顶层归档 `5efc0ca` · feat
**审批事件字段对齐官方接口 + remainingMinutes 单位修正 + 分发重试上限与冷却（SFTP 已上线）**
- `approvalService.js`：事件/实例详情字段对齐官方响应——`instance_code`（原 instance_id）、`approval_code`、申请人取 `open_id`；`parseForm` 兼容「表单控件 JSON 字符串」形态；终态扩充 `REVERTED`（通过后撤销）/`OVERTIME_CLOSE`（超时关闭），均移出队列。
- `printer/client.js`/`manager.js`/`chatService.js`：`remainingTime → remainingMinutes`——mc_remaining_time 单位本就是分钟，修掉误除 60 导致的剩余时间显示错误。
- `dispatcher.js`：分发失败重试上限（`DISPATCH_MAX_RETRIES=3`，超过退出队列转人工）+ 冷却期（`DISPATCH_RETRY_COOLDOWN_MS=60s`，冷却中不参与匹配），修掉缺附件等确定性失败导致的匹配死循环刷屏。
- `index.js`：`express.json` 放宽 2mb；`/api/printers/available` 移到 `/api/printers/:id` 之前修路由遮蔽；`config.js` 增补两个分发重试环境变量。
- 本批经 push.js 纯 SFTP 部署上线，锚点为顶层归档提交 `5efc0ca`。

## 阶段四 · 开发历史建档与审批联调收尾（2026-09-04）

### v15 · 2026-09-04 · 顶层归档 `37a59aa` · feat
**审批联动联调后续改动随顶层归档上线（SFTP 直传，push.js 无 git 步骤）**
- `src/config.js`、`src/feishu/client.js`、`src/feishu/eventSubscription.js`、`src/index.js`、`src/services/approvalService.js` 五文件的审批联动收尾改动随 SFTP 部署上线；顶层 monorepo 同批归档（`37a59aa`）。
- 同批新建本 DEVLOG（v1~v14 回溯编号，规则见顶层 AGENTS.md）。

## 阶段一 · 独立项目时期（2026-07-15 ~ 07-21）

> 这一时期本仓库（顶层 monorepo 的前身）就是 bambu 项目本身，文件在仓库根目录。

### v1 · 2026-07-15 · `38375b3` · init
**feat: 初始化拓竹3D打印预约系统**
- 首提骨架：feishu 四件套 + printer（client/manager）+ chat/reservation service。（同刻 `c5d83db` 为 GitHub 仓库初始化提交，仅 .gitignore，不单占版本号）

### v2 · 2026-07-15 · `ee474ca` · feat
**添加NAS部署脚本和Git配置**
- deploy.js / deploy-local.js 时期。（`49c2a08` 合并远端，并入本条说明）

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
- 与 approval-bot 同日立项（同套模板），此后本项目长期低活跃。

## 阶段二 · 并入 qianli 工作区（2026-08-28 ~ 09-01）

### v9 · 2026-08-28 · `c886f32` · chore
**工作区归位：本仓库转型 monorepo**
- bambu 全部文件移入 `bambu-print-reservation/` 子目录；approval-bot、project-management-robot 以 gitlink 挂载；SOP 站点与各项目 .env 配置归档。业务代码零改动。

### v10 · 2026-09-01 · `55fb002` · feat
**bambu 部署脚本与密钥分离（push.js 统一入口）；同批新增 feishu-gateway**
- deploy.js/deploy-local.js 删除，改 push.js 纯 SFTP 直传；接入网关消费事件。

## 阶段三 · 审批事件直连与自动审批（2026-09-02 ~ 09-04）

### v11 · 2026-09-02 · `147d491` · docs
**增加项目职能边界声明（发错会话防护，需求错位即提醒停手）**

### v12 · 2026-09-03 · `ee5ad39` · docs
**AGENTS.md 增加「顶层规则与交互性」段（独立会话内联交互契约，开工先读顶层总表）**

### v13 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 大版本：新增 `services/dispatcher.js`（审批通过→自动分发打印任务给打印机负责人）、`services/approvalService.js`、test 双件；printer/manager、reservation、chatService 全线联动改造。

### v14 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道（approval_instance + approval_task）——.env.example 增补双通道消费配置**

---

**备注**：push.js 为纯 SFTP 直传，改动即时上线；顶层归档提交仅作版本锚点，可能与实际上线时刻有分钟级偏差。

## 阶段六 · 全项目审查修复批次（2026-09-06）

### v17 · 2026-09-06 · 顶层归档 `dbbdaf5` · fix
**全项目审查修复：缺料忙等死循环 + 文件传输超时 + FTP/SFTP 状态残留 + 人工分发越权**
- dispatcher 缺料忙等修复：trigger 的 finally 在「队列有就绪任务+有空闲打印机但全部匹配不上」时条件恒真，setImmediate 无节流重跑（CPU 空转、reason 字符串无限拼接）；改为仅本轮确有分发动作才立即重跑，缺料等待靠新入队/空闲事件再触发。
- 分发链路加超时：飞书 API fetch 20s、附件下载 120s、SFTP 上传 120s、FTP connect/pasv 30s、FTP put 60s——原先任一环节挂起会让 matching 永久为 true，此后所有入队/空闲触发的匹配被静默丢弃，进程不退出也无告警只能重启。
- printer/client：FTP 连接失败/上传出错置空 ftpClient 强制下轮重连（原先残留死客户端，if(!ftpClient) 判定失效永不重连）并加 connTimeout/pasvTimeout；SFTP 旧连接的 close 不再误清新会话的 sftpReady（原只判 this.sshClient 非空），被顶掉的旧连接显式 end 防泄漏，上传超时断开会话；缺附件先校验再写「打印中」（消除镜像表打印中→已通过假抖动）；manualDispatch 加忙碌校验（原先直接 dispatch 会顶掉 printing 映射，原任务永远无法写「已完成/失败」且可能与自动匹配双上传）。
- 文档对齐：README 工作流改为审批事件主通道（原表格事件旧图自相矛盾）、状态流转补「排队中」、指令表补 /print-help、事件链路补自动审批与重试配置；.env.example 补 DISPATCH_MAX_RETRIES/DISPATCH_RETRY_COOLDOWN_MS、空 APPROVAL_CODE 误打印风险警示、对账间隔仅后备模式生效标注；DEVLOG 头部「当前最新」指针 v15→v16；AGENTS.md 职能描述对齐（打印控制仅 HTTP API）。
- 附：审查发现「MQTT 断线无重连」不成立——bambu-link SDK 自带 reconnectPeriod=5s 自动重连。

## 阶段七 · 审批事件丢失自愈（2026-09-06）

### v18 · 2026-09-06 · 顶层归档 `b68773e` · feat
**审批事件丢失自愈：失败登记重拉 + APPROVAL_CODE 窗口列表对账兜底**
- 背景：监听链路时效审查发现——网关转发审批事件单发无重试（8s 超时只记日志），本端拉实例详情失败也只记日志即丢；审批源任务不写镜像表，旧对账兜底在主通道下已关闭且本就覆盖不到审批源。丢一次事件该单永久滞留，只能人工 /print-dispatch。
- ① 失败登记重拉：`handleApprovalEvent` 拉详情失败登记 instance_code 进 retryQueue，对账定时器优先重拉（详情接口只要 instance_code，不依赖 APPROVAL_CODE）；窗口内一直失败打「放弃，请人工核对」日志，防实例已删导致永久重试。
- ② 窗口列表兜底：配置 APPROVAL_CODE 时每轮 `POST /approval/v4/instances/list` 拉回看窗口内实例 ID（默认 24h，按提交时间），跳过引擎已登记（dispatcher 新增 `isKnown`）与对账确认过终态否决的，其余补拉详情——APPROVED 补入队（enqueue 幂等+播报排队卡片）、终态移出队列。**APPROVAL_CODE 留空时 ② 不生效，启动日志显式警示**（生产现状即未配置，当前仅 ① 生效）。
- 接线与配置：兜底随审批主通道在 `startEventSubscription` 启动（后备模式不启，它走旧表格对账），启动 15s 先跑一轮补停机窗口遗漏；新增 `POST /api/approval/reconcile` 手动触发（与 /api/dispatch/reconcile 对称）；`APPROVAL_RECONCILE_MINUTES`（默认 5，0=关）/`APPROVAL_RECONCILE_WINDOW_MINUTES`（默认 1440），.env.example 同步；终态清单收敛为 TERMINAL_STATUSES 常量供事件/对账两路径共用。
- 验证：dispatcher 18 项单测全过；部署后 health 200、启动日志见「[审批对账] 兜底已启动（每 5 分钟，回看窗口 1440 分钟）」、POST /api/approval/reconcile 空载 `{"success":true,"handled":0}`。
- 部署附记：push 前本地/NAS .env 键级 diff 无差异；另确认生产 `PRINTER_HOSTS` 为空（0 台打印机登记，部署前既有状态）——审批→入队链路可用，自动匹配需先配打印机。

## 阶段八 · 晚间静默——播报时段限制（2026-09-06）

### v19 · 2026-09-06 · 顶层归档 `cca9970` · feat
**02:00–09:00（Asia/Shanghai）静默窗口：打印生命周期/预约通知积压到 09:00 原样补发（可配可关）**
- 新增 `src/utils/quietHours.js`（顶层 AGENTS.md「晚间静默」规则的本仓实现）：群播卡片与私聊通知落在窗口（`QUIET_HOURS_START/END` 默认 2→9，支持跨午夜写法，`QUIET_HOURS_DISABLED=1` 关闭）内时载荷落盘积压（`.quiet-backlog.json` 持久化，重启不丢），窗口结束整点按入队顺序原样补发；启动时过点立即补冲刷（initQuietHoursFlush 接入 startServer）；补发失败保留重试 ≤3 次。
- 接线（dispatcher 7 处 + reservation 4 处）：排队卡/开始卡/完成卡/失败卡（重试与放弃两种）/缺料提醒（原 30 分钟节流不变）/预约审批提醒卡+审批人私聊/审批结果卡+申请人私聊。
- **挤压要为挤压之后的事情负责**：打印机控制、写表、队列匹配、审批流转发照常进行，只有消息延后；补发的是事发时刻快照（完成卡含实际完成时间），夜间过队后卡片排位可能滞后，队列实况以 /print 指令查询为准。
- 豁免：chatService 对 /print-* 指令的回复（交互回路）不积压。
- 其他：/api/health 附 quietHours 状态；.gitignore/.env.example 同步；README 播报段补静默说明；顶层 AGENTS.md 新增「晚间静默」规则段。

### v20 · 2026-09-06 · 顶层归档 `85e95cc` · fix
**例行维护全仓 debug——审批自愈②窗口列表兜底三处纠偏（自 v18 上线以来从未生效）**
- 对账 ②（窗口列表兜底）静默空转，三处叠加：①响应字段读错——`/approval/v4/instances/list` 返回 `instance_code_list`，原代码读 `instance_list`（那是另一接口 instances/query 的字段），`|| []` 把空转吞掉不报错；②`start_time/end_time` 传毫秒字符串，官方要求秒级 Unix 时间；③官方限制单次查询范围 ≤10 小时而回看窗口 24h，且未跟 `has_more/page_token` 分页。改为 8h 切片逐段拉取 + 段内翻页 + 秒级时间戳 + `instance_code_list`（SDK typings 与官方文档双证）。生产未配 `APPROVAL_CODE`，②此前休眠、无线上影响；配置后兜底才真正可用。
- 顺带（文档）：README 部署命令去掉被 push.js 忽略的「提交说明」参数（纯 SFTP 无 git 步骤）；PRINTER-LAN-API.md dispatcher 全部行号按 v19 后代码回填（v19 接线 quietHours 后 +10~20 行系统性偏移）。
- 已知限制（意图不明，未动）：approval_task 自动审批路径拉详情失败不登记重拉（与 instance 路径 v18 前失败模式同构，是否自愈待裁定）；对账对「APPROVED 无附件 / PENDING」实例不做已见登记，窗口内每轮重复拉详情（噪音非正确性）；数值型 env 无 NaN 防护。
- 单测：test/approval-test.js、test/dispatcher-test.js 全部通过；README「审批单测 10 项」计数核对无误。

### v21 · 2026-09-12 · 265a429 · fix

**静默积压文件可挪项目外 + 配置补齐（清空部署不再丢积压）**

- `src/utils/quietHours.js`：积压文件路径支持 `QUIET_BACKLOG_FILE` 环境变量——本仓纯 SFTP 部署每次 `rm -rf` 清空 /opt/bambu-print-server，默认项目根的 `.quiet-backlog.json` 每次部署必丢，静默积压的「重启不丢」承诺在部署场景从未成立；加载时对目标目录 `mkdirSync(recursive)`（项目外数据目录无人预建）。
- `.env` 补配 `QUIET_BACKLOG_FILE=/home/qianli/bambu-data/quiet-backlog.json`（push.js 随部署上传 NAS 生效）；`.env.example` 补注释键（补齐「新增配置同步改 example」约定欠账）。
- 顶层 AGENTS「晚间静默」口径不变：积压文件位置变化不影响冲刷语义（任务类重跑/一次性通知原样补发）。

### v22 · 2026-09-12 · 64ce352 · feat

**动态广场事件流接入（打印排队/开始/完成/失败 → 机器人项目看板）**

- 新增 `src/services/plaza.js`：打印生命周期四态事件写机器人项目看板「动态广场」表（`config.plaza` 默认表已内置，`PLAZA_BITABLE_TABLE_ID` 可覆盖）；失败仅 warn 绝不影响打印主链路。
- 插桩：`dispatcher` 的 enqueue（排队，silent 不计）/ dispatch 开始 / completeTask 完成 / failTask 失败。
- 测试：`test/dispatcher-test.js` 补 `PLAZA_BITABLE_TABLE_ID=''` 隔离（防测试污染生产表），回归全过。

### v23 · 2026-09-13 · 随顶层 v52 归档 · feat

**定制窗口 `GET /api/print/policy` 上线（只读全景）**

- 打印机登记清单（id/名称/型号；accessCode/serial 不外泄）、审批主通道/自动审批/对账参数、分发匹配参数（颜色阈值/重试上限/冷却/AMS）、队列与打印中快照。
- 运维台「功能激活」面板接通真实数据（dashboard fetchActivity 增 printPolicy/ticketPolicy 探针，与 ticket v64 同批）。
- README 补「定制窗口」节；dispatch/approval 两套离线测试全过。

### v24 · 2026-09-13 · 随顶层 v56 归档 · feat

**分发引擎状态持久化：重启不丢打印队列（用户拍板：后续有算力，预约可持久化）**

- 新增队列/打印中映射/已知记录（known）/完成计数的磁盘落盘：`DISPATCH_STATE_FILE`（默认项目外 `/home/qianli/bambu-data/dispatch-state.json`，与静默积压同目录，部署清目录不再影响）；变更防抖 300ms 合并写入 + 临时文件原子改名；`start()` 时恢复，进程 SIGINT/SIGTERM（pm2 restart）退出前强制冲刷。
- known 截尾 2000 条防无限增长（保存时截尾、恢复时队列/打印中的活动 recordId 回加）；状态文件损坏按空队列启动（审批事件与对账可重新入队），文件缺失静默跳过。
- 落盘点：trigger 匹配轮结束（覆盖入队/分发/完成/失败引发的变更）、dequeue、manualDispatch；exit hook 只挂一次。
- 测试：新增 `test/dispatcher-persist-test.js`（落盘生成/重载恢复队列与打印中与完成计数/known 截尾/损坏文件按空启动/文件缺失静默 9 项）；dispatcher/approval 既有单测回归全过。
- README 补「状态持久化」节与测试清单；`.env` 配置生产路径 `/home/qianli/bambu-data/dispatch-state.json`，`.env.example` 同步。

### v25 · 2026-09-13 · 随顶层 v57 归档 · fix

**人工指定与自动匹配分发互斥：分钟级 TOCTOU 竞态关闭（遗留待办销项）**

- 病灶：dispatch 是分钟级 await 链（飞书下载 → SFTP 上传 → MQTT 下发），printing 占用登记在链尾才发生；manualDispatch 不走 matching 串行段且 busy 校验在链前——窗口期内两路对同一台打印机双双下发（上传互覆/顶掉任务，原任务永远无法写「已完成/失败」）。
- 修复：按打印机的分发闸门——`dispatching` Set 在 dispatch 入口同步 check+add（单线程事件循环无插入窗口），finally 释放（失败/重试路径也保证）；自动匹配候选过滤掉分发中的打印机；manualDispatch busy 校验追加「正在有任务分发中」判定，且 dispatch 入口闸门兜底二次拒绝。**闸门刻意不持久化**（崩溃后清零重新评估，残留锁才危险）。
- 测试：新增 `test/dispatcher-manual-race-test.js` 8 项（可控 deferred 模拟分钟级下载链：分发中自动匹配不可见/并发 dispatch 二路拒绝且任务留队/manualDispatch 判定/链路完成后闸门释放任务继续分发）；persist/dispatcher/approval 三套既有测试回归全过。
- README 补「分发互斥」节与测试清单。

### v26 · 2026-09-13 · 随顶层 v62 归档 · fix

**深度代码审查批：四处确认 bug 修复（含两个高影响）**

1. 分发进行中重启/崩溃 → 任务永久丢失：中间态（已出队未入 printing）被 known 永久拦截重入队，已审批单静默消失且无任何通知。改为显式 in-flight 追踪：dispatch 进出 inFlight 数组、落盘携带，重启时中断任务重回队列完整重发（新增往返用例）。
2. finish 事件落在停机/打印机离线窗口 → printing 幽灵滞留（重连首报无 prevState 不产生事件）——新增 10 分钟 printing 巡检：打印中超过预估时长（6h×2 倍数保守）且打印机实况空闲即补完成收尾。
3. manualDispatch 非 autoDispatch 分支不移出队列——人工指定的闪铸单随后被自动匹配分到别的 Bambu 覆盖。移出队列 + known 登记 + 落盘。
4. 审批源任务重试耗尽后 /print-dispatch 永远找不到（instance_code 不在镜像表）——重试耗尽时保留 givenUp 列表，人工恢复通道打通。

### v27 · 2026-09-13 · 随本提交落地 · feat

**管理端点鉴权 + 部署前测试闸门（体系推荐 R2/R4）**

- 新增 src/auth.js：打印机控制（print/pause/resume/stop）与 /api/approval/reconcile 需 X-API-Token（fail-closed）；/api/reservations 与 /api/chat/command 为用户可达链路不挂闸。
- push.js 加部署前测试闸门：dispatcher/persist/manual-race/approval 四套全过才部署。

### v28 · 2026-09-15 · 顶层归档 7c836f9 · fix

**全项目深度审查修复批：写端点鉴权补齐（铁律）**

- 六个写端点漏挂 X-API-Token（与同仓 printers print/pause/resume/stop、/api/approval/reconcile 的既有鉴权自相矛盾，违反顶层 AGENTS「管理/写端点必须鉴权」铁律）：POST/PUT/DELETE /api/reservations*（含 review——可直接「通过」预约并入队）与 POST /api/dispatch/manual（可绕审批直接驱动真机）、/api/dispatch/reconcile。运维台代理 POST 自动附 token，不受影响；本机脚本直调需自带 X-API-Token 头。
- .gitignore 增补 .dispatch-state.json（本地不配 DISPATCH_STATE_FILE 跑一次就会在项目根生成，顶层 git add -A 易误扫入库——wecom v68 前车之鉴）。
- DEVLOG 头部指针修正 v26 → v28（v27 时漏更，该指针历史上已漏过一次）。

### v29 · 2026-09-15 · 顶层归档 8f8a4f9 · fix

**R8 分发可靠性包（全项目审查推荐落地批）**

- failTask 运行期失败接入与分发失败同款的重试/让位通道：此前打印机上报 failed 只把镜像表写回「排队中」而不重排，known 拦截重入队 → 单据永久滞留（失败卡却承诺「会重新排队」）。现按 dispatchRetries 冷却重排，耗尽进 givenUp 并在失败卡给出 /print-dispatch 人工恢复指引。
- givenUp 落盘（GIVEN_UP_CAP=200 截尾）：此前纯内存，重启后人工恢复通道（v26-B4）静默失效——known 已拦重入队、审批源单不在镜像表。恢复时随状态载入。
- sweepStalePrinting 补审批源守卫（同 completeTask）：审批源 task 写 instance_code 到预约表必然失败，每 10 分钟白刷错误日志；改为跳过写表保留内存收尾。
- config：FEISHU_USE_LONG_CONNECTION 缺省翻转为 false（长连接模式在本仓是空壳只打日志，误配即静默收不到全部事件；网关转发模式才是真实链路）。
- .env：FEISHU_VERIFICATION_TOKEN 补配共享密钥（/api/feishu/event 此前零校验，LAN 可伪造事件驱动分发）；DISPATCH_STATE_FILE POSIX 路径显式化 C:/home。
- dispatcher-persist-test 新增 6 断言（givenUp 往返/重排/让位/落盘恢复），四套测试全过。

### v30 · 2026-09-17 · 顶层归档 cc97019 · fix

**全量 debug 批：分发引擎三处修复 + 超时与配置收口**

- start() 审批直连分支恢复队列后统一 `trigger('restore')`（此前提前 return，重启后恢复的队列+空闲打印机无人点火，任务可无限期滞留）。
- sweepStalePrinting 补完成后 `persistState()`（释放过打印机再 trigger）——防 300ms 防抖窗口外崩溃后幽灵 printing 复活、重复发完成卡/重复计完成数。
- approval_task 自动审批去重改拉详情成功后登记（旧逻辑先登记后拉取，失败即永久丢失且不进重试）。
- webhook 发送（sendMessage/sendTextMessage）补 15s 超时（裸 fetch 挂起会卡死晚间静默冲刷循环）。
- .env.example：QUIET_BACKLOG_FILE 注释态改显式项目外路径（与 DISPATCH_STATE_FILE 同待遇）；NAS 三键迁小电脑实值；README givenUp「保留在内存」改已落盘口径（v29 遗留）。
- 测试：approval/dispatcher/dispatcher-persist/dispatcher-manual-race 四套全过。

### v31 · 2026-09-19 · 顶层归档随批 · chore

**npm test 与 push.js 闸门同源（R27）**

- package.json `test` 由 `echo "Error: no test specified"` 占位符改为与 push.js 测试闸门完全相同的四套清单（dispatcher/dispatcher-persist/dispatcher-manual-race/approval）——此前直接 `npm test` 得到误导输出（09-18 全量 debug 批观察项 R27）。
- 纯元数据批，无行为改动；npm test 实跑验证全过。版本锚点=顶层归档提交。

### v32 · 2026-09-20 · 顶层归档随批 · chore

**用户拍板：动态广场机器人停写（PLAZA_ENABLED 开关）**

- 2026-09-20 用户拍板：动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责。plaza.js `enabled()` 加 `PLAZA_ENABLED` 开关（默认关，显式设 `1` 才恢复写入）；打印生命周期（排队/开始/完成/失败）四处广场钩子保留代码不动，仅由开关关断。
- `.env.example` 补注释；npm test 四套全过。版本锚点=顶层归档提交。

### 附记 · 顶层 v84 联动批归档（非本仓版本号 · 2026-09-20）

> 勘误（2026-09-24 复查批）：本条原被误贴为本仓 `## v84` 条目——版本号与层级均不属 bambu 自身 v1~vN 序列（该批本仓正式条目即上行 v32），系顶层 DEVLOG 联动摘要的复制。按「历史条目不改写、版本号不重排」原则改为附记保留原文，不再占用/干扰本仓版本序列。

**用户拍板批：动态广场机器人停写（四仓 PLAZA_ENABLED）**

- 2026-09-20 用户拍板：**动态广场相关功能由用户自维护，机器人只对各自现有业务看板负责**。duty-bot v34 / hub v102 / ticket-bot v78 / bambu v32 四仓 `src/services/plaza.js` 统一加 `PLAZA_ENABLED` 停写开关（代码默认关，显式设 `1` 才恢复机器人写入），事件钩子保留、fire-and-forget 语义不变；「动态广场」表（在回收站）的恢复/重建由用户自理，机器人不再参与。
- 附带效果：表在回收站期间各仓持续刷的 `TableIdNotFound` warn 终结；用户日后恢复/重建广场表也不会被机器人自动灌数据。
- gateway 的「网关日活跃」upsert 是另一张在役表，不在停写范围。`.env.example` 四仓补注释；顶层 AGENTS「机器人项目看板」节改口径；桌面意图文档待拍板 #1 销项并记入已定口径。
- 测试：duty flow+express / ticket 三套 / hub duty-branch / bambu 四套全过。部署顺序：duty → hub → ticket → bambu（SFTP）→ 顶层。

### v33 · 2026-09-24 · 顶层归档随批 · fix

**manualDispatch 审批源守卫 + 事件端点 fail-closed + auth 废除 ?token=（全仓复查批）**

- 提交说明：fix: manualDispatch 非自动机型分支补审批源守卫 + /api/feishu/event fail-closed + auth 废除 ?token=
- **manualDispatch 守卫（P2）**：非自动机型（闪铸）分支原无条件写镜像表——审批源任务 recordId=instance_code 非镜像表 record_id，updateRecord 必抛错，且此时任务已出队、不进 givenUp，单据静默消失（重启才可能从旧状态文件捞回）。照 dispatchLocked 口径补 task.fileSource !== approval 守卫；出队 + known 去重保留，人工按提示上传不受影响。
- **fail-closed**：/api/feishu/event 补「未配置 token 403 拒绝 approval_instance / approval_task 帧」（表格事件后备镜像通道不受影响）。现网 .env 已配 token，行为无实际变化。
- src/auth.js 废除 ?token= 回退（R10②）。
- **DEVLOG 勘误**：文末错贴的顶层 v84 条目改为「附记」（版本号/层级不属本仓序列，见该附记注），不再干扰版本锚点回溯。
- 测试：四套桩全过（dispatcher 18 检查点 / persist / manual-race 8 项 / approval 9 项）。

## v34 · 2026-09-25 · 顶层归档随批 · docs

**全量审查文档批（纯文档，无代码改动）**

- PRINTER-LAN-API.md：§4.1/§4.6/§4.7/§4.8 行号随 v33 fail-closed 插入系统性偏移修正，§4.6 补 v33 fail-closed 行为记录（token 未配置拒收消息帧）。
- AGENTS.md：push 命令口径修正（npm run push 不带参数，本仓无 git 步骤）；速览补 duty/wecom。
- README：DISPATCH_STATE_FILE 生产路径带盘符（C:/home/...）；.env.example 同步。
- 随批 SFTP 同步文档到部署目标（无 pm2 重启必要，代码零改动——push.js 常规执行）。

## v35 · 2026-09-26 · 随本提交落地 · fix

**七仓全量审查修复批（P1×2 + P2 清理）**

- 提交说明：fix: 全量审查修复——打印机失联幽灵空闲/AMS 位图错位/铁律收口/状态机补漏
- **P1×2**：①打印机「幽灵空闲」——bambu-link 从不 emit disconnect、connected 永不回落，断电后仍按空闲选机白耗分发；client 记 lastStateAt、manager 对超过 PRINTER_STATE_STALE_MS（默认 3 分钟）未报状态的机器拒绝自动分发并标注失联。②AMS existBits 位图错位——tray.id 是 0 基（0..3，254=外部），charAt(id-1) 整体错一格导致未装满时材料匹配歪曲，改 charAt(id) 并对外部槽加守卫。
- **P2**：legacy 消息直连链删除（对话铁律收口，/api/chat/command 主通道保留）；FEISHU_USE_LONG_CONNECTION=true 启动即抛（fail-fast 去空壳 async）；givenUp 任务人工指定/审批取消两处补清理（不再可被 /print-dispatch 复活驱动真机）；自动审批 handledTasks 改成功后登记；parseForm 从附件控件取原始文件名；jobEvent FINISH 死半边与无监听 statusChange 清理；ftpPut 失败路径 destroy 防 socket 泄漏；announce 空回调改报错日志；bot/client/manager/bitable 共 13 个零调用方函数删除。
- 测试：四套全绿（dispatcher 18/persist 14/manual-race 8/approval 10）。
- 提醒：.env 缺 APPROVAL_CODE（现网靠「表单含附件」自适应识别，共用应用的任何含附件审批通过都会驱动真机）——需从飞书审批管理后台取 code 配入。

## v36 · 2026-09-27 · 随本提交落地 · fix

**第二轮全量对抗审查修复批（P0 审批绕过 + 打印机状态机补漏）**

- 提交说明：fix: 对抗审查——manualDispatch 状态白名单（堵审批绕过）/idle 幽灵收尾/取消竞态/code 双重校验等
- **P0**：manualDispatch 兜底拉单无申请状态守卫——待审批/已驳回/已取消/已完成均可被 /print-dispatch 直接分发真机（hub 通配转发 + chat/command 无鉴权放大为「任何队员可绕审批打自交 3mf」）。修：状态白名单（仅已通过/排队中可直接分发，givenUp 恢复语义保留，其余明确报错）。
- **P1**：断电恢复 PRINTING→IDLE 跳过 FINISH/FAILED，printing 幽灵不被收尾且会被新任务静默覆盖（旧单永久丢追踪、镜像表卡打印中）——idle 分支先 failTask('打印机回空闲且无完成事件') 收尾再放行。
- **P2**：dispatchRetries 成功后清零（防抖动凑满 3 次进 givenUp）；givenUp 时非审批源镜像表回写排队中；dequeue 落在分发 await 链窗口的取消丢失（task.cancelled 标记+各步前复查）；approvalService 实例详情 approval_code 与配置比对（与事件路径双重校验对称化）；recoverInstance 查分发痕迹防 24h 窗口重打；quietHours 00:00-02:00 重启积压立即冲刷（原最长拖 31h）；syncPrinterStatusToBitable 状态签名去重（60s 全量 upsert 配额白耗）。
- 测试：四套全绿；manual-race 套新增状态守卫/idle 幽灵收尾用例。
- 提醒：.env 仍缺 APPROVAL_CODE（任何含附件审批通过即驱动真机的窗口仍在）——桌面存疑清单三.1。

## v37 · 2026-10-05 · 顶层归档随本提交 · feat

**路线 A 大版本：断飞书审批链 → 自建前后端 + 账号体系 + 学习链路 + 审查优化批**

- 提交说明：feat: 路线A——断飞书审批链,自建前后端(本地预约存储/账号体系/学习链路/审查优化批)
- **① 架构转向（曼波拍板「断掉飞书相关设计,做服务器的前后端」）**：预约真相源从「飞书审批实例事件+表格镜像」整体转为本地存储——`reservationStore`（状态机 7 态全约束/终态锁定/`Ryyyymmdd-nnn` 单号/项目外持久化）；审批动作改为页面+HTTP 端点；dispatcher 新增 `local` 任务来源（本地读文件/状态回写 store/`isMirrorTask` 谓词收口全部写表点/`manualDispatch` 支持从 store 恢复）；`approvalService`/`eventSubscription`/`/api/feishu/event` 整链退役（文件保留不再接线）；打印机状态写表停用；飞书仅剩群 webhook 播报与查看类指令。
- **② 账号体系（防冒名/防未授权）**：member/reviewer/admin 三级角色（首位注册者自动 admin bootstrap）；scrypt+盐+timingSafeEqual 口令、5 次失败锁 10 分钟、30 天会话 cookie 落盘重启不掉线；发起人强制取登录身份（`submittedBy` 归属键）——body 冒名一律忽略；鉴权双通道（页面 session / 运维台 X-API-Token=admin,既有管理链路不破）；`/api/printers*` 收紧登录（内网 IP/温度不再匿名暴露）。
- **③ 需求标签池 + 工艺映射规则库（自动切片铺路）**：`taxonomy.js` v2（8 组 24 字段,受力参照系=模型上传姿态,力学/载荷/耐久扩充,7 条 block/warn 冲突规则）；`processRules.js`（16 参数白名单+出厂种子 23 条+priority 升序叠加引擎+热改 CRUD）；读窗口 `GET /api/print/taxonomy`、读写窗口 `/api/print/process-rules`。
- **④ 学习链路（「机器学人」落地）**：`ruleSuggestions` 待审池（相同 when+set 聚合计数/采纳转正/拒绝,审核闸门强制）；`slicerExtract` 3mf 参数提取器（project_settings.config/gcode 头部双通道,Bambu 参数映射+baseline diff——映射表首次真机导入需校准）；页面参数实时预览/勾选记忆/修正建议弹窗/教学导入卡。
- **⑤ 全量审查优化批（3mf 链路除外）**：修聊天列表发起人恒「未知」（store 字符串 applicant 兼容）；注册邀请码 `REGISTER_INVITE_CODE`（空=开放）；上传源文件生命周期（终态单超 `UPLOAD_RETENTION_DAYS`=30 天清理,记录保留标记 `fileCleaned`）；health 增强版（phase/版本/五数据面文件状态）；policy 标注审批链退役+givenUp 计数；README 指令表/播报口径同步。
- **测试**：九套 116 项全绿（新增 taxonomy 19/process-rules 17/local-reservation 15/auth 14/learning-loop 10 五套,全部并入 npm test 与 push 闸门）；HTTP e2e 三轮（上传中文编码定案:仅 originalname 需 latin1 还原/鉴权全生命周期十步/学习闭环采纳即时生效）；修复：重复审批绕过、限速计数被清零、测试隔离污染规则文件。
- **部署注意**：生产 .env 已补五数据面路径（RESERVATIONS/AUTH/RULES/SUGGESTIONS→C:/home/qianli/bambu-data/）+ UPLOAD_RETENTION_DAYS=30；上线后曼波第一个注册（自动 admin）→ 页面给审批人升 reviewer；`REGISTER_INVITE_CODE` 未配（开放注册,仅内网屏障）,需要时配置后重启生效。
- 附记：本条目涵盖 2026-10-05 四个会话批次（本地化/账号/学习链路/审查优化）,因同批首次部署合并记录;版本锚点=本条目自身的顶层归档提交（git log 以 feat: bambu-print-reservation v37 检索即得）。

## v38 · 2026-10-05 · 顶层归档随本提交 · fix

**界面交互修复 + 工艺参数细化 + 标签体系反馈批（曼波实测反馈驱动）**

- 提交说明含 9d621bc（界面修复+参数细化）与 b1ef90d（标签反馈批+材料反推）两提交内容，一次部署上线，版本锚点=顶层归档提交。
- **P0 界面交互修复（浏览器实测复现）**：①标签勾选 chip 点击无反馈——change 监听缺 .on class 切换，collectSelection 读 .opt.on 恒空，**标签系统自上线起点击不可用**（既有 e2e 全走 API 直调未覆盖 UI，本次起浏览器实测进流程）；②「建议修正」按钮 onclick 被内联 JSON 双引号截断——改单据缓存+仅传单号；③HTML no-cache 防旧缓存。
- **工艺参数细化**：白名单 16→22（+顶/底面实心层数、支撑悬垂阈值角、支撑密度、裙边宽度、喷嘴温度Δ）；种子规则细化（外观=顶5底4+阈值45°+喷嘴+5°C 等）；3mf 映射表对齐（绝对喷嘴温度不做 Δ 换算）。
- **标签体系反馈（曼波四条）**：①材料类型改**可空**——需求标签由规则引擎反推 materialExclude/materialPrefer 随单下发，分发匹配时对 AMS 实装料槽求值（findTray 排除/优先）；②受力方向改**多选**+语义改「此件工作时朝向」；③配合需求精简（去过渡配合）；④连接方式+「打印件自配合（插接/卡扣）」+ interlock-fit 种子规则；⑤份数去重（标签池删除，仅表单顶部）。顺带修 multi 表单值按空白切分切碎含空格标签的问题。
- **账号**：POST /api/auth/change-password（登录态+旧密码验证）+ 页面改密码入口；本地测试服 manbo 账号密码重置（会话内交付）。
- 测试：九套 122 项全绿（+材料反推/findTray 排除优先/changePassword/参数细化断言）；浏览器全流程回归（登录/多选勾选/预览反推提示/修正属性完整）。
- 部署附记：上次部署（v37 后首推）完成后部署目标整机掉线（ping 100% 丢包），本次机器恢复后重推成功；生产 taxonomy/health/页面均验证为新版。

## v39 · 2026-10-05 · 顶层归档随本提交 · feat

**标签体系迭代批（曼波五条反馈，浏览器实测驱动）**

- 提交说明：feat: 标签体系迭代批——多向拟合/朝向指引上移/类型↔方向对应/上场件/挠度标尺
- ①「多向/复杂受力」改名「**多向拟合**」；②工作朝向指引从 Z 轴选项 label 上移到**字段级 tooltip**（选项简化为 X 轴/Y 轴/Z 轴）；③受力类型↔方向**对应指引**（多选多对应）：选方向后类型字段下方动态显示「已选方向：X、Z——按各方向工况对应勾选」，tooltip 补组合语义（引擎对方向×类型全量应用）；④使用寿命「长期（跨学期）」改「**上场件**」（比赛上场关键件）；⑤**刚度/挠度标尺** deflection_scale（-3 柔顺 ~ +3 刚性，0=常规）：stiffness 字段升级为标尺；规则引擎 when 条件新增 **{min,max} 范围语义**（数组枚举兼容保留），柔性规则 ≤-2（排除 CF/低填充/疏支撑）、刚性规则 ≥+2（优先 CF）；taxonomy 冲突规则与前端 preflight 同步支持范围匹配；前端标尺渲染为滑块+实时数值，0 不入 selection（保持「默认不勾」铁律）。
- 测试：九套 122 项全绿（+标尺范围边界/多向拟合 label/上场件断言）；浏览器端到端验证（标尺 -3 → 柔性规则命中、预览显示排除 CF/碳）。
- 部署：生产 taxonomy 实测 multi/多向拟合/标尺 -3~3/上场件全部生效。

## v40 · 2026-10-05 · 顶层归档随本提交 · feat

**全量审查批 + 多色打印（曼波指令：审查功能执行 vs 设计意图）**

- 提交说明：feat: 全量审查批+多色打印——份数真实执行/多色 AMS 匹配/上传白名单/queue 鉴权+givenUp 恢复入口
- **审查发现的意图-执行断裂与修复**：①**份数形同虚设**（quantity 只存不用，勾 3 份打 1 件）——落地真实执行：buildLocalTask 携带 remaining=quantity-1，completeTask 后自动重入队续打（绕过 known 幂等——续件非重复事件；dispatchRetries 清零防折寿）；**末件才写已完成**（中间件回「排队中」），状态机补「排队中→已完成」流转（续打末件/巡检收尾从队列侧完成）；队列快照带 remaining。②**上传无类型白名单**（任意文件 ≤200MB 可传）——multer fileFilter 白名单 .stl/.step/.stp/.3mf/.obj，校验错误统一 JSON 400。③**/api/dispatch/queue 无鉴权**（暴露内部队列，与打印机端点收紧口径矛盾）——挂 requireUser()；响应携带 givenUp。④**givenUp 无恢复入口**——页面黄条（reviewer+）展示重试耗尽单+一键「指定打印机恢复」（POST /api/dispatch/manual）。
- **多色打印（新功能）**：taxonomy 表面组新增 multi_color 标签；颜色栏支持 +/、/，分隔多色（如 白色+黑色）；dispatcher.amsCoversColors 逐色找近似色槽（各色不共槽、exact 全过或 family 全过、materialExclude 照常生效）要求**所有颜色同机 AMS 可得**才选机；颜色→槽位映射以 3mf 内嵌 AMS 配置为准（执行链零改动）。
- 测试：九套 125 项全绿（+多色匹配三态/份数续打全流程/终态时机/multi_color 在池断言；份数测试模拟 dispatch 出队修正假阳性）。
- 部署：生产 taxonomy 实测 multi_color 生效；浏览器验证多色 chip/颜色栏提示/黄条空渲染。

## v41 · 2026-10-05 · 顶层归档随本提交 · feat

**双通道分流定稿（曼波定：stl/step 走需求链路，3mf 走审批直通）**

- 提交说明：feat: 双通道分流——stl/step 走需求链路(标签+规则定档)，3mf 走审批直通(参数内嵌)
- **语义**：`.stl/.step/.stp` = 需求链路——切片参数未定，标签勾选 → 规则引擎定档（快照随单存档），未来接服务端自动切片；`.3mf` = 审批直通——切片参数与 AMS 颜色映射已内嵌文件，引擎**不定档不越俎代庖**（processParams/appliedRules 置空，硬冲突拦截跳过），审批后直接按文件分发。
- 前端模式感知：选择 3mf 自动隐藏工况勾选区+显示「审批直通」提示条（材料/颜色栏保留——选机匹配仍需要），切回 stl/step 恢复需求链路；列表参数区显示「3mf 直通」标识。
- 材料/颜色栏对两类文件都保留：AMS 选机匹配的依据；材料反推（标签反推 exclude/prefer）仅需求链路生效。
- 测试：九套 126 项全绿（+双通道分流断言：3mf 不定档/stl 有快照）；浏览器验证模式切换双向。
- 部署：生产页面 200。

## v42 · 2026-10-06 · 顶层归档随本提交 · feat

**运营债清偿批（全量盘点「还差什么」落地：审批拦未切片 / 3mf 参数透明化 / usage 上报 / 数据备份 / registry 与总指南同步）**

- 提交说明：feat: 运营债清偿批——审批拦未切片/3mf 内嵌参数上卡/usage 上报/每日数据快照/registry 与总指南同步
- **审批拦未切片（P0 断裂修复）**：stl/step 单审批通过会驱动真机打裸模型（打印机只认切片产物）——approveReservation 与 manualDispatch 双闸拦截（报错带「切片为 3mf 后重新提交」指引），页面通过按钮对未切片单置灰+行内警示；集成测试夹具同步改 3mf。
- **3mf 审批透明化**：提交时用现成的 slicerExtract 提取文件内嵌切片参数摘要（embeddedParams，提取失败不阻塞提交）——提交播报卡新增「内嵌参数」行、列表 3mf 直通单展示参数摘要，审批人不再需要下载文件开 Bambu Studio。
- **usage 上报（顶层铁律清偿）**：新增 usageReport.js——页面提交/审批通过/驳回命中点向网关 POST /api/usage/report（fire-and-forget，5s 超时，失败限频告警）；本地账号以 `local:<username>` 命名空间归因（网页授权上线后切 open_id）；USAGE_REPORT_URL 默认同机网关 3000。
- **数据面每日快照**：backup.js——预约/账号/规则/建议四 JSON 每日快照到 BACKUP_DIR（默认数据目录同盘 backup/，按天一份同日覆盖），保留 BACKUP_KEEP_DAYS=14 天轮转，启动即备一份保底，health.stores.backup 露出最近快照；uploads 源文件不备份（README 记录边界）。
- **registry.js 登记**：bambu 条目全面更新（路线 A 角色口径/新窗口 taxonomy、process-rules、rule-suggestions/查看类指令/双通道鉴权/v37~v42 演进注记）；**《机器人总成使用指南.html》同步**：打印预约卡重写为网页自助口径（注册/双通道/多色/批量/页面审批/查看类指令）。
- 测试：十套 132 项全绿（新增 ops-test 6 项：审批拦截/3mf 提取入档/备份四文件+轮转+同日覆盖/usage payload 与失败静默）。
- 部署：生产 health 露出 backup（空系统 copied=0 属预期——四类文件随真实使用生成）；部署脚本尾部 SSH ECONNRESET 闪断不阻断（服务已上线验证）。

## v43 · 2026-10-07 · 顶层归档随本提交 · fix

**真机接入前终审（代码/需求端/进程链路三段全查）**

- 提交说明：fix: 终审——bambu-link 签名核对/多色+材料留空匹配死区/大 3mf 提取内存防护/待审批过滤
- **bambu-link 真机面核对（client.js 全文首读）**：构造签名 `constructor(accessToken, host, sequenceStart, port, serial)` 与调用完全匹配；getFullState/getMqttClient/printGcode_file/stateUpdate 事件全部存在于 dist；project_file 的 `ftp:///sdcard/` URL 前缀为协议惯例（SFTP 上传后同一定位）；X1/H2D 走 SFTP(22)、P1/A1 走 FTP(21)、超时/会话泄漏防护齐备。**AMS/状态报文实际形状与 getFullState 解包的假设仍需真机核对**（阶段 0 首要项）。
- **修复①（匹配死区）**：多色 + 材料留空（材料反推场景）——materialMatch 空串恒 false 导致 amsCoversColors 永远选不中机；改「有材料按 exact/family 两档匹配，无材料维度放行仅按颜色」，材料反推排除（exclude）在多色路径照常生效。
- **修复②（内存防护）**：3mf 内嵌参数提取是同步整文件读（adm-zip 限制），200MB 上限文件会拖垮提交请求——>50MB 跳过提取（列表显示兜底「切片参数内嵌」）。
- **需求端小优化**：记录列表加「只看待审批」过滤（审批人高频动线）。
- 测试：十套 133 项全绿（+多色材料空选机/反推排除双断言）。
- 部署：生产 200；部署脚本尾部 SSH ECONNRESET 闪断复现（瞬态，不影响上线，已多次观察）。

## v44 · 2026-10-07 · 锚点=顶层仓库本批归档提交 · chore

**NAS_*→DEPLOY_* 连接键改名批（旧 NAS 残留清理，曼波定）**

- push.js 读键/注释/报错文案、.env.example、AGENTS.md 部署行、本地 .env 键改名（push 时覆盖部署目标同批生效）；
- 本仓 push 无 git 步骤，代码随顶层仓库归档；不影响运行时行为。

## v45 · 2026-10-07 · 锚点=顶层仓库本批归档提交 · feat

**上传通道 FTPS(990) 适配 + 4A 隔离区双机实测批（31→2 跨网段路由打通同批）**

- 提交说明：feat: 上传通道适配官方 FTPS 990（新固件 21/22 已关实测）——basic-ftp implicit TLS，FTP 21 回退保留
- **实测动因（4A 隔离区 192.168.2.x 两台 P1 系真机，云模式）**：TLS 证书（BBL CA，CN=SN 00M09D541710031/00M09A371900389）确认为拓竹打印机；LAN 端口集 990/8883/6000 常开，**21/22 全部 ECONNREFUSED**——社区明文通道（SFTP:22/FTP:21）在新固件已不存在，官方 990 FTPS（vsFTPd 3.0.5）为唯一文件通道。node-ftp 无 TLS 能力，引入 `basic-ftp`@6.2.2 实现 `ftpsPut`（implicit TLS + rejectUnauthorized:false 自签）；`uploadBuffer` P1/A1 分流改为 FTPS 优先 → FTP 21 回退（双失败错误信息含两通道）；`disconnectFileSession` 补 FTPS 清理。MQTT 8883（bambu-link）通道不受影响。
- **网络侧同批（详录见顶层 DEVLOG 与 lab-network skill §九）**：31→2 跨网段「ping 不通」悬案根因=主网缺去程路由（4A nft counter 0 实证包未到达），解法=主网各机本地加静态路由 `192.168.2.0/24 → 192.168.31.98`（笔记本 route add -p + 小电脑 SSH 同批；主路由零改动）；4A DHCP 静态租约 printer-189/printer-133 固化两机 IP。
- 测试：新增 `test/printer-upload-channel-test.js` 8 项（分流/回退/双失败报错/SFTP 机型不触 FTPS/connectFTPS 连接参数/失败不残留会话），十套全绿变十一套 141 项全绿。
- 文档：PRINTER-LAN-API.md §1.4/§5 对照表同步实测结论；README 测试节登记新测试。
- 遗留：两台打印机 Access Code 待上屏抄取 → `.env` 四列填入后重启即联调；`PRINTER_NAMES/MODELS` 建议按 SN 尾段区分（printer-189/printer-133）。

## v46 · 2026-10-08 · 锚点=顶层仓库本批归档提交 · feat

**全链路优化批 + 收缩量标尺（曼波「一次完成」批：全链路体检报告落地 批1~批4 + 新需求）**

- 提交说明：feat: 全链路优化批+收缩量标尺——完成事件补收尾/巡检动态阈值/复刻/ETA/损坏隔离/颜色与打印机 datalist/XSS 转义/建议池撞 id 修复/审批链遗留清理

- **① 收缩量要求标尺（曼波新需求，本次主线）**：taxonomy 标签池 fit 组新增 shrink_scale（-3~+3 滑块，8 组 21 字段）——负数=要求负收缩（打印件偏小）、正数=膨胀涨量（偏大）、越靠近 0=尺寸偏差要求越小；映射三条出厂种子规则（27 条）：shrink-negative(58, ≤-2 → xyContourComp -0.15)、shrink-expand(58, ≥+2 → +0.15)、shrink-precision(56, ±1 近零区 → precise 降速)——每个非零值恰好命中一条（互斥完备有断言）；getTaxonomy 输出新增 minLabel/maxLabel，前端滑块两端文案字段化（挠度标尺同步补 -3 柔顺/+3 刚性）。
- **② 完成事件补收尾（批1）**：finish 落在停机/重启窗口时，重启后首报文 prevState 为空、变迁检测恒不发事件，幽灵任务要等 12h 巡检——resolveJobEvent 提纯为纯函数，首报文实况 FINISH/IDLE 且引擎在册任务 → 立即补发 finish/idle 收尾（无任务首报文仍不发）。
- **③ 巡检阈值动态化（批1）**：原固定 6h×2=12h；start 事件时捕获 mc_remaining_time 存 task.expectedMinutes，巡检阈值改「预估×2 且 ≥1h」，无预估退回 12h（staleThresholdMs 纯函数）。
- **④ 真机联调核对面（批1）**：GET /api/printers/:id/debug（admin）返回 raw state 报文全量+连接/新鲜度元信息——AMS 报文形状/gcodeState 序列假设出错时区分「报文假设错」还是「解析错」。
- **⑤ 建议池撞 id 修复（批2）**：建议 id 固定 sug-<key>，采纳后同 when+set 再提交与已采纳条目撞 id，adopt 永远命中旧条目报「不可重复处理」成死单——id 独立生成（时间戳36进制+随机），key 仅作聚合键（回归断言入 learning-loop-test）。
- **⑥ 颜色静默降级治理（批2）**：colorReference 仅 14 色名，字典外色名 colorRgb=null 时 findTray 按任意颜色放行——新增 GET /api/print/colors 字典窗口；提交页颜色栏 datalist+未识别色名知情提示；store.create 对字典外且非 hex 的颜色写 processWarnings（不拦截）。
- **⑦ 指定打印机校验（批2）**：自由文本拼错此前静默走自动匹配或永排——提交端点校验 assignedPrinter 必须命中 .env 登记清单否则 400 带可用清单；页面 datalist。
- **⑧ XSS 转义（批2）**：displayName/文件名/轨迹备注/建议理由等用户可控字段全量过 esc() 再进 innerHTML（存储型 XSS 面，内网低危但成本低）。
- **⑨ 存储损坏隔离（批2）**：预约存储/账号存储/分发状态文件损坏时坏文件改名 .corrupt-<ts> 留档再按空启动——原「损坏按空启动」下一次写入会把仅存数据静默覆盖，当日数据无备份可救。
- **⑩ 页面体验批（批3）**：上传进度条（fetch→XHR upload.onprogress，200MB 不再只显示「提交中」）；打印机卡 admin 控制按钮（暂停/恢复/停止，二次确认——API 早有页面没有）；已完成单「复刻」按钮（POST /api/reservations/:id/reprint，服务端复制源文件免重传，需求链路按当前规则库重新定档，新单走完整审批流）；givenUp 恢复 prompt 换打印机下拉；队列 ETA（3mf 提交时提取内嵌预估时长 estMinutes：gcode 头部秒数/时分秒双流派+time_cost 兜底，队列条按内嵌预估求和、在打按打印机实时剩余求和，页面 ETA 条+/print-status ETA 行共用 etaSummary）。
- **⑪ 结构优化（批4）**：reservationStore 加 mtime 缓存（读频繁写低频，外部手改 mtime 变化自动失效重读，语义与每次重读一致）；history 截尾 200 条；审批链遗留安全清理——approvalService/eventSubscription/approval-test 删除（仅彼此引用，路线 A 起零接线；dispatcher 镜像分支与 bitable/client 保留服务历史任务恢复）；/api/chat/command 鉴权本批不动（需网关侧同批改契约，跨仓）。
- **测试**：十套 158 项全绿（审批 9 项随退役删除；新增：收缩标尺 3 项+颜色警告/estMinutes/复刻 4 项+ETA/变迁判定/巡检阈值/损坏隔离 5 项+撞 id 回归 1 项等）；冒烟：health/colors/taxonomy.shrink_scale/注册链路实测过，前端内联脚本 node --check 过；persist-test 清理语句随隔离语义改幂等。
- **踩坑**：ops-test 损坏隔离用例初版放在文件后部，同步改名与先启的异步用例竞态（隔离把存储文件改名、悬挂中的审批用例 get 返 null）——用例挪到文件首部（先于一切异步）并注明原因；manager.js handleStateChange 曾重复声明 prev（SyntaxError 即测即修）。
- **文档**：README（taxonomy 21 字段/种子 27 条/可靠性段/API 表 3 端点/测试节十套 158 项）、registry.js（bambu windows+notes）、顶层 AGENTS.md 定制窗口行（bambu 补 colors 窗口）；使用指南 HTML 无字段级内容不需同步。
- **遗留**：批5 自动切片（Bambu Studio CLI 探针批）未启动，需真机/CLI 环境先行；两台 4A P1 Access Code 上屏后真机联调时用 debug 端点核对 AMS 报文。
- **⑫ 前端展示优化（同批二次交付，曼波「展示形式可优化项一并落地」）**：①状态语义色重排+打印中徽标呼吸脉冲（待审批橙/已通过蓝/排队中靛/打印中橙红脉冲/完成绿，进行中状态一眼可辨）；②打印机失联标注——getApiStates() 透出 stateStale（/api/printers），幽灵空闲（报文过期）页面显示灰色「失联」标签+警示行+卡片降透明度，不再误信最后的空闲态；③队列条升级全员可见（原挂在 reviewer-only 黄条函数里成员看不到）+队列前 4 单明细（单号/文件/加急/剩余件）；④列表状态轨迹折叠（默认最近 2 条+「展开全部 N 条」，跨 15s 刷新保留）+参数快照折叠（默认 8 项+「＋N 项」，参数名走 PARAM_LABELS 中文名）；⑤taxonomy 组标题点击折叠（默认全开不破坏「默认不勾」动线）；⑥已选工况摘要 chips（已选 N 项+中文名+一键清空，bool 字段不带「：true」尾巴）；⑦材料类型 datalist（常用 12 种）；⑧移动端 <720px 表格卡片化（td data-label 灰标签逐行呈现）+chip/按钮触控目标放大；⑨行内实时进度（列表打印中行 join 打印机实时进度条）；⑩微交互（行 hover/按钮过渡/列表加载态）；⑪表头语义修正（thead 显式包裹——移动端 thead{display:none} 才能生效，修掉卡片列表残留表头行的实测瑕疵）。
- **浏览器实测（照 v38 起流程，IAB 真浏览器）**：登录→组折叠切换→勾选 chips 摘要联动→收缩标尺滑 -2（数值/摘要/参数预览「命中 3 条规则」实时联动）→一键清空全恢复→XHR 提交链路端到端（页面内构造 File 走真实 upload.onprogress，中文文件名「xhr-e2e-测试件.3mf」正确落库，R20261009-003）→移动端 390px 卡片化+表头隐藏复查；整页截图确认视觉。踩坑：curl -F 从 Windows 控制台发中文进测试夹具会 GBK 乱码（浏览器 FormData 路径无此问题，测试夹具勿用控制台 curl 造中文数据）；IAB 整页截图有内容拼接伪影（DOM 实际唯一，h1×1 验证），视口截图为准；原 Playwright click 对该页按钮 actionable 等待恒挂起，页面内 evaluate click 为等效替代。

## v47 · 2026-10-10 · 锚点=顶层 v145 归档提交 · fix

全量审查修复批（五路审查子代理 + 基线测试跑批后定修）。

- **P0：dispatcher.start() 接线回归**——v37 退役 startEventSubscription() 时把启动调用一并弄丢，分发引擎自 v37 起在生产从未启动：队列恢复（restoreState）、jobEvent 完成收尾/失败重排/份数续打（bindPrinterEvents）、printing 幽灵巡检（staleTimer）、退出冲刷（hookExitFlush）全部为死代码；被「真机未接入（printers:0）+ 十套桩测试直调内部方法不经过 start()」双重掩盖。startServer() 接回 dispatcher.start()，并补导出 startServer 供测试/运维脚本用。
- **新增 test/bootstrap-test.js（生产入口级测试）**：以 startServer() 为准断言引擎随启动接线（落盘队列恢复/巡检定时器/退出钩子/临时端口），锁死「测试入口≠生产入口」类盲区。
- **P1：usage 上报默认端口修正**：原默认指 :3000（hub），端点实际在网关 :3010——打印域活跃统计上报全部 404 静默丢弃，运维台「队员活跃」缺打印域。
- quietHours 积压身份键唯一化（五仓同批：gatePayload 入队签发 crypto.randomUUID()，同毫秒碰撞不再互吞；本仓合并保存已有，仅补 id 键）。
- push.js 测试闸门改自动发现 test/*-test.js（原与 package.json 双维护，漏改即绕闸）；清理僵尸依赖 lowdb/node-cron/ws（全仓零引用）。
- 文案修正：缺料卡/失败卡不再指已移除的 /print-dispatch（改指预约页面/运维台）；/help 补列 /print-ams（指南 MD/HTML 本就有，代码侧滞后）。
- npm test 11 套全过。**部署状态：本项目 push 为纯 SFTP 无 git 步骤，因小电脑离线（本机在校园网侧 + Radmin 不通）整批挂起——上线后 npm run push 即完成部署；本版锚点=顶层 v145 归档提交。**

## v48 · 2026-10-12 · 锚点=顶层归档待补（未提交状态 SFTP 直传） · feat

**训练集录入工坊大批次：几何自拟合 + 拟合度 + 3D 标注 + 机型隔离 + 切片桥 + 注册关闭**

- **收缩量条下架**：shrink_scale 标签与配套 3 条规则移除，TAXONOMY_VERSION v3（几何体检批内再升 v4）；
- **几何体检 v4**：`src/services/modelFeatures.js`——STL/3mf 解析（焊接/边表/亏格/平面环拟圆/悬空分带/贴底接触/曲面占比），taxonomy 新增「几何体检（自动检测）」组 4 标签（通孔补偿/悬空支撑/曲面保护/小接触面裙边）+ 规则引擎 4 条种子（priority 60）；拟合口径修正后另立 `paramFit.js`；
- **训练集录入工坊** `/train.html`（无审批）：模型（自动特征）+ 已切片 3mf（自动提专家参数）+ 工况勾选（人工标注 ≥1 项硬校验）三方合成样本；`trainingStore.js` 索引 + 文件归档 `bambu-data/training/files/`；
- **拟合度条（曼波纠正语义）**：`paramFit.js` 引擎(工况)参数 vs 专家(切片)参数贴合度，只在专家声明键上评估；差异项一键「记忆为规则候选」进待审池——知识库覆盖缺口直接度量与记忆闭环；
- **3D 工况标注工房** `annotator.js`（纯 WebGL）：轨道旋转/滚轮缩放/面拾取（单次 draw 颜色属性缓冲）/悬停高亮/遮挡感知标注点/自由标注附备注；工具排=悬空需支撑/受弯/受压/接触面/外观面/自由；空间标注随样本存 `spatial`——人修正几何链路盲区的接口；
- **机型隔离**：`printerFleet.js` 机队档案（`.printer-fleet.json` 人工维护，种子 X1C/P1S/AD5M Pro），样本按 `machine` 归档，几何链路全机通用；
- **outcome 奖励通道 + JSONL 导出**：样本回填打印结果（成功/失败/部分成功+问题），`/api/training/export` 供训练管线；
- **渲染一致性验证**：mesh 端点与特征分析同解析路径，三方对账（三角面/焊接顶点/包围盒）STL+3mf 双格式全 ✓；
- **注册关闭**：`/api/auth/register` fail-closed 403，UI 改「联系 2805328773@qq.com」；
- **测试**：新增 model-features(16)/param-fit(5)/training-store(11) 三套，全量 14 套全绿；push 闸门自动发现 test/*-test.js 已覆盖；
- **npm run push 纯 SFTP 部署**（本版未做顶层归档提交，锚点待补）。

## v49 · 2026-10-13 · 锚点=顶层归档待补（未提交状态 SFTP 直传） · feat

**3D 标注支撑检出具批：悬垂自动染色 + Shift 同特征并选 + 右上角 3D 指向标（曼波三点需求 + 两枚存量 bug 修复）**

- **支撑标注修通（曼波「支撑的标注功能目前还有问题」）**：病根是工具 shape 两边对不上——train.html 配 `survey`、annotator 点击处理认 `support_region`，点击落到点标注兜底，v1.8 支撑染色成死代码；统一为 `support_region`（后缀「点面染悬垂」，survey 仅作历史样本字段兼容）。`?v=20` 破缓存。
- **悬垂检出具（点面）**：平滑洪波（25°）取「人眼的那个面」→ 区内**悬垂带**（朝下、法线与 −Z 夹角 ≤25°=重悬空带、非贴底）染红、其余淡蓝，口径与 modelFeatures.overhangSevereDeg 一致；无悬垂的面点击给提示不落标注。
- **Shift 同特征并选**：候选=全模型悬垂带 ∩ 与种子悬垂带平均法线夹角 ≤30°（朝向相同）∩ 包围盒至少一轴重叠（坐标方向相同，容差 2% span），**单轴区间扫掠+并查集**传递闭包（视图网格上限 12 万面，两两暴力不可行）——一排同高孔位、被筋隔开的同一高度面一次收齐；无同特征给提示。
- **右上角 3D 指向标**：纯 WebGL 三轴箭头（杆+锥+端盖）+ 眼空间背光圆盘，随视角旋转；字母层走 SVG（背向相机调暗）；pick/hover 帧不画（不污染拾取缓冲）；角落 scissor 清深，模型贴边也不遮挡。
- **P0 存量修复：getAnnotations 未定义**——该名字只在返回 API 的属性上，作用域内无函数，全文件 13 处 `opts.onChange(getAnnotations())` 必抛 ReferenceError：标注已 push 且渲染，但 onChange 必炸、页面标注清单永不刷新。补作用域函数并让 API 属性直接引用。
- **染色即时重绘**：recomputeTints 只重传 tint 缓冲从不触发 GL 重绘，区域染色要等下一次鼠标划过才现身——末尾补 invalidate()。
- **指向标转置修复（曼波实测当场抓出）**：首版箭头矩阵把世界→眼旋转写成转置（逆旋转），字母用 basis、箭头用 Rᵀ，动起来对不上；改为 basis 三元组直接作 R 的三列。
- **浏览器实测（IAB + 临时 harness 页，验后即删）**：夹具=立墙+两块同高悬臂+三轴都不对齐的干扰悬臂。普通点悬臂底面=仅该底面染红（faces 2/sup 2）；Shift=两悬臂同染（faces 4/sup 4/shift true）干扰块正确排除；无悬垂面=提示不落标注；孤立悬垂 Shift=「无同特征」提示；同 seed 再点=取消；指向标三角度截图核对字母箭头同步（X 正对相机缩成点）。踩坑：合成点击必须补 mousedown（moved 防抖只在 mousedown 清零）；readPixels 包一层即可窥探拾取真值。
- npm test 全部通过。

## v50 · 2026-10-13 · 锚点=顶层归档待补（未提交状态 SFTP 直传） · fix+feat

**录入工坊补丁批（曼波三条反馈 + 入库 P0 双雷）：载荷性质显显、机队添员、可信度下架、入库链路修复**

- **P0：新登录用户工况区空白、入库永远被拒**——loadTaxonomy/loadFleet/computeFit 只在 init() 的「刷新时已登录」路径调用，登录过渡（renderIdentity）只刷 loadSamples：现场新登录拿到的页面工况勾选区 0 组 0 项，submitSample 恒被「工况勾选不能为空」弹回。重构为 initWorkbench()（TAXONOMY 非空即跳过防双渲染），renderIdentity 统一走它，登录过渡与刷新同路径。
- **P0：所有带工况的入库请求 400（Cannot access 'extraction' before initialization）**——v48 起样本路由里拟合度块引用 extraction 在其 let 声明之前（TDZ），try/catch 兜成 400 文案回给前端；v48 从未上过生产、本地测试又只测 store 不测路由，今日首部署即爆。修法：切片提取块移到拟合度块之前。
- **载荷性质上箭头（曼波：载荷性质没能在箭头上体现）**：loadNature 此前只入存储与 taxonomy 联动。annotator.js 箭头文字改中文三段式「受压载荷·静载·中载」（LOAD_TYPE_LABEL/NATURE_LABEL 映射，受力类型顺势中文化）；train.html spatialLabel 同步补性质+量级；?v=21 破缓存。IAB 冒烟：bending/impact/heavy 桩箭头标签「弯曲载荷·冲击·重载」正确。
- **机队添员 + 可信度下架（曼波点名）**：.printer-fleet.json 与 printerFleet.js 种子新增 Bambu Lab H2D（350×320×325）、Flashforge Adventurer 5M（AD5M，220³）、Flashforge Creator 5 Pro（C5 Pro，256³ 四喷头多色）；机型 reliability 字段无任何消费方（评分职责已归 paramFit）连数据删除，下拉框仅显机型名（原「（品牌｜可信度 75）」尾巴）。C5 Pro 型号全称经 web 搜索核实。
- **回归验证**：本地隔离环境（AUTH_STORE_FILE/TRAINING_FILES_DIR 重定向 + 页内构造 File）真服务端 E2E：退出→重登（工况区自动出 9 组 43 项）→勾选→选机型→入库 → 「✅ 样本 T20261012-001 已入库」列表落行；npm test 全绿。
## v50 · 2026-10-13 · 锚点=顶层归档待补（待推） · fix

**载荷箭头补显「载荷性质」（曼波：载荷性质没能在箭头上体现）**：`loadNature`（静载/动载疲劳/冲击/振动）此前只入存储和 taxonomy 联动（syncLoadsToSelection 本就消费它），箭头标签与标注清单都不显示。① annotator.js 箭头文字改中文三段式「受压载荷·静载·中载」（受力类型也顺势中文化，新增 LOAD_TYPE_LABEL/NATURE_LABEL 映射）；② train.html spatialLabel 同步补性质+量级+类型中文（`?v=21` 破缓存）。IAB 冒烟截图验证：桩选择器落 bending/impact/heavy 箭头，标签「弯曲载荷·冲击·重载」正确呈现。**部署状态：未推，待下次 `npm run push`。**

## v51 · 2026-10-13 · 锚点=顶层归档待补（未提交状态 SFTP 直传） · fix

**面逻辑统一（曼波：接触面识别有问题、受压区是好的，以受压区为准）**：接触面/外观面原走「平滑连通片」洪波（25° 逐步法线，可沿曲面渐变爬出种子法向、绕整圈），受压区走「法向轴向连通」洪波（predAxis：与种子法线平行 ±64°、边邻接连通）。三工具统一为 axis_region，coplane_region 分支与 predCoplanar 死代码删除；悬空需支撑保留独立语义。annotator.js 升 v2.0，`?v=22` 破缓存。24 边棱柱 harness 实测：侧墙点击两工具各染 6 面（轴向行为，旧平滑洪波会染满 24 面），面集合逐一相同；顶面平面上两逻辑本就一致作回归对照。

## v52 · 2026-10-13 · 锚点=顶层归档待补（未提交状态 SFTP 直传） · fix

**支撑标注交互修批（曼波三连：Shift 后大片浅蓝、区内点击取消无效、取消/撤销体验差）**

- **浅蓝溢出双源修**：① Shift 同特征并选不再把命中面各自的平滑片拖进来当淡蓝底，只红染命中面本身；② Shift 种子也改**纯红**（faces==supportFaces，不带淡蓝底）——Shift 语义=精准批量标悬垂；③ 普通点击的淡蓝底保留（「选中的面里不需支撑的部分」语义）但平滑洪波加 **60° 法线锥**（floodSmooth 可选轴约束，口径同受压区 ±64°）——孔壁/圆角不再被爬满一整圈。
- **区内任意面取消**：同工具点击染色区内任意面即取消该标注（原只认恰好点中种子三角，点区内其他面无反应——「取消选中点击还是没有用」）；两条区域分支（support/axis）统一该手势，取消时同步清 selectedId。
- **重做栈**：新增 redo（Ctrl+Y / Ctrl+Shift+Z / 列表「↪ 重做」按钮），snapshot 时截断重做分支；undo/redo 后清失配的 selectedId。
- **回归实测（双隧道 harness，验后即删）**：底块+两条 ∩ 形半圆隧道（洞顶悬垂带 15°/段平滑可爬）。普通点击 A 洞顶=16 面 60° 锥+8 面红带；Shift 点 B 洞顶=两洞顶红带共 16 面、faces==supportFaces（零淡蓝）、A 带被同特征并选；点区内另一面=整条标注取消；undo 恢复/redo 再取消 ✓。

## v53 · 2026-10-14 · 锚点=顶层归档待补（本批 SFTP 直传） · feat

**双品牌纯内网批（曼波令：4A 拔线打印机区转纯内网前把链路做好）——闪铸局域网适配 + 状态观察台 + 文件分发品牌分流**

- **闪铸适配层 `src/printer/flashforge.js`（新）**：LAN Only 模式下 TCP 8898 HTTP REST（社区逆向文档 Parallel-7/flashforge-api-docs，AD5M/5M Pro 固件 3.2.7 校准）——/detail 轮询（5s，FLASHFORGE_POLL_MS 可调）状态归一为拓竹口径 gcodeState（manager.resolveJobEvent 直接复用；取消中归 IDLE 走既有幽灵收尾=失败重排）；/control jobCtl_cmd（pause/continue/cancel，payload JSON 字符串化）；/uploadGcode multipart（serialNumber/checkCode/fileSize/printNow 头）+ /printGcode 两步式分发（先传后打，失败重试不重传）；/gcodeList；8080 MJPEG 摄像头。认证复用 .env 五件套（PRINTER_SERIALS=serialNumber、PRINTER_ACCESS_CODES=checkCode），无凭据 fail-closed 拒连。Creator 5 Pro（四喷头）协议社区未覆盖，按 5M 兼容实现，真机以 /debug rawState 校后再修。
- **manager 品牌分派**：brandOf/cameraKind 纯函数（导出供测试）；拓竹=bambu-link MQTT、闪铸=HTTP 轮询，同一状态机/jobEvent/分发引擎；getAvailablePrinters 拓竹闪铸均自动可分发（原「闪铸走人工通道」退役）；/api/printers 增 brand/camera/cameraUrl 字段。
- **拓竹侧增补**：腔灯 ledctrl 指令（lightControl，MQTT 直发）；TCP 6000 本地 H.264 流中继通道（openCameraStream，每观看客户端独立 socket）。
- **文件分发品牌隔离（dispatcher）**：brandForFile 纯函数——gcode/g/gx→闪铸、其余→拓竹，matchPrinter 匹配层不可见跨品牌机（切片格式互不兼容，跨喂=废件）；远端文件名扩展名跟源文件走；isUnslicedFile 口径同步扩（3mf+gcode 系=切片产物，reservation.js 同批）。
- **提交链路**：上传白名单扩 .gcode/.g/.gx，与 3mf 同走审批直通（参数已定不定档）；3mf 参数提取仅对 3mf 触发（gcode 跳过）；前端 accept/提示/直通横幅同步。
- **状态观察台 `public/status.html`（新）**：机队卡片网格（品牌徽标/状态+失联标注/进度条/三路温度含目标值/当前任务/AMS 或进料口彩色槽位盘）；画面区双通道——闪铸 MJPEG `<img>` 直连服务端代理、拓竹 P1 系「▶ 连接画面」经 WS 中继 + WebCodecs H.264 解码（Annex-B 拆 NALU、SPS/PPS 缓存配 codec、IDR 随机接入，Chrome/Edge 94+）；X1/H2D RTSP 通道占位待接。指令条（admin）：暂停/恢复/腔灯开/关/停止。5s 轮询。预约页页头加入口。
- **端点（index.js）**：GET /api/printers/:id/camera/mjpeg（登录，HTTP 管道代理，主网设备免 31→2 路由即可看 2.x 画面）；WS /api/printers/:id/camera/h264（upgrade 手动 cookie 会话校验）；POST /api/printers/:id/light（admin）。依赖新增 ws@8.22。
- **测试**：test/flashforge-client-test.js 新增 12 项（fetch 桩：报文形状/状态归一/AMS 双口与单口/上传头/失联/fail-closed；显式 process.exit 防 require 链常驻句柄挂闸门）；dispatcher-manual-race-test 桩补 brandOf；UNSLICED_HINT 文案扩双品牌（保留「切片为 3mf」兼容短语，ops-test 连带过）。全仓 15 套件全绿。
- **部署状态**：本批 SFTP 直传；v47 训练架构半成品与 v48~v52 修补随本批首次上线。遗留：拓竹 Access Code 与闪铸 LAN 模式/序列号/检查码均待上屏抄录入 .env（未填前拓竹 MQTT 标「故障」、闪铸拒连，属预期，不碍服务起）。

## v54 · 2026-10-14 · 随顶层归档提交落地 · fix

迁移后全量审查修复批（6 路只读审查产出）：**4 P1**——①src/index.js:450 axis 分支半成品残片 `NOTE_OK` 裸标识符，受弯轴线标注自上线整链 ReferenceError→400，按兄弟分支模式补 return（FileExists 校验 a/b/dir）；②authStore.js:188 `/^[S]{6,}$/` 丢反斜杠致管理员重置密码自 10-12 上线恒失败，改 `/^\S{6,}$/`，同函数「清会话」原挂在无消费方的 user.sessions 上，改为遍历顶层 data.sessions 按 userId 摘除；③index.html:814 unsliced 门未跟 v53 双品牌口径（只认 3mf），闪铸 gcode/gx/g 单审批按钮恒禁用、直通链走不通，前端门与文案对齐 SLICED_EXT_RE；④train.html:552 syncLoadsToSelection() 错位顶层作用域（仅加载时 no-op 执行），归位 onAnnotationsChange 尾部，载荷箭头→隐藏工况勾选组联动恢复。**P2**——⑤annotator.js 六处标注创建漏发 _aid（选中光环/点选路由/编辑删除面板全拿 undefined），新增 pushAnnotation 统一 ++st.seq 发号；⑥trainingStore load 损坏仅 warn 按空启动、下次 save 静默覆盖，补 .corrupt-<ts> 隔离（对齐 reservationStore 口径）。**P3**——slice-with-engine.js Orca 路径两机探测（env 优先）；.env.example 两处文档陷阱修正（USAGE_REPORT_URL 3000→3010、ADVENTURER5 示例型号不命中 brandOf 换 AD5 并加注）。**测试**——ops-test 补 2 断言锁 v53 口径（gcode/gx/g 审批放行 ×3 + 双品牌未切片谓词 ×5）；npm test 14 套全绿。**未动项**：/api/chat/command 加鉴权需与 hub /print-* 转发两仓同批（单边加锁断产线），转待办。

## v55 · 2026-10-15 · 锚点=顶层归档待补（本批 SFTP 直传） · feat

**观察台 v55：H2D 画面通道 + 全量远控面板（真机 H2D 全链路实测，曼波令「所有远控的全部功能」）**

- **H2D 画面通道**：src/printer/rtsps.js（新，零新依赖）自研 RTSPS 客户端——X1/H2D 系画面 = rtsps://bblp:<访问码>@<ip>:322/streaming/live/1（RTSP over TLS，LIVE555 digest 认证；**URI scheme 必须写 rtsps，写 rtsp 会 301**；端口 322，非 554 非 6000）。RTP interleaved 解包（**$ 分帧按位置解析：实测 PLAY 响应回来前 RTCP SR 先到**，二进制与 RTSP 文本混跑必须按首字节分流，跨类型跳字节会把响应文本当垃圾吃掉——首轮实现即栽在这）+ H.264 depacketization（单 NALU/STAP-A/FU-A 重组）→ Annex-B 字节流，与 P1 TCP6000 裸流同款，WS 中继与 WebCodecs 前端零改动复用。真机实测 ≈2.1Mbps，GOP ~5s。
- **v53 遗留双 bug 修复（拓竹画面此前整链不可用）**：①index.js handleCameraUpgrade 把 cookies **对象**传 resolveSession（应传 .bambu_session token 字符串）→ WS 升级恒 401；②status.html toggleP1Stream 未定义（只有 startP1Stream）→「▶ 连接画面」点按 ReferenceError。播放器统一改名 startH264Stream/closeH264Stream/toggleH264Stream，rtsp/p1stream 共用。
- **全量远控**（分级权限曼波拍板：低危 reviewer+ / 危险 admin；动机械仅空闲）：client.js 新增 setSpeed(1-4)/setFanSpeed(part|aux|chamber 0-255)/sendGcode/calibration/home/moveAxis(X|Y|Z，|d|≤100，Z 限速 1200)/unloadFilament（走 bambu-link 现成封装，**参数校验前置于连接检查**）；lightControl 扩展工作灯；manager.js `_bambuClient` 品牌闸 + canJogMachine 状态门（IDLE/FINISH/FAILED，端点 409 硬校验）；index.js 新端点 speed/fan/gcode/home/move/calibrate/unload + pause/resume/light 降档 reviewer+。
- **ledctrl 序号类型修复**：组帧 sequence_id 用字符串致回包匹配器恒超时（bambu-link 自家 sendPrintCommand 全数字），改数字后灯控即回 200。
- **printerStates 反馈字段**：nozzleTargetTemp/bedTargetTemp/fans(part,aux,chamber)/speedLevel(从 raw.spd_lvl)/lights(chamber,work)——增量报文缺省保持 null；前端速度档高亮/风扇现值/目标温度回显。
- **status.html 控制面板**：reviewer 档=暂停/恢复/双灯/速度 4 档 segment/三风扇滑条；admin 档=停止（红确认）/退料/校准/回原点/轴 Jog 垫（XY±10/±1、Z±5）/gcode 直控台（红警示+逐条确认）；动机械按钮非空闲/失联置灰；拖滑条/输 gcode 时跳过 5s 重渲染防打断。
- **WS 中继背压**：bufferedAmount>4MB 丢帧，防慢客户端撑爆服务端内存。
- **测试**：新增 test/rtsps-test.js（13 断言：digest 回归向量/FU-A 重组与半片丢弃/STAP-A/interleaved 分帧「文本保护」回归/RTP 头 CSRC+扩展剥离）+ test/printer-control-test.js（11 断言：canJogMachine 门控表/速度风扇 gcode 轴动参数域/cameraKind 分型）；npm test 16 套全绿。
- **真机联调（本地 H2D=0948BJ672900421@192.168.2.116）**：RTSPS 会话直连 2.1Mbps、WS 中继 7s 1.64MB STREAM PASS、灯控三连 200（修后）、速度/风扇/gcode 200、无凭据 401、坏参 400。生产随本批部署。

## v56 · 2026-10-15 · 锚点=顶层归档待补（本批 SFTP 直传） · feat

**设备化观察台 + 预约页重构 + 审批链审查批（曼波令「bambu 设备 UI 全量实现 + 预约页去学习链路 + 3D 界面嵌入 + 载荷同一链路拟合 + 审批链路审查」）**

- **观察台设备页签**：控制面板重组为页签（状态+画面常驻；温度/风扇速度/AMS/运动/维护校准/gcode 台，reviewer 3 页 admin 6 页，页签态跨 5s 重渲染保留）。新增：①温度控制（喷嘴 0-350/热床 0-120，M104/M140 封装，打印中可调，当前/目标双显）；②AMS 切槽进料（ams_change_filament 自组帧，空闲门控+槽位余量/湿度显示，真机帧格式待回标）；③文件管理（/sdcard 列表/删除/选中 3mf 直接开打 project_file，**FTPS 990 通道**，admin+空闲门控）；④校准细分（full/level=option 1/vib=option 2，社区位口径真机待回退全量）；⑤设备全景条（喷嘴 0.4/HS01、WiFi dBm、固件版本、AMS 湿度、槽位余量）。闪铸卡片保持低危四件。
- **预约页重构**：①学习链路 UI 整体退役（#reviewCard 规则池/专家导入/建议修正按钮/参数预览面板/训练录入链接及关联 JS 全删；服务端端点保留待接回）；②train.html 3D 工况标注界面整体迁入提交卡（WebGL 标注器 annotator.js 复用，STL 选定自动 model-features+training/mesh 装载，孔口候选环直通）；③**载荷工况由 3D 标注驱动**——taxonomy load 组隐藏，标注箭头 syncLoadsToSelection 折算 load_* 勾选进 applyRules 同一条拟合链，只读摘要回显；step/obj 不可标注格式回退手勾；④spatial 标注随单存档（净化逻辑抽 utils/spatialSanitize 唯一权威，训练端点共用；reservationStore 落库+复刻单携带）；⑤train.html 整页退役，样本库管理（列表/回标/删除/导出）并入预约页 reviewer 卡；⑥PARAM_LABELS 保留（列表快照渲染）。
- **审批链高危三连修（审查报告 APPROVAL-CHAIN-REVIEW.md 30 项随批落档）**：①审批↔取消竞态——approveReservation 入队关键路径清 await（群播 fire-and-forget 后置），堵死「已取消单真机开打」；②打印中取消停机失败不再静默（重试一次+人工介入卡过静默闸）；③enqueue 幂等命中显式抛错（不再滞留「已通过」）；④SLICED_EXT_RE 双份合一至 utils/fileTypes（防漂移）。
- **🔥 H2D 文件通道勘误（本批最有价值意外收获）**：真机实测 H2D **22/21 全关（ECONNREFUSED）、FTPS 990 唯一文件通道**——与 P1 系 10-07 实测一致，「X1/H2D 走 SFTP:22」老假设作废。不修则 H2D 真机分发上传步必炸（回滚重试耗尽转人工）。uploadBuffer 全系统一 FTPS 990 优先/21 回退；文件管理同改 FTPS（basic-ftp list/remove）；SFTP 代码保留备查。PRINTER-LAN-API §1.4/§5 已勘误。
- **测试**：新增 test/spatial-sanitize-test.js（7 断言：白名单/封顶/坏数据丢弃/切片口径合一）；npm test 17 套全绿。真机联调：deviceInfo 全活（0.4/HS01/-42dBm）、FTPS 文件列表通（空卡槽 []）、温度下发 200、AMS 坏参 400、无凭据 401。AMS 切槽/校准细分/动机械留页面人工验收（物理动作不代打）。
- **明确不做**：AMS 打印中换料（M620 系待查证）、IPCam/timelapse 设置、多观看者共享流、服务端学习链路端点退役（UI 退役 API 留）。
- **v56 现场热修（同日晚修）**：①观察台页签/面板按键全失灵根因=5s 重渲染守卫误伤（焦点在 .panel 内一刀切拦截，页签按钮也在面板内→永远不刷新），收窄为仅连续输入（滑杆/gcode 输入）跳过；②画面/MQTT 新建连接双双 Not authorized 实锤 **H2D Access Code 于本日某时轮换**（设备证书 CN=0948BJ672900421 未变；旧 MQTT 长连接因不重认证暂存续，断线即失联）——MQTT/RTSPS 401 均加「上屏抄新码」诊断提示。**曼波上屏抄得新码 b0cc08ae，两端 .env 更新+重启，全链恢复**（MQTT 重连成功 + 生产 WS 中继 STREAM PASS 1.33MB/6s）。**教训：Access Code 无常轮换（社区经验~3 个月，本次当日突变）——401/Not authorized 即上屏抄码，已内置诊断提示。**
- **v56 现场热修（画面终局 + H2D 文件通道勘误）**：①画面「已断开」终局定位=**ZCode IAB 内置浏览器的 WS 栈问题**——服务端中继与 node/curl/系统 Edge 全部 STREAM PASS（Edge 无头实测 1.33MB/7s），唯 IAB 内核 WS 拒连（ERROR 1006）；结论：用系统浏览器看。中继策略升级踢旧迎新（超上限淘汰最旧而非拒绝新观看）。②**H2D 文件传输真相**：FTPS 990 在 H2 系列只暴露外置 USB（无 U 盘 STOR 全 553、目录全空——今日实测+社区实锤）；Bambu Studio 不走 FTPS，走 **:6000 TLS 隧道协议（BambuTunnelLocal）写内部 eMMC**；变通=插 U 盘+开「Store Sent Files on External Storage」；正式=移植 :6000 隧道（参考 ClusterM/open-bambu-networking，立项待批）。③真 bug 修复：basic-ftp uploadFrom 传 Buffer 崩溃（source.once is not a function）→ Readable.from 修复。
- **v56 现场热修（自动切片可行性实证）**：scripts/slice-with-engine.js 真机跑通——20mm 立方体 STL → OrcaSlicer（H2D 0.4 机器档 + 0.20mm 基座 + PLA Basic 耗材 + 引擎参数覆盖 layerHeight/wallLoops/infillDensity）→ **60KB .gcode.3mf 产物**（自动重写为原生已切片板形态，剥模型实体）；CLI 退出码 1 仅为无头缩略图缺失，产物完整。**「预约台自动切片」技术可行性闭环**；剩余缺口=①小电脑装 OrcaSlicer（生产机零引擎）②H2D 文件进机通道（U 盘变通可当日闭环 / :6000 BambuTunnelLocal 隧道立项）。
- **v56 现场热修（H2 命令通道全链打通——本批最大成果）**：①**画面终局**=HTTPS 镜像（3443 自签证书）解决 WebCodecs secure-context 限制 + 系统 Edge 实测 1680×1080 画面上屏（ZCode IAB 内核 WS 另有独立问题，走系统浏览器）；②**H2 命令 topic 实锤**：H2 新固件只处理 device/{SN}/request 上的命令，report 上的被静默忽略仅回显（「echo 回包伪装成功」是此前所有远端控制验证的盲区根源——灯控/温度/开打在 H2D 上从来没真正执行过）；connect 后 patch dataUpdateTopic 按机型路由；③project_file 新世代完整帧 + ftp:///<name> 根路径；④uploadBuffer 新世代剥 /sdcard 前缀（H2 FTPS 只暴露外置 USB）；⑤切片桥空 stdin 容错；⑥basic-ftp Buffer→Readable 修复。**真机全链**：小电脑 Orca 切片（60KB 3mf）→ FTPS 上传 U 盘 → request 帧 → 打印机 RUNNING（喷嘴 111° 进入打印流程）→ 空打检测物理暂停（挤出一致性问题需现场处理，非链路问题）。**待办**：①空打暂停的现场处理与测试件清理（U 盘 qianli-test-cube.gcode.3mf）；②工况设计重整（3D 标注 vs 表单划分，独立批次）；③P1 上传通道用新代码复验。
- **v56 现场热修（命令层终审 + 原生界面批）**：①**H2 灯控格式全矩阵实锤**（led_node=chamber_light2/work_light + **字符串 seq** + led_on_time/led_off_time/loop_times/interval_time；旧格式恒 json wrong format）——节点-响应对照物理验证；②统一 _sendChecked（result fail 大小写判定）终结 echo 伪装成功，全部命令自组帧走 request；③**观察台向拓荒原生靠拢**：去页签改 Bambu Studio 式单页分区（温度±10 步进/AMS 色块余量条/控制/移动/维护/gcode）+ **机器助手报错区**（HMS+print_error+fail_reason 上界面，已知码映射表）；④证书信任入 Windows 根存储 + 干净 Edge 实测（secure+webcodecs+画面 1680×1080+错误区三条）；50348044=停止测试件后错误码待归档。**待办**：工况界限重整+特征派生层（下一批首项）。

## v57 · 2026-10-16 · 锚点=顶层归档待补（本批 SFTP 直传） · fix
**真单卡滞修复批（曼波报「怎么还是排队中，逻辑有问题」+ H2D 左右喷嘴口径）**
- **「排队中」卡滞根因（真单 R20261016-002 实况复盘）**：①`manager.resolveJobEvent` 只认 `PRINTING→IDLE` 发 idle——R-001 打印被取消后 H2D 驻留 FAILED，屏幕消除才回 IDLE，这条恢复路径不触发匹配，等待队列静默卡死；改为**任何非空闲态→IDLE 都发 idle**（匹配侧有队列/空闲/槽位多重门控，幂等无害）。②dispatcher 新增**队列兜底扫描**：队列非空时每 60s 补一轮 trigger，覆盖一切事件缺失（重连首报文/丢包/恢复无事件）。③队伍持久化+启动重匹配原有机制无碍——纯事件停摆所致，两处修完事件与兜底双保险。
- **开打帧板型修正（曼波真单 3mf 解剖实锤）**：硬编码 `bed_type=textured_plate` 与其切片产物 `curr_bed_type=High Temp Plate` 错配——板型错配触发 H2 板检测警告/暂停（0500-8051，v55 已实锤），无人值守时必停。slicerExtract 增提 `bedType`（curr_bed_type）与 `filaments`（slice_info.config 用料清单：类型/颜色/用量），**分发时刻现读文件元数据**（老单同样生效），bed_type 随切片映射：High Temp/Smooth PEI→`hot_plate`、Textured PEI→`textured_plate`（token 经 OrcaSlicer.dll 二进制实锤）——提交快照同步入档。
- **用料映射自动化**：新 `dispatcher.buildAmsMapping`——审批指定槽位优先（首条用料映射、多色件其余自动补齐），未指定则按文件用料清单逐条匹配（材料精确/家族 + 颜色 redmean 最近，避开 materialExclude 排除项）；无清单回落旧默认；**外挂料盘编码 ams_id=254/255**（虚拟料位，Bambuddy 同口径）。真单冒烟：PLA 青绿 → 自动命中 AMS 灰 PLA 槽。
- **H2D 左右喷嘴语义（曼波口径 + 官方打印区实锤）**：**extruder 0=左喷嘴**（打印区 0-325、限高 320，外挂料盘侧）、**extruder 1=右喷嘴**（区 25-350、限高 325，AMS 侧，master_extruder_id=2）——client nozzles 增 `side`；观察台喷头卡/预约页喷嘴行「左喷嘴（外挂料盘）/右喷嘴（AMS）」；审批对话框喷嘴下拉同口径；approve 槽位改**按槽位名服务端解析**（amsId/trayId 以实时料位清单为准，防两侧口径漂移）；getAmsTrays 增 `amsId/trayId` + H2D `print.vir_slot` 解析（外挂料盘·左/右含颜色/材料）；切槽外挂参数 254/255。
- **R-001 失败码解码**：`fail_reason 50348044` = 0x0300400C = **HMS 0300-400C「打印已取消」**（非硬件故障；屏幕手停/外部打断/被新任务取消均落此码——v56 测试件停止亦此码留档）。叠加板型错配暂停的现实概率，R-001 现场停止高度疑似「屏幕看到板型提示后手停」——板型修正是本批对症项。
- **测试**：npm test 18 套全绿（新增 resolveJobEvent 恢复路径 4 断言 + buildAmsMapping 三径断言 + 真单 3mf 冒烟）。PRINTER-LAN-API 增 §1.6（双喷嘴/外部料位/开打帧/fail_reason 事实表）+ §4.4/§4.5 口径同步 + 修复 §1.5 末尾历史拼接事故。
- **v57 热修（报错识别，同批续修）**：曼波反馈「机子明明没报错还显示」——实况：H2 固件在打印被取消/失败后**把 `gcode_state=FAILED` + `task_id`/`fail_reason` 挂住**（屏幕首页无报错也照样回传，两端服务数据均为新鲜报文、非缓存旧值）。三件套：①显示口径重做——FAILED 且机器静止（无 activeTask/进度=0）=「任务残留」琥珀信息条（含码翻译：50348044=打印已取消），仅活动打印/有在打痕迹的故障保留红色活跃告警；②新增 `clean_print_error` 清残留（BambuStudio 同款命令，字段 subtask_id/print_error 经 OrcaSlicer.dll 字符串实锤；0 值/真实码/仅 subtask_id 三形态自动回退 + stop 兜底）→ `POST /api/printers/:id/clear-error`（admin，动机械同款状态门：打印中/暂停/准备中拒绝）+ 观察台「🧹 清除任务残留」按钮（admin+确认）；③残留与队列卡死的关联坐实：残留不清，FAILED 不在分发白名单，这台机器永远选不中——按钮即清障口（清后机器回空闲，队列靠 60s 兜底扫描自动续打）。
- **v57 热修2（清残留实测与状态验证链）**：实机实测——`clean_print_error` 四候选（真实失败码 50348044 / 0 值 / 仅 subtask_id / stop）H2D **全部回执「受理」但 gcode_state 69 秒内不离开 FAILED**（Bambuddy#2598 同源教训：success 只代表指令送达≠状态变化；单发无法区分「已生效」与「静默 no-op」）；断单向 MQTT 会话（排「半坏会话」假设）亦无效。**结论：H2 固件此残留为指令免疫，解除路径 = 屏幕处理或重启电源**（本批已把结论前置到 UI：残留条与按钮提示均含「清除无效可在屏幕处理或重启电源」）。落地：①client.cleanPrintError 改为**状态验证链**（候选逐发+每发轮询 gcodeState 离开 FAILED ≤12s + 20s 慢转换兜底，按机器实际状态返回 `cleared`）；②端点加请求日志 + 未清除时 `note` 诚实提示；③按钮按实际结果报告（不再把「指令送达」当成功）；④前端修复配合：用户实测点击未产生请求（两端日志均无记录），端点已加请求日志待下一次点击定位（本机/生产服务均已重启到新代码）。
- **v57 热修3（方案B·残留放行派单，曼波令 2026-10-16）**：曼波确认打印机屏幕真无任何提示、残留纯属固件静默挂态后定案——**分发器放行「静止残留」**（新 `canDispatchResidueFailed` 纯函数：故障态 + gcodeState=FAILED + 无在册任务 + 进度=0 + 报文新鲜由调用方把守）：新任务开打时固件以新状态顶掉残留（Bambu Studio 同口径）；**有在打痕迹的真故障（activeTask/进度>0）仍不放行**。改点：`manager.getAvailablePrinters` 与 `dispatcher.matchPrinter` 双保险同口径（含审批指定打印机路径）；观察台残留条文案同步（派单已放行，清除按钮降级为可选，无效时重启电源）。测试 +2 组断言（dispatcher 匹配三径 + 纯函数五径）。
- **v57 热修4（人工取消不重发 + RUNNING 态入表，曼波令 2026-10-16）**：R003 真单现场——机器上手动取消打印（fail_reason=50348044 取消码）后，系统误走 failTask「失败重排」，配合方案B 的残留放行变成**每 60~90 秒自动重发一次**的循环（20:58/21:00 连发两次），与人的操作对抗。四改：①**机器端人工取消 → 不重发**（新 `humanTerminateTask`：fail_reason 命中 `HUMAN_CANCEL_FAIL_CODES`(0300-400C) 时本地单置「已取消」+ 终止卡 + 提示「复刻」重开；不耗重试次数、不进 givenUp；failed 事件与幽灵收尾两路同判；本系统自己发的 stop 不受影响——dequeue 先释放映射）；②**H2 `gcode_state=RUNNING` 未收录被兜底成「空闲」**——正在打印的机器被误标空闲、误入可派单池（P0 隐患，本批一并实证：R003 第三发时实测 RUNNING）；GCODE_STATE_MAP 增 `RUNNING: 打印中`，resolveJobEvent 的 start 判定并入 RUNNING；③方案 B 顺带实证：**残留被新任务成功顶掉**（R003 第三发后 FAILED→PREPARE/RUNNING，fail_reason 清零）——B 的机制验证通过；④**无限循环的真正机制**：9-27 起的「分发成功即清零重试计数」让「开打→90 秒失败→重排」循环永远停在计数 1、够不到上限 3（R003 实测 9 分钟连发 4 次）；改为**成功分发不清零**——清零只留「人工恢复（manualDispatch）」与「完整件完成（completeTask 续件段）」两个干净起点，快速失败循环封顶 3 次即 givenUp 转人工。测试 +2 组（RUNNING 变迁四径 + 取消码识别五径）。R003 现场已用「取消」终结（队列清空、机器停止）。
- **v57 热修5（控制台停止如实回报，曼波令 2026-10-16）**：曼波反馈「远端控制台停止没用」——排查：stop 帧本身合规范（社区同款 `{"print":{command:"stop"}}`），实际体验多半是热修4 循环的另一面（控制台/屏幕停止 → 400C 被误判失败重排 → 系统又发一次，看起来就是「停止无效」）；且旧端点无论成败一律回「指令已下发」，机器是否真停是黑盒（实测：残留态下 stop 回执 success 但机器零动作）。改：①stop 端点加**状态验证**（下发后 ≤10s 轮询离开打印/暂停/准备态，返回 stopped/state/note；非打印态快速返回「无需停止」）；②控制台停止按钮按状态显示（打印中/暂停/准备中才出现）+ 结果如实 toast；③预约页 printerCtl 停止同口；④终止卡/单据文案覆盖「打印机屏幕或控制台」两种取消来源。遗留：pause/resume 仍为回执级（未加状态验证）；2025+ 固件控制命令签名的社区报告（LINUX DO）待观察——本项目实测 project_file/ledctrl 无需签名可用，stop 若在真实打印中仍 no-op 则按该线索深挖。
- **v57 热修6（审批入库样本·补齐「审批做两件事」之①，曼波令 2026-10-16）**：曼波问「审批栏怎么没见样本录入选项」——v56 退役学习链路时漏掉了最初设计的第一件事（审批决定该单要不要进样本库，第二件=选打印机已在前批落地）。补齐全链：①审批对话框增「📚 入库为训练样本」勾选（提示：打印完成后自动回填成功/失败；无工况勾选/3D 标注的单会被拒入库）；②approve 端点/服务接 `sampleEntry`——勾选即落档决策 + **setImmediate 异步建样本**（文件读+几何体检为秒级 CPU，绝不进入队关键路径，无 await 竞态约束保持）；③新 `reservation.createSampleFromReservation`：与手工录入三方合成同构——几何特征（体检快照优先，3mf 现算）× 人工标注（selection+spatial）× 本单实际参数（3mf=内嵌切片提取；需求链路=引擎定档参数小 JSON 归档，训练消费口径同 extraction）；④trainingStore：样本增 `sourceRecordId` 源单引用 + `setOutcomeBySource` 回填通道 + 3mf 模型/切片同产物归档去重（模型即切片，省每样本一份文件体积）；⑤dispatcher 完成/失败钩子按源单回填真实 outcome（学习奖励通道：成功/失败；多件单全部件完成才判成功，重试成功会覆盖失败）；⑥失败软着陆：文件缺失/勾选为空等 → `sampleError` 落档（不阻塞审批，单据 review 附言含「📚 已勾选入库训练样本」）。测试 222 项全绿（新增：3mf 样本生成+去重+回填；审批管线软着陆）。
- **v57 热修7（工况词汇表 v5 扩容 + 入库原则收紧 + 退役专家导入，曼波令 2026-10-16）**：①**taxonomy v5**（曼波细化令 + 系统补全）：**孔补偿按轴向拆分**——`hole_comp_z`（竖直孔，直径走 xyHoleComp）/`hole_comp_xy`（水平孔，孔顶悬垂），几何体检按孔口拟圆法向自动判别、标注联动默认 Z 向；环境工况 +暴晒/低温/粉尘/防水/食品接触；新增**使用场景**组（测试迭代/基础建设/机器人项目/承力结构/夹具工装/电子外壳/外观展示/教学演示/备件替换 九项）；新增**工艺特征**组（薄壁/大跨桥接/细长高件/精细细节——体检检不到的人工确认区）；耐久 +失效后果（仅外观/影响功能/关键安全）+反复拆装；精度 +关键尺寸公差/后续加工预留；外观 +透光件；热学 +阻燃。**预约页与录入台同源渲染同一词汇表，自动同构**。②**切片直通单同样收集工况勾选+3D 标注**（曼波原则：切片参数由工况×几何共同决定，纯 3mf 无标注的样本无训练意义）——服务端接收落档、前端放开勾选区（选填，不作定档、冲突免检）；③审批入库勾选加**底料门槛**：无工况勾选的单不渲染勾选、给出明确原因；④**退役「导入专家手工切片 3mf」按钮**（曼波定：不存在"专家参数"前置条件——一件一工况；该控件与上方样本录入重复），train.html 移除控件+importExpert3mf 实现，口径统一「本单切片参数」（服务端 /api/print/slicer-extract 保留）；⑤生产两条已采纳规则条件 `through_holes`→`hole_comp_xy` 迁移（保住既有生效）。测试 222 项全绿（taxonomy/体检建议/参数拟合/样本库断言全部对齐 v5）。
- **v57 热修8（工况词汇表 v6 删减，曼波令 2026-10-16）**：移除四项——「低温环境（≤0°C）」（环境组）、「高温（80–120°C）/超高温（>120°C）」两档（≥80°C 需求改由 tooltip 引导走人工评审）、「抗冲击」「耐磨」（耐久组；载荷性质里的「冲击」保留）。联动：冲突规则 temp-vs-pla 收窄 `['t80','t120','t120p']`→`['t80']`；种子规则同步（temp-exclude-pla 收窄 ['t80']、temp-exclude-petg 与 wear-pa 随档位退场）——生产/本机两侧规则库均已在线迁移（temp-exclude-pla upsert + 两条 remove，零残留旧档位引用）。测试 222 项全绿（分类断言/参数拟合/样本库用例全部对齐 v6）。
- **v57 热修9（喷嘴温度打包值解码，2026-10-16）**：曼波截图 2752554°/14418139° 天文数字——H2 新固件**打印中**把 `extruder.info[].temp` 换成 `(target<<16)|current` 打包值（实测 14418139→14418140：低 16 位=实时当前随温度递增、高 16 位=打印目标恒定；空闲态普通数值）。`decodeNozzleTemp` 阈值判别（>1000 按打包解码）兼容两形态；副喷头目标温度顺带从打包值回填（打印中才有）。测试 +1 组（实测采样点断言），223 项全绿。
- **v57 热修10（喷嘴左右实证修正 + 活动喷头判定 + 面板去重，曼波反馈 2026-10-16）**：①**左右映射翻转**——运行中打印的热喷头 = extruder id1 且其料位指向外挂（snow=254），与曼波「左喷嘴是外挂料盘」双重印证：**id1 = 左喷嘴（外挂料盘）、id0 = 右喷嘴（AMS）**；旧「Orca 机档数组顺序」推导作废（官方打印区/限高数据只描述几何，下标↔固件 id 对应判错）——观察台/预约页/审批对话框/审计文案全部随 `side` 字段自动翻转；②**「◀当前」误标修正**：tar_id 打印中指向冷喷头不可靠——改按顶层 `print.nozzle_temper`（恒跟随实际打印喷头）与各喷头实温最近者判活动，退回 tar_id 兜底；③**数据面板去重**（曼波：ams 和温度出现了两次）：cardHtml 顶部摘要条仅对无控制面板的角色/机型（非 reviewer、闪铸档）展示，reviewer+ 拓竹机的「🌡 温度 / 📦 AMS 耗材」控制面板即唯一来源；腔室温度并入温度面板标题、AMS 湿度归 AMS 面板头。测试 223 项全绿。
- **v57 热修11-13（X1C / 闪铸A5P 双机接入 + 闪铸真机链路三连修，曼波令 2026-10-16）**：两台新机入系统——**X1C**（192.168.2.189，序列号经 MQTT `device/+/report` 通配订阅实证 `00M09D541710031`；访问码 6bf2ce5d）+ **闪铸 A5P**（Adventurer 5M Pro，192.168.2.223；序列号经 8899 文本口 `~M115` 实证 `SNMOMF9302026`、8898 checkCode 认证通过）写入 .env 部署。伴随三连修（真机首秀暴露的 v53 遗留）：①**manager.handleStateChange 契约缺口**——flashforge 客户端未实现 `getDeviceInfo` 且 manager 无守卫：每次状态事件抛 TypeError 被监听层吞掉（客户端已连接、报文在流，管理面状态永远空白）；manager 加存在性守卫 + flashforge 补同形状 getDeviceInfo；②**闪铸桩测试纳入 npm test 链**（v53 漏挂）并补 getDeviceInfo 契约断言；③**闪铸 /detail 信封解包**——真机返回 `{code:0,detail:{...}}` 此前直存信封致温度/进度/进料口全空、状态兜底 IDLE（v53 桩夹具误用内层形状掩盖了 bug）；pollOnce 解包（兼容裸内层固件）+ 桩夹具改真机信封形状 + 温度浮点取整显示。**三机全活实证**：H2D 打印中/RUNNING（右42°·左●221°、进度 80% 全程未触）、X1C 已完成/FINISH（32°/28°）、闪铸A5P 空闲/IDLE（30°/27°、左右进料口入列）。
- **v57 热修14（3D 工坊「放置平面」·曼波令 2026-10-16）**：同切片软件 Place on Face——①`annotator.js` 核心：按钮进入模式 → 悬停高亮面（polygonOffset 防共面 z-fighting）→ 点面即四元数旋转把该面法线转到 -Z（盘面朝下）并整模落到 z=0；**标注坐标全量随动**（pos/c/a/b/n/dir/normal 变换；region/faces 面序号旋转不变）；变换栈支持逆序精确复位；Esc 取消、选标注工具自动退出（互斥防误转）；②**双页同构**：预约页 + 录入台同一组件同按钮（⬇ 放置平面 / ↺ 复位放置），复位按钮按有无放置显隐；③**随档**：预约单与训练样本均新增 `placement`（累计四元数）——标注坐标在放置后朝向帧里，此值即朝向帧↔原始文件坐标换算桥，供未来切片烘焙（slice-with-engine 尚未接线，先存档）；④顺带修复：客户端此前对切片直通单仍把 selection/spatial 置空提交（v5 原则服务端已放行、客户端漏改）——3mf 单的工况勾选与 3D 标注现在真正随单入库。四元数数学四情形冒烟 + 223 项测试全绿。

- **v57 热修15（放置平面按钮可见性，曼波反馈 2026-10-16）**：按钮此前误置在默认隐藏的 `#loadTypeRow`（载荷标注工具行，未选该工具不显示）内，改为工具行下方常显区；两页 `annotator.js` 引用统一 `?v=24` 修缓存（此前录入台带 v23/预约页裸引，新代码可能吃不到——同构缺口）。
- **v57 热修16（直通单机型全链·「选 A5P 却被分到 X1C」真机反馈，曼波令 2026-10-16）**：根因——拿闪铸机子切的 Orca 工程 `.gcode.3mf` 被扩展名判成拓竹品牌 → A5P 被品牌闸门排除 → 匹配 fallthrough 静默改派 X1C（曼波秒撤两次）。四层修复：①**指定即权威（钉死）**：指定机不在候选（品牌不符/忙/失联）→ 滞留等人工，绝不改派他机；②**内嵌机型优先**：品牌判定以切片文件自带 `printer_model`（project_settings 优先、slice_info.printer_model_id 兜底）为准，扩展名仅兜底——提交/审批/分发三层统一 `brandForFileWithMeta`；③**闪铸直通 3mf 全链**：分发时提取内嵌 `Metadata/plate_1.gcode` 按 `.gcode` 上传（闪铸固件只吃裸 gcode，zip 直传必废；真机实证：内嵌 gcode 尾部 CONFIG_BLOCK `printer_model = Flashforge Adventurer 5M Pro`）；④**审批界面定好机型**：显示「📦 文件内嵌机型：…」+ 同品牌唯一机**预选锁定** + 品牌不符机型不列出（附说明）。顺带：培训样本测试 PID 复用污染修复（开工清档——Windows PID 回收致跨运行样本叠入，曾现重复样本号假失败）。测试 225 项全绿。
- **v57 热修17（通知结构重整，曼波令 2026-10-16）**：①webhook 换群（本批当时将 BOT_WEBHOOK_URL 整体指向新群——后经曼波澄清于热修18 更正为分流）；②**审批结果与排队通知合并为一张卡**（新 `buildApprovedQueuedCard`：审批通过·已入队 + 队列位次 + 任务/材料/分发指定/审批意见；approve 路径 `enqueue(task, { silent: true })` 改由合并卡统一播报；驳回维持单独结果卡）；③**打印开始不再播报**（`buildJobStartCard` 整体移除；合并卡「匹配成功即开始打印」已交代后文；广场动态仍记账；完成/失败/缺料/人工介入卡保留）。
- **v57 热修18（通知分流更正，曼波澄清 2026-10-16）**：正确口径=「**有人预约需要审批**」提醒投**话题群专用钩子**（新配置 `APPROVAL_WEBHOOK_URL`，未配置回落默认群）、**其余播报全部留在机械组**（BOT_WEBHOOK_URL 恢复原址 `86aaf3f6…`）。插曲：热修17 覆盖 BOT_WEBHOOK_URL 时未留备份、push 又同步覆盖生产 .env——原址最终从 **ZCode 会话数据库**（db.sqlite 内早前会话记录的 .env 原文）找回；机械组钩子与工单机器人共用（其 .env 亦存一份）。`sendMessage(card, targetUrl)` 支持目标覆盖；`notifyReviewers` 改投审批钩子。
- **v57 热修20（3mf 几何特征估计链，曼波令+截图为证 2026-10-16）**：曼波指出「3mf 直通样本特征未提取，缺的是几何特征估计」——核查实锤：**切片导出件 .gcode.3mf 不含网格**（3dmodel.model 为 928B 空壳 `<resources></resources>`，切片器导出即剥离），网格级提取不可能，只能估计。落地：①新 `modelFeatures.estimateFromSliced3mf`：从 gcode/切片元数据估计几何特征（G1 移动坐标扫描包围盒 + 头注释 max_z_height + 层数 + 切片重量÷密度体积），孔/悬垂/曲面等网格级特征置 null 并注明；②`featuresFromSliced3mf` 统一入口（含网格→网格分析 `auto`；无网格→gcode 估计 `gcode-estimate`），顺带补 `parse3mfModel` 的 `3D/3dmodel.model` 标准布局解析（完整工程 3mf 用）；③样本落 `featureSource`（auto / gcode-estimate）+ **低权重 confidence=40**（曼波令：自动几何特征赋额外低权重）；④新增修复端点 `POST /api/training/samples/:id/refit-features` 并按归档模型修复存量两样本（T-001/002：173.3×160×59.6mm/297 层/14.39cm³，工况勾选原样在）。真单文件实弹验证 + 225 项测试全绿。
- **v57 热修21（画面显式连接，曼波截图反馈 2026-10-16）**：曼波「没有连接画面的按钮，我进这个页面是这个机子会莫名其妙无操作自己播放」（闪铸A5P 卡「画面不可用」）——旧行为=进页面即自动拉 MJPEG 且断开后 5s 重连，无人操作也在后台反复连接。改为**显式连接**：①MJPEG 分支同拓竹口径——占位提示 + 「▶ 连接画面 / ⏹ 断开画面」按钮（`toggleMjpegStream`），`mjpegWatch` Set 记录在流机；不点不连、点了才拉；②`loadFleet` 增重绘守卫（有在看的流且非 force 时跳过整绘，防状态轮询把 `<img>` 顶掉重启连接）；③失败落 `mjpegFail` 展示原因。A5P 实测：8080 TCP 通但 HTTP 零响应（打印机侧摄像头未出流）——需现场查打印机屏幕「设置→摄像头」开关/重启电源后点按钮复验，代码侧链路已就绪。
- **v57 热修22（多耗材 3mf 全链·「文件里有几个耗材审批界面就有几个栏位」，曼波令 2026-10-16）**：审批对话框用料指定从**单槽位**升级为**逐条耗材栏位**（预约与录入同构口径）。①**UI**：openApproveDialog 读 `embeddedParams.filaments`，每种用料渲染一行（「用料 i：类型 + 色块」→ 槽位下拉，含余量/颜色明细），**逐条可留自动**（留自动=分发时按该条类型/颜色匹配）；无内嵌用料的文件保持单栏旧路径（tray）；`renderApTrays` 同步填充全部槽位下拉（`.apTraySel` 逐条 + 旧单栏），apGo 收集 `dispatch.trays=[{slot}|null,…]`；多耗材时对话框顶部提示「🧵 文件含 N 种用料」；②**服务端**：approve 接收 `dispatch.trays`，与文件用料**逐条对齐**按槽位名服务端解析实时料位 id（null=留自动，坏槽位名 400 打回并列出可选）；`task.prefTrays` 随任务入队列（持久化重启不丢）；状态注记/审批合并卡给出「用料 1→自动 2→外挂料盘·左」摘要；③**分发**：`buildAmsMapping` 增 prefTrays 分支——指定条目用指定（指定即权威）、留空条目按该条用料 autoMapEntry；`matchPrinter` 槽位复验对每条非空指定逐条检查（分发时刻换料/抽走 → 滞留等人工，不静默换槽）；开打帧 `ams_mapping2` 逐条下发；④**录入台**：🧈 切片参数面板显示用料清单（N 种 + 类型 + 色号，同源 `/api/training/analyze-slice` 返回）——预约侧栏位与录入侧清单同源同构；⑤测试：buildAmsMapping 增逐条/全空两径断言 + approve 多耗材解析/坏槽位打回端到端用例，**226 项全绿**；双端部署（小电脑 + 台式机本机实例）完毕。真机验证待有 2+ 耗材的真单走一遍（R-007 已在闪铸新链路真机打完 FINISH——内嵌 gcode 直通首单结项）。
- **v57 热修23（双新机观察台按钮修复批·「按钮交互没效果」，曼波反馈 2026-10-16）**：X1C 与闪铸A5P 的观察台按钮点击无效果——逐个实证三个根因，全部真机验证：①**X1C 灯控节点名错**（生产错误日志实锤 `did not find the valid led: chamber_light2`）：旧代码把 `/H2|X1/` 一视同仁发 `chamber_light2`（H2D 专用副腔灯节点），而 **X1C 只有 `chamber_light`/`work_light`**（lights_report 实证）——修：`lightControl` 按机型分型（H2→chamber_light2、其余新世代→chamber_light；工作灯同名）；**真机物理验证**：X1C 腔灯 开→关→开 全链 lights_report 如实翻转；②**闪铸 /control 指令信封错**（最大的一个）：旧实现发 `{"<命令名>":{...}}`（如 `{"jobCtl_cmd":{"action":"pause"}}`），而协议要求 **`{"cmd":"<命令名>","args":{...}}`**——错误形态被固件当未知命令名**静默忽略且仍回 `{"code":0,"message":"Success"}`**（文档原话+真机实证：灯控回 Success 灯零动作；暂停/恢复/停止三键同病）——修：新 `sendCommand(cmd,args)` 信封统一组帧（pause/resume/stop/light/清屏/摄像头流六路全走它）；认证失败可区分（错 checkCode 回 code 1）；③**闪铸摄像头需显式开流**：5M Pro 摄像头**先 `streamCtrl_cmd open` 才出流**——开流前 8080 TCP 通但 HTTP 零响应（热修21 遗留的「画面不可用」根因解除）；**真机验证**：开流后 MJPEG 正常出帧（抓帧成 JPEG 可见打印舱画面），代理层已接线（进端点自动开流、最后观看者断开自动关流、观看计数防抖）；④**闪铸清屏弹窗**：打印完成/取消后屏幕弹窗会挡后续控制（文档明示）——`stateCtrl_cmd setClearPlatform` 等价屏幕上点掉弹窗；`/clear-error` 端点闪铸分支改走它（响应带 `screen:true` 如实标注「无状态验证」），观察台闪铸卡在「已完成/故障」态显示「🧹 清屏弹窗」按钮（admin）；⑤**灯控边界如实记录**：A5P 固件 5.1.9 当前「已完成待清屏」状态下 `lightControl_cmd` 被受理但零动作（lightStatus 恒 open + 摄像头帧亮度数值比对无变化，多形态 swept 全无效；`/product lightCtrlState=1`）；文档明示弹窗挡控制——**待现场清屏后复验**，若仍无效按固件差异处理（PRINTER-LAN-API §2.2 已记事实边界）；⑥测试：闪铸桩测改 cmd/args 形态断言 + 新增清屏/摄像头流用例，printer-control 新增灯控节点分型用例（H2D/X1C 两机四断言），**227 项全绿**；双端部署完毕。附带教训：诊断脚本误 `require` manager 触发全机自动连接（H2D 打印中，仅 pushall 只读无影响、打印全程无扰，88% 实测在跑）——规矩不变：诊断只直用 client 类，禁用 manager/dispatcher require。
- **v57 热修24（回执丢失自愈·「给 X1C 发了任务选 AMS PETG 也正常打了，为什么机器人在报错」，曼波反馈+截图为证 2026-10-16）**：实况复盘——曼波审批 R20261016-008（指定 X1C + 用料 1→AMS 0 PETG）后，**机器正常开打（X1C 8% 实测在打），但系统侧一路报错**：①分发时 `project_file` 命令**回执超时**（bambu-link 按 `print.sequence_id` 匹配回执，10s 未匹配即抛 `Command timeout for sequence 10194`——X1C 的回执形态与匹配键对不上；H2D 数字 seq 可匹配、X1C 疑似字符串回显，同一固件族两机行为不同）→ ②误判分发失败**回滚「排队中」**（单据显示「分发失败回滚」、机器却在打）→ ③队列 60s 兜底扫描每轮报「指定打印机「X1C」当前不可用——滞留等待人工」刷屏错误日志 → ④**潜在二次开打**：机器打完空闲后队列重试会再传再打同一文件（dispatchRetries=1，最坏 3 次）。三层修复：①**manager 回执丢失自愈**：`startProjectOnPrinter` 捕获 `Command timeout` 后**状态验证**——20s 内轮询机器进入 准备/打印态（PREPARE/RUNNING/PRINTING/RESUME/SLICING 或进度>0）即按分发成功返回 `{ackLost:true}`（否则原样抛错走既有回滚链，真失败不受影响）；②**dispatcher `reconcileLostAck`**：队列任务 × 打印机实况对账——某机**正在打印的 subtask_name 与本任务文件同名**即补记「打印中」移出队列（自愈已回滚的滞留单，防二次开打；闪铸侧 getPrintStatus 补 `subtaskName`（printFileName）同口径支持）；在 `match()` 入口每轮先跑；③**滞留日志节流**：同一任务「指定机不可用」警告 60s/轮 → 10 分钟记一次。**生产实证**：部署后下一轮扫描即自愈——`R20261016-008 回执丢失自愈：X1C 正在打印同一文件「7单元U段八木_第二版(2)_PETG_1h17m.gcode.3mf」——按已分发补记（打印中，移出队列）`，单据轨迹收尾为「打印中｜回执丢失补记：已在 X1C 打印」，队列清空、错误刷屏停止；该单完成后正常走完成播报+训练样本回填。测试 +2（回执自愈超时两径：机器在打=成功/机器空闲=原样抛错；reconcileLostAck 同名自愈+异名不误判），ops-test 增 `PRINTER_HOSTS` 空置隔离（此前该套件会真连生产三机——manager 单例 require 即 init），**229 项全绿**；双端部署完毕。

### v57 热修36 · 2026-10-19 · 随本提交落地 · feat+fix

**审批前自动切片预览 + 全量审查修复批（曼波令「全量审查和审查功能链路，迭代」）**

- **审批台 STEP 自动切片预览（回答「step 上传是自动切好给我审批吗」）**：此前切片只在分发时刻发生（审批通过→匹配到机→ensureSliced），审批人看到的是裸模型。新增 `POST /api/reservations/:id/slice-preview` + `GET .../slice-preview/layer?i=`：在审批预览弹窗里按「目标机 × 审批份数 × 审批快照参数」现场切片（仅预览不下发），返回盘内 object 数、回读拟合、切片器缩略图与**真实 gcode 逐层截面**（Z 层滑块）；缓存 30 分钟 / 4 单上限，与已有已切片单的层截面查看共用渲染器。approve.html 打开未切片单的预览即自动触发，审批人先看「这就是通过后将实际打印的切片（N 件/盘一次成型）」。
- **审查修复（安全/一致性）**：①`parseCookies` 畸形百分号编码不再抛（普通请求 500、WS upgrade 更会炸进程）＋upgrade 回调整体兜底；②`/api/chat/command` 加「本机回环」默认门（跨机须 X-API-Token，hub localhost 零改动）；③份数服务端钳制 1..99 整数；④预约提交两处早期 400 补删上传文件；⑤训练样本 outcome 回填提权 reviewer+（学习信号不被随手改）；⑥改密摘除其余会话、最后一个 admin 不可降权；⑦status.html 内联 onClick 字符串参数改 JSON+HTML 双转义（文件名的引号不再逃出 JS 串）；⑧规则库/账号库损坏隔离补齐；⑨训练样本 id 改「当日最大号+1」（删除后不再重号）；⑩3mf/gcode 解压炸弹护栏（adm-zip 先看 header.size，gcode/PNG/config 分级上限）＋层截面总段数预算抽稀。
- **审查修复（分发正确性）**：①自动切片改**审批快照参数优先**，缓存签名含机型/材料/勾选/参数（规则库演进不改已审批口径、重试不串档）；②份数清零挪到「开打成功之后」——上传/下发失败重试不再把 4 份单静默缩成 1 份；③产物 object 数≠请求份数即报错（排布失败不静默少打）；④自动匹配与 dispatch 双重排除「printing 在册」打印机；⑤回执丢失自愈不顶替已有在册任务的机器、跳过已取消任务；⑥老世代 P1/A1 project_file 补 `ams_mapping`（多料件不乱取槽）。
- **P0 实锤修复（部署后回捞生产错误日志发现）**：`_patchCommandTopic` 的日志插值引用未定义的 `model`，ReferenceError 被 try 吞掉——自能力矩阵重构起 H2D/X1C 的命令 topic 从未真正切到 `device/{SN}/request`（灯控/温度/开打命令发到 report 会被新固件静默忽略，只回显不执行）。改为 `this.config.model`，并加回归单测（X1/H2→request、P1/A1→report）。
- **测试**：25 套全绿（新增 auth 2 项、份数护栏 1 项、compactLayers 1 项、命令 topic 回归 1 项；实跑 P1S 4 份黄金件 4 object / 回读 94.3% pass）。部署：`npm run push`（纯 SFTP）。

### v57 热修37 · 2026-10-19 · 随本提交落地 · fix

**P1S 开打 9 秒「打印异常」假失败修复（FINISH→IDLE 终态清除被误判幽灵中断）**

- **实况（曼波截图 R20261019-003 滑台_PETG_1h7m.gcode.3mf）**：审批直发 P1S 后 9 秒收到「打印失败：打印机回空闲且无完成事件」异常卡并回滚排队，但机器实际正常在打（8%、剩余 61 分钟）；33 秒后回执丢失自愈又补记回「打印中」。日志序列实锤：`project_file 下发 → P1S 任务变迁 FINISH→IDLE (idle) → 9s 后失败收尾 → 28s 后 PREPARE→RUNNING (start)`——即新任务刚下发时，**上一单的 FINISH 终态先清回 IDLE**，被 `resolveJobEvent` 的通用「非空闲→IDLE = idle」视为打印中断。
- **修复**：dispatcher 的 idle 分支读取事件里的 `prevState`——只有**从打印态（RUNNING/PRINTING/PREPARE/PAUSE 等）回空闲**才按幽灵失败收尾；`FINISH/FAILED → IDLE` 是上一单终态清除（新任务还在装载窗口），只记日志并继续观察；空 prevState（重启首报文）维持原幽灵判定。真实中断（打印中直回空闲）与首报文幽灵收尾行为不变。
- **测试**：dispatcher-manual-race 新增 6b 两断言（FINISH→IDLE 后任务仍在 printing、不写回排队中）；25 套测试全绿。部署后需真实单再验一次卡面不再误报。

### v57 热修38 · 2026-10-19 · 随本提交落地 · fix

**自动切片 3mf 上传 P1S 超时修复（2.37MB / 29.6s > 15s 控制通道超时）**

- **实况（曼波 STEP 单 R20261019-004 相机支座.step）**：切片成功（1 object、回读 94.3% pass），但三次分发均报 `FTPS(990) 上传失败（Timeout (control socket)）`。切片产物 2.37MB，从部署机用 120s 超时实测上传耗时 **29.6s**；原 `new FTPSClient(15000)` 的 15s 是**控制通道**空闲超时，传输期间固件不吭声就被误判——此前 R-003 的原始 3mf 仅 486KB，未暴露。
- **修复**：控制通道超时 15s → 120s（`FTPS_CONTROL_TIMEOUT_MS` 可配），外圈总超时 90s → 300s（`FTPS_UPLOAD_TIMEOUT_MS` 可配，兜住多份大盘）；FTPS 会话改为**用完即关**（P1/A1 嵌入式 FTP 对空闲控制连接不友好，复用会空等超时）；上传完成日志带 KB/耗时。桩测补控制通道超时 ≥120s 断言。
- **验证**：部署机真实上传 2.37MB 切片 29.6s 成功并删除；修复后重发 R-004 正常开打。

### v57 热修39 · 2026-10-19 · 随本提交落地 · fix

**切片回读 ironing 假差异修复（"no ironing" 未识别 → 94.3% 变 100%）**

- R20261019-004 切片产物实测 `project_settings.config` 的 `ironing_type = "no ironing"`（Orca 2.4 的关闭值），而提取枚举只认 `"none"`，导致默认关闭被误判为开启，回读拟合白扣一项（94.3% / 12-13）。补 `"no ironing" → false`，同一文件回读 **100%（13/13）**；learning-loop 补三项枚举断言（no ironing/none/top）。
- 该单切片实测：1 object、220 层、z 0.2–44mm、PLA、纹理 PEI 板、支撑 tree(auto)、0.2mm 层高——与审批快照参数一致。

### v57 热修40 · 2026-10-19 · 随本提交落地 · feat

**自动摆向真正落地（directionStrategy 从「只写参数」变「切片前转向」）——相机支座 STEP 实锤**

- **曼波反馈**：「这样打印仅有小部分接触打印盘并带来大量无意义支持，摆盘方向有问题」。几何核对：原 CAD 朝向底面接触仅 600mm²、支撑面积 3487mm²；切片产物支撑挤出占总量 **44.4%**（12763/28771）。
- **修复**：新增 `src/services/modelOrient.js`——24 轴向摆向搜索，按「底面接触 ≥ 最大接触 35%」过滤后优先选**支撑面积最小**的朝向（最大接触面未必最优：120×44 面接触 5290mm² 但支撑 1944mm²；反向大平面接触 3863mm²、支撑仅 100mm²）；`directionStrategy=keep` 保持原向，用户手动放置（placement 四元数）优先烘焙、不再自动改向；STL/STEP 都生效，切片缓存签名加 orient v2 使旧产物失效。
- **实测（同一 STEP 重切）**：新摆向 220 层 / 高 44mm / 回读 100%，支撑挤出 **929（5.5%）**、总挤出 17007（原 28771，-41%）、文件 363KB（原 2.32MB）；支撑面积 3487→100mm²、接触 600→3863mm²。
- **集成**：审批预览与分发日志带摆向说明（底面积/支撑面积/高度前后对比）；`model-orient-test` 5 断言（放倒、keep、放置优先、四元数、STL 往返）；全量 26 套测试全绿。
- **放置优先实锤**：R-004 存档带 Place on Face 四元数 `[0,0.707107,0,-0.707107]`——旧切片链未消费该字段，才按 CAD 原始朝向直切；生产预览现按放置烘焙（158 层 / 高 31.6mm / 回读 100%），支撑挤出 24.4%（原 44.4%）。无放置单的支撑优先自动摆向另验证：220 层 / 高 44mm / 支撑挤出 5.5%（929/17007）。

### v57 热修41 · 2026-10-19 · 随本提交落地 · feat

**几何特征 → 摆向进入学习回路（标签 / 策略拟合 / 执行三层落地）**

- **样本层**：新增 `orientationExtract`（3mf model_settings.matrix / 3dmodel build transform → 四元数）；训练样本新增 `orientation` 标签（`{quaternion, source}`）——预约 Place on Face 为人工强标签，专家 3mf 变换为弱标签；审批入库与标注工房都落库。旧纯切片 3mf（几何烘焙、无矩阵）如实无标签。
- **策略层**：新增 `orientationFitter`——对带标签样本生成 24 候选度量，用权重网格（接触/支撑/高度 + 最低接触比）学 top-1 摆向选择，按几何家族 LOFO 验证；样本 <6 或家族 <3 明确 insufficient，不编造策略；产出写 `orientationPolicyStore` 的 candidate，人工 adopt 后才生效。
- **执行层**：`modelOrient` 接受学习策略（归一化指标加权），autoSlice 用「审批快照显式策略 → 已采纳策略 → 冷启动启发式」；缓存签名带策略版本；用户手动放置仍最高优先。
- **接口**：`GET /api/training/orientation/audit`、`POST /api/training/orientation/fit`（candidate）、`POST /api/training/orientation/adopt`（admin）；CLI `scripts/fit-orientation.js`。
- **样本库现状（真实）**：10 条 / 8 家族，全部是已切片 3mf，`orientation`/`placement` 标签 **0 条**——本轮拟合返回 insufficient，摆向仍走冷启动；已补齐新样本的标签链路，后续 STEP/STL + Place on Face 单会自动积累。
- 测试新增 `orientation-learn-test` 5 断言（矩阵提取/体检/不足门/合成 9 样本 LOFO/策略执行），全量 **27 套全绿**。

### v57 热修42 · 2026-10-20 · 随本提交落地 · fix

**人工取消直接落「已取消」，不再闪排队中（R20261019-004 实况）**

- **实况**：曼波令停 P1S 后，系统停止指令没有 0300-400C fail_reason（R-004 的 failed 事件 failReason=0），dispatcher 走 failTask → 单据先回「排队中」，再靠手动取消才落「已取消」。
- **设计**：新增「人工停机意图」——停止端点在下发前 `markHumanStop`（同步写 task.humanStopRequested，随状态文件落盘），`failed/idle/finish` 事件看到标记直接 `humanTerminateTask`（本地单落已取消、不重排、不进 givenUp）；停止确认生效后 `finalizeHumanStop` **立即收尾**，不等后续事件；停止指令失败/机器未响应则清除标记，避免把后续真实失败误判为人工取消。
- **打印机屏幕/外部客户端取消**：继续认 fail_reason 0300-400C（50348044）；failed 事件新增 failReason 日志，后续实测到变体码可直接补码表。
- **卡片**：人工取消改用新 `buildJobCancelledCard`（灰色「⏹ 打印已取消」，不再写「请检查断料/堵头，处理后会重新排队」，取消不重排）。
- 测试：dispatcher-manual-race 新增 6c/6d（标记 failed 不收尾、finalize 立即取消），24 断言；全量 27 套全绿。

### v57 热修43 · 2026-10-20 · 随本提交落地 · fix

**打印预约播报静默期直接丢弃，不再早晨补发（曼波令）**

- **旧行为**：02:00–09:00 静默窗口内所有 webhook-card（预约审批提醒/审批结果/排队/完成/失败/缺料）落 `.quiet-backlog.json`，09:00 原样补发——半夜的排队/完成卡到白天已过时，制造噪音。
- **新策略**：`gatePayload` 对 `webhook-card` **直接丢弃**（日志记「静默窗口内丢弃（打印预约播报不补发）」），不写积压；`dm-text` 等非群播载荷仍保留积压语义，`gateTask` 不变；加载旧积压时自动清掉遗留的 webhook-card 条目（DM/任务保留）。`opts.drop` 供未来一次性通知显式复用。
- 测试新增 `quiet-hours-test` 4 断言（群播不落盘/DM 仍积压/旧积压清理/窗口前置），全量 28 套全绿。
- **部署状态**：当前开发机不在实验室网段（192.168.31.57 ping/SSH/API 均不可达），本版已提交、待网络恢复后 `npm run push` 上线。

### v57 热修44 · 2026-10-22 · 随本提交落地 · fix

**机端↔监测台双向同步及时化 + A5P 假 AMS 清理（曼波令「互相覆盖都应该及时支持」）**

- **实况**：R20261022-004 分发 A5P 时日志报「用料 PETG 无匹配，回落 AMS0 槽 0」——A5P 是闪铸单喷头机根本没有 AMS；且闪铸 5M 系 `getAmsTrays` 把「余量约Xg」塞进 `type` 字段，监测台当料名渲染、分发映射当材料匹配，两处全被污染。
- **闪铸不开打帧映射**：`dispatcher.dispatchTask` 按 `printer.brand` 分流——闪铸目标直接给空 amsFrame（`startProjectOnPrinter` 闪铸分支只 `startFile`，Bambu 口径的 ams_mapping 本就不消费），误导日志与空跑计算一并消失；拓竹路径行为不变（ops-test 20 断言仍绿）。
- **余量与料名分离**：闪铸 5M 系料盘改出 `remain`（克数取整）+ `remainUnit:'g'`，`type` 恒空——机端本来就不上报料名/颜色，不冒充；观察台 tray 卡按克数展示「余量约 Xg」（区分 AMS 百分比进度条）、未知料显「未知料」；主页打印机卡 AMS 摘要同口径（`进料口·余量约912g`）。
- **闪铸隐藏「切此槽」死按钮**：`amsChangeFilament` 仅拓竹实现，闪铸料卡不再渲染必然报错的切槽按钮。
- **轮询提速**：主页 `index.html` 列表+打印机轮询 15s→5s（对齐观察台节奏），机端换料/改料、进度变化最快 5s 内可见；拓竹机端变更本就走 MQTT 推送实时入库，双向闭环：机端改→推送→页面 5s 内刷新，监测台改→`ams_filament_setting`/`msConfig_cmd` 写入+12s 状态回读（C5P 固件空转如实报「未落实」，A5P 无料站如实拒绝）。
- 测试：flashforge-client 断言改锁新语义（type 空/remain 克数/remainUnit），28 套全绿；已 `npm run push` 上线（部署机 SSH 健康检查偶发 ECONNRESET，HTTP /api/health 验证服务正常）。

### v57 热修45 · 2026-10-23 · 随本提交落地 · fix

**A5P 停止不生效根因实锤 + 闪铸停止两步式（曼波停机 R20261022-007 实案）**

- **实案**：曼波控制台停 A5P（printer=3）两次请求均「回 Success 但机器照打」；状态验证 10s 超时后人工停机标记被撤销，R-007 悬挂打印中。直发实验补刀实锤：对运行中任务直接发 `jobCtl_cmd cancel`，**固件回 Success 但把任务从头重打**（printDuration 归零，日志证明非 dispatcher 重发）——旧单步 cancel 不是无效而是**有害**。
- **软件通道全排**：HTTP cancel/pause ×（空 jobID / 真实 pid）×（清屏弹窗前置）、TCP 8899 `~M601 S1`——全部「受理不动」，A5P 固件 5.1.9 拒绝一切远程停机（社区同款反馈：JMcCumberIO/flashforge_adventurer5m 注明控制命令可能不生效），只能屏幕物理操作。
- **两步式停止**：flashforge `stopPrint` = pause → 直轮 /detail 确认 PAUSE（≤8s）→ 才发 cancel；**pause 未确认且仍在打印则跳过 cancel**（该固件下等于触发重打），返回 `cancelSent:false` 供端点如实报「请到屏幕操作」。每步回执打日志。
- **端点适配**：闪铸判停口径改「gcodeState 到 IDLE」（canceling 归一 IDLE，PAUSE 只是两步式中间态），验证窗 10s→30s；`stopPrintOnPrinter` 透传两步式结果，cancel 被跳过时 note 明说原因。
- 测试：flashforge-client 15 断言（pause 未确认跳过 cancel/确认后两步全发），全量 28 套全绿，两次 `npm run push` 上线（SSH 健康检查偶发 ECONNRESET，HTTP /api/health 验证正常）。

### v57 热修46 · 2026-10-23 · 随本提交落地 · fix

**料位变更审计日志（A1mini 换料同步争议定责）**

- **争议**：曼波「A1mini 已换 PLA 为何没生效」——直订机器 MQTT 实证：机端上报 `vt_tray tray_type:PLA/color:000000`，监测台同显 PLA·000000，链路端到端一致；「没生效」实为机器侧时差（外挂料架料型随 RFID/进料确认才更新上报，第三方料盘 tag_uid 全零=无标签，料型来自机端手动告知），非同步链路故障。
- **改进**：manager.updateState 对 ams 槽位料型/颜色变化打 `[料位] <机名>: 旧 → 新` 审计日志（全机型覆盖，含外挂料架）——机端换料→监测台时延从此翻日志可测，双向同步争议不再靠猜。
- 全量 28 套测试全绿，已 `npm run push` 上线。

### v57 热修47 · 2026-10-23 · 随本提交落地 · fix

**闪铸机端屏幕取消识别（不再与人循环对抗）——C5P R20261022-006 实案**

- **实案**：曼波在 C5P 屏幕上手动取消 R-006，系统走「PRINTING→IDLE 无完成事件=幽灵中断」通道失败收尾→回排队→重发指令，人再取消、系统再发，循环到重试 3 次耗尽才停（givenUp+排队中）。根因：热修42 的人工取消识别只覆盖控制台停机（标记）与拓竹机端取消（0300-400C 码），闪铸机端取消只有光秃秃 IDLE 事件，被当异常中断对抗到死。
- **指纹**：闪铸固件屏幕取消经历 `canceling → cancel → ready` 原始态（协议状态全集）——flashforge `getPrintStatus` 透出 `rawStatus`，manager 随 jobEvent 透传；dispatcher idle 收尾链新增分支：rawStatus 落在 canceling/cancel 即机端人工取消，按 `humanTerminateTask` 收尾（已取消、不重排、不进 givenUp）。
- **已知边界**：5s 轮询若把 canceling/cancel 两个态都错过（瞬发取消）则退回幽灵通道——取消是机械动作（头抬升/热床下降）通常跨多个轮询周期，实测 C5P canceling 可采样。
- 测试：dispatcher-manual-race 6e（canceling/cancel 两态 × 移出 printing/写已取消/不重排 6 断言），30 断言全绿；全量 28 套全绿，已上线。

### v57 热修48 · 2026-10-23 · 随本提交落地 · feat

**闪铸文件喷头指令审计（C5P 二号喷嘴争议）**

- **争议**：曼波称 C5P 单指定了二号喷嘴、机器却用一号喷头打。拆单内 3mf 实证：`plate_1.gcode` 全程只有 `T0`（×2，开头 `T0 + M109 S255 T0`），无任何 T1/T2/T3——机端忠实执行文件，文件本身就是一号喷头刀路；project_settings 有 `filament_map:["1"]` 痕迹（切片器里选过）但没烙进刀路——**选择丢失发生在切片侧（Orca/FlashPrint C5P 配置），非分发链**（闪铸直通原样提取上传，字节不改）。
- **改进**：闪铸直通提取 gcode 后统计 `^T\d` 指令，分发日志打 `[分发] <单号> 闪铸文件喷头指令: T0×2 / 无 T 指令（机端用当前默认喷头）`——切片选错喷头开打前一眼可见。
- 全量 28 套测试全绿，已上线。

### v57 热修49 · 2026-10-24 · 随本提交落地 · fix

**人因终止类级反转：无故障证据的 FAILED 不再自动重发（H2D 三码实案定音）**

- **实案**：曼波 H2D 屏幕停机 R20261024-001，同一动作先后吐三种 fail_reason——0x0C008042（变体码，201359426）→ 自动重排；0（无码）→ 自动重排；0x0300400C（标准码）→ 才按取消收尾。同一手势三种码，**按码追指纹结构性失败**，此类问题（闪铸 rawStatus、拓竹 400C、H2D 变体码…）逐品牌打补丁永远追不完。
- **类级反转**：判据从「识别人工取消」换成「识别真实故障」——真实故障（断料/堵料/跌件）必带故障证据（拓竹 HMS 数组/print_error 位图、闪铸 /detail errorCode），**FAILED 且无证据 → 默认按人为终止收尾（已取消、不重排）**，只有带证据的才失败重排。自动重打的核心价值保留在「真故障」上，人因路径不再对抗。
- **配套**：flashforge getPrintStatus 透出 errorCode；manager 状态面落 errorCode 字段；H2D 变体码 201359426 入人工取消码表（双保险）。误伤面：极罕见「无码真实故障」落已取消（页面可见、可重新预约），远小于旧行为的循环对抗与耗材浪费。
- 测试：dispatcher-manual-race 6f（无证据→已取消/带 HMS 证据→重排），32 断言；全量 28 套全绿，已上线。

### v57 热修50 · 2026-10-24 · 随本提交落地 · feat

**放弃池人工丢弃：重试耗尽单新增「不要了」出口**

- **痛点**：放弃池此前只有「指定打印机恢复」一条路——明确不要的单永远躺黄条、列表永远「排队中」（R20261023-011 实况）。
- **功能**：dispatcher.dismissGivenUp（幂等，单不在池报错）= 移出放弃池 + flushState + 预约单落「已取消」（本地源写 store/history，镜像源写表）；端点 `POST /api/dispatch/given-up/:id/dismiss`（reviewer+，与恢复同权限）；主页黄条每单加「丢弃」按钮（confirm 防误触，与恢复并排）。
- **清理实况**：现网放弃池 3 单盘点——R20261020-006 已于 10-23 恢复后正常打完（/busy 弹窗清掉后恢复链路可用实证）、R20261023-009 已取消、R20261023-011 走停服-改盘-启服（备份 .bak-dismiss）落「已取消」，放弃池清零。
- 测试：dispatcher-manual-race 6g（移出池/写已取消/重复丢弃报错），35 断言；全量 28 套全绿，已上线。
