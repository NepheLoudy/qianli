/**
 * qianli-netlog 统一部署脚本（复制 wecom-attendance-bot 版精简：repo:top 模式，
 * 本项目在顶层 monorepo 内无独立远端；无私有配置文件，守卫段不需要）
 *
 * 用法：npm run push "提交说明"
 * 流程：
 *   [0]   部署前测试闸门（测试不过不部署；SKIP_TESTS=1 可跳过）
 *   [1/4] 代码提交推送顶层 monorepo（只暂存 netlog/ 路径；push 失败不阻断）
 *   [2/4] SFTP 打包直传部署目标（小电脑 DESKTOP-FE1MIGI）
 *   [3/4] npm install（零依赖，秒过）+ 上传 .env
 *   [4/4] pm2 delete+start（清环境快照）+ pm2 save（并入 qianli-bots-autostart resurrect 清单）
 *
 * 连接键为 DEPLOY_*（2026-10-07 由 NAS_* 改名，语义=部署目标）。
 */
const { spawnSync } = require('child_process');
const { Client } = require('ssh2');
const os = require('os');
const path = require('path');
const fs = require('fs');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// ---------- [0] 部署前测试闸门 ----------
function runTestGate() {
  if (process.env.SKIP_TESTS === '1') {
    console.log('SKIP_TESTS=1，跳过部署前测试');
    return true;
  }
  console.log('[测试闸门] 运行: npm run test');
  const r = spawnSync('npm run test', { shell: true, stdio: 'inherit', cwd: __dirname });
  if (r.status !== 0) {
    console.error('部署前测试未通过（SKIP_TESTS=1 可跳过），中止部署');
    return false;
  }
  console.log('[测试闸门] 通过');
  return true;
}
if (!runTestGate()) process.exit(1);

const commitMessage = process.argv[2] || 'update: 代码更新';
const TAR_NAME = 'netlog-deploy.tar.gz';
const TAR_LOCAL = path.join(os.tmpdir(), TAR_NAME);
const TAR_REMOTE = '/c/qianli/' + TAR_NAME;
const TAR_REMOTE_WIN = 'C:/qianli/' + TAR_NAME;
const REMOTE_DIR = '/c/qianli/opt/netlog';
const REMOTE_DIR_WIN = 'C:/qianli/opt/netlog';
const PM2_NAME = 'qianli-netlog';

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
  const add = spawnSync('git', ['add', 'netlog'], opts);
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
  '--exclude=.env.local',
  '--exclude=.env.*.local',
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
      // 代码目录全量替换；运行时数据在项目外数据目录（NETLOG_DATA_DIR，默认 ~/qianli-data/netlog），不受影响
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

// ============ [3/4] npm install + 上传 .env 与账号池 ============
function npmInstall() {
  console.log('\n========== [3/4] npm install + 上传 .env 与账号池 ==========');
  exec('export PATH=/c/tools/node-v22.10.0-win-x64:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:/Windows/System32:$PATH; cd ' + REMOTE_DIR + ' && npm install --omit=dev', () => {
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
        console.log('✓ .env 已上传（含部署凭证/webhook/API token，仅存于部署目标）');
        // 账号池路径各机各异：本地 .env 的调试路径不能带上线（2026-09-27 实测教训——
        // 本地路径导致目标侧读空池）。上传后强制改写为部署目标的数据目录路径。
        exec('sed -i "s|^NETLOG_ACCOUNT_POOL=.*|NETLOG_ACCOUNT_POOL=C:/qianli/data/netlog/campus-accounts.local.json|" ' + REMOTE_DIR_WIN + '/.env', () => {
          console.log('✓ 目标侧 NETLOG_ACCOUNT_POOL 已校准为数据目录路径');
          uploadAccountPool(sftp, restart);
        });
      });
    });
  });
}

