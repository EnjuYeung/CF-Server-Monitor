import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createThemeFixture, eventually } from './helpers/themeFixture.js';

const evidence = resolve(process.env.SETTINGS_EVIDENCE_DIR || 'output/test-results/settings-browser');
await mkdir(evidence, { recursive: true });
const module = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = module.default || module;
const fixture = await createThemeFixture();
const receiver = createServer((req, res) => { req.resume(); res.writeHead(200).end('ok'); });
receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
await fixture.admin({ action: 'save_settings', settings: { notification_webhook_enabled: true, notification_webhook_url: `http://127.0.0.1:${receiver.address().port}/notify`, expire_reminder: '7' } });
// Reproduce an old installation's boolean value before starting any browser cases.
const stored = JSON.parse(fixture.controller.env.DB.prepare("SELECT value FROM settings WHERE key='site_options'").first().value);
stored.expire_reminder = true;
fixture.controller.env.DB.prepare("UPDATE settings SET value=? WHERE key='site_options'").bind(JSON.stringify(stored)).run();
await fixture.restart();
let configMode = 'normal';
const proxy = createServer(async (req, res) => {
  if (req.url === '/api/config' && configMode !== 'normal') {
    if (configMode === 'body') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"version":'); }
    return;
  }
  try {
    const response = await fetch(new URL(req.url, fixture.base));
    const headers = Object.fromEntries(response.headers);
    delete headers['transfer-encoding']; delete headers.connection;
    res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
  } catch { if (!res.destroyed) res.writeHead(502).end(); }
});
proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
const proxyBase = `http://127.0.0.1:${proxy.address().port}`;
const results = [], pageErrors = [];
let browser;
async function step(id, feature, operation, expected, callback) {
  const started = Date.now();
  try {
    const detail = await callback();
    results.push({ id, feature, operation, expected, status: 'PASS', durationMs: Date.now() - started, evidence: detail });
    console.log(`${id} PASS ${feature}`);
  } catch (error) {
    results.push({ id, feature, operation, expected, status: 'FAIL', evidence: error.stack }); throw error;
  } finally {
    await writeFile(join(evidence, 'browser.json'), JSON.stringify({ date: new Date().toISOString(), results, pageErrors,
      isolation: 'Temporary SQLite, loopback ports, local webhook/proxy, scheduler disabled; no production credentials' }, null, 2));
  }
}
async function context({ width = 1440, height = 900, theme = 'dark', language = 'zh', authenticated = false } = {}) {
  const current = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', hasTouch: width < 700, reducedMotion: 'reduce' });
  await current.route('https://**', route => route.fulfill({ status: 503, body: '{}' }));
  await current.addInitScript(({ theme, language, token }) => {
    localStorage.setItem('theme_preference', theme); localStorage.setItem('language_preference', language);
    if (token) localStorage.setItem(`jwt_token:${location.origin}`, token);
  }, { theme, language, token: authenticated ? fixture.token : '' });
  return current;
}
async function open(current, url = `${fixture.base}/${fixture.config.ADMIN_PATH}`) {
  const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(url); return page;
}
const showSettings = async page => { await page.locator('.tab-btn').nth(1).click(); await page.locator('#expire-reminder-mode').waitFor(); };

