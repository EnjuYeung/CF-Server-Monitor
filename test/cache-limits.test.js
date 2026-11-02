import assert from 'node:assert/strict';
import test from 'node:test';
import v8 from 'node:v8';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { createThemeFixture } from './helpers/themeFixture.js';
import { clearAllCaches, clearMetricsHistoryCache, getMetricsHistoryCache, getServerDetail, setMetricsHistoryCache } from '../src/utils/cache.js';
import { METRICS_HISTORY_CACHE_MAX_ENTRIES, SERVER_DETAIL_CACHE_MAX_ENTRIES } from '../src/utils/config.js';

v8.setFlagsFromString('--expose-gc');
const collectGarbage = vm.runInNewContext('gc');

test('CL01 server detail cache stays within its limit and evicts the oldest entry', async () => {
  clearAllCaches();
  const db = { reads: 0, prepare() { return { bind: () => ({ first: () => { db.reads++; return null; } }) }; } };
  for (let index = 0; index <= SERVER_DETAIL_CACHE_MAX_ENTRIES; index++) await getServerDetail(db, `server-${index}`, true);
  const reads = db.reads;
  assert.equal(reads, SERVER_DETAIL_CACHE_MAX_ENTRIES + 1);
  await getServerDetail(db, `server-${SERVER_DETAIL_CACHE_MAX_ENTRIES}`, true);
  assert.equal(db.reads, reads, 'The newest entry stays cached');
  await getServerDetail(db, 'server-0', true);
  assert.equal(db.reads, reads + 1, 'The oldest entry was evicted');
  clearAllCaches();
});

test('CL02 history cache entries expire with their query range', t => {
  clearAllCaches();
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 2) });
  setMetricsHistoryCache('server', 1, 'cpu', [{ cpu: 1 }], 160);
  t.mock.timers.tick(2 * 60 * 1000 - 1);
  assert.deepEqual(getMetricsHistoryCache('server', 1, 'cpu', 160).data, [{ cpu: 1 }]);
  t.mock.timers.tick(1);
  assert.equal(getMetricsHistoryCache('server', 1, 'cpu', 160), undefined);
});

test('CL03 history cache keeps the newest entries within its limit', () => {
  clearAllCaches();
  for (let index = 0; index <= METRICS_HISTORY_CACHE_MAX_ENTRIES; index++) setMetricsHistoryCache(`server-${index}`, 24, 'cpu', [index]);
  assert.equal(getMetricsHistoryCache('server-0', 24, 'cpu'), undefined);
  assert.deepEqual(getMetricsHistoryCache(`server-${METRICS_HISTORY_CACHE_MAX_ENTRIES}`, 24, 'cpu').data, [METRICS_HISTORY_CACHE_MAX_ENTRIES]);
  clearAllCaches();
});

test('CL04 writing history releases expired entries that nobody reads again', async t => {
  clearAllCaches();
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 2) });
  const expired = new WeakRef((() => {
    const rows = [{ cpu: 1 }];
    setMetricsHistoryCache('expired', 1, 'cpu', rows);
    return rows;
  })());
  t.mock.timers.tick(2 * 60 * 1000);
  setMetricsHistoryCache('fresh', 1, 'cpu', [{ cpu: 2 }]);
  await new Promise(resolve => setImmediate(resolve));
  collectGarbage();
  assert.equal(expired.deref(), undefined);
  assert.deepEqual(getMetricsHistoryCache('fresh', 1, 'cpu').data, [{ cpu: 2 }]);
});

test('CL05 clearing one server keeps the history of other servers', () => {
  clearAllCaches();
  setMetricsHistoryCache('first', 24, 'cpu', [1]);
  setMetricsHistoryCache('second', 24, 'cpu', [2]);
  clearMetricsHistoryCache('first');
  assert.equal(getMetricsHistoryCache('first', 24, 'cpu'), undefined);
  assert.deepEqual(getMetricsHistoryCache('second', 24, 'cpu').data, [2]);
  clearAllCaches();
});

test('CL06 public APIs treat malformed IDs as missing nodes without touching storage', async () => {
  const fixture = await createThemeFixture();
  try {
    clearAllCaches();
    const db = fixture.controller.env.DB, prepare = db.prepare.bind(db);
    let detailReads = 0;
    db.prepare = sql => { if (sql.includes('WHERE servers.id')) detailReads++; return prepare(sql); };
    const anonymous = path => fixture.request(path, undefined, { auth: '' });
    const malformed = 'x'.repeat(4096);
    for (const path of [`/api/server?id=${malformed}`, `/api/history/all?id=${malformed}&hours=1`, '/api/server?id=..%2F..%2Fetc%2Fpasswd', "/api/history/all?id=1'%20OR%201=1&hours=1"]) {
      assert.equal((await anonymous(path)).status, 404, path);
    }
    assert.equal(detailReads, 0);
    assert.equal((await anonymous(`/api/server?id=${randomUUID()}`)).status, 404);
    assert.equal(detailReads, 1);
    assert.equal((await anonymous('/api/server')).status, 400);
    assert.equal((await anonymous(`/api/server?id=${fixture.visible}`)).status, 200);
    const history = await anonymous(`/api/history/all?id=${fixture.visible}&hours=1`);
    assert.equal(history.status, 200);
    assert.ok(Array.isArray(history.body));
  } finally { await fixture.close(); }
});
