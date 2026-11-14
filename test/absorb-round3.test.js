import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';
import { prepareNotificationConfig, getResourceAlertRuleThresholds, normalizeResourceAlertRules } from '../src/shared/notificationConfig.js';
import { ResourceAlertWindows } from '../src/realtime/ResourceAlertWindows.js';
import { getClientIpFallback, toBroadcastSamples } from '../src/services/ingestion.js';
import { checkResourceAlerts } from '../src/services/notifications/resource.js';
import { checkExpiringServers } from '../src/services/notifications/expiry.js';
import { drainNotifications, enqueueNotification } from '../src/services/outbox.js';
import { cleanupHistory } from '../src/database/schema.js';
import { secretEquals } from '../src/utils/secret.js';
import { getExpireTimestamp, renewExpireDateIfNeeded, resolveBillingAnchorDay } from '../src/shared/billing.js';
import { normalizeServerInput } from '../src/services/serverInput.js';
import { buildServerFormPayload, createServerForm } from '../src/frontend/utils/serverForm.js';
import { calculateFinanceSummary, calculateRemainingValueCNY } from '../src/frontend/utils/finance.js';
import { createDashboardState } from '../src/frontend/state/dashboardState.js';

const SECRET = 'absorb-round3-fixture-secret-20261114';
const ADMIN_PATH = 'absorb-round3-fixture-20261114';
const DAY = 86400000;
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const nextMonthDate = (date, anchor) => {
  const [year, month] = date.split('-').map(Number);
  const next = month === 12 ? [year + 1, 1] : [year, month + 1];
  const day = Math.min(anchor, daysInMonth(next[0], next[1]));
  return `${next[0]}-${String(next[1]).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

async function controllerFixture(t, extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'monitor-round3-'));
  const hook = createHttpServer((request, response) => { request.resume(); response.end('ok'); });
  await new Promise(resolve => hook.listen(0, '127.0.0.1', resolve));
  const config = {
    DATA_DIR: root, API_SECRET: SECRET, ADMIN_PATH, PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false',
    TRUSTED_PROXIES: '127.0.0.1/32', ...extra
  };
  let controller = await createController(config);
  let base = `http://127.0.0.1:${(await controller.listen(0, '127.0.0.1')).port}`;
  let token = '';
  const call = async (path, body, headers = {}) => {
    const response = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, body: data };
  };
  const login = async () => { token = (await call(`/${ADMIN_PATH}/api`, { action: 'login', username: 'admin', password: SECRET })).body.token; };
  await login();
  const f = {
    root, config,
    get controller() { return controller; }, get db() { return controller.env.DB; }, get base() { return base; },
    admin: body => call(`/${ADMIN_PATH}/api`, body),
    report: (id, body, headers) => call('/update', { id, secret: SECRET, ...body }, headers),
    get: path => call(path),
    async list() { return (await call(`/${ADMIN_PATH}/api`, { action: 'list' })).body.servers; },
    async server(id) { return (await f.list()).find(server => server.id === id); },
    async add(fields) { const result = await call(`/${ADMIN_PATH}/api`, { action: 'add', ...fields }); assert.equal(result.status, 200, JSON.stringify(result.body)); return result.body.id; },
    async edit(id, fields) {
      const result = await call(`/${ADMIN_PATH}/api`, { ...(await f.server(id)), ...fields, action: 'edit' });
      assert.equal(result.status, 200, JSON.stringify(result.body));
    },
    hook: `http://127.0.0.1:${hook.address().port}/hook`,
    async restart(whileStopped = async () => {}) {
      await controller.close();
      await whileStopped();
      controller = await createController(config);
      base = `http://127.0.0.1:${(await controller.listen(0, '127.0.0.1')).port}`;
      token = ''; await login();
    }
  };
  t.after(async () => {
    try { await controller.close(); }
    finally {
      await new Promise(resolve => hook.close(resolve));
      await rm(root, { recursive: true, force: true });
    }
  });
  return f;
}
const outboxContexts = db => db.prepare('SELECT payload FROM notification_outbox ORDER BY id').all().results.map(row => JSON.parse(row.payload));

