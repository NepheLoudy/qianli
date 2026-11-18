# 打印机局域网接入查证与逻辑链路 · bambu-print-reservation

> 覆盖范围：拓竹（Bambu Lab）与闪铸（FlashForge）打印机「局域网接入」方式的官方/社区资料查证（查证日 2026-09-06），以及本系统当前打印机链路的完整现状。
> 行号以 2026-09-06 工作区代码为准；代码改动后请同步更新本文件。
> 本文只描述「现在是什么」。官方口径与社区事实逐条标注；对接入决策、协议选型的改动决策记在各项目 DEVLOG.md。
> 资料核验程度约定：✔ = 已抓取原文核对正文；△ = 检索结果/摘要条目（未逐一抓取正文，谨慎引用）。

---

## 0. 结论摘要

- **拓竹官方没有面向个人开发者的局域网 API 文档**。官方 wiki 仅公开《打印机网络端口》✔ 一页网络事实（局域网模式：MQTT 8883、FTP 990+50000~50100、视频 6000；发现 SSDP 1990/2021）；官方对第三方开放的开发者通道是 **Fleet Hub 开发者中心**（企业授权：设备激活 Key + 客户端证书 + 本地 HTTP API，△）。局域网 MQTT 的用户名 `bblp`、topic、命令 JSON 等细节**均为社区逆向事实标准**（本仓库内 `node_modules/bambu-link` 即按此实现，已核源码）。
- **闪铸同样没有公开的局域网 API 开发文档**。官方口径只有「局域网模式/LAN Only + 屏幕 8 位 Printer ID（社区亦称 Check Code）」配合官方切片软件 FlashPrint 5 / Orca-FlashForge 绑定的操作说明（△）；协议事实（8898 HTTP / 8899 TCP / 8080 摄像头）来自社区对官方工具与固件的分析。
- **两家架构本质差异**：拓竹 = 打印机作为 MQTT broker 的**推送式长连接**（状态主动上报）；闪铸 AD5M 系 = **无状态 HTTP 轮询 + TCP 文本口**，没有公开的 MQTT/事件推送通道。
- **本系统现状：只实接拓竹**，走局域网直连（不经拓竹云）：MQTT 8883 状态/命令 + SFTP/FTP 文件上传，参数全部来自 `.env`；闪铸 AD5M 仅「登记展示 + 人工通道」（详见第 4 章）。

---

## 1. 拓竹 Bambu Lab：局域网接入

### 1.1 官方依据（wiki.bambulab.com《打印机网络端口》✔，已抓取核对）

官方把端口分成三组，本表只列与本系统相关的行（原文分组如下）：

| 模式 | 用途 | 端口/协议 |
|---|---|---|
| 云模式 | HTTP API | 80 / 443 / 8080（TCP） |
| 云模式 | MQTT | 8883（TCP，连 `us.mqtt.bambulab.com` / `cn.mqtt.bambulab.com`） |
| 云/局域网共用 | 设备发现 | 1990 / 2021（SSDP，multicast/broadcast） |
| 云/局域网共用 | NTP | 123（TCP/UDP） |
| **局域网模式** | **LAN MQTT** | **8883（TCP）** |
| **局域网模式** | **LAN FTP** | **990、50000~50100（TCP）** |
| 局域网模式 | LAN 视频 | 6000（TCP） |

官方页原文要点（引号内为页面原话）：
- 「当打印机处于局域网模式时，所有域名/IP地址都是无用的」——局域网模式下打印机不依赖任何云域名，可整机断外网自包含。
- 「域名/IP地址在未来可能会被改变」——云侧地址不保证长期不变。

官方对第三方的接入通道（△ 检索结果，未抓正文）：**Fleet Hub 开发者中心**（企业授权，创建设备激活 Key、签发客户端证书、提供 API 文档与示例代码，商务邮箱 `devpartner@bambulab.com`）；面向个人的 Cloud API / LAN API 开发文档官方未公开。

### 1.2 接入要素与获取步骤

| 要素 | 说明 | 本系统对应 |
|---|---|---|
| 局域网 IP | 打印机与机器人同一网段；可用官方发现端口（SSDP 1990/2021）或打印机屏幕「网络设置」查看 | `.env` `PRINTER_HOSTS` |
| Access Code | 8 位数字，打印机屏幕「设置 → 网络 → 局域网模式/开发者模式」下显示；社区经验：约 3 个月过期需重取 | `.env` `PRINTER_ACCESS_CODES` |
| 序列号 SN | 打印机「关于」页/Bambu Studio 可见；MQTT topic 与 TLS 登录名的组成部分 | `.env` `PRINTER_SERIALS` |
| 机型 | 决定文件上传通道（见 1.4） | `.env` `PRINTER_MODELS` |

获取步骤（官方操作口径 + 社区注记）：同网段 → 打印机屏幕开启局域网模式（LAN Only / 开发者模式）→ 记录屏幕显示的 IP 与 8 位 Access Code → 填入 `.env` 四列数组（`src/config.js:9-22` 按位置对齐）→ 重启服务，`manager.js` 自动建连（见 4.2）。

### 1.3 MQTT 协议事实（社区标准；本仓库 `node_modules/bambu-link` 源码已核 ✔）

