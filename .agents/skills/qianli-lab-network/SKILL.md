---
name: qianli-lab-network
description: qianli 实验室/家庭网络拓扑、设备接入与断网排查手册。凡涉及：设备连不通/断网/时好时坏排查、SSH 或部署到小电脑与旧 NAS、路由器/子路由/网线等拓扑变更、飞书长连接与双网关风险、IP 白名单与出口 IP 问题、pm2 进程消失或行为异常时使用。部署本身走 qianli-deploy skill，本 skill 管网络层。
---

# qianli 实验室网络拓扑与设备运维

> 2026-09-14 深夜抢修实战沉淀。拓扑/地址以运维台「🌐 网络拓扑看板」实时探测为准（`/api/network`），本文记录结构与口径。

## 一、当前拓扑（2026-09-14 迁移后定型）

```
飞书云 open.feishu.cn ── 唯一长连接 = 小电脑上的 feishu-gateway（其余任何机器不得持有第二条）
        │ API 出口
校园网 10.253.x（用户本人即网管；内网路由 10.100.3.25/.26 曾对失效地址打环）
        │ 墙口(仅一个校园网口)
   主路由 192.168.31.1 (NAT) ── ⚠ 用【学生账号】登录校园网认证,此会话=全家唯一生命线
        ├─ WiFi/LAN ─ 笔记本 LAPTOP-BGC4G36V (192.168.31.181) ── 运维台 127.0.0.1:3100
        ├─ LAN ──── 小电脑 DESKTOP-FE1MIGI (192.168.31.57) ── 生产机：6 机器人 pm2
        ├─ LAN ──── 旧NAS qianli-NAS (192.168.31.153, Ubuntu) ── 备件存储：机器人已清零
        └─ 子路由(老路由器) ── 可选 AP 扩展，必须 AP 模式(见 §五)
```

要点：
- **没有宽带**：全部流量骑在主路由的**学生账号校园网认证会话**上。会话被踢 = 全家断网 = 全部机器人掉线——这是全体系最大的单点。
- **单会话互踢陷阱**：校园网按账号限并发会话。笔记本若用**同一个账号**直连校园网认证（如临时诊断直连），会立刻顶掉主路由的会话 → 全家断网；路由器重连又顶回笔记本 → 互踢循环。**笔记本禁止用路由器的账号直连认证**（改走路由器 NAT，或用另一个专用账号）。

## 二、设备接入速查

| 设备 | 地址 | 访问方式 | 凭据 | 备注 |
| --- | --- | --- | --- | --- |
| 小电脑 DESKTOP-FE1MIGI | 192.168.31.57 | SSH **22**（OpenSSH，默认 shell 应为 git-bash）；**RDP 3389**（mstsc，2026-09-22 开启，防火墙限 31.0/24）；服务 HTTP 3000-3006/3010 | mechax / 见 approval-bot/.env `DEPLOY_PASSWORD`（SSH 与 RDP 同账号） | 生产机；pm2 计划任务 `qianli-bots-autostart` 自启；部署目录 `C:\qianli\opt\<项目>`；**IP 已本机静态固化**（2026-09-22，DHCP 同值转静态：.57/24 + 网关/DNS 均 31.1，切换零中断，无需路由器侧绑定） |
| 旧 NAS qianli-NAS | 192.168.31.153 | SSH **2222**；网页 3923 | qianli / 旧 .env 时期密码 | Ubuntu+桌面；**机器人已清零、`pm2-qianli` 已 disabled**，纯存储备件（2026-09-20 挪入交换机后 DHCP 由 .151 重分配为 .153） |
| 主路由 | 192.168.31.1 | 网页管理 | 路由器凭据 | Xiaomi BE6500 Pro（RD08），固件 1.1.96；**Web 无 WPS**（只有米家「畅快连」，HP 等非米家设备不适用），设备配网走厂商 App/USB 通道 |
| HP LaserJet MFP M232dwc（NPIE7E05D） | 192.168.31.107（DHCP，**静态绑定待办**） | EWS 网页 `http://<ip>`（HTTP 直连；配置页会跳 HTTPS 自签名证书，curl 用 `-k`）；管理密码未设 | 无 | 2.4G-only；打印=笔记本无线队列 `NPIE7E05D` → Standard TCP/IP 端口（RAW 9100）+ 内置 IPP 驱动（2026-10-08 验收出纸）；扫描=WSD/HP SMART 免驱动。**三坑**：①勿装 HP 老 Full Webpack 52.4.4998（×Win11 25H2 报「-2081883393 卸载设备失败」，类配置 0x0d 实锤，内置 IPP 驱动即可）；②IPP-over-USB 触发固件 49.0111 崩（=面板 Er61，raw 9100 不吃裸 ASCII），USB 打印勿用；③WSD 端口离网假死不自愈（打印事件 14007=端口不通噪音），换 TCP/IP 端口即愈；配网=手机 HP SMART 连 `HP=Setup<ea>` 开放热点（有超时，消失则打印机断电重启重广播） |
| 飞书云 | open.feishu.cn:443 | 应用 cli_aac7e6f6cdf8dcc0 | 各仓 .env APP_ID/SECRET | 安全设置里的 **IP 白名单**是写失败排查重点（§四） |

凭据铁律：只存各仓 `.env`（不进 git）；临时脚本不得硬编码（排障脚本从 `.env` 现读）。

## 三、断网/连不通排查手册（按序执行，全部实战验证）

0. **先查本机连的哪个网（曼波高频坑，2026-09-23 定）**：曼波网关开发时经常把笔记本连成**自己的校园网账号**（本机直连认证）——会顶掉主路由的认证会话，症状=ping 不进 192.168.31.57、SSH 握手超时，而目标机其实活得好好的。排查任何「生产机连不上」先 `ipconfig` 看本机在不在 192.168.31.x（路由器 NAT 侧），不在就是连错网了，换回主路由的 WiFi/网线再继续，别对着目标机白折腾。
0.5. **本机"连上了却没网"，先查 Watt Toolkit（2026-09-29 实战）**：Watt（Steam++）开着时连/切 superqianli 会整网全断（系统代理被指向它的本地加速端口，换网瞬间代理栈僵死→所有走代理流量进黑洞），而**同网其他设备正常**——这个「只有本机断」的指纹直接排除路由器/认证/出口。处置：退出 Watt（托盘右键退出，不是关窗口）→ 重连即愈；需要加速 git push 时**先连稳网再开 Watt、用完即关**。检查命令：`netsh winhttp show proxy` + 注册表 `HKCU\...\Internet Settings` 的 ProxyEnable/ProxyServer（干净=当前没开或已退出）。对照排除项：Radmin VPN 虽挂着 26.0.0.1 默认网关但 metric 9257 被物理网关（metric 30）碾压，不背锅。
1. **分层探测，ping 单独看不可信**：ICMP 回复可能是路径上路由器的 **TTL 过期假回复**（统计显示 0% 丢包但根本没到目标）。必须配合 **TCP 端口探测**（node `net.connect` 2-3s 超时）+ `traceroute -d` 看路径。
2. **traceroute 判读**：连续两跳来回交替（如 10.100.3.25↔.26）= **路由环路**，包永远到不了目标；同网段其他地址通、唯独目标不通 = 目标自身链路/地址问题。
3. **"网口灯亮"≠网络可达**：链路层 up 但 TCP/IP 层可能僵死。判别：同网段网关能 ping 通 + 目标不开任何端口 + ARP 无应答 → 栈僵死 → 重启整机。
4. **ECONNRESET/ECONNREFUSED 区分**：REFUSED=主机活着端口没人听；RESET=握手中被拒（Windows sshd 连接频率保护——连续快连会被晾几分钟，**冷却重试即可，别硬刚**）。
5. **设备挪位/换网后先查 IP**：静态 IP 在新位置大概率失效；DHCP 设备会换地址。找不到就上厂商发现工具（Qfinder/Synology Assistant 走二层广播，**IP 配错也能发现**——但手写 UDP 广播模拟不可靠）。
6. **日志要看对地方**：pm2 日志在 `<用户>/.pm2/logs/`；日志行无时间戳时用 `ls -la --time-style` 看文件 mtime 判新旧；**旧部署时期的日志会残留混在一起，别把历史行当现状**。

## 四、网关与长连接安全（铁律 + 排查）

