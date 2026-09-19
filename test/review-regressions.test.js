import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';
import { checkOfflineNodes } from '../src/services/notifications/offline.js';
import { drainNotifications, enqueueNotification } from '../src/services/outbox.js';
import { isServerOffline } from '../src/services/serverPresence.js';
import { LatestReports } from '../src/realtime/LatestReports.js';
import { toBroadcastSamples } from '../src/services/ingestion.js';
import { normalizeServerInput } from '../src/services/serverInput.js';

test('review regressions through real HTTP, WS and SQLite lifecycle', async t => {
  const root = await mkdtemp(join(tmpdir(), 'monitor-review-fixed-'));
  const config = { DATA_DIR: root, API_SECRET: 'regression-fixture-secret-20260919', ADMIN_PATH: 'regression-fixture-20260919', PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false' };
  const controller = await createController(config);
  const address = await controller.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  const db = controller.env.DB;
  let token = '';
  const sockets = [];
  const request = async (path, data, auth = token) => {
    const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, body: data === undefined ? undefined : JSON.stringify(data) });
    const text = await response.text(); let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  };
  const admin = data => request(`/${config.ADMIN_PATH}/api`, data);
  const report = (id, metrics) => request('/update', { id, secret: config.API_SECRET, metrics }, '');
  const add = async name => { const result = await admin({ action: 'add', name }); assert.equal(result.status, 200); return result.body.id; };
  try {
    token = (await admin({ action: 'login', username: 'admin', password: config.API_SECRET })).body.token;
    const first = await add('First');
    const second = await add('Second');
    await t.test('F04 single and batch deletion cannot resurrect history, replay or presence on reimport', async () => {
      for (const action of ['delete', 'batch_delete']) {
        const target = action === 'delete' ? first : second;
        assert.equal((await report(target, { cpu: 73, timestamp: Date.now() })).status, 200);
        const exported = (await admin({ action: 'export_servers' })).body.servers.find(s => s.id === target);
        assert.equal((await request(`/api/history/all?id=${target}&hours=24`)).body.length, 1);
        assert.equal((await request(`/api/server?id=${target}`)).body.latestReportUpdates.length, 1);
        await request('/api/servers');
        assert.equal((await admin({ action, id: target, ids: [target] })).status, 200);
        assert.equal((await admin({ action: 'import_servers', servers: [exported] })).body.imported, 1);
        assert.equal((await request(`/api/history/all?id=${target}&hours=24`)).body.length, 0);
        assert.equal((await request(`/api/server?id=${target}`)).body.latestReportUpdates.length, 0);
        assert.equal(db.prepare('SELECT * FROM server_presence WHERE server_id=?').bind(target).first(), null);
        assert.equal(controller.env.REALTIME_HUB.resourceAlerts.windows.has(target), false);
      }
    });
    await t.test('F08 invalid or failed sorts and batch edits leave the whole batch unchanged', async () => {
      const before = db.prepare('SELECT id,sort_order,name FROM servers ORDER BY id').all().results;
      for (const orders of [[second, 'invalid-uuid'], [second, second], [second, crypto.randomUUID()]]) assert.equal((await admin({ action: 'save_order', orders })).status, 400);
      assert.equal((await admin({ action: 'batch_edit', servers: [{ id: first, name: 'must roll back' }, { id: second, reset_day: 99 }] })).status, 400);
      assert.deepEqual(db.prepare('SELECT id,sort_order,name FROM servers ORDER BY id').all().results, before);
      db.exec("CREATE TRIGGER fail_sort BEFORE UPDATE ON servers WHEN NEW.sort_order=1 BEGIN SELECT RAISE(ABORT, 'fixture sort failure'); END");
      assert.equal((await admin({ action: 'save_order', orders: [second, first] })).status, 400);
      assert.deepEqual(db.prepare('SELECT id,sort_order,name FROM servers ORDER BY id').all().results, before);
      db.exec('DROP TRIGGER fail_sort');
      assert.equal((await admin({ action: 'save_order', orders: [second, first] })).status, 200);
      assert.deepEqual((await admin({ action: 'list' })).body.servers.map(s => s.id), [second, first]);
    });
    await t.test('F07 add/edit/import share validation and preserve supported configuration', async () => {
      for (const invalid of [{ reset_day: 99 }, { collect_interval: 999 }, { report_interval: 999 }, { wss_report_interval: 9 }, { custom_ct: 'https://invalid.example/path' }, { rx_correction: 'not-a-number' }, { interface: '../../bad' }, { name: '' }]) {
        const input = { name: 'Invalid', ...invalid };
        assert.equal((await admin({ action: 'add', ...input })).status, 400);
        assert.equal((await admin({ action: 'edit', id: first, ...input })).status, 400);
        const id = crypto.randomUUID();
        const result = await admin({ action: 'import_servers', servers: [{ ...input, id }] });
        assert.equal(result.body.imported, 0);
        assert.equal(result.body.errors.length, 1);
        assert.equal(db.prepare('SELECT id FROM servers WHERE id=?').bind(id).first(), null);
      }
      const invalidRows = await admin({ action: 'import_servers', servers: [null, {}, { id: first, name: 'duplicate' }] });
      assert.equal(invalidRows.body.skipped, 3);
      const id = crypto.randomUUID();
      const valid = { id, name: 'Valid import', custom_ct: '0', node_1: '[2001:4860:4860::8888]:443', collect_interval: 2, report_interval: 180, wss_report_interval: 5, reset_day: 0, rx_correction: 0, tx_correction: 10, traffic_calc_type: 'dl', price: '$12/year', note: ' note ', tags: ' One,Two ' };
      assert.equal((await admin({ action: 'import_servers', servers: [valid] })).body.imported, 1);
      const row = db.prepare('SELECT * FROM servers WHERE id=?').bind(id).first();
      assert.equal((await admin({ ...row, action: 'edit' })).status, 200);
      assert.equal(row.custom_ct, '0'); assert.equal(row.traffic_calc_type, 'dl'); assert.equal(row.price, '12.00');
      await admin({ action: 'delete', id });
    });
    await t.test('F09 only the native bootstrap remains downloadable', async () => {
      for (const path of ['/install.sh', '/install-alpine.sh', '/install-openwrt.sh', '/install-synology.sh', '/install-mac.sh', '/cf-server-monitor.ps1', '/uninstall.sh', '/uninstall.ps1']) assert.equal((await request(path)).status, 404, path);
      assert.equal((await request('/agent/install.sh')).status, 200);
    });
    await t.test('F03 authenticated WS receipt survives throttled history and prevents false offline alerts', async () => {
      const id = await add('Active websocket');
      await admin({ action: 'edit', id, report_interval: 180 });
      await admin({ action: 'save_settings', settings: { tg_notify: '2', notification_webhook_enabled: 'true', notification_webhook_url: `${base}/fixture-unused` } });
      const persistedTimestamp = Date.now() - 400000;
      await report(id, { cpu: 12, timestamp: persistedTimestamp });
      controller.env.REALTIME_HUB.agentHistoryWrites.set(id, { lastD1WriteTs: Date.now() - 150000 });
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/update'); sockets.push(ws);
      const ack = new Promise((resolve, reject) => {
        ws.on('message', raw => { const packet = JSON.parse(raw); if (packet.type === 'ack') resolve(packet); if (packet.type === 'error') reject(new Error(packet.text)); });
        ws.on('error', reject);
      });
      await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
      ws.send(JSON.stringify({ id, secret: config.API_SECRET, report_interval: 180, metrics: { cpu: 25, timestamp: Date.now() } }));
      assert.equal((await ack).persisted, false);
      assert.equal(db.prepare('SELECT timestamp FROM server_latest WHERE server_id=?').bind(id).first().timestamp, persistedTimestamp);
      const seen = db.prepare('SELECT last_seen FROM server_presence WHERE server_id=?').bind(id).first().last_seen;
      assert.ok(Date.now() - seen < 2000);
      assert.ok((await request(`/api/server?id=${id}`)).body.last_updated >= seen);
      await checkOfflineNodes(controller.env);
      const queued = db.prepare('SELECT payload FROM notification_outbox').all().results.map(row => JSON.parse(row.payload));
      assert.equal(queued.some(payload => payload.context.clients.includes('Active websocket')), false);
      assert.equal(isServerOffline({ report_interval: 180 }, Date.now() - 150000, 120000), false);
      assert.equal(isServerOffline({ report_interval: 180 }, Date.now() - 220000, 120000), true);
    });
    await t.test('F02 no channel preserves pending messages; only explicit delivery succeeds', async () => {
      await admin({ action: 'save_settings', settings: { tg_notify: '0', notification_webhook_enabled: 'false', tg_bot_token: '' } });
      enqueueNotification(db, 'pending regression message', {});
      const id = db.prepare('SELECT max(id) id FROM notification_outbox').first().id;
      await drainNotifications(db);
      const row = db.prepare('SELECT delivered_at,attempts,last_error FROM notification_outbox WHERE id=?').bind(id).first();
      assert.equal(row.delivered_at, null); assert.equal(row.attempts, 0); assert.equal(row.last_error, null);
      await drainNotifications(db, { sender: async () => ({ status: 'failed', error: 'fixture delivery failure' }) });
      const failed = db.prepare('SELECT * FROM notification_outbox WHERE id=?').bind(id).first();
      assert.equal(failed.delivered_at, null); assert.equal(failed.attempts, 1);
      await drainNotifications(db, { now: failed.next_attempt, sender: async () => ({ status: 'delivered' }) });
      assert.ok(db.prepare('SELECT delivered_at FROM notification_outbox WHERE id=?').bind(id).first().delivered_at);
    });
  } finally {
    for (const ws of sockets) ws.terminate();
    await controller.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('F05 monthly traffic remains dynamic and replay cache cannot go backwards', () => {
  const now = Date.now();
  const metrics = { cpu: 44, net_rx_monthly: 30 * 1024 ** 3, net_tx_monthly: 42 };
  const samples = toBroadcastSamples('server', [{ ts: now, data: metrics }], '', '', metrics);
  assert.equal(samples.at(-1).payload.net_rx_monthly, metrics.net_rx_monthly);
  assert.equal(samples.at(-1).payload.net_tx_monthly, metrics.net_tx_monthly);
  const store = new LatestReports();
  store.set('server', samples, now);
  store.set('server', [{ ts: now - 1000, data: { cpu: 1 } }], now + 1);
  store.set('server', samples, now + 1000);
  assert.equal(store.getMany(['server'], now + 2000)[0].reportAgeMs, 2000);
  assert.equal(store.getMany(['server'], now + 2000)[0].samples[0].payload.cpu, 44);
  assert.equal(store.getMany(['server'], now + 300001).length, 0);
  assert.equal(normalizeServerInput({ name: 'normal', traffic_calc_type: 'ul' }, {}).traffic_calc_type, 'ul');
});
