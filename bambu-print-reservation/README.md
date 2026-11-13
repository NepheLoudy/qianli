# bambu-print-reservation · 拓竹 3D 打印自动分发系统

页面预约 + 拓竹打印机（MQTT/SFTP/FTPS）全自动分发：切片产出 3mf → 页面提交（源文件+需求标签）→ 页面审批 → 按 AMS 耗材自动选机 → 上传并开始打印 → 全程群播报。

> **新队员从这里开始**：要用平台（提交/审批/取件）看 [USER-GUIDE.md](USER-GUIDE.md)（使用手册）；要改代码看 [ONBOARDING.md](ONBOARDING.md)（开发手册）。本文是功能与 API 参考手册。

> **架构转向（2026-10-05 路线 A）**：断开飞书审批链，转为**自建前后端**——浏览器页面（本服务同源伺服 `public/index.html`）提交预约（源文件上传 + 需求标签勾选）、页面审批（X-API-Token 口令），预约真相源为本服务本地存储（`RESERVATIONS_STORE_FILE`）；多维表格镜像/审批实例事件/自动审批/对账自愈整链退役（`approvalService.js`/`eventSubscription.js` 已随 v46 遗留清理删除，`/api/feishu/event` 端点删除）。飞书仅剩**群 webhook 播报**（通知通道，非数据依赖；`BOT_WEBHOOK_URL` 清空即静默）与 `/api/chat/command` 查询指令入口。需求标签池 + 工艺映射规则库（下两节）为自动切片铺路。

## 自动分发模式（v86+，DISPATCH_AUTO=true 开启）

提交 → 硬冲突/程序初审照拦 → **自动通过入队**（审批人记「自动分发」）→ 机型学习选机（同型号优先：无闸机优先（v105）→ 历史成功率 → 最近使用；持闸机（等取件回执）在同型号内有空闲兄弟机时让位、仅有持闸机时照选入队排队（闸摘自动开打）；无同型号**不做跨型号降级**（2026-11-05 修复，v65 品牌族降级是逻辑死路已废），noSameModel 原因由提交链播报给申请人）→ 耗材槽位评分（匹配分级/颜色距离/槽位历史/余量）→ 自动切片开打。审批台降级为**复核干预面板**（三段视图：自动选机失败转人工/进行中改派取消/最近处理）。学习信号全部来自预约记录（零新存储）；失败归因报告（failCode × 参数分布）随模型卡透出。

## 单据总览（v91+，审批台全量管理）

审批台「最近处理」升级为**单据总览**——全量单据统一管理窗口：服务端分页（`GET /api/reservations` 带 `page/pageSize/status/q/from/to/sort` 参数返回 `{records,total,page,pageSize}`，不带参保持旧数组形态向后兼容）、7 状态筛选、关键词搜索、详情弹层（完整轨迹）、行内复刻/取消、「复刻自 Rxxx」血缘徽标（复刻单持久化 `sourceRecordId`，源单记「被复刻」轨迹，链式复刻指向直接源）。

## 工作流

```
浏览器页面（public/index.html）提交：源文件(stl/step/3mf) + 材料/颜色 + 需求标签勾选
   ↓ 提交即过规则引擎（applyRules）定档切片参数并快照存档；硬冲突当场打回
   ↓ 审批人在页面审批（X-API-Token）→ 通过即入队（本地任务 fileSource=local）
   ↓ 打印机空闲触发匹配
   ↓ AMS 装料匹配：材料类型(精确→家族) + 颜色(redmean 近似)
   ↓ 本地文件读取 → SFTP/FTPS 上传打印机 /sdcard/ → MQTT project_file 下发
   ↓ gcodeState 变迁监听：开始/完成/失败 → 群 webhook 播报
```

> 多维表格不再是数据面（打印机状态写表已停用）；需求标签体系与规则库见下两节，为「上传 STEP/STL 自动切片」铺路。

## 打印机支持