- **全体系只允许一条飞书长连接**（小电脑上的 feishu-gateway）。任何设备重连/复活前，先确认它的 gateway 不会成为第二条——双长连接 = 所有机器人指令随机一半失灵。
- **设备下线≠风险解除**：僵死设备一旦网络恢复，其 gateway 会立刻重连抢连接。结论：**退役机器必须物理关机或清干净 pm2 + 关自启**（旧 NAS 已执行：`pm2-qianli` disabled + 重启验证 pm2 为空）。
- **应用安全设置里的 IP 白名单**：开启后，非白名单出口 IP 的 API 写入会被拒，且**报错面目全非**（bitable 写入会报 `FieldNameNotFound 1254045` 这类误导性错误）。读接口不受影响——"读全通、写全败、字段名核对无误"就是它的指纹。
- **校园网会话的出口 IP 不固定**：随学生账号会话重连/换账号而变。若开了 IP 白名单，每次重连都可能写失败——白名单要么关、要么把账号可能出现的出口段全部加进去；`/api/egress-ip` 随时比对。
- 网关健康：`GET :3010/api/health` 看 `ws:"running"`；拓扑看板已内置该探测。
- **被踢是常态，不是故障**（2026-09-14 确认：学院不给开放链路，学生账号会话偶尔因连接问题被校园网踢出，秒级自动重连——今晨一次几秒自愈）。设计好的自愈链路全自动接管，无需人工：路由器自动重连校园网 → 网关 WSClient 指数退避重连 → pm2 进程不死 → duty-bot 重试+本地名册兜底。**只有长时间（分钟级以上）不上线才需要人工**：查主路由认证页重新登录。

## 五、Windows 目标机的远程管理现实（省下半夜）

- **非域内本地管理员的远程通道几乎全被 UAC 过滤挡死**：WinRM（默认关）、WMI/DCOM（拒绝）、远程 schtasks（拒绝）、RDP（默认关）、psexec（无 ADMIN$）。**结论：Windows 生产机的系统级操作只能物理到场**，别浪费时间试远程。
- **给 Windows 目标机装/修服务用「离线包 + bat」模式**：
  - 微信/U盘 传 2 个文件到目标桌面：离线包 + 自提权 bat；
  - bat **必须纯 ASCII**（UTF-8 中文注释会被 GBK 代码页吞行解析成乱码命令——踩过两次）；
  - **MSI 静默失败会发生**（装完无服务）——OpenSSH 用 ZIP + `install-sshd.ps1` 才可靠；`.ps1` 双击/右键运行会被执行策略拦，**bat 内嵌 `powershell -ExecutionPolicy Bypass` 才是正道**；
  - sshd 起来后：`sc config sshd start= auto` + 防火墙放行 22 + 确认登录账户有密码。
- **目标机电源必须设"从不睡眠"**——睡眠 = 六机器人全断。
- **2026-09-22 勘误与扩容**：OpenSSH 就位后实测 **SSH 会话带完整管理员令牌**（`net session` 可过、无 UAC 远程过滤），上两行"系统级操作只能物理到场"仅适用于无 SSH 时代；RDP 已经 SSH 远程开启（`fDenyTSConnections=0` + 自建防火墙规则 `RDP-qianli-TCP/UDP-3389`，remoteip 限 192.168.31.0/24；将来接 Radmin VPN 等 26.x 网段时需另加放行），`mstsc 192.168.31.57` 可 GUI 级管理（过 UAC、装软件）。真实上限只剩：整机断电/路由器挂/校园会话长期掉——物理到场兜底仍不可替代。另：目标机 reg/netsh 经 git-bash 执行时 `/v` 等斜杠参数会被 MSYS 路径转换吃掉，命令前必须 `export MSYS_NO_PATHCONV=1`。

## 六、pm2 与 dotenv 的环境快照语义（排障必修）

- `dotenv` **不覆盖已存在的环境变量**；pm2 会把进程**首次启动时**的环境快照注入后续所有重启。两者叠加 = **快照里的旧值会永久压过 .env 新值**。
- 症状：改了 .env / 换了代码，进程重启后行为依旧错误（如写表仍用旧表 ID/旧字段名）；而**同机新起的裸进程一切正常**（裸进程没有快照注入，dotenv 全量生效）。
- 修复：`pm2 delete <名> && cd <目录> && pm2 start <入口> --name <名> && pm2 save`（delete 清快照，save 固化）。
- 排障命令：`pm2 env <id> | grep -iE "APP|DUTY|BITABLE"` 对比 .env 文件值。
- **bash 链式陷阱**：SSH 里 `cmd1 & cmd2 & cd X & cmd3` 的 `&` 是**后台并行**——`cd` 在独立子 shell 里，后续命令的 cwd 根本不变（pm2 start 因此找不到相对路径脚本，还静默）。**顺序依赖必须用 `&&`**。

## 七、拓扑变更检查单（每次动网络/设备后过一遍）

1. 运维台「🌐 网络拓扑」看板全绿（或符合预期）；`/api/network` 可脚本化断言；
2. `curl :3010/api/health` 确认 `ws:"running"`（长连接唯一且健康）；
3. `/api/egress-ip` 看出口 IP 是否变化 → 变了就查飞书应用 IP 白名单；
4. 生产机 `pm2 ls` 六进程 online + `pm2 save`；
5. 拓扑/地址有变 → 同步更新本 skill、qianli-deploy SKILL.md、各仓 `.env`（DEPLOY_* 键）、运维台 `server.js` 的 `NET_TARGETS`。

## 八、相关工具与代码位置

- 拓扑探测端点：`dashboard/server.js` `GET /api/network`（NET_TARGETS 定义处即拓扑清单，改拓扑先改它）+ 前端 `public/index.html` 渲染；
- 旧 NAS 关停/验收脚本模板：曾用 `shutdown-old-nas.js`（已删，模式：SSH→pm2 ls→kill→systemctl disable→复核）；
- 部署链路：见 qianli-deploy skill（本 skill 不覆盖部署步骤）。
- **网络事件日志探针（2026-09-27 起）**：`netlog/`（生产机 pm2 `qianli-netlog`，:3016）持续探测主路由 superqianli 与公网出口并落盘——断网期间内网手段全部失联时的「事后现场」就在它的 `net-log.jsonl`（部署目标 `C:/qianli/data/netlog/`）；wan 恢复瞬间积压事件自动汇总成飞书卡补发（**v6 起走机器人本体私聊，无群卡通道**）。**2026-11-11 曼波拍板播报全关（v21）**：`NETLOG_NOTIFY_ENABLED=false`——私聊/积压补发全静默，jsonl 照记可回放，现场问询一律走 summary API。断网排查先看它：`curl localhost:3016/api/netlog/summary`（或读 JSONL）即可回答「什么时候断的/断了几段/各多久/出口 IP 变没变」，不用再翻 pm2 日志猜。注意：探针跑在生产机上，生产机自身断电时它同死（物理限制）。

## 九、4A 打印机隔离区路由器（OpenWrt，2026-09-20 改造完成）

小米 4A 千兆版 v2，**已刷 OpenWrt 23.05.2**（原厂 miwifi 固件不存在，`192.168.31.1` 上的"小米路由器"页面是主网关的）。定位=打印机隔离区：LAN `192.168.2.1/24`（DHCP .100-.249），wan=DHCP 客户端待插入主网 LAN；SSID `Printer`（2.4G，WPA2，`ap_isolate=1` 客户端隔离）已启用，`Printer-5G` 保持禁用。

