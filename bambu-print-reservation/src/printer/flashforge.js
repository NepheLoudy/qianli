// ============================================================
// 闪铸（FlashForge）打印机客户端 —— 局域网协议适配层（2026-10-14，4A 拔线纯内网批）
//
// 协议来源：社区逆向文档 Parallel-7/flashforge-api-docs（AD5M/5M Pro 固件 3.2.7/5.1.8
// 实测校准）。打印机屏幕上需开启「LAN Only 模式」后端口才开放：
//   - TCP 8898  HTTP REST（/detail 状态、/control 指令、/uploadGcode、/printGcode）
//   - TCP 8080  MJPEG 摄像头流（5M Pro 等带屏机器；/detail 的 cameraStreamUrl 为准）
// 认证：序列号 + 检查码（checkCode，机身标签/屏幕设置页可见）——复用 .env 五件套的
//   PRINTER_SERIALS + PRINTER_ACCESS_CODES 字段（语义=serialNumber/checkCode）。
//
// 与 PrinterClient（拓竹）的接口对齐：connect/disconnect/on/getState/getPrintStatus/
// getAmsTrays/uploadBuffer/pausePrint/resumePrint/stopPrint/isStateStale/connected，
// manager.js 按品牌分派后两条链路共用同一状态机与分发引擎。
//
// 状态值全集（/detail.status）：ready / busy / heating / printing / pausing / pause /
// canceling / cancel / completed / calibrate_doing / downloading / cloud_slicing /
// sending / unzipping / error。
// 注意：Creator 5 Pro（四喷头）已于 2026-10-17 真机校准（SNMUPF9801164@192.168.2.226，
// 固件 1.9.9）——四喷头走 nozzleTemps/nozzleTargetTemps 数组（活动喷头=目标最高者）、
// 料站走 matlStationInfo.slotInfos（四槽）、层数走 printLayer/targetPrintLayer；
// 报文与 5M 系同构，字段差异均已按上口径归一并于 status.html 验证渲染。
// ============================================================

const fs = require('fs');

// /detail.status → 拓竹口径 gcodeState（manager.resolveJobEvent 只认这组值）
const STATUS_MAP = {
  printing: 'PRINTING',
  pause: 'PAUSE',
  pausing: 'PAUSE',
  completed: 'FINISH',
  error: 'FAILED',
  // 非打印态全部归 IDLE：ready/busy/heating/调平/下载/取消中——人工取消走
  // PRINTING→IDLE 的 'idle' jobEvent（既有幽灵收尾=失败重排通道），语义正好
  ready: 'IDLE',
  busy: 'IDLE',
  heating: 'IDLE',
  canceling: 'IDLE',
  cancel: 'IDLE',
  calibrate_doing: 'IDLE',
  downloading: 'IDLE',
  cloud_slicing: 'IDLE',
  sending: 'IDLE',
  unzipping: 'IDLE',
};

// 失联判定窗口（与拓竹侧 STATE_STALE_MS 同语义同默认）：轮询连续失败超时即失联
const STATE_STALE_MS = Number(process.env.PRINTER_STATE_STALE_MS || 3 * 60 * 1000);
// /detail 轮询间隔：状态观察 UI 的数据新鲜度下限（闪铸无推送，只能轮询）
const POLL_MS = Number(process.env.FLASHFORGE_POLL_MS || 5000);
// 单次 HTTP 超时：打印机半死时轮询不能挂死引擎（仅 /detail 等轻请求；上传/开打见下方专用值）
const HTTP_TIMEOUT_MS = 8000;
// 上传/开打专用超时（2026-10-18 A5P `terminated` 实案：1MB gcode 上传被 8s 掐断）
const UPLOAD_TIMEOUT_MS = Number(process.env.FF_UPLOAD_TIMEOUT_MS || 120 * 1000);
const PRINT_TIMEOUT_MS = Number(process.env.FF_PRINT_TIMEOUT_MS || 60 * 1000);

