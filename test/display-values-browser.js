import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createThemeFixture, eventually, pause } from './helpers/themeFixture.js';

const evidence = resolve(process.env.DISPLAY_VALUES_EVIDENCE_DIR || 'output/test-results/display-values');
await mkdir(evidence, { recursive: true });
const module = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = module.default || module;
const fixture = await createThemeFixture();
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
      isolation: 'Temporary SQLite, loopback ports, external requests blocked, scheduler disabled; no production credentials' }, null, 2));
  }
}
async function newPage({ width = 1440, height = 900, token = '' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, locale: 'zh-CN', hasTouch: width < 700, reducedMotion: 'reduce' });
  await context.route('https://**', route => route.fulfill({ status: 503, body: '{}' }));
  await context.addInitScript(token => {
    localStorage.setItem('language_preference', 'zh'); localStorage.setItem('theme_preference', 'dark');
    if (token) localStorage.setItem(`jwt_token:${location.origin}`, token);
  }, token);
  const page = await context.newPage(); page.on('pageerror', error => pageErrors.push(error.message));
  return page;
}
// Resolves once the detail page has its live subscription, so reports cannot arrive before it.
async function openDetail(page, id) {
  const subscribed = new Promise(resolve => page.on('websocket', socket => socket.on('framereceived', frame => {
    if (String(frame.payload).includes('"subscribed"')) resolve();
  })));
  await page.goto(`${fixture.base}/#/server/${id}`);
  await Promise.race([subscribed, pause(15000).then(() => { throw new Error('Detail page did not subscribe'); })]);
  await pause(500);
}
async function lastUpdate(page) {
  const text = await page.locator('.sysinfo-item').filter({ hasText: '⏰' }).locator('.sysinfo-value').innerText();
  return { text, time: await page.evaluate(value => new Date(value.replace(' ', 'T')).getTime(), text) };
}
const amount = text => Number(text.replace(/[^\d.]/g, ''));

