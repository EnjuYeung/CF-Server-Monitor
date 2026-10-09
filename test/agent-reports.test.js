import assert from 'node:assert/strict';
import test from 'node:test';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase, getLatestMetrics } from '../src/database/schema.js';
import { AgentReports, AgentReportsClosed, InvalidAgentReport } from '../src/services/agentReports.js';
import { clearAllCaches } from '../src/utils/cache.js';

async function fixture(t, publish = () => {}) {
  clearAllCaches();
  const db = new SQLiteDatabase();
  await initDatabase(db);
  for (const id of ['a', 'b']) db.prepare('INSERT INTO servers(id,name) VALUES (?,?)').bind(id, id).run();
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const published = [];
  const reports = new AgentReports(db, async (updates, reportTs) => {
    published.push({ updates, reportTs, historyRows: rows().length });
    await publish(updates, reportTs);
  });
  const rows = () => db.prepare('SELECT * FROM metrics_history ORDER BY timestamp').all().results;
  t.after(async () => {
    try { await reports.close(); } finally { db.close(); clearAllCaches(); }
  });
  return { db, reports, rows, published, now: () => now, advance: ms => { now += ms; } };
}

for (const transport of ['http', 'ws']) {
  test(`IR01 ${transport} preserves receipt, publication and persistence ordering`, async t => {
    const { db, reports, rows, published, now } = await fixture(t);
    const sampleTs = now() - 120000;
    const result = await reports.receive('a', { metrics: { cpu: 27, timestamp: sampleTs } }, { transport });
    assert.equal(result.persisted, true);
    assert.equal(published[0].historyRows, transport === 'http' ? 1 : 0);
    assert.equal(rows()[0].timestamp, sampleTs);
    assert.equal(reports.lastSeen('a'), now());
    assert.equal(db.prepare('SELECT last_seen FROM server_presence WHERE server_id=?').bind('a').first().last_seen, now());
    assert.equal(reports.latestUpdates(['a'])[0].samples[0].ts, sampleTs);
  });
}

test('IR02 metrics, samples and batch reports preserve normalization and metadata', async t => {
  const { reports, rows, published, now, advance } = await fixture(t);
  for (const field of ['metrics', 'samples', 'batch']) {
    const metrics = { cpu: 25, timestamp: now(), ip_v4: '8.8.8.8' };
    const data = field === 'metrics' ? { metrics } : { metrics: { os: 'Linux' }, [field]: [{ ts: now() / 1000, data: metrics }] };
    await reports.receive('a', data, { regionCode: 'CN', agentVersion: '1.3.0' });
    advance(1000);
  }
  assert.equal(rows().length, 3);
  assert.ok(rows().every(row => row.cpu === 25 && row.region === 'CN' && row.agent_version === '1.3.0'));
  assert.equal(rows().at(-1).os, 'Linux');
  assert.equal(published[2].updates[0].samples[0].payload.os, undefined);
  assert.equal(rows().at(-1).ip_v4, '8.8.8.8');
  assert.equal(reports.latestUpdates(['a'])[0].samples[0].payload.ip_v4, undefined);
});

test('IR03 invalid reports have no side effects and timestamp boundaries remain inclusive', async t => {
  const { reports, rows, published, now } = await fixture(t);
  for (const data of [null, [], {}, { metrics: [] }, { samples: [null] },
    { metrics: { cpu: 1, timestamp: now() + 60001 } },
    { metrics: { cpu: 1, timestamp: now() - 7 * 86400000 - 1 } }]) {
    await assert.rejects(reports.receive('a', data), InvalidAgentReport);
  }
  assert.equal(rows().length, 0);
  assert.equal(published.length, 0);
  assert.equal(reports.lastSeen('a'), 0);
  for (const timestamp of [now() - 7 * 86400000, now() + 60000]) {
    await reports.receive('a', { metrics: { cpu: 1, timestamp } });
  }
  assert.equal(rows().length, 2);
});

test('IR04 history aggregates the latest 300 sorted samples while replay retains sample values', async t => {
  const { reports, rows, published, now } = await fixture(t);
  const samples = Array.from({ length: 305 }, (_, index) => ({
    ts: now() - 305000 + index * 1000,
    metrics: { cpu: index, net_in_speed: 305 - index, disk: { read_bps: index } }
  })).reverse();
  await reports.receive('a', { samples });
  const row = rows()[0];
  assert.equal(row.cpu, 154.5);
  assert.equal(row.net_in_speed, 300);
  assert.equal(row.disk_read_bps, 304);
  const replay = published[0].updates[0].samples;
  assert.equal(replay.length, 300);
  assert.equal(replay[0].payload.cpu, 5);
  assert.equal(replay.at(-1).payload.cpu, 304);
  assert.ok(replay.every((sample, index) => index === 0 || sample.ts > replay[index - 1].ts));
});