// Creator 5 料站调色板（2026-10-17 官方协议档案实锤，Creator 5 Filament Palette）：
// msConfig_cmd 的 mt 必须逐字命中 21 料名、rgb 必须带 # 且精确匹配 24 色（大小写敏感，
// 不匹配会静默存成 #FFFFFF）——写入前本地校验，避免静默白化。AD5M（A5P）无料站概念。
const FILAMENT_MATERIALS = [
  'PLA', 'PETG', 'PLA-CF', 'PETG-CF', 'ABS', 'ASA', 'SILK', 'PET-CF', 'PAHT-CF', 'S-PAHT',
  'S-Multi', 'PA-CF', 'HIPS', 'PVA', 'TPU-90A', 'TPU-95A', 'TPU-64D', 'PC', 'PA', 'PC-ABS', 'PPS-CF',
];
const FILAMENT_COLORS = [
  '#FFFFFF', '#FFF245', '#DEF578', '#21CC3D', '#167A4B', '#156682', '#24E4A0', '#7BD9F0',
  '#4CAAF8', '#2E54DD', '#48358C', '#A341F7', '#F435F6', '#D5B4DE', '#FA6173', '#F82D29',
  '#805003', '#F9903B', '#FCEBD7', '#D5C5A1', '#B17C38', '#8C8C89', '#BEBEBE', '#1B1B1B',
];

/** 料名/颜色校验并归一为调色板规范串（纯函数，单测覆盖）：mt 原样大写、rgb 取色盘规范大小写 */
function normalizeMatlChoice(type, colorHex) {
  const mt = String(type || '').trim().toUpperCase();
  if (!FILAMENT_MATERIALS.includes(mt)) {
    throw new Error(`料名「${type}」不在 Creator 5 调色板（21 料）：${FILAMENT_MATERIALS.join(' / ')}`);
  }
  const raw = `#${String(colorHex || '').replace(/^#/, '').toUpperCase()}`;
  const rgb = FILAMENT_COLORS.find((c) => c.toUpperCase() === raw);
  if (!rgb) {
    throw new Error(`颜色 ${raw} 不在 Creator 5 调色板（24 色）——固件会把非色盘值静默存成 #FFFFFF，请从色盘选择`);
  }
  return { mt, rgb };
}

class FlashforgeClient {
  constructor(printerConfig) {
    this.config = printerConfig;
    this.state = null;          // 最近一次 /detail 原始报文
    this.connected = false;     // 最近一轮轮询是否成功（有别于失联：5 分钟没轮到也算 stale）
    this.lastStateAt = 0;       // 失联判定依据
    this.listeners = [];
    this.pollTimer = null;
    this.polling = false;
    this.base = `http://${printerConfig.host}:8898`;
    this.auth = { serialNumber: printerConfig.serial || '', checkCode: printerConfig.accessCode || '' };
    this.consecutiveErrors = 0;
  }

  // ---------- 生命周期（轮询驱动，connect 语义=开始轮询） ----------

  async connect() {
    if (this.polling) return;
    if (!this.auth.serialNumber || !this.auth.checkCode) {
      console.warn(`[闪铸] ${this.config.name} 未配置序列号/检查码（PRINTER_SERIALS/PRINTER_ACCESS_CODES），跳过连接`);
      throw new Error('未配置序列号/检查码');
    }
    this.polling = true;
    this.notifyListeners('connecting');
    this.pollTimer = setInterval(() => this.pollOnce(), POLL_MS);
    // 首轮立即拉，不等第一个周期
    this.pollOnce();
  }

  async disconnect() {
    this.polling = false;
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
    this.connected = false;
    this.notifyListeners('disconnect');
  }

  on(event, callback) { this.listeners.push({ event, callback }); }
  off(event, callback) { this.listeners = this.listeners.filter((l) => !(l.event === event && l.callback === callback)); }
  notifyListeners(event, ...args) {
    this.listeners.forEach((l) => {
      if (l.event === event) {
        try { l.callback(...args); } catch (err) { console.error('[闪铸] 监听器错误:', err.message); }
      }
    });
  }

