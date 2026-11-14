import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createController } from '../src/server.js';
import { sumCounterIncrements, updateMeteredTrafficSnapshots, checkTrafficReports } from '../src/services/notifications/traffic.js';
import { sendNotification } from '../src/services/notifications/delivery.js';
import { drainNotifications, enqueueNotification, getNotificationDeliveryIssue, requeueStoppedNotifications } from '../src/services/outbox.js';
import { cleanupHistory } from '../src/database/schema.js';

const SECRET = 'issues-1-2-fixture-secret-20261114';
const ADMIN_PATH = 'issues-1-2-fixture-20261114';
const DAY = 86400000;
const MB = 1024 * 1024;

async function controllerFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'monitor-issues-'));
  const replies = [];
  const requests = [];
  const hook = createHttpServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push({ url: request.url, body });
      const reply = replies.length > 1 ? replies.shift() : replies[0] || { status: 200, body: '{"code":0}' };
      response.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(reply.body);
    });
  });
  await new Promise(resolve => hook.listen(0, '127.0.0.1', resolve));
  const controller = await createController({ DATA_DIR: root, API_SECRET: SECRET, ADMIN_PATH, PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false' });
  const base = `http://127.0.0.1:${(await controller.listen(0, '127.0.0.1')).port}`;
  let token = '';
  const call = async (path, body) => {
    const response = await fetch(base + path, { method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  token = (await call(`/${ADMIN_PATH}/api`, { action: 'login', username: 'admin', password: SECRET })).body.token;
  t.after(async () => {
    try { await controller.close(); }
    finally { await new Promise(resolve => hook.close(resolve)); await rm(root, { recursive: true, force: true }); }
  });
  return {
    controller, db: controller.env.DB, replies, requests,
    hookBase: `http://127.0.0.1:${hook.address().port}`,
    admin: body => call(`/${ADMIN_PATH}/api`, body),
    report: (id, metrics) => call('/update', { id, secret: SECRET, metrics })
  };
}

// ------------------------------------------------------------------ #1 traffic reports
test('I1-01 counter increments survive reboots and restart after a period reset', () => {
  assert.deepEqual(sumCounterIncrements(100, [150, 0, 200, 20, 60]), { total: 140, last: 60 });
  assert.deepEqual(sumCounterIncrements(null, [100, 150]), { total: 50, last: 150 });
  assert.deepEqual(sumCounterIncrements(500, []), { total: 0, last: 500 });
  assert.deepEqual(sumCounterIncrements(1000, [3000, 200, 900]), { total: 2700, last: 900 }, 'reset day: 2000 before + 700 after');
});

test('I1-02 daily, weekly and monthly usage come from the billing-period counters, not boot counters', () => {
  const tz = 'UTC';
  const monday = Date.UTC(2026, 10, 2, 12); // 2026-11-02 Monday 12:00 UTC
  let snapshots = updateMeteredTrafficSnapshots('{}', { readings: [{ timestamp: monday - 60000, rx: 1000, tx: 100 }], legacyRx: 50, legacyTx: 5 }, monday, ['daily', 'weekly'], tz).snapshots;
  assert.equal(snapshots.meter.total_rx, 0);
  let rx = 1000;
  const daily = [];
  for (let day = 1; day <= 7; day++) {
    const now = monday + day * DAY;
    // Day 3 reboots the node: the boot counter drops to 1, the persisted counter keeps growing.
    const readings = [];
    for (let hour = 1; hour <= 24; hour += 6) { rx += 100 * day; readings.push({ timestamp: now - DAY + hour * 3600000, rx, tx: rx / 10 }); }
    const types = day === 7 ? ['daily', 'weekly'] : ['daily'];
    const result = updateMeteredTrafficSnapshots(snapshots, { readings, legacyRx: day === 3 ? 1 : 50 * day, legacyTx: 1 }, now, types, tz);
    daily.push(result.usage.daily.rx_bytes);
    snapshots = result.snapshots;
    if (day === 7) assert.equal(result.usage.weekly.rx_bytes, daily.reduce((sum, value) => sum + value, 0), 'weekly is the sum of the days');
  }
  assert.deepEqual(daily, [400, 800, 1200, 1600, 2000, 2400, 2800], 'day 3 reboot does not lose traffic');
});

test('I1-03 first run after the upgrade covers yesterday from history; old weekly/monthly snapshots use the old rule once', () => {
  const tz = 'UTC';
  const now = Date.UTC(2026, 10, 16, 12); // Monday
  const legacy = {
    daily: { time: (now - DAY) / 1000, rx_bytes: 9000, tx_bytes: 900 },
    weekly: { time: (now - 7 * DAY) / 1000, rx_bytes: 2000, tx_bytes: 200 }
  };
  const readings = [
    { timestamp: now - DAY - 1000, rx: 50, tx: 5 },        // before yesterday's report: ignored
    { timestamp: now - DAY + 60000, rx: 100, tx: 10 },     // baseline
    { timestamp: now - DAY / 2, rx: 400, tx: 40 },
    { timestamp: now - 60000, rx: 700, tx: 70 }
  ];
  const result = updateMeteredTrafficSnapshots(JSON.stringify(legacy), { readings, legacyRx: 12000, legacyTx: 1200 }, now, ['daily', 'weekly'], tz);
  assert.deepEqual(result.usage.daily, { rx_bytes: 600, tx_bytes: 60 });
  assert.deepEqual(result.usage.weekly, { rx_bytes: 10000, tx_bytes: 1000 }, 'legacy weekly snapshot: old boot-counter delta, once');
  assert.equal(result.snapshots.weekly.total_rx, 600);
  assert.equal(result.snapshots.meter.since, now - DAY);
});

test('I1-04 missed reports skip the daily line but the meter still counts for weekly totals', () => {
  const tz = 'UTC';
  const start = Date.UTC(2026, 10, 2, 12);
  let snapshots = updateMeteredTrafficSnapshots('{}', { readings: [{ timestamp: start - 1, rx: 100, tx: 10 }] }, start, ['daily', 'weekly'], tz).snapshots;
  const later = start + 7 * DAY;
  const result = updateMeteredTrafficSnapshots(snapshots, { readings: [{ timestamp: start + 3 * DAY, rx: 600, tx: 60 }, { timestamp: later - 1, rx: 900, tx: 90 }] }, later, ['daily', 'weekly'], tz);
  assert.equal(result.usage.daily, undefined, 'previous daily snapshot is a week old');
  assert.deepEqual(result.usage.weekly, { rx_bytes: 800, tx_bytes: 80 });
});

test('I1-05 real HTTP reports: a reboot mid-day no longer shrinks the daily report; agents without counters keep the old rule', async t => {
  const f = await controllerFixture(t);
  assert.equal((await f.admin({ action: 'save_settings', settings: {
    traffic_report_enabled: 'true', notification_timezone: 'UTC',
    notification_webhook_enabled: 'true', notification_webhook_url: `${f.hookBase}/hook`
  } })).status, 200);
  const metered = (await f.admin({ action: 'add', name: 'Metered' })).body.id;
  const legacy = (await f.admin({ action: 'add', name: 'Legacy' })).body.id;
  const day1 = Date.now() - 26 * 3600000;
  const day2 = day1 + DAY;
  const send = async (id, at, values) => assert.equal((await f.report(id, { cpu: 1, timestamp: at, ...values })).status, 200);
  await send(metered, day1 - 600000, { net_rx: 5 * MB, net_tx: MB, net_rx_monthly: 100 * MB, net_tx_monthly: 10 * MB });
  await send(legacy, day1 - 600000, { net_rx: 5 * MB, net_tx: MB });
  assert.equal(await checkTrafficReports(f.db, { now: day1 }), true);
  await send(metered, day1 + 3600000, { net_rx: 50 * MB, net_tx: 5 * MB, net_rx_monthly: 145 * MB, net_tx_monthly: 14 * MB });
  await send(metered, day1 + 12 * 3600000, { net_rx: MB, net_tx: 0.1 * MB, net_rx_monthly: 160 * MB, net_tx_monthly: 16 * MB }); // rebooted
  await send(metered, day2 - 600000, { net_rx: 21 * MB, net_tx: 2 * MB, net_rx_monthly: 180 * MB, net_tx_monthly: 18 * MB });
  await send(legacy, day2 - 600000, { net_rx: 30 * MB, net_tx: 3 * MB });
  f.db.prepare('DELETE FROM notification_outbox').run();
  assert.equal(await checkTrafficReports(f.db, { now: day2 }), true);
  const report = f.db.prepare('SELECT payload FROM notification_outbox').all().results.map(row => JSON.parse(row.payload)).find(row => row.context.event === '每日流量报告');
  assert.ok(report, 'daily report queued');
  assert.match(report.msg, /Metered {2}↓ 80\.0 MB \+ ↑ 8\.00 MB/, report.msg);
  assert.match(report.msg, /Legacy {2}↓ 25\.0 MB \+ ↑ 2\.00 MB/, report.msg);
});

// ------------------------------------------------------------------ #2 delivery confirmation
async function withFetch(handler, callback) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url: String(url), body: options?.body }); return handler(String(url), options); };
  try { return await callback(calls); } finally { globalThis.fetch = original; }
}
const json = (body, status = 200) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const send = (token, chatId = '') => sendNotification({ tg_bot_token: token, tg_chat_id: chatId }, 'probe', { event: '测试', clients: ['x'] });

