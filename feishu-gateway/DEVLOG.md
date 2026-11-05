# DEVLOG · feishu-gateway（统一飞书事件网关）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。本项目无独立远端，push.js 只暂存 `feishu-gateway/` 路径提交进顶层 monorepo——版本即顶层仓库中触碰本路径的提交。v1~v8 于 2026-09-04 回溯编号，此后每次 push 在文末追加新版本（规则见顶层 [AGENTS.md](../AGENTS.md)）。

当前最新：**v41**（2026-11-05，全量审查收口——command 传输异常不重试/退出原子写/学习清单 90 天过期，四套全绿）。上一版 v40（2026-10-30，全量审查修复批：统计落盘原子写+日桶钉东八区+health 透出 SDK 真实态+注释勘误，三桩全绿）。
上一版：**v39**（2026-10-17，全量审查批：v38 巡检计时缺陷修复 + 部署缺口回补 + 文档/锁文件卫生，三桩+冒烟全绿）。
上一版：**v38**（2026-10-14，`cf2e12c`，审查修复批：connecting 恒挂兜底 + command 投递带共享 token + cors 死依赖清理，三桩+冒烟全绿）。上一版：**v37**（2026-10-10，文档收口批——纯 docs 随顶层 v145 归档，部署待小电脑上线补跑）。上一版 v36（2026-10-07，NAS_*→DEPLOY_* 连接键改名批）。上一版 v35（2026-10-05，随本提交落地）。上一版 v34（2026-09-27，已上线）。上一版 v33（2026-09-26，`66dc3a3`，七仓全量审查修复批）。上一版 v32（`50f3029`）。上一版 v31（2026-09-24，`97bd02b`）。更早：v30（顶层归档随批，仅工具链未部署）。）

## 阶段五 · 开发历史建档（2026-09-04）

### v9 · 2026-09-04 · `7207c20` · docs
**新增 DEVLOG 开发历史 v1~v8（按 push 回溯建档）**
- 本 DEVLOG 诞生：v1~v8 按顶层仓库中触碰本路径的提交回溯编号，此后每次 push 追加一版（规则见顶层 AGENTS.md「开发日志（DEVLOG）」节）。

## 阶段一 · 网关诞生（2026-09-01）

### v1 · 2026-09-01 · `55fb002` · feat
**新增 feishu-gateway 统一飞书事件网关；bambu 部署脚本与密钥分离**
- 独占飞书应用唯一长连接，向各机器人广播事件；首版含 dispatch.js 路由、CONSUMERS 消费者登记、smoke-test 与 NAS e2e 测试。

## 阶段二 · 路由试错与铁律回归（2026-09-01）

### v2 · 2026-09-01 · `2c81f94` · fix
**审批群内 / 指令直接路由 approval-bot（无需 @，网关代回复）**

### v3 · 2026-09-01 · `bdfc053` · fix
**isMentioned 兼容 mentioned_type=bot（真实事件中机器人类型为 bot 而非 app）**

### v4 · 2026-09-01 · `49fb4b7` · fix
**遵循架构铁律——撤销审批群消息直连路由，对话统一走 hub（对话型机器人）**
- v2 的直连方案上线数小时即撤销：专项机器人不经网关直接回复对话，统一改由 hub 分发 `/approval-*`。

## 阶段三 · 会话边界文档（2026-09-02 ~ 09-03）

### v5 · 2026-09-02 · `dd9d961` · docs
**增加项目职能边界声明（发错会话防护，需求错位即提醒停手）**

### v6 · 2026-09-03 · `2864005` · docs
**AGENTS.md 增加「顶层规则与交互性」段（独立会话内联交互契约，开工先读顶层总表）**

## 阶段四 · 审批事件分发直连（2026-09-04）

### v7 · 2026-09-04 · `44b0463` · feat
**分发改为官方审批实例事件直连（approval_instance 秒级）**
- 不再依赖多维表格事件轮询播审批，直接订阅官方 `approval_instance` 事件转发 bambu/ticket，秒级到达。

### v8 · 2026-09-04 · `5260175` · feat
**网关审批事件双通道——approval_instance + approval_task 转发 bambu/ticket（自动审批与工单接单联动）**
- 双通道：实例级（状态变化）+ 任务级（某人维度），支撑 bambu 自动审批与 ticket-bot 接单自动通过两条联动链路。

## 阶段六 · 审批事件断链修复（2026-09-05）

### v10 · 2026-09-05 · `b61269c` · fix
**网关 EVENT_TYPES 补订阅 approval_instance/approval_task——修复审批事件双通道生产断链**
- 排查全链路时发现：v7/v8 上线的审批事件双通道在生产从未生效——网关 `.env` 的 `EVENT_TYPES` 覆盖值仍只有 `im.message.receive_v1,drive.file.bitable_record_changed_v1`，把 config.js 默认值里的两个审批事件类型盖掉了；网关日志证实从未转发过任何审批事件，bambu 打印自动审批与 ticket-bot 接单自动通过两条联动因此静默失效。
- 修复：本地 `.env`（部署源头，push 原样覆盖 NAS）与 `.env.example` 的 `EVENT_TYPES` 补上 `approval_instance,approval_task`。代码零改动（config.js 默认值本就含双通道）。
- 踩坑：`.env` 不进 git 无历史可查，配置回退只能靠线上比对发现；典型"改了代码默认值但忘了同步 .env 覆盖值"事故，与 qianli-deploy skill 记载的"本地残留旧配置被推上去"是同一事故模式。
- 备注：hash 由下一提交回填（同 37a59aa 先例）。