  // ---------- 轮询与状态归一 ----------

  async pollOnce() {
    let data = null;
    try {
      data = await this.postJson('/detail', this.auth);
      this.consecutiveErrors = 0;
      if (!this.connected) {
        this.connected = true;
        console.log(`[闪铸] ${this.config.name} 已连接`);
        this.notifyListeners('connect');
      }
    } catch (err) {
      this.consecutiveErrors += 1;
      if (this.consecutiveErrors === 1) {
        console.error(`[闪铸] ${this.config.name} 轮询失败:`, err.message);
      }
      // 从成功转失败即刻对外断开（轮询型连接没有半开态）
      if (this.connected) {
        this.connected = false;
        this.notifyListeners('disconnect');
      }
      return;
    }

    const prevGcodeState = this.state ? this.normalizedGcodeState() : '';
    // 实测真机 /detail 返回信封 {code:0, detail:{...}}（2026-10-16 A5P 真机接入实证）——
    // 此前直接存信封，状态字段全在静默吃默认值（温度/进度/进料口全空、状态兜底 IDLE）；
    // 兼容直接返回内层的固件
    this.state = (data && data.detail && typeof data.detail === 'object') ? data.detail : data;
    this.lastStateAt = Date.now();
    this.notifyListeners('state', data);

    const now = this.normalizedGcodeState();
    if (now !== prevGcodeState) {
      // 对齐拓竹侧语义：gcodeState 变迁对外发 stateUpdate（manager 只在 'state' 上
      // 驱动 jobEvent，闪铸整报文轮询直接走 'state' 通道即可，这里留给观察 UI 用）
      this.notifyListeners('stateUpdate', { gcodeState: now }, { gcodeState: prevGcodeState });
    }
  }

  normalizedGcodeState() {
    if (!this.state) return '';
    return STATUS_MAP[String(this.state.status || '').toLowerCase()] || 'IDLE';
  }

  /** raw state（/debug 用） */
  getState() { return this.state; }

  isStateStale() {
    return this.lastStateAt <= 0 || Date.now() - this.lastStateAt > STATE_STALE_MS;
  }

  /** 与 PrinterClient.getPrintStatus 同形状 */
  getPrintStatus() {
    if (!this.state) return null;
    const gcodeState = this.normalizedGcodeState();
    // 喷嘴取值（2026-10-17 C5P 真机校准）：四喷头机型有 nozzleTemps/nozzleTargetTemps
    // 等长数组，活动喷头 = 目标温度最高者（打印中即热头），全 0 时退当前温度最高者；
    // 无数组机型回 rightTemp 旧口径（A5P 保持）
    const pick = (() => {
      const cur = Array.isArray(this.state.nozzleTemps) ? this.state.nozzleTemps.map(Number) : [];
      const tgt = Array.isArray(this.state.nozzleTargetTemps) ? this.state.nozzleTargetTemps.map(Number) : [];
      if (cur.length) {
        let idx = 0;
        if (tgt.some((t) => t > 0)) idx = tgt.indexOf(Math.max(...tgt));
        else idx = cur.indexOf(Math.max(...cur));
        return {
          temp: Number.isFinite(cur[idx]) ? cur[idx] : null,
          target: Number.isFinite(tgt[idx]) ? tgt[idx] : null,
        };
      }
      return {
        temp: this.state.rightTemp != null ? Number(this.state.rightTemp) : null,
        target: this.state.rightTargetTemp != null ? Number(this.state.rightTargetTemp) : null,
      };
    })();
    return {
      gcodeState,
      status: GCODE_STATE_TEXT[gcodeState] || '空闲',
      // printProgress 0..1 → 百分比
      progress: Math.round((Number(this.state.printProgress) || 0) * 100),
      // estimatedTime = 剩余秒数
      remainingMinutes: Math.round((Number(this.state.estimatedTime) || 0) / 60),
      currentFile: this.state.printFileName || '',
      subtaskName: this.state.printFileName || '', // 回执丢失自愈对账用（与拓竹 subtask_name 同口径）
      nozzleTemp: pick.temp != null ? Math.round(pick.temp) : null, // 取整显示（真机回浮点 29.7000...）
      bedTemp: this.state.platTemp != null ? Math.round(Number(this.state.platTemp)) : null,
      chamberTemp: Number(this.state.chamberTemp) || null, // C5P 上报腔温（A5P 恒 0 → null 保持旧行为）
      nozzleTargetTemp: pick.target != null ? Math.round(pick.target) : null,
      bedTargetTemp: this.state.platTargetTemp != null ? Math.round(Number(this.state.platTargetTemp)) : null,
      // 层进度/速度倍率/存储在线（2026-10-17 C5P 校准时按 detail 同名字段补齐，A5P 同字段受益）
      layerNum: Number(this.state.printLayer) || 0,
      totalLayers: Number(this.state.targetPrintLayer) || 0,
      spdMag: this.state.printSpeedAdjust != null ? Number(this.state.printSpeedAdjust) || null : null,
      sdcard: this.state.remainingDiskSpace != null ? Number(this.state.remainingDiskSpace) > 0 : undefined,
      stateStale: this.isStateStale(),
    };
  }

