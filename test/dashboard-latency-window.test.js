import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase, saveMetricsHistory, getDashboardLatencyHistory, clearDashboardLatencyHistoryCache, clearHistory } from '../src/database/schema.js';
test('two-hour latency window has 20 buckets and preserves gaps', async t => {
  clearDashboardLatencyHistoryCache();const db=new SQLiteDatabase();t.after(()=>db.close());await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('a').run();
  const now=Date.now();const interval=360000;const start=Math.floor(now/interval)*interval-19*interval;
  for(const i of [0,5,19]) await saveMetricsHistory(db,'a',{ping_ct:i+20,loss_ct:0},'',start+i*interval+1000);
  const window=(await getDashboardLatencyHistory(db,[{id:'a'}],{now,cache:false})).get('a');
  assert.equal(window.ping.length,20);assert.equal(window.ping[0].ct,20);assert.equal(window.ping[1].ct,undefined);assert.equal(window.ping[5].ct,25);
  assert.equal(window.ping[0].sample_ts,start+1000);
});
test('new persisted samples invalidate cached latency immediately', async t => {
  clearDashboardLatencyHistoryCache();const db=new SQLiteDatabase();t.after(()=>db.close());await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('cache').run();const now=Date.now();
  await saveMetricsHistory(db,'cache',{ping_ct:30,loss_ct:0},'',now-1000);
  assert.equal((await getDashboardLatencyHistory(db,[{id:'cache'}],{now})).get('cache').ping.at(-1).ct,30);
  await saveMetricsHistory(db,'cache',{ping_ct:90,loss_ct:0},'',now);
  assert.equal((await getDashboardLatencyHistory(db,[{id:'cache'}],{now})).get('cache').ping.at(-1).ct,90);
  assert.ok((await getDashboardLatencyHistory(db,[{id:'cache'}],{now:now+240000})).get('cache').ping.some(point=>point.ct===90));
  const result=(await getDashboardLatencyHistory(db,[{id:'cache'}],{now:now+360000})).get('cache');assert.ok(result.ping.some(point=>point.ct===90));
});

test('first sample replaces cached empty history and clear history removes cached buckets', async t => {
  const db = new SQLiteDatabase(); t.after(() => db.close()); await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('empty').run();
  const now = Date.now();
  const read = async () => (await getDashboardLatencyHistory(db, [{ id: 'empty' }], { now })).get('empty');
  assert.equal((await read()).ping.at(-1).ct, undefined);
  await saveMetricsHistory(db, 'empty', { ping_ct: 306, loss_ct: 0 }, '', now);
  const latest = await read();
  assert.equal(latest.ping.at(-1).ct, 306);
  assert.equal(latest.ping.at(-1).sample_ts, now);
  assert.equal(latest.loss.at(-1).ct, 0);
  assert.strictEqual(await read(), latest, 'unchanged histories still share the cache');
  await clearHistory(db);
  assert.ok((await read()).ping.every(point => point.ct === undefined));
  assert.equal(db.prepare('SELECT count(*) n FROM server_latest').first().n, 1);
});

test('latency cache is isolated between databases and sampling resolutions', async t => {
  const first = new SQLiteDatabase(); const second = new SQLiteDatabase();
  t.after(() => { first.close(); second.close(); });
  for (const db of [first, second]) {
    await initDatabase(db);
    db.prepare('INSERT INTO servers(id) VALUES (?)').bind('same-id').run();
  }
  const now = Date.now();
  await saveMetricsHistory(first, 'same-id', { ping_ct: 80 }, '', now - 1000);
  const servers = [{ id: 'same-id' }];
  assert.equal((await getDashboardLatencyHistory(first, servers, { now })).get('same-id').ping.at(-1).ct, 80);
  assert.equal((await getDashboardLatencyHistory(first, servers, { now, points: 10 })).get('same-id').ping.length, 10);
  assert.equal((await getDashboardLatencyHistory(second, servers, { now })).get('same-id').ping.at(-1).ct, undefined);
});

test('idle latency cache expires and does not keep samples past two hours', async t => {
  const db = new SQLiteDatabase(); t.after(() => db.close()); await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('idle').run();
  const now = Date.now();
  const start = Math.floor(now / 360000) * 360000 - 19 * 360000;
  await saveMetricsHistory(db, 'idle', { ping_ct: 40 }, '', start + 1000);
  const servers = [{ id: 'idle' }];
  assert.ok((await getDashboardLatencyHistory(db, servers, { now })).get('idle').ping.some(point => point.ct === 40));
  assert.ok((await getDashboardLatencyHistory(db, servers, { now: now + 360000 })).get('idle').ping.every(point => point.ct === undefined));
});

test('REST refreshes preserve bucket boundaries and crossing a boundary invalidates the cache', async t => {
  const db = new SQLiteDatabase(); t.after(() => db.close()); await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('grid').run();
  const boundary = Math.floor(Date.now() / 360000) * 360000;
  await saveMetricsHistory(db, 'grid', { ping_ct: 180, loss_ct: 0 }, '', boundary - 1000);
  const servers = [{ id: 'grid' }];
  const before = (await getDashboardLatencyHistory(db, servers, { now: boundary - 500 })).get('grid');
  assert.equal(before.ping.at(-1).ct, 180);
  const next = (await getDashboardLatencyHistory(db, servers, { now: boundary })).get('grid');
  assert.equal(next.ping[18].ct, 180);
  assert.equal(next.ping[19].ct, undefined);
  const refreshed = (await getDashboardLatencyHistory(db, servers, { now: boundary + 10000, cache: false })).get('grid');
  assert.deepEqual(refreshed, next);
});