| 项 | 事实 |
|---|---|
| Broker | 打印机本机，`mqtts://<host>:8883`，MQTT over TLS（自签证书，客户端跳过校验 `rejectUnauthorized: false`） |
| 用户名/密码 | 用户名固定 `bblp`，密码 = Access Code |
| Topic | 状态上报与命令收发共用 `device/{serial}/report`（bambu-link 订阅与 publish 同一 topic；社区文档中另有多实现把命令发到 `device/{serial}/request` 的写法，两套对固件均兼容） |
| 建连后首帧 | `{"pushing":{sequence_id, command:"pushall", version:1, push_target:1}}` 拉全量状态（bambu-link `dist/index.js:865-870`，sequence 自 10 起） |
| 后续数据 | 打印机持续推送增量状态 JSON（print/temps/ams/network 等分段） |
| 命令回包 | 命令帧带 `sequence_id`，回包中回显（`print.sequence_id` / `system.sequence_id`），按序号匹配挂起命令；超时默认 10s（bambu-link `dist/index.js:479,564-598`） |
| 命令类型 | 打印 3mf：`project_file`；打印 gcode 文件/控制：`print`（`print_gcode_file` 等）；`pause` / `resume` / `stop`；拉全量：`pushall` |
| 重连 | `reconnectPeriod: 5000ms`（bambu-link `dist/index.js:836`） |

> 注：1.3 全部内容均为社区协议事实，**官方未公开过上述字段级文档**；以官方 wiki 端口表佐证「8883 = LAN MQTT」这一点与社区一致。

### 1.4 文件上传通道（本系统现状 + 与官方表差异注记）

- 官方端口表将局域网 FTP 记为 **990 + 50000~50100**（FTPS，TLS 加密数据口），未区分机型。
- **2026-10-15 真机 H2D 勘误（v56 批）**：X1/H2D 新固件 **22/21 同样全关（ECONNREFUSED）、990 为唯一文件通道**——与 P1 系 10-07 实测一致，「X1/H2D → SFTP:22」系老假设作废；uploadBuffer 全系统一 FTPS 990 优先、21 回退。本系统 SFTP 代码保留但不再是任何机型的主通道。
- 本系统现状（`src/printer/client.js` `uploadBuffer`）：**全机系统一 FTPS:990 优先（implicit TLS）、FTP:21 回退兼容老固件**——「X1/H2D → SFTP:22」老假设已作废（见 §1.4 勘误）；凭证同为 `bblp` + Access Code。
- **2026-10-07 实测批（4A 隔离区两台 P1 系真机，云模式+局域网端口集并开）**：两台 990/8883/6000 常开、**21/22 明文/SSH 口全部 REFUSED**——新固件已砍社区明文通道，官方 990 FTPS（vsFTPd 3.0.5，TLSv1.2）为唯一文件通道；本系统同批从 node-ftp（无 TLS）引入 `basic-ftp` 实现 `ftpsPut`，21 回退保留。**历史注记**：此前版本仅走 22/21 社区通道（当时实机可用）；22/21 不在官方端口表内属社区实现事实，官方 990 通道现为首选。
- **553 与机端存储离线（热修51 诊断，v112 落地）**：机端存储掉挂载（U 盘被拔/SD 卡掉卡，X1C 11-08、H2D 11-15 两案）时 FTPS 上传稳定 553，状态报文 `raw.print.sdcard=false`——`uploadBuffer` 双通道（FTPS 990/FTP 21）全败且 sdcard=false 时错误带 `storageOffline` 标记与人话提示「请检查打印机 SD 卡/USB 盘是否在位」（重试必败的确定性失败）；分发引擎识别即熔断该机停派，sdcard 恢复（热插回/重启重挂载）自动解除续打（见 README「可靠性与自愈」）。

---

### 1.5 画面通道（RTSPS 322，v55 落地；官方未公开，社区事实 + 2026-10-15 真机 H2D 实测）

| 项 | 事实 |
|---|---|
| 端口 | **322**（RTSP over TLS）。554 不开；6000 是 P1/A1 的裸 H.264 通道，与 X1/H2D 无关 |
| URL | `rtsps://bblp:<Access Code>@<ip>:322/streaming/live/1`——**URI scheme 必须写 rtsps**，写 rtsp 会 301 重定向（Location 指回 rtsps） |
| 认证 | HTTP Digest（MD5），realm=`LIVE555 Streaming Media`（服务器即 LIVE555）；用户名 `bblp`、密码 = Access Code |
| 传输 | SETUP 走 TCP interleaved（RTP/RTCP 与 RTSP 文本同连接混跑）；RTP payload type 96 = H.264，channel 1 = RTCP |
| 实现位 | `src/printer/rtsps.js`（RTSPS 会话 + RTP 拆包 → Annex-B 字节流，零新依赖）；经 `/api/printers/:id/camera/h264` WS 中继给前端 WebCodecs |
| 实测 | 真机 H2D ≈2.1Mbps，GOP ~5s（IDR 约 165KB）；TLS 1.3 |

实现注记（踩坑即文档）：RTSP 响应与 interleaved 二进制在同一条 TLS 流混跑，且 **PLAY 响应回来前 RTCP SR 就先到**——解析必须按缓冲区首字节分流（`RTSP`=响应 / `$`=interleaved 二进制），两种节奏在 PLAY 前后不同，任何「先读固定长度再解析」的假设都会错位。

### 1.6 H2D 双喷嘴 / 外部料位 / 开打帧事实（2026-10-16 真单批）

