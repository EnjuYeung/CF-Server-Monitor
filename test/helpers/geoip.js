import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { gzipSync } from 'node:zlib';

// A valid, minimal MMDB: both branches of one IPv6 tree node share a country
// record. The real MaxMind reader handles these files; no lookup is mocked.
export function countryDatabase(country, build = '2026-09-01T00:00:00Z') {
  const string = value => {
    const data = Buffer.from(value);
    assert.ok(data.length < 29);
    return Buffer.concat([Buffer.from([0x40 + data.length]), data]);
  };
  const uint = (value, type = 6) => {
    const data = Buffer.alloc(4);
    data.writeUInt32BE(value);
    return Buffer.concat([Buffer.from(type > 7 ? [4, type - 7] : [(type << 5) + 4]), data]);
  };
  const map = fields => Buffer.concat([Buffer.from([0xe0 + Object.keys(fields).length]),
    ...Object.entries(fields).flatMap(([key, value]) => [string(key), value])]);
  return Buffer.concat([
    Buffer.from([0, 0, 17, 0, 0, 17]), Buffer.alloc(16),
    map({ country: map({ iso_code: string(country) }) }),
    Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'),
    map({
      node_count: uint(1), record_size: uint(24), ip_version: uint(6),
      database_type: string('DBIP-Country-Lite'),
      binary_format_major_version: uint(2), binary_format_minor_version: uint(0),
      build_epoch: uint(Date.parse(build) / 1000, 9),
      languages: Buffer.concat([Buffer.from([1, 4]), string('en')]),
      description: map({ en: string('GeoIP test fixture') })
    })
  ]);
}

export async function prepareGeoipFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'monitor-geoip-'));
  const seed = join(root, 'bundled.mmdb');
  const updatePath = join(root, 'data', 'geoip', 'dbip-country-lite.mmdb');
  const oldData = countryDatabase('US', '2026-08-01T00:00:00Z');
  const newData = countryDatabase('JP');
  await writeFile(seed, oldData);
  const source = { status: 200, body: gzipSync(newData), headers: {}, hold: false, chunked: false };
  const requests = [], held = new Set();
  const respond = res => {
    res.writeHead(source.status, { 'Content-Type': 'application/gzip', ...source.headers });
    if (source.chunked) { res.write(source.body); res.end(); }
    else res.end(source.body);
  };
  const server = createServer((req, res) => {
    requests.push(req.url);
    if (source.hold) { held.add(res); res.on('close', () => held.delete(res)); }
    else respond(res);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const actualFetch = globalThis.fetch;
  t.mock.method(globalThis, 'fetch', (input, init) => {
    const url = new URL(input);
    return actualFetch(url.origin === 'https://download.db-ip.com' ? base + url.pathname : input, init);
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, seed, updatePath, oldData, newData, source, requests,
    release() { source.hold = false; for (const res of held) respond(res); held.clear(); } };
}

export async function until(predicate) {
  const start = performance.now();
  while (!await predicate()) {
    if (performance.now() - start > 5000) throw new Error('GeoIP fixture timed out');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