test('I2-01 five channels are judged by their business code; configuration errors stop, busy codes retry', async () => {
  const FEISHU = 'https://open.feishu.cn/open-apis/bot/v2/hook/0f1e2d3c-aaaa-4bbb-8ccc-1234567890ab';
  const DING = 'https://oapi.dingtalk.com/robot/send?access_token=deadbeefdeadbeefdeadbeef';
  const WECOM = 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=11112222-3333-4444-5555-666677778888';
  const SCT = 'https://sctapi.ftqq.com/SCTabcdefghijklmnopqrstuvwxyz.send';
  const WXP = 'https://wxpusher.zjiecode.com/api/send/message/SPT_abcdefghijklmnop';
  const cases = [
    [FEISHU, json({ code: 0, msg: 'success' }), 'delivered'],
    [FEISHU, json({ StatusCode: 0, StatusMessage: 'success' }), 'delivered'],
    [FEISHU, json({ code: 19001, data: {}, msg: 'param invalid: incoming webhook access token invalid' }), 'permanent', /19001/],
    [FEISHU, json({ code: 19024, msg: 'Key Words Not Found' }), 'permanent', /19024/],
    [FEISHU, json({ code: 11232, msg: 'frequency limited' }), 'retry', /11232/],
    [FEISHU, new Response('<html>gateway</html>', { status: 200 }), 'retry', /无效的响应/],
    [DING, json({ errcode: 0, errmsg: 'ok' }), 'delivered'],
    [DING, json({ errcode: 300005, errmsg: 'token is not exist' }), 'permanent', /300005/],
    [DING, json({ errcode: 400102, errmsg: '机器人已停用' }), 'permanent'],
    [DING, json({ errcode: 310000, errmsg: 'keywords not in content' }), 'permanent'],
    [DING, json({ errcode: 410100, errmsg: '发送速度太快而限流' }), 'retry'],
    [DING, json({ errcode: -1, errmsg: '系统繁忙' }), 'retry'],
    [WECOM, json({ errcode: 0, errmsg: 'ok' }), 'delivered'],
    [WECOM, json({ errcode: 93000, errmsg: 'invalid webhook url, hint: [x]' }), 'permanent', /93000/],
    [WECOM, json({ errcode: 45009, errmsg: 'api freq out of limit' }), 'retry'],
    [SCT, json({ code: 0, message: '', data: { pushid: '1' } }), 'delivered'],
    [SCT, json({ message: '[AUTH]错误的Key', code: 40001, info: '错误的Key', scode: 461 }, 400), 'permanent', /40001 \[AUTH\]错误的Key/],
    [WXP, json({ code: 1000, msg: '处理成功', success: true, data: [{ code: 1000, status: '创建发送任务成功' }] }), 'delivered'],
    [WXP, json({ code: 1001, msg: '用户不存在，请检查你的SPT', data: null, success: false }), 'permanent', /1001 用户不存在/],
    [WXP, json({ code: 1000, success: true, data: [{ code: 1001, status: '用户已取消关注' }] }), 'permanent', /1001 用户已取消关注/]
  ];
  for (const [token, response, expected, reason] of cases) {
    const result = await withFetch(() => response.clone(), () => send(token));
    const label = `${new URL(token).hostname} ${expected} ${result.error || ''}`;
    if (expected === 'delivered') assert.deepEqual(result, { status: 'delivered' }, label);
    else {
      assert.equal(result.status, 'failed', label);
      assert.equal(result.permanent === true, expected === 'permanent', label);
      if (reason) assert.match(result.error, reason, label);
    }
  }
});

