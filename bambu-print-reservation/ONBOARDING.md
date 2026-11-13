# 新队员上手手册（开发手册）· bambu-print-reservation

> **找错文档了？** 想学怎么**用**这个平台（提交预约/审批/取件），看 [USER-GUIDE.md](USER-GUIDE.md)——那份是写给全体队员的用户手册；本手册写给要**改代码**的新开发者。
> 目标：读完这份文档 + 跟着第 2 章跑一遍，你就能独立改代码、跑测试、上线部署。事无巨细，遇到没写到的先查 [DEVLOG.md](DEVLOG.md)（每次部署都有记录）和本手册，再问曼波。
> 配套文档：[USER-GUIDE.md](USER-GUIDE.md)（平台使用手册）、[README.md](README.md)（功能与 API 总表）、[TRAINING-ARCHITECTURE.md](TRAINING-ARCHITECTURE.md)（学习链路深度解读）、[PRINTER-LAN-API.md](PRINTER-LAN-API.md)（打印机协议档案）、[DEVLOG.md](DEVLOG.md)（全部开发史）。

---

## 1. 这个项目是什么

**一句话**：实验室 3D 打印机的「预约—审批—自动分发—全程播报」系统——队员在网页提交模型文件 + 勾选工况需求，审批人页面点通过，系统自动切片、自动选机、自动上传开打，全程飞书群播报。

```
队员（网页）                 审批人（网页）                系统自动
  │ 提交模型 + 勾选工况          │ 点通过                     │
  ▼                            ▼                           ▼
规则引擎定档切片参数 ──► 入队 ──► 打印机空闲触发匹配 ──► AMS 装料匹配
（taxonomy 勾选 → processRules 规则库 → 参数快照）      （材料+颜色；品牌按内嵌机型指纹）
                                                            │
群播报 ◄── 打印完成/失败/开始 ◄── MQTT 监听 ◄── 上传 3mf / .gcode.3mf ◄┘
```

四台机器混编：拓竹 X1C / P1S / A1 / H2D + 闪铸 A5P，全部**局域网直连**（不经厂商云）。

**归属边界**（重要，防需求发错）：本项目只管「打印、预约、`/print-*` 指令」。工单找 ticket-bot、财务审批找 approval-bot、DDL 播报找 project-management-robot、消息路由找 feishu-gateway、部署架构找 qianli 顶层——详见工作区 `AGENTS.md` 的「发错时的规定动作」。

## 2. 三十分钟上手

### 2.1 环境

- Node ≥ 20（实测 v22/v24 都跑）；Windows 开发机为主（部署目标也是 Windows 小电脑）。
- 依赖：项目根 `npm install`（唯一原生依赖相关的是 occt-import-js 的 WASM，安装即用）。
- OrcaSlicer（可选，自动切片用）：`ORCA_SLICER_EXE` 指向 `orca-slicer.exe`，v2.4.2 portable 实测。
- `.env`：按 `.env.example` 备齐。本地开发最小集：`PORT=3001`、`AUTH_STORE_FILE` 等存储路径（默认项目根隐藏文件也行）、打印机 `PRINTER_HOSTS/PRINTER_SERIALS/PRINTER_ACCESS_CODES`。**部署凭证 `DEPLOY_*` 只在要部署时需要**。

### 2.2 首次启动

```bash
cd D:\dev\qianli\bambu-print-reservation
npm install
npm start          # 或 node src/index.js，默认 http://localhost:3001
```

- 首个注册的用户自动成为 **admin**（bootstrap）——打开 `http://localhost:3001` 注册。
- 角色阶梯：`member`（提交/查看/取消自己的单）→ `reviewer`（审批/人工恢复）→ `admin`（用户管理/打印机控制/状态强改）。admin 在页面「用户与角色」卡给人升权。
- 连不上真打印机也能开发：启动报 MQTT 连接失败不影响 HTTP 服务，预约/审批/规则/训练全链路可离线走通。

### 2.3 跑测试

```bash
npm test           # 全量自动发现 test/*-test.js（当前 43 套，断言数见各文件尾部）
node test/param-model-test.js   # 单跑一套
```