- **访问方式**（IPv4 网段不同时 IPv6 必可达）：有线插它 LAN 口后走 `http://[fe80::d6da:21ff:fe0d:e285]/`（链路本地）或 `http://[fd2c:8424:6a43::1]/`（ULA）；LuCI 与 SSH（dropbear 22）root 密码=主网关管理密码（不写入 git，需要时问用户）。**插网线认准白色 LAN 口**（蓝色 WAN 口防火墙全挡，症状=收得到 RA 广播、发出去全无回音）。
- **防火墙三规则**（2026-09-20 定稿，按现实 31.x 编址）：① `Allow-Mgmt-MainLAN`：192.168.31.0/24 → 本机 22/80/443；② 主网→打印区：31.0/24 → 192.168.2.0/24 全放行（PC 管打印机）；③ 打印区→小电脑：2.x → 仅 192.168.31.57（打印机主动回推）。lan zone 无出向转发目标（打印区→外网/其余主网主机全拒绝）。**新主网关（SuperQianLi/192.168.31.1，RD08，管理密码同 4A root）就是"平行"上级**；拓扑设计文档里的 192.168.1.x 编址未落地，一切按 31.x 现状。
- **2026-09-20 清理记录**（改前全量备份在桌面 `qianli-backups/4a-openwrt-backup-20260920.tar.gz`）：删校园网保活脚本 `/root/ping/ping.sh`+其 cron（内含两个硬编码学号，若与主路由同账号会互顶号）、卸载 acme/adblock/socat（socat 是 acme 依赖连带装的）、清 5 条 192.168.1.x 错位租约与 6 条旧 DNAT 端口转发；`/root/test.clc` 已删（2026-09-22 定性=Clutch 云游戏数据残留——前用户曾拿此路由当游戏服务器装过 `.clutch-server/`+`snake.sh` 贪吃蛇，历史见其 `.bash_history`；用户批准删除，原件归档桌面 `qianli-backups/4a-test-clc-archive-20260922.bin`）。
- **状态（2026-10-05 更新：已重接 + 定位改为「打印机直连外网网关」）**：曼波 10-03 ~16:25 亲手重接（wan=静态 192.168.31.98，主网设备列表可见，在线稳定）；用途按曼波 10-05 口述变更为**打印机直连外网**（不再走原隔离区方案）。本次整治（2026-10-05 会话）：①防火墙补 `lan→wan` forwarding（原三规则无出网转发，打印区根本出不了外网——「打印机连不上网」主因）；②radio0 2.4G 信道 1→**6**（原与主路由 2.4G 自动信道撞车同在 ch1 互扰；校园 CQU_WiFi 信道 11 最挤 24 个、6 居中 16、1 最空 13——若主路由自动信道日后跳 6 需再错开）；③Printer SSID（2.4G ch6 HT20，密码 qianliprint）已就绪。**2026-10-07 批后剩余（唯一）**：两台打印机 Access Code 待上屏抄取 → `.env` 四列填入重启即联调；「切局域网模式」可选（实测云模式下 LAN 端口集 8883/990/6000 也常开，机器人可先联调，上线切 LAN-only 断云防双通道打架）；有线打印机超 2 台需加小交换机（4A 只有 lan1/lan2）。
- **2026-10-07 批：31→2 打通 + 打印机双机实锤（bambu v45 同批，详录顶层 DEVLOG）**：①两台 P1 系打印机已连 Printer SSID（**云模式，曼波未开 LAN 模式**——LAN 端口集照样常开，见下指纹勘误），TLS 证书（BBL CA，CN=SN）实锤：`00M09D541710031`=192.168.2.189（printer-189）、`00M09A371900389`=192.168.2.133（printer-133），4A 静态租约已固化；②**「31→2 转发待修」销案**：4A 侧（防火墙/转发/nft）从来正常，根因=**主网缺去程路由**——发往 2.x 的包在主路由被按默认路由扔进校园网（nft counter 0 包不达 4A 实证）；解法=**主网各机本地加静态路由** `192.168.2.0/24 → 网关 192.168.31.98`（笔记本 route add -p 已加；小电脑 SSH route add -p 已加；主路由零改动），小电脑→2.189:8883/990、2.133:8883 实测全 OPEN；主网新机器要管打印机照加此路由即可；③给 4A 加「桥接/AP 模式」已评估否决（打印机裸奔主网+浪费隔离区，路由方案一处配置全通）。
- **4A DNS 半死坑（2026-10-05 凌晨实战修复）**：症状=Printer 网客户端全部「连上却没网」——4A `nslookup 127.0.0.1` SERVFAIL，但 wan 上游（`/tmp/resolv.conf.d/resolv.conf.auto`：31.1+223.5.5.5）实测可达、生成配置 `resolv-file=` 也在。根因=dnsmasq **进程内**上游陈旧（曼波 10-03 DHCP 转静态重接后未重启 dnsmasq，进程还揣着旧上游）。修法=`/etc/init.d/dnsmasq restart`（秒级零风险），restart 后 A 记录立即恢复。**AAAA 查询 SERVFAIL 是噪音**（主路由上游不回 v6），busybox nslookup 会 A 成功+AAAA SERVFAIL 双段输出，别误判成没修好。排障指纹：连 Printer 的设备 WiFi 正常但域名全解不出=查 4A dnsmasq。
- **31→2 转发（2026-10-07 已销案，见上条批记录）**：4A 侧规则本就正常；主网访问 2.x 靠各机本地静态路由（192.168.2.0/24 → 192.168.31.98）。busybox nc **无 -z 参数**（管道模式 `nc [IPADDR PORT]`，端口扫描需 wget/curl/`nc ip port </dev/null` + 退出码，别照 GNU nc 语法写）。
- **4A 纯内网形态与双品牌协议档案（2026-10-14 拔线批，bambu v53 落地）**：曼波拔掉 4A wan 线=打印机区 192.168.2.x 无云，31.x 机器凭本地静态路由 31→2 控机——**该路径以 4A wan 插线为前提（网关 31.98 必须存活）**；wan 一拔 31.x↔2.x 即物理断链（2026-10-15 实测：台式机+小电脑 → 192.168.2.116:8883 双双 TIMEOUT、31.98 100% 丢包，路由条目仍在但成死路；主网设备要管打印机只能物理进 2.x 或重插 wan，见 10-07 批）——拓竹本地端口（MQTT 8883 / FTPS 990 / 视频 6000）云模式与 LAN 模式下均常开（10-07 实测），拔线只断云不断局域网；闪铸必须在屏幕开「LAN Only 模式」端口才开。**闪铸 AD5M 系协议**（社区逆向 Parallel-7/flashforge-api-docs，固件 3.2.7 校准）：TCP 8898 HTTP REST——POST /detail（状态轮询，serialNumber+checkCode 认证）、/control（jobCtl_cmd pause/continue/cancel、lightControl_cmd、payload 为 JSON 字符串化）、/uploadGcode（multipart+头）、/printGcode、/gcodeList；TCP 8080 MJPEG 摄像头（cameraStreamUrl=/detail 下发）。认证三件=机身序列号+检查码（屏幕设置页可见）。**代码落位**：bambu-print-reservation v53——src/printer/flashforge.js（适配层）、manager.js 品牌分派（brandOf）、dispatcher 文件格式↔品牌隔离（3mf→拓竹/gcode→闪铸，跨品牌不可见）、status.html 观察台（画面代理+AMS+指令）、/api/printers/:id/camera/mjpeg|h264 代理端点（主网设备免 31→2 路由看 2.x 画面）。Access Code/checkCode 未填入 .env 前打印机标「故障/拒连」属预期。Creator 5 Pro（四喷头）协议社区未覆盖按 5M 兼容，真机以 /api/printers/:id/debug rawState 校后修。
- **A 方案落地：wan 重插 + 出网转发禁用，全链路复活（2026-10-15 凌晨，踢线实验继续）**：曼波把 wan 线插回 4A 蓝色 WAN 口（白色 LAN 口管进站，蓝色管上行，别混）→ 31.98 复活；台式机补持久路由（`route add -p 192.168.2.0 mask 255.255.255.0 192.168.31.98`，需提权；此前只有笔记本+小电脑有路由）。**4A lan→wan 出网转发已禁用**（`uci set firewall.@forwarding[1].enabled='0'` 可逆；改前备份 `/etc/config/firewall.bak-20261015`）：nft 实测 forward_lan 只剩「打印机→31.57 主动回推」显式 ACCEPT + lan→lan，其余出网（internet/主网）全 drop——**双 NAT 出网流量源=0，Dr.COM 踢线指纹的理论源头拆除**；若主路由此后仍被踢，头号嫌疑翻案转校方策略侧。31.x→2.x 照旧全放行；生产+本地 bambu .env 五列填 H2D（pm2 delete 重建防 dotenv 快照压值），MQTT 全链路实测通（pushall 回流+任务变迁正常）。
- **4A 射频半死病与远程修复配方（2026-10-15 实战，RD08 同款病的 4A 版）**：症状=WiFi 站点全部关联正常、DHCP/ARP/站点主动流量正常，但 **AP→站点的单播数据全黑洞**（4A 自身 ping/openssl 探三台打印机 8883 全超时，`ip neigh` 却全 STALE=ARP 应答正常）——省电缓冲/驱动数据面软烂，uptime 9 天无重启、桥成员正常。**修法：SSH `wifi down && sleep 3 && wifi up` 蹦射频即愈**，站点数秒内自动重归，无需断电。鉴别口诀：关联在+ARP 通+单播不通=蹦射频；连 ARP 都不通=查桥成员/链路。
- **Bambu H2D 入编（2026-10-15 实联调）**：SN `0948BJ672900421`=192.168.2.116，WiFi 连 Printer SSID；**无线模块=FN-LINK（9C:9D:07 前缀），AMPAK 指纹（50:41:1C/9C:B8:B4）对新机型不适用**——按 MAC 前缀认 Bambu 的老方法对新机型会漏。TLS 证书走新链（issuer `CN=BBL Device CA O1C2-V2`，两台 P1 仍是老 BBL CA），openssl 免上屏鉴定法照用。Access Code 在各仓 .env 不入档。
- **打印机/物联设备两网漂移现象（2026-10-05 全量排查定案）**：曼波体感「打印机有时连 SuperQianLi 才能用、有时连 Printer 才行」=主路由 2.4G 半死（ax 触发，见 §十二.1）+ 4A DNS 坏（上条）**交替发作**的叠加症状：2.4G 哑→设备集体逃往 4A（实测 4 台 IoT 在 10-05 00:50–02:14 半死窗口内依次迁入，信号 -45dBm 贴脸首选）→Printer DNS 坏→又不可用。设备判指纹：连 Bambu CN 云的设备在 4A conntrack 可见 `dst=47.100.40.179:8883`（=cn.mqtt.bambulab.com 实测）；**Bambu 打印机指纹勘误（2026-10-07 终审）：正确指纹=LAN 侧 MQTT 8883 + FTPS 990 + 视频 6000 常开**（云模式下同样全开；旧记录「21+80+1883」系当时误录，两台真机实测 21/22/80/443/1883 全 REFUSED）；**免上屏鉴定法：`openssl s_client -connect <ip>:8883` 看 TLS 证书，issuer=BBL Technologies、CN=序列号**，一步定身份+拿 SN。主路由 devicelist 的 `online` 字段含僵尸缓存勿全信，以 ARP/conntrack 复核。
- **主路由夜间假死病史（2026-10-04 凌晨，ax 改动之前就存在）**：netlog 记录一夜 6+ 段 lan_down+wan_down 同时失联（3min~57min 不等：03:17/03:50/04:23/05:32/06:02/06:08/06:47…）=主路由整机反复假死（疑校园网会话重连牵连或固件不稳）。假死期间 4A 上行同死（wan=静态口接主路由），**连哪个 SSID 都没网**——「怎么连都不能用」时段的底层原因。10-05 凌晨修复后至今零事件；若复发优先考虑整机重启（曼波保留物理重启预案），netlog 事件即病历。

