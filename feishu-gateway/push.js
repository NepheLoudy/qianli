/**
 * 统一部署脚本：一条命令完成「代码进 Git + 配置进部署目标 + 部署」
 *
 * 用法：
 *   npm run push "提交说明"   提交并部署
 *   npm run push              使用默认提交说明 "update: 代码更新"
 *
 * 说明：
 *   - 本项目位于顶层 monorepo 内，git 步骤只暂存 feishu-gateway/ 自身路径，
 *     推送到顶层仓库远端；push 失败不影响部署（走 SFTP 直传）。
 *   - 代码部署始终走 SFTP 打包直传（网关无独立仓库，部署目标上不拉 git）。
 *   - 部署目标连接配置从 .env 读取（DEPLOY_HOST/DEPLOY_PORT/DEPLOY_USER/DEPLOY_PASSWORD），脚本不存任何密钥。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const fs = require('fs');
const os = require('os');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '.env') });
// ---------- [0] 部署前测试闸门（2026-09-13 R4）：测试不过不部署；SKIP_TESTS=1 可跳过 ----------
function runTestGate() {
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1，跳过部署前测试');
    return true;
  }
  const { spawnSync } = require('child_process');
  // 全量桩闸门（2026-09-27 全量化）：自动发现 scripts/stub-test-*.js，排序稳定保证命令可复现；
  // 新增套件自动入闸，不再逐套手工挂清单（照 ticket-pm/project-management-robot/push.js 先例——
  // 此前手工清单漏挂 stub-test-usage-mentions.js）
  const suites = require('fs').readdirSync(path.join(__dirname, 'scripts'))
    .filter(f => /^stub-test-.+\.js$/.test(f))
    .sort()
    .map(f => `node scripts/${f}`)
    .join(' && ');
  if (!suites) { console.log('[测试闸门] 未发现 stub-test-*.js，跳过'); return true; }
  console.log('[测试闸门] 运行:', suites);
  const r = spawnSync(suites, { shell: true, stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) {
    console.error('部署前测试未通过（SKIP_TESTS=1 可跳过），中止部署');
    return false;
  }
  console.log('[测试闸门] 通过');
  return true;
}
if (!runTestGate()) process.exit(1);

const commitMessage = process.argv[2] || 'update: 代码更新';
const TAR_NAME = 'feishu-gateway-deploy.tar.gz';
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/c/qianli/' + TAR_NAME;
const TAR_REMOTE_WIN = 'C:/qianli/' + TAR_NAME;
const REMOTE_DIR = '/c/qianli/opt/feishu-gateway';
const REMOTE_DIR_WIN = 'C:/qianli/opt/feishu-gateway';
const PM2_NAME = 'feishu-gateway';

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

// ============ [1/4] 提交推送到顶层 monorepo（只暂存本项目路径） ============
console.log('========== [1/4] 代码提交推送到 GitHub ==========');

// 从当前目录向上找到仓库根（含 .git 的目录）
function findRepoRoot(dir) {
  let cur = dir;
  while (cur !== path.parse(cur).root) {
    if (fs.existsSync(path.join(cur, '.git'))) return cur;
    cur = path.dirname(cur);
  }
  return null;
}

const repoRoot = findRepoRoot(__dirname);
if (repoRoot) {
  const opts = { stdio: 'inherit', cwd: repoRoot };
  const add = spawnSync('git', ['add', 'feishu-gateway'], opts);
  if (add.status !== 0) {
    console.error('git add 失败');
    process.exit(1);
  }
  const hasChanges = spawnSync('git', ['diff', '--cached', '--quiet'], opts).status !== 0;
  if (hasChanges) {
    const commit = spawnSync('git', ['commit', '-m', commitMessage], opts);
    if (commit.status !== 0) {
      console.error('git commit 失败');
      process.exit(1);
    }
  } else {
    console.log('(无待提交改动，跳过 commit)');
  }
  const push = spawnSync('git', ['push'], opts);
  if (push.status === 0) {
    console.log('✓ git push 成功');
  } else {
    console.log('⚠ git push 失败（本地无法访问 GitHub 443），代码部署照常走 SFTP 直传');
  }
} else {
  console.log('⚠ 未找到 git 仓库根，跳过 git 步骤');
}

// ============ [2/4] 打包 SFTP 直传部署目标 ============
console.log('\n========== [2/4] 打包并上传代码 ==========');
const pack = spawnSync('tar', [
  '--force-local',
  '-czf', TAR_NAME,
  '--exclude=node_modules',
  '--exclude=.git',
  '--exclude=.env',
  // 运行时数据保护（2026-09-27 补洞）：data-dir 回退产物落 src/ 时不得进部署包覆盖现网
  '--exclude=src/usage-stats.json',
  '--exclude=src/usage-sync-state.json',
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

const conn = new Client();

conn.on('ready', () => {
  console.log('SSH 连接成功');
  conn.sftp((err, sftp) => {
    if (err) {
      console.error('SFTP 失败:', err.message);
      conn.end();
      process.exit(1);
    }
    sftp.fastPut(TAR_LOCAL, TAR_REMOTE_WIN, (err2) => {
      if (err2) {
        console.error('代码上传失败:', err2.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 代码包已上传');
      exec('mkdir -p ' + REMOTE_DIR + '; '
        + 'rm -rf ' + REMOTE_DIR + '/.git ' + REMOTE_DIR + '/* ' + REMOTE_DIR + '/.[!.]* 2>/dev/null || true; '
        + 'tar -xzf ' + TAR_REMOTE + ' -C ' + REMOTE_DIR, () => npmInstall());
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

// ============ [3/4] npm install + 上传 .env ============
function npmInstall() {
  console.log('\n========== [3/4] npm install + 上传 .env ==========');
  exec('cd ' + REMOTE_DIR + ' && npm install --production', () => {
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

// ============ [4/4] 重启服务 ============
function restart() {
  console.log('\n========== [4/4] 重启服务 ==========');
  // 注意：网关只收飞书出站长连接 + 本机回环转发，无需开放防火墙端口（与目标机系统环境隔离）
  const cmd = 'pm2 restart ' + PM2_NAME + ' --update-env 2>/dev/null || pm2 start ' + REMOTE_DIR + '/src/index.js --name ' + PM2_NAME + '; pm2 save';
  exec(cmd, () => {
    console.log('\n✅ 部署完成，服务状态：');
    conn.exec('pm2 list', (err, stream) => {
      if (err) { conn.end(); return; }
      stream.on('data', (d) => process.stdout.write(d.toString()));
      stream.on('close', () => conn.end());
    });
  });
}

console.log('正在连接部署目标...');
conn.connect(deployConfig);
