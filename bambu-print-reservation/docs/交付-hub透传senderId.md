# 跨工作区交付说明：hub 透传发送者身份（打印私信绑定）

> 本文件是**交给其他工作区（project-management-robot / 对话枢纽）的需求单**，
> 由 bambu-print-reservation 会话于 2026-10-29 出具。打印服务侧的接收端已上线并自测通过，
> 只差 hub 侧这处透传，飞书自助绑定即可闭环。

---

## 一、边界归属（先说清楚谁管什么）

| 范围 | 归属 | 状态 |
| --- | --- | --- |
| `/print-bind` 指令实现、绑定码生成、账号绑定、打印进程私信（完成/失败/取消/驳回） | **bambu-print-reservation** | ✅ 已完成并上线（热修 62/65） |
| 飞书事件接收、@识别、消息路由、**指令转发（含发送者身份）** | **project-management-robot（hub）+ feishu-gateway** | ⬜ 本单待办 |
| 打印预约页面 UI（绑定码按钮、审批台、用户管理） | bambu-print-reservation | ✅ 已完成 |

**为什么不自己做**：本项目按对话铁律不消费飞书事件（`POST /api/feishu/event` 已随 v46 删除），
指令唯一入口是 hub 经 `POST /api/chat/command` 转发。发送者身份只有 hub 拿得到，所以只能请 hub 透传。

---

## 二、改动需求（三处，共约 5 行）

**文件**：`D:\dev\qianli\ticket-pm\project-management-robot\server\src\services\chatService.js`

### 1. `handlePrintCommand` 签名与转发体（约 707–718 行）

```js
// 现状
async function handlePrintCommand(command, args) {
  const printServerUrl = config.printServer.url;
  try {
    const res = await fetch(`${printServerUrl}/api/chat/command`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args }),
    });
```

```js
// 改为（新增第三参 senderId，并放进转发体）
async function handlePrintCommand(command, args, senderId) {
  const printServerUrl = config.printServer.url;
  try {
    const res = await fetch(`${printServerUrl}/api/chat/command`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, args, senderId: senderId || '' }),
    });
```

### 2. 调用点（约 878 行）

```js
// 现状
replyText = await handlePrintCommand(cmd.command, cmd.args);
// 改为（senderId 在同函数上文约 140/786 行已有）
replyText = await handlePrintCommand(cmd.command, cmd.args, senderId);
```

### 3. 无需改动

- 打印服务 `/api/chat/command` **已兼容** `senderId`（优先）与 `openId`（旧字段名）两种键。
- 其他 `/print-*` 查看类指令不受影响（多余字段被忽略）。
- 打印服务侧的 `chatCommandGuard` 只校验来源（本机回环 / X-API-Token），hub 本机转发零改动。

---

## 三、验证方法（改完 hub 后）

1. 网页 `http://192.168.31.57:3001/` 登录 → 右上「🔔 飞书通知」→ 拿到 6 位码（5 分钟有效）。
2. 在飞书给对话机器人发：`/print-bind 123456`（换成实际码）。
3. 期望回复：`✅ 已绑定飞书私信通知：账号「xxx」（姓名）`。
4. 若回复 `❌ 未取到你的飞书身份（对话枢纽未透传 senderId）` → 说明本单改动未生效。

绑定成功后，打印完成/失败重排/人工取消/放弃池丢弃/审批通过/驳回都会私信到本人。

---

## 四、背景（为什么需要）

2026-10-28 曼波令：**机械组群播报全面关闭**，打印进程改为「私信告知申请人本人」。
私信需要「账号 ↔ 飞书 open_id」的映射，目前有三条路：

1. **自助绑定（本单要打通的）**：网页生成绑定码 → 飞书发 `/print-bind 码` → 自动绑定。
2. **管理员手填**（旁路，已可用）：用户管理页「飞书通知 → 绑定」，人工填 `ou_xxx`。
3. 未绑定的账号：静默跳过私信，状态在页面可见（不阻塞任何流程）。

---

## 五、验收状态（2026-10-29 07:0x 复核）

| 检查项 | 结果 |
| --- | --- |
| hub 源码三处改动 | ✅ 707 行签名 / 718 行转发体 / 879 行调用点，全部就位 |
| 现网部署文件（/c/qianli/opt/knowledge-tracker） | ✅ 同样三处在位（grep senderId 确认） |
| hub 进程重启 | ✅ knowledge-tracker 06:50:29 重启（晚于改动，新代码生效） |
| 打印服务接收端 | ✅ 已上线并自测（生码→带 senderId→绑定成功） |
| 真人飞书端到端 | ⬜ 待一次实发验证（见下） |

**真人验证步骤（30 秒）**：网页右上「🔔 飞书通知」拿 6 位码 → 飞书发 `/print-bind 码`
（私聊需在 P2P_COMMAND_OPEN_IDS 白名单内；群里 @机器人 全员可用）→ 期望回「✅ 已绑定飞书私信通知」。

## 六、回执要求

改完请回到 **bambu-print-reservation 会话**报一句「hub 已透传 senderId」，我再复跑一次
端到端绑定验证并关单。若你判断这处改动属于别的项目边界，请明确说明改由谁接——**不要在本会话改 hub 代码**。

---

## 附：私聊单项豁免（2026-10-29，已改 hub）

**问题**：队员私聊发 `/print-bind 码` 被回「⚠️ 指令仅支持在群聊中 @机器人 使用，私聊指令暂未开放」——
hub 的 `isP2pCommandAllowed` 是全局私聊白名单（只管白名单账号），而绑定功能本身就是「绑私信通道」，
白名单又要求先有 open_id（只有私聊发码才能拿到）→ 鸡生蛋，永远绑不上。

**改法**（`server/src/services/chatService.js` 约 846–851 行，5 行）：
```js
const p2pExempt = cmd.command === '/print-bind';
if (!isGroup && !p2pExempt && !isP2pCommandAllowed(senderId, message.chat_id)) { ...原拦截... }
```
仅豁免这一条指令，其余私聊规则不变（查看类 `/print-*`、其他域指令仍要白名单或进群）。

**状态**：✅ 已部署上线（2026-10-29 07:5x）——提交 `852d2cf` 已推 GitHub，knowledge-tracker 重启完成，现网文件 849/850 行确认含 p2pExempt。原卡点（本机脱离实验室 LAN）已恢复。
（2026-10-29 07:2x 桌面机脱离 LAN，SSH/3001 全不可达）。回到 LAN 后执行：
`cd ticket-pm/project-management-robot && npm run push` 即完成重启。