## 阶段七 · 工单私聊确认路由（2026-09-05）

### v11 · 2026-09-05 · `cebb767` · feat
**路由匹配器支持 chatType + 新增 p2p+接单 → ticket 规则（指定负责人私聊确认链路）+ 路由日志补 chat_id**
- 配套 ticket-bot v48「24h 未确认私聊追问」：负责人私聊回复「接单」需路由到 ticket-bot，而私聊无 @，原 mention 规则够不着——匹配器新增 `chatType` 维度（一行），默认路由表加 `{contains:'接单', chatType:'p2p'} → ticket`（仍属工单域例外，hub 默认目标不变）。
- 路由命中日志补 `chat=` 字段：排查「机械组接单未触发回执」时发现路由日志不带群标识无法定位来源群，一并补上。
- 排查结论备忘：网关日志从未出现任何含「接单」的消息（含 hub 兜底），机械组漏回执系旧卡片引导 @爆米花机_自动型（webhook 机器人无事件）所致，非网关路由问题；新卡片引导 @对话型后依赖应用机器人在群内（运维事项）。

## 阶段八 · 全项目审查修复批次（2026-09-06）

### v12 · 2026-09-06 · 顶层归档 `dbbdaf5` · fix
**全项目审查修复：长连接启动失败不再杀进程 + 健康检查如实上报 + 路由文档对齐**
- wsClient.start() 加 catch + 全局 unhandledRejection 兜底：start() 返回 Promise，原调用既不 await 也不 catch——连接失败（凭证错误/网络故障）会以 unhandled rejection 直接杀死唯一长连接进程（Node≥15 默认行为）；同时 /api/health 的 ws 字段原来只反映「已发起启动」永远假绿 running，现在如实返回 error 状态，部署验证不再被误导。
- deliverTo：command 规则命中但消费者未配指令端点时打告警日志（原先静默降级为原始事件转发，配置错误无从察觉）；express.json 放宽 2mb（与 AGENTS 建议一致，防大 bitable 帧回放 413）；EVENT_TYPES 重复 parseList 清理；nas-e2e-test.js 中 pm-robot 目录重组后的失效路径修正。
- 文档对齐：README 路由表改为实际默认规则（/ticket 前缀、@+接单、p2p+接单 → ticket，其余 hub——原文档里的 /approval、/print 直连规则 v4 撤销后未回改），匹配条件补 chatType，审批事件一节与环境变量一览补全（EVENT_TYPES 改动需同步 NAS .env 的教训入册）；.env.example 修 hub 端口 2174→3000（照抄会导致 hub 全部消息投递失败）、补 APPROVAL_TARGETS、删无代码读取的 FEISHU_ENCRYPT_KEY；AGENTS.md 消费者口径澄清（五机器人共用应用，下游登记四个）。

## 阶段九 · 例行维护（2026-09-06）

### v13 · 2026-09-06 · 顶层归档 `b64bf8b` · docs
**全仓例行 debug 扫描——网关零代码缺陷，文档纠偏三条**
- README 部署步骤幽灵脚本修正：`npm run deploy:sftp`（package.json 无此 script，照执行会报 missing script）→ `npm run push`。
- DEVLOG「当前最新」指针 v10 → v12（76e9daa 专项锚点回填时只补了 v12 哈希、漏改头部指针）。
- v11 条目锚点回填 `cebb767`（当时记「随本提交落地」，回填批次遗漏）。
- 代码侧结论：src/ 无可确认缺陷（EVENT_TYPES 订阅表 / 消费者登记 / .env 三方一致，v12 修复批次在位，事件去重与 deliverTo 降级路径完好）；`.env` 残留无消费者的 `FEISHU_ENCRYPT_KEY`、package.json 未用依赖 `cors` 均无害，仅记录不清（.env 是部署源头，是否清理属运维决策）。

## 阶段十 · 使用统计（2026-09-12）

### v14 · 2026-09-12 · 顶层归档 `b4aa03e` · feat
**使用统计 /api/usage——运维台「活跃看板」数据源（谁在用什么功能）**
- 新增 src/usage.js：消息事件命中路由目标后顺带计数（dispatch.js 的 routeMessage 在命中规则/走默认目标处各调一次 recordUsage，只观察不改路由，统计异常静默自愈不影响转发）。功能口径：`/` 开头取首个 token（精确到 /print-status 等指令）；工单接单监听（@/私聊+「接单」非指令文本）单独记「工单接单」；其余按私聊对话/@群对话计。
- 按天分桶保留 30 天（{total, users:{open_id:{c,last}}, feats}），落盘 usage-stats.json（60s 兜底刷新 + SIGINT 落盘）；**落盘目录必须在项目外**（部署 tar 会清空 /opt/feishu-gateway）：默认 /home/qianli/feishu-gateway-data，可 GATEWAY_DATA_DIR 覆盖，写不进时退回项目内（不入 git）。
- 成员名解析：新 open_id 首次出现时用共用应用凭证查通讯录（contact/v3/users），姓名永久缓存进统计文件；失败 24h 内不重试，展示回退 open_id。
- HTTP 端点 GET /api/usage?days=N（默认 1，最大 30）：返回 users/features/daily 聚合，运维台「使用活跃」看板消费。
- 验证：本地以空 APP_ID 起 HTTP（不连长连接）POST /api/dispatch 合成事件，计数/分桶/落盘/聚合全通过（注意 Git Bash curl -d 直写中文会 GBK 乱码，测中文路由要 --data-binary @utf8文件）；线上部署后 ws running，/api/usage 空表起步。

