import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createController } from '../src/server.js';
import { readNotificationConfig, prepareNotificationConfig, DEFAULT_NOTIFICATION_TEMPLATE } from '../src/shared/notificationConfig.js';

const rule = (id = 'rule-one', servers = []) => ({ id, name: 'CPU high', metric: 'cpu', threshold: '80', servers, intervalMinutes: '5', mode: 'average' });
const prepare = input => prepareNotificationConfig({ input: { tg_bot_token: 'fixture-provider-target', ...input } });

test('NC01 legacy configuration reads and round-trips without mutating dynamic or explicit node scopes', () => {
  const stored = { tg_notify: true, expire_reminder: true, expire_notification_time: '02:37', notification_timezone: 'Invalid/Fixture', resource_alert_rules: [rule('all'), rule('selected', ['node-a'])] };
  const before = structuredClone(stored);
  const loaded = readNotificationConfig(stored);
  assert.equal(loaded.tg_notify, '5'); assert.equal(loaded.expire_reminder, '7');
  assert.equal(loaded.expire_notification_time, '2'); assert.equal(loaded.notification_timezone, 'UTC');
  const saved = prepare(loaded);
  // The loaded empty target is deliberately replaced by this fixture's target.
  assert.equal(saved.ok, false);
  const valid = prepare({ ...loaded, tg_bot_token: 'fixture-provider-target' });
  assert.equal(valid.ok, true);
  assert.deepEqual(readNotificationConfig(valid.patch), valid.config);
  assert.deepEqual(valid.config.resource_alert_rules.map(item => item.servers), [[], ['node-a']]);
  assert.deepEqual(stored, before);
  valid.config.resource_alert_rules[0].servers.push('another');
  assert.deepEqual(stored, before);
});

test('NC02 legacy templates migrate while custom templates and opaque provider credentials remain', () => {
  const legacy = '{{emoji}}【CF Server Monitor】{{event}}\n服务器: {{client}}\n详情:\n{{message}}\n时间: {{time}}';
  assert.equal(readNotificationConfig({ notification_template: legacy }).notification_template, DEFAULT_NOTIFICATION_TEMPLATE);
  const target = 'https://fixture.invalid/provider?key=opaque';
  const saved = prepare({ tg_notify: 5, tg_bot_token: target, notification_template: 'Custom {{message}}', tg_chat_id: '' });
  assert.equal(saved.ok, true); assert.equal(saved.config.tg_bot_token, target);
  assert.equal(saved.config.notification_template, 'Custom {{message}}');
});

test('NC03 maximum-length duplicate IDs are stable and unique through read, edit and save', () => {
  const input = { resource_alert_rules: [rule('a'.repeat(64)), rule('a'.repeat(64))], tg_bot_token: 'fixture-target' };
  const loaded = readNotificationConfig(input);
  assert.notEqual(loaded.resource_alert_rules[0].id, loaded.resource_alert_rules[1].id);
  assert.ok(loaded.resource_alert_rules.every(item => item.id.length <= 64));
  loaded.resource_alert_rules[1].threshold = '81';
  const saved = prepare(loaded);
  assert.equal(saved.ok, true);
  assert.deepEqual(readNotificationConfig(saved.patch).resource_alert_rules.map(item => item.id), loaded.resource_alert_rules.map(item => item.id));
});

test('NC04 twenty new rules are retained and the twenty-first is rejected before truncation', () => {
  const rules = Array.from({ length: 20 }, (_, index) => rule(`rule-${index}`));
  assert.equal(prepare({ resource_alert_rules: rules }).config.resource_alert_rules.length, 20);
  const result = prepare({ resource_alert_rules: [...rules, rule('last')] });
  assert.equal(result.ok, false); assert.equal(result.issues[0].code, 'resourceAlertRulesLimit');
  assert.equal(readNotificationConfig({ resource_alert_rules: [...rules, rule('last')] }).resource_alert_rules.length, 20);
});

test('NC05 legacy aliases and malformed stored entries read compatibly; malformed edits cannot enable defaults', () => {
  const loaded = readNotificationConfig({ resource_alert_rules: [null, { id: 'alias', metric: 'ram', threshold: 85, interval: 9, servers: { servers: ['node-a'] } }] });
  assert.equal(loaded.resource_alert_rules.length, 1);
  assert.equal(loaded.resource_alert_rules[0].intervalMinutes, '9');
  assert.deepEqual(loaded.resource_alert_rules[0].servers, ['node-a']);
  for (const value of ['{broken', null, [null], [7], [rule('bad', ['invalid id'])], [{ ...rule(), servers: null }]]) {
    assert.equal(prepare({ resource_alert_rules: value }).ok, false);
  }
  assert.equal(prepare({ resource_alert_rules: JSON.stringify([rule()]) }).ok, true);
});

