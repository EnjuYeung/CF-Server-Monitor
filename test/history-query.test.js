import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase, saveMetricsHistory, getMetricsHistory, getLatestMetrics, cleanupHistory } from '../src/database/schema.js';
import { clearAllCaches } from '../src/utils/cache.js';
import { RealtimeHub } from '../src/realtime/RealtimeHub.js';
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
test('failed history transaction rolls back and WSS never claims persistence', async t => {
  const db=await fixture(t);const hub=new RealtimeHub({DB:db});
  db.exec("CREATE TRIGGER fail BEFORE INSERT ON server_latest BEGIN SELECT RAISE(ABORT,'disk failed'); END");
  const ws={getContext:()=>({}),setContext(){throw new Error('must not confirm failed write')}};
  await assert.rejects(hub._persistAgentHistoryIfDue(ws,{}, {serverId:'a',metrics:{cpu:33},timestamp:Date.now(),reportIntervalMs:60000}),/disk failed/);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metrics_history').first().n,0);
  assert.ok(hub.agentHistoryWrites.get('a').pendingHistoryAggregate);
});
test('WSS aggregates pending samples and flushes them on graceful shutdown', async t => {
  const db=await fixture(t);const hub=new RealtimeHub({DB:db});let context={};
  const ws={getContext:()=>context,setContext:value=>context=value};const now=Date.now();
  const first=await hub._persistAgentHistoryIfDue(ws,context,{serverId:'a',metrics:{cpu:10},timestamp:now-1000,reportIntervalMs:60000});assert.equal(first.persisted,true);
  const pending=await hub._persistAgentHistoryIfDue(ws,context,{serverId:'a',metrics:{cpu:40},timestamp:now,reportIntervalMs:60000});assert.equal(pending.persisted,false);
  await hub.close();assert.equal((await getLatestMetrics(db,'a')).cpu,40);
});
test('retention cleanup preserves last known status beyond seven days', async t => {
  const db=await fixture(t);const now=Date.now();await saveMetricsHistory(db,'a',{cpu:7},'',now);
  cleanupHistory(db,now+8*86400000);
  assert.equal(db.prepare('SELECT count(*) AS n FROM metrics_history').first().n,0);
  assert.equal((await getLatestMetrics(db,'a')).cpu,7);
});