  /**
   * 料站信息（前端与拓竹 AMS 盘同渲染）：
   *   C5P 四槽料站（2026-10-17 真机校准）= matlStationInfo.slotInfos → 槽1..槽4 彩色槽位，
   *   活动槽 = currentSlot；5M 系（A5P）= 左/右进料口（单口机型只有 right 字段，槽名落「进料口」）
   */
  getAmsTrays() {
    if (!this.state) return [];
    const ms = this.state.matlStationInfo;
    if (ms && Array.isArray(ms.slotInfos) && ms.slotInfos.length) {
      return ms.slotInfos.map((s) => ({
        slot: `槽${s.slotId}`,
        type: s.hasFilament ? (s.materialName || '未知') : '',
        colorHex: String(s.materialColor || '').replace(/^#/, ''),
        active: Number(ms.currentSlot) === Number(s.slotId),
        external: false,
      }));
    }
    const trays = [];
    const push = (slot, weight) => trays.push({
      slot,
      type: weight != null && Number(weight) > 0 ? `余量约${Math.round(Number(weight))}g` : '',
      colorHex: '',
      active: true,
      external: true,
    });
    const hasLeft = this.state.leftTemp != null || this.state.estimatedLeftWeight != null;
    const hasRight = this.state.rightTemp != null || this.state.estimatedRightWeight != null;
    if (hasLeft) push('左进料口', this.state.estimatedLeftWeight);
    if (hasRight) push(hasLeft ? '右进料口' : '进料口', this.state.estimatedRightWeight);
    return trays;
  }

  /** 设备信息（与 PrinterClient.getDeviceInfo 同形状）
   *  2026-10-16 真机接入修复：manager 的 handleStateChange 会直调本方法，缺失会让
   *  每次状态事件抛 TypeError 被监听层吞掉——整台机器状态永远流不进管理面
   *  2026-10-17 C5P 校准：固件号/喷嘴口径从 detail 直取（A5P 同字段受益；无字段机型保持 null） */
  getDeviceInfo() {
    const s = this.state || {};
    const nozzle = typeof s.nozzleModel === 'string' && s.nozzleModel
      ? s.nozzleModel.split(';')[0].replace(/mm$/i, '')
      : null;
    return {
      nozzleDiameter: nozzle || null,
      nozzleType: null,
      wifiDbm: null,
      fwVersion: s.firmwareVersion || null,
      amsHumidity: null,
    };
  }

  getCameraUrl() {
    return this.state && this.state.cameraStreamUrl
      ? this.state.cameraStreamUrl
      : `http://${this.config.host}:8080/?action=stream`; // 5M Pro 出厂默认；无摄像头机型代理层会 502
  }

  // ---------- 打印控制（/control + cmd/args 信封） ----------

  /**
   * /control 命令信封（2026-10-16 协议实锤）：**必须是 {cmd, args} 结构**——
   * 此前实现的「{命令名:{参数}}」形态被固件当未知命令名**静默忽略**（仍回
   * {"code":0,"message":"Success"}，2026-10-16 真机实证：灯控回 Success 但灯无动作；
   * 文档原话「An unknown command name is ignored and still answers Success」）。
   * 认证失败可区分：错 checkCode 回 {"code":1,"message":"Access code is different"}。
   */
  async sendCommand(cmd, args) {
    return this.postJson('/control', { ...this.auth, payload: JSON.stringify({ cmd, args }) });
  }

  async pausePrint() { return this.sendCommand('jobCtl_cmd', { jobID: '', action: 'pause' }); }
  async resumePrint() { return this.sendCommand('jobCtl_cmd', { jobID: '', action: 'continue' }); }
  async stopPrint() { return this.sendCommand('jobCtl_cmd', { jobID: '', action: 'cancel' }); }

  /**
   * 写料站槽位料信息（Creator 5 系列 msConfig_cmd，2026-10-17 协议档案线格式：
   * {cmd,args:{slot(1-4), mt(21 料逐字), rgb(# 前缀 24 色精确匹配)}}；调色板校验在
   * normalizeMatlChoice 内。⚠ 实测固件 1.9.9 对该命令「回 Success 但空转」——
   * 调用方必须用 /detail 回读判定成败，不得以回执当真。
   */
  async setMatlSlot(slotId, type, colorHex) {
    const { mt, rgb } = normalizeMatlChoice(type, colorHex);
    await this.sendCommand('msConfig_cmd', { slot: Number(slotId), mt, rgb });
    return { mt, rgb };
  }

  /** 腔灯（5M Pro 内置 LED；基础款 5M 无硬件但同样接受命令） */
  async lightControl(on) {
    return this.sendCommand('lightControl_cmd', { status: on ? 'open' : 'close' });
  }

  /** 清屏弹窗（打印完成/取消后屏幕弹窗会挡后续控制，文档口径）——等价屏幕上点掉弹窗 */
  async clearScreenDialog() {
    return this.sendCommand('stateCtrl_cmd', { action: 'setClearPlatform' });
  }

  /** 摄像头流开关（5M Pro 内置摄像头**需显式开流**：2026-10-16 实证——开流前 8080
   *  端口 TCP 通但 HTTP 零响应；streamCtrl_cmd open 后 MJPEG 正常出帧） */
  async startCameraStream() {
    return this.sendCommand('streamCtrl_cmd', { action: 'open' });
  }

  async stopCameraStream() {
    return this.sendCommand('streamCtrl_cmd', { action: 'close' });
  }

  // ---------- 文件分发（/uploadGcode + /printGcode） ----------

  /**
   * 上传打印文件到打印机 /data（gcode/gx/3mf）。printNow=false 仅上传，
   * 打印动作走 startFile（分发引擎两步式：先传后打，失败可重试不重传）。
   * 超时（2026-10-18 A5P 实案 `terminated` 修复）：**不能用 8s 轮询超时**——1MB gcode
   * 走嵌式 HTTP 分分钟超过 8s，被 AbortSignal 掐断即报「terminated」、分发失败重试；
   * 上传独立 120s（FF_UPLOAD_TIMEOUT_MS 可调），大文件也有余量
   */
  async uploadBuffer(buffer, fileName, { printNow = false, levelingBeforePrint = false } = {}) {
    const form = new FormData();
    form.append('gcodeFile', new Blob([buffer]), fileName);
    const headers = {
      serialNumber: this.auth.serialNumber,
      checkCode: this.auth.checkCode,
      fileSize: String(buffer.length),
      printNow: printNow ? 'true' : 'false',
      levelingBeforePrint: levelingBeforePrint ? 'true' : 'false',
    };
    const res = await this.rawFetch('/uploadGcode', { method: 'POST', headers, body: form }, UPLOAD_TIMEOUT_MS);
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 非 JSON 响应按原文报错 */ }
    // code!==0 一律失败（2026-10-18 A5P：busy=code:2，旧判据 >=400 会当成功继续开打）
    if (!res.ok || (data && data.code != null && Number(data.code) !== 0)) {
      const msg = (data && data.message) || text.slice(0, 200);
      const busyHint = Number(data && data.code) === 2
        ? '（打印机忙碌：屏幕可能停在打印完成/弹窗页——请在打印机屏幕上点掉后重试）'
        : '';
      throw new Error(`uploadGcode 失败(HTTP ${res.status}): ${msg}${busyHint}`);
    }
    return data;
  }

