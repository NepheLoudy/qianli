# qianli-netlog · 实验室网络日志探针

> 2026-09-27 v1 上线（用户需求：「给 superqianli 系统做个网络日志，生产内网连不上时想知道它的工作状态」）。

## 定位与边界

**superqianli = 主路由 192.168.31.1（RD08）**，全家唯一校园网出口（学生账号认证会话，qianli-lab-network skill §一/§四）。路由器本体是 miwifi 固件，装不了自定义日志工具，且断网时路由器自身日志也取不出来——所以本服务跑在**生产机（小电脑 DESKTOP-FE1MIGI）**上，从内网侧持续探测「superqianli 活着没 + 校园网出口活着没」，落盘记录，恢复后把断网期间的事件汇总卡补发到通知人私聊（机器人本体 DM，v6 起替代 webhook）。**通知通道与被监控网络同生死：实时通知物理上不可能，「落盘 + 恢复补报」是唯一正确语义**（断网一结束、wan 一通，汇总卡即达）。

本服务不是飞书机器人：不收事件、不进网关 CONSUMERS、无长连接（不违反架构铁律）；管理写端点仅 `POST /api/netlog/revive`（挂 `X-API-Token`，timingSafeEqual + 未配置即锁定，v2），其余两个 GET 只读。

## 探测项

| 项 | 目标 | 判定 | 含义 |
| --- | --- | --- | --- |
| lan | 主路由 `192.168.31.1:80` TCP | 通/不通 | 路由器与内网活着没 |
| wan | `223.5.5.5:443` / `119.29.29.29:443` 任一通 | 通/不通 | 校园网认证会话活着没（用 IP 不用域名，排除 DNS 因素） |
| traffic | `generate_204` 源 HTTP 全链路（`NETLOG_TRAFFIC_URLS`，多候选任一 204 即通） | 通/不通 | **用户意义上的网络可用**——TCP 握手测不出软踢/限速：Dr.COM 系对配额用完账号常「小包能过、大流量卡死」，握手全绿但网页刷不开（2026-10-04 曼波实况）；被认证网关劫持重定向（非 204）同样记失败 |
| egress IP | 3322/ipify 等回显源轮试 | IP 文本 | 校园网会话重连后出口 IP 变化 → 飞书 IP 白名单风险信号（lab-network §四） |

- **防抖**：连续 `NETLOG_FAIL_THRESHOLD`（默认 2，即 2 分钟）次失败才记 `*_down`；一次成功即记 `*_up`（带断开历时）。单次抖动不刷屏。
- **出口 IP 限频**：wan 刚恢复时 + 每 30 分钟心跳时才查（多候选源轮试，失败不阻塞）。

## 事件与通知

- 事件：翻转痕迹 `*_down` / `*_up`（lan/wan/traffic）只落盘可回放；即时外发白名单 = `*_down_sustained`（持续断开 ≥10min 报警 + 每 2h 复报）、`*_recovered`（抖动群恢复汇总：窗口 30min 内累计 ≥5min 或 ≥3 次，或持续断开后恢复）、`egress_ip_changed` / `revive_exhausted` / `boot_after_offline` / `revive_session_mismatch`（v13 起 4h 通知冷却）——2026-10-05「60 条私信」事故整改：翻转逐条私聊在校园网拉锯日 = 36 条/天轰炸
- **断电感知（v11）**：启动时与上一进程最后心跳间隔超 `NETLOG_OFFLINE_NOTIFY_MS`（默认 15 分钟，秒级常规重启不算）→ 发「设备离线 X 后重新上线（疑似断电）」卡。机器断电时本服务同死无法实时报警，恢复后立刻补报是唯一正确语义（10-03 断电 10h 无声无息的教训）。过程事件 `revive_start` / `revive_success` / `revive_no_candidates` / `account_throttled`（只落盘+积压）；
- **事件分级（v5 刷屏整改 → v13 事故聚合）**：翻转不逐条私聊（落盘为准），报警走「事故聚合」通道；过程事件绝不即时外发——否则误判/循环触发时会对通知人每分钟刷屏；
- 通知出口（v6，曼波拍板「不用 webhook 用机器人本体」）：私聊 `NETLOG_NOTIFY_OPEN_IDS`（当前=曼波本人），任一目标送达即成功；
- **播报总开关（v21，曼波 2026-11-11 拍板「断网播报全关」）**：`NETLOG_NOTIFY_ENABLED=false` → 即时私聊/积压补发**全静默**，事件流照落盘可回放，积压文件保持原样（不补发不丢弃）；恢复=改 `true` 重启生效；
- **断网时即时私聊必然推不出去，自动入积压**（`backlog.json`，上限 50 条丢最旧）；wan 恢复瞬间把积压**汇总成一张卡**补发（哪断的、断了几段、各多久，一眼看完）；
- 通知目标未配置时事件同样入积压，配置补上并重启后由启动补发送达；
- 冲刷时机（2026-10-04 引入每轮尝试 → v13 加限频）：三条件任一才发——wan 恢复翻转旁路 / 攒够 10 条 / 距上次补发超 2h。只认翻转会滞留复活通知（10-04 20:21 实况），不限频会在拉锯期每分钟一张汇总卡。
- **被抢持续垫底（v18，曼波定「首选只是优先不是拉锯」）**：复活成功后 30 分钟内又掉线 = 该账号被别人抢——**持久垫底 24 小时**（`NETLOG_KICK_DEMOTE_HOURS` 可调，跨重启保留），期间候选排序沉底、只在没得选时才轮到，到期自动复位（若仍被抢再次命中检测继续垫底，自适应）。事件 `account_demoted` 即时私聊（4h 冷却）。垫底状态存独立文件 `account-demotions.json`（数据目录，push.js 不上传——池配置文件是部署种子，垫底=运行时状态不随部署丢失）。判定窗口 30 分钟不变（判定依据）；窗口外（≥30 分钟）的全新掉线不误判被抢，仍按优先级首选开始。summary 的 guard 段带 `lastRevive` + `demotions` 供观察。
- **软踢复活（v9）**：复活引擎收到当轮 trafficOk——「wan 握手通但流量断」同样触发复活（重新认证换号可救），wan+traffic 双通才判复活成功；恢复判定不看流量会把软踢会话误判为已复活。
- 补发按条目 id 精确剔除已发——冲刷期间新落盘的积压不被覆盖丢失（quiet-flush v87 同款教训回归，stub 有断言）。

