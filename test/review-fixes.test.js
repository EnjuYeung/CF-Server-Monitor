import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createHttpServer } from 'node:http';
import { createController } from '../src/server.js';
import { createDashboardState } from '../src/frontend/state/dashboardState.js';
import { saveSiteOptions } from '../src/utils/settings.js';
import { enqueueNotification, drainNotifications } from '../src/services/outbox.js';

async function controllerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'monitor-review-fixes-'));
  const config = { DATA_DIR: root, API_SECRET: 'isolated-review-fixes-fixture', ADMIN_PATH: 'review-fixes-safe-entry', PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false' };
  let controller = await createController(config);
  const address = await controller.listen(0, '127.0.0.1');
  let base = `http://127.0.0.1:${address.port}`;
  let token = '';
  const request = async (path, body, authenticated = false) => {
    const response = await fetch(base + path, { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, data };
  };
  const admin = body => request(`/${config.ADMIN_PATH}/api`, body, true);
  token = (await request(`/${config.ADMIN_PATH}/api`, { action: 'login', username: 'admin', password: config.API_SECRET })).data.token;
  const report = (id, metrics) => request('/update', { id, secret: config.API_SECRET, metrics });
  t.after(async () => { await controller.close(); await rm(root, { recursive: true, force: true }); });
  return { root, config, get controller() { return controller; }, get base() { return base; }, request, admin, report,
    async restart() {
      await controller.close(); controller = await createController(config);
      const address = await controller.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${address.port}`;
    } };
}

// Drive the real HTTP snapshot seam while observing the public session interface.
function dashboardFixture(t, fixture) {
  const sockets = [], timers = new Map();
  let now = Date.now();
  const session = createDashboardState({
    getSources: () => [fixture.base], getTitle: () => '', loadConfig: async () => ({}),
    async fetchSnapshots(callback, signal) {
      const response = await fetch(fixture.base + '/api/servers', { signal });
      const data = await response.json();
      callback({ baseUrl: fixture.base, status: response.status, ...(response.ok ? { data } : { error: data.error || 'Unauthorized' }) });
    },
    connect(source, index, ids, handlers) {
      const socket = { source, ids, handlers, isConnected: true, isConnecting: false, closes: 0,
        close() { this.closes++; this.isConnected = false; handlers.onStatus({ connected: false }); }, reconnect() {} };
      sockets.push(socket); return socket;
    },
    now: () => now, every(callback, delay) { timers.set(delay, callback); return delay; },
    cancel: delay => timers.delete(delay), isHidden: () => false, onRestore: () => () => {}
  });
  t.after(session.stop);
  return { session, sockets, poll: () => timers.get(60000)(),
    tick(elapsed) { now += elapsed; timers.get(1000)(); },
    send(socket, update) { socket.handlers.onMessage({ type: 'batchUpdate', ts: now, updates: [update] }); } };
}

test('RF01 OneBot business rejection stays pending and retries through SQLite outbox', async t => {
  const f = await controllerFixture(t);
  let calls = 0, reply = { status: 'failed', retcode: 100, data: null };
  const provider = createHttpServer((request, response) => {
    calls++; request.resume(); response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(reply));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => provider.close(resolve)));
  const db = f.controller.env.DB;
  saveSiteOptions(db, { tg_bot_token: `onebot:http://127.0.0.1:${provider.address().port}/send_private_msg`, tg_chat_id: '123456' });
  enqueueNotification(db, 'isolated test notification', {});
  await drainNotifications(db);
  const failed = db.prepare('SELECT * FROM notification_outbox').first();
  assert.equal(failed.delivered_at, null, 'HTTP 200 with status=failed must not consume the event');
  assert.equal(failed.attempts, 1);
  assert.ok(failed.last_error);
  await drainNotifications(db);
  assert.equal(calls, 1, 'Retry deadline must be respected');
  reply = { status: 'ok', retcode: 0, data: { message_id: 1 } };
  await drainNotifications(db, { now: failed.next_attempt });
  const delivered = db.prepare('SELECT * FROM notification_outbox').first();
  assert.ok(delivered.delivered_at);
  assert.equal(delivered.attempts, 2);
  assert.equal(delivered.last_error, null);
  assert.equal(calls, 2);
});

test('RF02 rapid delete/import of exported UUID clears metrics, replay and old subscription callbacks', async t => {
  const f = await controllerFixture(t);
  const id = (await f.admin({ action: 'add', name: 'Original node' })).data.id;
  assert.equal((await f.report(id, { timestamp: Date.now() - 5000, cpu: 87, ping_ct: 55, loss_ct: 0 })).status, 200);
  const d = dashboardFixture(t, f); await d.session.start();
  const original = d.session.state.servers[0], oldSocket = d.sockets[0];
  const exported = (await f.admin({ action: 'export_servers' })).data.servers[0];
  d.send(oldSocket, { serverId: id, instance_id: original.instance_id, samples: [
    { ts: Date.now() + 1000, data: { cpu: 91, ping_ct: 91 } },
    { ts: Date.now() + 30000, data: { cpu: 92, ping_ct: 92 } }
  ] });
  await f.admin({ action: 'delete', id });
  await f.admin({ action: 'import_servers', servers: [{ ...exported, name: 'Rebuilt node', instance_id: original.instance_id }] });
  await d.poll();
  const rebuilt = d.session.state.servers[0];
  assert.equal(rebuilt.name, 'Rebuilt node');
  assert.equal(rebuilt.cpu, undefined, 'New instance must not inherit metrics from deleted instance');
  assert.equal(rebuilt.last_updated || 0, 0);
  assert.equal(rebuilt.sample_timestamp || 0, 0, 'Creation time is not a metric sample');
  assert.equal(d.session.state.stats.online, 0);
  assert.ok(rebuilt.ping.every(point => point.ct === undefined));
  assert.equal(typeof original.instance_id, 'string');
  assert.notEqual(rebuilt.instance_id, original.instance_id, 'Import cannot restore a retired instance identity');
  assert.equal(oldSocket.closes, 1);
  d.send(oldSocket, { serverId: id, instance_id: rebuilt.instance_id, samples: [{ ts: Date.now() + 40000, data: { cpu: 99 } }] });
  d.tick(45000);
  assert.equal(d.session.state.servers[0].cpu, undefined);
  const socket = d.sockets.at(-1);
  d.send(socket, { serverId: id, instance_id: original.instance_id, samples: [{ ts: Date.now() + 50000, data: { cpu: 98 } }] });
  assert.equal(d.session.state.servers[0].cpu, undefined);
  d.send(socket, { serverId: id, instance_id: rebuilt.instance_id, samples: [{ ts: Date.now(), data: { cpu: 12 } }] });
  assert.equal(d.session.state.servers[0].cpu, 12);
});

test('RF03 public-to-private HTTP 401 clears nodes, replay and connection, then public access recovers', async t => {
  const f = await controllerFixture(t);
  const id = (await f.admin({ action: 'add', name: 'Public node' })).data.id;
  await f.report(id, { timestamp: Date.now() - 5000, cpu: 73 });
  const d = dashboardFixture(t, f); await d.session.start();
  const oldSocket = d.sockets[0];
  d.send(oldSocket, { serverId: id, samples: [
    { ts: Date.now() + 1000, data: { cpu: 80 } }, { ts: Date.now() + 20000, data: { cpu: 90 } }
  ] });
  assert.equal((await f.admin({ action: 'save_settings', settings: { is_public: 'false' } })).status, 200);
  await d.poll();
  assert.equal(d.session.state.servers.length, 0, 'Unauthorized snapshot must erase previously public/private data');
  assert.equal(d.session.state.authenticationRequired, true);
  assert.equal(oldSocket.closes, 1);
  d.send(oldSocket, { serverId: id, samples: [{ ts: Date.now() + 30000, data: { cpu: 99 } }] });
  d.tick(45000);
  assert.equal(d.session.state.servers.length, 0);
  assert.equal(d.session.state.stats.online, 0);
  assert.equal(d.session.state.liveConnected, false);
  assert.equal((await f.admin({ action: 'save_settings', settings: { is_public: 'true' } })).status, 200);
  await d.poll();
  assert.equal(d.session.state.authenticationRequired, false);
  assert.equal(d.session.state.servers[0].cpu, 73, 'Restored public access uses a fresh REST snapshot');
  assert.equal(d.sockets.length, 2);
});

test('RF04 node instance identity and samples survive controller restart and history clearing', async t => {
  const f = await controllerFixture(t);
  const id = (await f.admin({ action: 'add', name: 'Persistent instance' })).data.id;
  await f.report(id, { timestamp: Date.now(), cpu: 18 });
  const before = (await f.request(`/api/server?id=${id}`)).data;
  assert.equal(typeof before.instance_id, 'string');
  assert.ok(before.instance_id.length >= 16);
  await f.restart();
  const restored = (await f.request(`/api/server?id=${id}`)).data;
  assert.equal(restored.instance_id, before.instance_id);
  assert.equal(restored.cpu, 18);
  assert.equal((await f.request('/clearHistory', {}, true)).status, 200);
  assert.equal(f.controller.env.DB.prepare('SELECT count(*) AS n FROM metrics_history').first().n, 0);
  const cleared = (await f.request(`/api/server?id=${id}`)).data;
  assert.equal(cleared.instance_id, before.instance_id);
  assert.equal(cleared.cpu, 18);
});

test('RF05 controller upgrades legacy node storage without losing settings, metrics or history', async t => {
  const f = await controllerFixture(t);
  const ids = [];
  for (const name of ['Existing visible node', 'Existing hidden node']) {
    const id = (await f.admin({ action: 'add', name })).data.id;
    ids.push(id);
    await f.report(id, { timestamp: Date.now() - 1000, cpu: 23, ping_ct: 31 });
  }
  const db = f.controller.env.DB;
  const previous = db.prepare('SELECT * FROM servers ORDER BY id').all().results;
  const latest = db.prepare('SELECT * FROM server_latest ORDER BY server_id').all().results;
  const history = db.prepare('SELECT * FROM metrics_history ORDER BY id').all().results;
  // The previous storage format contains these persisted rows but no instance table.
  db.exec('DROP TRIGGER servers_instance; DROP TABLE server_instances;');
  await f.restart();
  const upgraded = f.controller.env.DB;
  assert.deepEqual(upgraded.prepare('SELECT * FROM servers ORDER BY id').all().results, previous);
  assert.deepEqual(upgraded.prepare('SELECT * FROM server_latest ORDER BY server_id').all().results, latest);
  assert.deepEqual(upgraded.prepare('SELECT * FROM metrics_history ORDER BY id').all().results, history);
  const snapshots = await Promise.all(ids.map(id => f.request(`/api/server?id=${id}`)));
  for (const snapshot of snapshots) {
    assert.equal(snapshot.status, 200);
    assert.equal(snapshot.data.cpu, 23);
    assert.match(snapshot.data.instance_id, /^[a-f0-9]{32}$/);
  }
  assert.notEqual(snapshots[0].data.instance_id, snapshots[1].data.instance_id);
});
