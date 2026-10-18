// ============================================================
// 打印机能力矩阵（2026-10-18 P0 框架批）：机型能力的**单一事实源**
//
// 此前品牌/相机/命令 topic/开打帧形态散落在 manager/client 的字符串正则里，
// 机型能力靠口头约定（P1S 的 PASV / FTPS 根路径 / 无 AMS 的 use_ams 都是踩坑
// 后才补的散点）。本注册表把「机型 → 能力面」集中声明：
//   brand         bambu | flashforge
//   generation    new(H2/X1 世代) | old(P1/A1 世代) | ff(闪铸)
//   camera        rtsp | mjpeg | null
//   commandTopic  request(新世代命令走 device/{SN}/request) | report(P1/A1 老固件) | http(闪铸 /control)
// 判定保持原正则的语义（未知机型回落 bambu/old/report，与历史行为一致）；
// 改能力面 = 改这张表 + 补对应单测，禁止再往业务代码里写新正则。
// ============================================================

const CAPABILITY_VERSION = 'v1';

const REGISTRY = [
  { match: /H2/i, brand: 'bambu', generation: 'new', camera: 'rtsp', commandTopic: 'request' },
  { match: /X1/i, brand: 'bambu', generation: 'new', camera: 'rtsp', commandTopic: 'request' },
  { match: /P1|A1/i, brand: 'bambu', generation: 'old', camera: 'mjpeg', commandTopic: 'report' },
  { match: /CREATOR|AD5|5M/i, brand: 'flashforge', generation: 'ff', camera: 'mjpeg', commandTopic: 'http' },
];

const DEFAULT_CAP = { brand: 'bambu', generation: 'old', camera: null, commandTopic: 'report' };

/** 机型 → 能力面（未知机型按历史默认：拓竹老世代、无相机、report topic） */
function capabilitiesFor(model) {
  const m = String(model || '').toUpperCase();
  const hit = REGISTRY.find((r) => r.match.test(m));
  const cap = hit
    ? { brand: hit.brand, generation: hit.generation, camera: hit.camera, commandTopic: hit.commandTopic }
    : { ...DEFAULT_CAP };
  return { version: CAPABILITY_VERSION, ...cap };
}

module.exports = { CAPABILITY_VERSION, capabilitiesFor, REGISTRY };