## 十、本机（运维笔记本）双网卡与 SSH 源 IP 现象（2026-09-20 记录，待定性）

- **双网卡同网段**：笔记本同时有 WLAN（192.168.31.182，网关 192.168.31.1）和「以太网 3」（192.168.31.2，**无网关**，疑似 USB 转接/底板口）。两块网卡同挂 31.0/24 时 Windows 按接口度量选路，SSH/HTTP 的实际出口可能漂移——排查连通性时先 `ipconfig` + `route print 192.168.31` 确认走的是哪块网卡；不用有线建议禁用，避免路由选择漂移。
- **SSH 登录小电脑时 sshd 侧来源显示 192.168.31.1（主路由）而非本机地址**：说明包被主路由 hairpin NAT 过了一道（路径未按本机直连预期走）。功能无损，但两个后果：①基于源 IP 的 allowlist/日志溯源会把运维操作记成主路由；②证实「SSH_CLIENT=192.168.31.1」不代表是小电脑自己连自己。待定性：是否与双网卡选路有关，收敛网卡后复测。
- 部署目标侧核对记录（2026-09-20 全量 debug 批）：pm2 实际目录 `C:\qianli\opt\<项目>`（git-bash 内不可用 `/opt/...` 短路径，PortableGit 根在 `C:\tools\PortableGit`，EXEPATH 可证）；hub 的 `.env` 在部署目录下 `server/` 子层，与本地一致。（历史注：wecom-attendance-bot 2026-10-12 废止清理，其 server/ 子层布局随项目移除）

### §十.1 台式机（DESKTOP-PCOONE5）WLAN 静态 IP 坑与「两头兼顾」终案（2026-10-15 凌晨结案）

- **「切 CQU_WiFi 全黑」根因**：台式机 WLAN（Intel AX210，MAC `30:05:05:92:0C:16`）曾被设静态 192.168.31.199/24 + 网关/DNS 31.1（`DHCP 已启用: 否`）。**静态地址不随 SSID 换**——连 CQU_WiFi/热点后仍拿着 31.x 地址，网关 ARP 永远无人应答 → DNS 全死、连认证服务器 10.10.8.162 都不可达（指纹：nslookup 全超时含 202.202.2.50、浏览器 `DNS_PROBE_STARTED`）。与校园网账号/Dr.COM 无关，根本没走到认证那步。修复=改回纯 DHCP（2026-10-15 曼波手操救回）。
- **「DHCP+辅助静态地址」翻车档案（勿复刻）**：为兼顾「家里固定 .199 + 校园网 DHCP」试过 `set address dhcp` 后紧跟 `add address .199`（无网关辅助地址）——**DHCP 租约未到手时注入静态辅助地址会把接口状态机搅死**：接口停在「仅 31.199、零网关」态，之后任何 SSID（含手机热点）全无网；且恢复验证若查「有没有 31.x」会恒真漏判（**必须查默认网关存在性**）。恢复=改回纯 DHCP 重置接口状态机。此路实测不通，别再试。
- **两头兼顾正解**：本机纯 DHCP + **主路由侧 MAC 静态租约绑定**（RD08 管理页把 `30:05:05:92:0C:16` 绑 192.168.31.199）——静态语义由路由器保证，电脑侧零特殊配置，CQU/热点全自动。**绑定可行性终审（2026-10-15 凌晨全量翻查）：RD08 固件 1.1.96 的 web API 无此功能**——home/setting/prosetting 三页 HTML+全部 JS 包+49 个 API 端点+`xqdatacenter` 网关全翻遍，UI 里的「静态IP」仅指 WAN 口上网方式；devicelist 条目无 static 字段；手机 App 的「静态 IP 分配」走云端 miio 通道本地够不着；路由器 SSH 未开（不为生命线开洞）。**实际定案：不绑也能用**——纯 DHCP 下路由器续发 .199（旧租约），Windows 续租时主动请求旧地址、未被占用即 ACK，跨周二定时重启基本稳；且台式机 31.x 地址无任何消费方（远程走 Radmin 26.x），真漂移零伤害。
- **台式机 WLAN 远程测试注意**：非提权 shell `netsh wlan connect` 切得走但**切不回**（`WlanGetAvailableNetworkList` error 5 + 位置权限墙）——WLAN 切换测试必须提权跑（本机 UAC `ConsentPromptBehaviorAdmin=0`，`Start-Process -Verb RunAs` 静默提权可用）或曼波手切；提权进程脱离发起方独立存活，外层被杀也照跑完（2026-10-15 两次实测）。

## 十一、裁判系统路由器（第三网段 3.x，2026-09-20 已入网；2026-10-05 官方软件落地批大更新）

**术语先行**：本节与《网关拓扑文档.md》中"机器人"=与裁判系统连接的**物理机器人**（机甲大师场外）；开发内网 31.x 上的六仓"机器人"=飞书软件机器人服务，两者无任何关联。

- **机型勘误（2026-10-05 实证）**：裁判系统路由器=**中兴问天 BE6800 Pro+（WiFi 7）**，非小米系（09-20 的「小米系」记录有误）。管理页 ~~`http://192.168.3.1/`~~ **`http://192.168.1.1/`**（2026-10-07 傍晚改段 1.x 落地后新地址；登录密码 `cquqianli2027`），Vue SPA（element-ui/Vue2）。
- **凭据现状（2026-10-07 更新）**：WiFi「裁判系统」密码=`cquqianli2027`（WPA3-Personal）；**管理后台密码=与 WiFi 同款 `cquqianli2027`**（2026-10-07 曼波提供并实登成功；10-05 的「试错全错」记录作废——疑为当时撞 60s 锁定或输错，非密码本身错）。ZTE 防爆破：连续失败锁 60s，试密码间隔≥60s。
- **⛔ 官方硬性要求 vs 当前路由器配置的两大冲突（RoboMasterEngine 联网操作手册 V1.0，包内 StreamingAssets/Config/ 有 PDF）**：
  1. **裁判系统局域网固定 192.168.1.0/24**，裁判端电脑的局域网网卡 IP 必须=`192.168.1.2`（图传/裁判主控按此硬编码找服务端）→ **路由器 LAN 必须从 3.x 改回 192.168.1.1/24**（1.x 只活在裁判路由器后面，与主网 31.x 无冲突，无 rogue 风险）；
  2. **裁判系统局域网只支持 2.4G**（机器人裁判/图传模块 2.4G-only）→ 当前「裁判系统」SSID 在 **5GHz 信道 40**，机器人根本连不上，必须挪 2.4G。
  两条都要进管理后台改，都被管理密码卡住。（密码已破，见上）
- **官方钦定路由器参数（联网操作手册 V1.0 §2 基础配置指引，2026-10-07 pypdf 抽文核实）**：路由器 IP=**192.168.1.1** / SSID 自定义 / **WiFi 密码=12345678 / 加密=WPA2** / DHCP 开启 / **互联网网线插 WAN 口**（手册为常插设计，非临时措施）；裁判端主机=静态 **192.168.1.2**；手册方案 1 要求**关闭本机防火墙**（我们以 Referee-Zone 防火墙规则替代，首启检测不过再降级全关）；双网卡方案（=小电脑形态）：外网网卡自动获取且**避开 192.168.1.0/24**（31.x ✓）、局域网网卡 1.2、**接口跃点 20 为官方建议**（10-05 配置吻合）、主机有线连路由器为佳但方案 2 允许用主机自身无线网卡；机器人裁判/图传模块按官方默认预期连 **WPA2/12345678** 的 2.4G 网。
- **小电脑侧已就绪（2026-10-05）**：WLAN（Intel AX201）连「裁判系统」WiFi 可用；`192.168.1.2/24` 配置方法=静态/辅助 IP（New-NetIPAddress `-SkipAsSource $true`，出站仍走主地址不劫持路由）+ 接口跃点 20（`Set-NetIPInterface -InterfaceMetric 20`）+ 有线 31.57 保持生产通道不动；防火墙 `Referee-Zone-192.168.1.0-24` 已加（3.x 版规则 09-22 就有）。**坑**：接口 DHCP 与静态辅助 IP 在 renew 时互相清场（ipconfig /renew 清 Manual 地址、Set-NetIPInterface -Dhcp Enabled 清静态地址）——最终态=纯静态 192.168.1.2（关 WLAN DHCP），3.x 地址只是进后台的过渡桥。**坑2**：AX201 长期闲置会「powered down」（netsh 报 interface is powered down）——设备管理器/PnP 全正常，disable/enable 无效，**`pnputil /remove-device <InstanceId>` + `/scan-devices` 热重装即愈**，无需重启。
- **RoboMasterEngine 12.0.0.137_Student（裁判端）结构**（两机桌面各一份，目录同名嵌套一层）：
  - `RoboMasterEngine.exe`（Unity 客户端/裁判端 UI，双击后自动拉起服务器）；首次启动需：勾协议→本地 IP 配置测试（=有 192.168.1.2 网卡）+外网测试→DJI 会员扫码登录→「开始使用」（此时才真正拉起服务器）；
  - `RoboMasterEngine_Data/StreamingAssets/RMServer/` = 赛事引擎服务器本体：`Server/RMServer.exe`（主服务端，.NET 4.8+DotNetty+Lua 场景 S0Scene_RMU_Student 等）+ `AdapterSvr/AdapterSvrS0.exe`（**对接机器人**）+ `RMServerLogClient`（日志，依赖 InfluxDB 语义但可独立跑）+ `Server/tool/Redis-x64-5.0.9`（**必需依赖**）；
  - **端口全景（AdapterSvr 启动日志实测）**：机器人侧 TCP 15861 / **UDP 62101（WiFi 数据，机器人以 60000 为源端口发来）** / UDP 62102（视频）；客户端（Engine/操作手 UI）TCP 15862 + UDP 15863（S0 场景），S1 场景 64998/64999；RMServer.exe 监听随机高端口（25862/54998 实测，本机组件互通用）；Redis 6379。
  - `start.bat` 一键拉起（RMServer→Adapter→LogClient→虚拟设备面板 HTML）。