try {
  browser = await chromium.launch({ headless: true, ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}) });
  const nodeId = (await fixture.admin({ action: 'add', name: '详情时间节点' })).body.id;
  const page = await newPage();
  await step('DV01', '详情页最后更新', '节点上报一次后停止，6 秒后打开详情页', '显示主控收到上报的时间，不显示打开页面的时间，节点仍算在线', async () => {
    const reportedAt = Date.now();
    await fixture.report(nodeId, { ...fixture.metrics, cpu: 33, timestamp: reportedAt });
    await pause(6000);
    const openedAt = Date.now();
    await openDetail(page, nodeId);
    const shown = await lastUpdate(page);
    assert.ok(Math.abs(shown.time - reportedAt) <= 2000, `最后更新 ${shown.text} 应接近上报时间 ${new Date(reportedAt).toISOString()}`);
    assert.ok(openedAt - shown.time >= 4000, `最后更新 ${shown.text} 不应接近打开页面的时间`);
    await page.locator('.status-badge.online').waitFor({ timeout: 2000 });
    await page.screenshot({ path: join(evidence, 'detail-last-update.png') });
    return { shown: shown.text, reportAgeWhenOpenedMs: openedAt - reportedAt, online: true };
  });
  await step('DV02', '实时上报推进最后更新', '页面打开时收到一包采样时间早 30 秒的补报', '最后更新变为主控接收时间，不回退到采样时间，节点保持在线', async () => {
    const reportedAt = Date.now();
    await fixture.report(nodeId, { ...fixture.metrics, cpu: 41, timestamp: reportedAt - 30000 });
    await eventually(async () => Math.abs((await lastUpdate(page)).time - reportedAt) <= 2000, 8000);
    await pause(1000);
    const shown = await lastUpdate(page);
    assert.ok(Math.abs(shown.time - reportedAt) <= 2000);
    await page.locator('.status-badge.online').waitFor({ timeout: 2000 });
    return { shown: shown.text, online: true };
  });
  await step('DV03', '详情图表', '读取图表画布并切换时间范围', '移除日期适配器后图表正常绘制，切换范围无脚本错误', async () => {
    const painted = () => page.evaluate(() => [...document.querySelectorAll('canvas')].filter(canvas => canvas.offsetWidth > 0).map(canvas => {
      const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
      let pixels = 0; for (let index = 3; index < data.length; index += 4) if (data[index]) pixels++;
      return pixels;
    }));
    const realtime = await painted();
    assert.ok(realtime.filter(pixels => pixels > 0).length >= 4, JSON.stringify(realtime));
    await page.locator('.time-btn').nth(3).click();
    await page.waitForResponse(response => response.url().includes('/api/history/all'), { timeout: 5000 }).catch(() => {});
    await pause(500);
    const switched = await painted();
    assert.ok(switched.filter(pixels => pixels > 0).length >= 4, JSON.stringify(switched));
    const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
    for (const name of ['chartjs-adapter-date-fns', 'date-fns']) assert.equal(lock.packages[`node_modules/${name}`], undefined, name);
    return { realtimeCharts: realtime.length, switchedCharts: switched.length };
  });
  await page.context().close();
  await step('DV04', '预付多周期的剩余价值', '月付 ¥30、还剩约 90 天的节点，打开首页和财务弹窗', '首页汇总、总价值和逐台卡片都按剩余时长折算，月均支出不变', async () => {
    const paidId = (await fixture.admin({ action: 'add', name: '预付节点' })).body.id;
    await fixture.edit(paidId, { price: '30', currency: '¥', billing_cycle: 'month', expire_date: new Date(Date.now() + 90 * 86400000).toISOString().slice(0, 10) });
    const pages = [];
    for (const [width, height] of [[1440, 900], [375, 812]]) {
      const view = await newPage({ width, height });
      await view.goto(`${fixture.base}/`);
      const stat = view.locator('.stat-action-item .stat-main-value');
      await stat.waitFor();
      const home = amount((await stat.innerText()).split(/\s/)[0]);
      await view.locator('.stat-action-item').click();
      const cards = view.locator('.finance-summary-card .finance-summary-value');
      await cards.first().waitFor();
      const [total, remaining, monthly] = (await cards.allInnerTexts()).map(amount);
      const row = amount(await view.locator('.finance-server-value dd').innerText());
      for (const value of [home, total, remaining, row]) assert.ok(value > 88 && value <= 90, `预付剩余价值应约为 ¥90，实际 ${value}`);
      assert.ok(Math.abs(monthly - 30) < 0.01, `月均支出应保持 ¥30，实际 ${monthly}`);
      assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await pause(400); // Let the modal fade-in finish before the evidence screenshot.
      await view.screenshot({ path: join(evidence, `finance-${width}.png`) });
      await view.context().close();
      pages.push({ width, home, total, remaining, row, monthly });
    }
    return pages;
  });
  await step('DV05', '后台复制安装命令', '管理员打开节点的安装命令弹窗，再切换为专用用户安装', '命令只含连接参数且语法有效，弹窗按节点实际配置展示间隔和 Ping 模式', async () => {
    const id = (await fixture.admin({ action: 'add', name: '安装命令节点' })).body.id;
    await fixture.edit(id, { connection_mode: 'http', ping_mode: 'icmp', report_interval: 120, collect_interval: 5, reset_day: 9, custom_ct: 'ct.fixture.invalid:443', interface: 'eth0', rx_correction: 3, auto_update: '1' });
    const view = await newPage({ token: fixture.token });
    await view.goto(`${fixture.base}/${fixture.config.ADMIN_PATH}`);
    await view.locator('tr').filter({ hasText: '安装命令节点' }).locator('.action-btns button').first().click();
    const modal = view.locator('#copyModal.active'); await modal.waitFor();
    const check = async () => {
      const command = await modal.locator('.cmd-output').innerText();
      assert.equal(spawnSync('sh', ['-n'], { input: command, encoding: 'utf8' }).status, 0);
      for (const argument of [`--download-url=${fixture.base}/agent`, `-id=${id}`, `-url=${fixture.base}/update`, '-auto_update=1']) assert.ok(command.includes(argument), argument);
      for (const name of ['collect_interval', 'interval', 'connection_mode', 'ping_mode', 'reset_day', 'ct', 'interface', 'rx_correction']) assert.ok(!command.includes(`-${name}=`), name);
      const rows = await modal.locator('.config-row').allInnerTexts();
      for (const value of ['120 s', '5 s', 'ICMP (root)', 'eth0', 'ct.fixture.invalid:443', '3 GB']) assert.ok(rows.some(row => row.includes(value)), value);
      return command;
    };
    const currentUser = await check();
    await modal.locator('.form-select').nth(1).selectOption('cfsm-user');
    await eventually(async () => (await modal.locator('.cmd-output').innerText()).includes('useradd'));
    const dedicatedUser = await check();
    await pause(400);
    await view.screenshot({ path: join(evidence, 'install-command.png') });
    await view.context().close();
    return { currentUserLength: currentUser.length, dedicatedUserLength: dedicatedUser.length };
  });
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
  await fixture.close();
}