| 机型 | 接入方式 | 自动分发 | 画面 |
| --- | --- | --- | --- |
| X1C / H2D | MQTT 8883 + SFTP 22（bblp + Access Code），AMS 完整 | ✅（3mf） | RTSP（代理待接） |
| P1 / A1 | MQTT 8883 + FTPS 990（FTP 21 回退；2026-10-07 实测新固件 21 明文口已关） | ✅（3mf） | TCP 6000 H.264（WS 中继 + WebCodecs，v53） |
| 闪铸 5M/5M Pro（AD5M 系） | HTTP REST 8898（LAN Only 模式；serialNumber+checkCode 认证，复用 PRINTER_SERIALS/PRINTER_ACCESS_CODES） | ✅（.gcode.3mf，分发链提内嵌 gcode 直发；纯 .gcode/.gx/.g 已拒收，2026-11-06） | 8080 MJPEG 代理（v53） |
| 闪铸 Creator 5 Pro（四喷头） | 按 5M 兼容实现，协议社区未覆盖——真机以 /debug rawState 校后修 | ✅（.gcode.3mf 同 5M 口径，待真机验证） | 同上 |

- **文件格式↔品牌隔离（v53）**：拓竹吃 Bambu Studio 3mf、闪铸吃 FlashPrint/Orca（闪铸 profile）切片产物——切片格式互不兼容，分发匹配按**内嵌机型指纹**隔离（切片文件内嵌 printer_model 优先，扩展名仅兜底），跨品牌机不可见；提交口径两品牌统一 .gcode.3mf（纯 .gcode/.gx/.g 一律 400 拒收，2026-11-06 曼波令终裁）。
- **纯内网形态（2026-10-14，4A 拔线批）**：打印机区 192.168.2.x 经 4A 上行主网（wan 拔线=无云），机器人（31.57）经静态路由 192.168.2.0/24→192.168.31.98 直连打印机 LAN 端口；拓竹本地端口（8883/990/6000）云模式/LAN 模式均常开（10-07 实测），闪铸需在屏幕开「LAN Only 模式」。主网设备看画面/观察台走本服务代理（/status.html），无需自身加路由。
- **状态观察台（v53）**：`/status.html`——机队卡片（状态/进度/温度/AMS 槽位盘）+ 画面（闪铸 MJPEG、拓竹 WebCodecs）+ 指令条（暂停/恢复/腔灯/停止，admin）。

## 指令（群内 @对话型机器人 或经网关转发）

| 指令 | 说明 |
| --- | --- |
| `/print-help` | 显示帮助（`/help` 同效） |
| `/print-status` | 打印机状态 + AMS 耗材 + 当前任务进度 + 等待队列 |
| `/print-ams` | 所有打印机装载耗材明细 |
| `/print-list` | 全部预约记录 |
| `/print-pending` | 待审批预约 |
| `/print-bind` | 飞书自助绑定（2026-10-29）：网页生成 6 位绑定码 → 飞书发 `/print-bind 码`，绑定后打印完成/失败/取消/驳回等进程事件私信到本人 |
| `/print-pickup` | 取件回执（2026-10-29）：打印完成私信带 6 位取件码，回 `/print-pickup 码` 即确认取件+清机端残留，等价网页「确认取件」按钮 |

> 指令收窄（2026-10-05）：聊天通道仅保留**查看类**；提交/审批/人工指定分发请用打印预约页面（人工恢复 `POST /api/dispatch/manual`，reviewer+）。

播报（webhook 群机器人）：新预约通知、入队、打印开始/完成/失败、缺料提醒（30 分钟节流）——路线 A 下播报仍走群机器人 webhook（`BOT_WEBHOOK_URL` 清空即静默）；打印进程事件（完成带取件码、失败/无法打印转人工、取消、审批结果）另走**申请人飞书私信（DM）回执**（v94 起；未绑定飞书账号静默跳过，页面状态可见，绑定走 `/print-bind`）。**晚间静默**：上述播报落在 02:00–09:00（`QUIET_HOURS_START/END` 可配、`QUIET_HOURS_DISABLED=1` 关闭）内时积压到 09:00 原样补发（打印机控制/写表不延迟，只有消息延后；/print-* 指令回复不积压），详见 `src/utils/quietHours.js` 与顶层 AGENTS.md「晚间静默」。

## 分发匹配规则（按序）

1. 打印机空闲（状态归一：空闲/已完成；FAILED 残留放行——新任务开打自动顶掉残留，2026-10-16）且过品牌隔离（拓竹/闪铸各自参与，跨品牌不可见）、排除回执闸（上一单取件确认前本机不开新件，2026-10-28）
2. 表单「指定打印机」优先
3. AMS 精确材料匹配 + 颜色近似（ΔE 阈值可配）
4. 家族匹配（PLA-CF ↔ PLA）
5. 加急优先出队，队首缺料不阻塞后续任务