| 项 | 事实 |
|---|---|
| 左右喷嘴 | **extruder id 1 = 左喷嘴（外挂料盘侧）、id 0 = 右喷嘴（AMS 侧）**——2026-10-16 实机实证修正：运行中打印热喷头 = id1 且料位指向外挂（snow=254），与「左喷嘴是外挂料盘」口径双重印证；旧「Orca 机档数组顺序」推导**作废**（官方打印区/限高数据只描述左右几何，数组下标↔固件 extruder id 的对应关系此前判错）。单色件切片默认走 `master_extruder_id=2`（1-based→id1=左） |
| 料源（本机口径） | 左喷嘴（id1）← 外挂料盘；右喷嘴（id0）← AMS（曼波 2026-10-16 口径） |
| 外部料位编码 | H2D 外部料位 = 虚拟料位：**254=外挂料盘·左 / 255=外挂料盘·右**（各为独立虚拟 AMS 单元、槽 0；Bambuddy 同口径）。数据位：`print.vir_slot`（打印域，非 AMS 域） |
| 开打帧 bed_type | 必须与切片产物 `curr_bed_type` 一致（错配触发 H2 板检测警告/暂停 0500-8051）。token：Textured PEI Plate→`textured_plate`、High Temp Plate / Smooth PEI Plate→`hot_plate`、Cool Plate→`cool_plate`、SuperTack→`supertack_plate`（OrcaSlicer.dll 实锤）；**2026-10-16 起按文件动态取**，硬编码仅兜底 |
| 用料映射 | `ams_mapping2` 逐用料 `{ams_id, slot_id}`（旧 `ams_mapping` legacy 值：AMS=ams*4+slot、外挂=虚拟料位原值）。分发引擎按 slice_info.config 用料清单自动匹配（材料+颜色 redmean），审批指定槽位优先 |
| fail_reason 50348044 | = 0x0300400C = **HMS 0300-400C「打印已取消」**（非硬件故障；屏幕手停/外部打断/被新任务取消均落此码）。分发侧语义：命中该码 = **机器端人工取消 → 不自动重发**（humanTerminateTask，2026-10-16） |
| gcode_state RUNNING | **H2 新固件的打印执行态**（打 print 中上报 RUNNING 而非 PRINTING；2026-10-16 实测）。映射层须将 RUNNING 计入「打印中」——漏收会被兜底成空闲、把正在打印的机器误标可派单 |
| 停止/暂停指令 | `stop`/`pause`/`resume` 帧合规（社区同款 `{"print":{"command":"stop"}}`，print 域数字 seq）；但**回执 success ≠ 真正停机**（残留态实测静默 no-op）——控制台按状态验证如实回报（2026-10-16）。另注：社区有「2025+ 固件控制命令需签名」报告（LINUX DO），本项目实测 project_file/ledctrl 无需签名可用，stop 若在真实打印中仍无效再按该线索深挖 |
| 切片文件内嵌机型 | `project_settings.printer_model`（人读名）与 `slice_info.printer_model_id`（Orca 内部 id，如 `O1D`=H2D、`Flashforge-Adventurer-5M-Pro`）——**直通单品牌判定以内嵌为权威**（2026-10-16 实证：「拿闪铸机子切的 .gcode.3mf」扩展名是 .3mf，只看扩展名必误判拓竹）。闪铸目标的 Orca 工程 3mf 分发时需提取内嵌 `Metadata/plate_1.gcode` 按 `.gcode` 上传（闪铸固件只吃裸 gcode） |
| 错误残留 | 打印被取消/失败后固件**挂住** `gcode_state=FAILED`+`task_id`（屏幕无任何提示仍持续回传；`clean_print_error`/`stop` 实测全受理但不生效——**指令免疫**，2026-10-16 实测）。解除=屏幕处理/重启电源；**分发侧已放行「静止残留」**（方案B：新任务开打顶掉残留，有在打痕迹的真故障不放行） |
| 灯控节点名 | **按机型分型**（2026-10-16 X1C 真机实证）：H2D 三节点 `chamber_light`（主腔灯）/`work_light`/`chamber_light2`（副腔灯，端点「腔灯」用它）；**X1C 只有 `chamber_light`/`work_light`**——误发 chamber_light2 被拒 `did not find the valid led: chamber_light2`（生产错误日志实锤）。X1C 灯控实测：`chamber_light` + 新世代格式（字符串 seq + 四时间字段）物理生效（lights_report 开→关→开全链验证） |
| project_file 回执 | **回执匹配不稳**（2026-10-16 R-008 真单实证）：bambu-link 按回执 `print.sequence_id` 匹配（10s 超时）——**X1C 实测超时**（`Command timeout for sequence 10194`）而机器**实际已开打**；H2D 数字 seq 可匹配，X1C 疑似字符串回显（同族固件两机行为不同）。**分发链判定以状态为中心**：回执超时后按状态验证（准备/打印态=成功，热修24）；另有队列 × subtask_name 对账兜底。教训：任何「回执/ACK 缺失」不得当作分发失败——先看机器实况 |

---

## 0. 结论摘要

- **拓竹官方没有面向个人开发者的局域网 API 文档**。官方 wiki 仅公开《打印机网络端口》✔ 一页网络事实（局域网模式：MQTT 8883、FTP 990+50000~50100、视频 6000；发现 SSDP 1990/2021）；官方对第三方开放的开发者通道是 **Fleet Hub 开发者中心**（企业授权：设备激活 Key + 客户端证书 + 本地 HTTP API，△）。局域网 MQTT 的用户名 `bblp`、topic、命令 JSON 等细节**均为社区逆向事实标准**（本仓库内 `node_modules/bambu-link` 即按此实现，已核源码）。
- **闪铸同样没有公开的局域网 API 开发文档**。官方口径只有「局域网模式/LAN Only + 屏幕 8 位 Printer ID（社区亦称 Check Code）」配合官方切片软件 FlashPrint 5 / Orca-FlashForge 绑定的操作说明（△）；协议事实（8898 HTTP / 8899 TCP / 8080 摄像头）来自社区对官方工具与固件的分析。
- **两家架构本质差异**：拓竹 = 打印机作为 MQTT broker 的**推送式长连接**（状态主动上报）；闪铸 AD5M 系 = **无状态 HTTP 轮询 + TCP 文本口**，没有公开的 MQTT/事件推送通道。
- **本系统现状：只实接拓竹**，走局域网直连（不经拓竹云）：MQTT 8883 状态/命令 + SFTP/FTP 文件上传，参数全部来自 `.env`；闪铸 AD5M 仅「登记展示 + 人工通道」（详见第 4 章）。

