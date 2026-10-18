const { BambuLink } = require('bambu-link');
const { Client: SSHClient } = require('ssh2');
const ftp = require('ftp');
const { Client: FTPSClient } = require('basic-ftp');
const net = require('net');
const tls = require('tls');
const { Readable } = require('stream');
const RtpsSession = require('./rtsps');

// 拓竹 AMS/外挂料信息写入预设表（2026-10-17 曼波令「编辑料信息=远程写打印机」）：
// ams_filament_setting 的 tray_info_idx 必须是有效预设 id（固件按预设取名称/温度），
// 通用 99 系为社区实绩（GFL99/GFG99/GFB99/GFU99/GFC99/GFS99/GFL98/GFB98），
// PETG-CF 用 GFG50（X1C 外挂槽实机观察值）。未知料型直接拒绝，避免固件侧错档。
const BAMBU_FILAMENT_PRESETS = {
  PLA: { idx: 'GFL99', min: 190, max: 230 },
  'PLA-CF': { idx: 'GFL98', min: 190, max: 230 },
  PETG: { idx: 'GFG99', min: 220, max: 260 },
  'PETG-CF': { idx: 'GFG50', min: 240, max: 270 },
  ABS: { idx: 'GFB99', min: 240, max: 270 },
  ASA: { idx: 'GFB98', min: 240, max: 270 },
  TPU: { idx: 'GFU99', min: 200, max: 250 },
  PC: { idx: 'GFC99', min: 250, max: 270 },
  PVA: { idx: 'GFS99', min: 190, max: 230 },
};

function normalizeFilamentType(type) {
  return String(type || '').toUpperCase().replace(/[\s_]+/g, '-').replace(/-+/g, '-');
}
function resolveFilamentPreset(type) {
  const key = normalizeFilamentType(type);
  return BAMBU_FILAMENT_PRESETS[key] ? { key, ...BAMBU_FILAMENT_PRESETS[key] } : null;
}

// gcodeState（打印机上报的 gcode_state）→ 统一中文状态
// RUNNING 是 H2 新固件的「打印执行中」态（2026-10-16 真机实测：H2D 打print时上报 RUNNING
// 而非 PRINTING；此前未收录被兜底成「空闲」——会把正在打印的机器误标为空闲/可派单）
const GCODE_STATE_MAP = {
  PRINTING: '打印中',
  RUNNING: '打印中',
  RESUME: '打印中',
  PAUSE: '暂停',
  FINISH: '已完成',
  FAILED: '故障',
  PREPARE: '准备中',
  SLICING: '切片中',
  IDLE: '空闲',
};

// 喷嘴温度解码（2026-10-16 热修·打印中打包值实锤）：H2 新固件**打印中**把
// device.extruder.info[].temp 改为 (target<<16)|current 打包值（实测：raw 14418139→14418140，
// 低 16 位=实时当前 219→220 随温度递增、高 16 位=打印目标 220 恒定；空闲态该字段为普通数值）。
// 大于 1000 的读数按打包解码，普通值原样返回——兼容两种固件形态
function decodeNozzleTemp(raw) {
  if (raw === null || raw === undefined || raw === '') return { current: null, target: null };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { current: null, target: null };
  if (n > 1000) return { current: n & 0xFFFF, target: n >>> 16 };
  return { current: n, target: null };
}

// 板型：切片产物 curr_bed_type（显示名）→ 开打帧 bed_type token（2026-10-16 曼波真单批）。
// 必须与切片一致：错配触发 H2 板检测警告/暂停（[0500-8051]，textured_plate 硬编码教训）；
// token 从 OrcaSlicer.dll 实锤：cool_plate / hot_plate / textured_plate / supertack_plate；
// 「Smooth PEI Plate」为高温板新名，同 hot_plate
const BED_TYPE_TOKENS = {
  'Textured PEI Plate': 'textured_plate',
  'High Temp Plate': 'hot_plate',
  'Smooth PEI Plate': 'hot_plate',
  'Cool Plate': 'cool_plate',
  'Cool Plate SuperTack': 'supertack_plate',
  'Supertack Plate': 'supertack_plate',
  'Engineering Plate': 'engineering_plate',
};

// 文件传输超时：挂起的上传会把分发引擎的串行匹配段永久卡死
const SFTP_TIMEOUT_MS = 120 * 1000;
const FTP_TIMEOUT_MS = 60 * 1000;
const FTPS_TIMEOUT_MS = 90 * 1000;

// 失联判定窗口（PRINTER_STATE_STALE_MS 可配，默认 3 分钟）：超过该时长未收到任何
// state 报文即视为失联。幽灵空闲防护——bambu-link 从不 emit 'disconnect'，
// connected 置 true 后永不回落，打印机断电/断网后仍按最后一条 state 显示「空闲」，
// 分发引擎会继续选中它空跑分发；必须以报文新鲜度兜底，不依赖库的断开事件
const STATE_STALE_MS = Number(process.env.PRINTER_STATE_STALE_MS || 3 * 60 * 1000);

class PrinterClient {
  constructor(printerConfig) {
    this.config = printerConfig;
    this.client = null;
    this.state = null;
    this.connected = false;
    this.connecting = false;
    // 最近一次收到 state 报文的时间戳（失联判定依据，见 isStateStale）
    this.lastStateAt = 0;
    this.listeners = [];
    this.ftpClient = null;
    this.ftpsClient = null;
    this.sshClient = null;
    // 最近一次含 device 域的全量片段缓存（2026-10-16 双喷头）：device.extruder/nozzle
    // 只在低频全量报文中出现，state.raw 仅存最后一条增量——必须累存，否则增量一到就丢
    this.lastDevice = null;
    // AMS 原始域缓存（2026-10-16 数据面全量排查）：ams[].{humidity,temp,dry_time,dry_setting}
    // 等单元级字段不在归一化产物里，同样累存原始结构
    this.lastAms = null;
    // project_file 命令的序号从高段位起，避免与 bambu-link 内部序号撞车
    this.projectSeq = 10000 + Math.floor(Math.random() * 1000);
  }

  /** device/ams 域累存（增量报文携带片段时刷新缓存） */
  _cacheDevice(msg) {
    try {
      const dev = msg && msg.print && msg.print.device;
      if (dev && typeof dev === 'object') {
        this.lastDevice = { ...(this.lastDevice || {}), ...dev };
      }
      const ams = msg && msg.print && msg.print.ams;
      if (ams && typeof ams === 'object') {
        this.lastAms = ams; // ams 整体替换（数组结构，逐键合并会错位）
      }
    } catch { /* 忽略 */ }
  }