> **排队池语义（v99/v105）**：同型号机都在等取件回执（挂闸）时，本单照常入队排队——取件确认或 TTL 超时（`DISPATCH_RECEIPT_TTL_HOURS` 默认 24h）自动放行后，下一轮匹配自动开打。

## 分发互斥（2026-09-13）

人工指定打印机（页面/运维台 → `POST /api/dispatch/manual`）与自动匹配共用**按打印机的分发闸门**：dispatch 的下载/上传/下发是分钟级 await 链（占用登记在链尾），闸门在入口同步判定——分发中的打印机对自动匹配不可见、对人工指定回「正在有任务分发中，请稍候再试」；失败/重试路径由 finally 释放，闸门刻意不持久化（崩溃后清零重新评估，残留锁才危险）。

## 多维表格与审批表单字段

材料/颜色/指定打印机原为**官方审批表单字段**按标题关键词自适应解析——该链路已随路线 A 退役（现走页面表单提交，`taxonomy.selectionFromFormFields` 保留为表单字段形态转换工具）；`scripts/add-dispatch-fields.js` 仅对旧版表格直提交流程有意义。
状态流转：`待审批 → 已通过/已驳回 → 排队中 → 打印中 → 已完成`（分发失败回滚「排队中」重试；任意时刻可 `已取消`）。

> **文档权限**：需在飞书中把应用「爆米花机」添加为该多维表格的**可编辑协作者**，否则写状态会报 91403。

## 事件链路（qianli 架构）

本服务不消费任何飞书事件——长连接只属于 feishu-gateway，审批实例/审批任务/表格事件转发链与 `POST /api/feishu/event` 端点已随路线 A 退役（遗留文件 v46 删除）；唯一指令入口 = hub 转发 `POST /api/chat/command`（查看类指令），群播报走 webhook。分发失败按 `DISPATCH_MAX_RETRIES` 次上限重试，每次间隔 `DISPATCH_RETRY_COOLDOWN_MS`，超限退出队列转人工；确定性失败（noRetry 标记，如工程 3mf 闸拦截，v100）跳过重试直接终局——重试也不可能成功。

## 定制窗口

`GET /api/print/policy`（只读全景）：打印机登记清单、审批主通道/自动审批/对账参数、分发匹配参数（颜色阈值/重试上限/冷却）、队列与打印中快照。运维台「功能激活」面板消费。

## 部署

```
npm run push
```

详见顶层 `.agents/skills/qianli-deploy/SKILL.md`。部署路径 `/c/qianli/opt/bambu-print-server`，pm2 进程 `bambu-print-server`，端口 3001。

## 可靠性与自愈（2026-09-13）

- **分发中断自愈**：进程在下载/上传链中途重启，恢复时中断任务重回队列完整重发（不静默丢单；若打印机已被上次尝试开打，重发会覆盖——比丢单可感知）；
- **printing 幽灵巡检**：每 10 分钟检查打印中任务——超过巡检阈值且打印机实况已空闲的任务补「已完成」收尾。阈值动态化（2026-10-08）：有打印机上报预估时长（start 时捕获 mc_remaining_time）按「预估×2 且 ≥1h」，无预估退回固定 12h；
- **回执丢失对账（reconcileLostAck，2026-10-16 起；v102/v103 强化）**：队列任务 × 打印机实况周期对账——机端实际在打同文件而引擎当它失败回滚的，补记「打印中」防同一文件二次开打；v102 幽灵在册互换（在册任务与机端实况不符却匹配队列另一单时，摘除在册回排队尾、给真在打任务让路）；v103 修复「只写 DB 不回内存队列」的引擎失踪（幽灵重排推回队列才名副其实）；
- **重启间隙完成补收尾（2026-10-08）**：finish 事件落在停机/重启窗口时，重启后首个 state 报文实况为 FINISH/IDLE 且引擎在册任务 → 立即补发 finish/idle 收尾（原实现要等 12h 巡检）；
- **状态文件损坏隔离（2026-10-08）**：分发状态/预约存储/账号存储损坏时坏文件改名 `.corrupt-<ts>` 留档再按空启动——不再静默覆盖，可人工抢救；
- **人工恢复通道**：自动重试耗尽的任务保留在 givenUp 列表（已随 v29 落盘持久化，重启不丢），页面黄条（reviewer+）一键「指定打印机恢复」（下拉选机，`POST /api/dispatch/manual`）；
- **复刻（2026-10-08）**：已完成单一键带参重提（`POST /api/reservations/:id/reprint`）——服务端复制源文件免重传，需求链路单按当前规则库重新定档，新单走完整审批流；
- 已知边界：审批取消落在分发链窗口内时打印仍会启动（取消与分钟级分发链的竞态，记录在案暂不修）。

