import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createThemeFixture, eventually, pause } from './helpers/themeFixture.js';

test('third-party theme contracts over isolated HTTP, WS and SQLite', async t => {
  const fixture = await createThemeFixture();
  const { request, admin, themeUrl, unavailable, upstreamReads } = fixture;
  try {
    await t.test('TH01 build produces hash assets that the theme proxy serves', async () => {
      const html = await readFile(join(fixture.built, 'index.html'), 'utf8');
      assert.match(html, /assets\/app-[a-f0-9]{12}\.js/);
      assert.match(html, /assets\/style-[a-f0-9]{12}\.css/);
      assert.equal((await admin({ action: 'save_settings', settings: { theme_url: themeUrl('main') } })).status, 200);
      const home = await request('/', undefined, { auth: '' }); assert.equal(home.status, 200);
      const asset = home.body.match(/src="([^\"]+\.js)"/)[1];
      const response = await request(asset); assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /javascript/);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=3600');
      assert.equal(home.headers.get('cache-control'), 'no-store');
    });
    await t.test('TH02 config stays public, private nodes require Bearer, Cookie is not REST auth', async () => {
      await admin({ action: 'save_settings', settings: { is_public: 'false' } });
      const cookie = `cfsm_auth=${encodeURIComponent(fixture.token)}`;
      const config = await request('/api/config', undefined, { auth: '', headers: { Cookie: cookie } });
      assert.equal(config.status, 200); assert.equal(config.body.authorization, false); assert.equal('admin_path' in config.body, false);
      assert.equal((await request('/api/servers', undefined, { auth: '', headers: { Cookie: cookie } })).status, 401);
      const authorized = await request('/api/config'); assert.equal(authorized.body.authorization, true);
      const viewer = await fixture.openSocket({ cookie, ids: [fixture.hidden] }); viewer.ws.close();
      await admin({ action: 'save_settings', settings: { is_public: 'true' } });
    });
    await t.test('TH04 hidden nodes stay out of anonymous REST and WS', async () => {
      assert.equal((await request(`/api/server?id=${fixture.hidden}`, undefined, { auth: '' })).status, 404);
      const viewer = await fixture.openSocket({ ids: [fixture.visible, fixture.hidden] });
      await fixture.report(fixture.hidden, { ...fixture.metrics, timestamp: Date.now(), cpu: 83 });
      await fixture.report(fixture.visible, { ...fixture.metrics, timestamp: Date.now(), cpu: 41 });
      await eventually(() => viewer.messages.some(message => message.updates?.some(update => update.serverId === fixture.visible)));
      assert.ok(!viewer.messages.some(message => message.updates?.some(update => update.serverId === fixture.hidden)));
      const update = viewer.messages.find(message => message.updates?.length).updates[0]; assert.ok(update.samples[0].payload);
      viewer.ws.close();
    });
    await t.test('TH05 empty all subscription does not grant all nodes; REST samples use data', async () => {
      const viewer = await fixture.openSocket({ ids: [] });
      await fixture.report(fixture.visible, { ...fixture.metrics, timestamp: Date.now(), cpu: 42 });
      await pause(350); assert.ok(!viewer.messages.some(message => message.type === 'batchUpdate'));
      const list = await request('/api/servers', undefined, { auth: '' });
      assert.equal(list.body.servers.find(server => server.id === fixture.visible).ram_total, 2048);
      assert.ok(list.body.latestReportUpdates.some(update => update.samples.every(sample => sample.data)));
      viewer.ws.close();
    });
    await t.test('TH08 history hours, no-data and zero/disabled probe semantics', async () => {
      assert.equal((await request(`/api/history/all?id=${fixture.visible}&hours=168`, undefined, { auth: '' })).status, 401);
      assert.equal((await request(`/api/history/all?id=${fixture.visible}&hours=7`)).status, 400);
      assert.deepEqual((await request(`/api/history/all?id=${fixture.empty}&hours=24`)).body, []);
      const recent = (await request(`/api/history/all?id=${fixture.visible}&hours=24`, undefined, { auth: '' })).body;
      const week = (await request(`/api/history/all?id=${fixture.visible}&hours=168`)).body;
      assert.ok(week.length > recent.length); assert.equal(recent.at(-1).loss_ct, 0); assert.equal(recent.at(-1).ping_cu, false);
      assert.equal(recent.at(-1).ram_total, 2048); assert.equal('last_updated' in recent.at(-1), false);
    });
    await t.test('TH09 options are public, top-level validated and replaced without losing appearance', async () => {
      await admin({ action: 'save_settings', settings: { site_title: '主题契约', preferred_theme: 'light' } });
      for (const value of [null, [], false]) assert.equal((await request('/api/theme_options', { theme_options: value })).status, 400);
      const first = { other: { enabled: true }, minimal: { schemaVersion: 1, density: 'compact' } };
      assert.equal((await request('/api/theme_options', { theme_options: first })).status, 200);
      await admin({ action: 'save_settings', settings: { is_public: 'false' } });
      assert.deepEqual((await request('/api/config', undefined, { auth: '' })).body.theme_options, first);
      await request('/api/theme_options', { theme_options: { minimal: { schemaVersion: 99 } } });
      const saved = (await request('/api/config')).body;
      assert.deepEqual(saved.theme_options, { minimal: { schemaVersion: 99 } }); assert.equal(saved.site_title, '主题契约');
      await admin({ action: 'save_settings', settings: { theme_options: { ignored: true } } });
      assert.deepEqual((await request('/api/config')).body.theme_options, saved.theme_options);
      await fixture.restart(); assert.deepEqual((await request('/api/config')).body.theme_options, saved.theme_options);
      await admin({ action: 'save_settings', settings: { is_public: 'true', theme_url: '' } });
    });
    await t.test('TH10 invalid addresses, authenticated preview and default restoration', async () => {
      for (const url of ['https://example.com/theme', 'https://raw.githubusercontent.com/a/b/main/index.html', themeUrl('main') + '?v=1']) {
        assert.equal((await admin({ action: 'save_settings', settings: { theme_url: url } })).status, 400);
      }
      unavailable.add('missing'); assert.equal((await admin({ action: 'start_theme_preview', theme_url: themeUrl('missing') })).status, 400);
      const query = '/?theme_url=' + encodeURIComponent(themeUrl('preview'));
      assert.equal((await request(query, undefined, { auth: '' })).status, 401);
      const preview = await admin({ action: 'start_theme_preview', theme_url: themeUrl('preview') }); assert.equal(preview.status, 200);
      const cookie = preview.headers.getSetCookie()[0].split(';')[0]; assert.match(preview.headers.getSetCookie()[0], /HttpOnly/);
      const page = await request(query, undefined, { auth: '', headers: { Cookie: cookie } }); assert.equal(page.status, 200);
      assert.match(page.body, /assets\/app-/);
      assert.equal((await admin({ action: 'get_settings' })).body.settings.theme_url, '');
      assert.match((await request(`/${fixture.config.ADMIN_PATH}`)).body, /\/static\//);
      const previewCookie = page.headers.getSetCookie()[0].split(';')[0];
      const asset = page.body.match(/src="([^\"]+\.js)"/)[1];
      assert.equal((await request(asset, undefined, { auth: '', headers: { Cookie: cookie + '; ' + previewCookie } })).status, 200);
      const clear = await admin({ action: 'clear_theme_preview_auth' }, { auth: '' }); assert.equal(clear.status, 200);
      const defaultPage = await request('/', undefined, { auth: '', headers: { Cookie: previewCookie } });
      assert.match(defaultPage.body, /\/static\//); assert.match(defaultPage.headers.get('set-cookie'), /Max-Age=0/);
    });
    await t.test('TH10 commit cache, query cache and missing configured index', async () => {
      const commit = 'a'.repeat(40);
      await admin({ action: 'save_settings', settings: { theme_url: themeUrl(commit) } });
      const page = await request('/'); const asset = page.body.match(/src="([^\"]+\.js)"/)[1];
      const first = await request(asset); assert.equal(first.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      const key = [...upstreamReads.keys()].find(key => key.includes(commit) && key.endsWith('.js'));
      const count = upstreamReads.get(key); await request(asset + '?v=changed'); assert.equal(upstreamReads.get(key), count);
      await admin({ action: 'save_settings', settings: { theme_url: themeUrl('removed-after-save') } }); unavailable.add('removed-after-save');
      assert.equal((await request('/')).status, 502);
      assert.equal((await request(`/${fixture.config.ADMIN_PATH}`)).status, 200);
      await admin({ action: 'save_settings', settings: { theme_url: '' } }); assert.match((await request('/')).body, /\/static\//);
    });
    await t.test('TH11 REST CORS headers differ from WS origin rejection', async () => {
      fixture.controller.env.CORS_ALLOWED_ORIGINS = 'https://allowed.example';
      const allowed = await request('/api/config', undefined, { auth: '', headers: { Origin: 'https://allowed.example' } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://allowed.example');
      const denied = await request('/api/config', undefined, { auth: '', headers: { Origin: 'https://denied.example' } });
      assert.equal(denied.status, 200); assert.equal(denied.headers.get('access-control-allow-origin'), null);
      const status = await new Promise((resolve, reject) => {
        const ws = new WebSocket(fixture.base.replace('http:', 'ws:') + '/api/ws', { headers: { Origin: 'https://denied.example' } });
        const timeout = setTimeout(() => { ws.terminate(); reject(new Error('Origin rejection timeout')); }, 5000);
        ws.on('unexpected-response', (_, response) => { clearTimeout(timeout); resolve(response.statusCode); response.resume(); ws.terminate(); });
        ws.on('open', () => { clearTimeout(timeout); ws.terminate(); reject(new Error('Unexpected accepted origin')); }); ws.on('error', () => {});
      }); assert.equal(status, 403);
    });
  } finally { await fixture.close(); }
});
