/**
 * 一次性：给打印审批表补「材料类型 / 颜色 / 指定打印机」三个单选字段（幂等：已存在则跳过）。
 * 用法：node scripts/add-dispatch-fields.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const bitableApi = require('../src/feishu/bitable');
const { requestAPI } = require('../src/feishu/client');
const config = require('../src/config');

const MATERIAL_OPTIONS = ['PLA', 'PLA-HF', 'PLA-CF', 'PETG', 'PETG-HF', 'PETG-CF', 'ABS', 'TPU', 'PA-CF', '其它'];
const COLOR_OPTIONS = ['白色', '黑色', '红色', '蓝色', '绿色', '黄色', '灰色', '橙色', '紫色', '粉色', '棕色', '透明', '其它'];
const PRINTER_OPTIONS = [];

async function ensureField(tableId, name, options) {
  const res = await requestAPI(
    'GET',
    `/bitable/v1/apps/${config.bitable.appToken}/tables/${tableId}/fields?page_size=100`
  );
  if (res.code !== 0) throw new Error(`列字段失败: ${res.msg}`);
  const fields = res.data?.items || [];
  const exists = fields.some((f) => f.field_name === name);
  if (exists) {
    console.log(`✓ 字段已存在: ${name}`);
    return;
  }
  await bitableApi.createField(tableId, {
    field_name: name,
    type: 3, // 单选
    property: { options: options.map((o) => ({ name: o })) },
  });
  console.log(`✓ 已创建字段: ${name}（单选）`);
}

(async () => {
  const tableId = process.env.BITABLE_RESERVATION_TABLE_ID;
  if (!tableId) {
    console.error('未配置 BITABLE_RESERVATION_TABLE_ID');
    process.exit(1);
  }
  await ensureField(tableId, '材料类型', MATERIAL_OPTIONS);
  await ensureField(tableId, '颜色', COLOR_OPTIONS);
  await ensureField(tableId, '指定打印机', PRINTER_OPTIONS);
  console.log('完成');
  process.exit(0);
})().catch((err) => {
  console.error('失败:', err.message);
  process.exit(1);
});