## 阶段十一 · 动态广场看板（2026-09-12）

### v15 · 2026-09-12 · 8dd86d6 · feat

**网关活跃同步多维表格——动态广场看板数据源**

- 新增 `src/bitable.js`（最小写表客户端，复用 usage 的 tenant token）与 `src/bitable-sync.js`：每 30 分钟把使用统计按**日期签名** upsert 到机器人项目看板「网关日活跃 / 网关功能使用 / 网关队员活跃」三表（日期桶无变化不写表；签名状态落 GATEWAY_DATA_DIR，重启不重写），启动即回填存量 30 天。
- 成员 open_id 优先 usage 姓名缓存，未命中查通讯录（单轮缓存，失败回退 open_id 尾号）。
- `POST /api/usage-sync/run`（`?force=1` 忽略签名重写全部）手动补数，运维台可用。
- 配置：`.env` 补 `PLAZA_BITABLE_APP_TOKEN/DAILY_TABLE/FEATURE_TABLE/MEMBER_TABLE` 四键（.env.example 同步）；建表脚本在 duty-bot `scripts/create-plaza-tables.js`（幂等）。
- 测试：`scripts/stub-test-usage-sync.js`（全量 create / 签名跳过 / 变化 update / 姓名回退尾号）全过；只观察不影响转发，任何写表失败 warn 后下轮重试。

### v16 · 2026-09-12 · a8e5961 · fix

**网关活跃三表「日期」改日期类型——仪表盘动态过滤（今天/近7天）可用**

- 修复用户反馈：日期建为文本导致多维表格指标卡无法用「今天」动态过滤（文本无动态日期）。三表「日期」字段已迁移为 Date 类型（存量值自动转换），`bitable-sync` 写入与 upsert 检索同步改为当日 0 点（UTC+8）毫秒时间戳。
- 迁移与验证：字段 Text→Date API 迁移（存量 26 行值自动转换零丢失）；`POST /api/usage-sync/run?force=1` 强制重写验证 upsert 命中不产生重复行。

### v17 · 2026-09-12 · cfb0c07 · fix

**upsert 改内存整表匹配——records/search 过滤对 Date 字段不可用的根治**

- 实测 records/search 对 Date 字段任何 operator（is/范围/isEmpty）一律 `1254018 InvalidFilter`（文本字段正常）——v16 的时间戳写入没问题但检索会挂。改为**整表拉回内存比对**（30 天 × ~35 行/天，500 条/页 1~2 页，无压力），`bitable.listAllRecords` 替代 searchRecords。
- 队员表新增 `open_id` 稳定身份列：姓名解析从尾号回退升级为真名时不会因匹配失效产生重复行。
- stub 测试同步改写，全过；部署后清理旧格式行 + force 重同步验证无重复。

### v18 · 2026-09-13 · 800364e · refactor

**活跃统计口径收敛为机器人交互；多维表格同步单表化（网关功能使用/队员活跃两表下线，用户拍板）**

- **统计口径**：只有「显式路由命中（/ticket-*、接单等专用能力）/ 私聊 / 群内 @机器人」计入使用统计；群内未 @ 落默认目标的普通闲聊不再计数。**转发行为完全不变**（hub 照常收到并按自己的群门禁忽略），只是不再把闲聊算成「队员活跃」。新增门控 stub 用例：未@不计 / @计 / 私聊计 / 显式路由计 / 接单计，全过。
- **同步单表化**：bitable-sync 从三表收缩为「网关日活跃」单表（每日 1 行：日期/总消息数/活跃人数/功能数；**列名沿用历史，仪表盘图表无需重建**，总消息数语义=机器人交互次数）；分功能/分队员明细落表与同步侧姓名解析随之移除（运维台 `GET /api/usage` 聚合不受影响，明细仍在本地统计文件保留 30 天）。
- 配套：duty-bot 建表脚本移除两表定义防重建（该仓本次仅本地提交，随下次 push 带 NAS）；`.env` 的 `PLAZA_BITABLE_FEATURE_TABLE/MEMBER_TABLE` 键废弃（残留无害）。
- 已知语义混合：日活跃表近 30 天存量行仍是旧「全部消息」口径，随 30 天留存自然滚出；要立即统一可手动清表（表数据操作在用户侧）。

### v19 · 2026-09-13 · 随本提交落地 · feat

**管理端点鉴权 + 长连接启动失败自动重试（用户拍板：现状不接受）**

