import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, writeFile, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createGeolocation, GEOIP_UPDATE_INTERVAL_MS as DAY } from '../src/services/geolocation.js';
import { downloadCountryDatabase } from '../src/services/geoipDatabase.js';
import { createController } from '../src/server.js';
import { countryDatabase, prepareGeoipFixture, until } from './helpers/geoip.js';

const NOW = Date.parse('2026-09-16T00:00:00Z');
async function openGeolocation(t, fixture) {
  const geo = await createGeolocation(fixture.seed, '8.8.8.8', { updatePath: fixture.updatePath });
  t.after(() => geo.close());
  return geo;
}

test('GU01 daily update hot-reloads IPv4/IPv6 and persists across an offline restart', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  assert.equal(geo.lookup('8.8.8.8'), 'US');
  assert.equal(f.requests.length, 0);
  assert.equal((await geo.updateIfDue(NOW)).status, 'updated');
  assert.equal(geo.lookup('8.8.8.8'), 'JP');
  assert.equal(geo.lookup('2001:4860:4860::8888'), 'JP');
  assert.equal(geo.lookup('127.0.0.1'), 'JP');
  assert.deepEqual(await readFile(f.updatePath), f.newData);
  const modified = (await stat(f.updatePath)).mtimeMs;
  assert.equal((await geo.updateIfDue(NOW + DAY - 1)).status, 'skipped');
  assert.equal(f.requests.length, 1);
  assert.equal((await geo.updateIfDue(NOW + DAY)).status, 'unchanged');
  assert.equal(f.requests.length, 2);
  assert.equal((await stat(f.updatePath)).mtimeMs, modified);
  await geo.close();
  f.source.status = 503;
  const restarted = await openGeolocation(t, f);
  assert.equal(restarted.lookup('8.8.8.8'), 'JP');
  assert.equal((await restarted.updateIfDue(NOW + DAY)).status, 'failed');
  assert.equal(restarted.lookup('8.8.8.8'), 'JP');
  assert.deepEqual(await readFile(f.updatePath), f.newData);
});

test('GU02 failed HTTP, gzip and MMDB downloads keep the active and persisted database', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  await geo.updateIfDue(NOW);
  const failures = [
    { status: 404 }, { status: 503 },
    { status: 200, body: Buffer.from('broken gzip') },
    { body: gzipSync(Buffer.from('broken database')) },
    { body: gzipSync(countryDatabase('??')) }
  ];
  let now = NOW;
  for (const failure of failures) {
    Object.assign(f.source, failure);
    now += DAY;
    assert.equal((await geo.updateIfDue(now)).status, 'failed');
    assert.equal(geo.lookup('8.8.8.8'), 'JP');
    assert.deepEqual(await readFile(f.updatePath), f.newData);
    const count = f.requests.length;
    assert.equal((await geo.updateIfDue(now + 60000)).status, 'skipped');
    assert.equal(f.requests.length, count);
  }
  assert.deepEqual(await readdir(dirname(f.updatePath)), ['dbip-country-lite.mmdb']);
});

test('GU03 rejects oversized responses, expansion bombs and malformed months', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  await geo.updateIfDue(NOW);
  const failures = [
    { headers: { 'Content-Length': String(16 * 1024 * 1024 + 1) } },
    { headers: {}, chunked: true, body: Buffer.alloc(16 * 1024 * 1024 + 1) },
    { chunked: false, body: gzipSync(Buffer.alloc(64 * 1024 * 1024 + 1)) }
  ];
  let now = NOW;
  for (const failure of failures) {
    Object.assign(f.source, failure);
    assert.equal((await geo.updateIfDue(now += DAY)).status, 'failed');
    assert.deepEqual(await readFile(f.updatePath), f.newData);
    assert.equal(geo.lookup('8.8.8.8'), 'JP');
  }
  await assert.rejects(downloadCountryDatabase('2026-13'), /Invalid GeoIP month/);
  await assert.rejects(downloadCountryDatabase('../2026-09'), /Invalid GeoIP month/);
});

test('GU04 missing new-month release retries the next day and never installs an older database', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  const september = Date.parse('2026-09-30T00:00:00Z');
  await geo.updateIfDue(september);
  f.source.status = 404;
  assert.equal((await geo.updateIfDue(september + DAY)).status, 'failed');
  assert.match(f.requests.at(-1), /dbip-country-lite-2026-10\.mmdb\.gz$/);
  f.source.status = 200;
  f.source.body = gzipSync(countryDatabase('DE', '2026-10-01T00:00:00Z'));
  assert.equal((await geo.updateIfDue(september + 2 * DAY)).status, 'updated');
  assert.equal(geo.lookup('8.8.8.8'), 'DE');
  const saved = await readFile(f.updatePath);
  f.source.body = gzipSync(f.oldData);
  assert.equal((await geo.updateIfDue(september + 3 * DAY)).status, 'failed');
  assert.equal(geo.lookup('8.8.8.8'), 'DE');
  assert.deepEqual(await readFile(f.updatePath), saved);
});

test('GU05 concurrent checks share one download and shutdown cancels a stalled request', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  await geo.updateIfDue(NOW);
  f.source.hold = true;
  const first = geo.updateIfDue(NOW + DAY);
  const second = geo.updateIfDue(NOW + DAY);
  assert.equal(first, second);
  await until(() => f.requests.length === 2);
  assert.equal(geo.lookup('8.8.8.8'), 'JP');
  const start = performance.now();
  await geo.close();
  assert.ok(performance.now() - start < 2000);
  assert.equal((await first).status, 'stopped');
  assert.equal((await second).status, 'stopped');
  assert.equal((await geo.updateIfDue(NOW + 2 * DAY)).status, 'skipped');
  assert.deepEqual(await readFile(f.updatePath), f.newData);
});