**铁律：改任何代码，`npm test` 全绿才能部署。** `npm run push` 内部也会先跑测试闸门。

### 2.4 部署

```bash
npm run push       # 不带参数！本仓 push.js 是纯 SFTP 直传（无 git 步骤）
```

流程：本地测试闸门 → SFTP 同步代码到小电脑（192.168.31.57 `/c/qianli/opt/bambu-print-server`）→ 覆盖 `.env` → `npm install` → `pm2 restart bambu-print-server`。细则与故障速查见顶层 `.agents/skills/qianli-deploy/SKILL.md`（**部署前必读，尤其「已知坑速查」表**）。

部署后验证三板斧：
1. pm2 里 `bambu-print-server` online；
2. `curl http://192.168.31.57:3001/api/health` 返回 200；
3. push 输出尾部的「SSH 连接失败: read ECONNRESET」**是误报**（目标机 sshd 频率保护），实质步骤都完成了，以上两步复核为准，不要重试 push。

每次 push 必须在 DEVLOG.md 文末追加 `### vN · 日期 · 随本提交落地 · feat/fix` 条目（格式照抄最近的），并更新头部「当前最新」指针。**一次 push = 一个版本号**。

## 3. 架构导览（目录地图）

```
src/
  index.js            ← 全部 HTTP 路由（2100+ 行）+ 启动/优雅退出/HTTPS mirror
  config.js           ← .env 读取与默认值
  auth.js             ← requireUser 中间件（cookie 会话 + X-API-Token 双通道）
  services/
    reservationStore.js  ← 预约记录 JSON 存储（唯一真相源）
    reservation.js       ← 预约业务（提交/审批/取消/复刻/样本入库）
    dispatcher.js        ← 分发引擎：队列/匹配/上传/下发/重试/回执闸/放弃池（最大最复杂）
    autoSlice.js         ← 模型单自动切片（规则参数 → Orca CLI → 盘内排布 3mf）
    processRules.js      ← 工艺映射规则库（勾选/feat 条件 → 切片参数；白名单+校验+热改）
    taxonomy.js          ← 需求标签词汇表（9 组 24 字段 + 冲突规则）
    modelFeatures.js     ← 几何体检（STL/3mf/STEP → 孔/悬垂/接触/曲面特征）
    featureDerive.js     ← 特征派生（体检+3D标注+工况 → feat 字典，供规则条件引用）
    featureVector.js     ← 统一特征向量（几何+工况 one-hot+交互列 → 数值向量空间）
    paramModel.js        ← 参数智能层：kNN 案例推理 + 岭回归 + MLP 三族 LOFO 竞技（v60/v61）
    mlp.js               ← 纯 JS 多层神经网络引擎（Adam/集成/置换重要性，零依赖）
    paramModelStore.js   ← 参数模型 candidate/active 存档与采纳流
    orientationFitter.js ← 摆向策略拟合（24 轴向候选 × 标签 → 评分权重，LOFO 验证）
    modelOrient.js       ← 24 轴向摆向搜索（接触/支撑/高度度量；只保留正当旋转）
    orientationExtract.js← 专家摆向标签提取（3mf matrix → 四元数）
    trainingStore.js     ← 训练样本库（模型特征×工况标注×专家参数 三方合成）
    ruleFitter.js        ← 阈值规则拟合（v84 已删 fitRules/lofoEvaluate——只余 median/expertOf 供 paramModel 消费）
    ruleSuggestions.js   ← 规则建议待审池（人工修正→聚合计数→reviewer 采纳）——v84 已退役（路由移除，无生产写入），文件保留
    paramFit.js          ← 拟合度（引擎参数 vs 专家参数，知识覆盖缺口度量）
    chatService.js       ← /print-* 聊天指令（唯一入口 = hub 转发 POST /api/chat/command）
    printerFleet.js      ← 机型登记（.printer-fleet.json）
    quietHours.js        ← 晚间静默（02:00–09:00 webhook 卡片积压到 09:00）
    backup.js            ← 数据面每日快照（保留 14 天）
    authStore.js         ← 账号（scrypt+盐、会话、飞书绑定码）
  printer/             ← 打印机协议层：client(MQTT)/manager(连接池)/capabilities/rtsps
  feishu/              ← bot(群播卡片)/client(IM API)/bitable(只读遗留)
  utils/               ← stepMesh(CAD解析)/gcodeLayers(刀轨分层)/fileTypes 等
public/                ← 四页前端（无框架原生 JS + styles.css 共享设计系统）
  index.html  预约中心（提交/列表/取消）
  approve.html 审批台（审批/预览/回读校验/模型 provenance）
  train.html  训练录入台（样本录入/3D标注/规则治理/参数智能层面板）
  status.html 观察台（机队状态/画面/控制指令）
  annotator.js  3D 标注工房（canvas 网格 + spatial 标注）
  fleet-dock.js 机队悬浮坞（四页共享组件）
scripts/               ← slice-with-engine.js（切片桥）/train-from-models.js 等
test/                  ← 测试全部独立可跑（npm test 自动发现，与 push.js 闸门同源）
```