## 数据落盘

- 默认 `~/qianli-data/netlog/`（部署目标 .env 显式配 `NETLOG_DATA_DIR=C:/qianli/data/netlog`），**项目外**，重部署不丢；
- `net-log.jsonl`：状态行（每轮）+ 事件行（状态变化必记 + 15 分钟心跳行防纯空白），~100 行/天，不做轮转；
- `backlog.json`：待补发通知积压；
- `account-demotions.json`（v18）：账号垫底状态（被抢 24h 沉底），独立于池配置文件、push.js 不触碰。

## HTTP 端点

```
curl localhost:3016/api/health          # GET {ok, lan, wan, egressIp, uptime}
curl localhost:3016/api/netlog/summary  # GET 当前状态 + 最近 50 条事件 + guard 引擎状态（内网可达时人工查现场用）
curl -X POST localhost:3016/api/netlog/revive -H "X-API-Token: ..."  # 管理端点：手动触发复活流程（v2）
```

## 配置（.env，见 .env.example）

探测参数默认即可；通知出口用 `NETLOG_FEISHU_APP_ID/SECRET`（共用应用凭据）+ `NETLOG_NOTIFY_OPEN_IDS`（私聊目标，逗号分隔多个）；`DEPLOY_*` 为部署凭证。

**wan 数据面验证（v15）**：`NETLOG_HTTPS_TARGETS` 默认阿里+腾讯双 DoH 源 **AND**（全部通过才算出网）——受限会话对阿里白名单真实放行（2026-10-07 实锤），单源测不出「只能上阿里」的半残态。

**路由器无线状态观测（v15 routerWatch）**：`NETLOG_ROUTER_PASSWORD` 配置后启用（未配置=停用），每 `NETLOG_ROUTER_WATCH_INTERVAL_MS`（默认 10 分钟）登录 miwifi 拉射频状态——管理面失联/射频配置异常/ax 翻转 → 事件+飞书通知。只观测不动手：无线侧救场=每周二 04:03 定时重启（小电脑 schtask `qianli-router-weekly-reboot`）+人工。

**检测细化（v16）**：① wan 数据面**三态**判定——全过=ok / 部分过=`wan_restricted`（即时私聊，认证/放行半残指纹）/ 全不过=down；② routerWatch 挂 **DHCP DISCOVER 主动探测**（连续 2 次无 OFFER 报 `router_dhcp_down`——「新设备连上没网」病灶的直接检测，对租约零副作用，68 端口被占自动静默降级）；③ **在线设备数骤降旁证**（devicelist 基线中位数 50% 阈值，`router_clients_massdrop/recover`）；④ `/api/netlog/summary` 新增 **probeMatrix**（wanTcp/wanDoh 逐目标/traffic 逐源 status）——报警一眼看清哪层坏。

**DHCP 探针勘误与固定身份（v17，2026-10-07 午后，曼波质疑成案）**：RD08 对**陌生 MAC** 的首次 DISCOVER 有 3.0~3.9s 检查路径（查过进快表，同 MAC 之后毫秒级；已知 MAC 恒 4-6ms）——v16 探针每次随机 MAC + 3000ms 超时 = 每次走陌生路径在 3 秒线上掷骰子，`router_dhcp_down/recover` 振荡全是**探针伪影**，DHCP 服务当时并未挂。v17 修正：探针改**固定 MAC**（`DEFAULT_PROBE_MAC`，02 本地管理位；`NETLOG_DHCP_PROBE_MAC` 可覆盖）+ 超时 5000ms——首查进快表后恒毫秒级，此后连续超时才是服务真挂（**真半死判据=已知 MAC 也慢/无应答**）。「新设备连上没网」的机制性残余=新设备首答 3~4 秒，超时紧的客户端会放弃；要消除就关主路由「新设备接入确认/防蹭网」类开关（安全权衡用户定）。