## 状态持久化（2026-09-13 起）

分发引擎的**队列 / 打印中映射 / 已知记录 / 完成计数**落盘到 `DISPATCH_STATE_FILE`（代码默认项目根 `.dispatch-state.json`，生产 `.env` 配置为项目外数据目录 `C:/home/qianli/bambu-data/dispatch-state.json`——部署目标为 Windows 小电脑，路径带盘符）——进程重启（含部署 pm2 restart，SIGINT/SIGTERM 退出前强制冲刷）后自动恢复，**打印预约排队不再因重启丢失**。变更防抖 300ms 合并写入、临时文件原子改名；`known` 截尾 2000 条防无限增长；文件损坏按空队列启动（审批事件/对账可重新入队）。

## 需求标签池（taxonomy，2026-10-05 起）

「勾选 → 规则引擎 → 自动切片」体系的第一层词汇表：用户在审批表单勾选**需求标签**（载荷方向/受力类型/耐温等级/使用寿命……），由映射规则库（待建）翻译成切片参数，实现「上传 STEP/STL + 勾选项 → 自动切出合适的片」。设计口径见 DEVLOG 对话定稿：

- **四条铁律**：①每标签必须能回答映射到什么切片参数（`mapsHint` 强制非空）；②维度正交（方向×类型×性质拆分，组内单选/组间多选）；③默认不勾=常规件一键提交；④词汇表（`taxonomy.js`，`TAXONOMY_VERSION`）与映射规则库（`processRules`，待建，`rulesVersion`）分离，版本号独立；
- **受力参照系**：方向标签按**此件工作时的朝向**（Z=工作时竖直向上，可多选）——Z 向受力≈打印层缝方向（最弱），是规则引擎调朝向的依据；材料类型**可不填**（2026-10-05 曼波定）：勾选标签由规则引擎反推材料约束（materialExclude/materialPrefer 随单下发，分发匹配时对 AMS 实装料槽求值）；配合需求精简为间隙/过盈/精密（去过渡配合）；连接方式含「打印件自配合（插接/卡扣）」；份数仅在表单顶部（标签池不重复设）；
- **冲突双级**：`block`（表单端拦截，如耐温≥80°C×PLA、电气绝缘×CF 系——碳纤导电、长期静载×PLA 蠕变）/ `warn`（警告放行，如高速×外观件）；材料类冲突需提供材料字符串时才判定；
- **落地物**：`src/services/taxonomy.js`（标签池 v4：9 组 24 字段 + 7 条冲突规则；2026-10-11 增「几何体检（自动检测）」组——through_holes/overhang_heavy/curved_surface/small_footprint 四个 bool，由模型几何分析预勾选、用户可改；同批下架「收缩量要求」标尺 shrink_scale 及配套三条映射规则）、`validateSelection(selection, {material})`（校验）、`selectionFromFormFields([{title,value}])`（审批表单字段 → 标准化勾选，供 parseForm 后续接线）、`GET /api/print/taxonomy`（只读窗口：标签全景+映射提示+冲突规则，运维台展示与打标指南取数）；
- 测试：`node test/taxonomy-test.js`（21 项，已并入 npm test 与 push 闸门）。

## 工艺映射规则库（processRules，2026-10-05 起）

体系的第二层：标签勾选 → **切片参数集**。`src/services/processRules.js`：