- **小电脑部署战况（2026-10-05）**：Redis ✓（schtask `RM-RedisStart` 直启 exe 存活）+ RMServer ✓（PowerShell Start-Process 起过，监听 25862/54998）+ LogClient ✓；**AdapterSvrS0.exe 起 15 秒内无条件 exit -1**（7 端口全监听成功+Redis success 后仍退，/IT 交互会话/无 show 参数/SSH session0 全试过）——**待 RDP 进桌面用桌面「一键启动裁判端.bat」（已放置，含四件套顺序+间隔）实跑验证**，RDP 会话是完整 GUI 环境，预期能活。
- **Windows 计划任务启 GUI 程序经验**（本批淬炼）：①schtasks once 任务结束后**不杀**进程树（Redis /tr 直启 exe 活）；②bat 里 `start` 的子进程跟随 bat 的会话；③**bat 必须自带 `cd /d %~dp0`**（schtasks cwd=System32，官方 AdapterSvrS0.bat 就缺 cd，曾致 Adapter 永远起不来）；④SSH 会话启动的进程在断开时被 sshd 全树清理，nohup 无效；⑤GUI/消息泵类程序（AdapterSvr）在 session 0 会启动后自杀；⑥`.NET 程序的 Config 相对路径基于 exe 目录而非 cwd`（Redis 不挑 cwd 的原因）。
- **ZTE BE6800 管理协议逆向存档**（改段自动化备查，卡在会话鉴权）：登录=`GET /?_type=loginsceneData&_tag=login_token_json`（拿 logintoken+_sessionToken）→`POST /?_type=loginData&_tag=login_entry`，Password=`sha256(明文+logintoken)` hex；body 表单 `Username=&Password=...&action=login&Frm_Logintoken=&captchaCode=&_sessionTOKEN=...`（浏览器经 axios 拦截器统一 urlencoded+尾部拼 `_sessionTOKEN`）；成功响应含 `login_need_refresh:true`；业务读=`GET /?_type=vueData&_tag=<tag>`，LAN 设置 tag=`vue_bripaddr_lua`；**卡点**：登录响应 lockingTime:0 无 login_need_refresh（服务端未认会话），GET 一律 SessionTimeout——Cookie SID/`_sessionTOKEN` 组合均试过未破，改段走浏览器手点最稳。
- **历史存档**：曾入网时 wan=DHCP `192.168.31.84`（MAC ~~`EC:C1:AB:E4:B6:56`~~ **归属二次勘误（2026-10-07）：该 MAC 实为 MAXHUB-399 会议屏**（其 WiFi Direct `DIRECT-GpMAXHUB-399msVW` 广播实证），9-29 记录误标为裁判路由器；裁判路由器无线侧真实 MAC 前缀=`b4:72:d4`（两频段 BSSID 实证），有线口 MAC 未单独取证），经交换机；2026-09-29 曼波拔线（「消息在路由器内部迷路」）。**归属勘误（2026-09-20）**：主网上 `192.168.31.80`（MAC `cc:c4:b2:46:16:2f`）是**另一台未知设备**非本路由器。**血的教训**：新路由器默认 LAN 网段常撞主网（rogue DHCP 全网断网）——先脱机改段再入网（约定序列 2.x 打印、3.x 裁判；裁判段即将按官方要求迁 1.x，迁完本条序列同步更新）。

- **Windows WLAN profile XML 的 WPA3 写法（2026-10-07 矩阵实测）**：netsh add profile 的 `<authentication>` 值在本机构建只认 **`WPA3SAE`**，微软文档值 `SAE` 报 0x80001「根据架构无效」（WPA3SAE✓ / SAE✗ / WPA2PSK✓）；跨机传 XML 用 base64 中转防中文转码。远端 git-bash 跑 `wevtutil` 等斜杠参数命令必须 `MSYS_NO_PATHCONV=1`，否则 `/c:10` 被当路径转换报「参数太多」。
- **2026-10-07 链路复核批（打假+双栖恢复）**：①**主网 31.x 侧 ping/tracert 到 192.168.3.1 有响应是校园网同址假象**——路径 31.1→10.253.32.1→陌生设备（TTL 252、其 80 端口关），私网地址判活必须进同网段内侧（真 3.1 TTL=64）；真 3.1 后台存活实测 HTTP 200（title=中兴智能路由器）；②路由器 DHCP 异常：发 3.x/24 租约但**网关指 192.168.5.1（死地址，来源不明非我方改动，10-05 记录无此条）**→裁判 WiFi 客户端无外网，手机被系统判「无互联网」把流量甩蜂窝——曼波「手机打不开 3.1」「连上怎么有网」两问的根源（后者=蜂窝兜底假象）；手机访问后台正确姿势=**关蜂窝数据再开 http://192.168.3.1/**；③路由器 WAN 实测无外网（经 3.1 转发 223.5.5.5:443 超时）→Engine 首启外网测试+DJI 扫码需**临时插 WAN**，装完拔线即得隔离态（曼波拍板：裁判内网只通小电脑+机器人）；④**小电脑双栖形态落地**（曼波要求：superqianli 外网正常+裁判内网互通）：有线 31.57=外网生产通道（DoH 200 验证）+ WLAN 挂裁判 WiFi（RM-Referee profile，DHCP 3.131）——WLAN 连上后死网关默认路由（metric 40）会抢断有线外网，修法=`route delete 0.0.0.0 mask 0.0.0.0 192.168.5.1` + WLAN 接口跃点 20→500（防续租复发，有线 281 恒胜；改段后 WLAN 纯静态无网关则根治）；⑤改段同场待修：DHCP 网关选项改回路由器 LAN IP。
- **2026-10-07 傍晚收官批（改段+5.1 终结+SSID 防误连+信道固化+PHY 墙终案，曼波手操+笔记本会话验收）**：
  - **改段落地**：LAN `192.168.3.1/24`→**`192.168.1.1/24`**（官方硬性，图传/裁判主控按 1.x 硬编码），DHCP 池 `192.168.1.100-254` 开启；后台地址从此为 `http://192.168.1.1/`；
  - **5.1 悬案终结**：真身=局域网配置页的「**自定义网关地址**」+「**DNS 服务器**」两个手填字段写着 `192.168.5.1`（出厂残留/前任配置）——今天所有裁判网设备「连上没网」的元凶配置；已改 `192.168.1.1`；
  - **SSID 防误连收官**：2.4G 改名「**裁判系统联网后果自负**」（自带警告，WPA2/12345678/b-g-n→ax 模式/11ac 实测）+ **5G 已关**（b4:72:d4 前缀定向扫描仅剩 2.4G bc:65）——老设备「裁判系统/裁判系统-5G」记忆全部失效，投网陷阱拆除（HP/Ubuntu 那类不会再犯）；
  - **信道固化**：裁判 2.4G 固定 **ch6**（曾设 ch7 被纠正——相邻信道比同信道互踩更糟）、主路由 2.4G **ch1**+5G **ch48**（非 DFS）、4A ch6 维持；auto 抽签时代结束，重启后拓扑确定性回归；
  - **PHY 墙终案**：AX201 连 ZTE 裁判网被关联层静默无视（11000 发起→零响应→3s 超时 8002），在 ax/be/b/g/n 三种模式、改段前后、真实/随机 MAC（热重装后回真实 34:7d:f6:8f:b7:45）、路由器整重启后均复现；但 **15:57:06 曾成功一次**（8001+11001，曼波手动弹窗连接，24s 后断开）=转瞬即逝的状态窗口；鉴别实验一锤定音：**同一块 AX201 连主路由 2.4G 秒连 99%** → 定性「AX201×这台 ZTE」关联层组合 bug，非配置/密码/驱动/网卡硬件问题；
  - **决策：给小电脑换网卡**——推荐 MT7922（NGFF 2230，~100 元，非 Intel 系；AX200 不推荐=同源 Intel 驱动栈+CNVio 槽位兼容存疑）；AX201 拆下保留（连主路由 99% 是好的）；等卡期间 AdapterSvr 悬案（RDP 跑一键 bat）可先用手机 USB 共享裁判网验证；
  - **排障经验**：①netsh 远程输出编码漂移（GB/UTF-8 不定）——中文 SSID/字段解析一律落盘+本地 node 按 UTF-8/GBK 双试；中文 SSID 定向排查认 BSSID 前缀；②netsh wlan profile XML 声明必须 `encoding="utf-8"`（写 utf8 报「试图加载格式不正确的程序」）；③WLAN 事件日志序列定位：8000→11000→8002 且无 11001=「关联零响应」指纹；④ZTE 局域网页「自定义网关地址/DNS 服务器」字段=DHCP 下发的网关/DNS 选项。