test('R3-01 resource rules accept integer TCP/UDP connection thresholds with strict validation', () => {
  const rule = threshold => ({ resource_alert_rules: [{ metric: 'tcpConn', threshold, intervalMinutes: 5, mode: 'average' }] });
  const current = { tg_bot_token: 'fixture-token' };
  for (const threshold of [1, '1000', 10000000]) {
    const result = prepareNotificationConfig({ current, input: rule(threshold) });
    assert.equal(result.ok, true, `${threshold}: ${JSON.stringify(result.issues)}`);
    assert.equal(result.config.resource_alert_rules[0].threshold, String(threshold));
  }
  for (const threshold of [0, '0', 1.5, '1.5', 10000001, '-3', 'abc', '']) {
    const result = prepareNotificationConfig({ current, input: rule(threshold) });
    assert.equal(result.ok, false, String(threshold));
    assert.equal(result.issues[0].code, 'invalidResourceAlertThreshold');
  }
  const [normalized] = normalizeResourceAlertRules([{ metric: 'udpConn' }]);
  assert.equal(normalized.metric, 'udpConn');
  assert.equal(normalized.threshold, '1000', 'default threshold is 1000 connections');
  assert.equal(normalized.name, 'UDP Conn Alert 1');
  assert.deepEqual(getResourceAlertRuleThresholds({ metric: 'tcpConn', threshold: '250' }), {
    cpuPercent: 0, ramPercent: 0, diskPercent: 0, netInBps: 0, netOutBps: 0, netTotalBps: 0, tcpConn: 250, udpConn: 0
  });
  // Existing percent and Mbps rules keep their behaviour.
  assert.equal(normalizeResourceAlertRules([{ metric: 'cpu', threshold: '80.5' }])[0].threshold, '80.5');
  assert.equal(prepareNotificationConfig({ current, input: { resource_alert_rules: [{ metric: 'cpu', threshold: 80.5 }] } }).ok, true);
});

test('R3-02 connection windows alert on counts and never treat a missing count as recovery', async () => {
  const runtime = new Map();
  const db = { prepare: () => ({ bind: (key, value) => ({ first: () => runtime.has(key) ? { value: runtime.get(key) } : null, run: () => runtime.set(key, value) }) }) };
  const windows = new ResourceAlertWindows({ DB: db });
  const now = Date.UTC(2026, 10, 14, 6, 0, 30);
  const samples = values => values.map((value, index) => ({ ts: now - (values.length - 1 - index) * 60000, payload: value }));
  await windows.ingest([
    { serverId: 'busy', samples: samples([{ tcp_conn: 900, udp_conn: 5 }, { tcp_conn: '1100', udp_conn: 7 }]) },
    { serverId: 'quiet', samples: samples([{ tcp_conn: 10 }, { tcp_conn: 12 }]) },
    { serverId: 'unreported', samples: samples([{ cpu: 50 }, { cpu: 60, tcp_conn: null }]) }
  ], now);
  const result = windows.evaluateRule({ ruleId: 'r', serverIds: ['busy', 'quiet', 'unreported'], mode: 'average', windowMinutes: 5,
    thresholds: { tcpConn: 950 } }, now);
  assert.deepEqual(result.alerts.map(alert => alert.serverId), ['busy']);
  assert.equal(result.alerts[0].metrics[0].triggerValue, 1000);
  assert.deepEqual(result.evaluatedServerIds, ['busy', 'quiet'], 'a node without counts is not evaluated, so it cannot recover');

  const broadcast = toBroadcastSamples('id', [
    { ts: now - 1000, metrics: { cpu: 1 } }, { ts: now, metrics: { cpu: 2 } }
  ], '', '', { cpu: 2 });
  assert.equal(broadcast.at(-1).payload.tcp_conn, null, 'latest payload keeps an unreported count unknown');
  assert.equal(broadcast.at(-1).payload.udp_conn, null);
  const reported = toBroadcastSamples('id', [{ ts: now, metrics: { tcp_conn: '15', udp_conn: '0' } }], '', '', { tcp_conn: '15', udp_conn: '0' });
  assert.equal(reported[0].payload.tcp_conn, 15);
  assert.equal(reported[0].payload.udp_conn, 0, 'a reported zero is a real value');
});

