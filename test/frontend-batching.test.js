import assert from 'node:assert/strict';
import test from 'node:test';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase } from '../src/database/schema.js';
import { RealtimeHub } from '../src/realtime/RealtimeHub.js';
import { clearAllCaches } from '../src/utils/cache.js';

async function fixture(t) {
  clearAllCaches();
  const db = new SQLiteDatabase();
  await initDatabase(db);
  for (const id of ['a', 'b']) db.prepare('INSERT INTO servers(id,name) VALUES (?,?)').bind(id, id).run();
  const hub = new RealtimeHub({ DB: db });
  const viewer = (scope = 'all', ids = ['a', 'b'], isAdmin = true) => {
    const ws = {
      context: { scope, serverIds: ids, isAdmin }, messages: [],
      getContext() { return this.context; },
      send(raw) { this.messages.push(JSON.parse(raw)); },
      close() { hub.frontendSockets.delete(this); }
    };
    hub.frontendSockets.add(ws);
    return ws;
  };
  t.after(async () => { await hub.close(); db.close(); clearAllCaches(); });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  return { db, hub, viewer };
}

test('homepage batches for 250ms while details and authenticated presence update immediately', async t => {
  const { db, hub, viewer } = await fixture(t);
  const homepages = Array.from({ length: 10 }, () => viewer());
  const detail = viewer('a', ['a']);
  const reportTs = Date.now();
  const first = [{ts: reportTs - 1000, data: {cpu: 10, ip_v4: '8.8.8.8'}}];
  await hub.ingest('a', first, reportTs);
  await hub.ingest('b', [{ts: reportTs, data: {cpu: 20}}], reportTs + 5);
  assert.ok(homepages.every(ws => ws.messages.length === 0));
  assert.equal(detail.messages.length, 1);
  assert.equal(db.prepare('SELECT last_seen FROM server_presence WHERE server_id=?').bind('a').first().last_seen, reportTs);
  t.mock.timers.tick(249);
  assert.ok(homepages.every(ws => ws.messages.length === 0));
  t.mock.timers.tick(1);
  for (const ws of homepages) {
    assert.equal(ws.messages.length, 1);
    assert.equal(ws.messages[0].ts, reportTs + 5);
    assert.deepEqual(ws.messages[0].updates.map(update => [update.serverId, update.reportTs]), [['a', reportTs], ['b', reportTs + 5]]);
    assert.equal(ws.messages[0].updates[0].samples[0].ts, first[0].ts);
    assert.equal(ws.messages[0].updates[0].samples[0].data.ip_v4, '1');
  }
  assert.equal(first[0].data.ip_v4, '8.8.8.8');
  assert.equal(detail.messages.length, 1);
});

test('replay bursts flush early instead of discarding samples or growing the queue', async t => {
  const { hub, viewer } = await fixture(t);
  const homepage = viewer();
  const now = Date.now();
  const samples = Array.from({length: 450}, (_, index) => ({ts: now + index, data: {cpu: index}}));
  for (let offset = 0; offset < samples.length; offset += 75) await hub.ingest('a', samples.slice(offset, offset + 75));
  assert.equal(homepage.messages.length, 1);
  assert.equal(homepage.messages[0].updates[0].samples.length, 300);
  t.mock.timers.tick(250);
  assert.equal(homepage.messages.length, 2);
  assert.deepEqual(homepage.messages.flatMap(message => message.updates.flatMap(update => update.samples)), samples);
});

test('queued updates use current subscriptions, visibility and session expiry', async t => {
  const { db, hub, viewer } = await fixture(t);
  const anonymous = viewer('all', ['a', 'b'], false);
  const admin = viewer();
  const expired = viewer();
  const switched = viewer();
  const now = Date.now();
  for (const id of ['a', 'b']) await hub.ingest(id, [{ts: now, data: {cpu: 10}}]);
  db.prepare("UPDATE servers SET is_hidden='1' WHERE id='a'").run();
  expired.context.expiresAt = Date.now() - 1;
  switched.context.serverIds = ['b'];
  t.mock.timers.tick(250);
  assert.deepEqual(anonymous.messages[0].updates.map(update => update.serverId), ['b']);
  assert.deepEqual(admin.messages[0].updates.map(update => update.serverId), ['a', 'b']);
  assert.deepEqual(switched.messages[0].updates.map(update => update.serverId), ['b']);
  assert.equal(expired.messages.length, 0);
});