- **🔴 rogue DHCP 事故档案（2026-10-07 17:52 定案 / 18:11 结案，evt_008/009）**：改段落地后裁判路由器**有线口（LAN 口）被桥进主网广播域**（其有线口 MAC `cc:c4:b2:46:16:2f`@31.79 于 16:46 上线；无线 MAC b4:72:d4:65:bc:65 亦在主网应答 ARP）——改段即 `192.168.1.1/24`+DHCP 池 1.100-254 开启 → **对主网毫秒级发 1.x 租约**。与主路由 RD08「陌生 MAC 首查 3.0~3.9s 检查路径」叠加 → **新设备（全部 Mac）必中 1.x 死网关=「Mac 集体连不上 SuperQianLi」，老设备（已知 MAC 秒答占位+旧租约）无感**——「只有新设备/个别机器连不上，老设备全正常」的指纹优先查 rogue DHCP 抢答。**鉴别三步**：①找台有目标 SSID profile 的机器实连看租约网段（小电脑连主路由 BSSID 两次拿 192.168.1.101）；②**同网段内 `arp -a` 直接拿网关真身 MAC**（1.1=b4-72-d4-65-bc-65=裁判无线 MAC，与空中裁判 SSID BSSID 同串；跨网段 SendARP 不可用时此法最直接）；③对照健康租约（本机 31.x/服务器 31.1）确认新老分叉。**插口铁律：WAN 口=安全（NAT 隔离 DHCP 广播，借外网就插它）；LAN 口=rogue 事故**（4A 常插 WAN 无事故 vs 裁判插 LAN 翻车的对照）。**结案验收（曼波拔线纯隔离）**：ARP 二层直探 31.73/31.79 零应答（devicelist 双条目均僵尸缓存勿信）+ 小电脑重连 SuperQianLi 拿回 31.226 + 1.1 无 ARP 应答。**验收坑**：Windows WLAN 旧租约缓存——重连先 unicast 续租旧地址、超时后才广播重发现，15s 窗口内 `show addresses` 仍显旧租约，**必须 `ipconfig /renew` 强制后再判**（第一轮误读为 rogue 未死）。附：改插 WAN 期间 18:01-18:05 全网断 236s——**后经曼波反馈修正定性：校园网 Dr.COM 报「禁止代理上网」主动踢主路由会话**（二次 NAT 的 TTL 指纹：同一出口 IP 混入少一跳的包），**策略在学校上层无法放行 → 裁判路由器以任何形式接主路由都不可行**（LAN 口=rogue 事故、WAN 口=代理检测踢网）；主网断网自愈链路照常接管（egress 换绑 .242→.186）。
- **裁判网与小电脑双栖终态（2026-10-07 晚定稿，详见 referee 域 evt_010）**：小电脑 WLAN=静态 `192.168.1.2/24` **无网关**（官方钦定裁判主机地址；无网关+WLAN 接口跃点 900 双保险，默认路由恒走有线 31.57）+有线=生产外网；Engine 外网测试/DJI 扫码走有线即可——「必须让裁判路由器供外网」系死网关抢路由误判；裁判路由器 WAN 永久空置、纯隔离。**主网设备访问裁判网决策树**：①设备能连 WiFi → 直接连裁判 SSID 进 1.x（零配置，首选）；②主网浏览器要看路由器后台 → portproxy 通道 `31.57:8081→1.1:80`（已配：`netsh interface portproxy add v4tov4 listenaddress=192.168.31.57 listenport=8081 connectaddress=192.168.1.1 connectport=80` + 防火墙规则 Referee-Web-Proxy-8081 限 31.0/24，拆=delete portproxy+delete rule）；③真要主网穿进 1.x → 小电脑 IPEnableRouter+NetNat+主网设备加静态路由（重，按需再开，开了隔离性打折）。
- **SSID 现名与 WLAN profile 坑（2026-10-13 深夜真机实通批，详录 referee 域 evt_011）**：裁判 WiFi SSID 已改 ASCII「**cpxt**」（12345678，WPA3/WPA2 过渡、实际协商 WPA2-PSK+CCMP，嵌入式模块 WPA2-only 可过），旧中文名「裁判系统联网后果自负」已废；小电脑 WLAN profile 恢复件=`C:/qianli/data/WLAN-cpxt.xml`（含明文密钥勿外传）。**两坑**：①`netsh wlan add profile` **拒收 XML 里的 `<AutoSwitch>` 元素（0x80001 schema invalid）**——手写净件/导出件最小编辑都会挂，原样导出件能灌，AutoSwitch 侧改走 `netsh wlan set profileparameter name="cpxt" autoSwitch=yes`；②「事件 8003 策略禁止在该接口上自动连接」=WLAN 连上后 1~2.5 分钟被本地策略踢的指纹（同字节 profile 重灌后未复现，疑与连接发起方式相关，根因未终审）；复发杠杆=autoSwitch=yes + `netsh wlan set profileorder name="cpxt" interface="WLAN" priority=1`（必须置顶防漫游去 SuperQianLi）。机器人掉线排查顺序=小电脑 WLAN 在不在 cpxt → 四件套在不在（RM-EngineStart schtask）→ ARP/15861 ESTABLISHED；主控屏「服务器连接状态」≠WiFi 图标（WiFi 连上≠找到服务器）。
- **Engine 四件套远程/半自动启动实战（2026-10-07 晚）**：①SSH 会话直启 GUI=断开全树清理（老坑复验）；②schtasks /tr 交互任务启动 bat → GUI 落在目标用户活动会话（曼波 RDP 在=落 RDP），存活 ✓；③**SSH 命令行传反斜杠必被吃一层**（`C:\qianli\...`→`C:qianli...`，转义几层都没用）——远端写文件一律 base64 中转，路径尽量用正斜杠（cmd 的 `cd /d "C:/x/y"` 与 CreateProcess 都认）；④桌面 start.bat 有 `\t`/`\r` 转义损伤（`Server\tool` 烂成 tab+ool）不可用——Engine.exe 启动会自动拉起 RMServer/AdapterSvr/LogClient，无需 bat；⑤小电脑本地端口拨测用 node `net.connect` 循环（比 PowerShell Test-NetConnection 轻）。**AdapterSvr 15s 自杀悬案终审**：完整 GUI 会话（RDP/控制台）存活，session 0 自杀定性实锤——GUI 类服务（Engine/AdapterSvr/面板）只在交互会话起。

## 十二、校园网认证系统与断网重连插件（2026-09-27 探测归档，待回内网接续）

> 背景：曼波三项需求（①网关断网复活能力强化——"有时候比较巧合就会根本连不上"；②账号登录策略池扩充，31108753 设首选项；③触发重连时做延时探针，限速账号打"本月不再使用"标记）。曼波指示：**等连进内网后，按网关（主路由插件）的既有规则再工作**——不另起炉灶写第二套自愈系统。