- **参数白名单**（22 个，CLI 可消费的核心参数全集；2026-10-05 细化批新增顶/底面实心层数、支撑悬垂阈值角、支撑密度、裙边宽度、喷嘴温度Δ）：`directionStrategy/layerHeight/wallLoops/infillDensity/infillPattern/supportType/speedProfile/seamPosition/xyHoleComp/xyContourComp/ironing/brim/temperatureDelta/materialExclude/materialPrefer`；规则 `set` 引用白名单外参数、`when` 引用池外字段、缺 `reason` 一律拒收（可审计铁律）；
- **应用语义**：`BASELINE`（出厂默认）为底，规则按 `priority` 升序叠加，同名参数 priority 大者赢；标签级冲突不做二次裁判——`applyRules` 入口统一走 `taxonomy.validateSelection`，errors 非空即 `blocked`（含材料类冲突，需传 `material` 才判定）；出厂种子 28 条（2026-10-11 增几何体检四条，priority 60：孔特征→xyHoleComp -0.1 / 重悬空→supportDensity 30 / 曲面→阈值 40+precise / 小接触面→brim 5mm，让位显式外观/重载勾选）；
- **材料裁定**：`materialExclude/materialPrefer` 存 regex 源（如 `'^PLA'`），对材料字符串求值得 `materialVerdict`（选机匹配层消费；表单端 block 是第一道闸，此处是引擎端兜底）；
- **版本**：`rulesVersion` = 规则集内容 hash 短码，与 `taxonomyVersion`、baseline 版本、Bambu Studio 版本共同构成切片产物缓存 key 四件套；
- **窗口**：`GET /api/print/process-rules`（基线/白名单/规则集全景）；`POST /api/print/process-rules`（X-API-Token 鉴权，`{op:'upsert'|'remove'|'reset', rule?, id?}`，内存热改 + 原子写回规则文件）；
- **存储**：出厂种子规则内置代码（28 条，翻译自 taxonomy 各标签 mapsHint）；外部规则文件 `PROCESS_RULES_FILE`（默认项目根 `.process-rules.json`，生产配项目外数据目录，防 push 清目录丢失——同 `DISPATCH_STATE_FILE` 模式）；文件加载失败回退种子；
- 测试：`node test/process-rules-test.js`（21 项，已并入 npm test 与 push 闸门）。

## 学习链路（2026-10-05 第三批：「机器学人」落地）

`src/services/ruleSuggestions.js`（待审池）+ `src/services/slicerExtract.js`（3mf 提取）+ `src/services/modelFeatures.js`（STL 几何体检，2026-10-11）：

> **退役注记（v84 起）**：修正建议待审池（`/api/print/rule-suggestions*` 端点，含修正回路/审核闸门/采纳转正链）与「memorizeFit 记忆为规则候选」按钮（v92 删）已退役——数值参数学习由**参数智能层**承担（2026-10-30 v60/v61，见文末节），待审池自 v62 清理后已无前端生产者（`ruleSuggestions.js` 文件保留，`ruleFitter.js` 的 `median/expertOf` 由 paramModel 消费）。下述历史描述保留备查。