  /**
   * AMS 单元级数据（2026-10-16 数据面全量排查）：湿度双值/AMS 内温/烘干状态与设置。
   * 返回 [{id, humidity, humidityRaw, temp, dryTime, drySetting}]——单 AMS 或空数组
   */
  getAmsUnits() {
    const amsRoot = this.lastAms || (this.getState()?.raw?.print?.ams);
    const units = amsRoot && Array.isArray(amsRoot.ams) ? amsRoot.ams : [];
    return units.map((u) => ({
      id: Number(u.id) || 0,
      humidity: u.humidity != null ? Number(u.humidity) || null : null,       // 档位 1-5
      humidityRaw: u.humidity_raw != null ? Number(u.humidity_raw) || null : null, // 原始 %
      temp: u.temp != null ? Number(u.temp) : null,                           // AMS 内温 °C
      dryTime: u.dry_time != null ? Number(u.dry_time) || 0 : 0,              // 烘干剩余（分钟）
      drySetting: u.dry_setting || null,                                      // {dry_duration, dry_filament, dry_temperature}
    }));
  }

  /**
   * 命令 topic 按机型修正（2026-10-15 H2D 真机实锤，全链最后一公里）：
   * H2 系新固件只处理 device/{SN}/request 上的命令——发到 report 的命令被静默忽略
   * （只回显不执行，把「echo 回包」伪装成成功；灯控/温度/开打全中招）。
   * P1/A1 老固件 report 单 topic 收发（既有验证保持）。X1 未实测按新一代处理。
   * 注意时序：必须在 MQTT 订阅建立（BambuLink connect 完成）之后再 patch——
   * dataUpdateTopic 同时管订阅与发布，早改会订错 topic。
   */
  _patchCommandTopic() {
    const model = String(this.config.model || '').toUpperCase();
    if (!/H2|X1/.test(model)) return;
    try {
      const mqttClient = this.client.getMqttClient();
      mqttClient.dataUpdateTopic = `device/${this.config.serial}/request`;
      console.log(`[打印机] ${this.config.name}（${model}）命令通道切 request topic（新固件口径）`);
    } catch (err) {
      console.warn(`[打印机] ${this.config.name} 命令 topic 修正失败:`, err.message);
    }
  }

  /**
   * 统一命令发送 + 回包 result 校验（2026-10-15 H2 真机实锤）：
   * 打印机对失败命令回 {"result":"fail"/"FAIL","reason":"..."}（system 域小写、print 域大写），
   * 而 bambu-link sendCommand 只按 sequence 匹配就 resolve——不校验 result 就会重演
   * 「echo 伪装成功」（UI 显示已下发、打印机实际未执行）。
   * opts.stringSeq：system 域（ledctrl）新世代要求字符串 sequence_id；print 域用数字。
   */
  async _sendChecked(payload, sequenceId, opts = {}) {
    const seqForSend = opts.stringSeq ? String(sequenceId) : sequenceId;
    const resp = await this.client.getMqttClient().sendCommand(JSON.stringify(payload), seqForSend, true);
    const r = (resp && (resp.print || resp.system)) || {};
    if (String(r.result || '').toUpperCase() === 'FAIL') {
      throw new Error(`打印机拒绝命令（${r.command || '?'}）: ${r.reason || '未知原因'}`);
    }
    return resp;
  }

  async connect() {
    if (this.connecting) return;
    if (this.connected) return;

    this.connecting = true;

    try {
      this.client = new BambuLink(
        this.config.accessCode,
        this.config.host,
        0,
        8883,
        this.config.serial
      );

      this.client.on('connect', () => {
        this.connected = true;
        this.connecting = false;
        console.log(`[打印机] ${this.config.name} 已连接`);
        this._patchCommandTopic();
        this.notifyListeners('connect');
      });

      this.client.on('disconnect', () => {
        this.connected = false;
        console.log(`[打印机] ${this.config.name} 已断开连接`);
        this.notifyListeners('disconnect');
      });

      this.client.on('state', (state) => {
        this.lastStateAt = Date.now();
        this.state = state;
        this._cacheDevice(state);
        this.notifyListeners('state', state);
      });

      this.client.on('stateUpdate', (patch, previousState) => {
        // 增量报文同样证明连接存活，一并刷新新鲜度
        this.lastStateAt = Date.now();
        this._cacheDevice(patch);
        this.notifyListeners('stateUpdate', patch, previousState);
      });

      this.client.on('error', (err) => {
        // 认证类错误的诊断提示（2026-10-15 实案：Access Code 轮换致 MQTT/RTSPS 同拒）
        const authHint = /not author|unauthor|401/i.test(err.message || '')
          ? '——凭据被拒：Access Code 可能已轮换/失效，请到打印机屏幕「设置→网络」抄新码并更新 .env 后重启'
          : '';
        console.error(`[打印机] ${this.config.name} 错误:${err.message}${authHint}`);
        this.notifyListeners('error', err);
      });

      await this.client.connect();
    } catch (err) {
      this.connecting = false;
      console.error(`[打印机] ${this.config.name} 连接失败:`, err.message);
      throw err;
    }
  }

