import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { createServer as createViteServer } from 'vite';

test('frontend HTTP deadlines include response bodies and preserve caller cancellation and source authentication', async t => {
  const primary = createHttpServer((req, res) => {
    if (req.url === '/waiting') return;
    if (req.url === '/body') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.write('{"value":');
      return;
    }
    if (req.url === '/unauthorized') return res.writeHead(401).end('{"error":"fixture unauthorized"}');
    const send = () => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ authorization: req.headers.authorization }));
    if (req.url === '/slow') {
      const timer = setTimeout(send, 150);
      res.once('close', () => clearTimeout(timer));
    } else send();
  });
  const secondary = createHttpServer((req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ authorization: req.headers.authorization })));
  for (const server of [primary, secondary]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  const bases = [primary, secondary].map(server => `http://127.0.0.1:${server.address().port}`);
  const original = { window: globalThis.window, localStorage: globalThis.localStorage };
  const tokens = new Map(bases.map((base, index) => [`jwt_token:${base}`, `fixture-token-${index}`]));
  globalThis.window = { location: new URL(bases[0]), __APP_API_BASES__: bases };
  globalThis.localStorage = { getItem: key => tokens.get(key) || null, setItem: (key, value) => tokens.set(key, value), removeItem: key => tokens.delete(key) };
  const vite = await createViteServer({ configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true, watch: null } });
  t.after(async () => {
    for (const server of [primary, secondary]) server.closeAllConnections();
    await Promise.all([primary, secondary].map(server => new Promise(resolve => server.close(resolve))));
    await vite.close(); Object.assign(globalThis, original);
  });
  const { http } = await vite.ssrLoadModule('/src/frontend/utils/http.js');
  const within = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('HTTP operation did not finish')), 1500); })]); }
    finally { clearTimeout(timer); }
  };

  await t.test('HT01 a stalled connection times out without clearing its token', async () => {
    const result = await within(http.get('/waiting', { timeoutMs: 80, autoRedirect: false }));
    assert.equal(result.code, 'REQUEST_TIMEOUT'); assert.equal(result.status, 0);
    assert.equal(result.baseUrl, bases[0]); assert.equal(tokens.get(`jwt_token:${bases[0]}`), 'fixture-token-0');
  });
  await t.test('HT02 a stalled JSON body also times out instead of reporting an empty success', async () => {
    const result = await within(http.get('/body', { timeoutMs: 80 }));
    assert.equal(result.code, 'REQUEST_TIMEOUT'); assert.equal(result.status, 0); assert.equal(result.data, undefined);
  });
  await t.test('HT03 progress results retain a successful source alongside a timed-out source', async () => {
    const results = [];
    await within(http.getAllWithProgress('/body', result => results.push(result), { timeoutMs: 80 }));
    assert.equal(results.length, 2);
    assert.equal(results.find(result => result.baseUrl === bases[0]).code, 'REQUEST_TIMEOUT');
    assert.equal(results.find(result => result.baseUrl === bases[0]).corsError, false);
    assert.equal(results.find(result => result.baseUrl === bases[1]).data.authorization, 'Bearer fixture-token-1');
  });
  await t.test('HT04 caller cancellation works before fetch and while reading a response body', async () => {
    const cancelled = new AbortController(); cancelled.abort();
    assert.equal((await within(http.get('/slow', { signal: cancelled.signal, timeoutMs: 1000 }))).code, 'REQUEST_ABORTED');
    const controller = new AbortController(), results = [];
    const timer = setTimeout(() => controller.abort(), 40);
    try {
      await within(http.getAllWithProgress('/body', result => results.push(result), { signal: controller.signal, timeoutMs: 1000 }));
    } finally { clearTimeout(timer); }
    assert.equal(results.find(result => result.baseUrl === bases[0]).code, 'REQUEST_ABORTED');
    assert.equal(results.find(result => result.baseUrl === bases[1]).status, 200);
  });
  await t.test('HT05 requests without a deadline and successful timed requests retain their behavior', async () => {
    for (const options of [{}, { timeoutMs: 1000 }]) {
      const result = await within(http.get('/slow', options));
      assert.equal(result.status, 200); assert.equal(result.data.authorization, 'Bearer fixture-token-0');
    }
  });
  await t.test('HT06 a real 401 still clears only the rejected source', async () => {
    const results = await within(http.getAll('/unauthorized', { autoRedirect: false, timeoutMs: 1000 }));
    assert.equal(results[0].status, 401); assert.equal(results[1].status, 200);
    assert.equal(tokens.has(`jwt_token:${bases[0]}`), false); assert.equal(tokens.get(`jwt_token:${bases[1]}`), 'fixture-token-1');
  });
});