test('I2-02 Telegram and HTTP-level credential rejections stop; secrets never reach the stored reason', async () => {
  const tg = 'telegram-token-1234567890:ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let result = await withFetch(() => json({ ok: false, error_code: 401, description: 'Unauthorized: invalid token specified' }, 401), () => send(tg, '42'));
  assert.equal(result.permanent, true); assert.match(result.error, /HTTP 401 Unauthorized/);
  result = await withFetch(() => json({ ok: false, error_code: 400, description: 'Bad Request: chat not found' }, 400), () => send(tg, '42'));
  assert.equal(result.permanent, true); assert.match(result.error, /chat not found/);
  result = await withFetch(() => json({ ok: true, result: {} }), () => send(tg, '42'));
  assert.deepEqual(result, { status: 'delivered' });
  result = await withFetch(() => json({}, 403), () => send('bark:https://api.day.app/BARKDEVICEKEY123456'));
  assert.equal(result.permanent, true);
  assert.equal((await withFetch(() => json({}), () => send('mystery-token'))).permanent, true, 'unknown channel is a configuration error');
  const echoed = 'deadbeefdeadbeefdeadbeef';
  result = await withFetch(() => json({ errcode: 300005, errmsg: `token ${echoed} is not exist` }), () => send(`https://oapi.dingtalk.com/robot/send?access_token=${echoed}`));
  assert.ok(!result.error.includes(echoed), result.error);
  assert.match(result.error, /\*\*\*/);
});

