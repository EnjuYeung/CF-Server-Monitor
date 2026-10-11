import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { WebSocket } from 'ws';
import { once } from 'node:events';
import { fork } from 'node:child_process';
import { createController } from '../../src/server.js';
import { buildTheme } from '../../examples/theme-minimal/build.mjs';
import { totpCode } from '../../src/services/twoFactor.js';

export const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function eventually(predicate, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await predicate()) return; await pause(20); }
  throw new Error('Condition did not become true');
}

export async function createThemeFixture({ twoFactor = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'monitor-theme-'));
  const built = await buildTheme(join(root, 'theme'));
  const suffix = randomBytes(6).toString('hex');
  const owner = `theme-fixture-${suffix}`;
  const config = {
    API_SECRET: randomBytes(24).toString('hex'), ADMIN_PATH: `theme-${suffix}`,
    DATA_DIR: join(root, 'data'), AGENT_ARCHIVE_DIR: join(root, 'archives'),
    GEOIP_PATH: 'geoip/dbip-country-lite.mmdb', PUBLIC_IP: '198.51.100.20',
    TRUSTED_PROXIES: '127.0.0.1/32', SCHEDULER_ENABLED: 'false', API_BASE: '', CORS_ALLOWED_ORIGINS: ''
  };
  const unavailable = new Set(), upstreamReads = new Map(), sockets = new Set();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (url.hostname !== 'raw.githubusercontent.com' || !url.pathname.startsWith(`/${owner}/minimal/`)) return originalFetch(input, options);
    upstreamReads.set(url.pathname, (upstreamReads.get(url.pathname) || 0) + 1);
    const parts = url.pathname.split('/'); const ref = parts[3];
    if (parts[4] !== 'theme' || unavailable.has(ref)) return new Response('Missing fixture', { status: 404 });
    const relative = parts.slice(5).join('/');
    if (!/^index\.html$|^assets\/[a-z0-9.-]+$/.test(relative)) return new Response('Not Found', { status: 404 });
    try { return new Response(await readFile(join(built, relative)), { headers: { ETag: 'fixture-etag' } }); }
    catch { return new Response('Not Found', { status: 404 }); }
  };
  let controller, base, token = '', factorSecret, recoveryCodes;
  async function listen() {
    controller = await createController(config);
    const address = await controller.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${address.port}`;
  }
  await listen();
  async function request(path, body, { auth = token, headers = {} } = {}) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, body: data, headers: response.headers };
  }
  const admin = (body, options) => request(`/${config.ADMIN_PATH}/api`, body, options);
  const login = await admin({ action: 'login', username: 'admin', password: config.API_SECRET }, { auth: '' });
  assert.equal(login.status, 200); token = login.body.token;
  async function edit(id, updates) {
    const list = await admin({ action: 'list' });
    const server = list.body.servers.find(server => server.id === id); assert.ok(server);
    const result = await admin({ ...server, ...updates, action: 'edit' }); assert.equal(result.status, 200);
  }
  const visible = (await admin({ action: 'add', name: '示例节点' })).body.id;
  const hidden = (await admin({ action: 'add', name: '隐藏节点' })).body.id;
  const empty = (await admin({ action: 'add', name: '尚未上报节点' })).body.id;
  await edit(hidden, { is_hidden: '1' });
  async function report(id, metrics) {
    const result = await request('/update', { id, secret: config.API_SECRET, metrics }, { auth: '' });
    assert.equal(result.status, 200); return result;
  }
  const metrics = { cpu: 25, ram_total: 2048, ram_used: 512, net_in_speed: 1024, net_out_speed: 2048, ping_ct: 25, loss_ct: 0, ping_cu: false, loss_cu: false };
  await report(visible, { ...metrics, timestamp: Date.now() - 48 * 3600000 });
  await report(visible, { ...metrics, timestamp: Date.now() - 1000 });
  await report(hidden, { ...metrics, cpu: 70, timestamp: Date.now() - 1000 });
  if (twoFactor) {
    const setup = await admin({ action: 'two_factor_setup', password: config.API_SECRET }); factorSecret = setup.body.secret;
    const enabled = await admin({ action: 'two_factor_enable', password: config.API_SECRET, otp: totpCode(factorSecret, Math.floor(Date.now() / 30000) - 1) });
    assert.equal(enabled.status, 200); token = enabled.body.token; recoveryCodes = enabled.body.recoveryCodes;
    assert.equal((await admin({ action: 'save_settings', settings: { is_public: 'false' } })).status, 200);
  }
  async function openSocket({ auth = '', ids = [visible], cookie = '', origin } = {}) {
    const url = new URL('/api/ws?subscribe=all', base.replace('http:', 'ws:'));
    if (auth) url.searchParams.set('token', auth);
    const ws = new WebSocket(url, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } });
    const messages = []; sockets.add(ws);
    ws.on('message', raw => messages.push(JSON.parse(raw))); ws.on('error', () => {});
    ws.on('close', () => sockets.delete(ws));
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    ws.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids }));
    await eventually(() => messages.some(message => message.type === 'subscribed'));
    return { ws, messages };
  }
  return {
    root, built, config, owner, visible, hidden, empty, metrics, request, admin, edit, report, openSocket,
    unavailable, upstreamReads, factorSecret, recoveryCodes,
    get controller() { return controller; }, get base() { return base; }, get token() { return token; },
    themeUrl: ref => `https://github.com/${owner}/minimal/tree/${ref}/theme`,
    async restart() { await controller.close(); await listen(); },
    async close() {
      for (const ws of sockets) ws.terminate();
      await controller.close(); globalThis.fetch = originalFetch; await rm(root, { recursive: true, force: true });
    }
  };
}

