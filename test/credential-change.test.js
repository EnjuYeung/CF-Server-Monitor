import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';
import { checkWebSocketAuth } from '../src/middleware/auth.js';
import { commitAdminSettings, upgradePasswordHash } from '../src/services/adminSettings.js';
import { readSecurity, writeSecurity } from '../src/services/twoFactor.js';
import { loadSiteSettings, saveSiteOptions } from '../src/utils/settings.js';

test('credential changes revoke all old sessions atomically and preserve enrolled factors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'monitor-credentials-'));
  const config = { API_SECRET: 'credential-fixture-long-secret', ADMIN_PATH: 'credential-Fixture-28', DATA_DIR: join(root, 'data'), SCHEDULER_ENABLED: 'false' };
  let controller = await createController(config);
  let base;
  const listen = async () => { const address = await controller.listen(0, '127.0.0.1'); base = `http://127.0.0.1:${address.port}`; };
  await listen();
  const admin = async (data, token = '') => {
    const response = await fetch(`${base}/${config.ADMIN_PATH}/api`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(data) });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  const login = password => admin({ action: 'login', username: 'admin', password });
  try {
    const tokens = [(await login(config.API_SECRET)).body.token, (await login(config.API_SECRET)).body.token];
    const oldVersion = readSecurity(controller.env.DB).version;
    const ordinary = await admin({ action: 'save_settings', settings: { username: 'admin', password: '', site_name: 'unchanged auth' } }, tokens[0]);
    assert.equal(ordinary.body.requiresLogin, false);
    assert.equal(readSecurity(controller.env.DB).version, oldVersion);
    assert.equal((await admin({ action: 'get_settings' }, tokens[1])).status, 200);
    for (const settings of [{ username: [] }, { password: {} }, { username: 'x'.repeat(257) }, { password: 'x'.repeat(4097) }]) assert.equal((await admin({ action: 'save_settings', settings }, tokens[0])).status, 400);
    writeSecurity(controller.env.DB, { ...readSecurity(controller.env.DB), pending: { expiresAt: Date.now() + 60000 } });
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', { headers: { Authorization: `Bearer ${tokens[0]}` } });
    await once(ws, 'open', { signal: AbortSignal.timeout(5000) });
    const closed = once(ws, 'close', { signal: AbortSignal.timeout(5000) });
    const changed = await admin({ action: 'save_settings', settings: { password: 'new-credential-fixture-password' } }, tokens[0]);
    assert.equal(changed.status, 200);
    assert.equal(changed.body.requiresLogin, true);
    assert.match(changed.headers.get('set-cookie'), /cfsm_auth=; Max-Age=0/);
    assert.equal((await closed)[0], 1008);
    assert.equal(readSecurity(controller.env.DB).pending, undefined);
    assert.notEqual(readSecurity(controller.env.DB).version, oldVersion);
    for (const token of tokens) {
      assert.equal((await admin({ action: 'get_settings' }, token)).status, 401);
      const sys = await loadSiteSettings(controller.env.DB);
      const forms = [new Request(base, { headers: { Authorization: `Bearer ${token}` } }), new Request(base, { headers: { Cookie: `cfsm_auth=${encodeURIComponent(token)}` } }), ...['token', 'auth_token', 'ws_token'].map(key => new Request(`${base}/?${key}=${encodeURIComponent(token)}`))];
      for (const request of forms) assert.equal(await checkWebSocketAuth(request, controller.env, sys), false);
    }
    assert.equal((await login(config.API_SECRET)).status, 401);
    let fresh = await login('new-credential-fixture-password');
    assert.equal(fresh.status, 200);
    assert.equal((await admin({ action: 'get_settings' }, fresh.body.token)).status, 200);
    await controller.close();
    controller = await createController(config);
    await listen();
    assert.equal((await admin({ action: 'get_settings' }, tokens[0])).status, 401);
    assert.equal((await admin({ action: 'get_settings' }, fresh.body.token)).status, 200);

    const db = controller.env.DB;
    const security = { ...readSecurity(db), secret: 'sealed-fixture', lastStep: 123, recovery: ['remaining-hash'], pending: {} };
    writeSecurity(db, security);
    const before = db.prepare("SELECT value FROM settings WHERE key='site_options'").first().value;
    db.exec("CREATE TRIGGER fail_security BEFORE UPDATE ON settings WHEN NEW.key='admin_security' BEGIN SELECT RAISE(ABORT, 'fixture rollback'); END");
    assert.throws(() => commitAdminSettings(controller.env, security.version, { password: 'must-not-save' }, { site_title: 'must-not-save' }), /fixture rollback/);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='site_options'").first().value, before);
    assert.deepEqual(readSecurity(db), security);
    db.exec('DROP TRIGGER fail_security');
    db.prepare("INSERT INTO settings(key,value) VALUES ('resource_alert_state','{}')").run();
    db.exec("CREATE TRIGGER fail_alert_clear BEFORE DELETE ON settings WHEN OLD.key='resource_alert_state' BEGIN SELECT RAISE(ABORT, 'fixture alert rollback'); END");
    assert.throws(() => commitAdminSettings(controller.env, security.version, { password: 'must-not-save' }, null, true), /fixture alert rollback/);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key='site_options'").first().value, before);
    assert.deepEqual(readSecurity(db), security);
    db.exec('DROP TRIGGER fail_alert_clear');
    db.prepare("INSERT INTO settings(key,value) VALUES ('appearance_options',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify({ theme_options: { concurrent: 'preserve' } })).run();
    commitAdminSettings(controller.env, security.version, { site_title: 'ordinary' }, { display_mode: 'ring' });
    assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='appearance_options'").first().value).theme_options, { concurrent: 'preserve' });
    const result = commitAdminSettings(controller.env, security.version, { username: 'new-admin' }, null);
    assert.equal(result.credentialsChanged, true);
    const next = readSecurity(db);
    assert.equal(next.secret, security.secret);
    assert.equal(next.lastStep, security.lastStep);
    assert.deepEqual(next.recovery, security.recovery);
    assert.equal(next.pending, undefined);
    assert.equal(commitAdminSettings(controller.env, security.version, { password: 'stale' }, { site_title: 'stale' }), null);
    assert.equal(upgradePasswordHash(db, security.version, 'old-hash', 'stale-upgrade'), false);
    saveSiteOptions(db, { password: 'old-hash' });
    assert.equal(upgradePasswordHash(db, next.version, 'already-rehashed', 'stale-upgrade'), true);
    assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='site_options'").first().value).password, 'old-hash');
    assert.equal(upgradePasswordHash(db, next.version, 'old-hash', 'upgraded-hash'), true);
    assert.equal(JSON.parse(db.prepare("SELECT value FROM settings WHERE key='site_options'").first().value).password, 'upgraded-hash');
    assert.equal(readSecurity(db).version, next.version);
  } finally {
    await controller.close();
    await rm(root, { recursive: true, force: true });
  }
});