- **修正回路**：审批人/使用者在记录上点「建议修正」→ 编辑参数 + 填理由 → 自动携带该单勾选组合（`normalizeWhen` 归一化单据 selection 为规则 when 形态）入待审池；**相同 when+set 自动聚合计数**（高频修正浮顶，审核负担不随修正次数增长）；
- **冷启动（专家作品导入）**：上传专家手工切片 3mf → `extractFrom3mf` 解包（zip：`project_settings.config` JSON 优先 / gcode 头部注释兜底）→ Bambu 参数名映射白名单内核心参数（`%/枚举`清洗）→ 与 baseline 的 diff 即候选草稿 → 以页面当前勾选为条件提交待审池。⚠️ 映射表按 Bambu Studio 常见导出字段编写，首次真机导入以 raw 键值人工核对并校准；
- **几何体检（2026-10-11 模型特征自拟合）**：STL/3mf 提交前 `analyzeStl`/`analyze3mf` 分析裸网格（焊接索引 + 边表；3mf 解 `3D/Objects/*.model` XML，多零件逐件分析）——①通孔=拓扑亏格（genus，多体相加）+ 平面片边界环内环拟圆（Kåsa 最小二乘拿孔径，上下对合口去重）；②悬空=面法线与 -Z 夹角分带（贴底层不算悬空）+ 上半程悬端代理；③贴底接触面积/占地比；④曲面占比=总面积−显著平面片。映射为 taxonomy「几何体检」组 4 标签**预勾选建议**（只 true 不 false，用户可改），提交后照旧走规则引擎（几何数值不进规则 when，`validateRule` 池内校验不被打穿）；体检快照随单入档（`modelFeatures` 字段，学习回路将来吃「人工修正 vs 自动建议」差值）。能力边界：STL 二进制/ASCII + 3mf 工程文件（已切片 gcode.3mf 无对象网格只出参数）；>80MB 或单对象 >60 万三角面降级跳过；网格不闭合时孔数按圆口检出计并标注；壁厚/倒扣不做。规划中：STEP（B-rep 真特征：圆角/孔位精确）、几何预填与修正回路联动拟合；
- **服务端切片桥（2026-10-12 二批：今天跑通）**：`node scripts/slice-with-engine.js <stl> <out.gcode.3mf> --machine/--process/--filament <Orca档名> --params '{"layerHeight":0.2,...}'`——引擎参数档 → OrcaSlicer CLI（`ORCA_SLICER_EXE`，默认 `~/AppData/Local/Programs/OrcaSlicer/orca-slicer.exe`，v2.4.2 portable）→ gcode.3mf。**CLI 喂配置的五连坑**（全踩全修）：①vendor 档要沿 `inherits` 拍平（CLI 无 datadir 不解析继承）；②`type`/`name` 键必须显式补（Orca vendor 档没 type，CLI 按 type 分流，缺了静默跳过整档=裸默认）；③`from` 必须 `user`（system 档按名查 datadir 找不到即回退默认）；④machine 的 `inherits` 与 process 的 `compatible_printers` 必须指向同一身份（-17 拒切）；⑤Orca 改键名 `threshold_overhang_angle→support_threshold_angle`，百分比键（infill/supportDensity）必须带 `%`。已验证：引擎 6 项参数（层高/墙数/支撑阈值 40°/孔补偿 -0.1/支撑开/填充 20%）全部内嵌产物且改变切片行为（时长 38m58s→41m12s）。实测挂钩.stl 155 层 41 分钟，gcode 含 114 段 Support 树支撑特征。**已知边界**：无头环境无 OpenGL → 缩略图缺失 → CLI 退出码 1 但 gcode+slice_info.config 完整（结构=原生导出减 5 张 PNG）；曼波 Bambu Studio 02.08 打开 Orca 2.4.2 产物会弹「配置替换」（ensure_vertical_shell_thickness=ensure_all、ironing_pattern=rectilinear 是 Orca 方言新值，点确认即可，gcode 不受影响）；缺口：H2C 机器档 Orca 2.4.2 未带（用 H2D/X1C 代或自拷 vendor 档）、双挤出机耗材映射（--load-filaments 多文件）未通、中文文件名过 PowerShell 桥会乱码（先复制成 ASCII 名）；
- **批量识别压测（2026-10-11 二批，曼波纠偏：这不是训练）**：`npm run train [目录] [--commit]`（`scripts/train-from-models.js`，名字历史遗留）——扫目录模型文件全量过几何体检 + 3mf 参数提取，JSONL 数据集落 `C:/home/qianli/bambu-data/training/`（md5 去重；STEP/OBJ 记 pending 等 B-rep 批）。⚠️ **无人工工况标注时，这批数据只是「模型识别能力基准」**——「几何 when × 专家参数 diff」的配对只是识别输出与切片器 profile 的相关性（脚本会剥掉 ≥80% 同值的 profile 常量再展示，且 `--commit` 入池需人工复核），不构成监督样本。Downloads 首测：29 文件 → 60 对象识别（孔 42 / 悬空 22 / 曲面 25 / 小接触面 32 触发）+ 5 条配对展示（未入池）；
- **训练集录入工坊（2026-10-12 三批，曼波定：直上训练集）**：独立页面 `/train.html`（与预约页同款视觉，**无审批**——录入人即标注权威，删除留 reviewer+）。流程反转：交「模型（自动提几何特征）+ 已切片 3mf（自动提专家参数）+ 工况勾选（人工标注金标准）」→ 三方合成一条样本入库。样本 = `{model: 特征+文件归档, slice: 参数提取+文件归档, selection: 人工工况, spatial: 3D 空间标注, machine: 机型, fit: 拟合度, autoSuggestion: 几何自动建议, outcome: 打印结果}`。**拟合度条置顶**（2026-10-12 曼波纠正语义：引擎按工况算的参数 vs 专家切片参数的贴合程度 = 规则库覆盖缺口度量；差异项一键「记忆为规则候选」进待审池，`src/services/paramFit.js` 口径=只在专家声明键上评估、百分比/布尔归一化）。**3D 工况标注工房**（`public/annotator.js`，纯 WebGL）：模型 3D 渲染 + 工况工具排（悬空/受弯/受压/接触/外观/自由），点模型表面落空间标注存 `spatial`——人修正几何链路盲区的接口。**机型隔离**（多品牌机队 `.printer-fleet.json` 人工维护）：样本按 `machine` 归档，几何链路全机通用。存储：索引 `.training-samples.json`（`TRAINING_SAMPLES_FILE`）、文件归档 `bambu-data/training/files/`（>80MB 只记元数据）；端点 `POST/GET/DELETE /api/training/samples` + `analyze-slice` + `fit` + `mesh` + `fleet` + `:id/outcome` + `export`。**工况勾选 ≥1 项硬性要求**。测试 `param-fit-test`（5 项）+ `training-store-test`（9 项），已并入 npm test。**学习范式定位与双链路完整解读见 [TRAINING-ARCHITECTURE.md](TRAINING-ARCHITECTURE.md)**；
- **审核闸门（强制）**：待审池建议一律不直接生效——reviewer 及以上「采纳」才经 `processRules.upsertRule` 转正（默认 priority 120，介于外观 100 与高速 200 之间，可指定）；拒绝即归档。采纳/拒绝不可重复操作；
- **使用效率**：提交页**参数实时预览**（勾选变化即调 `POST /api/print/process-rules/preview`，提交前看到「本单会怎么切」与材料裁定）；勾选记忆（上次选择自动恢复）；审批卡展示命中规则与理由（既有）；
- 端点：`POST /api/print/process-rules/preview`（登录）、`POST /api/print/rule-suggestions`（登录可提）、`GET /api/print/rule-suggestions?status=` 与 `/:id/adopt`、`/:id/reject`（reviewer+）、`POST /api/print/slicer-extract`（reviewer+，multipart 3mf）、`POST /api/print/model-features`（登录，multipart STL 几何体检）；
- 存储：`RULE_SUGGESTIONS_FILE`（默认项目根 `.rule-suggestions.json`，生产配项目外）；
- 测试：`node test/learning-loop-test.js`（10 项）+ `node test/model-features-test.js`（12 项，合成网格断言），均已并入 npm test 与 push 闸门。规划中：失败原因打标反馈回路（只记录不自动调参）、规则命中率统计上 policy 窗口。

