import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';

test('authenticated node deletion delivers persistent uninstall commands through HTTP and WS', async t => {
  const root = await mkdtemp(join(tmpdir(), 'agent-removal-'));
  const config = { API_SECRET: 'remote-uninstall-fixture-secret', ADMIN_PATH: 'remote-Agent-Removal-92', DATA_DIR: root, PUBLIC_IP: '8.8.8.8', SCHEDULER_ENABLED: 'false' };
  let controller = await createController(config);
  let base, token;
  const sockets = [];
  const listen = async () => { const address = await controller.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${address.port}`; };
  await listen();
  const request = async (path, data, authorization = token) => {
    const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) }, body: JSON.stringify(data) });
    const text = await response.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    return { status: response.status, body };
  };
  const admin = data => request(`/${config.ADMIN_PATH}/api`, data);
  const report = (id, secret = config.API_SECRET) => request('/update', { id, secret, metrics: { cpu: 12, timestamp: Date.now() } }, '');
  const add = async name => (await admin({ action: 'add', name })).body.id;
  const validateCommand = (command, id) => {
    assert.equal(command.type, 'agent_uninstall');
    assert.equal(command.server_id, id);
    const message = `jan-monitor:agent-uninstall:v1\n${id}\n${command.command_id}\n${command.issued_at}`;
    assert.equal(command.signature, createHmac('sha256', config.API_SECRET).update(message).digest('hex'));
  };
  try {
    token = (await admin({ action: 'login', username: 'admin', password: config.API_SECRET })).body.token;
    const wsId = await add('Online WebSocket Agent');
    const offlineId = await add('Offline HTTP Agent');
    const restoredId = await add('Restorable Agent');
    const restoredRow = (await admin({ action: 'export_servers' })).body.servers.find(row => row.id === restoredId);
    await t.test('RM01 online WS receives a signed command before disconnection and monitoring data is removed', async () => {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/update'); sockets.push(ws);
      const messages = [];
      ws.on('message', raw => messages.push(JSON.parse(raw)));
      await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
      const acknowledged = new Promise(resolve => ws.on('message', raw => { if (JSON.parse(raw).type === 'ack') resolve(); }));
      ws.send(JSON.stringify({ id: wsId, secret: config.API_SECRET, metrics: { cpu: 72, timestamp: Date.now() } }));
      await acknowledged;
      const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) });
      assert.equal((await admin({ action: 'delete', id: wsId })).status, 200);
      assert.equal((await closed)[0], 1008);
      validateCommand(messages.find(message => message.type === 'agent_uninstall'), wsId);
      for (const table of ['metrics_history', 'server_presence', 'server_latest']) assert.equal(controller.env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE server_id=?`).bind(wsId).first().n, 0);
      assert.equal(controller.env.DB.prepare('SELECT id FROM servers WHERE id=?').bind(wsId).first(), null);
    });
    await t.test('RM02 batch deletion persists commands for offline Agents; invalid credentials and unknown UUIDs get no command', async () => {
      assert.equal((await admin({ action: 'batch_delete', ids: [offlineId, restoredId] })).status, 200);
      const response = await report(offlineId);
      assert.equal(response.status, 404); validateCommand(response.body, offlineId);
      assert.equal((await report(offlineId, 'incorrect-fixture-secret')).status, 401);
      assert.equal((await report(offlineId, 'incorrect-fixture-secret')).body.type, undefined);
      assert.equal((await report(randomUUID())).body.type, undefined);
      assert.equal((await report(undefined)).status, 400);
    });
    await t.test('RM03 controller recreation keeps the same command; an offline WS receives it after authenticating', async () => {
      const before = (await report(offlineId)).body;
      await controller.close(); controller = await createController(config); await listen();
      assert.deepEqual((await report(offlineId)).body, before);
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/update'); sockets.push(ws);
      const messages = [];
      ws.on('message', raw => messages.push(JSON.parse(raw)));
      await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
      const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) });
      ws.send(JSON.stringify({ id: offlineId, secret: config.API_SECRET, metrics: { cpu: 1 } }));
      await closed;
      validateCommand(messages.find(message => message.type === 'agent_uninstall'), offlineId);
    });
    await t.test('RM04 explicit UUID restoration cancels a command not yet received and accepts fresh reports', async () => {
      assert.equal((await admin({ action: 'import_servers', servers: [restoredRow] })).body.imported, 1);
      assert.equal((await report(restoredId)).status, 200);
      assert.equal(controller.env.DB.prepare('SELECT * FROM agent_removals WHERE server_id=?').bind(restoredId).first(), null);
    });
    await t.test('RM05 failed batch deletion rolls back nodes and commands; unauthenticated GUI deletion has no effect', async () => {
      const first = await add('Batch first'), second = await add('Batch second');
      controller.env.DB.exec(`CREATE TRIGGER removal_fixture_fail BEFORE DELETE ON servers WHEN OLD.id='${second}' BEGIN SELECT RAISE(ABORT,'removal fixture failure'); END`);
      assert.equal((await admin({ action: 'batch_delete', ids: [first, second] })).status, 400);
      for (const id of [first, second]) {
        assert.ok(controller.env.DB.prepare('SELECT id FROM servers WHERE id=?').bind(id).first());
        assert.equal(controller.env.DB.prepare('SELECT * FROM agent_removals WHERE server_id=?').bind(id).first(), null);
      }
      assert.equal((await request(`/${config.ADMIN_PATH}/api`, { action: 'delete', id: first }, '')).status, 401);
      assert.ok(controller.env.DB.prepare('SELECT id FROM servers WHERE id=?').bind(first).first());
    });
  } finally {
    for (const ws of sockets) ws.terminate();
    await controller.close(); await rm(root, { recursive: true, force: true });
  }
});
