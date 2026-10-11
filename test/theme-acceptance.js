import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { createServer as createHttpsServer } from 'node:https';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { createThemeProcessFixture, eventually, pause } from './helpers/themeFixture.js';
import { createThemeDevServer } from '../examples/theme-minimal/serve.mjs';
import { totpCode } from '../src/services/twoFactor.js';
import { buildCspHeader, buildApiDomainsWithWs } from '../src/utils/csp.js';

const evidence = resolve(process.env.THEME_EVIDENCE_DIR || 'output/test-results/theme');
await mkdir(evidence, { recursive: true });
const playwrightModule = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
// Prepare both controllers, static output, TLS proxy and browser before cases.
const publicSite = await createThemeProcessFixture();
const privateSite = await createThemeProcessFixture({ twoFactor: true });
let browser, agent, nativeBrowser, nativeProcess;
const results = [], pageErrors = [];
const listen = async server => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
const close = server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); });
const dev = createThemeDevServer(publicSite.base, publicSite.built);
const devOrigin = `http://127.0.0.1:${await listen(dev.server)}`;
const certPath = join(publicSite.root, 'fixture-cert.pem'), keyPath = join(publicSite.root, 'fixture-key.pem');
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', keyPath, '-out', certPath, '-days', '1', '-subj', '/CN=localhost'], { stdio: 'ignore' });
const tls = { cert: await readFile(certPath), key: await readFile(keyPath) };
let apiTlsOrigin;
const apiProxy = createHttpsServer(tls, (req, res) => {
  const remote = httpRequest(new URL(req.url, publicSite.base), {
    method: req.method, headers: { ...req.headers, host: new URL(publicSite.base).host,
      'x-forwarded-proto': 'https', 'x-forwarded-host': new URL(apiTlsOrigin).host }
  }, response => { res.writeHead(response.statusCode, response.headers); response.pipe(res); });
  remote.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); }); req.pipe(remote);
});
const proxyWss = new WebSocketServer({ noServer: true }), proxySockets = new Set();
apiProxy.on('upgrade', (req, connection, head) => {
  const url = new URL(req.url, publicSite.base); url.protocol = 'ws:';
  const remote = new WebSocket(url, { headers: {
    ...(req.headers.origin ? { Origin: req.headers.origin } : {}),
    ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}),
    'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': new URL(apiTlsOrigin).host
  } });
  proxySockets.add(remote);
  remote.once('unexpected-response', (_, response) => {
    connection.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    response.resume(); remote.terminate();
  });
  remote.once('open', () => proxyWss.handleUpgrade(req, connection, head, client => {
    client.on('message', data => { if (remote.readyState === WebSocket.OPEN) remote.send(data.toString()); });
    remote.on('message', data => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()); });
    client.on('close', () => remote.close()); client.on('error', () => remote.terminate());
    remote.on('close', () => client.close());
  }));
  remote.on('close', () => proxySockets.delete(remote)); remote.on('error', () => connection.destroy());
});
apiTlsOrigin = `https://127.0.0.1:${await listen(apiProxy)}`;
const staticTls = createHttpsServer(tls, async (req, res) => {
  try {
    const path = new URL(req.url, 'https://localhost').pathname;
    if (path !== '/' && !/^\/assets\/[a-z0-9.-]+$/.test(path)) { res.writeHead(404).end(); return; }
    const body = await readFile(join(publicSite.built, path === '/' ? 'index.html' : path.slice(1)));
    const html = path === '/' ? body.toString().replace('name="apiBase" content=""', `name="apiBase" content="${apiTlsOrigin}"`) : body;
    res.writeHead(200, { 'Content-Type': path === '/' ? 'text/html;charset=UTF-8' : path.endsWith('.js') ? 'text/javascript' : 'text/css',
      'Content-Security-Policy': buildCspHeader({ apiDomains: buildApiDomainsWithWs([apiTlsOrigin]) }), 'Cache-Control': 'no-store' }).end(html);
  } catch { res.writeHead(404).end(); }
});
const staticPort = await listen(staticTls);
const staticOrigin = `https://localhost:${staticPort}`;
await publicSite.setCors(staticOrigin);
await publicSite.admin({ action: 'save_settings', settings: { theme_url: publicSite.themeUrl('b'.repeat(40)) } });
await privateSite.admin({ action: 'save_settings', settings: { theme_url: privateSite.themeUrl('c'.repeat(40)) } });