- **带账号登录策略池的断网重连插件**：本体位置曼波记不清，范围二选一——主路由（miwifi SSH）或小电脑（脚本/计划任务/pm2）。回内网后按 主路由 → 小电脑 顺序找，**它就是认证协议与账号池格式的活文档**，改造以它为底。
- **认证系统实测（2026-09-27，笔记本校园网直连环境）**：`login.cqu.edu.cn → 10.10.8.162`，`Server: DrcomServer1.0`（Dr.COM 城市热点），开 80/443；登录页仅加载 `a41.js`（gzip，eportal 移动端脚本），其内 `portal_api = protocol//hostname:ep_port + '/eportal/portal/'`，端点含 `online_list`/`page/loadConfig`/`perceive`/`visitor/checkUserStateByIP`；**ep_port 实测 8081/8008/8085/9000/9088/8011/3000 全拒、80 上 API 路径 404**——API 参数（端口/字段名/是否加密）必须以主路由插件代码校准，勿凭公开 eportal 格式硬写。
- **账号策略池**：5 个账号已落 `campus-accounts.local.json`（工作区根，`**/*.local.json` 已全局 gitignore——凭据永不入库）；`preferred: "31108753"`（曼波钦定首选项，每次触发重连先试它）；其余 20261103/20253548/30210313/20255495 按 priority 轮换；`bannedThisMonth` 结构已备（限速账号当月弃用，自然月 1 号自动失效）。**该文件将来迁往插件的真实配置位**。
- **慢速判定（曼波拍板：自适应基线）**：每次触发重连后连做 3 次探针取中位数，超过健康基线（正常时段滑动样本）3 倍即判该账号被限速 → 打"本月不再使用" → 自动换下一个账号重试；探针可复用 netlog 的 wan TCP connect 计时（223.5.5.5:443 实测可用，腾讯 119.29.29.29 与 1.1.1.1 在受限会话下不通，勿选）。
- **回内网后的工作清单**：①找到插件本体（主路由→小电脑）；②读它拿认证协议细节+账号池格式；③按其形态落三项需求（强化复活：多账号轮换重试+登录后真恢复验证；首选项；慢速探针+月度弃用）；④`campus-accounts.local.json` 迁配置位；⑤顺手核对本机探测的认证结论与插件实现是否一致。
- **受限会话指纹（排障备查）**：UDP 53 全拒（含校园网自有 DNS 202.202.2.50）、119.29.29.29/1.1.1.1:443 不通、但 223.5.5.5:443 TLS 可用（阿里 DoH `https://223.5.5.5/resolve` 可当受限环境解析通道）；traceroute 正常（第一跳 10.253.32.1 → 202.202.0.130 → 202.202.216.x，延迟 4~12ms）。

### §十二.1 接续完成（2026-09-27 晚，三项设计已全部落地）