for (const transport of ['http', 'ws']) {
  test(`IR05 ${transport} failed transactions never confirm persistence and preserve retry behavior`, async t => {
    const { db, reports, rows, published, now, advance } = await fixture(t);
    db.exec("CREATE TRIGGER fail_report BEFORE INSERT ON server_latest BEGIN SELECT RAISE(ABORT,'disk failed'); END");
    try {
      await assert.rejects(reports.receive('a', { metrics: { cpu: 10, net_in_speed: 90, timestamp: now() } }, { transport }), /disk failed/);
      assert.equal(rows().length, 0);
      assert.equal(await getLatestMetrics(db, 'a'), null);
      assert.equal(published.length, transport === 'http' ? 0 : 1);
      assert.equal(reports.lastSeen('a'), transport === 'http' ? 0 : now());
    } finally {
      db.exec('DROP TRIGGER fail_report');
    }
    advance(1000);
    assert.equal((await reports.receive('a', { metrics: { cpu: 30, net_in_speed: 20, timestamp: now() } }, { transport })).persisted, true);
    assert.equal(rows()[0].cpu, transport === 'http' ? 30 : 20);
    assert.equal(rows()[0].net_in_speed, transport === 'http' ? 20 : 90);
  });
}

test('IR06 WS history window belongs to the node, uses successful write time and is independent of HTTP', async t => {
  const { reports, rows, now, advance } = await fixture(t);
  const ws = { transport: 'ws', reportIntervalMs: 60000 };
  await reports.receive('a', { metrics: { cpu: 10, timestamp: now() - 120000 } }, ws);
  advance(1000);
  const pending = await reports.receive('a', { metrics: { cpu: 40, timestamp: now() } }, ws);
  assert.deepEqual(pending, { persisted: false, nextWriteAfterMs: 59000 });
  await reports.receive('a', { metrics: { cpu: 20, timestamp: now() + 1 } });
  advance(59000);
  const due = await reports.receive('a', { metrics: { cpu: 80, timestamp: now() } }, { ...ws });
  assert.deepEqual(due, { persisted: true, nextWriteAfterMs: 60000 });
  assert.deepEqual(rows().map(row => row.cpu), [10, 20, 60]);
  assert.equal(reports.lastSeen('a'), now());
});

test('IR07 clearing history discards the pending window but keeps latest state, receipt, replay and write interval', async t => {
  const { reports, rows, db, now, advance } = await fixture(t);
  const options = { transport: 'ws', reportIntervalMs: 60000 };
  await reports.receive('a', { metrics: { cpu: 10, timestamp: now() } }, options);
  advance(1000);
  await reports.receive('a', { metrics: { cpu: 90, timestamp: now() } }, options);
  await reports.clearHistory();
  assert.equal(rows().length, 0);
  assert.equal((await getLatestMetrics(db, 'a')).cpu, 10);
  assert.equal(reports.lastSeen('a'), now());
  assert.equal(reports.latestUpdates(['a'])[0].samples[0].payload.cpu, 90);
  advance(1000);
  assert.equal((await reports.receive('a', { metrics: { cpu: 20, timestamp: now() } }, options)).persisted, false);
  await reports.close();
  assert.deepEqual(rows().map(row => row.cpu), [20]);
});

test('IR08 removing and recreating a node cannot restore its pending history or replay', async t => {
  const { db, reports, rows, now, advance } = await fixture(t);
  const options = { transport: 'ws', reportIntervalMs: 60000 };
  await reports.receive('a', { metrics: { cpu: 10, timestamp: now() } }, options);
  advance(1000);
  await reports.receive('a', { metrics: { cpu: 90, timestamp: now() } }, options);
  db.prepare('DELETE FROM servers WHERE id=?').bind('a').run();
  reports.removeServer('a');
  db.prepare('INSERT INTO servers(id,name) VALUES (?,?)').bind('a', 'replacement').run();
  assert.deepEqual(reports.latestUpdates(['a']), []);
  assert.equal(reports.lastSeen('a'), 0);
  assert.equal((await reports.receive('a', { metrics: { cpu: 20, timestamp: now() } }, options)).persisted, true);
  await reports.close();
  assert.deepEqual(rows().map(row => row.cpu), [20]);
});