test('GU06 startup selects the newest valid database and recovers from corrupt cache or seed', async t => {
  const f = await prepareGeoipFixture(t);
  await mkdir(dirname(f.updatePath), { recursive: true });
  await writeFile(f.updatePath, Buffer.from('corrupt cache'));
  let geo = await openGeolocation(t, f);
  assert.equal(geo.lookup('8.8.8.8'), 'US');
  assert.equal((await geo.updateIfDue(NOW)).status, 'updated');
  await geo.close();
  await writeFile(f.seed, Buffer.from('corrupt seed'));
  geo = await openGeolocation(t, f);
  assert.equal(geo.lookup('8.8.8.8'), 'JP');
  await geo.close();
  await writeFile(f.seed, countryDatabase('DE', '2026-10-01T00:00:00Z'));
  geo = await openGeolocation(t, f);
  assert.equal(geo.lookup('8.8.8.8'), 'DE');
  await geo.close();
  await writeFile(f.seed, Buffer.from('bad seed'));
  await writeFile(f.updatePath, Buffer.from('bad cache'));
  await assert.rejects(createGeolocation(f.seed, '8.8.8.8', { updatePath: f.updatePath }));
});

test('GU07 a failed atomic install keeps lookups available and cleans its temporary file', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  // An obstructing destination exercises a real rename failure on every OS.
  await mkdir(f.updatePath, { recursive: true });
  assert.equal((await geo.updateIfDue(NOW)).status, 'failed');
  assert.equal(geo.lookup('8.8.8.8'), 'US');
  assert.deepEqual(await readdir(dirname(f.updatePath)), ['dbip-country-lite.mmdb']);
});

test('GU08 real controller schedules daily updates without blocking HTTP and preserves manual regions', async t => {
  const f = await prepareGeoipFixture(t);
  f.source.hold = true;
  t.mock.timers.enable({ apis: ['Date', 'setInterval'], now: NOW });
  const config = { API_SECRET: 'geoip-acceptance-fixture-secret', ADMIN_PATH: 'geoip-Acceptance-92',
    DATA_DIR: join(f.root, 'data'), GEOIP_PATH: f.seed, PUBLIC_IP: '8.8.8.8' };
  let controller = await createController(config);
  t.after(() => controller.close());
  const address = await controller.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;
  let token = '';
  const request = async (path, data) => {
    const response = await fetch(base + path, { method: data ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, await response.clone().text());
    const text = await response.text();
    try { return JSON.parse(text); } catch { return text; }
  };
  const admin = data => request(`/${config.ADMIN_PATH}/api`, data);
  assert.equal((await request('/healthz')).ok, true);
  await until(() => f.requests.length === 1);
  token = (await admin({ action: 'login', username: 'admin', password: config.API_SECRET })).token;
  const added = await admin({ action: 'add', name: 'GeoIP fixture' });
  const id = added.id;
  assert.ok(id);
  const report = () => request('/update', { id, secret: config.API_SECRET, metrics: { cpu: 1, timestamp: Date.now() } });
  await report();
  assert.equal((await request(`/api/server?id=${id}`)).region, 'US');
  f.release();
  await until(() => controller.env.GEOLOCATION.lookup('8.8.8.8') === 'JP');
  await report();
  assert.equal((await request(`/api/server?id=${id}`)).region, 'JP');
  const current = (await admin({ action: 'list' })).servers.find(server => server.id === id);
  await admin({ ...current, action: 'edit', region: 'DE' });
  await report();
  assert.equal((await request(`/api/server?id=${id}`)).region, 'DE');
  t.mock.timers.tick(DAY - 60000);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(f.requests.length, 1);
  t.mock.timers.tick(60000);
  await until(() => f.requests.length === 2);
  await controller.env.GEOLOCATION.updateIfDue();
  assert.deepEqual(await readFile(f.updatePath), f.newData);
  await controller.close();
  t.mock.timers.reset();
  f.source.status = 503;
  controller = await createController({ ...config, SCHEDULER_ENABLED: 'false' });
  const restarted = await controller.listen(0, '127.0.0.1');
  assert.equal((await fetch(`http://127.0.0.1:${restarted.port}/healthz`).then(r => r.json())).ok, true);
  assert.equal(controller.env.GEOLOCATION.lookup('8.8.8.8'), 'JP');
  assert.equal(controller.env.DB.prepare('SELECT region FROM servers WHERE id = ?').bind(id).first().region, 'DE');
});

test('GU09 a timed-out download keeps the database and waits until the next daily attempt', async t => {
  const f = await prepareGeoipFixture(t);
  const geo = await openGeolocation(t, f);
  await geo.updateIfDue(NOW);
  f.source.hold = true;
  const actualTimeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    assert.equal(milliseconds, 120000);
    return actualTimeout(50);
  });
  assert.equal((await geo.updateIfDue(NOW + DAY)).status, 'failed');
  assert.equal(geo.lookup('8.8.8.8'), 'JP');
  assert.deepEqual(await readFile(f.updatePath), f.newData);
  assert.equal((await geo.updateIfDue(NOW + DAY + 60000)).status, 'skipped');
  assert.equal(f.requests.length, 2);
});