- **协议实锤**（本轮实测+考古双证）：eportal API=`http://10.10.8.162:801/eportal/portal/`——**801 是 API 端口**（80/443 只是登录页静态资源，之前扫 8081/8008 等全漏）；登录=GET `login?callback=dr1005&login_method=1&user_account=%2C0%2C{学号}&user_password={明文}&wlan_user_ip={放行IP}&wlan_user_mac=000000000000&...`；状态=GET `online_list?callback=dr1005&lang=zh`（返回会话 IP/MAC/账号/时长）；放行 IP 取认证页 `GET /` 回显 `v4ip=''`（经 NAT 即主路由 WAN IP）。
- **「网关实现途径」结论**：主路由 WAN=纯 DHCP（wan_info 实测），被踢秒级自愈=Dr.COM MAC 无感知认证（当前会话 20230104@10.253.32.177，online_list 可查）；重连真身=4A 时代 `ping.sh`（两账号无脑发/不验证/失败 reboot），**已归档**：桌面 `qianli-backups/4a-root-ping-archive-20260920.tar.gz`（=曼波所说"存两个现有账号的地方"）。4A 本体现已干净（root/cquqianli SSH 可入，/root 无残留）。主路由 miwifi SSH 未开，管理密码存 `approval-bot/.env` 的 `ROUTER_PASSWORD`（=cquqianli，**密码本身没错**——09-27 排障定性：老 SHA1 登录算法恒 not auth，router-xiaomi.js 新固件 SHA256 适配后登录成功，勿再当错密码排查）。
- **Wi-Fi 6（ax）已全局关闭（2026-10-05）**：`POST /api/xqnetwork/set_wifi_ax` body `ax=0`（唯一生效端点；`set_wifi` 的 `wifimode` 参数被固件无视，勿再试）。动因=竹子等 11n 物联设备「有的连得上有的连不上」的兼容性整改；ax=0 **双频全局生效**（2.4G/5G 都关，5G 客户端回落 11ac）。2.4G 信道保持 auto（当前落 ch1，与 4A 的 ch6 错开；若日后跳 6 需再错开）。
- **ax 切换会偶发把 2.4G 射频弄成半死态（2026-10-05 凌晨实战）**：`set_wifi_ax ax=0` 首次执行后 2.4G 进入「配置开着、信标停发」状态——`wifi_detail_all` 仍显示 status=1/hidden=0/ch1，但空中无信标，新设备（打印机等 2.4G-only）扫不到连不上；已关联的老客户端会话保留，极具迷惑性。**排障指纹**：配置 API 说开 + 笔记本 `netsh wlan show networks mode=bssid` 扫不到该 SSID（同次扫描能看到其它 2.4G 网=扫描功能正常）；5G 同批正常（回落 11ac）只哑 2.4G。**修复**：`set_wifi_ax ax=1` 等约 10s → `ax=0` 重走一遍，触发双频射频完整重启即愈（第二轮未复现哑火，属偶发固件 bug）。**验收铁则**：改 Wi-Fi 配置后必须空中扫描确认信标回归，不能只信配置 API；「新关联能建立」才算活（本次笔记本重启后自动漫游上 2.4G 即活体证明）。误信 netsh 的「无线电类型 802.11ac」显示会误判 ax 状态（2.4G 物理上无 11ac，显示噪音），ax 状态以 `wifi_detail_all` 的 `ax` 字段为准。射频重启后路由器 DNS 代理有秒级冷启动瞬态（首查超时、几秒后自愈），验收测 DNS 别在重启后立刻判死刑；客户端若在重启窗口内检测失败会缓存「无网」状态，开关 WiFi 重连即愈。设备指纹备查：AMPAK=Bambu 打印机等 WiFi 模块厂商（50:41:1C、9C:B8:B4），Espressif=自制 IoT（EC:DA:3B），FN-LINK=杂牌 IoT 模块（9C:9D:07）。
- **落地形态**：netlog **v2**（生产机 pm2 `qianli-netlog` :3016）——`src/wanGuard.js` 复活状态机 + `src/campusAuth.js` 协议层 + `src/accountPool.js` 策略池；池文件=工作区根 `campus-accounts.local.json`（7 账号，31108753 首选项，**/*.local.json 已 gitignore）→ 部署目标 `C:/qianli/data/netlog/`（push.js 备份+条数守卫）；手动触发 `POST /api/netlog/revive`（X-API-Token=netlog .env）。慢速判定=自适应基线（滑动 20 样本中位数，下限 30ms）×3 →「本月不再使用」→自动换号。
- **被抢持续垫底（netlog v18，2026-10-07 曼波定「首选只是优先不是拉锯」）**：复活成功后 30 分钟内又掉线=该账号被别人抢（Dr.COM 单账号并发互踢；2026-10-07 15:2x 实锤：31108753 被 15:10 复活后 6 分钟内两度顶掉——疑似该号本主在别处登录）→ 持久垫底 24h（`NETLOG_KICK_DEMOTE_HOURS` 可调），候选排序沉底、只在没得选时才轮到，跨轮跨重启保留（`account-demotions.json` 独立状态文件，池种子部署不覆盖），到期自动复位、仍被抢自适应续垫。与「本月不再使用」（限速，彻底弃用）两档区分。事件 `account_demoted` 即时私聊（4h 冷却）；summary guard 段 `demotions` 可观测。旧 v10「本轮排队尾」语义已废（窗口一过就回首选对拍=拉锯复发根源）。
- miwifi 上网设置界面（用曼波 stok 实查）无校园网认证区块、无插件中心——路由器侧无账号池，一切以 netlog 侧引擎为准。
- **netlog 引擎两处假阳性（2026-10-05 05:28 事故实锤，待修）**：①wan 探针=TCP connect 223.5.5.5:443，认证死后受限会话代答照样握手成功 → wan 恒 true，复活永不触发（lastRevive=null），10-04 夜间多段「自愈」实为干等校园网放行；②forceRevive 在出口本通时把 wan 探测通过当复活成功，实际「IP 已在线」登录被拒没换绑。**修复方向**：wan 探测升级 TLS/HTTP 层验证、复活触发纳入 traffic_down、forceRevive 成功判定核 online_list 归属。**手动换号 SOP（实战通过）**：SSH 小电脑跑独立 node 脚本调 `campusAuth.js`——`fetchAuthIp()` 拿主路由 WAN IP → `logout(ip)`（约 2.5s 全家黑洞）→ `login(首选账号, authIp=ip)` → `onlineList()` 终验 user 归属；引擎（pm2）不用动。池文件=部署目标 `C:/qianli/data/netlog/campus-accounts.local.json`。

## 十三、Radmin VPN 远控通道（2026-09-29 建成，跨网段管理小电脑的正道）

**用途**：曼波不在 31.x 内网时（烂网/离开实验室），笔记本经 Radmin VPN 隧道直达小电脑的 SSH/RDP/全部服务。**依赖边界**：小电脑自身必须有外网（校园网会话活着）；实验室整体断网时此通道与 netlog 同死，属物理限制。

- **网络**：`qianli-mesh`（私有网络）；笔记本 `26.33.107.52`（LAPTOP-BGC4G36V）/ 小电脑 `26.6.74.79`（DESKTOP-FE1MIGI）。实测隧道 ping 6ms（P2P 打洞直连）。
- **台式机通道（2026-10-14 实测）**：`26.174.14.117`（DESKTOP-PCOONE5，RDP 用户名 nebula——桌面「台式机-mesh.rdp」）；**SSH 22 公钥直通**（笔记本 BatchMode 免密可达），默认 shell=cmd（远端命令别用 Unix 管道/tail，纯 cmd 语法；git 2.55 在 PATH）。qianli 工作区=`D:devqianli`（顶层 monorepo clone，2026-10-14 迁移核查：5 submodule 对齐+hub server/.env 已补送+与 GitHub 同步）。
- **凭据**（网络名+密码）：大脑仓库 `config/radmin-mesh.local.env`（**归属勘定 2026-09-29 曼波定：网络基础设施凭据归大脑记忆区，不进业务 bot .env**；该文件已被大脑仓库 .gitignore `/config/*.local.env` 排除，不入 git）。
- **防火墙**：小电脑已放行 26.0.0.0/8 → 本机 22（SSH-qianli-RadminVPN-26）+ 3389 TCP/UDP（RDP-qianli-RadminVPN-26-TCP/UDP）。
- **重启自愈链**：RvControlSvc 服务自启 + GUI HKCU Run 自启 + Winlogon AutoAdminLogon=1（mechax 自动登录）→ 重启后自动回网，无需人工。
- **安装包归档**（官网被墙+DNS 污染，重装用本地存档）：桌面 `qianli-backups/Radmin_LAN_2.1.4951.1.exe` + 小电脑 `C:/qianli/data/installers/`；Famatech Corp. 签名已验。笔记本 2.0.9 与小电脑 2.1.4951.1 混版本组网兼容。
- **GUI 特性**：Radmin VPN 启动后缩托盘、主窗隐藏（Qt 类 `Qt51515QWindowIcon`/`CMainWnd`，UIA root 树看不到）；要显示主窗需 EnumWindows 找 hwnd + `ShowWindow(5)+SetWindowPos`。GUI 跑在交互会话里，会话 disconnect（非 logoff）进程不断。

**远程自动化经验（本次实战淬炼，给 Windows 目标机无人值守操作复用）**：
1. SSH 会话里 `cmd.exe` 整个不可用（`cmd /c echo` 都挂）——**装软件用 `powershell Start-Process -Wait`**；
2. git-bash 吃 `/VERYSILENT` 类斜杠参数（MSYS 路径转换，§五同款）——长参数一律包进远端 bat/ps1 文件执行；
3. **sftp.writeFile 间歇性写 0 字节文件**——传内容改用 `echo <base64> | base64 -d > 目标`；fastPut 上传大文件正常；
4. schtasks `/tr` 带空格路径会截断——中转 bat 路径必须无空格；
5. GUI 填表**禁用 SendKeys 逐字符**（丢字符+焦点漂移）——**Set-Clipboard + `^v` 粘贴**一次到位；`-WindowStyle Hidden` 防任务 console 抢焦点；每步截图（CopyFromScreen→b64 读回）闭环验证，不盲打；
6. RDP 自动登录链：`cmdkey /generic:TERMSRV/<ip>` + `mstsc /v:<ip>`（凭据先存则免交互）。

## 十四、主路由 RD08 半死事件与 netlog 检测细化（2026-10-07）

- **「新设备连上没网」根因定案**：RD08 固件 1.1.96 射频状态机不稳——ax 切换/长运行后进入「射频配置开着但信标不发/DHCP 僵死」半死态（10-05 ax=0 哑 2.4G、10-07 ax=1 哑 5G+DHCP 不发地址，两次实锤）；老会话设备正常、新接入设备中招=「有的人有网有的人没网」。**恢复=物理断电重启**（ax toggle 配方 10-07 未能修好半死）；重启后 ax=1 配置保持、5G 自动换信道（ch40→ch48）属正常。
- **miwifi API 坑**：`set_wifi_ax` 只吃 form urlencoded（JSON 报 code 1502「输入不能够为空」）；无线真实状态以 `wifi_detail_all` 的 `ax` 字段为准（UI 开关类名会显示脏状态，WIFI6switch 显示 on 实际 ax=0）；TWT 开关点击疑似触发射频抽风（未最终验证，择时再试）。
- **Wi-Fi6 现状**：ax=1 保持，11n IoT（摄像头/Bambu 模块）实测正常——10-05 关 ax 的兼容顾虑未复现；「连上没网」与 TWT/省电路径无关（主因=固件半死）。
- **防复发定时重启**：每周二 04:03——小电脑 schtask `qianli-router-weekly-reboot`，脚本 `C:/qianli/data/scripts/router-weekly-reboot.js`（`--test` 干跑验证登录+用**无效 stok POST** 探测端点存在性绝不误触发；窗口保险=仅周二 03:50-04:20 执行）；reboot 端点=`/api/misystem/reboot`；bat 中转（/tr 带空格截断坑）+ 远端 git-bash 也要 `export MSYS_NO_PATHCONV=1`。
- **netlog 检测细化（v15/v16）**：wan DoH 双源 AND（阿里+腾讯——**受限会话对阿里白名单真实放行**，单源测不出半残）；wan 三态（ok/restricted/down，restricted=认证半残指纹，翻转即私聊）；routerWatch 低频观测主路由（管理面失联/射频配置异常/ax 翻转/DHCP DISCOVER 主动探测/设备数骤降旁证）；summary 带 probeMatrix 逐目标矩阵。**边界**：信标停发本身有线侧物理不可见——定时重启+人工兜底。
- **eportal `online_list` 按查询者视角返回**：跨网段查会话归属只看到自己的会话——「主路由断认证」的判断必须站在主路由 NAT 侧复核（10-07 曾误判，netlog 被冤枉装死）。
- **无感知认证幽灵会话**：笔记本 MAC 绑定账号 20251852，连 CQU 自动开会话且 logout 3 秒自动续（杀不死；不同账号不互踢主路由）。
- **DHCP「3 秒慢应答」=陌生设备检查机制，不是半死（2026-10-07 午后勘误，曼波质疑成案）**：上午 netlog 报的 `router_dhcp_down/recover` 振荡是**探针伪影**——实测指纹：已知 MAC（有租约）DISCOVER **4-6ms 秒答**；新 MAC 首次 **3.0-3.9s**（固件对陌生设备的检查路径）；同一 MAC 紧随重复 **4ms**（检查过进快表，**但快表 TTL 只有分钟级，隔几分钟首查又回 3 秒**——「进快表后恒毫秒级」是过满表述，探针每拍都会撞检查路径）。而 netlog v16 `probeDhcp` 未传 timeoutMs（默认 3000ms）+每次随机 MAC=每次都走陌生路径 → 3 秒边界掷骰子，DHCP 服务当天从未挂过。**真半死判据=已知 MAC 也慢/无应答**（10-07 凌晨 ax toggle 后那种才是，别再拿陌生 MAC 探针当半死证据）。对照排除：31.1 dnsmasq 应答 1-5ms、校园网 DNS 202.202.2.50 UDP53 通（「DNS 拖死 DHCP」不成立）。**v17 已落地（9e1a7d5）**：probeDhcp 固定探针 MAC `02:4e:45:54:4c:4f` + timeoutMs 5000（稳定覆盖 3.9s 最坏检查）——固定身份连续 2 次 5s 超时才算真挂。「新设备连上没网」的机制性残余=新设备首答 3-4 秒，超时紧的客户端（部分 IoT/打印机）会放弃；要消除就关主路由「新设备接入确认/防蹭网」类开关，安全权衡曼波定。
- **僵尸设备条目与「拿到隔壁网段 IP」鉴别（2026-10-07）**：devicelist 的 `online`/`ip` 僵尸缓存会误导——HP 31.105、AMPAK 50:41:1C:52:BE:6E（31.88，非 Bambu：21/80/1883 全关不合铁指纹）均幽灵（ARP/端口全无应答）。HP M232「连 SuperQianLi 却拿 192.168.3.x」定案=**设备投奔满格邻居 SSID**（「裁判系统」2.4G 100% 满格+HP 记忆过多 profile 按信号挑网 → 拿裁判 3.x 租约，网关=死地址 192.168.5.1 → 必没网）；排除 rogue DHCP 的证据：5 轮 DISCOVER 唯一应答者 31.1（serverId/yiaddr/router 全 31.x）+ SendARP 二层直探 3.1/5.1/1.1/2.1 全无应答。SendARP 坑：x86 小端拼 uint=`b[0]|b[1]<<8|b[2]<<16|b[3]<<24`，srcIP 必须传可达地址（笔记本「以太网 3」31.2 幽灵网卡会被 Select First 选中）；**跨网段 IP 的 no-reply 不能证明二层不存在**（非直连网段直接失败），rogue 判定以 DISCOVER 应答者身份为准。修复：HP 删「裁判系统」profile 或裁判 SSID 改名隐藏（与改段 1.x 同批）。
- **凭据集中**：三路由+主机+服务凭据一表 → 工作区根 `凭据台账.local.md`（`**/*.local.md` gitignore）。
