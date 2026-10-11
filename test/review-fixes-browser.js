import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createThemeProcessFixture, eventually } from './helpers/themeFixture.js';

const evidence = resolve(process.env.REVIEW_EVIDENCE_DIR || 'output/test-results/review-fixes-browser');
await mkdir(evidence, { recursive: true });
const module = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = module.default || module;
// Each controller has its own module caches, SQLite directory and credentials.
const builtin = await createThemeProcessFixture();
const minimal = await createThemeProcessFixture();
await minimal.admin({ action: 'save_settings', settings: { theme_url: minimal.themeUrl('d'.repeat(40)) } });
let browser;
const results = [], pageErrors = [];
async function step(id, feature, operation, expected, callback) {
  try {
    const detail = await callback(); results.push({ id, feature, operation, expected, status: 'PASS', evidence: detail });
    console.log(`${id} PASS ${feature}`);
  } catch (error) { results.push({ id, feature, operation, expected, status: 'FAIL', evidence: error.message }); throw error; }
  finally { await writeFile(join(evidence, 'browser.json'), JSON.stringify({ date: new Date().toISOString(), results, pageErrors,
    upstream: 'Local file fixture replaces GitHub files; no real publication', isolation: 'Random loopback ports, temporary SQLite, scheduler disabled' }, null, 2)); }
}
try {
  browser = await chromium.launch({ headless: true, ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  await context.addInitScript(() => {
    localStorage.setItem('language_preference', 'zh'); localStorage.setItem('monitor_preferred_view', 'ring');
  });
  const internal = await context.newPage(), theme = await context.newPage();
  for (const page of [internal, theme]) page.on('pageerror', error => pageErrors.push(error.message));
  await internal.goto(builtin.base); await theme.goto(minimal.base);
  await internal.locator('.server-card').filter({ hasText: '示例节点' }).waitFor({ state: 'visible' });
  await eventually(async () => await theme.locator('#server-rows tr').count() === 2);

  async function fastRecreate(page, fixture, isMinimal) {
    await fixture.report(fixture.visible, { ...fixture.metrics, timestamp: Date.now(), cpu: 87, ping_ct: 55 });
    const oldName = isMinimal ? page.locator(`[data-server-id="${fixture.visible}"] .cpu`) : page.locator('.server-card').filter({ hasText: '示例节点' }).locator('.metric-ring-center').first();
    await eventually(async () => await oldName.textContent() === '87%');
    if (isMinimal) {
      await page.locator('#history-server').selectOption(fixture.visible); await page.locator('#history-submit').click();
      await eventually(async () => await page.locator('#history-rows tr').count() > 0);
    }
    const before = (await fixture.request(`/api/server?id=${fixture.visible}`, undefined, { auth: '' })).body;
    const exported = (await fixture.admin({ action: 'export_servers' })).body.servers.find(server => server.id === fixture.visible);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const delayed = async route => { await gate; try { await route.continue(); } catch {} };
    await page.route('**/api/servers', delayed); // Simulate latency so no intermediate empty snapshot can be observed.
    try {
      assert.equal((await fixture.admin({ action: 'delete', id: fixture.visible })).status, 200);
      const result = await fixture.admin({ action: 'import_servers', servers: [{ ...exported, name: '快速重建节点', instance_id: before.instance_id }] });
      assert.equal(result.body.imported, 1);
    } finally { release(); }
    await page.unroute('**/api/servers', delayed);
    if (isMinimal) await page.locator('#refresh').click();
    else await page.evaluate(() => window.dispatchEvent(new Event('online')));
    const current = (await fixture.request(`/api/server?id=${fixture.visible}`, undefined, { auth: '' })).body;
    assert.notEqual(current.instance_id, before.instance_id); assert.equal(current.cpu, undefined);
    if (isMinimal) {
      await eventually(async () => await page.locator(`[data-server-id="${fixture.visible}"] .name`).textContent() === '快速重建节点');
      assert.equal(await page.locator(`[data-server-id="${fixture.visible}"] .cpu`).textContent(), '—');
      assert.equal(await page.locator('#history-rows tr').count(), 0);
    } else {
      const card = page.locator('.server-card').filter({ hasText: '快速重建节点' });
      await card.waitFor({ state: 'visible' }); assert.equal(await card.locator('.metric-ring-center').first().textContent(), '0%');
      assert.equal(await card.locator('.status-label').textContent(), '离线');
    }
    await page.screenshot({ path: join(evidence, isMinimal ? 'minimal-recreated.png' : 'builtin-recreated.png'), fullPage: true });
    await fixture.report(fixture.visible, { ...fixture.metrics, timestamp: Date.now(), cpu: 12 });
    const cpu = isMinimal ? page.locator(`[data-server-id="${fixture.visible}"] .cpu`) : page.locator('.server-card').filter({ hasText: '快速重建节点' }).locator('.metric-ring-center').first();
    await eventually(async () => await cpu.textContent() === '12%');
    return { skippedIntermediateEmptySnapshot: true, instanceChanged: true, oldMetricsRemoved: true, newWSMetrics: 12 };
  }
  await step('RFB01', '内置看板快速同 UUID 重建', '延迟补取，删除并立即导入导出配置，再释放真实 HTTP/WS', '新实例无旧 CPU/延迟/在线，随后新上报正常展示', () => fastRecreate(internal, builtin, false));
  await step('RFB02', '最小主题快速同 UUID 重建', '先查询历史，延迟补取并快速删除导入，再释放真实 HTTP/WS', '旧指标/历史清空，随后新上报正常展示', () => fastRecreate(theme, minimal, true));
  await step('RFB03', '内置看板公开与私人切换', '匿名页打开时改为私人，等待配置断开自动补取，再改回公开并恢复网络', '401 清旧节点和连接，显示私人提示，公开后恢复', async () => {
    assert.equal((await builtin.admin({ action: 'save_settings', settings: { is_public: 'false' } })).status, 200);
    await eventually(async () => await internal.locator('.empty-state').isVisible());
    assert.match(await internal.locator('.empty-state').innerText(), /未公开/);
    assert.equal(await internal.locator('.server-card').count(), 0);
    await eventually(async () => (await builtin.stats()).viewers === 0);
    await internal.screenshot({ path: join(evidence, 'builtin-private.png'), fullPage: true });
    assert.equal((await builtin.admin({ action: 'save_settings', settings: { is_public: 'true' } })).status, 200);
    await internal.evaluate(() => window.dispatchEvent(new Event('online')));
    await internal.locator('.server-card').filter({ hasText: '快速重建节点' }).waitFor({ state: 'visible' });
    return { clearedNodes: true, closedViewers: true, publicRecovery: true };
  });
  await step('RFB04', '最小主题私人切换', '匿名页打开时改为私人并补取，再恢复公开', '旧节点与历史清空，恢复后重新获取快照', async () => {
    await minimal.admin({ action: 'save_settings', settings: { is_public: 'false' } });
    await theme.locator('#refresh').click();
    await eventually(async () => await theme.locator('#server-rows tr').count() === 0);
    assert.equal(await theme.locator('#history-rows tr').count(), 0);
    await eventually(async () => (await minimal.stats()).viewers === 0);
    await theme.screenshot({ path: join(evidence, 'minimal-private.png'), fullPage: true });
    await minimal.admin({ action: 'save_settings', settings: { is_public: 'true' } });
    await theme.locator('#refresh').click();
    await eventually(async () => await theme.locator('#server-rows tr').count() === 2);
    return { clearedNodesAndHistory: true, publicRecovery: true };
  });
  assert.deepEqual(pageErrors, []);
} finally { await browser?.close(); await builtin.close(); await minimal.close(); }