- **鉴权**：新增 `src/auth.js` 中间件，`POST /api/dispatch` 与 `POST /api/usage-sync/run` 需带 `X-API-Token` 头（`GATEWAY_API_TOKEN`，.env 存储随 push 下发；timingSafeEqual 防时序侧信道）；**fail-closed**——token 未配置时两端点整体锁定（503），健康检查与只读 `GET /api/usage` 不受限。`.env.example` 补键与调用示例。
- **长连接自动重试**：`start()` 失败（凭证错误/网络故障）不再只留 error 状态——按指数退避自动重试（5s 起、翻倍封顶 5 分钟），每次尝试新建 WSClient（失败客户端状态不可信，且保证同一时刻至多一条连接），成功后计数清零并打恢复日志；另加 120s 看门狗兜底「start 无响应」场景。health 的 ws 字段新增 `connecting` 态。
- 文档：README 鉴权/重试说明与手动补数 curl 示例（带 Token）；AGENTS/搭建指南/维护者手册的手动补数命令同步加头。

### v20 · 2026-09-13 · 随本提交落地 · docs

**文档重审订正：README 鉴权示例/环境变量表/重试说明/接单语义（全量文档重审批，无代码改动）**

- /api/dispatch 手动投递 curl 示例补 `X-API-Token` 头（v19 fail-closed 后原示例必失败）；环境变量一览补 `GATEWAY_API_TOKEN` 行；补「长连接自动重试（5s→5min 指数退避 + 120s 看门狗 + connecting 态）」说明（兑现 v19 文档声明）；接单语义旧表述（「在工单群内 @机器人（任意文本）」）更新为现行口径（整句/变式 + ticket-bot 实时队列门禁，无单群静默）。

### v21 · 2026-09-13 · 随本提交落地 · fix

**深度代码审查批：v19 重试真修复（SDK 回调驱动）+ SIGTERM 落盘**

1. **v19 的自动重试整体不可达**（深度审查确认）：SDK（1.73.0）的 WSClient.start() 永不 reject——连接失败的唯一信号是 onError 回调（仅致命错误触发：凭证失败/重连耗尽，SDK 内部已置 terminalError 停摆）与 getConnectionStatus().state==='failed'。原 promise .then/.catch/看门狗全是死代码，凭证错误时健康检查仍误报 running。改为 onError/onReady/onReconnected 回调驱动重试（新建客户端、指数退避）+ 30s 状态巡检兜底静默失败场景。
2. usage 统计只处理 SIGINT——pm2 restart 发 SIGTERM 丢至多 60s 活跃计数——补 SIGTERM 同款落盘。

### v22 · 2026-09-13 · 随本提交落地 · feat

**队员/功能统计覆盖规则落地 + 投递可靠性 + traceId（体系推荐 R3/R6，用户授权先做）**

1. 统计归因上报：新增 `POST /api/usage/report`（X-API-Token 鉴权）——hub 等消费方把路由层看不见的功能命中（关键词回答/DDL 确认等）回报为队员/功能统计（recordFeature 只加用户与功能计数不加 total，防双算）。
2. 投递可靠性（R3）：deliverTo 失败自动重试一次（3s）+ 按消费者累计失败计数暴露到 /api/health 的 delivery 字段。
3. traceId（R6）：路由层生成 evt_xxx 随转发载荷透传，路由日志带前缀——消费者日志可按它串联全链路。

### v23 · 2026-09-13 · 随本提交落地 · chore

**token 统一（chore）**：`.env` 的 GATEWAY_API_TOKEN 值改为与全工作区共享 API_TOKEN 相同（五仓 + 网关一个 token，运维只记一个）；中间件不变。

### v24 · 2026-09-14 · ff3fc24 · perf

**长连接重连提速：首重 5s → 2s(WS_RETRY_BASE_MS)**

- 场景：主路由学生账号会话偶发被校园网踢出(秒级自愈常态)，网关此前首重 5s 会让事件流多哑 2-3 秒。压到 2s 后，被踢→恢复的成员可见窗口压缩到 2-3 秒内；指数退避封顶 5 分钟不变，长断网行为不受影响。
- 配套：运维台新增网络拓扑看板(/api/network)+出口 IP(/api/egress-ip)，断网时可全拓扑定位。

### v25 · 2026-09-15 · 随本提交落地 · fix

**全项目深度审查修复批：投递统计如实计数 + 文档清扫**

- dispatch 投递统计修正：下游 HTTP 层失败（4xx/5xx）此前与传输异常分流——不抛错就不进 failed 计数，deliverTo 无条件 ok+1，监控把下游半死状态显示成全绿。改为 ok===false 时如实计 failed（含 byConsumer）并打 warn；HTTP 层失败**不自动重试**（指令类转发下游可能已执行，重试有双执行风险，与传输异常的 R3 重试区分开），注释同步口径。
- README：退避参数 5s→2s（v24 已改代码、文档漏跟）；「120s 看门狗」表述修正为实际实现（30s 轮询自愈，connecting 恒挂起场景重启兜底）；补 POST /api/usage/report 端点文档（v22 落地的全五仓上报契约，README 一直没写）。
- .env.example NAS_PORT 8500 → 22（旧 NAS 端口残留，照模板配置会连不上新部署目标）。

### v26 · 2026-09-15 · 随本提交落地 · fix

**R10/R11 鉴权收尾与投递语义升级（全项目审查推荐落地批）**

