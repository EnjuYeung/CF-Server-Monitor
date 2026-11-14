import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createThemeFixture, eventually, pause } from './helpers/themeFixture.js';

const evidence = resolve(process.env.ROUND3_EVIDENCE_DIR || 'output/test-results/round3-browser');
await mkdir(evidence, { recursive: true });
const module = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = module.default || module;
const fixture = await createThemeFixture();
const receiver = createServer((req, res) => { req.resume(); res.writeHead(200).end('ok'); });
receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
await fixture.admin({ action: 'save_settings', settings: {
  notification_webhook_enabled: true, notification_webhook_url: `http://127.0.0.1:${receiver.address().port}/notify`
} });
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
      isolation: 'Temporary SQLite, loopback ports, local webhook, external requests blocked, scheduler disabled; no production credentials' }, null, 2));
  }
}
async function context({ width = 1440, height = 900, theme = 'dark', authenticated = false } = {}) {
  const current = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', hasTouch: width < 700, reducedMotion: 'reduce', acceptDownloads: true });
  await current.route('https://**', route => route.fulfill({ status: 503, body: '{}' }));
  await current.addInitScript(({ theme, token }) => {
    localStorage.setItem('theme_preference', theme); localStorage.setItem('language_preference', 'zh');
    if (token) localStorage.setItem(`jwt_token:${location.origin}`, token);
  }, { theme, token: authenticated ? fixture.token : '' });
  return current;
}
async function open(current, path = `/${fixture.config.ADMIN_PATH}`) {
  const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(fixture.base + path); return page;
}
const showTab = async (page, index) => { await page.locator('.tab-btn').nth(index).click(); await pause(200); };
const settingsOf = async () => (await fixture.admin({ action: 'get_settings' })).body.settings;
const serverOf = async id => (await fixture.admin({ action: 'list' })).body.servers.find(server => server.id === id);
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

