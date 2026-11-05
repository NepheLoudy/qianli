/**
 * 统一部署脚本：SFTP 直传部署到部署目标（本项目位于顶层 monorepo 内，无独立 git 远端，跳过 git 步骤）
 *
 * 用法：
 *   npm run push
 *
 * 流程：
 *   [1/3] 打包代码 SFTP 直传部署目标
 *   [2/3] 上传 .env 到部署目标（含飞书密钥，只单独存部署目标，绝不进 git）
 *   [3/3] npm install + 重启服务
 *
 * 部署目标连接配置从 .env 读取（DEPLOY_HOST/DEPLOY_PORT/DEPLOY_USER/DEPLOY_PASSWORD），脚本不存任何密钥。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const os = require('os');
const path = require('path');
const fs = require('fs'); // 测试闸门 readdirSync 用（2026-10-12 修复：清理批误删此 require 致闸门崩溃）

require('dotenv').config({ path: path.join(__dirname, '.env') });
// ---------- [0] 部署前测试闸门（2026-09-13 R4）：测试不过不部署；SKIP_TESTS=1 可跳过 ----------
function runTestGate() {
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1，跳过部署前测试');
    return true;
  }
  const { spawnSync } = require('child_process');
  // 2026-10-10 对齐：自动发现 test/*-test.js（原手工清单与 package.json 双维护，
  // 新增套件漏改 push.js 会绕过闸门——gateway 曾因手工清单漏挂出过事故）
  const tests = fs.readdirSync(path.join(__dirname, 'test'))
    .filter((f) => f.endsWith('-test.js'))
    .sort()
    .map((f) => `node test/${f}`)
    .join(' && ');
  if (!tests) { console.log('[测试闸门] 无测试命令，跳过'); return true; }
  console.log('[测试闸门] 运行:', tests);
  const r = spawnSync(tests, { shell: true, stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) {
    console.error('部署前测试未通过（SKIP_TESTS=1 可跳过），中止部署');
    return false;
  }
  console.log('[测试闸门] 通过');
  return true;
}
if (!runTestGate()) process.exit(1);

const TAR_NAME = 'bambu-print-server-deploy.tar.gz';
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/c/qianli/' + TAR_NAME;
const TAR_REMOTE_WIN = 'C:/qianli/' + TAR_NAME;
const REMOTE_DIR = '/c/qianli/opt/bambu-print-server';
const REMOTE_DIR_WIN = 'C:/qianli/opt/bambu-print-server';
const PM2_NAME = 'bambu-print-server';

const deployConfig = {
  host: process.env.DEPLOY_HOST,
  port: Number(process.env.DEPLOY_PORT || 22),
  username: process.env.DEPLOY_USER,
  password: process.env.DEPLOY_PASSWORD,
};
if (!deployConfig.host || !deployConfig.password) {
  console.error('缺少部署配置：请在 .env 中配置 DEPLOY_HOST/DEPLOY_PORT/DEPLOY_USER/DEPLOY_PASSWORD');
  process.exit(1);
}

// ============ [1/3] 打包并直传代码 ============
console.log('========== [1/3] 打包代码 ==========');
const pack = spawnSync('tar', [
  '-czf', TAR_NAME,
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=.env',
  // 运行时状态文件（2026-09-27 补洞）：现网权威在部署目标，不得随包覆盖
  '--exclude=.dispatch-state.json',
  '--exclude=.quiet-backlog.json',
  // 路线 A 数据面（2026-10-05）：本地测试/烟测残留不得随包上部署目标
  '--exclude=data',
  '--exclude=.process-rules.json',
  '--exclude=.reservations.json',
  '--exclude=.auth-users.json',
  '--exclude=.rule-suggestions.json',
  // 训练集样本库（2026-10-12）：训练资产本体在 bambu-data/training，索引不随包覆盖
  '--exclude=.training-samples.json',
  // 本地私有环境覆盖（.env 上传单独走 SFTP）
  '--exclude=.env.local',
  '--exclude=.env.*.local',
  '--exclude=logs',
  '--exclude=*.log',
  '--exclude=' + TAR_NAME,
  '-C', __dirname,
  '.',
], { stdio: 'inherit', cwd: os.tmpdir() });
if (pack.status !== 0) {
  console.error('打包失败');
  process.exit(1);
}
console.log('打包完成:', TAR_LOCAL);

// ============ 连接部署目标 ============
const conn = new Client();

conn.on('ready', () => {
  console.log('SSH 连接成功');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    console.log('上传代码包到部署目标...');
    sftp.fastPut(TAR_LOCAL, TAR_REMOTE_WIN, (err2) => {
      if (err2) {
        console.error('代码上传失败:', err2.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 代码包已上传');
      deployCode();
    });
  });
});

// 2026-11-05 tearingDown 守卫（全量审查 P2）：conn.end() 主动收尾后服务端 RST 回包会把成功部署
// 误报成失败退出码 1——主动收尾后的连接错误按已知误报忽略，不再自证失败
let tearingDown = false;
const _connEnd = conn.end.bind(conn);
conn.end = (...args) => { tearingDown = true; return _connEnd(...args); };
conn.on('error', (err) => {
  if (tearingDown) {
    console.log('SSH 收尾连接已关闭（' + err.message + '）——部署流程已正常走完，按已知误报忽略');
    process.exit(0);
  }
  console.error('SSH 连接失败:', err.message);
  process.exit(1);
});

function exec(cmd, cb) {
  console.log('>', cmd);
  conn.exec(cmd, (err, stream) => {
    if (err) {
      console.error('执行失败:', err.message);
      conn.end();
      process.exit(1);
    }
    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.stderr.on('data', (d) => process.stderr.write(d.toString()));
    stream.on('close', (code) => {
      if (code !== 0) {
        console.error(`命令失败 (退出码 ${code})`);
        conn.end();
        process.exit(code);
      }
      cb();
    });
  });
}

// ============ [2/3] 解压 + 上传 .env ============
function deployCode() {
  // 首次部署建目录（2026-09-16：部署目标=小电脑，mechax 直接建；旧 NAS 时代的 sudo/chown qianli:qianli在新机上指向不存在的用户，此前全靠 `;` 容错才没断部署，顺带消除命令行带密码的泄露面）
  const cmd = 'mkdir -p ' + REMOTE_DIR + ' && '
    + 'rm -rf ' + REMOTE_DIR + '/.git ' + REMOTE_DIR + '/* ' + REMOTE_DIR + '/.[!.]* 2>/dev/null || true; '
    + 'tar -xzf ' + TAR_REMOTE + ' -C ' + REMOTE_DIR;
  exec(cmd, () => {
    console.log('\n========== [2/3] 上传 .env 到部署目标 ==========');
    conn.sftp((err, sftp) => {
      if (err) {
        console.error('SFTP 失败:', err.message);
        conn.end();
        process.exit(1);
      }
      sftp.fastPut(path.join(__dirname, '.env'), REMOTE_DIR_WIN + '/.env', (err2) => {
        if (err2) {
          console.error('.env 上传失败:', err2.message);
          conn.end();
          process.exit(1);
        }
        console.log('✓ .env 已上传到部署目标（含飞书密钥，仅存于部署目标）');
        restart();
      });
    });
  });
}

// ============ [3/3] 安装依赖 + 重启 ============
function restart() {
  console.log('\n========== [3/3] npm install + 重启服务 ==========');
  exec('cd ' + REMOTE_DIR + ' && npm install --production', () => {
    const cmd = 'pm2 restart ' + PM2_NAME + ' --update-env 2>/dev/null || pm2 start ' + REMOTE_DIR + '/src/index.js --name ' + PM2_NAME + '; pm2 save';
    exec(cmd, () => {
      console.log('\n✅ 部署完成，服务状态：');
      conn.exec('pm2 list', (err, stream) => {
        if (err) { conn.end(); return; }
        stream.on('data', (d) => process.stdout.write(d.toString()));
        stream.on('close', () => conn.end());
      });
    });
  });
}

console.log('正在连接部署目标...');
conn.connect(deployConfig);