test('IR09 shutdown waits for accepted reports then flushes the complete pending history window', async t => {
  let release;
  let started;
  const publishing = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  let shouldBlock = false;
  const { reports, rows, now, advance } = await fixture(t, async () => {
    if (shouldBlock) { started(); await blocked; }
  });
  const options = { transport: 'ws', reportIntervalMs: 60000 };
  await reports.receive('a', { metrics: { cpu: 10, timestamp: now() } }, options);
  advance(1000);
  await reports.receive('a', { metrics: { cpu: 40, net_in_speed: 90, timestamp: now() } }, options);
  advance(1000);
  shouldBlock = true;
  const receiving = reports.receive('a', { metrics: { cpu: 80, net_in_speed: 20, timestamp: now() } }, options);
  await publishing;
  let closed = false;
  const closing = reports.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  release();
  await receiving;
  await closing;
  assert.deepEqual(rows().map(row => row.cpu), [10, 60]);
  assert.equal(rows().at(-1).net_in_speed, 90);
});

for (const action of ['clear', 'remove']) {
  test(`IR10 ${action} during a failed write cannot resurrect a discarded window`, async t => {
    const { db, reports, rows, now } = await fixture(t);
    db.exec("CREATE TRIGGER fail_report BEFORE INSERT ON server_latest BEGIN SELECT RAISE(ABORT,'disk failed'); END");
    const batch = db.batch.bind(db);
    const failure = t.mock.method(db, 'batch', statements => {
      try { return batch(statements); }
      catch (error) {
        if (action === 'clear') reports.clearHistory();
        else {
          db.prepare('DELETE FROM servers WHERE id=?').bind('a').run();
          reports.removeServer('a');
          db.prepare('INSERT INTO servers(id,name) VALUES (?,?)').bind('a', 'replacement').run();
        }
        throw error;
      }
    });
    try {
      await assert.rejects(reports.receive('a', { metrics: { cpu: 90, timestamp: now() } }, { transport: 'ws' }), /disk failed/);
    }
    finally { db.exec('DROP TRIGGER fail_report'); }
    failure.mock.restore();
    await reports.close();
    assert.equal(rows().length, 0);
  });
}

test('IR12 shutdown waits for an accepted HTTP report and rejects later reports', async t => {
  let release;
  let started;
  const publishing = new Promise(resolve => { started = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const { reports, rows, now } = await fixture(t, async () => { started(); await blocked; });
  const receiving = reports.receive('a', { metrics: { cpu: 25, timestamp: now() } });
  await publishing;
  let closed = false;
  const closing = reports.close().then(() => { closed = true; });
  await assert.rejects(reports.receive('b', { metrics: { cpu: 90 } }), AgentReportsClosed);
  await assert.rejects(reports.ingest('b', [{ ts: now(), data: { cpu: 90 } }]), AgentReportsClosed);
  assert.equal(closed, false);
  release();
  assert.equal((await receiving).persisted, true);
  await closing;
  assert.deepEqual(rows().map(row => [row.server_id, row.cpu]), [['a', 25]]);
});

for (const action of ['clear', 'remove']) {
  test(`IR11 ${action} while publication awaits invalidates the old report before history writing`, async t => {
    let release;
    let started;
    const publishing = new Promise(resolve => { started = resolve; });
    const blocked = new Promise(resolve => { release = resolve; });
    const { db, reports, rows, now } = await fixture(t, async () => { started(); await blocked; });
    const receiving = reports.receive('a', { metrics: { cpu: 90, timestamp: now() } }, { transport: 'ws' });
    await publishing;
    if (action === 'clear') await reports.clearHistory();
    else {
      db.prepare('DELETE FROM servers WHERE id=?').bind('a').run();
      reports.removeServer('a');
      db.prepare('INSERT INTO servers(id,name) VALUES (?,?)').bind('a', 'replacement').run();
    }
    release();
    assert.equal((await receiving).persisted, false);
    await reports.close();
    assert.equal(rows().length, 0);
    if (action === 'remove') {
      assert.equal(reports.lastSeen('a'), 0);
      assert.deepEqual(reports.latestUpdates(['a']), []);
    }
  });
}