- R11 事件模式 HTTP 失败重试：下游 4xx/5xx 此前只计数不重试（v25 修正了统计失真）；事件消费方都有 messageId 幂等，现与传输异常同款重试一次；command 模式保持不重试（指令无幂等键，下游可能已执行，双执行风险大于丢指令——失败有「服务暂不可用」兜底回复可感知）。
- R10② query token 废除：auth.js 不再接受 ?token= 查询串（token 进访问日志/代理日志）；X-API-Token 头为唯一通道。工作区无 query token 消费方（运维台代理走头）。
- R10⑤ health 收窄：消费者清单/路由表/投递统计只对本机回环调用方暴露；LAN 调用方只拿 {status, ws, uptime} 存活摘要（服务绑 0.0.0.0 供 LAN 冒烟测试是既有设计，本机运维台走 SSH 回环 curl 不受影响）。
- .env：FEISHU_VERIFICATION_TOKEN 补配共享密钥——网关转发帧注入 token 字段（withToken），各消费方据同一密钥校验；此前网关与四仓密钥全空，消费方校验整体 fail-open。

### v27 · 2026-09-16 · 随本提交落地 · fix

**全量 debug 回归批：deliverTo 重试/计数重构**

- 修复 v26 R11 实现的计数污染与三连投递：重试失败的 throw 落进外层传输异常 catch 再重试第 3 次，且外层成功路径不检查 ok 就计 ok——一次事件失败会投递 3 次、failed 计 3~4 次。重构为统一口径：事件模式 HTTP 失败重试一次（重试成功=ok+retried；最终失败=failed 计 1 次即返回，不抛不重入）；command 模式单次尝试只计 failed；传输异常路径保持原 R3 语义（重试成功 ok+retried，最终失败 failed 计清）。

### v28 · 2026-09-20 · `a939175` · fix

**全量 debug 批：字段结构变更事件静默 + 部署悬空收口 + 指针漂移修正**

- `drive.file.bitable_field_changed_v1`（多维表格字段结构变更，应用控制台订阅层送来）此前不在 EVENT_TYPES、dispatch 无分支，SDK 对每条刷 `[warn] no ... handle`，error 日志被噪音淹没。现在 config 默认清单与 .env/.env.example EVENT_TYPES 补注册，dispatchFrame 显式静默忽略。
- **部署悬空收口**：v82 批（09-17）对 gateway 的改动（nas-e2e-test.js 补 X-API-Token、auth.js/push.js 注释口径）只进了顶层归档、未跑 gateway push，部署目标自 09-16 起落后本地（内容级 diff 核实：仅注释/测试脚本差异，运行时行为一致）。本次 push 对齐。
- DEVLOG 头部「当前最新」指针 v25 → v27 漂移修正（v26/v27 条目存在但指针漏更，全局工程规则点名的高频复发项第 N 次），本批后指向 v28。

### v29 · 2026-09-22 · 随本提交落地 · feat

**活跃口径修正：队员活跃只算正经使用，抽奖/关键词回答等娱乐功能不计入（用户拍板）**

- 需求：运维台「队员活跃」此前把抽奖、关键词回答等娱乐命中也算活跃，纯娱乐玩家撑高活跃数。改为双口径：`activeUsers`=机器人交互全量（网关日活跃多维表格同口径，不变），新增 `seriousActiveUsers`/`seriousUsers`=正经使用（运维台「队员活跃」看板与总览「近24h活跃」KPI 消费；「功能使用分布」仍全量展示娱乐命中）。
- 数据层：日桶 `users[id]` 新增按人功能归因 `f`（`recordMessage`/`recordFeature` 都写），聚合时按娱乐清单剔除每人娱乐命中得 seriousCount。旧数据（无 `f`）按全量正经处理、不回溯剔除，7 天窗口内自然老化。
- 娱乐清单双保险：静态 `STATIC_FUN_FEATURES`（抽奖/关键词回答//lottery）+ 上报自学习——`/api/usage/report` 接受 `fun:1`（功能名进 `funFeats`）与 `learn:[触发词]`（归一化 `/触发词` 进 `funCmds`），堵住抽奖动态触发词（抽奖配置表可随时增删）在路由层被记成正经 `/指令` 的漏洞；清单随 stats 持久化，重启不丢。口径边界：@机器人/私聊本身记为正经互动（`@群对话`/`私聊对话`），群内未@的关键词/触发词命中只产生归因上报、被整体剔除。
- 测试：新增 `scripts/stub-test-usage-serious.js`（双口径并存/娱乐剔除/学习清单/静态清单/旧数据兼容/窗口聚合），push.js 测试闸门改为两套桩串联。
- 规则成文：顶层 AGENTS 全局工程规则新增「队员活跃口径=正经使用」条；hub 上报侧带 fun/learn 同批部署（hub v107）。
- 文档：README 使用统计节补双轨口径、report 新字段与测试清单。

### v30 · 2026-09-24 · 顶层归档随批（仅工具链，未部署） · fix

**smoke-test 同步 v26 鉴权（6/8 假失败修复）+ README 收录冒烟**