  /** 打印 /data 里已有的文件（分发引擎 uploadBuffer 后调用）——开打指令同样给长超时
   *  （固件要解析 gcode 并启动，8s 轮询口径不够；2026-10-18 A5P 实案） */
  async startFile(fileName, { levelingBeforePrint = false } = {}) {
    return this.postJson('/printGcode', {
      ...this.auth,
      fileName,
      levelingBeforePrint: levelingBeforePrint ? 'true' : 'false',
    }, PRINT_TIMEOUT_MS);
  }

  /** 远端文件清单（/gcodeList，观察台/分发去重用）——清单可能较大，放宽到 20s */
  async listFiles() {
    const data = await this.postJson('/gcodeList', this.auth, 20000);
    return (data && data.gcodeFileList) || [];
  }

  // ---------- HTTP 底座 ----------

  async rawFetch(pathname, options = {}, timeoutMs = HTTP_TIMEOUT_MS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(this.base + pathname, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async postJson(pathname, body, timeoutMs = HTTP_TIMEOUT_MS) {
    const res = await this.rawFetch(pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch {
      throw new Error(`闪铸 ${pathname} 响应非 JSON (HTTP ${res.status}): ${text.slice(0, 120)}`);
    }
    // 2026-10-18 A5P 实案：闪铸的业务失败码不止 >=400——「Printer is busy」是 **code:2**，
    // 旧判据（>=400）把它当成功放行（上传被拒却继续开打）。一律 code!==0 视为失败，
    // 并给 busy 附人话（固件在「打印完成」页时拒绝上传，屏幕点掉即恢复）
    if (!res.ok || (data && data.code != null && Number(data.code) !== 0)) {
      const msg = (data && data.message) || text.slice(0, 120);
      const busyHint = Number(data && data.code) === 2
        ? '（打印机忙碌：屏幕可能停在打印完成/弹窗页——请在打印机屏幕上点掉后重试）'
        : '';
      throw new Error(`闪铸 ${pathname} 失败 (HTTP ${res.status}): ${msg}${busyHint}`);
    }
    return data;
  }
}

// 拓竹侧 client.js 的 GCODE_STATE_MAP 中文语义，闪铸照抄保持前端一致
const GCODE_STATE_TEXT = {
  PRINTING: '打印中',
  PAUSE: '暂停',
  FINISH: '已完成',
  FAILED: '故障',
  IDLE: '空闲',
};

module.exports = FlashforgeClient;
module.exports.STATUS_MAP = STATUS_MAP;
module.exports.GCODE_STATE_MAP = GCODE_STATE_TEXT;
module.exports.FILAMENT_MATERIALS = FILAMENT_MATERIALS;
module.exports.FILAMENT_COLORS = FILAMENT_COLORS;
module.exports.normalizeMatlChoice = normalizeMatlChoice;
