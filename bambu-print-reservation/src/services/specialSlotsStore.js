/**
 * AMS 特种槽位隔离（2026-11-20 v124 曼波令）：
 * 机队某些 AMS 槽装着「AMS 未录入的特种耗材」（机端料型只能从预设列表随便选占位——
 * 显示 PETG 实际是特种料）。自动分发若按显示料型映射到此槽=打出废料。
 * 本模块维护「特种槽位隔离清单」：
 *   - 隔离槽从自动映射/学习选槽/耗材初审中排除（自动系统永远不碰）
 *   - 提单侧「特种耗材开关」+ 手动指定槽位是唯一入口（申请人明确要用特种料时）
 * 存储：JSON 持久化（照 printerFleet.js 模式），键=打印机名，值=槽位名数组。
 */
const fs = require('fs');
const path = require('path');

// v124b 修正：默认路径曾在部署目录内——push 同步会冲掉（实案：H2D 标记后 v124b 部署即丢）。
// 生产经 .env 指到 bambu-data 数据区（与 reservations.json 同区）
const FILE = process.env.PRINTER_SPECIAL_SLOTS_FILE || path.join(__dirname, '..', '..', '.printer-special-slots.json');

function load() {
  try {
    if (!fs.existsSync(FILE)) return {};
    const d = JSON.parse(fs.readFileSync(FILE, 'utf-8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  } catch (err) {
    console.warn('[特种槽] 隔离清单读取失败（按空处理）:', err.message);
    return {};
  }
}

function save(data) {
  try {
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.warn('[特种槽] 隔离清单写入失败:', err.message);
  }
}

const specialSlotsStore = {
  /** 某机的隔离槽位名数组（无则空数组） */
  get(printerName) {
    return load()[String(printerName || '').trim()] || [];
  },

  /** 全量（机队坞/观察台渲染用） */
  all() {
    return load();
  },

  /** 设置某机的隔离槽位清单（全量覆盖；slots=槽位名数组，去重去空） */
  set(printerName, slots) {
    const name = String(printerName || '').trim();
    if (!name) throw new Error('printerName 不能为空');
    const list = Array.isArray(slots) ? [...new Set(slots.map((s) => String(s || '').trim()).filter(Boolean))] : [];
    const data = load();
    if (list.length) data[name] = list;
    else delete data[name];
    save(data);
    return { printer: name, specialSlots: list };
  },

  /** 槽位名是否被隔离（供分发过滤热路径） */
  isSpecial(printerName, slot) {
    const list = load()[String(printerName || '').trim()];
    return Array.isArray(list) && list.includes(String(slot || ''));
  },
};

module.exports = specialSlotsStore;