test('R3-03 TCP rule fires through real HTTP reports and the SQLite outbox with integer text', async t => {
  const f = await controllerFixture(t);
  assert.equal((await f.admin({ action: 'save_settings', settings: {
    notification_webhook_enabled: 'true', notification_webhook_url: f.hook,
    resource_alert_rules: JSON.stringify([{ id: 'tcp', name: 'TCP 过多', metric: 'tcpConn', threshold: '500', intervalMinutes: 5, mode: 'average' }])
  } })).status, 200);
  const busy = await f.add({ name: '连接繁忙' });
  const silent = await f.add({ name: '未上报连接' });
  const now = Date.now();
  const samples = (values) => values.map((metrics, index) => ({ ts: now - (values.length - 1 - index) * 70000, metrics: { cpu: 5, ...metrics, timestamp: now - (values.length - 1 - index) * 70000 } }));
  assert.equal((await f.report(busy, { metrics: { cpu: 5, tcp_conn: '701', udp_conn: '3', timestamp: now }, samples: samples([{ tcp_conn: '650', udp_conn: '2' }, { tcp_conn: '701', udp_conn: '3' }]) })).status, 200);
  assert.equal((await f.report(silent, { metrics: { cpu: 5, timestamp: now }, samples: samples([{}, {}]) })).status, 200);
  await checkResourceAlerts(f.controller.env);
  const alerts = outboxContexts(f.db);
  assert.equal(alerts.length, 1, JSON.stringify(alerts));
  assert.match(alerts[0].msg, /连接繁忙\s+TCP 连接数 676/);
  assert.ok(!alerts[0].msg.includes('未上报连接'));
});

