# DEVLOG · qianli-netlog（实验室网络日志探针）

版本隔离单位：一次 `npm run push`（= 一次 git 提交 + 一次部署）。规则见顶层 [AGENTS.md](../AGENTS.md)「开发日志（DEVLOG）」节。

当前最新：**v21**（2026-11-11，NETLOG_NOTIFY_ENABLED 播报总开关批——曼波拍板「断网播报全关」，162 断言全绿同批部署）。上一版 v20（2026-11-05，P0 断电 crash loop 修复+装配层 7 断言，157 全绿，v19 同批部署）。上一版 v19（2026-10-10，慢速换号 pendingSlow 修复批——锚点=顶层 v145；部署待小电脑上线补跑）。上一版 v18（2026-10-07，被抢持续垫底批——「首选只是优先不是拉锯」，24h 沉底跨轮避开）。上一版 v17（2026-10-07，`9e1a7d5`，DHCP 探针勘误批——固定探针 MAC + 5000ms 超时，陌生检查伪影根治）。上一版 v16（2026-10-07，检测细化批——wan 三态/restricted 报警/DHCP 主动探测/设备数骤降旁证/探针矩阵）。上一版 v15（2026-10-07，wan 多供应商 AND + routerWatch 主路由无线状态观测批）。上一版 v14（2026-10-07，NAS_*→DEPLOY_* 连接键改名批）。上一版 v13（2026-10-05，通知节流批——60条私信事故整改：翻转聚合/冷却/限频）。上一版 v12（2026-10-05，复活引擎假阳性根治批：接线只吐+wan HTTPS 层验证+成功判定核会话归属）。上一版 v11（2026-10-05，断电感知批）。上一版 v10（2026-10-05，被踢轮换批）。上一版 v9（2026-10-05，真实流量探测批）。上一版 v8（2026-10-04，复活通知滞留根治批；v7 为 open_id 定稿补记）。上一版 v6（2026-09-28，机器人本体私聊通知）。上一版 v5（刷屏事故根治批）。上一版 v4（实测反馈批）。上一版 v3（账号池路径校准修复）。上一版 v2（复活引擎）。上一版 v1（探针开仓）。）

## v1 · 2026-09-27 · 随本提交落地 · feat

**开仓：superqianli 网络日志探针（用户需求：生产内网连不上时想知道主路由/出口的工作状态）**

- 提交说明：feat: netlog 开仓——superqianli/校园网出口连通性探针，断网事件落盘+恢复后飞书汇总补发
- **背景**：全家流量骑在主路由 superqianli（192.168.31.1）学生账号校园网会话上，被踢是常态（lab-network §四）；断网期间任何内网手段都看不到现场，本服务跑在生产机持续探测落盘。路由器本体 miwifi 固件装不了自定义工具，故取「内网侧外部视角」形态。
- **探测**：lan=主路由 192.168.31.1:80 TCP；wan=223.5.5.5/119.29.29.29:443 任一通（纯 IP 排除 DNS 因素）；egress IP=wan 恢复时+每 30min 心跳查（3322/ipify 轮试），变化记 `egress_ip_changed`（飞书 IP 白名单风险信号）。防抖：连续 2 次失败才记 down，一次成功即记 up（带历时）。
- **通知语义**：通知通道与被监控网络同生死，实时通知物理不可能——事件即时尝试推 webhook（与 approval-bot BOT_WEBHOOK_URL 同群），失败/未配置均入积压（backlog.json，上限 50），wan 恢复瞬间汇总成一张卡补发；启动时也尝试补发历史积压。补发按 id 精确剔除，冲刷期间新落盘不覆盖丢失（quiet-flush v87 同款教训回归断言）。
- **落盘**：`NETLOG_DATA_DIR`（部署目标 `C:/qianli/data/netlog`，项目外）下 `net-log.jsonl`（状态行+事件行+15min 心跳行，~100 行/天）+ `backlog.json`。
- **端点**：:3016 `GET /api/health`、`GET /api/netlog/summary`（只读，无写端点/无鉴权项；不收飞书事件不进 CONSUMERS，不违反架构铁律）。
- **部署**：push.js 复制 wecom 版精简（repo:top+SFTP 直传+测试闸门+pm2 delete+start+save）；pm2 名 `qianli-netlog`，save 后并入 `qianli-bots-autostart` resurrect 清单。**零 npm 依赖**（node 内置 http/https/net/fs），不重蹈 dayjs 事故。
- 测试：`scripts/stub-test-netlog.js` 14 断言全绿（防抖/恢复历时/积压补发/冲刷竞态/egress 变化/JSONL 结构）；本地真实冒烟通过（本机在校园网直连场景下正确记录 lan=false/wan=true，正是当下现场画像）。

## v2 · 2026-09-27 · 随本提交落地 · feat

**断网复活引擎：账号池(31108753 首选项) × Dr.COM eportal × 自适应慢速探针 × 月度弃用（曼波三项设计全落地）**

