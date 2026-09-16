import test from 'node:test';
import assert from 'node:assert/strict';
import { SQLiteDatabase } from '../src/database/sqlite.js';
import { initDatabase, saveMetricsHistory, getDashboardLatencyHistory, clearDashboardLatencyHistoryCache } from '../src/database/schema.js';
test('two-hour latency window has 20 buckets and preserves gaps', async t => {
  clearDashboardLatencyHistoryCache();const db=new SQLiteDatabase();t.after(()=>db.close());await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('a').run();
  const now=Date.now();const start=now-7200000;const interval=Math.ceil((Math.floor(now/1000)*1000+1000-start)/20);
  for(const i of [0,5,19]) await saveMetricsHistory(db,'a',{ping_ct:i+20,loss_ct:0},'',start+i*interval+1000);
  const window=(await getDashboardLatencyHistory(db,[{id:'a'}],{now,cache:false})).get('a');
  assert.equal(window.ping.length,20);assert.equal(window.ping[0].ct,20);assert.equal(window.ping[1].ct,undefined);assert.equal(window.ping[5].ct,25);
});
test('latency cache refreshes after five minutes', async t => {
  clearDashboardLatencyHistoryCache();const db=new SQLiteDatabase();t.after(()=>db.close());await initDatabase(db);
  db.prepare('INSERT INTO servers(id) VALUES (?)').bind('cache').run();const now=Date.now();
  await saveMetricsHistory(db,'cache',{ping_ct:30,loss_ct:0},'',now-1000);
  assert.equal((await getDashboardLatencyHistory(db,[{id:'cache'}],{now})).get('cache').ping.at(-1).ct,30);
  await saveMetricsHistory(db,'cache',{ping_ct:90,loss_ct:0},'',now);
  assert.equal((await getDashboardLatencyHistory(db,[{id:'cache'}],{now:now+240000})).get('cache').ping.at(-1).ct,30);
  const result=(await getDashboardLatencyHistory(db,[{id:'cache'}],{now:now+360000})).get('cache');assert.ok(result.ping.some(point=>point.ct===90));
});