---

## 1. 拓竹 Bambu Lab：局域网接入

### 1.1 官方依据（wiki.bambulab.com《打印机网络端口》✔，已抓取核对）

官方把端口分成三组，本表只列与本系统相关的行（原文分组如下）：

| 模式 | 用途 | 端口/协议 |
|---|---|---|
| 云模式 | HTTP API | 80 / 443 / 8080（TCP） |
| 云模式 | MQTT | 8883（TCP，连 `us.mqtt.bambulab.com` / `cn.mqtt.bambulab.com`） |
| 云/局域网共用 | 设备发现 | 1990 / 2021（SSDP，multicast/broadcast） |
| 云/局域网共用 | NTP | 123（TCP/UDP） |
| **局域网模式** | **LAN MQTT** | **8883（TCP）** |
| **局域网模式** | **LAN FTP** | **990、50000~50100（TCP）** |
| 局域网模式 | LAN 视频 | 6000（TCP） |

官方页原文要点（引号内为页面原话）：
- 「当打印机处于局域网模式时，所有域名/IP地址都是无用的」——局域网模式下打印机不依赖任何云域名，可整机断外网自包含。
- 「域名/IP地址在未来可能会被改变」——云侧地址不保证长期不变。

官方对第三方的接入通道（△ 检索结果，未抓正文）：**Fleet Hub 开发者中心**（企业授权，创建设备激活 Key、签发客户端证书、提供 API 文档与示例代码，商务邮箱 `devpartner@bambulab.com`）；面向个人的 Cloud API / LAN API 开发文档官方未公开。

### 1.2 接入要素与获取步骤

| 要素 | 说明 | 本系统对应 |
|---|---|---|
| 局域网 IP | 打印机与机器人同一网段；可用官方发现端口（SSDP 1990/2021）或打印机屏幕「网络设置」查看 | `.env` `PRINTER_HOSTS` |
| Access Code | 8 位数字，打印机屏幕「设置 → 网络 → 局域网模式/开发者模式」下显示；社区经验：约 3 个月过期需重取 | `.env` `PRINTER_ACCESS_CODES` |
| 序列号 SN | 打印机「关于」页/Bambu Studio 可见；MQTT topic 与 TLS 登录名的组成部分 | `.env` `PRINTER_SERIALS` |
| 机型 | 决定文件上传通道（见 1.4） | `.env` `PRINTER_MODELS` |

获取步骤（官方操作口径 + 社区注记）：同网段 → 打印机屏幕开启局域网模式（LAN Only / 开发者模式）→ 记录屏幕显示的 IP 与 8 位 Access Code → 填入 `.env` 四列数组（`src/config.js:9-22` 按位置对齐）→ 重启服务，`manager.js` 自动建连（见 4.2）。

### 1.3 MQTT 协议事实（社区标准；本仓库 `node_modules/bambu-link` 源码已核 ✔）

| 项 | 事实 |
|---|---|
| Broker | 打印机本机，`mqtts://<host>:8883`，MQTT over TLS（自签证书，客户端跳过校验 `rejectUnauthorized: false`） |
| 用户名/密码 | 用户名固定 `bblp`，密码 = Access Code |
| Topic | 状态上报与命令收发共用 `device/{serial}/report`（bambu-link 订阅与 publish 同一 topic；社区文档中另有多实现把命令发到 `device/{serial}/request` 的写法，两套对固件均兼容） |
| 建连后首帧 | `{"pushing":{sequence_id, command:"pushall", version:1, push_target:1}}` 拉全量状态（bambu-link `dist/index.js:865-870`，sequence 自 10 起） |
| 后续数据 | 打印机持续推送增量状态 JSON（print/temps/ams/network 等分段） |
| 命令回包 | 命令帧带 `sequence_id`，回包中回显（`print.sequence_id` / `system.sequence_id`），按序号匹配挂起命令；超时默认 10s（bambu-link `dist/index.js:479,564-598`） |
| 命令类型 | 打印 3mf：`project_file`；打印 gcode 文件/控制：`print`（`print_gcode_file` 等）；`pause` / `resume` / `stop`；拉全量：`pushall` |
| 重连 | `reconnectPeriod: 5000ms`（bambu-link `dist/index.js:836`） |

> 注：1.3 全部内容均为社区协议事实，**官方未公开过上述字段级文档**；以官方 wiki 端口表佐证「8883 = LAN MQTT」这一点与社区一致。

### 1.4 文件上传通道（本系统现状 + 与官方表差异注记）

- 官方端口表将局域网 FTP 记为 **990 + 50000~50100**（FTPS，TLS 加密数据口），未区分机型。
- 本系统现状（`src/printer/client.js` `uploadBuffer`）：**全机系统一 FTPS:990 优先（implicit TLS）、FTP:21 回退兼容老固件**——「X1/H2D → SFTP:22」老假设已作废（见 §1.4 勘误）；凭证同为 `bblp` + Access Code。
- **2026-10-07 实测批（4A 隔离区两台 P1 系真机，云模式+局域网端口集并开）**：两台 990/8883/6000 常开、**21/22 明文/SSH 口全部 REFUSED**——新固件已砍社区明文通道，官方 990 FTPS（vsFTPd 3.0.5，TLSv1.2）为唯一文件通道；本系统同批从 node-ftp（无 TLS）引入 `basic-ftp` 实现 `ftpsPut`，21 回退保留。**历史注记**：此前版本仅走 22/21 社区通道（当时实机可用）；22/21 不在官方端口表内属社区实现事实，官方 990 通道现为首选。