### 请求生命周期（以一次预约为例）

1. `POST /api/reservations`（auth.js 校验会话）→ multer 收文件（扩展名白名单 + 200MB 闸）；
2. `featureDerive.deriveFeatures` 算 feat 字典 → `processRules.applyRules(selection, {material, feat})` 出参数快照（硬冲突 400）→ 参数智能层 `applyToParams`（有已采纳模型时按置信度修正数值参数，provenance 随单存档）；
3. `reservationStore.create` 落库（状态机起点「待审批」）→ 群播审批提醒卡（过静默闸）；
4. 审批人 `POST /api/reservations/:id/approve` → 校验通过 → **同步入队**（关键路径内禁 await，防审批取消竞态）→ 状态「排队中」；
5. dispatcher 扫队列（事件驱动 + 每分钟兜底）：空闲判定=状态归一 + FAILED 残留放行 + 品牌/文件格式隔离（拓竹、闪铸都参与自动分发）+ 取件回执闸排除 → AMS 材料匹配 → 自动切片（需求单）/直接用文件（直通单）→ SFTP/FTPS 上传 → MQTT 下发 → 「打印中」。同型号机都在挂取件闸时提交链入队排队（v99 排队池），闸摘或 TTL 超时自动放行后开打；
6. MQTT `gcodeState` 变迁：FINISH→「已完成」+完成播报 + 样本 outcome/sliceStats 回填；失败→取证（HMS 时效/人因码/镜像码三重校验）→ 自动重排（确定性失败直接终局不重试；30 分钟二次失败熔断进放弃池）。

## 4. 核心概念（按依赖顺序）

### 4.1 需求标签池 taxonomy → 规则库 processRules

- **taxonomy** = 用户能勾什么的词汇表。铁律：每个标签必须能回答「映射到什么切片参数」（mapsHint）；维度正交；默认不勾=常规件。
- **processRules** = 勾选怎么翻译成切片参数。参数白名单 22 个（`PARAM_NAMES`），规则 `when`（枚举/区间/`feat.*` 派生特征）→ `set`（白名单内参数），按 priority 升序叠加、大者赢；材料参数（materialExclude/Prefer）跨规则**并集**。**学习型工艺因果一律动态拟合、不手写**（曼波定则，手写已撤过一次）。
- 规则改动：现行走规则热改窗口 `POST /api/print/process-rules`（upsert/remove/reset，token；改动预览 `POST /api/print/process-rules/preview`）。~~待审池链路（ruleSuggestions：点「建议修正」→聚合计数→reviewer 采纳）~~ 已随 v84 退役（路由移除，train.html 旧注释残留勿信）。规则文件 `.process-rules.json` 热改即写回、部署不丢（生产配项目外数据目录）。

### 4.2 几何体检与 3D 标注

- `modelFeatures` 纯几何分析：通孔=拓扑亏格+拟圆、悬空=法线分带、接触=贴底面积、曲面占比。能力边界：>80MB 或 >60 万三角面降级跳过（**STEP 链路也上了这道防线，v62**）。
- `spatial`（3D 标注）是人修正几何盲区的接口：在标注工房点模型表面落「受弯/接触/外观面」等标注，随单入库。