## 账号体系（2026-10-05 第二批：防止未授权使用）

- **角色**：`member`（注册即得：提交预约/查看/取消自己的单）→ `reviewer`（审批通过/驳回/人工恢复）→ `admin`（用户角色管理/打印机控制/状态强改）；**首位注册者自动成为 admin**（bootstrap），审批人由 admin 在页面「用户与角色」卡升权；
- **安全实现**：scrypt + 随机盐口令哈希、`timingSafeEqual` 比对、同用户名 5 次失败锁 10 分钟、会话 token（HttpOnly cookie，30 天，落盘重启不掉线）；发起人强制取登录身份（`submittedBy` 归属键），body 里的 applicant 一律忽略——**冒名提交不可能**；
- **鉴权双通道**：页面走 `bambu_session` cookie（`requireUser(roles)`）；运维台/脚本走 `X-API-Token`（视作 admin，既有管理链路不破）；
- **聊天指令收窄（2026-10-05 曼波定）**：飞书侧仅保留**群 webhook 播报**与**查看类指令**（`/print-status` `/print-ams` `/print-list` `/print-pending` `/print-help`）；`/print-dispatch` 动作指令移除（人工恢复走页面/运维台，reviewer 及以上）；
- 存储：`AUTH_STORE_FILE`（默认项目根 `.auth-users.json`，生产配项目外数据目录）；
- 测试：`node test/auth-test.js`（13 项，已并入 npm test 与 push 闸门）。

## 自建前后端 API（路线 A 主通道）