---

=帧），跨内容类型跳字节会把响应文本当垃圾吃掉。

## 2. 闪铸 FlashForge（AD5M / AD5X 系）：局域网接入

> 本节素材核验程度：官方部分为检索到的官方页面条目 △（未逐一抓取正文，仅确认存在与大意）；协议部分为社区资料条目 △。引用时注意。

### 2.1 官方口径（△）

闪铸没有面向第三方的局域网 API 开发文档；官方对局域网的使用说明只覆盖「绑定官方切片软件」：
1. 打印机与电脑/服务同网段；
2. 打印机开启**局域网模式（LAN Mode / LAN Only）**；
3. 在打印机「网络设置」中查看屏幕显示的 **Printer ID**（社区资料亦称 8 位 Check Code；绑定失败可刷新重取）；
4. 在 FlashPrint 5（老机型）或 **Orca-FlashForge**（5M/AD5X 新机型）中自动扫描或手动填 IP，输入 Printer ID 完成绑定。

来源条目：flashforge.jp 的 AD5X LAN 连接 FAQ、uk.flashforge.com「5M Series Printing Tips」、wiki.flashforge.com FlashPrint 5 连接说明（△）。

### 2.2 社区协议事实（△，Parallel-7/flashforge-api-docs 等；固件 3.2.x 验证）

| 端口 | 用途 |
|---|---|
| **8898 HTTP** | 主通道：JSON 请求/响应（状态查询与绝大多数控制） |
| **8899 TCP** | 低层文本协议口（G/M-code 级，社区库做查询/兜底） |
| **8080 HTTP** | 摄像头 MJPEG 流（Pro 机型） |

- **序列号获取（2026-10-16 A5P 真机实测）**：8899 文本口**免认证**发送 `~M115` 即回 Machine Type / **SN**（本次实得 `SNMOMF9302026`）；`~M601 S1` 回「Control Success」开着控制会话。8898 需 `serialNumber`+`checkCode` 双字段（checkCode=屏幕「设备ID」，8 位十六进制；SN 错报 `{"code":1,"message":"SN is different"}`；非局域网模式机器回 `{"code":-2,"message":"Lan mode error"}`——可借此区分同网段多台闪铸）。
- **认证**：请求体携带 `serialNumber` + `checkCode`（每台打印机专属，屏幕「网络设置 → 局域网模式」下显示，社区提示会过期）。
- **端点样例**：`/detail`（状态详情，**状态靠轮询获取，无事件推送**）、`/product`（能力位：`lightCtrlState` 等——文档提醒**不可靠**，有硬件也可能报 0、无硬件也可能报 1）、`/gcodeList`、`/gcodeThumb`、`/uploadGcode`、`/printGcode`、`/checkCode`、`/control` 等。
- **/control 命令信封（2026-10-16 A5P 真机实证，协议级）**：payload **必须是 `{"cmd":"<命令名>","args":{...}}` 结构**——旧式「`{"<命令名>":{...}}`」会被固件当未知命令名**静默忽略且仍回 `{"code":0,"message":"Success"}`**（文档原话：An unknown command name is ignored and still answers Success；本次实证：旧形态灯控回 Success 但灯零动作——「按钮点了没反应」的根因）。认证失败可区分：错 checkCode 回 `{"code":1,"message":"Access code is different"}`。核验过的命令：`jobCtl_cmd`（jobID+action: pause/continue/cancel）、`lightControl_cmd`（status: open/close）、`stateCtrl_cmd`（action: `setClearPlatform`——打印完成/取消后的屏幕弹窗**会挡后续控制**，清屏=屏幕上点掉弹窗）、`streamCtrl_cmd`（action: open/close）。
- **摄像头流（2026-10-16 A5P 真机实证）**：5M Pro 内置摄像头**需先 `streamCtrl_cmd open` 才出流**——开流前 8080 端口 TCP 通但 HTTP 零响应（此前「画面不可用」根因）；开流后 `http://<ip>:8080/?action=stream` 正常吐 `multipart/x-mixed-replace` MJPEG 帧（代理层已接线：进端点自动开流、最后观看者断开自动关流）。
- **灯控实测边界（2026-10-16）**：`lightControl_cmd`（含 cmd/args 正确形态）在 A5P 固件 5.1.9 + 当前「已完成待清屏」状态下**被受理但不动作**（`/detail lightStatus` 恒 open、摄像头帧亮度零变化，多形态 swept）；`/product lightCtrlState=1` 报告可控。**待现场验证**：屏幕弹窗清掉后重试灯控是否生效（弹窗挡控制是文档明示行为）。
- **/control 其余命令**（`printerCtl_cmd` 速度/风扇/`circulateCtl_cmd` 过滤风扇/`temperatureCtl_cmd` 等）：社区文档所载，本项目未逐条核验。
- 社区实现仓库（Python/TS/HA 集成）均基于对 **Orca-FlashForge 局域网流量**的逆向，无官方 SDK。

### 2.3 拓竹 vs 闪铸：架构差异对照