// 账号池上传（含校园网账号密码，绝不进 git；目标=数据目录，代码 rm -rf 不波及）。
// 【运行时数据保护】权威可能在部署目标侧（目标机上直接编辑过账号池）：上传前先备份现网；
// 本地条目数 < 现网时跳过上传并把现网回填本地（PUSH_FORCE_PRIVATE=1 强制覆盖）。
const LOCAL_POOL = path.join(__dirname, '..', 'campus-accounts.local.json');
const REMOTE_POOL = 'C:/qianli/data/netlog/campus-accounts.local.json';
function poolCount(content) {
  try {
    const obj = JSON.parse(content || 'null');
    return Array.isArray(obj && obj.accounts) ? obj.accounts.length : null;
  } catch { return null; }
}
function uploadAccountPool(sftp, done) {
  if (!fs.existsSync(LOCAL_POOL)) {
    console.warn('⚠ 本地无 campus-accounts.local.json，跳过账号池上传（引擎将以空池运行）');
    return done();
  }
  sftp.readFile(REMOTE_POOL, 'utf8', (readErr, remoteContent) => {
    if (readErr && readErr.code !== 'ENOENT' && readErr.code !== 2) {
      // 非 ENOENT（ssh2 对不存在文件抛数字码 2）一律中止——读现网失败 ≠ 现网为空
      console.error(`[账号池保护] 读取现网账号池失败（${readErr.code || '?'} ${readErr.message}），中止部署。`);
      conn.end();
      process.exit(1);
    }
    const localContent = fs.readFileSync(LOCAL_POOL, 'utf8');
    const localCount = poolCount(localContent);
    const remoteCount = readErr ? 0 : poolCount(remoteContent);
    const backupThen = (next) => {
      if (readErr || !remoteContent || !remoteContent.trim()) return next();
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      const backupPath = 'C:/qianli/data/netlog/campus-accounts.' + ts + '.bak.json';
      sftp.writeFile(backupPath, remoteContent, (wErr) => {
        if (wErr) console.warn('⚠ 现网账号池备份失败（继续）:', wErr.message);
        else console.log('✓ 现网账号池已备份:', backupPath);
        next();
      });
    };
    backupThen(() => {
      if (readErr) return sftpWritePool(sftp, localContent, done);
      if (remoteCount !== null && localCount !== null && remoteCount > localCount && process.env.PUSH_FORCE_PRIVATE !== '1') {
        console.warn(`⚠ [账号池保护] 跳过上传：本地 ${localCount} 账号 < 现网 ${remoteCount} 账号（本地种子过期，现网内容已回填本地）。确认覆盖请设 PUSH_FORCE_PRIVATE=1。`);
        fs.writeFileSync(LOCAL_POOL, remoteContent);
        return done();
      }
      return sftpWritePool(sftp, localContent, done);
    });
  });
}
function sftpWritePool(sftp, content, done) {
  conn.exec('mkdir -p /c/qianli/data/netlog', () => {
    sftp.writeFile(REMOTE_POOL, content, (err) => {
      if (err) {
        console.error('账号池上传失败:', err.message);
        conn.end();
        process.exit(1);
      }
      console.log('✓ 账号池已上传到部署目标数据目录（凭据不进 git）');
      done();
    });
  });
}

// ============ [4/4] 重启服务 ============
const HEALTH_PORT = process.env.NETLOG_PORT || '3016';

function restart() {
  console.log('\n========== [4/4] 重启服务 ==========');
  // 只收出站探测/webhook + 本机回环 HTTP 窗口，无需开放防火墙端口
  // delete+start（而非 restart）：清旧环境快照，cwd 固定在应用目录（R13① 同款）
  const cmd = 'export PATH=/c/tools/node-v22.10.0-win-x64:/mingw64/bin:/usr/local/bin:/usr/bin:/bin:$PATH; '
    + 'pm2 delete ' + PM2_NAME + ' 2>/dev/null; cd ' + REMOTE_DIR + ' && pm2 start src/index.js --name ' + PM2_NAME + ' && pm2 save';
  exec(cmd, () => healthCheck(0));
}

// 部署后健康检查（2026-10-04，approval-bot 同款）：/api/health 返回 {"ok":true,...}
function healthCheck(attempt) {
  const MAX_ATTEMPTS = 6;
  console.log(`健康检查 (${attempt + 1}/${MAX_ATTEMPTS}): localhost:${HEALTH_PORT}/api/health`);
  conn.exec(`sleep 3; curl -s -m 3 localhost:${HEALTH_PORT}/api/health`, (err, stream) => {
    if (err) { console.error('健康检查执行失败:', err.message); conn.end(); process.exit(1); }
    let out = '';
    stream.on('data', (d) => { out += d.toString(); });
    stream.on('close', () => {
      if (out.includes('"ok":true')) {
        console.log('✅ 健康检查通过:', out.trim().slice(0, 160));
        showStatus();
        return;
      }
      if (attempt + 1 >= MAX_ATTEMPTS) {
        console.error(`❌ 部署后健康检查失败（${MAX_ATTEMPTS} 次未就绪）——进程可能 crash 循环。`);
        console.error('   排查：ssh 上机后 pm2 logs ' + PM2_NAME + ' --err --lines 50；不要让机器人带病运行。');
        conn.end();
        process.exit(1);
      }
      healthCheck(attempt + 1);
    });
  });
}

function showStatus() {
  console.log('\n✅ 部署完成，服务状态：');
  conn.exec('export PATH=/c/tools/node-v22.10.0-win-x64:$PATH; pm2 list', (err, stream) => {
    if (err) { conn.end(); return; }
    stream.on('data', (d) => process.stdout.write(d.toString()));
    stream.on('close', () => conn.end());
  });
}

console.log('正在连接部署目标...');
conn.connect(deployConfig);