// Each controller process owns the application's module-level caches.
export async function createThemeProcessFixture({ twoFactor = false } = {}) {
  const child = fork(new URL('./themeWorker.js', import.meta.url), [twoFactor ? 'private' : 'public'], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
  let sequence = 0; const pending = new Map();
  const ready = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.on('message', message => {
      if (message.ready) resolve(message.ready);
      else if (message.startError) reject(new Error(message.startError));
      else {
        const task = pending.get(message.id); if (!task) return;
        pending.delete(message.id); clearTimeout(task.timer);
        if (message.error) task.reject(new Error(message.error)); else task.resolve(message.result);
      }
    });
    child.on('exit', () => { for (const task of pending.values()) { clearTimeout(task.timer); task.reject(new Error('Fixture process exited')); } pending.clear(); });
  });
  const info = await ready;
  function call(action, value) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Fixture ${action} timeout`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); child.send({ id, action, value });
    });
  }
  async function request(path, body, { auth = info.token, headers = {} } = {}) {
    const response = await fetch(info.base + path, { method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000) });
    const raw = await response.text(); let data; try { data = JSON.parse(raw); } catch { data = raw; }
    return { status: response.status, body: data, headers: response.headers };
  }
  const admin = (body, options) => request(`/${info.config.ADMIN_PATH}/api`, body, options);
  return {
    ...info, request, admin, themeUrl: ref => `https://github.com/${info.owner}/minimal/tree/${ref}/theme`,
    async edit(id, updates) {
      const list = await admin({ action: 'list' }); const server = list.body.servers.find(server => server.id === id); assert.ok(server);
      const result = await admin({ ...server, ...updates, action: 'edit' }); assert.equal(result.status, 200);
    },
    async report(id, metrics) {
      const result = await request('/update', { id, secret: info.config.API_SECRET, metrics }, { auth: '' }); assert.equal(result.status, 200); return result;
    },
    setCors: origin => call('setCors', origin), stats: () => call('stats'), disconnectViewers: () => call('disconnectViewers'),
    async close() { const exited = once(child, 'exit'); await call('close'); await exited; }
  };
}