### 4.3 学习回路（v60/v61 参数智能层——本项目的「智能」所在）

**分层分工哲学：规则管因果、模型管数值、置信度管敢不敢、LOFO 竞技场管谁上岗。**

- **样本库**（trainingStore）：一条样本 = 几何特征 × 工况标注（人工金标准）× 专家切片参数。录入即入库无审批（录入人=标注权威）；打印完成/失败经 sourceRecordId 自动回填 outcome。
- **特征向量**（featureVector）：几何体检原值 + feat 派生 + 工况 one-hot + 挠度标尺 + 6 组物理交互列 → 统一数值向量。**spec 随模型冻结**（impute/标准化参数存档）——taxonomy 演进后旧模型按填补值降级，不崩。
- **三族竞技**（paramModel）：kNN 案例推理（几何标准化欧氏+工况 Jaccard 取 top-5 专家案例加权融合）/ 岭回归（多变量闭式解）/ MLP（多任务共享底座 24→12 双隐层 + 5 网络集成，mlp.js 手写）。每参数按 **LOFO（留一家族出）MAE** 与「全局中位数基线」比，严格优于基线 ≥5% 才上岗，学不会的诚实回退规则值。
- **消费与门控**：审批时基线参数 → 模型逐参数修正（只碰 12 个数值参数，clamp 白名单域内；材料/朝向等安全参数模型永远不碰）；置信度 <0.55 逐参数回退。provenance（模型值/规则值/来源/置信度/参考案例）随单存档、审批台可见。
- **采纳治理**：训练→candidate → admin adopt → **shadow（只建议）/ active（真修正）** 双模式，可随时切换/下线。UI 在 train.html「🎓 规则学习治理」卡的「🧠 参数智能层」区块。
- **摆向学习**（orientationFitter）独立成链：placement/3mf/auto-confirmed 三级标签权重 → 24 轴向评分权重拟合 → LOFO 增益 ≥10 个百分点才可采纳。

### 4.4 分发引擎 dispatcher（最复杂的一个文件）

- 队列匹配五规则：拓竹空闲 + 指定优先 + AMS 精确材料 + 颜色 ΔE + 家族回退（PLA-CF↔PLA）；加急优先出队，队首缺料不阻塞。
- **取件回执闸**：打完即挂闸等取件确认，闸挂期间本机对自动匹配不可见；挂闸超 `DISPATCH_RECEIPT_TTL_HOURS`（默认 24h）自动放行防单闸堵死机型队列（manual-\* 人工闸豁免 TTL）。
- **同型号排队**（v99/v105）：同型号机都在挂闸时新单照常入队排队（不转人工散伙），闸摘或 TTL 放行后自动开打；同型号内无闸机优先。
- **分发闸门**：上传/下发是分钟级 await 链，闸门在入口同步判定（分发中的机器对自动匹配不可见）；刻意不持久化（崩溃后清零重新评估）。
- **重试**：失败自动重试 3 次（冷却 60s）→ 放弃池（页面一键人工恢复）；确定性失败（工程 3mf 闸等 noRetry 拦截）跳过重试直接终局（v100——重试也不可能成功）；同单 30 分钟二次失败熔断（防误判复打）。
- **故障取证**（谁取消了打印）：HMS 时效（只认本次开打后的条目）、同值镜像码不算独立证据、人因终止四通道（控制台/拓竹 400C/闪铸 canceling/无证据 FAILED 反转）——**别再加取消码，接故障证据字段**。
- 状态持久化：队列/打印中映射/放弃池落盘 `DISPATCH_STATE_FILE`，重启恢复；文件损坏隔离 `.corrupt-<ts>`。

### 4.5 打印机协议层（src/printer/）

| 机型 | 控制/状态 | 上传 | 画面 |
| --- | --- | --- | --- |
| X1C/H2D | MQTT 8883（bblp+Access Code，社区逆向标准） | SFTP 22 | RTSPS 322 |
| P1S/A1 | MQTT 8883 | FTPS 990（21 已关） | TCP 6000 TLS JPEG 帧流（服务端重封装 MJPEG） |
| 闪铸 A5P | HTTP 8898（LAN Only，serialNumber+checkCode） | HTTP | 8080 MJPEG（需 streamCtrl 开流） |