try {
  browser = await chromium.launch({ headless: true, ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}) });

  await step('UB01', '资源告警 TCP/UDP 连接数', '后台新增规则并选 TCP 连接数、保存 2500、刷新，再切换指标', '选项可选；跨单位切换重置为该单位默认值；保存后刷新仍为 TCP 2500', async () => {
    const current = await context({ authenticated: true });
    try {
      const page = await open(current); await showTab(page, 1);
      await page.locator('.resource-alert-header .btn-primary').click();
      const rule = page.locator('.resource-alert-rule').last();
      const metric = rule.locator('select.form-select').first();
      const threshold = rule.locator('input[type="number"]').first();
      const labels = await metric.locator('option').allInnerTexts();
      assert.ok(labels.includes('TCP 连接数') && labels.includes('UDP 连接数'), labels.join(','));
      assert.equal(await threshold.inputValue(), '80');
      await metric.selectOption('tcpConn');
      assert.equal(await threshold.inputValue(), '1000', 'percent → count resets to 1000');
      await threshold.fill('2500');
      const saved = page.waitForResponse(response => response.request().postData()?.includes('save_settings'));
      await page.locator('.settings-save-bar button').click();
      assert.equal((await saved).status(), 200);
      const stored = (await settingsOf()).resource_alert_rules || [];
      const rules = typeof stored === 'string' ? JSON.parse(stored) : stored;
      assert.equal(rules.at(-1).metric, 'tcpConn'); assert.equal(rules.at(-1).threshold, '2500');
      await page.reload(); await showTab(page, 1);
      const toggle = page.locator('.resource-alert-toggle');
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
      const reloaded = page.locator('.resource-alert-rule').last();
      assert.equal(await reloaded.locator('select.form-select').first().inputValue(), 'tcpConn');
      assert.equal(await reloaded.locator('input[type="number"]').first().inputValue(), '2500');
      await reloaded.locator('select.form-select').first().selectOption('udpConn');
      assert.equal(await reloaded.locator('input[type="number"]').first().inputValue(), '2500', 'same unit keeps the value');
      await reloaded.locator('select.form-select').first().selectOption('cpu');
      assert.equal(await reloaded.locator('input[type="number"]').first().inputValue(), '80', 'count → percent resets to 80');
      await reloaded.scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(evidence, 'tcp-rule.png') });
      return { options: labels, saved: rules.at(-1) };
    } finally { await current.close(); }
  });

  await step('UB02', 'URL 输入框清除按钮', '桌面与手机触屏分别填写背景图地址后点击 ×', '桌面悬停/聚焦显示，手机常驻显示；点击区域不小于 44px；点击后清空并回到输入框', async () => {
    const layouts = [];
    for (const width of [1440, 375]) {
      const current = await context({ width, height: width === 375 ? 812 : 900, authenticated: true });
      try {
        const page = await open(current); await showTab(page, 1);
        const wrap = page.locator('.input-clear-wrap').first();
        const input = wrap.locator('input');
        await input.fill('https://example.invalid/background.png');
        const button = wrap.locator('.input-clear-btn');
        if (width === 375) await page.locator('body').click({ position: { x: 5, y: 5 } });
        const opacity = await button.evaluate(element => getComputedStyle(element).opacity);
        if (width === 375) assert.equal(opacity, '1', 'touch screens show the button without hover');
        await input.focus();
        const box = await button.boundingBox();
        assert.ok(box.width >= 44 && box.height >= 44, JSON.stringify(box));
        assert.equal(await button.getAttribute('aria-label'), '清空');
        await page.screenshot({ path: join(evidence, `clear-button-${width}.png`) });
        await button.click();
        assert.equal(await input.inputValue(), '');
        assert.equal(await input.evaluate(element => element === document.activeElement), true);
        assert.equal(await button.count(), 0);
        assert.equal(await noOverflow(page), true);
        layouts.push({ width, box, idleOpacity: opacity });
      } finally { await current.close(); }
    }
    return layouts;
  });

  await step('UB03', '导出节点失败提示', '后台导出时接口返回失败，再恢复正常导出', '失败时显示红色提示；成功时下载 JSON 且提示消失', async () => {
    const current = await context({ authenticated: true });
    try {
      const page = await open(current); await showTab(page, 2);
      const exportButton = page.locator('#tab-database .settings-section').nth(1).locator('button').first();
      await page.route(`**/${fixture.config.ADMIN_PATH}/api`, route => route.request().postData()?.includes('export_servers')
        ? route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Internal error' }) })
        : route.continue());
      await exportButton.click();
      const notice = page.locator('#tab-database [role="alert"]').filter({ hasText: '服务器导出失败' });
      await notice.waitFor({ timeout: 5000 });
      await page.screenshot({ path: join(evidence, 'export-failed.png') });
      await page.unroute(`**/${fixture.config.ADMIN_PATH}/api`);
      const download = page.waitForEvent('download');
      await exportButton.click();
      const file = await download;
      assert.match(file.suggestedFilename(), /^servers-backup-\d{4}-\d{2}-\d{2}\.json$/);
      await eventually(async () => (await notice.count()) === 0);
      return { failureText: '服务器导出失败', downloaded: file.suggestedFilename() };
    } finally { await current.close(); }
  });

  const anchorId = (await fixture.admin({ action: 'add', name: '月末账单节点', price: '10', billing_cycle: 'month', currency: '¥', expire_date: '2027-02-28' })).body.id;
  await fixture.edit(anchorId, { auto_renewal: '1', expire_date: '2027-02-28', billing_anchor_day: 31 });

  await step('UB04', '开启自动更新前确认', '编辑节点勾选自动更新：先取消，再确认并保存；再取消勾选', '勾选先弹确认框且焦点在取消；取消后不勾选；确认后保存为开启；取消勾选不弹框', async () => {
    const current = await context({ authenticated: true });
    try {
      const page = await open(current);
      await page.locator('tr').filter({ hasText: '月末账单节点' }).locator('.action-btns .btn-blue').click();
      const modal = page.locator('#editModal.active'); await modal.waitFor();
      const checkbox = modal.locator('.checkbox-item').filter({ hasText: '自动更新' }).locator('input[type="checkbox"]');
      const dialog = page.locator('.auto-update-confirm');
      await checkbox.click();
      await dialog.waitFor();
      assert.equal(await checkbox.isChecked(), false, 'not enabled before confirmation');
      assert.equal(await dialog.locator('button.btn:not(.btn-primary)').evaluate(element => element === document.activeElement), true);
      assert.match(await dialog.innerText(), /重新复制安装命令/);
      await pause(500); // let the fade-in finish before the evidence screenshot
      await page.screenshot({ path: join(evidence, 'auto-update-confirm.png') });
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      assert.equal(await checkbox.isChecked(), false);
      await checkbox.click(); await dialog.locator('.btn-primary').click();
      assert.equal(await checkbox.isChecked(), true);
      const saved = page.waitForResponse(response => response.request().postData()?.includes('"action":"edit"'));
      await modal.locator('.modal-footer .btn-primary').click();
      assert.equal((await saved).status(), 200);
      assert.equal((await serverOf(anchorId)).auto_update, '1');
      await page.reload();
      await page.locator('tr').filter({ hasText: '月末账单节点' }).locator('.action-btns .btn-blue').click();
      await modal.waitFor();
      await checkbox.click();
      assert.equal(await checkbox.isChecked(), false);
      assert.equal(await dialog.count(), 0, 'disabling needs no confirmation');
      return { cancelKeepsOff: true, confirmSaved: '1' };
    } finally { await current.close(); }
  });

  await step('UB05', '账单日提示与改日期', '打开 02-28、账单日 31 的自动续费节点，再改为 03-15 保存', '显示“续费回到每月 31 日”；改日期后提示消失，保存后账单日为 15', async () => {
    const current = await context({ authenticated: true });
    try {
      const page = await open(current);
      await page.locator('tr').filter({ hasText: '月末账单节点' }).locator('.action-btns .btn-blue').click();
      const modal = page.locator('#editModal.active'); await modal.waitFor();
      const hint = modal.locator('p.text-muted').filter({ hasText: '续费回到每月 31 日' });
      await hint.waitFor();
      await page.screenshot({ path: join(evidence, 'billing-anchor-hint.png') });
      await modal.locator('input[name="edit_expire_date"]').fill('2027-03-15');
      await eventually(async () => (await hint.count()) === 0);
      const saved = page.waitForResponse(response => response.request().postData()?.includes('"action":"edit"'));
      await modal.locator('.modal-footer .btn-primary').click();
      assert.equal((await saved).status(), 200);
      const server = await serverOf(anchorId);
      assert.equal(server.expire_date, '2027-03-15'); assert.equal(server.billing_anchor_day, 15);
      return { before: 31, after: server.billing_anchor_day };
    } finally { await current.close(); }
  });

  const expiredId = (await fixture.admin({ action: 'add', name: '已过期计价节点', price: '20', billing_cycle: 'month', currency: '¥', expire_date: '2026-01-01' })).body.id;
  const noExpiryId = (await fixture.admin({ action: 'add', name: '无到期计价节点', price: '5', billing_cycle: 'month', currency: '¥' })).body.id;
  for (const id of [anchorId, expiredId, noExpiryId]) await fixture.report(id, { ...fixture.metrics, timestamp: Date.now() });

  await step('UB06', '财务弹窗计数与手机首页两列', '1440/375px 明暗打开首页与财务弹窗；关闭价格展示后再看手机首页', '弹窗显示已计价/已到期/无到期日；手机统计两列等高、无横向溢出；关闭价格后最后一项占满整行', async () => {
    const pages = [];
    for (const width of [1440, 375]) for (const theme of ['dark', 'light']) {
      const current = await context({ width, height: width === 375 ? 812 : 900, theme });
      try {
        const page = await open(current, '/');
        await page.locator('.global-stats .stat-item').first().waitFor();
        const grid = await page.evaluate(() => {
          const stats = document.querySelector('.global-stats');
          const items = [...stats.querySelectorAll('.stat-item')].map(item => item.getBoundingClientRect());
          return { columns: getComputedStyle(stats).gridTemplateColumns.split(' ').length, heights: items.map(box => Math.round(box.height)), tops: items.map(box => Math.round(box.top)) };
        });
        if (width === 375) {
          assert.equal(grid.columns, 2, JSON.stringify(grid));
          assert.equal(grid.heights[0], grid.heights[1], 'two columns keep the same height');
          assert.equal(grid.tops[0], grid.tops[1]);
        }
        assert.equal(await noOverflow(page), true);
        await page.screenshot({ path: join(evidence, `stats-${width}-${theme}.png`) });
        await page.locator('.stat-action-item').click();
        const meta = page.locator('.finance-modal-meta'); await meta.waitFor();
        const text = await meta.innerText();
        assert.match(text, /已计价: \d+/); assert.match(text, /已到期: 1/); assert.match(text, /无到期日: 1/);
        await pause(400);
        await page.screenshot({ path: join(evidence, `finance-meta-${width}-${theme}.png`) });
        pages.push({ width, theme, grid, meta: text });
      } finally { await current.close(); }
    }
    await fixture.admin({ action: 'save_settings', settings: { show_price: 'false' } });
    const current = await context({ width: 375, height: 812 });
    try {
      const page = await open(current, '/');
      const full = page.locator('.global-stats .stat-item-full'); await full.waitFor();
      const widths = await page.evaluate(() => ({ grid: document.querySelector('.global-stats').getBoundingClientRect().width,
        full: document.querySelector('.stat-item-full').getBoundingClientRect().width }));
      assert.ok(widths.full >= widths.grid - 4, JSON.stringify(widths));
      await page.screenshot({ path: join(evidence, 'stats-375-no-price.png') });
      pages.push({ noPrice: widths });
    } finally {
      await current.close();
      await fixture.admin({ action: 'save_settings', settings: { show_price: 'true' } });
    }
    return pages;
  });

  await step('UB07', '到期时区一致', '时钟固定在北京时间 11-15 04:00，节点到期日 11-15；分别用上海时区和 UTC 打开首页与详情', '上海时区显示已到期；UTC 显示 1 天，和提醒/续费的日期边界一致', async () => {
    const tzId = (await fixture.admin({ action: 'add', name: '时区到期节点', expire_date: '2026-11-15' })).body.id;
    await fixture.report(tzId, { ...fixture.metrics, timestamp: Date.now() });
    const shown = {};
    for (const zone of ['Asia/Shanghai', 'UTC']) {
      await fixture.admin({ action: 'save_settings', settings: { notification_timezone: zone } });
      const current = await context();
      try {
        const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
        await page.clock.setFixedTime(new Date('2026-11-14T20:00:00Z'));
        await page.goto(`${fixture.base}/`);
        await page.locator('.card-meta-expire').first().waitFor();
        const card = await page.locator('.server-card').filter({ hasText: '时区到期节点' }).locator('.card-meta-expire').innerText();
        await page.goto(`${fixture.base}/#/server/${tzId}`);
        const detail = page.locator('.sysinfo-item').filter({ hasText: '📅' });
        await detail.first().waitFor({ timeout: 8000 });
        shown[zone] = { card: card.trim(), detail: (await detail.first().innerText()).trim() };
        await page.screenshot({ path: join(evidence, `expiry-${zone.replace('/', '-')}.png`) });
      } finally { await current.close(); }
    }
    assert.match(shown['Asia/Shanghai'].card, /已到期/); assert.match(shown['Asia/Shanghai'].detail, /已到期/);
    assert.doesNotMatch(shown.UTC.card, /已到期/); assert.match(shown.UTC.card, /1/);
    assert.doesNotMatch(shown.UTC.detail, /已到期/);
    await fixture.admin({ action: 'save_settings', settings: { notification_timezone: 'UTC' } });
    return shown;
  });

  const pingId = (await fixture.admin({ action: 'add', name: '范围切换节点' })).body.id;
  await fixture.report(pingId, { ...fixture.metrics, ping_ct: 80, loss_ct: 0, timestamp: Date.now() });

  await step('UB08', '详情页切换范围', '实时范围有数据；点 1 小时（响应延迟 2.5 秒）后立即点 6 小时（无数据）', '6 小时无数据时清空平均延迟；晚到的 1 小时响应不覆盖当前范围', async () => {
    const current = await context();
    try {
      const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
      const ping = page.locator('.ping-indicator span').filter({ hasText: '电信' }).first();
      await page.goto(`${fixture.base}/#/server/${pingId}`);
      await eventually(async () => (await ping.count()) > 0 && /80ms/.test(await ping.innerText()), 10000);
      let staleArrived = false;
      await page.route('**/api/history/all**', async route => {
        const hours = new URL(route.request().url()).searchParams.get('hours');
        if (hours === '1') { await pause(2500); await route.continue(); staleArrived = true; return; }
        if (hours === '6') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
        return route.continue();
      });
      const buttons = page.locator('.time-btn');
      await buttons.nth(2).click(); await buttons.nth(3).click();
      await eventually(async () => /超时/.test(await ping.innerText()), 3000);
      await eventually(() => staleArrived, 6000);
      await pause(800);
      assert.match(await ping.innerText(), /超时/, 'late 1h response must not draw over the 6h range');
      assert.match(await buttons.nth(3).getAttribute('class'), /active/);
      await page.screenshot({ path: join(evidence, 'detail-range-race.png') });
      return { realtime: '80ms', afterEmptyRange: await ping.innerText(), staleIgnored: true };
    } finally { await current.close(); }
  });

  await step('UB09', '详情页初始化未完成即离开', '首页进入详情，历史请求挂起 3 秒时返回首页，再等待 4 秒', '离开后不再建立详情实时连接，无页面错误', async () => {
    const current = await context();
    try {
      const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
      const sockets = [];
      page.on('websocket', socket => sockets.push(socket.url()));
      await page.goto(`${fixture.base}/`);
      await page.locator('.global-stats .stat-item').first().waitFor();
      await page.route('**/api/history/all**', async route => { await pause(3000); await route.continue().catch(() => {}); });
      await page.evaluate(id => { location.hash = `#/server/${id}`; }, pingId);
      await pause(600);
      await page.evaluate(() => { location.hash = '#/'; });
      await pause(4500);
      const detailSockets = sockets.filter(url => url.includes(`subscribe=${pingId}`));
      assert.deepEqual(detailSockets, [], 'no live connection is created for a page that has been left');
      return { sockets: sockets.map(url => new URL(url).searchParams.get('subscribe')) };
    } finally { await current.close(); }
  });

  await step('UB10', '看板 WS 超时生效', '后台设 1 分钟；打开首页走到 61 秒；先关闭提示，再刷新后选继续', '超时后断开并弹提示；关闭后保持暂停不重连；继续后重新连接', async () => {
    await fixture.admin({ action: 'save_settings', settings: { frontend_ws_timeout_minutes: '1' } });
    const current = await context();
    try {
      const page = await current.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
      const sockets = [];
      page.on('websocket', socket => { const entry = { url: socket.url(), closed: false }; socket.on('close', () => { entry.closed = true; }); sockets.push(entry); });
      await page.clock.install();
      await page.goto(`${fixture.base}/`);
      await page.locator('.global-stats .stat-item').first().waitFor();
      await eventually(() => sockets.some(socket => socket.url.includes('subscribe=all')), 8000);
      const dialog = page.locator('.live-timeout-dialog');
      assert.equal(await dialog.count(), 0);
      await page.clock.fastForward('01:01');
      await dialog.waitFor({ timeout: 5000 });
      await eventually(() => sockets.every(socket => socket.closed), 5000);
      await pause(500);
      await page.screenshot({ path: join(evidence, 'dashboard-ws-timeout.png') });
      const before = sockets.length;
      await dialog.locator('button.btn:not(.btn-primary)').click();
      await dialog.waitFor({ state: 'detached' });
      await page.evaluate(() => { window.dispatchEvent(new Event('focus')); window.dispatchEvent(new Event('online')); });
      await page.clock.fastForward('02:00');
      await pause(500);
      assert.equal(sockets.length, before, 'closed prompt keeps the dashboard paused');
      await page.reload();
      await page.locator('.global-stats .stat-item').first().waitFor();
      await page.clock.fastForward('01:01');
      await dialog.waitFor({ timeout: 5000 });
      const beforeContinue = sockets.length;
      await dialog.locator('.btn-primary').click();
      await dialog.waitFor({ state: 'detached' });
      await eventually(() => sockets.length > beforeContinue && !sockets.at(-1).closed, 8000);
      return { socketsOpened: sockets.length, pausedAfterClose: true, reconnectedOnContinue: true };
    } finally {
      await current.close();
      await fixture.admin({ action: 'save_settings', settings: { frontend_ws_timeout_minutes: '0' } });
    }
  });

  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  receiver.closeAllConnections(); await new Promise(resolve => receiver.close(resolve));
  await fixture.close();
}
