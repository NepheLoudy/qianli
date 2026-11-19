# 学习链路下一轮迭代设计（2026-11-19，审查+复盘产出）

> 依据：hy3 工位全量审查（dispatchLearning/paramModel/machineLearning/orientationFitter/trainingStore 五文件 + 消费接线）+ 主线生产实况核验（paramModelStore active=null、dispatchLearning 全仓仅 durationBias 一处消费）。数据拐点：v110 配对修复后 T20261118-001 首条真网格样本入库（hasMesh=true+13 参数）。

## 一、现状一句话

**采集侧基本齐、消费侧大半断线、生效侧未启动**——学习组件大部分「写好了但没通电」：

| 组件 | 数据面 | 消费面 | 结论 |
|------|--------|--------|------|
| dispatchLearning | dispatchStats 每完成单+1（54 条存量，老单 estMinutes 空） | **仅 durationBias 进 policy 窗展示**；recommendBySpeed/machineMaterialMatrix/queueWaitByPrinter 零调用 | 半死 |
| paramModel（kNN/岭回归/MLP） | train 入口手动（train.html 按钮） | applyToParams 在提交路径（需求链）——但 **active=null，生产从未采纳**，shadow/active 全未启动 | 断电 |
| machineLearning（选机） | machineStats 混口径：分发回滚混进 fail、重试成功单双计 | 选机在用（好）；**chooseTrayForTask+slotStats 零调用**（dispatcher 自有槽位匹配） | 半死 |
| orientationFitter | 自举回填条件苛刻（自动切片+勾选+成功）；专家标签靠 3mf 弱标签 | fit/adopt 端点无 UI（train.html 零调用）——采纳只能裸 curl | 断在采纳 |
| trainingStore | 61 样本/43 clean/真网格 1 条 | **quality 档不入训过滤**（quarantine/humanFactor 照训）、setQuality 无 API、sliceStats 字段写了没读者 | 打标半残 |

## 二、本轮迭代设计（按数据杠杆排序，五个抓手）

### 抓手 1：quality 滤波入训 + setQuality API（杠杆最大·改动最小）
- paramModel.train 入口：`.filter(s => !s.quality || s.quality === 'clean')`——18 条隔离样本摘出 LOFO
- index.js 补 `POST /api/training/samples/:id/quality`（reviewer+），train.html 单据卡加打标按钮
- 收益：择优信号去噪；前置：无。**第一优先。**

### 抓手 2：真网格批量重提取（数据面质变）
- 52 条 gcode-estimate 样本 → 按归档 3mf 重提取网格特征（refit-features 通道已有）+ 勾选了 CAD 源的新单自动升 auto
- 收益：几何向量从估计档升实测档，kNN 距离可信度质变，真网格样本 1→50+
- 前置：归档文件在（80MB 内落盘的都在）；跑批放 scripts/ 幂等脚本

### 抓手 3：durationBias 接进队列 ETA（学以致用第一例）
- 队列 ETA = estMinutes × 机×料 bias（actualOnly 机器用裸估+样本数标注）
- 收益：ETA 从切片裸估变按机校准，排队池 UI 的剩余时长可信
- 前置：新单 estMinutes 持续积累（自动满足——每完成单都在回填）

### 抓手 4：machineStats 口径拆分 + 摆向采纳 UI
- fail 拆「打印失败 vs 分发回滚」（熔断/553/上传类基础设施故障不算机器失败）；重试成功单只计 ok
- train.html 补 orientation fit/adopt 按钮（摆向闭环通电）
- 收益：选机成功率去噪 + 摆向策略闭环走通

### 抓手 5：槽位学习通电或退场（二选一）
- 通电：dispatcher 选槽加 slotStats 成功率项（0.2 权重已在）
- 退场：删 chooseTrayForTask/slotStatsFromRecords 死码
- 收益：断料/失败槽自动回避（通电）或代码卫生（退场）；前置：先看 dispatch.trays 快照覆盖率

## 三、复盘要点（本轮审查的方法论沉淀）

1. **「写了≠通了」**：五个学习组件四个半死/断电——下次加学习功能必须同时给「生产触发点 + 消费点 + 验收断言」，否则就是负债
2. **置信度门控双刃**：paramModel 设计精良（LOFO/门控/shadow）但在数据量不足时门控=永远不生效——先养数据再谈模型
3. **数据拐点确认**：v108-v111 配对修复 + busy 排队语义落地后，真网格样本开始积累（1→N），下一轮迭代的时间窗口就是现在

## 四、验收口径

- 抓手 1/3/4：断言（隔离样本不入训 / ETA 计算带 bias / machineStats 拆分口径）
- 抓手 2：重提跑批前后 stats 对比（mesh 特征覆盖率）
- 抓手 5：决策记录（通电 or 删码）入 DEVLOG