test('I2-03 server errors and rate limits are retried within the attempt, then by the outbox', async () => {
  let attempts = 0;
  const result = await withFetch(() => { attempts++; return new Response('busy', { status: 503 }); }, () => send('https://sctapi.ftqq.com/SCTabcdefghijklmnopq.send'));
  assert.equal(attempts, 3);
  assert.equal(result.status, 'failed');
  assert.equal(result.permanent, undefined);
  assert.match(result.error, /HTTP 503 busy/);
});

test('I2-04 outbox stops a rejected configuration, shows the reason, and resends after the configuration changes', async t => {
  const f = await controllerFixture(t);
  const hook = token => `${f.hookBase}/open.feishu.cn/open-apis/bot/v2/hook/${token}`;
  f.replies.push({ status: 200, body: JSON.stringify({ code: 19001, data: {}, msg: 'param invalid: incoming webhook access token invalid' }) });
  assert.equal((await f.admin({ action: 'save_settings', settings: { tg_bot_token: hook('wrong-0000-1111-2222-333344445555') } })).status, 200);
  const now = Date.now();
  enqueueNotification(f.db, 'offline A', { event: '节点离线告警' }, now - 60000);
  enqueueNotification(f.db, 'offline B', { event: '节点离线告警' }, now - 25 * 3600000); // already stale
  await drainNotifications(f.db, { now });
  assert.equal(f.requests.length, 1);
  const stopped = f.db.prepare('SELECT * FROM notification_outbox ORDER BY id').all().results[0];
  assert.ok(stopped.failed_at, 'stopped');
  assert.match(stopped.last_error, /^飞书通知发送失败: code 19001 param invalid/);
  assert.ok(!stopped.last_error.includes('wrong-0000-1111-2222-333344445555'));
  await drainNotifications(f.db, { now: now + 2 * 3600000 });
  assert.equal(f.requests.length, 1, 'no further retries with the same configuration');
  const settings = (await f.admin({ action: 'get_settings' })).body;
  assert.equal(settings.notification_delivery_issue.stopped, 1);
  assert.match(settings.notification_delivery_issue.error, /19001/);

  // Saving unrelated settings does not resend; fixing the address does.
  assert.equal((await f.admin({ action: 'save_settings', settings: { site_title: 'renamed' } })).status, 200);
  assert.ok(f.db.prepare('SELECT failed_at FROM notification_outbox WHERE id=?').bind(stopped.id).first().failed_at);
  f.replies.length = 0; f.replies.push({ status: 200, body: JSON.stringify({ code: 0, msg: 'success' }) });
  assert.equal((await f.admin({ action: 'save_settings', settings: { tg_bot_token: hook('fixed-0000-1111-2222-333344445555') } })).status, 200);
  await drainNotifications(f.db);
  assert.equal(f.requests.length, 2);
  assert.match(f.requests[1].url, /fixed-0000/);
  assert.ok(f.db.prepare('SELECT delivered_at FROM notification_outbox WHERE id=?').bind(stopped.id).first().delivered_at);
  assert.equal((await f.admin({ action: 'get_settings' })).body.notification_delivery_issue, null, 'a later delivery clears the notice');

  // Stopped rows older than 24 hours are not resent and are cleaned after 7 days.
  enqueueNotification(f.db, 'old', {}, now - 30 * 3600000);
  const old = f.db.prepare('SELECT max(id) AS id FROM notification_outbox').first().id;
  f.db.prepare('UPDATE notification_outbox SET failed_at=?, last_error=? WHERE id=?').bind(now - 29 * 3600000, 'x', old).run();
  assert.equal(requeueStoppedNotifications(f.db, now), 0);
  cleanupHistory(f.db, now);
  assert.ok(f.db.prepare('SELECT id FROM notification_outbox WHERE id=?').bind(old).first(), 'kept with its reason');
  cleanupHistory(f.db, now + 8 * DAY);
  assert.equal(f.db.prepare('SELECT id FROM notification_outbox WHERE id=?').bind(old).first(), null);
  assert.equal(getNotificationDeliveryIssue(f.db), null);
});