| 维度 | 拓竹（Bambu Lab） | 闪铸 AD5M 系 |
|---|---|---|
| 连接形态 | 推送式 MQTT 长连接（打印机即 broker） | 无状态 HTTP 轮询（+TCP 文本口兜底） |
| 状态获取 | 订阅即推送，秒级主动回流 | 周期轮询 `/detail` 类端点 |
| 命令通道 | 同一 MQTT 帧流，按 `sequence_id` 回包 | HTTP 请求/响应（命令名带 `_cmd` 后缀） |
| 认证 | `bblp` + 8 位 Access Code（屏幕） | `serialNumber` + `checkCode`/Printer ID（屏幕） |
| 文件上传 | X1/H2D SFTP:22；P1/A1 FTP:21（社区）；官方表 990 FTPS | HTTP `/uploadGcode` 类端点 |
| 局域网模式开关 | 屏幕「局域网模式/开发者模式」 | 屏幕「LAN Mode / LAN Only」 |
| 官方开发者文档 | 无个人级；企业走 Fleet Hub（证书体系） | 无 |

**对本系统的含义（现状结论）**：拓竹的推送架构恰好匹配本系统「空闲即分发 + 任务变迁播报」的事件驱动模型；闪铸若接入需把状态回流从「事件推送」改为「定时轮询」并新增一套 HTTP 客户端与上传适配，模型与现有 `jobEvent` 驱动链不兼容，属新工程（本文不展开方案）。

---

## 3. 当前系统逻辑链路总图（现状：仅拓竹 LAN 直连）

```
【上游 · 预约审批】 页面提交 → 本地存储（reservationStore）→ 审批端点 approve → enqueue 入队（reservation.js:105）
      │  （2026-10-05 路线 A 断飞书审批链：审批事件转发与 POST /api/feishu/event 退役，遗留文件随 v46 删除）
      ▼
【分发引擎 dispatcher】（src/services/dispatcher.js）
      enqueue（幂等：known/queue 双查，dispatcher.js:236-254）→ 触发匹配 trigger/match
      匹配：指定打印机优先 → AMS 材料类型精确/家族 + 颜色 redmean 近似 → 加急优先
            （dispatcher.js:334-389）；打印机空闲（jobEvent idle）同样触发（bindPrinterEvents :117-128）
      ▼ 匹配成功
【执行分发 dispatch】（dispatcher.js:418-525）
      ① 取 3mf：本地源读上传件（isLocalTask，现行主流）；历史审批源走 downloadApprovalAttachment（不写预约镜像表）、镜像源 downloadFile（loadTaskFile dispatcher.js:81-89）
      ② 上传：printerManager.uploadFileToPrinter → /sdcard/print_{recordId}.3mf
             X1C/H2D → SFTP:22；P1/A1 → FTPS:990 优先、FTP:21 回退（client.js:285-306，2026-10-07 实测新固件 21 明文口已关）
      ③ 下发：startProjectOnPrinter → MQTT project_file 帧（高段位 sequence_id，client.js:216-235）
      ④ 登记 printing[printerId]=task、updateState activeTask（dispatcher.js:467-468）
      ⑤ 群播报「开始打印」卡片
      ┆ 失败：回滚/重新排队，maxRetries 上限后退出队列转人工（dispatcher.js:487-525）
      ▼
【打印机 LAN 通道】（src/printer/client.js + node_modules/bambu-link）
      MQTT mqtts://<ip>:8883，bblp + Access Code
      topic device/{serial}/report：pushall 全量 + 增量状态 JSON（命令也 publish 到同一 topic）
      文件通道：SFTP:22 / FTP:21 → /sdcard/
      ▼
【状态回流】（src/printer/manager.js）
      state/stateUpdate → handleStateChange（manager.js:99-135）
      gcodeState 归一化（IDLE/PRINTING/PAUSE/FINISH/FAILED…，client.js:6-15）
      → updateState 内存 printerStates（statusChange 事件，展示/查询用）
      → 关键变迁 jobEvent（start/finish/failed/idle，manager.js:121-134）
      ▼
【下游动作】
      finish → completeTask：清映射、播报完成卡片、触发下轮匹配（dispatcher.js:527-545）
      failed → failTask：写回队列态、播报失败卡片（dispatcher.js:547-598）
      idle   → 下一轮匹配（新任务自动上机）
      每 60s → 打印机状态镜像表 upsert（manager.js:256-297, 308-310，仅展示）
【控制面（仅 HTTP，无聊天指令）】POST /api/printers/:id/{print,pause,resume,stop}（index.js:228-276）
      取消任务（dequeue → stopPrint）是引擎内唯一控制调用（dispatcher.js:256-266）
```

---

## 4. 逻辑链路逐段说明（文件:行号）

### 4.1 配置载入：`.env` → printers[]

- 四列逗号分隔数组按位置对齐成 `printers[]`：`src/config.js:9-22`（`PRINTER_HOSTS / PRINTER_ACCESS_CODES / PRINTER_SERIALS / PRINTER_NAMES / PRINTER_MODELS`），`id` 从 1 起；默认 model 兜底 P1S（`config.js:18`）。
- 分发相关参数：材料/颜色字段名、颜色近似阈值、对账/缺料提醒间隔、`useAms`、重试上限与冷却（`config.js:92-110`）；审批主通道开关 `approval.enabled`（`config.js:112-125`）。

### 4.2 常驻连接：模块级单例，require 即连

- `manager.js:306` 模块级 `new PrinterManager()`——**任何 require `printer/manager` 的模块都会触发初始化**，初始化即建连（`init` `manager.js:19-55`）。
- 自动分发白名单 `isAutoDispatchable`（X1/H2D/P1/A1，`manager.js:6-9`）：白名单外机型（如闪铸 AD5M）**不建 PrinterClient、不连接**，仅登记为状态条目并打日志（`manager.js:38-41`）。
- 多台错峰连接：`printer.id * 2000ms` 延迟（`manager.js:51`）；连接失败置 `status: 故障`（`manager.js:57-70`）。