品牌与文件格式强隔离：品牌按**内嵌机型指纹**判定（gcode 头 printer_model / 3mf 内嵌机型，无指纹不按扩展名瞎猜）；两品牌切片产物统一 .gcode.3mf（纯 .gcode/.gx/.g 提交口封死）——拓竹直接吃 3mf，闪铸分发链从 3mf 提内嵌 gcode 直发。机型怪癖详见记忆档案与 PRINTER-LAN-API.md。

## 5. 存储与配置

| 数据 | 文件（.env 键） | 说明 |
| --- | --- | --- |
| 预约记录 | `RESERVATIONS_STORE_FILE` | 唯一真相源；生产在 `C:/home/qianli/bambu-data/` |
| 上传文件 | `RESERVATIONS_UPLOAD_DIR` | 含 sourceFile 配对 |
| 账号 | `AUTH_STORE_FILE` | scrypt 哈希，落盘会话重启不掉线 |
| 规则库 | `PROCESS_RULES_FILE` | 种子在代码，文件按 id 合并+墓碑防复活 |
| 待审池 | `RULE_SUGGESTIONS_FILE` | |
| 样本库 | `TRAINING_SAMPLES_FILE` + `TRAINING_FILES_DIR` | 索引 JSON + 文件归档（80MB 上限） |
| 参数模型 | `PARAM_MODEL_FILE` | candidate/active 双槽 JSON |
| 分发状态 | `DISPATCH_STATE_FILE` | 防抖 300ms 原子写，known 截尾 2000 |
| 摆向策略 | ORIENTATION_POLICY_FILE（orientationPolicyStore） | |

**共性口径（全项目统一，改代码必须遵守）**：
1. **生产路径全配项目外数据目录**（`C:/home/qianli/bambu-data/`）——push 清目录不丢数据；
2. **原子写**：写 tmp + rename，绝不直接覆盖目标；
3. **损坏隔离**：JSON parse 失败 → 坏文件改名 `.corrupt-<时间戳>` 留档 → 按空/种子启动（样本是资产，宁停不覆）。

## 6. 日常开发 SOP

### 加/改一条切片规则
1. 直接改库内规则（admin，规则热改窗口 `POST /api/print/process-rules`）——待审池链路已随 v84 退役。**不要直接改 processRules.js 的种子**（文件规则会按 id 合并，种子改动到不了已有文件的现网）。
2. 改 `taxonomy` 字段时：TAXONOMY_VERSION 必须递增；每字段 mapsHint 非空；跑 `node test/taxonomy-test.js`。

### 加一个可学习的切片参数
1. `processRules.js`：BASELINE 加默认值 + PARAM_NAMES + validateRule 范围校验；
2. `paramModel.js`：PARAM_DOMAINS 加 clamp 域（**不改则模型永远不碰它**）；
3. paramFit.js TOLERANCES 加容差/权重（回读校验口径）；
4. 测试：process-rules-test + param-model-test 各补一条。

### 加一条 /print-* 指令
1. chatService.js commandHandlers 加 handler（**只做查看类**——动作指令一律走页面/HTTP）；
2. hub（project-management-robot 会话）登记路由；
3. 测试 learning-loop-test 或新建。

### 接新机型
先读 PRINTER-LAN-API.md 对应章 → capabilities.js 登记能力 → autoSlice PROFILE_RULES 加档（没有 Orca 档就诚实报错，**不要静默用兼容档**）→ 打印机协议层按需扩展 → 真机 /debug rawState 核对。

### 调学习模型
- 训练：train.html「⚙️ 训练参数模型」（约 15s，含 LOFO 6 折 + MLP 集成 + 置换重要性）；
- 看效果：模型卡逐参数 MAE（择优/基线/kNN/岭回归对比）+「神经网络依据特征」；
- 预览单点效果：`POST /api/training/param-model/preview`（selection+modelFeatures → 规则基线 vs 模型建议）；
- 异常排查：看单据 `modelProvenance.params.<参数>`——applied=false 时看 confidence 是否低于 0.55、source 是哪族、参考案例是谁。

