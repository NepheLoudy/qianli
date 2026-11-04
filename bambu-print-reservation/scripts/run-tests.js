// npm test 统一入口（2026-11-05）：与 push.js 测试闸门同源自动发现 test/*-test.js，
// 消灭「npm test 链 / 文档口径 / push.js 闸门」三套数字漂移（reprint-lineage /
// multi-model-match 曾漏挂 npm test，维护者日常命令跑不到最核心回归锚）。
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const tests = fs.readdirSync(path.join(__dirname, '..', 'test'))
  .filter((f) => f.endsWith('-test.js'))
  .sort()
  .map((f) => `node test/${f}`)
  .join(' && ');
if (!tests) { console.log('无测试可跑'); process.exit(0); }
console.log('[npm test] 自动发现', tests.split(' && ').length, '套，运行:', tests);
const r = spawnSync(tests, { shell: true, stdio: 'inherit', cwd: path.join(__dirname, '..') });
process.exit(r.status === null ? 1 : r.status);