## 部署

```bash
npm run push "提交说明"   # 测试闸门 → git(顶层 monorepo netlog/ 路径) → SFTP → .env → pm2 delete+start+save
```

pm2 名 `qianli-netlog`，`pm2 save` 后并入小电脑 `qianli-bots-autostart`（pm2 resurrect）自启清单。端口 3016：只收出站探测 + HTTP（未绑 127.0.0.1，LAN 可达——运维台拓扑看板正以此探测 3016；GET 无鉴权，`/api/netlog/summary` 含复活动作日志，内网可见即设计现状）。

## 测试

```bash
node scripts/stub-test-netlog.js       # 67 断言：防抖/恢复历时/积压补发/冲刷竞态回归/egress 变化/事件分级/复活自愈冲刷+DownSince清零/JSONL 结构/通知节流/wan 三态判定/main() 装配层（长停机启动不崩溃+boot_after_offline 走通）
node scripts/stub-test-routerwatch.js  # 33 断言：路由器无线观测（失联/恢复/射频异常/ax 翻转/DHCP 探测/设备数骤降的翻转触发与去重/停用/DISCOVER 报文结构/v17 固定探针 MAC 与超时）
node scripts/stub-test-wanguard.js     # 57 断言：复活引擎（首选项优先/换号/慢速判定/exhausted 冷却/手动触发/基线/被抢持续垫底+跨轮避开/到期复位/全垫底不失能）
# npm test = 三套合计 157 断言（push 闸门）
```

## 已知限制

- 断网根因若为**生产机自身断电/系统挂**，探针同死——物理上无解，靠 pm2 resurrect + 路由器侧排查兜底；
- lan 断而 wan 未断的组合（路由器半死）理论上可能：探测独立并行，各自如实记录；
- egress 回显源全挂时该轮跳过（不误报 IP 变化）；
- **路由器无线侧半死（射频信标不发/DHCP 僵死，2026-10-07 事故形态）有线侧探针全绿**——routerWatch（v15/v16）补上观测盲区（DHCP 探测/设备数旁证/射频配置层）但「信标停发本身」仍不可见（有线侧物理无感），只报警不救场；救场=每周二 04:03 定时重启（小电脑 schtask）+人工。

## 复活引擎（v2，2026-09-27）：断网自动换账号重认证

「网关实现途径」考古结论：主路由 WAN=纯 DHCP，被踢秒级自愈靠 Dr.COM **MAC 无感知认证**（无账号池无策略，失效即"根本连不上"）；真正的重连逻辑是 4A 时代保活脚本 `ping.sh`（归档桌面 `qianli-backups/4a-root-ping-archive-20260920.tar.gz`，内含两个账号），其弱点=两账号无脑都发、发完不验证、无限速检测、极端失败 reboot 路由器。v2 按同一协议（`http://10.10.8.162:801/eportal/portal/`，端口 801 是 API，80/443 只是登录页）重写为可持续维护的引擎：

- **账号池**（`campus-accounts.local.json`，凭据不进 git；部署目标 `C:/qianli/data/netlog/`，push.js 带备份+条数守卫上传）：`preferred` 首选项**永远先试**（曼波钦定 31108753），其余按 priority 轮换；首选项语义=**优先不是拉锯**（v18）——被抢的号持久垫底 24h，只在没得选时才轮到；
- **复活**：wan 断（防抖 2 轮）+ lan 活 → 每 tick 尝试一个账号 login，**以 wan 真恢复为成败**（不轻信 eportal 响应文案）；全用尽 → 飞书通知 + 30 分钟冷却重试；
- **慢速降级（自适应基线，曼波拍板）**：恢复后 20s 宽限 → 3 次探针取中位数，> 健康基线（滑动 20 样本中位数，下限 30ms）×3 → 判限速 → 打「**本月不再使用**」（`bannedThisMonth`，自然月自动失效）→ 自动换号；
- **手动触发**：`POST /api/netlog/revive`（`X-API-Token: NETLOG_API_TOKEN`，未配置=锁定）——网络已通时也可触发，供协议实测；`GET /api/netlog/summary` 的 `guard` 字段看引擎状态（基线/队列/最近动作）；
- 认证服务器（默认即可，env 可改）：`NETLOG_AUTH_HOST=10.10.8.162`、`NETLOG_AUTH_PORT=801`、`NETLOG_AUTH_PAGE_HOST=login.cqu.edu.cn`。