| 端点 | 鉴权 | 说明 |
| --- | --- | --- |
| `GET /`（public/index.html） | 无 | 页面：登录/注册 → 提交 → 列表 → 审批（reviewer）→ 用户管理（admin） |
| `POST /api/auth/register`、`/login`、`/logout`、`GET /api/auth/me` | 无/会话 | 注册（首位=admin）、登录发 cookie、登出、当前用户 |
| `GET /api/auth/users`、`POST /api/auth/users/:id/role` | admin | 用户名册与角色升降 |
| `POST /api/reservations` | 登录 | multipart：`file`（≤200MB）+ materialType*/color/quantity/assignedPrinter/selection(JSON)；发起人取登录身份；提交即 `applyRules` 定档，硬冲突 400 |
| `GET /api/reservations`、`GET /api/reservations/:id` | 登录 | 本地存储查询（含参数快照/规则依据/状态轨迹） |
| `POST /api/reservations/:id/approve`、`/reject`、`/review` | reviewer+ | 审批动作（仅待审批单可批/驳；通过即入队并回写排队中） |
| `POST /api/reservations/:id/cancel`、`DELETE /api/reservations/:id` | 本人或 reviewer+ | 取消（排队/分发中/打印中均由 dequeue 兜住） |
| `POST /api/reservations/:id/reprint` | 登录 | 复刻：已完成单一键带参重提（服务端复制源文件，需求链路重新定档） |
| `POST /api/reservations/:id/receipt` | 登录 | 取件回执（v99 任意登录用户可确认）：清回执闸放行该机队列 + 单据落回执记录（回执人如实记录） |
| `PUT /api/reservations/:id` | admin | 状态变更走本地状态机 |
| `GET /api/print/colors` | 无 | 颜色字典窗口（可匹配色名全集+颜色距离阈值，提交页 datalist 数据源） |
| `GET /api/printers/:id/debug` | admin | 真机联调核对面：raw state 报文全量 + 连接/新鲜度元信息 |
| `POST /api/printers/:id/print/pause/resume/stop` | admin | 打印机控制（会话 admin 或管理 token；页面打印机卡已有按钮） |
| `POST /api/dispatch/manual` | reviewer+ | 人工指定分发/恢复 givenUp |
| `GET /api/print/taxonomy`、`GET/POST /api/print/process-rules` | 读无 / 写 token | 标签池与规则库窗口（提交页勾选 UI 的数据源） |

存储：`RESERVATIONS_STORE_FILE`（记录）、`RESERVATIONS_UPLOAD_DIR`（上传文件）、`AUTH_STORE_FILE`（账号），默认项目根隐藏文件，生产均配项目外数据目录防部署清目录丢失。状态机：待审批→已通过/已驳回/已取消；已通过→排队中；排队中⇄打印中（失败重排）→已完成；终态锁定。

## 测试

```
npm test    # 全量自动发现 test/*-test.js（当前 43 套，与 push.js 闸门同源）
```

覆盖：分发引擎（匹配/持久化/闸门竞态）、预约状态机、标签池与规则库、学习回路三件套（param-model 15 断言含 MLP 反向传播正弦证据/饱和曲线竞技场）、几何链路（体检/摆向/分层）、账号与运营、切片与打印机协议、分页查询（v91，27 项含数组参数防御）与复刻血缘（v91，5 项）。各套清单见 [ONBOARDING.md](ONBOARDING.md) 第 8 节。

## 参数智能层（2026-10-30 v60/v61：几何特征 × 工况 → 切片参数的多变量学习）

规则库管**显式工艺因果与安全硬约束**（材料排除/绝缘禁 CF/耐温档），数值工艺参数（层高/墙/壳/填充/支撑/孔补偿/温差/裙边）由学习模型预测——三族 LOFO 竞技场：**kNN 案例推理**（相似专家案例加权融合，可审计「参考了哪几条」）+ **加权岭回归**（多变量，工况 one-hot 进 X）+ **多层神经网络**（mlp.js 手写多任务共享底座+5 网络集成+置换重要性，纯 JS 零依赖）。每参数按留一家族（LOFO）MAE 与中位数基线比，严格优于基线才上岗，学不会的诚实回退；置信度门控（<0.55 回退）；样本权重消费打印 outcome（失败×0.3）与录入 confidence。训练→candidate→admin 采纳（**shadow 只建议 / active 真修正** 双模式）。模块：`featureVector.js`（统一向量空间，spec 随模型冻结）+ `paramModel.js` + `mlp.js` + `paramModelStore.js`；API `POST /api/training/param-model/fit|adopt|mode|deactivate|preview`、`GET …/audit`；UI 在 train.html「🧠 参数智能层」。学习范式定位与双链路完整解读见 [TRAINING-ARCHITECTURE.md](TRAINING-ARCHITECTURE.md)。