test('NC06 invalid new timezone and hour fail equally for save and test, while omitted legacy fields remain usable', () => {
  for (const input of [{ notification_timezone: 'Invalid/Fixture' }, { notification_timezone: '' }, { expire_notification_time: '02:37' }, { expire_notification_time: 24 }, { expire_notification_time: '' }]) {
    const saved = prepare(input);
    const tested = prepareNotificationConfig({ input: { tg_bot_token: 'fixture-target', ...input }, intent: 'test' });
    assert.equal(saved.ok, false); assert.equal(tested.ok, false);
    assert.equal(saved.issues[0].code, tested.issues[0].code);
  }
  const result = prepareNotificationConfig({ current: { expire_notification_time: '02:37', tg_bot_token: 'fixture-target' }, input: { tg_notify: 5 } });
  assert.equal(result.ok, true); assert.equal(result.config.expire_notification_time, '2');
  assert.deepEqual(Object.keys(result.patch), ['tg_notify']);
});

test('NC07 rule threshold and evaluation bounds reject invalid new values with rule positions', () => {
  for (const change of [{ threshold: 0 }, { threshold: 0.004 }, { threshold: 101 }, { threshold: 'invalid' }, { intervalMinutes: 0 }, { intervalMinutes: 11 }, { intervalMinutes: null }, { metric: 'unknown' }, { metric: null }, { mode: 'unknown' }]) {
    const result = prepare({ resource_alert_rules: [rule(), { ...rule('second'), ...change }] });
    assert.equal(result.ok, false, JSON.stringify(change)); assert.equal(result.issues[0].index, 1);
  }
  assert.equal(prepare({ resource_alert_rules: [{ ...rule(), threshold: 100, intervalMinutes: 10 }] }).ok, true);
  assert.equal(prepare({ resource_alert_rules: [{ ...rule(), metric: 'netIn', threshold: 100000 }] }).ok, true);
});

test('NC08 partial updates validate the effective selected channel and preserve absent credentials', () => {
  const current = { tg_notify: 5, tg_bot_token: 'fixture-target' };
  const result = prepareNotificationConfig({ current, input: { notification_timezone: 'Asia/Shanghai' } });
  assert.equal(result.ok, true); assert.equal(result.config.tg_bot_token, 'fixture-target');
  assert.deepEqual(result.patch, { notification_timezone: 'Asia/Shanghai' });
  for (const input of [{ tg_bot_token: '' }, { notification_webhook_enabled: true }]) assert.equal(prepareNotificationConfig({ current, input }).ok, false);
  const switched = prepareNotificationConfig({ current, input: { notification_webhook_enabled: true, notification_webhook_url: 'http://127.0.0.1/fixture' } });
  assert.equal(switched.ok, true);
  const disabled = prepareNotificationConfig({ current, input: { tg_notify: 0, tg_bot_token: '' } });
  assert.equal(disabled.ok, true); assert.equal(disabled.config.tg_bot_token, '');
});

test('NC09 test intent uses unsaved delivery fields, requires a target and ignores unrelated rule drafts', () => {
  const result = prepareNotificationConfig({ current: { tg_bot_token: 'stored-target' }, input: { tg_bot_token: 'draft-target', resource_alert_rules: [null], notification_template: 'Draft {{message}}' }, intent: 'test' });
  assert.equal(result.ok, true); assert.equal(result.config.tg_bot_token, 'draft-target');
  assert.equal(result.config.notification_template, 'Draft {{message}}');
  assert.equal(Object.hasOwn(result.patch, 'resource_alert_rules'), false);
  assert.equal(prepareNotificationConfig({ input: {}, intent: 'test' }).ok, false);
  assert.equal(prepareNotificationConfig({ input: {} }).ok, true);
});

test('NC10 malformed targets and non-notification fields do not leak through the configuration interface', () => {
  const input = { username: 'fixture-admin', password: 'do-not-copy', jwt_secret: 'do-not-copy', tg_notify: 0 };
  assert.deepEqual(prepareNotificationConfig({ input }).patch, { tg_notify: '0' });
  for (const invalid of [null, [], 5]) assert.equal(prepareNotificationConfig({ input: invalid }).ok, false);
  assert.equal(prepare({ tg_bot_token: {} }).ok, false);
  assert.equal(prepare({ notification_webhook_headers: [] }).ok, false);
});