- 提交说明：fix: smoke-test 同步 v26 鉴权修 6/8 假失败；README 测试节收录 smoke
- smoke-test.js：/api/dispatch 挂鉴权后冒烟脚本没跟上，8 断言 6 个假失败——dispatch() 补 X-API-Token 头，spawn env 补 GATEWAY_API_TOKEN（网关 token 键名与别仓 API_TOKEN 不同；dotenv 不覆盖已存在 env，spawn 值必胜）。修后 8/8 全过（路由/模式/legacy 转换/去重真实验证）。
- README 测试节收录 smoke 用法并注明**勿入 push 闸门**（硬编码 3010，部署目标跑会撞在线网关端口）。
- 本版仅开发工具链改动、零运行时行为变化，未走 SFTP 部署、不重启网关；版本锚点随顶层归档提交。

## v31 · 2026-09-24 · `97bd02b` · feat

**新增群聊被@统计（团队负载算法数据源，2026-09-24 算法升级批）**

- 提交说明：feat: 群聊消息 mentions 按人按天累计 + GET /api/usage/mentions 自然日滑窗聚合
- **需求**：曼波拍板的负载算法升级第三项——「监听所有群聊的被@，每被@一次加 0.01 分」（pm-robot workloadService 消费，同批 pm v110）。
- **采集**：`src/usage.js` 新增 `recordMentions(message)`——群聊（chat_type=group）消息的 mentions 逐条计数；@机器人（self/app/bot/@_bot_*，与 isMentioned 口径对齐）、@所有人（@_everyone）、私聊不计；mention id 对象形态（{open_id}）兼容。调用点 `src/dispatch.js` routeMessage 入口（任何路由判断之前）——不命中规则的消息里的 @ 也算，只计数不影响路由/转发。mention 自带姓名顺手进 names 缓存。
- **存储与聚合**：stats 新增 `mentions` 按天桶（{ 'YYYY-MM-DD': { openId: count } }），随 usage-stats.json 同文件落盘（60s 刷盘 + SIGINT）、prune 同窗清理（KEEP_DAYS=30）；旧 stats 文件无该键自动补 {}。`aggregateMentions(daysN=7)` 输出 [{id, name, count}] 降序；**窗口按自然日过滤**（起点=today-N+1）而非沿用 usage.aggregate 的桶数滑窗——负载评分输入不能在稀疏数据下把老计数长期带在身上（stub 测试抓出该语义差异后定的口径）。窗口 clamp 1..30，显式传 0 收敛到 1（`0||7` 默认值陷阱已修）。
- **API**：`GET /api/usage/mentions?days=7`（只读不鉴权，照 /api/usage 惯例）；registry.js listening 登记。
- 测试：`scripts/stub-test-usage-mentions.js`（计数形态/排除项/对象 id/姓名缓存/滑窗/clamp/prune），usage-serious/usage-sync 两套回归全过。README 使用统计节+测试节同步。

## v32 · 2026-09-25 · `50f3029` · docs

**全量审查文档批（零行为改动，纯注释+文档对齐）**

- 提交说明：docs: README 鉴权清单/SIGTERM/桩闸门口径修正 + 管理端点注释三端点对齐（全量审查批）
- README：环境变量表 GATEWAY_API_TOKEN 补 /api/usage/report（三端点 fail-closed，原「两端点」与 src/auth.js 实际不符）；usage 落盘补 SIGTERM（v21）；测试节标注 mentions 桩不在 push 部署闸门（闸门只串联前两支）；数据目录注 Windows 实际解析位置。
- src/auth.js:4 与 .env.example 注释同步「三端点」口径（纯注释，无行为变化）。
- 网关拓扑文档（顶层路径）： bambu-print-server→bambu-print-reservation 命名勘误、补 3010 入站端口与 /api/health 探测。
- 测试：node --check 过；本批无逻辑改动，桩不重跑（闸门前两支随下次 push 自然回归）。

## v33 · 2026-09-26 · `66dc3a3` · fix

**七仓全量审查修复批（本仓无 P0/P1，P2 清理为主）**

- 提交说明：fix: 全量审查批——投递计数统一/fanout 入统计/出站超时统一/dataDir 收敛/SIGTERM 落盘/配置卫生
- deliverTo 传输异常终态只计 1 次 failed/byConsumer（原首败预记+终态计 2，与 HTTP 层口径不一）；fanoutBitable/fanoutApproval 新增 fanoutPost 计入 deliveryStats（不引入重试：消费方幂等已具备，重试语义另批评估）；新增 http.js fetchWithTimeout（8s/15s）替换五处裸 fetch；dataDir 解析抽 data-dir.js 公共（写前 mkdir），.gitignore 补 usage-sync-state.json；bitable-sync 补 SIGINT/SIGTERM 落盘（prependListener 抢在 usage 的 exit(0) 前）；README 重复条目去重；.env 删四个零引用死键（PLAZA_BITABLE_FEATURE_TABLE/PLAZA_BITABLE_MEMBER_TABLE/API_TOKEN/FEISHU_ENCRYPT_KEY），GATEWAY_API_TOKEN 注释对齐三端点（与 FEISHU_VERIFICATION_TOKEN 同值是有意统一，拆分另批）。
- 测试：三套 usage 桩 + smoke-test 全绿。

## v34 · 2026-09-27 · 随本提交落地 · fix

**第二轮全量审查批（本仓 src/ 无新缺陷；部署闸门与配置卫生）**