## 7. 设计准则（曼波定）

**使用强度节奏（v66）**：前端任何新模块先回答「谁看、多久看一次、值几屏」——高频操作占首屏黄金位；中频参考紧凑常驻；低频回顾默认折叠成一行数字摘要，点开才渲染。

**连续映射优先于定态规则（v84）**：学习型工艺因果一律用连续拟合（kNN/岭回归/MLP），禁止「检测到某值就触发某参数」的阈值规则（v84 已删 fitRules——单变量中位数差是伪相关）。

**新功能必须带端到端断言（v89）**：v86 自动分发曾漏传 {auto:true} 导致旗舰特性整体不可达，而单元测试全绿掩盖了断链——「谁被选中」「链路是否走通」要直接断言，不要只断言集合形状。

**.env 用脚本修改必须校验**（v86 事故）：node 脚本写 .env 前后对比行数/键数，写坏会静默覆盖生产（pm2 进程内存是唯一抢救窗口）。


前端任何新模块先回答「谁看、多久看一次、值几屏」：**高频操作**（提交/看单/取消）占首屏黄金位；**中频参考**（队列 ETA/机队状态）紧凑常驻——时间带 34px、生命体征行单卡 ~100px；**低频回顾**（热力日历/趋势/星图）默认折叠成一行数字摘要，点开才渲染。反例已修：热力图 v64 首版曾以 84 格铺首屏（低频信息占黄金位）。折叠交互用自制按钮（overview-strip 样式），热力图懒渲染（未展开不画）。

## 8. 已知坑清单（踩过的，别再踩）

**架构红线**
- 五机器人共用一个飞书应用，**长连接只属于 feishu-gateway**；本项目 `FEISHU_USE_LONG_CONNECTION` 必须为 false，`/api/feishu/event` 端点已删除——别恢复。
- 指令唯一入口 = hub 经 `POST /api/chat/command` 转发；本项目不消费任何飞书事件。
- 部署目标（小电脑）只在 superqianli 局域网可达——push 报连接超时先看自己在不在内网，别误判目标机坏了。

**代码级**
- **Express 4 不捕获 async 路由的 rejection**——async handler 必须整段 try/catch（v62 修过三处漏网的），且 **catch 里要用的变量必须声明在 try 外**（v62 的进程崩溃 P0 就是 catch 越块引用触发 ReferenceError），新路由照这个模子写。
- **前端轮询一律走 startPolling 守卫**（v62 四页同款）：interval 防叠加（页内重登会重复 enter）+ visibilitychange 隐藏暂停——新页面照抄，别裸写 setInterval。
- **弹窗用完要从 DOM 移除**：approve.html 预览弹窗曾只 close 不 remove，叠上 WebGL 上下文不释放，重度使用十几次就把浏览器的 8-16 个上下文额度耗干（v62 修）；新 dialog 代码 close 时 `dlg.remove()`，WebGL canvas 释放 `WEBGL_lose_context`。
- **JSON 存储的损坏隔离只对 SyntaxError**（v62 口径收紧）——EPERM/EBUSY 等瞬时 fs 错误（Windows 杀软/索引器常见）要上抛 500 保留现场，别把好文件改名成 `.corrupt`。
- **临时脚本 require dispatcher/manager 会真连生产打印机**——先阻断再测（二踩在案）。
- 3mf 直通单的「模型」与「切片」是同一文件；切片导出 3mf **无网格、无变换矩阵**（29/29 实证）——想拿真几何要 STEP/STL 源文件配对。
- 拓竹 MQTT 状态处理/网页请求不能被同步阻塞——分发链内禁 spawnSync（热修过，切片桥是异步 spawn）。
- 前端 XSS：四页是 innerHTML 大块渲染风格，**用户可控字段必须过 esc()**；onclick 的 JS 字符串参数用 jsq()（status.html 有先例——esc 的 `&#39;` 会被 HTML 属性解码还原回 `'` 逃出 JS 字符串）；飞书卡片 markdown 用户可控字段过 escMd()（bot.js）。
- **hms 是累积列表**（停机不清空、新条目在尾部）——截取证据用 `slice(-6)` 取最新，取头部会拿到陈年条目（v62 修过方向反了的 bug）。
- 摆向候选只允许正当旋转（det>0）——镜像变换会把手性件打成反件（v62 修，测试有断言）。
- 学习侧任何「训练坐标 vs 服务坐标」的双口径都是事故（impute 时序 bug 在案）——spec 冻结口径改动必须两侧同步。
- **模型择优读字段走一处真源**：MLP 的 LOFO MAE 曾因没合入择优视图被静默滤掉（v61 竞技场空转一天才被发现）——加新模型族时把它的 MAE 合进统一的择优数据结构。