### 4.3 MQTT 会话与状态归一化

- `client.js:42-48`：`new BambuLink(accessCode, host, 0, 8883, serial)`；库内真实连接参数见 1.3（`node_modules/bambu-link/dist/index.js:833-843`）。
- 事件转发：`connect/disconnect/state/stateUpdate/error`（`client.js:50-75`）。
- 状态归一化以 **gcodeState** 为准（`job.stage` 是数值型判不准，`client.js:129-151` 注释）；gcodeState → 中文状态映射表 `client.js:6-15`。
- **剩余时间单位注记**：`mc_remaining_time` 单位是分钟，bambu-link 误命名为 `remainingSeconds`，勿再除以 60（`client.js:144`）。
- AMS 耗材清单：`existBits` 判定槽位实装、`trayNow` 判活跃、`vtTray` 含外部料架（`client.js:157-195`）。

### 4.4 状态事件分级（manager）

- `handleStateChange`（`manager.js:99-135`）：先 `updateState` 全字段刷新（仅变化时发 `statusChange`，`manager.js:142-151`）；再按 gcodeState 变迁发 `jobEvent`——PRINTING（非 RESUME 而来）→ `start`、FINISH → `finish`、FAILED → `failed`、**任何非空闲态 → IDLE 均发 `idle`**（2026-10-16 起；含 FAILED→IDLE「屏幕消除故障态」恢复路径——此前仅认 PRINTING→IDLE，导致恢复后队列静默卡死）。
- `jobEvent` 只被 dispatcher 消费（`bindPrinterEvents`，`dispatcher.js:117-128`）；`statusChange` 供查询接口/页面使用。

### 4.5 分发引擎（dispatcher，单例 `dispatcher.js:728`）

- 启动 `start`（`dispatcher.js:87-115`）：主通道开启（`approval.enabled` 默认 true）时**关闭预约镜像表对账**（防重复入队），仅靠事件秒级驱动；主通道关闭时退回分钟级对账兜底（`reconcile` `dispatcher.js:206-231`，幂等补漏 + 重启后恢复打印中映射）。路线 A 后事件链已退役，现行入队来自本地审批端点（approve → enqueue），该开关现仅控制旧镜像对账兜底是否运行。另有**队列兜底扫描**（2026-10-16）：队列非空时每 60s 补一轮匹配 trigger——事件缺失/恢复无事件时防卡死。
- 队列与幂等：`queue + known Set + printing Map`；入队三查（known/queue）防事件与对账重复（`dispatcher.js:236-254`）。
- 匹配串行化：`matching` 锁 + 完成后按需 `setImmediate` 重跑（`trigger` `dispatcher.js:274-296`）；队首匹配不到不阻塞后续任务（`findAnyMatch`），全队列缺料才发缺料提醒（节流 `materialRemindMinutes`，`dispatcher.js:399-413`）。
- 分发执行链（`dispatch` `dispatcher.js:418-525`）：见总图；失败处理为「回滚表状态 → 重试计数 → 冷却 `nextMatchAt` → 重新入队 → 冷却后定时再触发」，达 `maxRetries` 退出队列并发人工介入卡片（`dispatcher.js:487-525`）。
- 完成/失败：`completeTask`（`dispatcher.js:527-545`）、`failTask`（`dispatcher.js:547-598`）——清 `printing` 映射与 `activeTask`、非审批源写预约镜像表状态、播报卡片、触发下轮。
- 取消：`dequeue`（`dispatcher.js:256-266`）对打印中任务调用 `stopPrintOnPrinter` 停机并释放映射。

### 4.6 事件入口（index.js）

- `POST /api/feishu/event`：**已随 2026-10-05 路线 A 退役，v46 删除端点与 `eventSubscription`/`approvalService`**——审批实例/审批任务/表格事件/聊天消息事件消费整链下线，本服务不再消费任何飞书事件（原 `index.js:278-355` 链路描述作废）。
- `POST /api/chat/command`（`index.js:636`）：`{command,args}` → `{reply}`，回复由网关代发；`/print-status` 对非自动机型标注「仅登记，分发需人工」。
- HTTP 控制端点（`index.js:228-276`）：`POST /api/printers/:id/{print,pause,resume,stop}`（print 需 body `filePath`），透传 manager → client → MQTT 帧。**项目内无聊天指令对应**，供外部/人工调用。

### 4.7 群播报与镜像表

- 播报：入队/开始/完成/失败/缺料/人工介入卡片（`src/feishu/bot.js` 的 `buildQueueCard/buildJobStartCard/buildJobFinishCard/buildJobFailedCard/buildMaterialMissingCard`）→ 群自定义机器人 webhook（`.env` `BOT_WEBHOOK_URL`）。
- 镜像表：每 60s `syncPrinterStatusToBitable`（`manager.js:256-297` + `setInterval` `manager.js:307-309`）把全部登记打印机 upsert 到飞书打印机表（printerName/model/ipAddress/status/currentJob/progress/temperature/lastUpdate）；未配 `BITABLE_PRINTER_TABLE_ID` 时静默跳过。**注意**：审批源任务不回写预约镜像表（那是审批系统数据，`fileSource !== 'approval'` 守卫 `dispatcher.js:533`、注记 `dispatcher.js:636`），追踪在引擎内存完成。

### 4.8 闪铸等非自动机型的现状路径

登记展示（`manager.js:38-41`）→ `/print-status` 标注仅登记 → 人工分发 `POST /api/dispatch/manual`（页面黄条/运维台，reviewer+）指定非自动机型时只把单子标回排队中并返回 `manualOnly: true`，提示用厂商工具上传（`dispatcher.js:995-1010`；`/print-dispatch` 聊天指令已于 2026-10-05 移除，聊天通道仅查看类指令）。**本系统对闪铸没有任何网络协议代码**（`.env.example` 中 `闪铸AD5M`/`ADVENTURER5` 仅为登记示例）。

