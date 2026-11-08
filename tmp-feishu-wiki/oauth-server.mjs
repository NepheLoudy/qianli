// 飞书 OAuth user_access_token 本地回调服务（一次性授权用）
// 用法：node oauth-server.mjs  →  浏览器打开 http://localhost:8899/start
import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const envText = readFileSync('D:/dev/qianli/bambu-print-reservation/.env', 'utf8');
const env = Object.fromEntries(envText.split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => {
  const i = l.indexOf('=');
  return [l.slice(0, i), l.slice(i + 1).trim()];
}));
const APP_ID = env.APP_ID, APP_SECRET = env.APP_SECRET;
const PORT = 8907;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_FILE = 'D:/dev/qianli/tmp-feishu-wiki/user-token.json';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/start') {
    const SCOPES = ['wiki:wiki', 'docx:document', 'docx:document.block:convert', 'drive:drive'].join('%20');
    const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${APP_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=wiki-write&scope=${SCOPES}`;
    res.writeHead(302, { Location: authUrl });
    res.end();
    return;
  }
  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    if (err || !code) {
      res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`授权失败: ${err || 'no code'}`);
      return;
    }
    // v2 OAuth token 端点
    const resp = await fetch('https://open.feishu.cn/open-apis/authen/v2/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: APP_ID,
        client_secret: APP_SECRET,
        code,
        redirect_uri: REDIRECT_URI,
      }),
    });
    const j = await resp.json().catch(() => ({}));
    if (!j.access_token) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('换 token 失败: ' + JSON.stringify(j));
      return;
    }
    writeFileSync(TOKEN_FILE, JSON.stringify({ ...j, obtainedAt: new Date().toISOString() }, null, 2));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>✅ 授权成功！user_access_token 已保存（前 10 位 ${j.access_token.slice(0, 10)}...）</h2><p>可以关掉这个页面，回终端跑 write-all。</p>`);
    console.log(`[oauth] token saved, expires_in=${j.expires_in}s, has refresh=${!!j.refresh_token}`);
    return;
  }
  if (url.pathname === '/token') {
    if (!existsSync(TOKEN_FILE)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('no token yet'); return;
    }
    const j = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(`obtained=${j.obtainedAt} expires_in=${j.expires_in} token=${j.access_token.slice(0, 10)}...`);
    return;
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, () => {
  console.log(`oauth callback server on http://localhost:${PORT}`);
  console.log(`打开浏览器访问: http://localhost:${PORT}/start`);
});