**运维级**
- pm2 全掉（小电脑重启后）→ `pm2 resurrect` + `pm2 save`（自启任务 qianli-bots-autostart 在，但双保险）。
- push 尾部 ECONNRESET = sshd 频率保护误报，人工复核 health 即可，**不要重试 push**。
- .env 永不进 git；改线上配置的正确姿势是改本地 .env 再 push（不要 sed 目标机）。
- 放弃池恢复 = `POST /api/dispatch/manual`（reviewer+）；A5P 卡死只能断电（8080 半死是固件病）。

## 9. 测试体系速查

| 测试文件 | 覆盖 |
| --- | --- |
| dispatcher-test / persist / manual-race | 队列匹配/持久化恢复/闸门竞态 |
| dispatch-learning-test / machine-pick-test / stub-test-receipt-pool / stub-test-engineering-gate | 分发学习器 / 切片件自动选机（无同型号不降级）/ v99 排队池+取件 TTL / v100 工程 3mf 分发闸——stub-\* 两套链外手跑 |
| local-reservation-test / precheck-test / receipt-gate-test | 预约状态机/程序初审/回执闸 |
| reservation-dm-quiet-test | 打印进程 DM 晚间静默闸（静默积压 09:00 补发） |
| taxonomy-test / process-rules-test / rules-seed-sync-test | 标签池/规则库/种子同步 |
| param-model-test（15 断言）/ orientation-learn-test / learning-loop-test / training-store-test | 学习回路三件套（含 MLP 正弦/饱和曲线/竞技场闸门）+ 训练集样本库纯逻辑 |
| model-features-test / model-orient-test / feature-derive-test / feature-labels-test / gcode-layers-test / golden-parts-test / geometry-dna-test / multi-model-match-test | 几何链路（含 v83 带孔 DNA 回归 / v75 多模型↔切片配对） |
| auth-test / ops-test / bind-code-test / pickup-code-test / quiet-hours-test / bootstrap-test | 账号与运营 |
| reservation-query-test / reprint-lineage-test | 分页查询（27 项含数组参数防御）/ 复刻血缘（5 项，v91） |
| auto-slice-test / param-fit-test / slice-artifacts-test / printer-*-test / flashforge-client-test / rtsps-test / ams-filament-test / spatial-sanitize-test / source-pairing-test | 切片与打印机协议 |
| engine3mf-test / printer-upload-channel-test / stub-test-gcode-meta / stub-test-model-lock / stub-test-nozzle-gate / stub-test-color-dispatch | 工程 3mf 自解析 / 上传通道分流（FTPS 优先）/ gcode 机型指纹 / 切片件机型锁 / 喷嘴闸（v97）/ 颜色分发降级（v98）——stub-\* 四套链外手跑 |

写新测试照现有模子：`check(name, fn)` + assert + 末尾 `process.exit(failures ? 1 : 0)`——`npm test` 经 `scripts/run-tests.js` 自动发现 `test/*-test.js`，无需挂链（2026-11-05 起）。

## 10. 遇到问题找谁/查什么

1. **先查 DEVLOG.md**——v1 至今每次部署都记了「为什么改、改了什么、什么教训」，90% 的问题都发生过；
2. 摆向/学习相关查 TRAINING-ARCHITECTURE.md 与记忆档案；
3. 打印机协议查 PRINTER-LAN-API.md；
4. 跨项目（网关/hub/部署）查 qianli 顶层 AGENTS.md 与各 skill；
5. 都没有 → 问曼波（他定的所有原则都会当场补进文档）。
