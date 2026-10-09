import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase, saveMetricsHistory, getMetricsHistory, getLatestMetrics, cleanupHistory } from '../src/database/schema.js';
import { clearAllCaches } from '../src/utils/cache.js';
async function fixture(t) {
  clearAllCaches(); const db = new SQLiteDatabase(); await initDatabase(db); t.after(()=>db.close());
  for (const id of ['a','b']) db.prepare('INSERT INTO servers(id,name,timestamp) VALUES (?,?,?)').bind(id,id,Date.now()-7*86400000).run();
  return db;
}
test('same timestamp is isolated per server and retry is idempotent', async t => {
  const db=await fixture(t);const now=Date.now();
  await saveMetricsHistory(db,'a',{cpu:11},'',now);await saveMetricsHistory(db,'b',{cpu:22},'',now);await saveMetricsHistory(db,'a',{cpu:12},'',now);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metrics_history').first().n,2);
  assert.equal((await getLatestMetrics(db,'a')).cpu,12);assert.equal((await getLatestMetrics(db,'b')).cpu,22);
});
test('long history uses server-time index and bounded sampling', async t => {
  const db=await fixture(t);const now=Date.now();
  for(let i=0;i<360;i++) await saveMetricsHistory(db,'a',{cpu:i%100},'',now-i*60000);
  const rows=await getMetricsHistory(db,'a',6,'cpu',null,60);
  assert.ok(rows.length<=60);assert.ok(rows.length>=59);
  assert.ok(rows.every((row,i)=>i===0 || row.timestamp>rows[i-1].timestamp));
  const plan=db.prepare('EXPLAIN QUERY PLAN SELECT * FROM metrics_history WHERE server_id=? AND timestamp>=?').bind('a',now-3600000).all().results;
  assert.match(JSON.stringify(plan),/idx_history_server_time/);
});
test('long history keeps the last complete row, empty buckets and inclusive boundaries', async t => {
  const now = Date.UTC(2026, 8, 30, 12);
  t.mock.method(Date, 'now', () => now);
  const db = await fixture(t);
  const start = now - 6 * 3600000;
  const interval = 360001;
  const gpu = '[{"name":"测试 GPU","memory_used":128}]';
  const insert = db.prepare('INSERT INTO metrics_history(server_id,timestamp,cpu,loss_ct,ping_ct,gpu_info,disk_read_bps) VALUES (?,?,?,?,?,?,?)');
  for (const [timestamp, cpu, loss, ping, disk] of [
    [start - 1, 99, 100, 999, 999],
    [start, 1, 100, 10, 1],
    [start + interval - 1, 2, 0, 20, 64],
    [start + interval, 3, 'false', 'false', null],
    [start + 4 * interval - 1, 4, null, null, null],
    [now, 5, 100, 0, null],
    [now + 0.5, 99, 100, 999, 999],
    [now + 1, 99, 100, 999, 999]
  ]) insert.bind('a', timestamp, cpu, loss, ping, gpu, disk).run();
  insert.bind('b', now, 99, 100, 999, gpu, 999).run();
  const rows = await getMetricsHistory(db, 'a', 6, 'id,server_id,cpu,loss_ct,ping_ct,gpu_info,disk_read_bps', null, 60);
  assert.deepEqual(rows.map(row => row.timestamp), [start + interval - 1, start + interval, start + 4 * interval - 1, now]);
  assert.deepEqual(rows.map(row => row.cpu), [2, 3, 4, 5]);
  assert.deepEqual(rows.map(row => row.loss_ct), [0, false, null, 100]);
  assert.deepEqual(rows.map(row => row.ping_ct), [20, false, null, 0]);
  assert.ok(rows.every(row => row.server_id === 'a' && row.gpu_info === gpu && Number.isInteger(row.id)));
  assert.equal(rows[0].disk.read_bps, 64);
  assert.deepEqual(await getMetricsHistory(db, 'b', 2, 'cpu', null, 240), [{timestamp: now, cpu: 99}]);
  assert.deepEqual(await getMetricsHistory(db, 'missing', 168, 'cpu', null, 120), []);
});
test('short history keeps the last sample after loss recovery or enabling a probe', async t => {
  const now = Date.UTC(2026, 8, 30, 12);
  t.mock.method(Date, 'now', () => now);
  const db = await fixture(t);
  const insert = db.prepare('INSERT INTO metrics_history(server_id,timestamp,loss_ct) VALUES (?,?,?)');
  insert.bind('a', now - 1000, 100).run();
  insert.bind('a', now, 0).run();
  insert.bind('b', now - 1000, 'false').run();
  insert.bind('b', now, 100).run();
  assert.deepEqual(await getMetricsHistory(db, 'a', 1, 'loss_ct'), [{timestamp: now, loss_ct: 0}]);
  assert.deepEqual(await getMetricsHistory(db, 'b', 1, 'loss_ct'), [{timestamp: now, loss_ct: 100}]);
});
test('out-of-order history does not roll back latest state', async t => {
  const db=await fixture(t);const now=Date.now();
  await saveMetricsHistory(db,'a',{cpu:90},'',now);await saveMetricsHistory(db,'a',{cpu:10},'',now-60000);
  assert.equal((await getLatestMetrics(db,'a')).cpu,90);
});
test('deletion cascades history and latest state', async t => {
  const db=await fixture(t);await saveMetricsHistory(db,'a',{cpu:1},'',Date.now());
  db.prepare('DELETE FROM servers WHERE id=?').bind('a').run();
  assert.equal(await getLatestMetrics(db,'a'),null);assert.equal(db.prepare('SELECT count(*) AS n FROM metrics_history').first().n,0);
});
test('retention cleanup preserves last known status beyond seven days', async t => {
  const db=await fixture(t);const now=Date.now();await saveMetricsHistory(db,'a',{cpu:7},'',now);
  cleanupHistory(db,now+8*86400000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metrics_history').first().n,0);
  assert.equal((await getLatestMetrics(db,'a')).cpu,7);
});
