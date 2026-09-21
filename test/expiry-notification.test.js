import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createController } from '../src/server.js';
import { checkExpiringServers } from '../src/services/notifications/expiry.js';
import { drainNotifications } from '../src/services/outbox.js';

test('expiry reminders reach a webhook and deduplicate across restart and local midnight', async () => {
  const root = await mkdtemp(join(tmpdir(), 'monitor-expiry-'));
  const deliveries = [];
  const webhook = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    deliveries.push(Buffer.concat(chunks).toString());
    response.writeHead(200).end('ok');
  });
  webhook.listen(0, '127.0.0.1');
  await once(webhook, 'listening');
  const config = { DATA_DIR: root, API_SECRET: 'expiry-isolated-fixture-secret', ADMIN_PATH: 'expiry-test-entry', PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false' };
  let controller;
  try {
    controller = await createController(config);
    const address = await controller.listen(0, '127.0.0.1');
    const url = `http://127.0.0.1:${address.port}/${config.ADMIN_PATH}/api`;
    let token = '';
    const admin = async data => {
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
      assert.equal(response.status, 200, await response.clone().text());
      return response.json();
    };
    token = (await admin({ action: 'login', username: 'admin', password: config.API_SECRET })).token;
    await admin({ action: 'save_settings', settings: { expire_reminder: '7', notification_timezone: 'Asia/Shanghai', expire_notification_time: '0', notification_webhook_enabled: 'true', notification_webhook_url: `http://127.0.0.1:${webhook.address().port}/notify` } });
    await admin({ action: 'add', name: 'Expiry fixture', expire_date: '2026-09-24', auto_renewal: '0' });
    const now = Date.parse('2026-09-21T15:59:00Z'); // Shanghai 23:59, one minute before local midnight.
    const rows = () => controller.env.DB.prepare('SELECT * FROM notification_outbox ORDER BY id').all().results;
    const lastDay = () => controller.env.DB.prepare("SELECT value FROM settings WHERE key='expiry_report_last'").first()?.value;

    assert.equal(await checkExpiringServers(controller.env.DB, { now, scheduled: true }), true);
    assert.equal(rows().length, 1);
    const payload = JSON.parse(rows()[0].payload);
    assert.equal(payload.context.event, '服务器到期提醒');
    assert.deepEqual(payload.context.clients, ['Expiry fixture']);
    assert.equal(payload.context.count, 1);
    assert.match(payload.msg, /剩余3天/);
    assert.equal(lastDay(), '2026-09-21');
    await drainNotifications(controller.env.DB, { now });
    assert.equal(deliveries.length, 1);
    assert.match(deliveries[0], /Expiry fixture/);
    assert.match(deliveries[0], /剩余3天/);
    assert.equal(rows()[0].delivered_at, now);

    assert.equal(await checkExpiringServers(controller.env.DB, { now }), true);
    await controller.close();
    controller = await createController(config);
    assert.equal(await checkExpiringServers(controller.env.DB, { now }), true);
    assert.equal(rows().length, 1);

    const tomorrow = now + 60000;
    assert.equal(await checkExpiringServers(controller.env.DB, { now: tomorrow, scheduled: true }), true);
    assert.equal(rows().length, 2);
    assert.equal(lastDay(), '2026-09-22');
    assert.match(JSON.parse(rows()[1].payload).msg, /剩余2天/);
    await drainNotifications(controller.env.DB, { now: tomorrow });
    assert.equal(deliveries.length, 2);
    assert.equal(rows()[1].delivered_at, tomorrow);

    // Once no server is within the reminder window, no new notification is claimed.
    assert.equal(await checkExpiringServers(controller.env.DB, { now: Date.parse('2026-09-25T00:00:00Z') }), true);
    assert.equal(rows().length, 2);
    assert.equal(lastDay(), '2026-09-22');
  } finally {
    await controller?.close();
    await new Promise(resolve => webhook.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