test('NC11 real settings requests reject invalid edits atomically and preserve resource scopes across restart', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notification-config-api-'));
  const config = { API_SECRET: 'notification-fixture-secret-000000', ADMIN_PATH: 'notification-fixture-admin', DATA_DIR: join(root, 'data'), SCHEDULER_ENABLED: 'false' };
  let controller;
  let base;
  const start = async () => { controller = await createController(config); const addr = await controller.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${addr.port}`; };
  let token;
  const admin = async data => { const response = await fetch(`${base}/${config.ADMIN_PATH}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: JSON.stringify(data) }); return { status: response.status, body: await response.json() }; };
  try {
    await start(); token = (await admin({ action: 'login', username: 'admin', password: config.API_SECRET })).body.token;
    const initial = { tg_bot_token: 'fixture-target', resource_alert_rules: [rule('dynamic-all'), rule('selected', ['node-a'])] };
    assert.equal((await admin({ action: 'save_settings', settings: initial })).status, 200);
    const before = controller.env.DB.prepare("SELECT value FROM settings WHERE key='site_options'").first().value;
    for (const invalid of [{ notification_timezone: 'Invalid/Fixture', tg_bot_token: 'changed' }, { resource_alert_rules: Array.from({ length: 21 }, (_, i) => rule(`rule-${i}`)) }, { resource_alert_rules: [{ ...rule(), threshold: 0 }] }, { resource_alert_rules: [{ ...rule(), servers: null }] }, { tg_bot_token: '' }]) {
      assert.equal((await admin({ action: 'save_settings', settings: invalid })).status, 400);
      assert.equal(controller.env.DB.prepare("SELECT value FROM settings WHERE key='site_options'").first().value, before);
    }
    assert.equal((await admin({ action: 'save_settings', settings: { notification_timezone: 'Asia/Shanghai' } })).status, 200);
    await controller.close(); controller = null; await start();
    const settings = (await admin({ action: 'get_settings' })).body.settings;
    assert.deepEqual(settings.resource_alert_rules.map(item => item.servers), [[], ['node-a']]);
    assert.equal(settings.tg_bot_token, 'fixture-target'); assert.equal(settings.notification_timezone, 'Asia/Shanghai');
  } finally { await controller?.close(); await rm(root, { recursive: true, force: true }); }
});

test('NC12 real test-notification requests validate the unsaved draft before local delivery and do not save it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notification-config-delivery-'));
  const bodies = [];
  const receiver = createServer(async (req, res) => { let body = ''; for await (const chunk of req) body += chunk; bodies.push(body); res.writeHead(200); res.end('ok'); });
  receiver.listen(0, '127.0.0.1'); await once(receiver, 'listening');
  const controller = await createController({ API_SECRET: 'notification-local-test-secret-000', ADMIN_PATH: 'notification-local-admin', DATA_DIR: join(root, 'data'), SCHEDULER_ENABLED: 'false' });
  const addr = await controller.listen(0, '127.0.0.1'); const base = `http://127.0.0.1:${addr.port}`;
  let token;
  const admin = async data => { const response = await fetch(`${base}/notification-local-admin/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` }, body: JSON.stringify(data) }); return { status: response.status, body: await response.json() }; };
  try {
    token = (await admin({ action: 'login', username: 'admin', password: 'notification-local-test-secret-000' })).body.token;
    const before = controller.env.DB.prepare("SELECT value FROM settings WHERE key='site_options'").first().value;
    const draft = { action: 'send_test_notification', notification_webhook_enabled: true, notification_webhook_url: `http://127.0.0.1:${receiver.address().port}/fixture`, notification_timezone: 'Asia/Shanghai', expire_notification_time: '2', notification_template: 'UNSAVED {{message}}' };
    for (const invalid of [{ notification_timezone: 'Invalid/Fixture' }, { expire_notification_time: 24 }, { notification_webhook_url: '' }, { tg_bot_token: {}, notification_webhook_enabled: false }]) assert.equal((await admin({ ...draft, ...invalid })).status, 400);
    assert.equal(bodies.length, 0);
    assert.equal((await admin(draft)).status, 200);
    assert.equal(bodies.length, 1); assert.ok(bodies[0].includes('UNSAVED'));
    assert.equal(controller.env.DB.prepare("SELECT value FROM settings WHERE key='site_options'").first().value, before);
  } finally { await controller.close(); receiver.closeAllConnections(); await new Promise(resolve => receiver.close(resolve)); await rm(root, { recursive: true, force: true }); }
});