- 提交说明：fix: 部署闸门自动发现全量 stub + tar 排除补洞 + usage 裸读取舍注释
- push.js 闸门改 readdirSync 自动发现 scripts/stub-test-*.js（根治 usage-mentions 漏挂）；tar 补排除 src/usage-stats.json、src/usage-sync-state.json（data-dir 回退产物）与 .env.local/.env.*.local；/api/usage|mentions「LAN 可读全员统计」补已知取舍注释（行为未动，收紧随时可挂 token）。
- 测试：三套 stub + smoke-test 全绿。


## v35 · 2026-10-05 · `87c5070` · fix

**bambu 事件链路收口（路线 A 尾巴，曼波指令：一并修复）**

- 背景：bambu 2026-10-05 v37 路线 A 断飞书审批链（`/api/feishu/event` 端点退役、预约真相源改本地存储、指令由 hub 直连 `/api/chat/command`），但网关侧没跟着收口——CONSUMERS 仍登记 bambu 事件端点（legacy）、审批事件默认目标仍含 bambu。后果：每条表格记录事件按 legacy 拆单转发 bambu → HTTP 404，当天累计 500+ 笔（07:58 整机重启后计数 failed=182 全指向 bambu），`/api/health` 投递统计与 pm2 错误日志被污染。功能影响为零（bambu 本就不该再收），纯配置残留。
- 改动：`DEFAULT_CONSUMERS` 移除 bambu 条目（注释说明缘由）；`approvalTargets` 默认值 `['bambu','ticket']` → `['ticket']`（dispatch.js 兜底与注释同步）；本地与部署目标 `.env` 同步收口（CONSUMERS 去 bambu 段、新增 `APPROVAL_TARGETS=ticket`）——`.env` 是部署源头，push 原样覆盖目标机。
- 机制保留：legacy 拆条转发机制（fanoutBitable 的 action_list 拆分）原样保留备用，bambu 是其唯一用户、已退网。
- 连带：`dashboard/registry.js` gateway 监听描述与 bambu 条目（role/listening）同步路线 A 现实；顺手回填头部 v33 指针（上次会话遗留）。
- 测试：`npm run smoke` 全过（自注入 CONSUMERS，不依赖默认值；legacy 机制有 mocklegacy 消费者覆盖）。

## v36 · 2026-10-07 · 随本提交落地 · chore

**NAS_*→DEPLOY_* 连接键改名批（旧 NAS 残留清理，曼波定）**

- push.js 读键/注释/报错文案、.env.example、AGENTS.md 部署行、本地 .env 键改名（push 时覆盖部署目标同批生效）；
- 不影响运行时行为（部署连接键网关进程不消费）；nas-e2e-test.js 为 2026-09-27 已废弃的历史存档，保持原貌不改名。

## v37 · 2026-10-10 · 锚点=顶层 v145 归档提交 · docs

- 文档对齐 v35 收口后的代码现状：架构图/多维表格节/APPROVAL_TARGETS 语义不再含 bambu（照旧模板配置会重新引入每天 500+ 笔 404 广播污染）；.env.example 的 CONSUMERS 模板移除 bambu 条目（附恢复方式注释）；删除「push 闸门只串联跑前两支」失效注（v34 起 readdirSync 自动发现全部桩）。
- 纯 docs 无行为改动；部署待小电脑上线补跑（不改运行时）。

## v38 · 2026-10-14 · `cf2e12c` · fix

迁移后全量审查修复批：**P2×2**——①巡检实现 connecting 恒挂兜底：v21 重构后 WS_START_WATCHDOG_MS 沦为死常量、巡检只有 failed/connected 分支、dashboard 看门狗只探 HTTP 200，SDK 静默停摆于 connecting 形态时事件流全断无感知——现巡检对 connecting 计时（wsConnectingSince），超 WS_CONNECTING_GIVE_UP_MS（默认 5 分钟，env 可调）进程自退交 pm2 重建，README 承诺的重启兜底落地；②command 模式投递（postJson）附共享 X-API-Token（process.env.GATEWAY_API_TOKEN，与 auth.js 同源）——approval 09-29 起管理端点挂鉴权，裸转发 403 且 senderId 缺失权限人全判否，现生产默认路由全 event 模式故属潜伏修复。**P3×3**——cors 死依赖清除（声明无引用）；package.json 补 test 脚本（三桩串联，此前闸门逻辑只在 push.js）；nas-e2e-test.js 头部加废弃横幅（读 NAS_* 死键不可运行）。测试：三桩+冒烟 9 项全绿。

## v39 · 2026-10-17 · 随本提交落地 · fix

**全量审查批（v38 巡检缺陷修复 + 部署缺口回补）**