test('deleted and re-created server cannot replay its previous queued data', async t => {
  const { db, hub, viewer } = await fixture(t);
  viewer();
  await hub.ingest('a', [{ts: Date.now(), data: {cpu: 10}}]);
  db.prepare("DELETE FROM servers WHERE id='a'").run();
  hub.removeServer('a');
  db.prepare("INSERT INTO servers(id,name) VALUES ('a','replacement')").run();
  const replacementViewer = viewer();
  t.mock.timers.tick(250);
  assert.equal(replacementViewer.messages.length, 0);
  assert.deepEqual(hub.reports.latestUpdates(['a']), []);
});

test('shutdown delivers the pending homepage batch and leaves no later broadcast', async t => {
  const { hub, viewer } = await fixture(t);
  const homepage = viewer();
  await hub.ingest('a', [{ts: Date.now(), data: {cpu: 10}}]);
  assert.equal(homepage.messages.length, 0);
  await hub.close();
  assert.equal(homepage.messages.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(homepage.messages.length, 1);
});

test('deletion during alert processing cannot deliver an old report to a recreated node', async t => {
  const { db, hub, viewer } = await fixture(t);
  let release;
  let started;
  const ingesting = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  t.mock.method(hub.resourceAlerts, 'ingest', async () => { started(); await blocked; });
  const receiving = hub.reports.receive('a', { metrics: { cpu: 77, timestamp: Date.now() } }, { transport: 'ws' });
  await ingesting;
  db.prepare("DELETE FROM servers WHERE id='a'").run();
  hub.removeServer('a');
  db.prepare("INSERT INTO servers(id,name) VALUES ('a','replacement')").run();
  const homepage = viewer();
  const detail = viewer('a', ['a']);
  release();
  assert.equal((await receiving).persisted, false);
  t.mock.timers.tick(250);
  assert.equal(homepage.messages.length, 0);
  assert.equal(detail.messages.length, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM metrics_history').first().n, 0);
  assert.equal(hub.reports.lastSeen('a'), 0);
  assert.deepEqual(hub.reports.latestUpdates(['a']), []);
});

test('details receive every report immediately without homepage subscribers', async t => {
  const { hub, viewer } = await fixture(t);
  const detail = viewer('a', ['a']);
  for (const cpu of [10, 20]) await hub.ingest('a', [{ts: Date.now() + cpu, data: {cpu}}]);
  assert.deepEqual(detail.messages.map(message => message.updates[0].samples[0].data.cpu), [10, 20]);
  t.mock.timers.tick(1000);
  assert.equal(detail.messages.length, 2);
});

test('a database read failure during delayed broadcast does not crash the timer or leak data', async t => {
  const { db, hub, viewer } = await fixture(t);
  const homepage = viewer();
  const errors = [];
  t.mock.method(console, 'error', (...args) => errors.push(args));
  await hub.ingest('a', [{ts: Date.now(), data: {cpu: 10}}]);
  db.exec('ALTER TABLE servers RENAME TO unavailable_servers');
  try {
    assert.doesNotThrow(() => t.mock.timers.tick(250));
    assert.equal(homepage.messages.length, 0);
    assert.equal(errors.length, 1);
  } finally {
    db.exec('ALTER TABLE unavailable_servers RENAME TO servers');
  }
  await hub.ingest('a', [{ts: Date.now() + 1, data: {cpu: 20}}]);
  t.mock.timers.tick(250);
  assert.equal(homepage.messages.length, 1);
  assert.equal(homepage.messages[0].updates[0].samples[0].data.cpu, 20);
});