---

## 5. 实现参数 × 官方 × 社区：一致性对照与风险注记

| 项 | 本实现 | 官方 | 社区事实 | 结论/注记 |
|---|---|---|---|---|
| 局域网 MQTT 端口 | 8883 | ✔ 8883（LAN MQTT） | 8883 | 一致 |
| MQTT 用户名 | `bblp` | 未公开 | `bblp` 通用 | 社区约定 |
| 密码 | 屏幕 8 位 Access Code | 屏幕取码（操作口径） | 通用 | Access Code **可能过期**（社区经验约 3 个月），需重取并更新 `.env` 重启 |
| TLS | mqtts 自签、跳过校验 | 未公开细节 | 通用 | 固件若升级（社区注记：2025-01 后部分固件要求 X.509 证书/认证演进），连不上先查固件与库版本 |
| MQTT topic | 订阅与发布同一 `device/{sn}/report` | 未公开 | 另有 request/report 分流写法 | 当前库实机可用；换库/换固件需回归验证 |
| 拉全量 | `pushall`（`version:1, push_target:1`） | 未公开 | 通用 | — |
| 文件上传 | **全系统一 FTPS:990（implicit TLS）→回退 FTP:21**（v56 起；旧「X1/H2D SFTP:22」假设作废） | ✔ 官方表记 LAN FTP 990+50000~50100（FTPS） | 多通道并存 | 2026-10-07 P1 实测 + **2026-10-15 H2D 实测：两代机型 21/22 全关、990 唯一通道**；本系统 basic-ftp 走 990，21 回退兼容老固件；SFTP 代码保留备查 |
| 命令帧 | `project_file`（`url: ftp:///sdcard/…`）/ print / pause / resume / stop | 未公开 | 通用 | `url` 用 `ftp:///` 字面量是社区标准写法（`client.js:214` 注释） |
| 画面 | X1/H2D RTSPS :322 digest 认证（v55 rtsps.js 自研）；P1/A1 TCP6000 裸 H.264 | 未公开（官方表记 LAN 视频 6000，未提 322） | `rtsps://bblp:<码>@ip:322/streaming/live/1`（SimplyPrint / BambuStudio#1536 口径） | 2026-10-15 真机 H2D 实测全通；见 §1.5 |
| 控制面 | MQTT 帧全集：pause/resume/stop/ledctrl/speed/setFanSpeed(M106)/gcode_line/calibration/home/move/unload_filament/project_file | 未公开 | OpenBambuAPI 等 | v55 起全量暴露为 HTTP 端点（分级权限+状态门控），观察台控制面板消费 |
| 状态判定 | `gcodeState` + `job`/`temps`/`ams` 字段 | 未公开 | 通用 | 依赖库内字段名（如 `remainingSeconds` 实为分钟，见 4.3） |

风险注记汇总：
1. **Access Code 过期**：重取需人工上机操作，社区经验约 3 个月；过期症状为 MQTT 认证失败（`[打印机] xxx 已断开/连接失败` 且无状态回流）。
2. **固件与库演进**：协议无官方承诺，bambu-link 为第三方库（本项目锁 1.1.0），固件侧 2025-01 后存在证书/认证演进社区注记；升级任一侧需回归「连接 → 全量 → 分发 → 完成」全链。
3. **单 topic 收发**：命令与上报共用 report topic，依赖固件对「report 上收命令」的兼容行为（bambu-link 实现事实）。
4. **闪铸接入成本**：无官方 API 文档 + 轮询式架构 + 需自研 HTTP/上传适配（见 2.3），与现有事件驱动链不兼容，接入前需单独立项评估。

---

## 6. 参考资料清单（查证日 2026-09-06）

**官方（拓竹）**
- ✔ [Bambu Lab 官方 wiki《打印机网络端口》](https://wiki.bambulab.com/zh/general/printer-network-ports)——云/局域网模式端口表（8883 MQTT、990 FTP、SSDP 1990/2021 等）与局域网模式说明。
- △ [Bambu Lab Fleet Hub 开发者中心](https://bambulab.com/zh/fleet-hub/developer) 及[开发者协议](https://bambulab.com/zh/fleet-hub/developer/develop-agreement)——企业级第三方接入通道（设备 Key/证书/本地 HTTP API），个人级 LAN API 文档不存在。

**官方（闪铸）**
- △ flashforge.jp AD5X 局域网（LAN Only）连接 FAQ、uk.flashforge.com「Flashforge 5M Series Printing Tips」、wiki.flashforge.com FlashPrint 5 连接说明——「局域网模式 + 屏幕 Printer ID + 官方切片软件绑定」操作口径；均无 API 开发文档。

**社区（协议事实标准，非官方）**
- ✔ `node_modules/bambu-link`（本仓库依赖源码，已核：mqtts 8883 / `bblp` / 单 report topic / pushall / 10s 命令超时）。
- △ [Doridian/OpenBambuAPI](https://github.com/Doridian/OpenBambuAPI)——拓竹局域网协议文档化仓库。
- △ [Parallel-7/flashforge-api-docs](https://github.com/Parallel-7/flashforge-api-docs)——闪铸 AD5M 系局域网 HTTP/TCP 协议文档（8898/8899/8080、serialNumber+checkCode、端点与命令清单）。
- △ GhostTypes/ff-5mp-api 系、schwarztim/bambu-mcp 等社区实现条目（检索摘要引用，未逐一抓取正文）。