- **「网关实现途径」考古**（本轮关键侦查，详见 lab-network skill §十二）：主路由 WAN=纯 DHCP，自愈靠 Dr.COM MAC 无感知认证；重连真身=4A 时代 `ping.sh`（归档 `qianli-backups/4a-root-ping-archive-20260920.tar.gz`，内含 20230104/20243199 两账号——即曼波所说"存两个现有账号的地方"）；协议实锤 `http://10.10.8.162:801/eportal/portal/`（801=API 端口，登录页在 80/443），`online_list` 实测 200 返回主路由会话详情（IP/MAC/账号 20230104）。
- **src/campusAuth.js**：eportal 协议层（onlineList/login/fetchAuthIp/logout），账号格式 `,0,学号`、密码明文参数、wlan_user_ip 动态取认证页回显（=主路由 WAN IP）；成败以 onlineList/wan 真恢复裁决，不轻信响应文案。
- **src/accountPool.js**：策略池（preferred 首选项永远先试 → priority 轮换；bannedThisMonth 当月弃用自然月自动失效；tmp+rename 原子写回）。池文件 7 账号：曼波新给 5 个（31108753 首选项）+ ping.sh 归档 2 个兜底；工作区根 `campus-accounts.local.json` 为主副本（**/*.local.json 已 gitignore）。
- **src/wanGuard.js**：复活状态机（每 tick 一账号、wan 真恢复算成功、用尽→通知+30min 冷却）+ 慢速判定（恢复后 20s 宽限、3 次探针中位数 > 基线×3 → ban + 自动换号）+ forceRevive（手动实测通道）。基线=健康期滑动 20 样本中位数（下限 30ms）。
- **端点**：`POST /api/netlog/revive`（X-API-Token，timingSafeEqual + fail-closed，未配置=锁定——管理端点鉴权铁律）；summary 增 `guard` 字段。
- **push.js**：账号池上传带备份+条数守卫（权威在部署目标侧时跳过+回填，PUSH_FORCE_PRIVATE 才覆盖）。
- 测试：新增 `stub-test-wanguard.js` 18 断言（首选项优先/换号/慢速 ban/宽限/冷却/lan 断不复活/手动触发），test 链=两套 32 断言全绿。
- 部署后验证：guard 就位、revive 端点无 token 403 fail-closed ✓；真实登录未主动触发（网络健康时不无谓换绑主路由认证），等首次真断网实战或曼波手动按键。

## v3 · 2026-09-27 · 随本提交落地 · fix

**账号池路径校准——本地调试路径上线导致引擎读空池（手动触发实测抓到）**

- 曼波要求实测复活链路，forceRevive 首触发即报 `revive_no_candidates`：push.js 全量覆盖 .env 时把本地 `.env` 的调试路径（`C:/Users/0d00/Desktop/qianli/campus-accounts.local.json`）带了上线，小电脑无此文件 → loadPool 静默空池。
- 修：push.js 上传 .env 后强制 sed 改写目标侧 `NETLOG_ACCOUNT_POOL=C:/qianli/data/netlog/campus-accounts.local.json`（本地调试路径永不上线，目标/本地各得其所）。
- 教训：**部署后验证必须验「池非空」**，guard 就位≠池子就位；push 全量覆盖 .env 的模式对「本机各异路径」类配置天然不安全，此类键一律 push 时校准。

## v4 · 2026-09-27 · 随本提交落地 · fix

**实测反馈批：动作日志带 eportal 响应 msg + summary 队列残留清理**

- forceRevive 二次实测全链路通过：首选项 31108753 先试 → login（authIp=10.253.32.177）→ 44s wan 判定恢复 → 慢速判定运行（探针中位 17ms ≤ 基线 30ms×3，通过不 ban）。
- **实测新知**：eportal 对已在线 IP 返回 `ret_code:2 "IP 已经在线！"` 拒绝二次认证——同 IP 换账号登录在在线状态不可行（断网场景无此门槛）；`wlan_user_ip` 参数不改变判定（按来源 IP）；账号密码正确性仅离线可验，留待真断网实战。
- 修：wanGuard 动作日志记录 login 响应 msg（诊断价值高，如「已经在线」vs「密码错误」一眼可辨）；summary 的 queueRemaining 仅复活态展示（判定通过后不再残留旧队列）。

## v5 · 2026-09-28 · 随本提交落地 · fix

**财务群刷屏事故根治：事件分级 + 空池冷却 + 通知静音（曼波报告批）**

- **事故**：曼波发现财务群被 `[netlog] revive_no_candidates（wan 断且 lan 正常）` 持续刷屏。全量审计对质（日志 0 断采样/0 ban/积压空/事件仅 3 条实测）证明**生产机清白**——真凶=本地开发残留进程（09-27 22:45 本地验证时 kill %1 未杀到 node 子进程，PID 36720 活了一夜），跟着曼波笔记本的「31.1 可达+公网探测不通」状态每分钟触发空池复活，用本地 .env 复制的财务群 webhook 轰炸。
- **根治三连**：①事件分级——`NOTIFY_IMMEDIATE` 白名单（lan/wan 断通、出口 IP 变化、revive_exhausted）才尝试即时外发，过程事件（revive_start/success/no_candidates/account_throttled）只落盘+进积压（断网恢复后由汇总卡带上，平时零打扰）；②空池冷却——`revive_no_candidates` 触发与 exhausted 同款 30 分钟冷却，不再每 tick 重发；③webhook 全线静音——本地 .env 与部署目标侧 NETLOG_WEBHOOK_URL 均置空（财务群不该收 netlog 消息；等曼波指定通知群后再配）。本地残留进程已处决（PID 36720）。
- 测试：新增事件分级回归断言（过程事件 process-event 标记积压不外发/关键事件积压语义），两套 35 断言全绿。
- 教训：①bash 后台 job 的 `kill %1` 不可靠（node 子进程可能脱离 job 表），本地跑服务类进程后必须 `tasklist/netstat` 复核；②本地 .env 与生产共键的 webhook 类配置，本地调试前先置空；③「一直在播报」类报告先做数据对质再定责——本案生产机三方证据（日志/积压/ban 记录）全部清白。

## v6 · 2026-09-28 · 随本提交落地 · feat

**通知出口切换：不用 webhook，机器人本体私聊直发（曼波拍板）**

- **src/feishu.js**：共用应用（对话型「爆米花机-对话型」同款应用）tenant_access_token 获取+内存缓存（提前 5min 刷新）+ IM API 私聊文本（`receive_id_type=open_id`）。性质=机器人主动播报（同 ticket-bot 私聊结单提醒先例），不消费消息事件，不违反对话铁律。webhook 通道整体移除（sendWebhook/CONFIG.webhookUrl 删除）。
- **sendNotify 多目标分派**：NETLOG_NOTIFY_OPEN_IDS（逗号分隔多 open_id）逐个私聊，Promise.allSettled——任一成功即送达（部分失败记 warn），全失败抛错进积压（恢复后汇总补发）。事件分级（v5）不变：过程事件只落盘+积压，关键事件（断/通/IP 变化/exhausted）即时私聊。
- 配置：`NETLOG_FEISHU_APP_ID/SECRET`（共用应用凭据，approval-bot 同源）+ `NETLOG_NOTIFY_OPEN_IDS`（当前=审批域两个候选 open_id，等曼波确认哪个是他本人后收敛）。
- 测试：feishu 桩（require.cache 替换 + __dmFail 失败开关）——私聊失败积压/恢复汇总补发经私聊/冲刷期间新落盘不丢/过程事件不外发，两套 35 断言全绿。踩坑记录：bash heredoc 的 `
` 多层转义会被折叠成真实换行（agent-ops-gotchas 的 chr() 教训再次应验）。
- 实测：两个候选 open_id 各发一条通道测试私聊，均发送成功（飞书 API 200）；等曼波确认收件情况后收敛 open_id 列表。


## v7 · 2026-09-28 · `8a96b72`（顶层 v123 联动记账）· chore

**通知 open_id 收敛定稿：曼波本人（A/B 实测闭环）**

- v6 向两个候选 open_id 各发通道测试私聊后，曼波确认本人收件：`NETLOG_NOTIFY_OPEN_IDS` 收敛为 `ou_249993fe…`（曼波本人；另一候选 `ou_54493ce1…` 为催办兜底人配置位，非本人，重号调正）。纯 `.env` 变更（不入库），随顶层 v123 提交记账，本条目为 DEVLOG 补记——闭环 v6 文末「等曼波确认后收敛」。
- 通知链路行为无变化（私聊多目标分派，配置剩一个目标照样跑）；无代码改动。

## v8 · 2026-10-04 · 随本提交落地 · fix

**复活通知积压滞留根治 + DownSince 清零（10-03/10-04 两起实况复盘批）**

- 实况复盘（曼波问「网关状态播报是探知有问题还是真的有问题」）：10-03 目标机白天断电停机约 10h（RTC 停在 09-30，16:22 NTP 校时跳变 3.4 天——断电窗口 netlog 同机同命无记录，属「通知与被监控网络同生死」设计固有盲区；校时跳变另在 approval-bot 侧诱发 qrcode crash 风暴，见其 v67）；10-04 凌晨 02:29–07:02 多轮 lan+wan 同时失败为**真断**（机器活着在记录，路径级故障）；20:21 wan 认证掉线为**真断**，复活引擎 55s 自愈（第二次实战胜，首选项一发命中）。
- **Bug① 复活通知滞留**：复活引擎用当轮原始信号触发（有意抢在 2 轮防抖前自愈），短暂断网常不产生状态机 down→up 翻转 → flushBacklog 只认翻转触发，revive_start/success 通知卡永远滞留积压（20:21 实况：自愈成功但复活通知未达，backlog 挂着 2 条 process-event）。修正：**wanOk 每轮尝试冲刷**（空积压零成本），部署后首个 tick 自动补发历史滞留；「原始信号 vs 防抖态」语义在 index.js/wanGuard 注释对齐成文（原注释误写「防抖后语义」）。
- **Bug② DownSince 不清零**：恢复后 summary 的 lanDownSince/wanDownSince 仍挂旧断开时刻。修正：flip up 时清零。
- 测试：stub 22+18=40 断言全绿；新增 复活自愈冲刷三断言 + DownSince 清零断言。README 冲刷时机成文。
- 随批并入 v7 遗留未提交改动（.env.example 移除废弃 NETLOG_WEBHOOK_URL、index.js 文案）；push.js 新增部署后健康检查（approval-bot v67 同款）。

## v9 · 2026-10-05 · 随本提交落地 · feat

**真实流量探测（traffic 维度）+ 复活引擎软踢触发（曼波「握手通但网页刷不开」实况批）**

- 背景：10-04 晚曼波体验断网，但 netlog 全绿（20:22 复活引擎用 31108753 救活后 TCP 层零失败）——TCP 握手测不出软踢/限速：Dr.COM 系对配额用完账号常「小包能过、大流量卡死」。曼波手动登录自己账号（20251852）立刻恢复 = 软踢假设最强佐证。eportal onlineList 实证当前在线会话=20251852（曼波本人，0.1h）。
- **traffic 探测维度**：`NETLOG_TRAFFIC_URLS`（默认 miui/vivo 两个 generate_204 源）HTTP 全链路验证，status=204 即通过，多候选轮试；被认证网关劫持重定向（非 204）记失败。防抖/恢复语义与 lan/wan 一致（threshold=2），事件 `traffic_down`/`traffic_up` 进即时外发白名单，状态行带 `traffic` 字段，summary 带 `traffic`/`trafficDownSince`。
- **复活引擎软踢触发**：guard 钩子收 `(wanOk, lanOk, trafficOk)` 三参——「wan 握手通但流量断」同样启动复活（事件 detail 注明软踢嫌疑）；复活成功判定改 wan+traffic 双通（不看流量会把软踢会话误判为已复活）；软踢复活中流量未恢复照常换号。
- 未注入 probeTraffic 时 trafficOk 恒真（旧桩/纯 TCP 语义兼容，无事件噪声）。
- 测试：stub 29+23=52 断言全绿；新增 traffic 防抖翻转六断言 + 兼容断言 + 软踢复活三断言 + 软踢换号断言。
- 已知限制：账号池未收录曼波本人账号（20251852）——软踢复活只能换池内账号救，若曼波账号被软踢、复活成功后曼波设备仍慢，需把 20251852 加入账号池（凭据曼波自管，部署目标 C:/qianli/data/netlog/campus-accounts.local.json）。

## v10 · 2026-10-05 · 随本提交落地 · feat

**复活引擎近期被踢轮换（曼波定：被踢就换下一个，不做互踢对拍）**

- 背景：10-04 晚 31108753 会话被顶（疑似他处有人用同号），复活引擎抢回后对方再抢=互踢拉锯。曼波定逻辑：**被踢说明账号被抢，正确动作是换下一个，不是抢回来**。
- 实现：wanGuard 新增 `lastRevive {user, at}`（revive_success 时登记）+ `KICK_ROTATE_WINDOW_MS=30min`——`startRevive` 时若上次复活成功的账号在 30 分钟窗口内、且还在候选里，把它排到队尾（其余保序），事件注记「上次 XX 刚被踢，本轮轮换避开（排最后）」；窗口外的全新掉线仍按优先级首选开始。连带修一个陈年小刺：startRevive 时清掉上一会话遗留的 pendingSlow（否则新复活成功判定被旧慢速判定吞一个 tick，测试场景 11 抓出）。
- summary 的 guard 段新增 lastRevive（账号+时刻）供观察。
- 测试：stub 29+29=58 断言全绿；新增 轮换两场景六断言（窗口内轮换+注记+第二账号成功；窗口外仍首选）。

## v11 · 2026-10-05 · 随本提交落地 · feat

**断电感知：离线后重新上线通知卡（曼波问「断电自活有吗」的软件侧配套）**

- 背景：10-03 目标机断电 10h 期间本服务同死、恢复后也无人知晓——「通知永远只该迟到，不该缺席」。
- 实现：启动时读 jsonl 上一进程最后心跳时刻，与当前间隔超 `NETLOG_OFFLINE_NOTIFY_MS`（默认 15 分钟，秒级常规重启不触发）→ emit `boot_after_offline`（即时外发白名单；启动时若网络未就绪则自动落积压随恢复补发），卡文案带离线时长与断电后自检提示（BIOS「After Power Failure=Power On」+ CMOS 电池）。
- 断电自活的自动通电部分=硬件侧：目标机为 Intel NUC10i7FNK（vPro，LMS 服务在跑），BIOS「After Power Failure」无远程接口需现场一次（F2 → Power）；CMOS 电池疑失效（RTC 曾停在 09-30），建议同场更换 CR2032，否则 BIOS 设置断电即丢、来电自启白设。MEBx/AMT 初始化（可远程开机）留档待议。
- 测试：stub 35+29=64 断言全绿；新增 offlineGapInfo 六断言（首跑/秒级重启/阈值边界/分钟·小时·天表述）。

## v12 · 2026-10-05 · 随本提交落地 · fix

**复活引擎假阳性根治批（2026-10-05 05:28 掉线事故复盘三连修）**

- 事故：05:26 traffic_down 判定后引擎整晚安睡（lastRevive=null），曼波手动登号才恢复；复盘发现 10-04 夜间 6+ 段断网的「自愈」全是干等校园网放行，引擎从未参与。
- 修复①（元凶·接线丢参）：`index.js` 的 guard 挂载 wrapper 只收 `(wanOk, lanOk)` 两参，engine 传的 trafficOk 被丢弃 → guard 恒收 true，**v9 软踢复活从未生效过**。补齐三参透传。
- 修复②（wan 探测假阴性）：TCP connect 223.5.5.5:443 在认证死掉后仍被网关代答握手成功 → wan 恒 true。升级为「TCP 预检 + HTTPS DoH 数据面验证」：新增 `probeHttps`/`dohResponseOk`（200 且 body 含 DoH `Status` 字段才算出网——代答伪造不了 TLS 上的合法响应，captive portal 劫持页 body 也不是 DoH JSON）；`httpRequestText` 加 `tls` 选项透传（裸 IP 访问 223.5.5.5 证书 SAN 不匹配）；`probeLatency` 基线采样同步走 HTTPS（TCP 代答握手几 ms 会把基线压到下限、慢速判定失真）。新 env：`NETLOG_HTTPS_TARGETS`（默认 DoH 223.5.5.5）。
- 修复③（成功判定假阳性）：出口本通时 forceRevive 的 login 被「IP 已经在线」拒、wan 探测照样过 → 误记 revive_success。复活成功判定新增 `verifySession(user)`（online_list 归属核验，guard 依赖注入）；归属非本账号 → 新事件 `revive_session_mismatch`（即时外发白名单）+ 30 分钟冷却（防「断网+IP 被占」每分钟重试刷屏）；验证接口异常 → 降级按 wan 探测放行（不因 online_list 抖动卡死复活）；未注入 verifySession 时完全向后兼容旧语义。
- 测试：stub 39+38=77 断言全绿（+13：dohResponseOk 四断言；归属核验三场景——mismatch 无假阳性+冷却防刷屏、正常归属成功、接口异常降级）。


## v13 · 2026-10-05 · `52a3a4e` · fix

**通知节流批（「60 条私信」事故整改，曼波指令：一并修复）**

- 事故：2026-10-05 校园网软踢拉锯日，即时事件全天天轰炸曼波私聊 59 条（traffic_down 18 + traffic_up 18 + revive_session_mismatch 20 + egress_ip_changed 3）+ 汇总卡——翻转逐条即时私聊 + mismatch 30 分钟重试即重报，两层都没考虑「同一局面持续一整天」的场景。
- 修复①（翻转→事故聚合）：`*_down/*_up` 翻转痕迹只落盘（jsonl 事件流不变可回放），不再逐条私聊；报警改走聚合通道——`*_down_sustained`（断开持续 ≥10min 才即时报警，之后每 2h 复报一次）、`*_recovered`（恢复汇总卡：30min 抖动群窗口内累计断开 ≥5min 或 ≥3 次才发，或持续断开后恢复必发）。引擎新增 `incidents` 抖动群状态（openSegment/closeSegment/checkSustained/expireIncidents），summary 直出观察窗。
- 修复②（mismatch 通知冷却）：`revive_session_mismatch` 加 4h 冷却（`NOTIFY_COOLDOWN_MS`，仅私聊成功才占用冷却）；冷却期内只落盘+进积压。账号被抢拉锯期 30 分钟一轮 × 13h = 20 条/天的重复播报没有信息增量。
- 修复③（积压补发限频）：flush 三条件任一才发——wan 恢复翻转旁路（flushAsap，v8 滞留教训的语义保底）/ 攒够 `NETLOG_FLUSH_BATCH`(10) 条 / 距上次成功补发超 `NETLOG_FLUSH_COOLDOWN_MS`(2h)（迟到兜底）。此前 wan 通着每轮尝试，拉锯期过程事件每 30 分钟落 2-3 条 → 每轮一张汇总卡。
- 量化预期：同款拉锯日 59+ 条 → 持续断开报警/恢复卡 0-2 条 + mismatch ≤4 条（4h 冷却）+ 汇总卡 ≤ 数张（2h 兜底）；真断网语义不变（sustained 报警断网期间发不出去自动进积压、恢复瞬间 flushAsap 优先送达）。
- 新 env（均有默认）：`NETLOG_DOWN_ALERT_MS`(10min) / `NETLOG_STILL_DOWN_REALERT_MS`(2h) / `NETLOG_FLAP_ALERT_MS`(5min) / `NETLOG_FLAP_COUNT_ALERT`(3) / `NETLOG_FLAP_WINDOW_MS`(30min) / `NETLOG_MISMATCH_NOTIFY_MS`(4h) / `NETLOG_FLUSH_COOLDOWN_MS`(2h) / `NETLOG_FLUSH_BATCH`(10)。
- 测试：stub 53+38=91 断言全绿（+14：抖动群三段聚合/短抖动静默、sustained 报警+2h 复报+恢复卡、mismatch 冷却三态、补发限频三条件+恢复旁路；改写 v1 期「翻转即私聊」旧断言三处）。

## v14 · 2026-10-07 · 随本提交落地 · chore

**NAS_*→DEPLOY_* 连接键改名批（旧 NAS 残留清理，曼波定）**

- push.js 读键/注释/报错文案、.env.example、README 部署行、本地 .env 键改名（push 时覆盖部署目标同批生效）；
- 顺手回填：头部指针补 v13（通知节流批，上批漏更新）；
- 不影响运行时行为。

## v15 · 2026-10-07 · 随本提交落地 · feat

**wan 多供应商 AND + routerWatch 主路由无线状态观测（「新设备连上没网」事故批）**

- 提交说明：feat: netlog v15——wan DoH 验证阿里+腾讯双源 AND（封死受限会话对阿里白名单真实放行的假阳性通道）+ routerWatch 低频观测主路由无线状态（管理面失联/射频配置异常/ax 翻转→事件+飞书通知）
- **背景**：2026-10-07「新设备连 superqianli 连上没网」事故——RD08 固件（1.1.96）射频半死+DHCP 僵死，小电脑（有线侧）自身网络全程健康，探针全绿：netlog 物理上感知不到无线侧生病。本批两路补盲：
  - **wan 多供应商 AND**（`wanPlanePass`）：v12 的 DoH 验证目标只有阿里单源，实锤受限会话（认证死未重连）对阿里白名单是真实放行——单源测不出「只能上阿里」的半残态。加腾讯 DoH（120.53.53.53），默认双源全部通过才算 wanOk；`NETLOG_HTTPS_TARGETS` 可覆盖
  - **routerWatch**（`src/routerWatch.js`）：低频（默认 10 分钟）登录 miwifi 拉 `wifi_detail_all`，管理面失联（`router_mgmt_down`/`router_mgmt_recover`）、射频配置异常（`router_radio_down`）、ax 翻转（`router_ax_changed`）→ 翻转才发事件，走 jsonl+飞书通知链路；`NETLOG_ROUTER_PASSWORD` 未配置=停用
  - **不做自动重启路由器**：netlog 感知不到无线半死的全部形态，误重启代价大（全家断 2 分钟）；无线侧救场=每周二 04:03 定时重启（小电脑 schtask `qianli-router-weekly-reboot`，本批前已落地并干跑验证）+人工
- 测试：新增 stub-test-routerwatch.js（13 断言）；stub-test-netlog 扩至 56（⑯ wan 多供应商 AND 三断言）；三套合计 107 断言全过，npm test 链已纳入 routerwatch
- 踩坑：本批排查中曾误判「主路由认证会话丢失」——eportal `online_list` 按查询者视角返回（跨网段查询只看到查询者自己的会话），会话归属判断必须站在主路由 NAT 侧复核；另 miwifi `set_wifi_ax` 只吃 form urlencoded（JSON 报 1502）、ax 切换会偶发射频/服务半死（物理重启是唯一可靠恢复），详见 skill 与运维台账


## v16 · 2026-10-07 · 随本提交落地 · feat

**检测阶段细化批（曼波「效果还是很差」反馈）：wan 三态 + restricted 报警 + DHCP 主动探测 + 设备数骤降旁证 + 探针矩阵**

- 提交说明：feat: netlog v16——wanPlaneJudge 三态（ok/restricted/down，restricted=「部分白名单通」认证半残指纹，翻转即私聊）+ routerWatch 挂 DHCP DISCOVER 主动探测（连续 2 次无应答报警，直击 10-07 半死病灶）+ 在线设备数骤降旁证（基线中位数 50%）+ /api/netlog/summary 输出逐目标探针矩阵
- **背景**：v15 上线后复盘——既有检测全是「既有会话视角 + 布尔结果」，10-07 上午的病（DHCP 僵死+数据面半死）在配置层（wifi_detail_all）与布尔探针里全绿，「新设备入网视角」与「异常的层次」双缺。本批细化：
  - **三态**：wanPlaneJudge 全过=ok / 部分过=restricted / 全不过=down；restricted 翻转发 `wan_restricted`（进 NOTIFY_IMMEDIATE，认证半残需要快），复活引擎由既有 wanOk=false 单轮触发链路自愈
  - **DHCP 主动探测**（`src/dhcpProbe.js`）：构造最小 DHCPDISCOVER 广播（随机 xid/chaddr，绑 68 端口等 BOOTREPLY），连续 2 次无应答报 `router_dhcp_down`——对租约零副作用（DISCOVER 不写租约）；68 被占等能力缺失时 skipped 静默降级
  - **设备数骤降旁证**：devicelist 计数滑窗中位数基线，跌破 50% 报 `router_clients_massdrop`（发病时客户端集体迁逃的强旁证），回升 80% 报 recover
  - **探针矩阵**：summary 新增 probeMatrix（wanTcp/wanDoh 逐目标/traffic 逐源 status）——报警一眼看清哪层坏，不再猜
- 测试：netlog 60（⑯ 扩三态 4 断言）/ routerwatch 26（⑦DHCP 5+⑧骤降 4+⑨报文结构 4）/ wanguard 38，合计 **124 断言全绿**；踩坑一笔：wanPlanePass 适配三态签名时漏执行探测（把目标串当结果串），⑯b 断言当场抓获——新增行为配断言的铁律又一次回本

## v17 · 2026-10-07 · `9e1a7d5` · fix

**DHCP 探针勘误批（曼波质疑成案）：固定探针 MAC + 5000ms 超时——dhcp_down 振荡全是伪影**

- 提交说明：fix: netlog v17——DHCP 探针勘误：RD08 对陌生 MAC 首查有 3.0~3.9s 检查路径（同 MAC 进快表后毫秒级，已知 MAC 恒 4-6ms），v16 随机 MAC+默认 3000ms 超时=每次走陌生路径在 3 秒线上掷骰子，router_dhcp_down/recover 振荡全是探针伪影（DHCP 服务从未挂过）；v17 固定探针 MAC（02 本地管理位，NETLOG_DHCP_PROBE_MAC 可覆盖）+5000ms 超时，首查进快表后恒毫秒级应答，连续超时=服务真挂（真半死判据=已知 MAC 也慢/无应答）
- **勘误经过**：v16 上线当天 11:01/11:31 报两次 `router_dhcp_down`，曼波质疑「会不会是网关架构或设置问题」，三组实验翻案：①已知 MAC（有租约设备）DISCOVER 恒 4-6ms；②新 MAC 首次 3.0-3.9s、同一 MAC 第二次起 4ms——RD08 固件对陌生设备的检查路径，查过进快表；③31.1 dnsmasq 应答 1-5ms、校园网 DNS 202.202.2.50 UDP53 通——「DNS 拖死 DHCP」假设不成立。结论：DHCP 服务健康，down/recover 全是「随机 MAC × 3 秒检查 × 3000ms 超时」的测量伪影。真半死判据修正=**已知 MAC 也慢/无应答**（10-07 凌晨 ax toggle 后那种才是）
- 改动：`dhcpProbe.js` 参数化 mac（buildDiscover/probeDhcp 接受 6 字节 mac，缺省保留随机历史行为）+ 导出 DEFAULT_PROBE_MAC/PROBE_TIMEOUT_MS/parseProbeMac；`index.js` 组装传固定 MAC+5000ms（env `NETLOG_DHCP_PROBE_MAC` 可覆盖，非法值回退默认）；routerWatch down 文案改「固定探针 MAC 连续 N 次超时=服务真挂」
- 同批事实入档（qianli-lab-network skill §十四）：HP M232「连 SuperQianLi 拿 192.168.3.x」定案=**投奔满格「裁判系统」SSID**（设备按信号挑已记忆网），拿裁判租约（网关=死地址 192.168.5.1）必没网；排除 rogue DHCP（5 轮 DISCOVER 唯一应答者 31.1 + SendARP 二层直探 3.1/5.1/1.1/2.1 全无应答）；devicelist 僵尸条目实锤（HP 31.105 / AMPAK 50:41:1C:52:BE:6E 即 31.88，ARP/端口全无应答）
- 测试：routerwatch 26→33（⑩固定探针 MAC 7 断言：chaddr 写入/本地管理位/超时下限/缺省随机/parseProbeMac 合法性/probeDhcp mock 发包 chaddr/timeout 路径）；三套合计 **131 断言全绿**
- 「新设备连上没网」的机制性残余：新设备首答 3~4 秒，超时紧的客户端（部分 IoT/打印机）会放弃；消除方案=关主路由「新设备接入确认/防蹭网」类开关（安全权衡用户定，本批未动路由器任何设置）

## v18 · 2026-10-07 · 随本提交落地 · feat

**被抢持续垫底批（曼波定「首选只是优先不是拉锯」）：被抢账号 24h 沉底跨轮避开，不再窗口一过就回首选对拍**

- 提交说明：feat: netlog v18——被抢持续垫底：复活成功 30min 内又掉线=账号被抢（2026-10-07 15:2x 实锤：31108753 被 15:10 复活后 6 分钟内两度被顶），v18 起持久垫底 24h（NETLOG_KICK_DEMOTE_HOURS 可调）跨轮跨重启避开、到期自动复位（仍被抢自适应续垫）；判定窗口 30min 不变；account-demotions.json 独立状态文件（池种子部署不覆盖）；account_demoted 即时私聊 4h 冷却
- **背景**：当天 15:10 引擎用 31108753 复活成功，15:16/15:23 两度被顶（该账号疑似本主在别处登录，Dr.COM 单账号并发互踢）；v10 的「被踢轮换」只记 lastRevive 单值+30 分钟窗口——窗口一过就忘了谁被抢过，每轮断网都重新从首选开始跟人对拍，拉锯周期性复发。曼波拍板：首选的语义只是优先，被抢就该换下一个持续避开
- **改动**：accountPool.js 增 createDemoteStore（独立状态文件+原子写+读时惰性过期）与 rankWithDemotions 纯函数（健康档在前、垫底档沉底、各自保持原序、不剔除账号——全池垫底不失能）；wanGuard.js startRevive 被抢命中改调 demote(user, 24h)（未注入时退化旧「本轮排队尾」语义）；index.js 组装层 candidates 合成垫底排序 + NOTIFY_IMMEDIATE/冷却表加 account_demoted（4h 冷却）；summary guard 段新增 demotions 可观测
- **两档语义区分**：bannedThisMonth（限速）=当月彻底不选；demoted（被抢）=可用但垫底，到期复位。检测窗口 KICK_ROTATE_WINDOW_MS=30min 保持不变（「复活成功后短时间内又掉线」的判定依据），变的是惩罚时长（本轮队尾→24h 持久）
- 测试：stub-test-wanguard 38→52（§11 重写+§11.5 垫底跨轮持续/§11.6 到期复位/§11.7 全垫底不失能/§12 补不误判断言）；三套合计 **145 断言全绿**；push.js 零改动（数据目录不在上传清单）

## v19 · 2026-10-10 · 锚点=顶层 v145 归档提交 · fix

- **慢速换号分支未清 pendingSlow（P2）**：slowCheck 判慢 ban 后的换号分支直接 return，挂起判定仍指旧被 ban 账号——下个 tick 的 slowCheck 优先执行：重复 ban、重复发 account_throttled/revive_start、对同一替号账号每 tick 重复 login（eportal 刷请求），替号永不进入成功验证，直到链路变快或转断才自愈。修复：换号分支 return 前清 state.pendingSlow（替号复活成功后会挂自己的慢速判定）。
- stub-test-wanguard 补「3b 换号后下一 tick」场景 5 断言（不重复 ban/不重复发事件/不重复 login/替号成功收尾/判定转挂替号），52→57 断言。
- npm test 三套 150 断言全过。部署状态：部署因小电脑离线挂起，上线后重跑 npm run push 补部署。
## v20 · 2026-11-05 · 随本提交落地 · fix

**P0 断电 crash loop 修复 + main() 装配层补桩（2026-11-04 深夜全量审查批，network-dt-evt_018；v19 同批部署）**

- **P0 fmtTs ReferenceError（src/index.js:776）**：boot_after_offline 分支引用仅存在于 createEngine 闭包的 fmtTs——断电/停机超 15min 后重启即 ReferenceError，崩溃点在首个 engine.tick() 前，jsonl 尾行永不推进→确定性 crash loop 至 pm2 errored，「断电感知通知」功能本身杀死探针+复活引擎。v11 引入、150 条 stub 未抓住（main() 装配层零覆盖）。
- **修复**：fmtTs 原样提升到模块作用域（闭包内重复定义删除，engine 返回值同址，14 处调用点行为零变化；导出的 fmtShanghai 是 ISO 带毫秒格式、语义不同故不采用）。
- **补桩（scripts/stub-test-netlog.js 第 17 组，+7 断言）**：子进程整体拉起 main()（--require preload 钉死全部 NETLOG_* 桩值+monkey-patch http.createServer/setInterval unref），生产代码 main() 零结构改动——17a 长停机（2h 前 jsonl 尾行）启动不崩、boot_after_offline 落盘可回放、+08:00 口径、通知失败入积压；17b 常规重启（5s）不误报；17c 首跑不误报。**红绿实证：修复前 63 过/4 败（stderr 实锤 fmtTs ReferenceError），修复后 67/67。**
- **README**：断言数 60→67、wanguard 52→57（存量漂移顺手对齐）、合计 145→157。
- **push.js tearingDown 守卫**：收尾 ECONNRESET 误报固化为代码（全量审查 P2）。
- **部署注意**：修复后首次真实生效——若小电脑重启距上次心跳>15min，boot_after_offline 卡会首次真正发出（此前该场景 100% crash loop），是预期行为非新噪声。
- **测试**：三套 157 断言全绿（netlog 67/routerwatch 33/wanguard 57）。
## v21 · 2026-11-11 · 随本提交落地 · feat

**NETLOG_NOTIFY_ENABLED 播报总开关——曼波拍板「断网播报全关」（2026-11-11 深夜）**

- 背景：曼波被断网私聊轰炸（校园网会话被踢常态化的伴生噪声），拍板断网播报全关。netlog 通知出口自 v6 起仅机器人本体私聊（webhook 群卡通道 v6 已移除、`.env` 的 NETLOG_WEBHOOK_URL 为僵尸键）——「爆米花机发来的断网私信」即本服务 DM（共用应用 cli_aac7e6f6cdf8dcc0，目标 NETLOG_NOTIFY_OPEN_IDS=曼波本人）。
- **开关语义**：`NETLOG_NOTIFY_ENABLED`（默认开，`!== 'false'` 模式同 reviveEnabled、deps 可注入）——`false` 时 ①notify() 直接返回：不外发不积压（emit 先 record，jsonl 事件流照记可回放）②flushBacklog() 跳过：积压文件保持原样（不补发不丢弃）③sendNotify() 抛错兜底（全部调用方带 catch）④启动日志显形「通知=已全关」。
- **桩测试**：第 18 组 +5 断言（即时报警不外发/不积压、过程事件只落盘、积压原样、对照默认开）。踩坑实录：本地 .env 置 false 后 loadDotEnv 渗入测试进程，把 21 条通知路径断言打哑（51/21）——顶部与 17 节子进程 preload 各补一处 NETLOG_NOTIFY_ENABLED 环境钉死（''≠'false'→开启）后 72/0。三套 162 断言全绿（netlog 72/wanguard 57/routerwatch 33）。
- **文档**：README 事件与通知节补开关条目 + 顺手清理 :26 预存游离 `+`；`.env.example` 补 `NETLOG_NOTIFY_ENABLED` 行；.env 注释修正僵尸 webhook 表述；lab-network skill §八同款过时句（「webhook 与 approval-bot 播报同群」→机器人本体私聊+播报已全关）同步修正。
- **线上**：部署目标 .env 置 NETLOG_NOTIFY_ENABLED=false，push 后 pm2 delete+start 生效。恢复方式：改 true 重启。