test('R3-04 empty public IP is filled from the trusted source address only when that address is public', async t => {
  assert.deepEqual(getClientIpFallback({ ip_v4: '0', ip_v6: '' }, '8.8.4.4'), { ip_v4: '8.8.4.4' });
  assert.deepEqual(getClientIpFallback({ ip_v4: 'null', ip_v6: 'false' }, '::ffff:1.1.1.1'), { ip_v4: '1.1.1.1' });
  assert.deepEqual(getClientIpFallback({}, '2606:4700:4700::1111'), { ip_v6: '2606:4700:4700::1111' });
  for (const source of ['10.0.0.5', '172.17.0.1', '172.20.1.1', '192.168.1.9', '127.0.0.1', '::1', 'fd00::1', 'fe80::1', '100.64.0.1', '100.127.3.4', '0.0.0.0', 'not-an-ip', '']) {
    assert.equal(getClientIpFallback({ ip_v4: '0', ip_v6: '0' }, source), null, source);
  }
  assert.deepEqual(getClientIpFallback({ ip_v4: '0', ip_v6: '0' }, '100.128.0.1'), { ip_v4: '100.128.0.1' }, 'only 100.64.0.0/10 is CGNAT');
  assert.equal(getClientIpFallback({ ip_v4: '1.2.3.4', ip_v6: '' }, '8.8.4.4'), null, 'a reported address wins');
  assert.equal(getClientIpFallback({ ip_v4: '', ip_v6: '2001:db8::1' }, '8.8.4.4'), null);

  const f = await controllerFixture(t);
  const ids = {};
  for (const name of ['proxy-v4', 'proxy-v6', 'private', 'loopback', 'reported', 'websocket']) ids[name] = await f.add({ name });
  const now = Date.now();
  await f.report(ids['proxy-v4'], { metrics: { cpu: 1, ip_v4: '0', ip_v6: '', timestamp: now } }, { 'X-Forwarded-For': '8.8.4.4' });
  await f.report(ids['proxy-v6'], { metrics: { cpu: 1, ip_v4: '', ip_v6: '0', timestamp: now } }, { 'X-Forwarded-For': '2606:4700:4700::1111' });
  await f.report(ids.private, { metrics: { cpu: 1, ip_v4: '0', ip_v6: '0', timestamp: now } }, { 'X-Forwarded-For': '172.18.0.1' });
  await f.report(ids.loopback, { metrics: { cpu: 1, ip_v4: '0', ip_v6: '0', timestamp: now } });
  await f.report(ids.reported, { metrics: { cpu: 1, ip_v4: '203.0.113.7', ip_v6: '', timestamp: now } }, { 'X-Forwarded-For': '8.8.4.4' });

  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/update', { headers: { 'X-Forwarded-For': '9.9.9.9' } });
  const ack = new Promise((resolve, reject) => {
    ws.on('message', raw => { const packet = JSON.parse(raw); if (packet.type === 'ack') resolve(packet); if (packet.type === 'error') reject(new Error(packet.text)); });
    ws.on('error', reject);
  });
  await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
  ws.send(JSON.stringify({ id: ids.websocket, secret: SECRET, metrics: { cpu: 1, ip_v4: '', ip_v6: '', timestamp: Date.now() } }));
  assert.equal((await ack).persisted, true);
  ws.close();

  const list = Object.fromEntries((await f.list()).map(server => [server.name, [server.ip_v4, server.ip_v6]]));
  assert.deepEqual(list['proxy-v4'], ['8.8.4.4', '0']);
  assert.deepEqual(list['proxy-v6'], ['0', '2606:4700:4700::1111']);
  assert.deepEqual(list.private, ['0', '0'], 'Docker bridge / private source stays empty');
  assert.deepEqual(list.loopback, ['0', '0']);
  assert.deepEqual(list.reported, ['203.0.113.7', '0']);
  assert.deepEqual(list.websocket, ['9.9.9.9', '0'], 'WS uses the handshake source address');
});