- **P1（v38 引入）**：`wsConnectingSince` 仅在巡检的 failed/connected 分支复位，`startWs()`/`onError` 不复位——同一进程内巡检一旦观察过 connecting（留下时间戳），其后正常连上、再遇致命错误走重试时，新尝试首个 30s 巡检会用旧时间戳算耗时，可能立即判「超 5 分钟」`process.exit(1)`（5 分钟宽限没有按本次尝试计时）。修复：startWs()（新建客户端=本次尝试起点）与 onError（终结本次尝试计时）各补 `wsConnectingSince = 0`。已知边界：`process.exit` 不走 SIGINT/SIGTERM 落盘 handler（可能丢 ≤60s usage 未刷盘），本次消除误触发路径，落盘缺口另行评估。
- **部署缺口回补（本版 push 的主意义）**：实证发现部署目标上 `src/index.js` 停留在 **2026-09-27**（v34 时代，`WS_CONNECTING_GIVE_UP_MS` 特征串计数=0）——**v35 代码收口、v36 连接键改名、v38 巡检兜底/command token 从未上线**（v37 纯 docs 按设计不部署）；期间生产靠 .env 收口压住了 bambu 404 洪峰，但 connecting 恒挂兜底一直缺席。本次 push 随 v39 一并上线。
- **P2 文档**：README「审批事件」默认目标「bambu+ticket」→ ticket（与自身环境变量表统一，bambu 已随 v35 退役）；AGENTS 交互契约「下游消费者四个（含 bambu）」→ 三仓；README 切换清单 bambu 行标注已退役。
- **P2 锁文件**：v38 删 cors 声明后 `package-lock.json` 未同步（仍列 cors）→ 本批 `npm install --package-lock-only` 对齐。
- **勘误**：v38 条目「nas-e2e-test.js 头部加废弃横幅」实由 `9fe601b`（v34 批）落地，cf2e12c 未触碰该文件（git log -S 核实）。
- **工具链**：冒烟起服等待由固定 1.5s 改轮询 `/api/health`（≤15s）——根治 Windows 冷启动竞态假失败（本机首跑即捕获：Node+SDK 首装超 1.5s → ECONNREFUSED 误报）。
- 测试：三桩 + 冒烟全绿。

## v40 · 2026-10-30 · 随本提交落地 · fix

**全量审查修复批（统计资产保护 + 时区统一 + 长连接可观测性）**

- **P2 · 统计落盘原子写**：usage-stats.json 的 60s flush 改「写 .tmp + rename 原子替换」，启动解析失败时坏文件改名留存（.corrupt-<ts>）再空表起步——此前崩溃截断 → 静默清零 30 天统计（含 names 缓存与娱乐学习清单，不可恢复）。bitable-sync 状态文件同款原子写。
- **P2 · 日桶口径钉东八区**：usage.js dayKeyOffset 改 +8h 固定偏移取 UTC 分量，与 bitable-sync toMs 的 +08:00 统一——宿主 TZ 变化不再导致日桶边界与多维表格日期字段错位 8 小时。
- **P2 · health 透出 SDK 真实连接态**：巡检取 getConnectionStatus 提前于早退条件，`/api/health` 的 ws 字段对已建立连接透出原始态（reconnecting 等此前恒报 running）——纯可观测性增强，巡检对已建连接的行为扩展（自退逻辑是否覆盖 reconnecting）列待确认未动。
- **P2 · dispatch 注释勘误**：postJson 实际对所有出站 POST 附 GATEWAY_API_TOKEN（原注释只说 command 模式）——现网消费者全在本机回环，注释改准并留「新增外部消费者需重评」提示；附带行为不改。
- **P3 清扫**：bitable-sync 签名保留注释 35→30 天勘误；.env.example 补 WS_CONNECTING_GIVE_UP_MS / GATEWAY_DATA_DIR 两键；usage flush interval 补 .unref()（与 bitable-sync 一致）。
- 审查遗留待确认（未修）：巡检早退致「建立后」阶段失明的行为面（SDK 无限重试下是否真实存在停摆待运行时证据）；subscribeDocs 启动一次性执行失败不重试（新配置窗口期静默缺事件）。
- 三桩 stub 全绿。
## v41 · 2026-11-05 · 随本提交落地 · fix

**全量审查 P2/P3 收口批（2026-11-04 深夜全量审查 gateway 域清单）**

- **P2 command 模式传输异常不重试（src/dispatch.js）**：HTTP 失败分支早有 `mode !== 'command'` 守卫（指令无幂等键，双执行风险大于丢指令），但 catch 分支（fetchWithTimeout 超时等传输异常）的 3s 重试不区分 mode——超时意味着下游可能已执行指令，command 一旦启用即双执行隐患。修：catch 分支同语义跳过 command（直接计 failed 并上抛）。现网 command 未启用，属潜伏缺陷前置修复。
- **P3 退出落盘原子写（src/usage.js）**：SIGINT/SIGTERM 退出落盘此前走非原子 writeFileSync，v40 给 60s flush 建立的 .tmp+rename 模式没盖住退出路径。修：新增 flushStatsSync（writeFileSync+renameSync 同步原子）接入两个退出信号。
- **P3 学习清单 90 天过期 + token 截断（src/usage.js）**：funFeats/funCmds 此前只增不减，误学触发词只能手改文件。修：新增 funHits lastHit 时间戳（随 stats 落盘），加载时对 90 天无命中条目三表联动清理；存量旧数据无时间戳视为「首次见到今天」不误删；learn token 40 字符截断（与 feature 同款）。命中路径（isFunFeature/recordFeature fun 上报/learnFunTokens）全部续签时间戳。
- **测试**：四套全绿（usage-sync/usage-serious/usage-mentions/smoke）。