try {
  browser = await chromium.launch({ headless: true, ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}) });
  const desktop = await context(); const page = await open(desktop);
  await step('AS01', '旧安装与离线选项', '真实登录后台并读取旧布尔提醒值', '旧 true 显示 7 天，离线选项支持 2 分钟', async () => {
    await page.locator('#login-username').fill('admin'); await page.locator('#login-password').fill(fixture.config.API_SECRET);
    await page.locator('.login-btn').click(); await showSettings(page);
    assert.equal(await page.locator('#expire-reminder-mode').inputValue(), '7');
    await page.locator('#offline-notify-minutes').selectOption('2');
    return { legacyDays: 7, offlineMinutes: 2 };
  });
  await step('AS02', '自定义天数与输入验证', '键入 12、切换预设、输入非法值后保存 365', '输入焦点稳定，非法值显示提示并阻止保存，实际 API 保存成功', async () => {
    const mode = page.locator('#expire-reminder-mode'), input = page.locator('#expire-reminder-days');
    const save = page.locator('#tab-settings > .text-right button');
    await mode.selectOption('__custom__'); await input.fill('1'); await input.press('2');
    assert.equal(await input.inputValue(), '12'); assert.equal(await input.evaluate(element => element === document.activeElement), true);
    await mode.selectOption('5'); assert.equal(await input.count(), 0);
    await mode.selectOption('__custom__'); assert.equal(await input.inputValue(), '5');
    for (const invalid of ['', '0', '-1', '1.5', '366']) {
      await input.fill(invalid); assert.equal(await input.getAttribute('aria-invalid'), 'true'); assert.equal(await save.isDisabled(), true);
    }
    await input.fill('365'); assert.equal(await save.isEnabled(), true);
    const response = page.waitForResponse(response => response.request().method() === 'POST' && response.request().postData()?.includes('save_settings'));
    await save.click(); assert.equal((await response).status(), 200);
    await eventually(async () => (await fixture.admin({ action: 'get_settings' })).body.settings.expire_reminder === '365');
    const settings = (await fixture.admin({ action: 'get_settings' })).body.settings;
    assert.equal(settings.tg_notify, '2');
    return { focusStable: true, invalidValuesRejected: 5, savedDays: settings.expire_reminder, offlineMinutes: settings.tg_notify };
  });
  await step('AS03', '刷新持久化及三语言', '刷新后台并分别用中文、英文、日文读取自定义值', '365 天和 2 分钟保留，标签及范围提示均有翻译', async () => {
    const labels = [];
    for (const language of ['zh', 'en', 'ja']) {
      const current = await context({ language, authenticated: true });
      try {
        const localized = await open(current); await showSettings(localized);
        assert.equal(await localized.locator('#expire-reminder-days').inputValue(), '365');
        assert.equal(await localized.locator('#offline-notify-minutes').inputValue(), '2');
        const label = await localized.locator('label[for="expire-reminder-days"]').innerText();
        assert.ok(label); assert.match(await localized.locator('#expire-reminder-help').innerText(), /365/); labels.push({ language, label });
      } finally { await current.close(); }
    }
    return { persisted: true, labels };
  });
  await step('AS04', '桌面手机明暗与键盘', '1440px/375px 明暗页面、手机横屏及 Tab 操作', '页面无横向溢出，输入可用键盘到达，控件不少于 44px', async () => {
    const layouts = [];
    for (const width of [1440, 375]) for (const theme of ['dark', 'light']) {
      const current = await context({ width, height: width === 375 ? 812 : 900, theme, authenticated: true });
      try {
        const view = await open(current); await showSettings(view);
        const input = view.locator('#expire-reminder-days'); await view.locator('#expire-reminder-mode').focus(); await view.keyboard.press('Tab');
        assert.equal(await input.evaluate(element => element === document.activeElement), true);
        const layout = await view.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth,
          height: document.querySelector('#expire-reminder-days').getBoundingClientRect().height }));
        assert.ok(layout.content <= layout.width); assert.ok(layout.height >= 44);
        await input.evaluate(element => element.scrollIntoView({ block: 'center' }));
        await view.screenshot({ path: join(evidence, `${width}-${theme}.png`) });
        if (width === 375) { await view.setViewportSize({ width: 667, height: 375 }); assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); }
        layouts.push({ ...layout, theme });
      } finally { await current.close(); }
    }
    return layouts;
  });
  for (const [id, mode] of [['AS05', 'headers'], ['AS06', 'body']]) {
    await step(id, `启动配置超时：${mode}`, '隔离代理挂起配置响应，实际等待启动请求超时', '15 秒后显示可刷新重试提示，保留认证令牌', async () => {
      configMode = mode;
      const current = await context({ authenticated: true });
      try {
        const started = Date.now(); const view = await open(current, proxyBase);
        await view.locator('#loading').filter({ hasText: '无法连接主控' }).waitFor({ timeout: 20000 });
        const elapsedMs = Date.now() - started;
        assert.ok(elapsedMs >= 14000 && elapsedMs < 21000);
        assert.equal(await view.evaluate(() => !!localStorage.getItem(`jwt_token:${location.origin}`)), true);
        return { elapsedMs, retryMessage: await view.locator('#loading').innerText(), tokenRetained: true };
      } finally { await current.close(); configMode = 'normal'; }
    });
  }
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  for (const server of [proxy, receiver]) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await fixture.close();
}