test('R3-05 Agent secret comparison is constant-time and still rejects wrong secrets', async t => {
  assert.equal(secretEquals(SECRET, SECRET), true);
  for (const value of [`${SECRET}x`, SECRET.slice(0, -1), '', null, undefined, 42, { toString: () => SECRET }]) assert.equal(secretEquals(value, SECRET), false, String(value));
  assert.equal(secretEquals('', ''), false, 'an empty configured secret never matches');
  const f = await controllerFixture(t);
  const id = await f.add({ name: 'secret node' });
  const wrong = await fetch(f.base + '/update', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, secret: `${SECRET}-wrong`, metrics: { cpu: 1, timestamp: Date.now() } }) });
  assert.equal(wrong.status, 401);
  assert.equal((await f.report(id, { metrics: { cpu: 1, timestamp: Date.now() } })).status, 200);
  const ws = new WebSocket(f.base.replace('http:', 'ws:') + '/update');
  await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
  const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) });
  ws.send(JSON.stringify({ id, secret: 'wrong-secret-value', metrics: { cpu: 1, timestamp: Date.now() } }));
  const [code] = await closed;
  assert.notEqual(code, 1000);
  const admin = await fetch(`${f.base}/${ADMIN_PATH}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'login', username: 'admin', password: `${SECRET}-wrong` }) });
  assert.equal(admin.status, 401, 'initial admin login with API_SECRET also rejects a wrong value');
});

test('R3-06 undelivered notifications expire after 24 hours and are never sent late', async t => {
  const f = await controllerFixture(t);
  const db = f.db;
  const now = Date.now();
  enqueueNotification(db, 'stale', {}, now - 25 * 3600000);
  enqueueNotification(db, 'recent', {}, now - 3600000);
  enqueueNotification(db, 'unconfigured', {}, now - 23 * 3600000);
  const sent = [];
  await drainNotifications(db, { now, sender: async (_settings, msg) => {
    sent.push(msg);
    return msg === 'unconfigured' ? { status: 'unconfigured' } : { status: 'delivered' };
  } });
  assert.deepEqual(sent.sort(), ['recent', 'unconfigured']);
  cleanupHistory(db, now);
  const rows = () => db.prepare('SELECT payload, delivered_at FROM notification_outbox ORDER BY id').all().results
    .map(row => [JSON.parse(row.payload).msg, row.delivered_at ? 'delivered' : 'pending']);
  assert.deepEqual(rows(), [['recent', 'delivered'], ['unconfigured', 'pending']]);
  cleanupHistory(db, now + 2 * 3600000);
  assert.deepEqual(rows(), [['recent', 'delivered']], 'pending without a channel is discarded once it is 24 hours old');
});

test('R3-07 monthly renewal returns to the billing day; dates the user enters set a new day', () => {
  assert.equal(resolveBillingAnchorDay('2026-02-28', 31), 31);
  assert.equal(resolveBillingAnchorDay('2026-02-28', 29), 29);
  assert.equal(resolveBillingAnchorDay('2026-03-28', 31), 28, 'an anchor that does not explain the date is replaced');
  assert.equal(resolveBillingAnchorDay('2026-04-30', 31), 31);
  assert.equal(resolveBillingAnchorDay('2026-01-15', null), 15);
  assert.equal(resolveBillingAnchorDay('', 31), null);
  const chain = (date, anchorDay, times, cycle = 'month') => Array.from({ length: times }, () => {
    date = renewExpireDateIfNeeded(date, cycle, '1', getExpireTimestamp(date, 'UTC') + 3600000, 0, { anchorDay }).expire_date;
    return date;
  });
  assert.deepEqual(chain('2026-01-31', 31, 6), ['2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31', '2026-06-30', '2026-07-31']);
  assert.deepEqual(chain('2027-12-31', 31, 3), ['2028-01-31', '2028-02-29', '2028-03-31'], 'leap February');
  assert.deepEqual(chain('2026-01-30', 30, 3), ['2026-02-28', '2026-03-30', '2026-04-30']);
  assert.deepEqual(chain('2026-11-30', 31, 2, 'quarter'), ['2027-02-28', '2027-05-31']);
  assert.deepEqual(chain('2024-02-29', 29, 2, 'year'), ['2025-02-28', '2026-02-28'], 'yearly keeps 29 when possible, only Feb is affected');

  const settings = { notification_timezone: 'UTC' };
  const base = { name: 'n', billing_cycle: 'month', auto_renewal: '0' };
  assert.equal(normalizeServerInput({ ...base, expire_date: '2026-02-28', billing_anchor_day: 31 }, settings).billing_anchor_day, 31);
  assert.equal(normalizeServerInput({ ...base, expire_date: '2026-03-15', billing_anchor_day: 31 }, settings).billing_anchor_day, 15);
  assert.equal(normalizeServerInput({ ...base, expire_date: '2026-04-30', billing_anchor_day: null }, settings).billing_anchor_day, 30);
  assert.equal(normalizeServerInput({ ...base, expire_date: '' }, settings).billing_anchor_day, null);

  const form = createServerForm({ id: 'x', name: 'n', expire_date: '2026-02-28', billing_anchor_day: 31, billing_cycle: 'month', auto_renewal: '1' }, 'http');
  assert.equal(form.billing_anchor_day, 31);
  assert.equal(buildServerFormPayload(form, 'http').payload.billing_anchor_day, 31);
  assert.equal(buildServerFormPayload({ ...form, expire_date: '2026-04-30', billing_anchor_day: null }, 'http').payload.billing_anchor_day, 30);
});

test('R3-08 billing day survives admin edits, batch edits, export/import, cron renewal and old databases', async t => {
  const f = await controllerFixture(t);
  const id = await f.add({ name: '月末节点', price: '10', billing_cycle: 'month', auto_renewal: '1', expire_date: '2025-10-31' });
  let server = await f.server(id);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal(server.billing_anchor_day, 31);
  assert.ok(server.expire_date > today, server.expire_date);
  assert.equal(Number(server.expire_date.slice(8)), Math.min(31, daysInMonth(...server.expire_date.split('-').slice(0, 2).map(Number))));

  await f.edit(id, { name: '月末节点（改名）' });
  assert.equal((await f.server(id)).billing_anchor_day, 31, 'editing other fields keeps the billing day');

  const due = server.expire_date;
  await checkExpiringServers(f.db, { now: getExpireTimestamp(due, 'UTC') - 12 * 3600000 });
  server = await f.server(id);
  assert.equal(server.expire_date, nextMonthDate(due, 31), 'cron renewal returns to day 31');
  assert.equal(server.billing_anchor_day, 31);

  const exported = (await f.admin({ action: 'export_servers' })).body.servers.find(row => row.id === id);
  assert.equal(exported.billing_anchor_day, 31);
  await f.admin({ action: 'delete', id });
  const imported = await f.admin({ action: 'import_servers', servers: [
    { ...exported, auto_renewal: '0', expire_date: '2027-02-28' },
    { ...exported, id: crypto.randomUUID(), name: '错位账单日', auto_renewal: '0', expire_date: '2027-02-28', billing_anchor_day: 15 }
  ] });
  assert.equal(imported.body.imported, 2);
  const byName = Object.fromEntries((await f.list()).map(row => [row.name, row]));
  assert.equal(byName['月末节点（改名）'].billing_anchor_day, 31, 'an exported anchor that explains the date is restored');
  assert.equal(byName['错位账单日'].billing_anchor_day, 28, 'an inconsistent anchor falls back to the date');

  const other = byName['错位账单日'].id;
  const batch = await f.admin({ action: 'batch_edit', servers: [{ ...byName['错位账单日'], expire_date: '2027-05-30', billing_anchor_day: null }] });
  assert.equal(batch.status, 200);
  assert.equal((await f.server(other)).billing_anchor_day, 30);

  // Simulate a v1 database written before this column existed.
  let before = 0;
  await f.restart(async () => {
    const file = new DatabaseSync(join(f.root, 'monitor.sqlite'));
    file.exec('ALTER TABLE servers DROP COLUMN billing_anchor_day; PRAGMA user_version = 1;');
    file.prepare("UPDATE servers SET expire_date = '2026-08-31' WHERE id = ?").run(other);
    before = file.prepare('SELECT count(*) AS n FROM servers').get().n;
    file.close();
  });
  const upgraded = new DatabaseSync(join(f.root, 'monitor.sqlite'), { readOnly: true });
  assert.equal(upgraded.prepare('PRAGMA user_version').get().user_version, 3);
  assert.equal(upgraded.prepare('SELECT count(*) AS n FROM servers').get().n, before);
  upgraded.close();
  const migrated = Object.fromEntries((await f.list()).map(row => [row.id, row.billing_anchor_day]));
  assert.equal(migrated[other], 31, 'old rows start from the day of their stored expiry date');
});

test('R3-09 expiry boundaries follow the notification time zone in reminders, renewal and display', async t => {
  const beijing01 = Date.UTC(2026, 10, 13, 17, 0, 0); // 2026-11-14 01:00 in Asia/Shanghai, still 11-13 in UTC
  assert.equal(renewExpireDateIfNeeded('2026-11-15', 'month', '1', beijing01, 1, { timezone: 'Asia/Shanghai' }).renewed, true);
  assert.equal(renewExpireDateIfNeeded('2026-11-15', 'month', '1', beijing01, 1, { timezone: 'UTC' }).renewed, false);
  assert.equal(new Date(getExpireTimestamp('2026-11-15', 'Asia/Shanghai')).toISOString(), '2026-11-14T16:00:00.000Z');
  assert.equal(new Date(getExpireTimestamp('2026-11-15', 'UTC')).toISOString(), '2026-11-15T00:00:00.000Z');
  assert.equal(new Date(getExpireTimestamp('2026-03-08', 'America/New_York')).toISOString(), '2026-03-08T05:00:00.000Z');
  assert.equal(getExpireTimestamp('2026-11-15', 'Not/AZone'), Date.UTC(2026, 10, 15), 'an invalid zone falls back to UTC');
  assert.ok(Number.isNaN(getExpireTimestamp('', 'UTC')));

  const at0400 = Date.UTC(2026, 10, 14, 20, 0, 0); // 11-15 04:00 in Shanghai
  const paid = { price: '30', currency: '¥', billing_cycle: 'month', expire_date: '2026-11-15' };
  assert.equal(calculateRemainingValueCNY(paid, 30, at0400, 'Asia/Shanghai'), 0, 'expired at Beijing midnight');
  assert.ok(calculateRemainingValueCNY(paid, 30, at0400, 'UTC') > 0);
  assert.equal(calculateFinanceSummary([paid], undefined, at0400, 'Asia/Shanghai').expiredCount, 1);

  const f = await controllerFixture(t);
  assert.equal((await f.admin({ action: 'save_settings', settings: { notification_timezone: 'Asia/Shanghai' } })).status, 200);
  const id = await f.add({ name: '时区节点', expire_date: '2026-12-01' });
  assert.equal((await f.get('/api/servers')).body.sysConfig.notification_timezone, 'Asia/Shanghai');
  assert.equal((await f.get(`/api/server?id=${id}`)).body.sysConfig.notification_timezone, 'Asia/Shanghai');
  assert.equal((await f.get('/api/servers')).body.servers[0].billing_anchor_day, undefined, 'billing day is not public');
});

test('R3-10 dashboard honours the WS timeout: pause, keep paused when closed, resume on continue', async () => {
  const sockets = [], timers = new Set(), requests = [];
  let restore = null;
  const session = createDashboardState({
    getSources: () => ['one'], getTitle: () => '', loadConfig: async () => ({ frontend_ws_timeout_minutes: 5 }),
    async fetchSnapshots(onResult) {
      requests.push(Date.now());
      onResult({ baseUrl: 'one', data: { servers: [{ id: 'a', name: 'a', cpu: 1, last_updated: Date.now() }], sysConfig: {} } });
    },
    connect(source, index, ids, handlers) {
      const socket = { handlers, closes: 0, reconnects: 0, isConnected: true, isConnecting: false,
        close() { this.closes++; this.isConnected = false; handlers.onStatus({ connected: false }); }, reconnect() { this.reconnects++; } };
      sockets.push(socket); return socket;
    },
    now: () => Date.now(), every(callback, delay) { const timer = { callback, delay }; timers.add(timer); return timer; },
    cancel: timer => timers.delete(timer), isHidden: () => false,
    onRestore(callback) { restore = callback; return () => { restore = null; }; }
  });
  await session.start();
  const poll = () => [...timers].find(timer => timer.delay !== 1000).callback();
  assert.equal(sockets.length, 1);
  assert.equal(sockets[0].handlers.timeoutMinutes, 5, 'the admin setting reaches the dashboard socket');
  sockets[0].handlers.onTimeout();
  assert.equal(session.state.liveTimedOut, true);
  assert.equal(session.state.liveConnected, false);
  assert.equal(sockets[0].closes, 1);
  const requestsWhenPaused = requests.length;
  await poll();
  restore({ type: 'focus' });
  assert.equal(requests.length, requestsWhenPaused, 'paused page stops snapshot polling');
  assert.equal(sockets.length, 1, 'restore events do not reconnect a timed-out page');
  assert.equal(sockets[0].reconnects, 0);
  session.dismissLiveTimeout();
  assert.equal(session.state.liveTimedOut, false);
  await poll();
  assert.equal(requests.length, requestsWhenPaused, 'closing the prompt keeps the page paused');
  session.resumeLive();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(sockets.length, 2, 'continue opens a new live connection');
  assert.ok(requests.length > requestsWhenPaused, 'continue catches up with a snapshot');
  assert.equal(sockets[1].handlers.timeoutMinutes, 5);
  session.stop();
});