async function step(id, feature, operation, expected, callback) {
  const started = performance.now();
  try {
    const detail = await callback();
    results.push({ id, feature, operation, expected, status: 'PASS', durationMs: Math.round(performance.now() - started), evidence: detail || 'Actual browser, HTTP/WS and SQLite assertions' });
    console.log(`${id} PASS ${feature}`);
  } catch (error) {
    results.push({ id, feature, operation, expected, status: 'FAIL', evidence: error.message }); throw error;
  } finally {
    await writeFile(join(evidence, 'browser.json'), JSON.stringify({ date: new Date().toISOString(),
      upstream: 'Local file fixture replaces raw.githubusercontent.com; not a real GitHub publication',
      tls: 'Self-signed local HTTPS/WSS; not a public certificate or production deployment', results, pageErrors }, null, 2));
  }
}

try {
  browser = await chromium.launch({ headless: true, ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}), args: ['--ignore-certificate-errors'] });
  const nativeProfile = join(publicSite.root, 'native-tabs'); await mkdir(nativeProfile);
  nativeProcess = spawn(process.env.THEME_CHROMIUM_EXECUTABLE || chromium.executablePath(),
    ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${nativeProfile}`, '--no-first-run', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Native browser startup timeout')), 10000);
    nativeProcess.once('error', error => { clearTimeout(timer); reject(error); });
    nativeProcess.stderr.on('data', chunk => {
      output = (output + chunk).slice(-8000);
      const match = output.match(/ws:\/\/127\.0\.0\.1:\d+\/devtools\/browser\/[^\s]+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  nativeBrowser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const nativeContext = nativeBrowser.contexts()[0];
  const hiddenPage = await nativeContext.newPage(), coverPage = await nativeContext.newPage();
  hiddenPage.on('pageerror', error => pageErrors.push(error.message));
  await hiddenPage.goto(publicSite.base); await eventually(async () => await hiddenPage.locator('#server-rows tr').count() === 2);
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
  context.on('page', current => current.on('pageerror', error => pageErrors.push(error.message)));
  const page = await context.newPage(), privatePage = await context.newPage();
  const cpu = () => page.locator(`[data-server-id="${publicSite.visible}"] .cpu`);
  const rows = current => current.locator('#server-rows tr');
  const hasCpu = value => eventually(async () => await cpu().textContent() === `${value}%`);
  async function login(current, fixture, factor) {
    await current.locator('#login-panel').evaluate(element => { element.open = true; });
    await current.locator('#admin-path').fill('/' + fixture.config.ADMIN_PATH);
    await current.locator('#username').fill('admin'); await current.locator('#password').fill(fixture.config.API_SECRET);
    await current.locator('#login-submit').click();
    if (factor) {
      await current.locator('#factor-field').waitFor({ state: 'visible' });
      await current.locator('#factor').fill(factor); await current.locator('#login-submit').click();
    }
    await current.locator('#logout').waitFor({ state: 'visible' });
  }

  await step('THB01', '匿名看板及数据单位', '经主控主题代理打开页面，观察真实节点及空指标', '两个可见节点、CPU 25%、512 MiB/2 GiB、后台链接隐藏', async () => {
    await page.goto(publicSite.base); await eventually(async () => await rows(page).count() === 2); await hasCpu(25);
    assert.match(await page.locator(`[data-server-id="${publicSite.visible}"]`).textContent(), /512 MiB \/ 2\.0 GiB/);
    assert.match(await page.locator(`[data-server-id="${publicSite.empty}"]`).textContent(), /尚未上报/);
    assert.equal(await page.locator('#admin-link').isVisible(), false);
    return { nodes: 2, cpu: '25%', memory: '512 MiB / 2.0 GiB' };
  });
  await step('THB02', '开发服务器可运行', '打开 loopback 开发代理并接收真实 HTTP/WS', '源示例可同源运行，退出页面释放其连接', async () => {
    const preview = await context.newPage(); await preview.goto(devOrigin);
    await eventually(async () => await rows(preview).count() === 2);
    assert.match(await preview.locator('#connection').textContent(), /正常/); await preview.close();
  });
  await step('THB03', '私人提示及 2FA 挑战', '打开私人页面，先错误密码，再正确密码不带因子', '不公开路径/节点，挑战无 JWT 和权限', async () => {
    await privatePage.goto(privateSite.base); await privatePage.locator('#empty').filter({ hasText: '未公开' }).waitFor();
    assert.equal(await rows(privatePage).count(), 0); assert.equal(await privatePage.locator('#admin-link').isVisible(), false);
    await privatePage.locator('#login-panel').evaluate(element => { element.open = true; });
    await privatePage.locator('#admin-path').fill('/' + privateSite.config.ADMIN_PATH);
    await privatePage.locator('#password').fill('wrong-fixture-password'); await privatePage.locator('#login-submit').click();
    await privatePage.locator('#login-message').filter({ hasText: '失败' }).waitFor();
    await privatePage.locator('#password').fill(privateSite.config.API_SECRET); await privatePage.locator('#login-submit').click();
    await privatePage.locator('#factor-field').waitFor({ state: 'visible' });
    assert.equal(await rows(privatePage).count(), 0);
    assert.equal(await privatePage.evaluate(key => localStorage.getItem(key), `jwt_token:${privateSite.base}`), null);
  });
  await step('THB04', '动态码与管理员历史', '输入动态码、查看隐藏节点、查询 7 天', '三节点、仅鉴权后有后台链接、7 天包含旧采样', async () => {
    await privatePage.locator('#factor').fill(totpCode(privateSite.factorSecret, Math.floor(Date.now() / 30000)));
    await privatePage.locator('#login-submit').click(); await privatePage.locator('#logout').waitFor({ state: 'visible' });
    await eventually(async () => await rows(privatePage).count() === 3);
    assert.equal(await privatePage.locator('#admin-link').isVisible(), true);
    await privatePage.locator('#history-server').selectOption(privateSite.visible);
    await privatePage.locator('#history-hours').selectOption('168'); await privatePage.locator('#history-submit').click();
    await eventually(async () => await privatePage.locator('#history-rows tr').count() >= 2);
  });
  await step('THB05', '退出、恢复码及凭据隔离', '退出后检查 Cookie/存储/列表，再以恢复码登录并退出', '退出无私有数据，恢复码可登录，无其他 origin 凭据', async () => {
    await privatePage.locator('#logout').click(); await privatePage.locator('#empty').filter({ hasText: '未公开' }).waitFor();
    assert.equal(await rows(privatePage).count(), 0); assert.equal(await privatePage.locator('#history-rows tr').count(), 0);
    assert.equal(await privatePage.evaluate(key => localStorage.getItem(key), `jwt_token:${privateSite.base}`), null);
    assert.ok(!(await context.cookies(privateSite.base)).some(cookie => cookie.name === 'cfsm_auth'));
    await login(privatePage, privateSite, privateSite.recoveryCodes[0]);
    assert.equal(await privatePage.evaluate(key => localStorage.getItem(key), `jwt_token:${publicSite.base}`), null);
    await privatePage.locator('#logout').click(); await privatePage.locator('#empty').filter({ hasText: '未公开' }).waitFor();
  });
  await step('THB06', '真实 WS 与旧采样', 'Agent WS 上报新样本和晚到旧样本', '数值更新，旧采样不倒退但接收时间推进', async () => {
    agent = new WebSocket(publicSite.base.replace('http:', 'ws:') + '/update'); agent.on('error', () => {});
    await once(agent, 'open', { signal: AbortSignal.timeout(5000) });
    const latest = Date.now();
    agent.send(JSON.stringify({ id: publicSite.visible, secret: publicSite.config.API_SECRET, metrics: { ...publicSite.metrics, timestamp: latest, cpu: 88 } }));
    await hasCpu(88);
    const before = Number(await page.locator(`[data-server-id="${publicSite.visible}"]`).getAttribute('data-received-at'));
    await pause(30);
    agent.send(JSON.stringify({ id: publicSite.visible, secret: publicSite.config.API_SECRET, metrics: { ...publicSite.metrics, timestamp: latest - 60000, cpu: 2 } }));
    await eventually(async () => Number(await page.locator(`[data-server-id="${publicSite.visible}"]`).getAttribute('data-received-at')) > before);
    await hasCpu(88);
  });
  await step('THB07', '晚到快照', '延迟真实 REST 响应期间继续 WS 上报', '快照不覆盖更近指标', async () => {
    let release, ready;
    const gate = new Promise(resolve => { release = resolve; }); const fetched = new Promise(resolve => { ready = resolve; });
    await page.route('**/api/servers', async route => { const response = await route.fetch(); ready(); await gate; await route.fulfill({ response }).catch(() => {}); });
    await page.locator('#refresh').click(); await fetched;
    agent.send(JSON.stringify({ id: publicSite.visible, secret: publicSite.config.API_SECRET, metrics: { ...publicSite.metrics, timestamp: Date.now(), cpu: 91 } }));
    await hasCpu(91); release(); await page.unroute('**/api/servers', { behavior: 'wait' }); await hasCpu(91);
  });
  await step('THB08', '主题选项和历史空值', '保存合法/错误版本选项，查询 24 小时与空节点历史', '选项生效/回退；0% 与禁用分开，空历史提示正确', async () => {
    await publicSite.request('/api/theme_options', { theme_options: { other: { keep: true }, minimal: { schemaVersion: 1, accent: 'blue', density: 'compact' } } });
    await page.locator('#refresh').click(); await eventually(async () => await page.locator('body').getAttribute('data-density') === 'compact');
    assert.equal(await page.locator('body').getAttribute('data-accent'), 'blue');
    await publicSite.request('/api/theme_options', { theme_options: { minimal: { schemaVersion: 99, accent: 'blue' } } });
    await page.locator('#refresh').click(); await eventually(async () => await page.locator('body').getAttribute('data-accent') === 'green');
    await page.locator('#history-server').selectOption(publicSite.visible); await page.locator('#history-submit').click();
    await eventually(async () => await page.locator('#history-rows tr').count() > 0);
    assert.match(await page.locator('#history-rows').textContent(), /0%/);
    await page.locator('#history-server').selectOption(publicSite.empty); await page.locator('#history-submit').click();
    await page.locator('#history-message').filter({ hasText: '没有历史' }).waitFor();
    assert.equal(await page.locator('#history-rows tr').count(), 0);
  });
  await step('THB09', '网络中断与恢复', '实际 Chromium offline 再恢复', '连接重建，快照/实时恢复且无双重连接', async () => {
    await context.setOffline(true);
    await publicSite.disconnectViewers();
    await page.locator('#connection').filter({ hasText: '中断' }).waitFor();
    await context.setOffline(false); await page.locator('#connection').filter({ hasText: '正常' }).waitFor();
    agent.send(JSON.stringify({ id: publicSite.visible, secret: publicSite.config.API_SECRET, metrics: { ...publicSite.metrics, timestamp: Date.now(), cpu: 94 } })); await hasCpu(94);
  });
  await step('THB09b', '真实标签页隐藏与恢复', '关闭焦点模拟，激活另一页，隐藏期间上报再切回', 'document.hidden=true 时继续更新，切回补取', async () => {
    // The independent default Chrome context has no Playwright focus defaults.
    await hiddenPage.bringToFront(); await coverPage.bringToFront();
    await eventually(() => hiddenPage.evaluate(() => document.hidden));
    agent.send(JSON.stringify({ id: publicSite.visible, secret: publicSite.config.API_SECRET, metrics: { ...publicSite.metrics, timestamp: Date.now(), cpu: 96 } }));
    await eventually(async () => await hiddenPage.locator(`[data-server-id="${publicSite.visible}"] .cpu`).textContent() === '96%');
    assert.equal(await hiddenPage.evaluate(() => document.hidden), true);
    let snapshots = 0; const count = request => { if (new URL(request.url()).pathname === '/api/servers') snapshots++; };
    hiddenPage.on('request', count); await hiddenPage.bringToFront();
    await eventually(async () => !(await hiddenPage.evaluate(() => document.hidden)) && snapshots > 0);
    hiddenPage.off('request', count); await hiddenPage.close(); await coverPage.close();
    await nativeBrowser.close(); nativeBrowser = null;
    const exited = once(nativeProcess, 'exit'); nativeProcess.kill('SIGTERM'); await exited; nativeProcess = null;
    return { hidden: true, hiddenCpu: 96, restoredSnapshot: true };
  });
  await step('THB10', '长名称、手机与明暗', '编辑长名称，在 390/1440 视口切换偏好并操作键盘', '无页面溢出，文字作为文本渲染，auto 跟随系统', async () => {
    await publicSite.edit(publicSite.visible, { name: '长名称'.repeat(16) + '<img src=x onerror=alert(1)>' });
    await page.locator('#refresh').click(); await page.locator('.name').filter({ hasText: '<img' }).waitFor();
    assert.equal(await page.locator('#server-rows img').count(), 0);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['light', 'dark']) {
      await page.locator('#theme').selectOption(theme);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await page.locator('#servers').evaluate(table => table.scrollWidth <= table.clientWidth), true);
      await page.screenshot({ path: join(evidence, `mobile-${theme}.png`), fullPage: true });
    }
    await page.locator('#theme').selectOption('auto'); await page.emulateMedia({ colorScheme: 'light' });
    await eventually(async () => await page.locator('body').evaluate(body => body.classList.contains('light')));
    await page.emulateMedia({ colorScheme: 'dark' });
    await eventually(async () => !(await page.locator('body').evaluate(body => body.classList.contains('light'))));
    await page.locator('#refresh').focus(); await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 1440, height: 900 }); await page.screenshot({ path: join(evidence, 'desktop.png'), fullPage: true });
  });
  await step('THB11', '删除与同 UUID 重建', '删除节点后补取，再导入同 UUID 并刷新', '旧节点移除，重建节点无旧 CPU', async () => {
    await publicSite.admin({ action: 'delete', id: publicSite.visible });
    await eventually(async () => await page.locator(`[data-server-id="${publicSite.visible}"]`).count() === 0);
    const imported = await publicSite.admin({ action: 'import_servers', servers: [{ id: publicSite.visible, name: '重建节点', is_hidden: '0' }] }); assert.equal(imported.status, 200);
    await page.locator('#refresh').click(); await eventually(async () => await page.locator(`[data-server-id="${publicSite.visible}"]`).count() === 1);
    assert.equal(await cpu().textContent(), '—'); agent.terminate(); agent = null;
  });
  await step('THB12', '独立 HTTPS 与 WSS', '独立 TLS origin 访问主控 TLS 代理，显式登录并收上报', 'CSP/CORS/Bearer 与真实 WSS 可用，不依赖跨站 Cookie', async () => {
    const independent = await context.newPage(); await independent.goto(staticOrigin);
    await eventually(async () => await rows(independent).count() === 2);
    assert.equal(await independent.locator('#admin-link').isVisible(), false);
    await login(independent, publicSite); await eventually(async () => await rows(independent).count() === 3);
    await publicSite.report(publicSite.visible, { ...publicSite.metrics, timestamp: Date.now(), cpu: 77 });
    await eventually(async () => await independent.locator(`[data-server-id="${publicSite.visible}"] .cpu`).textContent() === '77%');
    assert.ok(await independent.evaluate(origin => !!localStorage.getItem(`jwt_token:${origin}`), apiTlsOrigin));
    assert.equal(await independent.evaluate(origin => localStorage.getItem(`jwt_token:${origin}`), publicSite.base), null);
    const denied = await new Promise((resolve, reject) => {
      const ws = new WebSocket(apiTlsOrigin.replace('https:', 'wss:') + '/api/ws', { rejectUnauthorized: false, headers: { Origin: 'https://denied.example' } });
      const timeout = setTimeout(() => { ws.terminate(); reject(new Error('WSS origin rejection timeout')); }, 5000);
      ws.on('unexpected-response', (_, response) => { clearTimeout(timeout); resolve(response.statusCode); response.resume(); ws.terminate(); });
      ws.on('open', () => { clearTimeout(timeout); ws.terminate(); reject(new Error('Disallowed WSS origin accepted')); }); ws.on('error', () => {});
    }); assert.equal(denied, 403);
    await independent.locator('#logout').click(); await independent.close();
    return { tls: 'self-signed local', independentOrigin: true, WSS: true, deniedOrigin: 403 };
  });
  await step('THB12b', '浏览器拒绝未允许 CORS', '从同一静态服务的另一 origin 打开页面', '浏览器不能读取配置，页面没有节点或后台入口', async () => {
    const deniedPage = await context.newPage();
    await deniedPage.goto(`https://127.0.0.1:${staticPort}`);
    await deniedPage.locator('#notice').filter({ hasText: '无法补取' }).waitFor();
    assert.equal(await rows(deniedPage).count(), 0); assert.equal(await deniedPage.locator('#admin-link').isVisible(), false);
    await deniedPage.close();
  });
  await step('THB13', '页面退出清理', '关闭所有示例页面后观察主控连接数', '连接回收，无页面异常', async () => {
    await page.close(); await privatePage.close();
    await eventually(async () => (await publicSite.stats()).viewers === 0 && (await privateSite.stats()).viewers === 0);
    assert.deepEqual(pageErrors, []);
  });
} finally {
  agent?.terminate(); await browser?.close();
  await nativeBrowser?.close();
  if (nativeProcess && nativeProcess.exitCode === null) { const exited = once(nativeProcess, 'exit'); nativeProcess.kill('SIGTERM'); await exited; }
  await dev.close();
  for (const ws of proxyWss.clients) ws.terminate(); for (const ws of proxySockets) ws.terminate(); proxyWss.close();
  await close(staticTls); await close(apiProxy);
  await privateSite.close(); await publicSite.close();
}
