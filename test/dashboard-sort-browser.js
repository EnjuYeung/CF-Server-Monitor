import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createThemeFixture, eventually } from './helpers/themeFixture.js';

const evidence = resolve(process.env.DASHBOARD_SORT_EVIDENCE_DIR || 'output/test-results/dashboard-sort');
await mkdir(evidence, { recursive: true });
const module = await import(process.env.THEME_PLAYWRIGHT_MODULE || 'playwright');
const { chromium } = module.default || module;
// All nodes, credentials, browser contexts and SQLite are isolated from production.
const fixture = await createThemeFixture();
let browser;
const results = [], pageErrors = [];
async function step(id, feature, operation, expected, callback) {
  try {
    const detail = await callback();
    results.push({ id, feature, operation, expected, status: 'PASS', evidence: detail });
    console.log(`${id} PASS ${feature}`);
  } catch (error) {
    results.push({ id, feature, operation, expected, status: 'FAIL', evidence: error.stack });
    throw error;
  } finally {
    await writeFile(join(evidence, 'browser.json'), JSON.stringify({ date: new Date().toISOString(), results, pageErrors,
      isolation: 'Temporary SQLite, random loopback port, scheduler disabled; browser external requests blocked' }, null, 2));
  }
}

try {
  const rows = [
    { id: fixture.visible, name: 'node10', region: 'US', group: 'Alpha' },
    { id: fixture.empty, name: 'NODE2', region: 'CN', group: 'Beta' },
    { name: 'node2', region: 'US', group: 'Alpha' },
    { name: 'node1', region: 'JP', group: 'Beta' },
    { name: '上海', region: 'CN', group: 'CJK' },
    { name: '北京', region: '', group: 'CJK' },
    { name: '重庆', region: 'XX', group: 'CJK' },
    { name: '广州', region: 'HK', group: 'CJK' }
  ];
  for (const row of rows) {
    if (!row.id) {
      const added = await fixture.admin({ action: 'add', name: row.name });
      assert.equal(added.status, 200); row.id = added.body.id;
    }
    await fixture.edit(row.id, { name: row.name, region: row.region, server_group: row.group });
  }
  assert.equal((await fixture.admin({ action: 'save_order', orders: [...rows.map(row => row.id), fixture.hidden] })).status, 200);
  const defaultNames = rows.map(row => row.name);
  const regionAscending = ['NODE2', '上海', '广州', 'node1', 'node10', 'node2', '北京', '重庆'];
  const regionDescending = ['node10', 'node2', 'node1', '广州', 'NODE2', '上海', '北京', '重庆'];

  browser = await chromium.launch({ headless: true,
    ...(process.env.THEME_CHROMIUM_EXECUTABLE ? { executablePath: process.env.THEME_CHROMIUM_EXECUTABLE } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN' });
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'zh-CN', hasTouch: true });
  for (const current of [context, mobileContext]) {
    await current.route('https://**', route => route.fulfill({ status: 503, body: '{}' }));
    await current.addInitScript(() => {
      for (const [key, value] of [['language_preference', 'zh'], ['monitor_preferred_view', 'table'], ['theme_preference', 'dark']]) {
        if (!localStorage.getItem(key)) localStorage.setItem(key, value);
      }
    });
  }
  const page = await context.newPage(), mobile = await mobileContext.newPage();
  for (const current of [page, mobile]) current.on('pageerror', error => pageErrors.push({ message: error.message, stack: error.stack }));
  await page.goto(fixture.base); await mobile.goto(fixture.base);
  const names = current => current.locator('#view-table .table-server-name').allTextContents();
  const header = (current, index) => current.locator('#view-table .table-sort-heading').nth(index);
  const button = (current, index) => header(current, index).locator('button');
  const waitNames = async (current, expected) => {
    await eventually(async () => JSON.stringify(await names(current)) === JSON.stringify(expected));
    assert.deepEqual(await names(current), expected);
  };
  const defaultSort = async current => {
    for (let i = 0; i < 2; i++) {
      const sorted = current.locator('#view-table th[aria-sort]');
      if (!await sorted.count()) break;
      await sorted.locator('button').click();
    }
    assert.equal(await current.locator('#view-table th[aria-sort]').count(), 0);
  };

  await step('LS01', '安装启动与默认顺序', '全新数据库启动，打开桌面和手机列表', '健康检查成功，默认沿用后台顺序，隐藏节点不可见', async () => {
    assert.equal((await fixture.request('/healthz')).status, 200);
    await waitNames(page, defaultNames); await waitNames(mobile, defaultNames);
    assert.equal(await page.locator('#view-table th[aria-sort]').count(), 0);
    assert.equal(await page.getByText('隐藏节点', { exact: true }).count(), 0);
    return { health: 200, names: await names(page), mobileRows: 8, hiddenNodes: 0 };
  });
  await step('LS02', '主机名三态排序', '连续点击主机名列头三次', '自然数、大小写同值稳定、中文拼音及升降序/恢复默认均正确', async () => {
    const sequences = [];
    for (const [direction, latin, chinese] of [
      ['ascending', ['node1', 'NODE2', 'node2', 'node10'], ['北京', '重庆', '广州', '上海']],
      ['descending', ['node10', 'NODE2', 'node2', 'node1'], ['上海', '广州', '重庆', '北京']]
    ]) {
      await button(page, 0).click();
      assert.equal(await header(page, 0).getAttribute('aria-sort'), direction);
      const current = await names(page);
      assert.deepEqual(current.filter(name => /^node/i.test(name)), latin);
      assert.deepEqual(current.filter(name => !/^node/i.test(name)), chinese);
      sequences.push(current);
    }
    await button(page, 0).click(); await waitNames(page, defaultNames);
    assert.equal(await page.evaluate(() => localStorage.getItem('monitor_list_sort')), null);
    return { ascending: sequences[0], descending: sequences[1], restored: await names(page) };
  });
  await step('LS03', '地区排序与切换列', '主机名降序时改点地区列，再降序及恢复默认', '切换列从升序开始，同地区稳定，空地区/XX 双向置底', async () => {
    await button(page, 0).click(); await button(page, 0).click();
    await button(page, 1).click(); await waitNames(page, regionAscending);
    assert.equal(await page.locator('#view-table th[aria-sort]').count(), 1);
    assert.equal(await header(page, 0).getAttribute('aria-sort'), null);
    await button(page, 1).click(); await waitNames(page, regionDescending);
    await button(page, 1).click(); await waitNames(page, defaultNames);
    return { ascending: regionAscending, descending: regionDescending, switchStartsAscending: true };
  });
  await step('LS04', '地区分组多选与空结果', '地区升序下叠加两个分组、地区筛选，再制造空交集', '筛选并集/交集正确且保留排序，空结果后可恢复', async () => {
    await button(page, 1).click();
    const group = name => page.locator(`.group-filter-bar [data-group="${name}"]`);
    const us = page.locator('#ajax-filters [data-filter="us"]');
    await group('Alpha').click(); await group('Beta').click();
    await waitNames(page, ['NODE2', 'node1', 'node10', 'node2']);
    await us.click(); await waitNames(page, ['node10', 'node2']);
    await us.click(); await group('Alpha').click(); await group('Beta').click();
    await group('CJK').click(); await us.click(); await waitNames(page, []);
    assert.match(await page.locator('#view-table .table-empty-state').innerText(), /暂无数据/);
    assert.equal(await header(page, 1).getAttribute('aria-sort'), 'ascending');
    await us.click(); await group('CJK').click(); await waitNames(page, regionAscending);
    return { combined: ['node10', 'node2'], emptyIntersection: true, restoredSort: 'ascending' };
  });
  await step('LS05', '卡片与列表的顺序独立', '地区升序时切换条形/环形，再切回列表', '两种卡片沿用后台顺序，返回列表继续地区升序', async () => {
    for (const index of [0, 1]) {
      await page.locator('.view-toggle button').nth(index).click();
      assert.deepEqual(await page.locator('#view-card .server-name').allTextContents(), defaultNames);
    }
    await page.locator('.view-toggle button').nth(2).click(); await waitNames(page, regionAscending);
    return { barAndRing: defaultNames, table: regionAscending };
  });
  await step('LS06', '刷新和离开返回后保存排序', '刷新列表、打开节点详情，再返回首页', '当前浏览器保留地区升序，后台保存顺序保持', async () => {
    await page.reload(); await waitNames(page, regionAscending);
    // Hold real animation frames to exercise returning before a queued chart resize.
    // Cancellation still works, so destroyed charts' own cancelled work stays cancelled.
    await page.evaluate(() => {
      const request = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window);
      const queued = new Map(); let sequence = -1;
      window.requestAnimationFrame = callback => { const id = sequence--; queued.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { if (!queued.delete(id)) cancel(id); };
      window.sortTestFramesReady = () => queued.size;
      window.releaseSortTestFrames = () => {
        window.requestAnimationFrame = request; window.cancelAnimationFrame = cancel;
        for (const callback of queued.values()) request(callback);
        delete window.sortTestFramesReady; delete window.releaseSortTestFrames;
      };
    });
    const home = page.url(); await page.locator('#view-table .table-server-name').first().click();
    await eventually(() => page.url() !== home);
    await page.locator('#time-selector').waitFor({ state: 'visible' });
    await eventually(() => page.evaluate(() => window.sortTestFramesReady() > 0));
    await page.goBack(); await waitNames(page, regionAscending);
    await page.evaluate(() => window.releaseSortTestFrames());
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.deepEqual(pageErrors, []);
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('monitor_list_sort'))), { key: 'region', direction: 'asc' });
    assert.deepEqual((await fixture.admin({ action: 'list' })).body.servers.filter(row => row.id !== fixture.hidden).map(row => row.name), defaultNames);
    return { refresh: true, returnFromDetail: true, queuedChartResizeAfterUnmount: true,
      browserPreference: { key: 'region', direction: 'asc' }, backendOrderUnchanged: true };
  });
  await step('LS07', '键盘操作与三语言', '用 Tab、Enter、空格切换排序并循环语言', '焦点可见，键盘完成三态切换，中英日操作说明正确', async () => {
    await button(page, 1).focus(); await page.keyboard.press('Shift+Tab');
    assert.equal(await button(page, 0).evaluate(node => node === document.activeElement && node.matches(':focus-visible')), true);
    const outline = await button(page, 0).evaluate(node => getComputedStyle(node).outlineWidth);
    assert.equal(outline, '2px');
    await page.keyboard.press('Enter'); assert.equal(await header(page, 0).getAttribute('aria-sort'), 'ascending');
    await page.keyboard.press('Space'); assert.equal(await header(page, 0).getAttribute('aria-sort'), 'descending');
    await page.keyboard.press('Enter'); await waitNames(page, defaultNames);
    const labels = [];
    for (const expected of ['ホスト名を昇順で並べ替え', 'Sort HOSTNAME ascending', '按主机名升序排序']) {
      await page.locator('.lang-btn').click();
      assert.equal(await button(page, 0).getAttribute('aria-label'), expected); labels.push(expected);
    }
    return { focusOutline: outline, keyboardCycle: true, labels };
  });
  await step('LS08', '桌面手机明暗与触控', '桌面和 390px 手机在明暗模式操作列头并截图', '按钮可触控，方向状态清晰，表格在容器内横向滚动', async () => {
    const layouts = [];
    for (const [current, viewport] of [[page, 'desktop'], [mobile, 'mobile']]) {
      for (const theme of ['dark', 'light']) {
        if (theme === 'light') await current.locator('.theme-btn').click();
        if (viewport === 'mobile') await button(current, 1).tap(); else await button(current, 1).click();
        const expected = theme === 'dark' ? regionAscending : regionDescending;
        await waitNames(current, expected);
        const layout = await current.evaluate(() => {
          const button = document.querySelector('#view-table .table-sort-button');
          const container = document.querySelector('#view-table .table-container');
          const rect = button.getBoundingClientRect();
          return { viewport: innerWidth, pageWidth: document.documentElement.scrollWidth, buttonWidth: rect.width,
            buttonHeight: rect.height, containerWidth: container.clientWidth, tableWidth: container.scrollWidth,
            theme: document.body.classList.contains('light') ? 'light' : 'dark' };
        });
        assert.ok(layout.buttonHeight >= 44 && layout.buttonWidth >= 44);
        assert.ok(layout.pageWidth <= layout.viewport + 1);
        assert.equal(layout.theme, theme);
        await current.screenshot({ path: join(evidence, `${viewport}-${theme}.png`), fullPage: true });
        layouts.push({ viewport, ...layout });
      }
      await defaultSort(current);
    }
    return layouts;
  });
  await step('LS09', '损坏偏好与存储写入失败', '写入损坏/不支持的排序偏好后刷新，再模拟写入配额失败', '无效偏好回退默认，存储失败仍能点击排序', async () => {
    for (const raw of ['broken json', '{"key":"cpu","direction":"asc"}', '{"key":"name","direction":"invalid"}']) {
      await page.evaluate(value => localStorage.setItem('monitor_list_sort', value), raw);
      await page.reload(); await waitNames(page, defaultNames);
      assert.equal(await page.locator('#view-table th[aria-sort]').count(), 0);
    }
    await page.evaluate(() => {
      window.restoreSortStorage = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'monitor_list_sort') throw new DOMException('Full', 'QuotaExceededError');
        return window.restoreSortStorage.call(this, key, value);
      };
    });
    try {
      await button(page, 0).click(); assert.equal(await header(page, 0).getAttribute('aria-sort'), 'ascending');
      assert.deepEqual((await names(page)).filter(name => /^node/i.test(name)), ['node1', 'NODE2', 'node2', 'node10']);
      await defaultSort(page);
    } finally { await page.evaluate(() => { Storage.prototype.setItem = window.restoreSortStorage; delete window.restoreSortStorage; localStorage.removeItem('monitor_list_sort'); }); }
    return { invalidPreferences: 3, quotaFailureStillSortable: true };
  });
  await step('LS10', '实时上报和节点资料变化', '接收离线节点上报，修改地区/名称，新增节点后补取快照', '指标更新保留顺序，地区/名称改变与新增按当前列重新排列', async () => {
    await button(page, 1).click(); await waitNames(page, regionAscending);
    await fixture.report(rows[2].id, { ...fixture.metrics, cpu: 77, timestamp: Date.now() });
    const updatedRow = page.locator('#view-table tbody tr').filter({ has: page.getByText('node2', { exact: true }) });
    await eventually(async () => (await updatedRow.locator('.status-indicator').getAttribute('style')).includes('accent-green'));
    await waitNames(page, regionAscending);
    await fixture.edit(rows[2].id, { region: 'HK' });
    await waitNames(page, ['NODE2', '上海', 'node2', '广州', 'node1', 'node10', '北京', '重庆']);
    await button(page, 0).click();
    await fixture.edit(rows[0].id, { name: 'node0' });
    await eventually(async () => (await names(page)).includes('node0'));
    assert.deepEqual((await names(page)).filter(name => /^node/i.test(name)), ['node0', 'node1', 'NODE2', 'node2']);
    const added = await fixture.admin({ action: 'add', name: 'node3' }); assert.equal(added.status, 200);
    rows.push({ id: added.body.id, name: 'node3', region: 'JP', group: 'Alpha' });
    await fixture.edit(added.body.id, { region: 'JP', server_group: 'Alpha' });
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await eventually(async () => (await names(page)).length === 9);
    assert.deepEqual((await names(page)).filter(name => /^node/i.test(name)), ['node0', 'node1', 'NODE2', 'node2', 'node3']);
    return { liveReportKeptOrder: true, regionChangeReordered: true, nameChangeReordered: true, addedNodeSorted: true };
  });
  await step('LS11', '后台新顺序与同值稳定', '地区升序下修改后台顺序并补取，再恢复默认及删除新增节点', '同地区及未知地区按最新后台顺序排列，恢复默认和删除后同步', async () => {
    await button(page, 1).click();
    const reordered = [...rows.slice(0, 8).reverse(), rows[8]];
    assert.equal((await fixture.admin({ action: 'save_order', orders: [...reordered.map(row => row.id), fixture.hidden] })).status, 200);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitNames(page, ['上海', 'NODE2', '广州', 'node2', 'node1', 'node3', 'node0', '重庆', '北京']);
    await defaultSort(page);
    await waitNames(page, ['广州', '重庆', '北京', '上海', 'node1', 'node2', 'NODE2', 'node0', 'node3']);
    assert.equal((await fixture.admin({ action: 'delete', id: rows[8].id })).status, 200);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await waitNames(page, ['广州', '重庆', '北京', '上海', 'node1', 'node2', 'NODE2', 'node0']);
    assert.deepEqual(pageErrors, []);
    return { latestDefaultOrderUsedForTies: true, unknownOrder: ['重庆', '北京'], defaultRestored: true, deletedNodeRemoved: true, pageErrors };
  });
} finally {
  await browser?.close(); await fixture.close();
}
