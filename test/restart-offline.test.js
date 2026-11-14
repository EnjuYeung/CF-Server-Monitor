import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createController } from '../src/server.js';
import { checkOfflineNodes } from '../src/services/notifications/offline.js';

const SECRET = 'restart-offline-fixture-secret-20261114';
const ADMIN_PATH = 'restart-offline-fixture-20261114';
const offlineEvents = db => db.prepare('SELECT payload FROM notification_outbox ORDER BY id').all().results
  .map(row => JSON.parse(row.payload).context)
  .filter(context => context.event === '节点离线告警' || context.event === '节点恢复通知');

async function start(root, schedulerEnabled) {
  const controller = await createController({
    DATA_DIR: root, API_SECRET: SECRET, ADMIN_PATH, PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: schedulerEnabled ? 'true' : 'false'
  });
  const address = await controller.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  let token = '';
  const call = async (path, body) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  token = (await call(`/${ADMIN_PATH}/api`, { action: 'login', username: 'admin', password: SECRET })).body.token;
  return {
    controller,
    admin: body => call(`/${ADMIN_PATH}/api`, body),
    report: (id, metrics) => call('/update', { id, secret: SECRET, metrics })
  };
}

test('OR01 restart after controller downtime waits for reports instead of alerting every node', async t => {
  const root = await mkdtemp(join(tmpdir(), 'monitor-restart-offline-'));
  const hook = createHttpServer((request, response) => { request.resume(); response.end('ok'); });
  await new Promise(resolve => hook.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => hook.close(resolve));
    await rm(root, { recursive: true, force: true });
  });

  const first = await start(root, false);
  assert.equal((await first.admin({ action: 'save_settings', settings: {
    tg_notify: '2', notification_webhook_enabled: 'true',
    notification_webhook_url: `http://127.0.0.1:${hook.address().port}/hook`
  } })).status, 200);
  const healthy = (await first.admin({ action: 'add', name: 'Healthy before stop' })).body.id;
  const alreadyDown = (await first.admin({ action: 'add', name: 'Down before stop' })).body.id;
  assert.equal((await first.report(healthy, { cpu: 10, timestamp: Date.now() })).status, 200);
  assert.equal((await first.report(alreadyDown, { cpu: 10, timestamp: Date.now() })).status, 200);
  await first.controller.close();

  // Ten minutes of controller downtime: receipts stop for every node, and one node
  // had already been alerted as offline before the stop.
  const stoppedAt = Date.now() - 10 * 60000;
  const file = new DatabaseSync(join(root, 'monitor.sqlite'));
  file.prepare('UPDATE server_presence SET last_seen=?').run(stoppedAt);
  file.prepare("INSERT INTO settings(key,value) VALUES ('alert_state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(JSON.stringify({ [alreadyDown]: true }));
  file.prepare('DELETE FROM notification_outbox').run();
  file.close();

  const startedAt = Date.now();
  const second = await start(root, true);
  t.after(() => second.controller.close());
  const db = second.controller.env.DB;
  await delay(800); // the scheduler checks immediately at start

  assert.deepEqual(offlineEvents(db), [], 'nodes have not had a full deadline to report since the restart');
  assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='alert_state'").first().value)[alreadyDown], true,
    'a node alerted before the stop keeps its alert state and gets no false recovery');

  // The node that reports after the restart stays quiet; the other is judged after the grace window.
  assert.equal((await second.report(healthy, { cpu: 12, timestamp: Date.now() })).status, 200);
  await checkOfflineNodes(second.controller.env, { startedAt, now: Date.now() + 30000 });
  assert.deepEqual(offlineEvents(db), []);

  await checkOfflineNodes(second.controller.env, { startedAt, now: Date.now() + 4 * 60000 });
  const events = offlineEvents(db);
  assert.equal(events.length, 1, 'after the grace window real downtime is reported once');
  assert.equal(events[0].event, '节点离线告警');
  assert.deepEqual(events[0].clients, ['Healthy before stop'], 'only the node that stopped reporting is new; the other stays alerted');

  assert.equal((await second.report(alreadyDown, { cpu: 12, timestamp: Date.now() })).status, 200);
  await checkOfflineNodes(second.controller.env, { startedAt, now: Date.now() + 1000 });
  const recovered = offlineEvents(db).at(-1);
  assert.equal(recovered.event, '节点恢复通知');
  assert.ok(recovered.clients.includes('Down before stop'), 'a real report after the restart recovers it');
});