  async disconnect() {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (err) {
        console.error(`[打印机] ${this.config.name} 断开连接失败:`, err.message);
      }
    }
    this.connected = false;
    this.client = null;
    await this.disconnectFileSession();
  }

  on(event, callback) {
    this.listeners.push({ event, callback });
  }

  off(event, callback) {
    this.listeners = this.listeners.filter(
      (l) => !(l.event === event && l.callback === callback)
    );
  }

  notifyListeners(event, ...args) {
    this.listeners.forEach((l) => {
      if (l.event === event) {
        try {
          l.callback(...args);
        } catch (err) {
          console.error(`[打印机] 监听器错误:`, err.message);
        }
      }
    });
  }

  getState() {
    if (!this.client) return null;
    return this.client.getFullState();
  }

  getPrinterInfo() {
    return this.config;
  }

  /**
   * 是否失联：超过 STATE_STALE_MS 未收到任何 state 报文（含从未收到过）。
   * bambu-link 无可靠的 disconnect 事件，选机与状态展示以此兜底判定
   */
  isStateStale() {
    return this.lastStateAt <= 0 || Date.now() - this.lastStateAt > STATE_STALE_MS;
  }

  /**
   * 归一化打印状态：以 gcode_state 为准（job.stage 是数值型 mc_print_stage，判不准）
   */
  getPrintStatus() {
    const state = this.getState();
    if (!state) return null;

    const job = state.job || {};
    const temps = state.temps || {};
    const gcodeState = String(state.gcodeState || 'IDLE').toUpperCase();
    // spd_lvl 不在 bambu-link 的归一化字段里，从原始报文取（"1"~"4"）
    const spdRaw = state.raw && state.raw.print ? state.raw.print.spd_lvl : null;
    const speedLevel = spdRaw != null ? Number(spdRaw) || null : null;

    return {
      gcodeState,
      status: GCODE_STATE_MAP[gcodeState] || '空闲',
      progress: job.percent || 0,
      // mc_remaining_time 单位是分钟（bambu-link 误命名为 remainingSeconds，勿再除以 60）
      remainingMinutes: job.remainingSeconds || 0,
      currentFile: job.file || '',
      nozzleTemp: temps.nozzle || null,
      bedTemp: temps.bed || null,
      chamberTemp: temps.chamber || null,
      // 目标温度/风扇/速度档/灯：全量报文才带，增量报文里是 undefined → 保持 null
      nozzleTargetTemp: temps.nozzleTarget ?? null,
      bedTargetTemp: temps.bedTarget ?? null,
      fans: state.fans ? { part: state.fans.part ?? null, aux: state.fans.aux ?? null, chamber: state.fans.chamber ?? null } : null,
      speedLevel,
      lights: state.lights ? { chamber: state.lights.chamber || null, work: state.lights.work || null } : null,
      // 机器助手报错事件（2026-10-15 曼波令上界面）：HMS 硬件通知 + 打印错误/失败码
      // （原始码展示；HMS 码文本映射见前端 HMS_KNOWN 表，未知码引导看屏）
      hms: Array.isArray(state.raw?.print?.hms) ? state.raw.print.hms.slice(0, 6) : [],
      // 多喷头（2026-10-16 曼波令；H2D 双喷头真机形态：device.extruder.info 各喷头温度、
      // device.nozzle.info 规格、device.nozzle.tar_id 活动喷头）——单喷头机型为 null
      nozzles: (() => {
        const dev = this.lastDevice || (state.raw?.print?.device) || {}; // 累存优先（增量不含 device）
        const exs = dev.extruder?.info || [];
        if (!Array.isArray(exs) || exs.length === 0) return null;
        const specs = dev.nozzle?.info || [];
        // 活动喷头判定（2026-10-16 修正）：顶层 print.nozzle_temper/target 始终跟随**实际打印喷头**
        // （实测打印中 tar_id 指向冷喷头=不可靠、顶层 220° 与热喷头一致）——按各喷头实温与顶层
        // 值最近者判活动，无法比对时退回 tar_id
        const activeId = (() => {
          const top = Number(temps.nozzle);
          if (Number.isFinite(top)) {
            let best = null;
            let bestD = Infinity;
            for (const e of exs) {
              const c = decodeNozzleTemp(e.temp).current;
              if (c === null) continue;
              const d = Math.abs(c - top);
              if (d < bestD) { bestD = d; best = Number(e.id); }
            }
            if (best !== null) return best;
          }
          return Number(dev.nozzle?.tar_id ?? NaN);
        })();
        return exs.map((e) => {
          const spec = specs.find((n) => Number(n.id) === Number(e.id)) || {};
          const isActive = Number(e.id) === activeId;
          const dec = decodeNozzleTemp(e.temp);
          return {
            id: Number(e.id),
            temp: dec.current,
            // 目标温度：活动喷头取顶层独立上报（权威单值）；副喷头用打包值内的目标（打印中才有）
            target: isActive ? (temps.nozzleTarget ?? dec.target) : dec.target,
            diameter: Number(spec.diameter) || null,
            type: spec.type || null,
            active: isActive,
            // 左右喷嘴语义（2026-10-16 实机实证修正，旧映射作废）：**extruder 1 = 左喷嘴（外挂料盘）、
            // extruder 0 = 右喷嘴（AMS）**——依据：运行中打印的热喷头=id1 且其料位指向外挂（snow=254）、
            // 用户口径「左喷嘴是外挂料盘」双重印证（旧 Orca 机档数组顺序推导有误）；单喷头机型不标
            side: exs.length >= 2 ? (Number(e.id) === 0 ? 'right' : Number(e.id) === 1 ? 'left' : null) : null,
          };
        });
      })(),
      printError: Number(state.raw?.print?.print_error) || 0,
      failReason: Number(state.raw?.print?.fail_reason) || 0,
      // ---- 数据面全量排查批（2026-10-16 曼波令：打印机与 AMS 全部数据接入）----
      layerNum: Number(state.raw?.print?.layer_num) || 0,          // 当前层
      totalLayers: Number(state.raw?.print?.total_layer_num) || 0, // 总层数
      subtaskName: state.raw?.print?.subtask_name || '',           // 任务名（比 gcode 文件名友好）
      printType: state.raw?.print?.print_type || '',               // local | cloud | system（维护任务）
      spdMag: state.raw?.print?.spd_mag != null ? Number(state.raw.print.spd_mag) || null : null, // 速度倍率 %
      queueTotal: Number(state.raw?.print?.queue_total) || 0,      // 机内队列长度
      sdcard: state.raw?.print?.sdcard === true,                   // 存储在线
      // 失联标注：true 表示该状态来自过期报文（幽灵空闲防护，选机侧会过滤）
      stateStale: this.isStateStale(),
    };
  }

  /**
   * AMS + 外部料架的耗材清单
   * @returns {Array<{slot: string, type: string, colorHex: string, active: boolean, external: boolean}>}
   */
  getAmsTrays() {
    const state = this.getState();
    if (!state) return [];

    const trays = [];
    const ams = state.ams;
    const trayNow = ams ? ams.trayNow : null;

    if (ams && ams.trays) {
      for (const tray of Object.values(ams.trays)) {
        if (!tray) continue;
        // 254=外部料架（vt_tray，bambu-link 解析里 external: tid === 254），
        // 不在 4 位位图内，由下方 vtTray 分支单独处理
        if (Number(tray.id) === 254) continue;
        // existBits（ams_exist_bits）标记各槽是否实际插着料盒，'1111' 从左到右。
        // 槽位 0 基（0..3）：bambu-link 直接以打印机上报的 tray.id 作键（0..3），
        // 位图第 N 位即 tray.id=N，故直接 charAt(tray.id)，勿再减 1
        const installed = ams.existBits
          ? String(ams.existBits).charAt(tray.id) !== '0'
          : true;
        if (!installed) continue;
        trays.push({
          slot: `AMS ${tray.id}`,
          type: tray.type || '',
          colorHex: tray.colorHex ? String(tray.colorHex).slice(0, 6) : '',
          active: trayNow === tray.id,
          external: false,
          amsId: 0,     // AMS 单元 id（开打帧 ams_mapping2 用；单台 AMS 恒 0）
          trayId: tray.id, // 单元内槽位（0..3）
          remain: tray.remain ?? null, // 剩余料量（百分比，AMS UI 显示）
        });
      }
    }

    // H2 新世代外部料位（2026-10-16 曼波令）：不在 AMS 域，走 print.vir_slot——
    // 254=外挂料盘·左 / 255=外挂料盘·右（虚拟料位，Bambuddy 同口径）；
    // 老世代（X1/P1）单外部料架仍在 ams 域 vt_tray，保留兜底
    const vir = state.raw && state.raw.print ? state.raw.print.vir_slot : null;
    let extFound = false;
    if (Array.isArray(vir)) {
      for (const v of vir) {
        const vid = Number(v && v.id);
        if (!Number.isFinite(vid) || vid < 254) continue;
        const cols = Array.isArray(v.cols) && v.cols[0] ? String(v.cols[0]).slice(0, 6) : '';
        if (!v.tray_type && !cols) continue; // 空位不展示
        extFound = true;
        trays.push({
          slot: vid === 254 ? '外挂料盘·左' : vid === 255 ? '外挂料盘·右' : `外挂料盘·${vid}`,
          type: v.tray_type || '',
          colorHex: cols,
          active: trayNow === vid,
          external: true,
          amsId: vid, // 开打帧虚拟料位 id（254=左 / 255=右）
          trayId: 0,
          remain: Number.isFinite(Number(v.remain)) && Number(v.remain) > 0 ? Number(v.remain) : null,
        });
      }
    }
    const vt = state.vtTray;
    if (!extFound && vt && vt.type) {
      trays.push({
        slot: '外部料架',
        type: vt.type || '',
        colorHex: vt.colorHex ? String(vt.colorHex).slice(0, 6) : '',
        active: trayNow === 254,
        external: true,
        amsId: 254, // 老世代外部料架按虚拟料位 254 映射
        trayId: 0,
      });
    }

    return trays;
  }

  // ============ 打印控制 ============

  async startPrint(filePath) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    return this.client.printGcode_file(filePath);
  }

  /**
   * 直接下发 3mf 打印任务（切片参数随文件）。
   * 双口径（2026-10-15 H2D 真机实锤）：
   *   新世代 H2/X1：url=ftp:///<name>（FTPS 根）、完整字段集（file/bed_type/校准标志/
   *     ams_mapping2 等），命令走 request topic（_patchCommandTopic）
   *   老世代 P1/A1：url=ftp:///sdcard/<name>、简版帧、report 单 topic
   */
  async startProjectFile(fileName, subtaskName, useAms = true, prefTray = null, frameOpts = {}) {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    const isNewGen = /H2|X1/.test(String(this.config.model || '').toUpperCase());
    // 审批分发指定槽位（2026-10-16 曼波令）：ams_mapping2 指向指定 AMS/槽位——
    // 未指定时维持默认 [{ams_id:0, slot_id:0}]（打印机按切片/自动映射）
    const mapAms = prefTray && Number.isInteger(prefTray.amsId) && Number.isInteger(prefTray.trayId)
      ? { ams_id: prefTray.amsId, slot_id: prefTray.trayId }
      : { ams_id: 0, slot_id: 0 };
    // 开打参数（2026-10-16 曼波真单批）：bed_type 取切片 curr_bed_type 映射（板型与切片
    // 一致是硬要求）；ams_mapping2 支持逐用料映射（dispatcher 按文件用料清单算出，见 buildAmsMapping）
    const bedTok = BED_TYPE_TOKENS[String(frameOpts.bedTypeName || '').trim()] || null;
    if (frameOpts.bedTypeName && !bedTok) {
      console.warn(`[打印机] 未知板型「${frameOpts.bedTypeName}」——按 textured_plate 下发，可能触发板检测提示`);
    }
    const mapping2 = Array.isArray(frameOpts.amsMapping2) && frameOpts.amsMapping2.length
      ? frameOpts.amsMapping2
      : [mapAms];
    const legacyMap = Array.isArray(frameOpts.amsMapping) && frameOpts.amsMapping.length
      ? frameOpts.amsMapping
      : mapping2.map((m) => (m.ams_id >= 254 ? m.ams_id : m.ams_id * 4 + m.slot_id));
    const sequenceId = ++this.projectSeq;
    const payload = isNewGen
      ? {
          print: {
            sequence_id: sequenceId,
            command: 'project_file',
            param: 'Metadata/plate_1.gcode',
            url: `ftp:///${fileName}`,
            file: fileName,
            md5: '',
            // 板型必须与切片产物 curr_bed_type 一致（错配在 H2 上触发板检测
            // [0500-8051] 暂停——2026-10-15 真机实锤；2026-10-16 起按文件动态取，
            // 硬编码仅作无元数据兜底）
            bed_type: bedTok || 'textured_plate',
            timelapse: false,
            bed_leveling: true,
            auto_bed_leveling: 1,
            flow_cali: false,
            vibration_cali: true,
            layer_inspect: false,
            use_ams: useAms,
            cfg: '0',
            extrude_cali_flag: 2,
            extrude_cali_manual_mode: 0,
            nozzle_offset_cali: 2,
            subtask_name: subtaskName || fileName,
            profile_id: '0',
            project_id: String(sequenceId),
            subtask_id: String(sequenceId),
            task_id: String(sequenceId),
            ams_mapping: legacyMap,
            ams_mapping2: mapping2,
          },
        }
      : {
          print: {
            sequence_id: sequenceId,
            command: 'project_file',
            param: '',
            url: `ftp:///sdcard/${fileName}`,
            subtask_name: subtaskName || fileName,
            use_ams: useAms,
            md5: '',
          },
        };
    return this._sendChecked(payload, sequenceId);
  }

  async pausePrint() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'pause', param: '' } }, sequenceId);
  }

  async resumePrint() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'resume', param: '' } }, sequenceId);
  }

  async stopPrint() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'stop', param: '' } }, sequenceId);
  }

  /**
   * 写 AMS/外挂槽料信息到打印机本地（2026-10-17 曼波令：编辑=远程覆盖打印机数据，
   * 不是本地显示层遮罩）。协议：print.ams_filament_setting（OpenBambuAPI + 社区实绩），
   * 2026-10-17 X1C/H2D 真机闭环验证（写入→回执 success→状态回读→还原）：
   *   - **必带 slot_id**：缺了它外挂槽「无回执且不生效」（AMS 槽侥幸生效——本轮实锤）；
   *   - 槽位映射：AMS 槽 = ams_id 单元/tray_id 槽位/slot_id 同 tray_id；单外挂机型
   *     = ams_id 255 / tray_id 254（全局索引）；H2D 双外挂 = 各为独立虚拟单元
   *     （vir_slot id 254/255 → ams_id 同值、tray_id 0，Bambuddy 抓包口径）；
   *   - tray_color 必须大写 RRGGBBAA（小写会被固件清零且回 success）；
   *   - 回执 result=fail 会由 _sendChecked 抛错；回执丢失按超时返回 noAck，
   *     交由调用方以状态回读判定（固件可能「受理但忽略」）。
   */
  async setAmsFilament({ slot, type, colorHex }) {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const tray = this.getAmsTrays().find((t) => t.slot === slot);
    if (!tray) throw new Error(`未找到槽位「${slot}」`);
    const preset = resolveFilamentPreset(type);
    if (!preset) {
      throw new Error(`不支持的料类型「${type}」——可选：${Object.keys(BAMBU_FILAMENT_PRESETS).join(' / ')}`);
    }
    const hex = String(colorHex || '').replace(/^#/, '').toUpperCase();
    if (!/^[0-9A-F]{6}$/.test(hex)) throw new Error('颜色须为 6 位十六进制');
    let amsId;
    let trayId;
    let slotId;
    if (tray.external) {
      const vir = this.state && this.state.raw && this.state.raw.print ? this.state.raw.print.vir_slot : null;
      if (Array.isArray(vir) && vir.length > 1) {
        // H2D 双外挂：每个外挂槽是独立虚拟 AMS 单元（254=左 / 255=右）
        amsId = Number(tray.amsId) >= 254 ? Number(tray.amsId) : 254;
        trayId = 0;
      } else {
        // 单外挂（X1C/P1S/A1）：全局 tray_id=254
        amsId = 255;
        trayId = 254;
      }
      slotId = 0;
    } else {
      amsId = Number(tray.amsId) || 0;
      trayId = Number(tray.trayId) || 0;
      slotId = trayId;
    }
    const sequenceId = ++this.projectSeq;
    const payload = {
      print: {
        sequence_id: sequenceId,
        command: 'ams_filament_setting',
        ams_id: amsId,
        tray_id: trayId,
        slot_id: slotId,
        tray_info_idx: preset.idx,
        tray_type: preset.key,
        tray_sub_brands: '',
        tray_color: `${hex}FF`,
        nozzle_temp_min: preset.min,
        nozzle_temp_max: preset.max,
      },
    };
    try {
      await this._sendChecked(payload, sequenceId);
      return { ack: true };
    } catch (err) {
      // 回执超时（bambu-link 10s）不算失败：部分固件不回执，交由状态回读判定
      if (/timeout/i.test(err.message || '')) return { ack: false, noAck: true };
      throw err;
    }
  }

  /**
   * 清除打印错误残留（2026-10-16 曼波真单批，v2 状态验证链）：H2 固件在打印被取消/失败后
   * 会把 gcode_state=FAILED + task_id/fail_reason 挂住（屏幕首页无报错也照样回传）——
   * 该残留会挡住分发匹配（白名单仅空闲/已完成）。
   * 教训（Bambuddy 同源事故 #2598）：`result: success` 只代表指令被机器收下，**不代表状态
   * 变化**——必须用 gcodeState 实际离开 FAILED 判定（2026-10-16 实测：clean_print_error 与
   * stop 均回执 success 但状态纹丝不动，单发试不出对错，必须逐候选验证）。
   * 候选按「真实失败码 → 0 值 → 仅 subtask_id → stop」逐发，每发后轮询状态 ≤12s；
   * 全无效再等 20s 复查（H2 状态转换慢是已知特性）。机器已停止时各指令均无物理动作；
   * 调用方须先过状态门（打印中/暂停/准备中禁止）。
   * @returns {Promise<{cleared:boolean, command:string|null, fields:string[], state:string, tried:string[]}>}
   */
  async cleanPrintError() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const raw = (this.getState() && this.getState().raw && this.getState().raw.print) || {};
    const subtaskId = String(raw.subtask_id || raw.task_id || '');
    const failCode = Number(raw.fail_reason) || Number(raw.print_error) || 0;
    const candidates = [
      { command: 'clean_print_error', body: { subtask_id: subtaskId, print_error: failCode } },
      { command: 'clean_print_error', body: { subtask_id: subtaskId, print_error: 0 } },
      { command: 'clean_print_error', body: { subtask_id: subtaskId } },
      { command: 'stop', body: {} },
    ];
    const stateNow = () => {
      const s = this.getPrintStatus();
      return s ? s.gcodeState : '';
    };
    const tried = [];
    const pollOut = async (maxPolls) => {
      for (let i = 0; i < maxPolls; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        if (stateNow() !== 'FAILED') return true;
      }
      return false;
    };
    for (const cand of candidates) {
      const sequenceId = ++this.projectSeq;
      const tag = `${cand.command}${Object.keys(cand.body).length ? ' ' + JSON.stringify(cand.body) : ''}`;
      try {
        await this._sendChecked({ print: { sequence_id: sequenceId, command: cand.command, ...cand.body } }, sequenceId);
        tried.push(`${tag}→受理`);
      } catch (err) {
        tried.push(`${tag}→拒收(${String(err.message).slice(0, 40)})`);
        continue; // 拒收直接换下一形态
      }
      if (await pollOut(6)) {
        console.log(`[打印机] 清错误残留成功（${tag}）→ ${stateNow()}`);
        return { cleared: true, command: cand.command, fields: Object.keys(cand.body), state: stateNow(), tried };
      }
    }
    // 慢转换兜底：全部形态发完后再等 20s 复查（H2 状态转换慢）
    if (await pollOut(10)) {
      console.log('[打印机] 清错误残留成功（延迟生效）');
      return { cleared: true, command: '（延迟生效）', fields: [], state: stateNow(), tried };
    }
    console.warn(`[打印机] 清错误残留未生效：${tried.join('；')}`);
    return { cleared: false, command: null, fields: [], state: stateNow(), tried };
  }

  /**
   * 灯控制（观察台指令条）。
   * 双口径（2026-10-15 H2 真机实测实锤，全部格式矩阵扫过）：
   *   H2/X1 新世代：**字符串 sequence_id**、时间字段四件套 led_on_time/led_off_time/
   *     loop_times/interval_time——旧格式（数字 seq + led_time）一律回
   *     {"result":"fail","reason":"json wrong format"}
   *   P1/A1 老世代：数字 seq、led_time（既有验证保持）
   * 节点名按机型（2026-10-16 X1C 真机实证）：**chamber_light2 是 H2D 专用副腔灯节点**，
   * X1C 只有 chamber_light / work_light——旧代码把 X1 也发 chamber_light2 被拒
   * 「did not find the valid led: chamber_light2」（生产错误日志实锤）。
   */
  async lightControl(on, lamp = 'chamber_light') {
    if (!this.client || !this.connected) {
      throw new Error('打印机未连接');
    }
    const model = String(this.config.model || '').toUpperCase();
    const isNewGen = /H2|X1/.test(model);
    const sequenceId = ++this.projectSeq;
    if (isNewGen) {
      // H2D 三灯节点：chamber_light（主腔灯）/ work_light（工作灯）/ chamber_light2（副腔灯）
      // 端点「腔灯」= H2D 的 chamber_light2、X1C 的 chamber_light（2026-10-15 H2D 节点-响应
      // 对照实测 + 2026-10-16 X1C lights_report 实证）；工作灯两机同 name
      const node = lamp === 'work_light' ? 'work_light' : (/^H2/.test(model) ? 'chamber_light2' : 'chamber_light');
      return this._sendChecked({
        system: {
          sequence_id: String(sequenceId),
          command: 'ledctrl',
          led_node: node,
          led_mode: on ? 'on' : 'off',
          led_on_time: 1000,
          led_off_time: 1000,
          loop_times: 1,
          interval_time: 1000,
        },
      }, sequenceId, { stringSeq: true });
    }
    const node = lamp === 'work_light' ? 'work_light' : 'chamber_light';
    return this._sendChecked({
      system: {
        sequence_id: sequenceId,
        command: 'ledctrl',
        led_node: node,
        led_mode: on ? 'on' : 'off',
        led_time: 600,
      },
    }, sequenceId);
  }

  // ============ 全量远控（2026-10-15 观察台 v55；v56 复查批统一自组帧+回包校验）============
  // 全部走 _sendChecked（request topic + result 校验）；参数校验前置（未连接也先报参数错，
  // 前端 400/409 语义区分）。危险面（轴动/回原点/校准/退料）的状态门控在 manager/端点层。

  /** 打印速度档：1 静默 / 2 标准 / 3 竞速 / 4 疯狂 */
  async setSpeed(level) {
    const n = Number(level);
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      throw new Error('速度档必须是 1-4 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'speed', param: n } }, sequenceId);
  }

  /** 风扇速度：kind = PART(模型扇 P1) / AUX(辅助扇 P2) / CHAMBER(腔室扇 P3)，0-255 */
  async setFanSpeed(kind, speed) {
    const K = String(kind || '').toUpperCase();
    if (!['PART', 'AUX', 'CHAMBER'].includes(K)) {
      throw new Error('风扇类型必须是 part/aux/chamber');
    }
    const s = Number(speed);
    if (!Number.isInteger(s) || s < 0 || s > 255) {
      throw new Error('风扇速度必须是 0-255 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const fans = { PART: 1, AUX: 2, CHAMBER: 3 };
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({
      print: { sequence_id: sequenceId, command: 'gcode_line', param: `M106 P${fans[K]} S${s}\n` },
    }, sequenceId);
  }

  /** gcode 直控：单条（可多行）原始 G-code 下发 */
  async sendGcode(line) {
    const g = String(line || '').trim();
    if (!g) throw new Error('gcode 不能为空');
    if (g.length > 800) throw new Error('gcode 过长（>800 字符）');
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({
      print: { sequence_id: sequenceId, command: 'gcode_line', param: g.endsWith('\n') ? g : g + '\n' },
    }, sequenceId);
  }

  /** 校准：full=全量；level=自动调平、vib=振动补偿（option 位 1/2） */
  async calibration(option) {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    if (option === undefined || option === null || option === 'full') {
      return this._sendChecked({ print: { sequence_id: sequenceId, command: 'calibration', param: '' } }, sequenceId);
    }
    const OPT = { level: 1, vib: 2 };
    const v = OPT[option];
    if (!v) throw new Error('校准类型必须是 full/level/vib');
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'calibration', option: v } }, sequenceId);
  }

  async home() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'gcode_line', param: 'G28\n' } }, sequenceId);
  }

  /** 轴相对移动：axis X/Y/Z，distance mm（带符号）；Z 轴限低速防撞 */
  async moveAxis(axis, distance) {
    const A = String(axis || '').toUpperCase();
    if (!['X', 'Y', 'Z'].includes(A)) {
      throw new Error('轴必须是 x/y/z');
    }
    const d = Number(distance);
    if (!Number.isFinite(d) || d === 0) {
      throw new Error('移动距离必须是非 0 数字');
    }
    if (Math.abs(d) > 100) {
      throw new Error('单次移动距离不能超过 100mm');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    const gcode = `M211 S ; save soft endstop flag\nM211 X1 Y1 Z1 ; turn on soft endstop\nM1002 push_ref_mode\nG91\nG1 ${A}${d} F${A === 'Z' ? 1200 : 9000}\nM1002 pop_ref_mode\nM211 R ; restore soft endstop flag\n`;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'gcode_line', param: gcode } }, sequenceId);
  }

  async unloadFilament() {
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    return this._sendChecked({ print: { sequence_id: sequenceId, command: 'unload_filament', param: '' } }, sequenceId);
  }

  // ============ 设备化扩展（2026-10-15 观察台 v56：温度/AMS/文件管理/校准细分）============

  /** 喷嘴目标温度（M104，不等待升温）。H2D 高温喷嘴上限 350，保守取同值 */
  async setNozzleTemp(deg) {
    const d = Number(deg);
    if (!Number.isInteger(d) || d < 0 || d > 350) {
      throw new Error('喷嘴温度必须是 0-350 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.sendGcode(`M104 S${d}`);
  }

  /** 热床目标温度（M140，不等待升温） */
  async setBedTemp(deg) {
    const d = Number(deg);
    if (!Number.isInteger(d) || d < 0 || d > 120) {
      throw new Error('热床温度必须是 0-120 的整数');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    return this.sendGcode(`M140 S${d}`);
  }

  /**
   * AMS 切槽进料（空闲态换料）：ams_change_filament，目标槽先退旧料再进新料。
   * 帧格式为社区口径（OpenBambuAPI），v56 真机 H2D 校准
   */
  async amsChangeFilament(amsId, trayId) {
    const a = Number(amsId);
    const t = Number(trayId);
    const extSlot = a === 254 || a === 255;
    if (!Number.isInteger(a) || a < 0 || (a > 3 && !extSlot)) {
      throw new Error('AMS 单元号必须是 0-3（254/255=外挂料盘·左/右）');
    }
    if (!Number.isInteger(t) || t < 0 || t > 3 || (extSlot && t !== 0)) {
      throw new Error('AMS 槽位必须是 0-3（外挂料位固定槽 0）');
    }
    if (!this.client || !this.connected) throw new Error('打印机未连接');
    const sequenceId = ++this.projectSeq;
    const payload = {
      print: {
        sequence_id: sequenceId,
        command: 'ams_change_filament',
        ams_id: a,
        tray_id: t,
      },
    };
    return this._sendChecked(payload, sequenceId);
  }

  /**
   * 设备全景（raw 补充字段）：喷嘴规格/WiFi 信号/固件版本/AMS 湿度
   */
  getDeviceInfo() {
    const state = this.getState();
    if (!state) return null;
    const amsRaw = state.raw && state.raw.print ? state.raw.print.ams : null;
    return {
      nozzleDiameter: state.nozzleDiameter ?? null,
      nozzleType: state.nozzleType || null,
      wifiDbm: state.wifiSignalDbm ?? null,
      fwVersion: state.upgrade ? (state.upgrade.currentVersion || null) : null,
      amsHumidity: amsRaw && amsRaw.humidity != null ? (Number(amsRaw.humidity) || null) : null,
    };
  }

  /** FTPS 会话（990 implicit TLS，懒建 + 复用，出错置空强制重连） */
  async withFtps(fn) {
    let client = this.ftpsClient || (await this.connectFTPS());
    try {
      return await fn(client);
    } catch (err) {
      // 出错视为连接已坏：关闭置空强制下轮重连
      this.disconnectFTPS();
      throw err;
    }
  }

  /** 切片文件清单（按修改时间倒序）——FTPS 990；新世代 USB 根 /，老世代 /sdcard */
  async listSdcardFiles() {
    const isNewGen = /H2|X1/.test(String(this.config.model || '').toUpperCase());
    const dir = isNewGen ? '/' : '/sdcard';
    return this.withFtps(async (client) => {
      const list = await client.list(dir);
      return list
        .filter((e) => !e.isDirectory)
        .filter((e) => /\.(3mf|gcode|gx|g)$/i.test(e.name))
        .map((e) => ({ name: e.name, size: e.size, mtime: e.modifiedAt ? new Date(e.modifiedAt).getTime() : 0 }))
        .sort((a, b) => b.mtime - a.mtime)
        .slice(0, 200);
    });
  }

  /** 删除文件（文件名白名单校验，禁路径穿越）——FTPS 990；新世代 USB 根 /，老世代 /sdcard */
  async deleteSdcardFile(name) {
    const n = String(name || '');
    if (!n || /[\\/]/.test(n) || n.includes('..') || !/\.(3mf|gcode|gx|g)$/i.test(n)) {
      throw new Error('非法文件名');
    }
    const isNewGen = /H2|X1/.test(String(this.config.model || '').toUpperCase());
    const full = isNewGen ? `/${n}` : `/sdcard/${n}`;
    return this.withFtps(async (client) => {
      await client.remove(full);
      return { deleted: n };
    });
  }

  /**
   * 本地摄像头流（WS 中继消费——每个观看客户端独立一路，断开即销毁，不在 client 内长驻）：
   *   X1/H2D 系 = RTSPS :322（RTSP over TLS，digest 认证，RTP interleaved，
   *               rtsps.js 还原成同款 Annex-B 字节流）
   *   P1/A1 系 = 见 openCameraJpegStream（2026-10-17 实证：非本通道）
   */
  openCameraStream() {
    const model = String(this.config.model || '').toUpperCase();
    if (model.includes('X1') || model.includes('H2D')) {
      return new RtpsSession({ host: this.config.host, password: this.config.accessCode }).connect();
    }
    // 历史兜底：曾按「P1/A1 = TCP6000 裸 H.264」实现，2026-10-17 A1 mini 实机证伪
    // （裸连零字节——实为 TLS+认证包的 JPEG 帧流，见 openCameraJpegStream）。
    // P1/A1 已改走 MJPEG 通道，本分支不应再被触达
    return net.connect({ host: this.config.host, port: 6000, timeout: 8000 });
  }

  /**
   * 拓竹 P1/A1 摄像头帧流（2026-10-17 A1 mini 真机实证；协议档案 OpenBambuAPI video.md）：
   * TCP 6000 先 TLS（自签证书不校验），secureConnect 后即发 80 字节认证包——
   *   16B 头（payloadSize=0x40 LE / type=0x3000 LE / 0 / 0）+ 32B "bblp" + 32B accessCode
   *   （均 ASCII 右补 0x00）；此后为 JPEG 帧流：每帧 16B 头（payloadSize LE / itrack 0 /
   *   flags 1 / 0）+ payloadSize 字节 JPEG（FFD8…FFD9，实拍校验）。
   * A1 mini 实测出帧节拍约 0.45fps（每帧 ~180KB 720p）——是机器实际速率，非限流。
   * @param {(jpeg: Buffer) => void} onFrame 完整 JPEG 帧
   * @param {(err: Error) => void} onError 一次即终结（后续不再回调）
   * @returns {{ close(): void }} 观看结束调 close 释放上游连接
   */
  openCameraJpegStream(onFrame, onError) {
    let closed = false;
    let buf = Buffer.alloc(0);
    const sock = tls.connect({ host: this.config.host, port: 6000, rejectUnauthorized: false, timeout: 8000 });
    const fail = (err) => {
      if (closed) return;
      closed = true;
      try { sock.destroy(); } catch { /* 已关 */ }
      if (onError) onError(err);
    };
    sock.on('secureConnect', () => {
      const pkt = Buffer.alloc(80);
      pkt.writeUInt32LE(0x40, 0);
      pkt.writeUInt32LE(0x3000, 4);
      pkt.write('bblp', 16, 'ascii');
      pkt.write(String(this.config.accessCode || ''), 48, 'ascii');
      sock.write(pkt);
    });
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 16) {
        const size = buf.readUInt32LE(0);
        if (size <= 0 || size > 4 * 1024 * 1024) return fail(new Error(`帧头异常（size=${size}）`));
        if (buf.length < 16 + size) break;
        const jpeg = buf.subarray(16, 16 + size);
        buf = buf.subarray(16 + size);
        if (!closed) onFrame(jpeg);
      }
    });
    sock.on('timeout', () => fail(new Error('拉流超时（8s 无数据）')));
    sock.on('error', (err) => fail(err));
    sock.on('close', () => fail(new Error('连接被打印机关闭')));
    return { close() { closed = true; try { sock.destroy(); } catch { /* 已关 */ } } };
  }

  // ============ 文件传输（SFTP 优先，FTPS/FTP 兜底） ============

  /**
   * 上传 Buffer 到打印机存储。
   * 2026-10-15 真机 H2D 实测：22/21 全关（ECONNREFUSED），FTPS 990 唯一通道；
   * 且 H2 系 FTPS **只暴露外置 USB**（挂载在 FTPS 根——/sdcard 前缀会 553），
   * 故新世代把 remotePath 的 /sdcard/ 前缀剥掉直写根；P1/A1 保持 /sdcard/
   */
  async uploadBuffer(buffer, remotePath) {
    const isNewGen = /H2|X1/.test(String(this.config.model || '').toUpperCase());
    const target = isNewGen ? String(remotePath).replace(/^\/sdcard\//, '/') : remotePath;
    let ftpsErr = null;
    try {
      return await this.ftpsPut(buffer, target);
    } catch (err) {
      ftpsErr = err;
    }
    try {
      return await this.ftpPut(buffer, target);
    } catch (err) {
      throw new Error(
        `FTPS(990) 上传失败（${ftpsErr ? ftpsErr.message : '未知'}），FTP(21) 回退也失败（${err.message}）`
      );
    }
  }

  async connectFTPS() {
    const client = new FTPSClient(15000);
    try {
      await client.access({
        host: this.config.host,
        port: 990,
        user: 'bblp',
        password: this.config.accessCode,
        secure: 'implicit',
        secureOptions: { rejectUnauthorized: false }, // 打印机自签证书（BBL CA）
      });
    } catch (err) {
      try { client.close(); } catch (e) { /* ignore */ }
      throw err;
    }
    this.ftpsClient = client;
    return client;
  }

  disconnectFTPS() {
    if (this.ftpsClient) {
      try { this.ftpsClient.close(); } catch (e) { /* ignore */ }
      this.ftpsClient = null;
    }
  }

  async ftpsPut(buffer, remotePath) {
    let client = this.ftpsClient;
    if (!client) {
      client = await this.connectFTPS();
    }
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`FTPS 上传超时（${FTPS_TIMEOUT_MS / 1000}s）: ${remotePath}`));
        }, FTPS_TIMEOUT_MS);
        // basic-ftp uploadFrom 只接受 Readable | 本地路径字符串——传 Buffer 会报
        // 「source.once is not a function」静默炸整条分发链（2026-10-15 真机首验实锤，
        // 此前上传通道从无真机验证，桩测试mock掉了这层）
        client.uploadFrom(Readable.from(Buffer.from(buffer)), remotePath).then(
          () => { clearTimeout(timer); resolve(); },
          (err) => { clearTimeout(timer); reject(err); }
        );
      });
    } catch (err) {
      // 出错视为连接已坏：关闭置空强制下轮重连
      this.disconnectFTPS();
      throw err;
    }
  }

  sftpPut(buffer, remotePath) {
    return new Promise((resolve, reject) => {
      const tryUpload = (sftp) => {
        const stream = sftp.createWriteStream(remotePath);
        const timer = setTimeout(() => {
          // 超时视为会话已坏：断开并置空，下次上传重建连接
          stream.destroy();
          if (this.sshClient) {
            try { this.sshClient.end(); } catch (e) { /* ignore */ }
            this.sshClient = null;
          }
          reject(new Error(`SFTP 上传超时（${SFTP_TIMEOUT_MS / 1000}s）: ${remotePath}`));
        }, SFTP_TIMEOUT_MS);
        stream.on('error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
        stream.on('close', () => {
          clearTimeout(timer);
          resolve();
        });
        stream.end(Buffer.from(buffer));
      };

      if (this.sshClient && this.sshClient.sftpReady) {
        return tryUpload(this.sshClient.sftp);
      }

      const conn = new SSHClient();
      conn.on('ready', () => {
        conn.sftp((err, sftp) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          // 顶掉旧会话时显式关闭，避免连接泄漏
          if (this.sshClient && this.sshClient !== conn) {
            try { this.sshClient.end(); } catch (e) { /* ignore */ }
          }
          this.sshClient = conn;
          this.sshClient.sftp = sftp;
          this.sshClient.sftpReady = true;
          tryUpload(sftp);
        });
      });
      conn.on('error', (err) => reject(err));
      conn.on('close', () => {
        // 只处理当前会话的关闭：旧连接的 close 不能误清新会话的 sftpReady
        if (this.sshClient === conn) {
          this.sshClient = null;
        }
      });
      conn.connect({
        host: this.config.host,
        port: 22,
        username: 'bblp',
        password: this.config.accessCode,
        readyTimeout: 15000,
      });
    });
  }

  async disconnectFileSession() {
    if (this.sshClient) {
      this.sshClient.end();
      this.sshClient = null;
    }
    this.disconnectFTPS();
    if (this.ftpClient) {
      await this.disconnectFTP();
    }
  }

  connectFTP() {
    return new Promise((resolve, reject) => {
      const client = new ftp();
      this.ftpClient = client;

      client.on('ready', () => {
        resolve();
      });

      client.on('error', (err) => {
        // 连接失败/中途掉线后残留死客户端，会让后续操作永远挂在坏连接上：置空强制下轮重连
        if (this.ftpClient === client) this.ftpClient = null;
        reject(err);
      });

      client.connect({
        host: this.config.host,
        user: 'bblp',
        password: this.config.accessCode,
        port: 21,
        connTimeout: 30000,
        pasvTimeout: 30000,
      });
    });
  }

  async disconnectFTP() {
    if (this.ftpClient) {
      return new Promise((resolve) => {
        this.ftpClient.end(() => {
          this.ftpClient = null;
          resolve();
        });
      });
    }
  }

  async ftpPut(buffer, remotePath) {
    if (!this.ftpClient) {
      await this.connectFTP();
    }

    const client = this.ftpClient;
    return new Promise((resolve, reject) => {
      const fail = (err) => {
        // 出错视为连接已坏：置空强制下轮重连，并显式销毁 socket 防泄漏
        if (this.ftpClient === client) this.ftpClient = null;
        try { client.destroy(); } catch (e) { /* ignore */ }
        reject(err);
      };
      const timer = setTimeout(() => {
        fail(new Error(`FTP 上传超时（${FTP_TIMEOUT_MS / 1000}s）: ${remotePath}`));
      }, FTP_TIMEOUT_MS);
      client.put(Buffer.from(buffer), remotePath, (err) => {
        clearTimeout(timer);
        if (err) {
          fail(err);
        } else {
          resolve();
        }
      });
    });
  }
}

module.exports = PrinterClient;
module.exports.GCODE_STATE_MAP = GCODE_STATE_MAP;
module.exports.decodeNozzleTemp = decodeNozzleTemp;
module.exports.BAMBU_FILAMENT_PRESETS = BAMBU_FILAMENT_PRESETS;
module.exports.resolveFilamentPreset = resolveFilamentPreset;
