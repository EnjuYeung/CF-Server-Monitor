import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { PNG } from 'pngjs';
import jsQR from 'jsqr';
import { createController } from '../src/server.js';
import { normalizeAdminPath } from '../src/utils/adminPath.js';
import { encodeBase32, totpCode, matchTotp, readSecurity, writeSecurity } from '../src/services/twoFactor.js';

test('ADMIN_PATH rejects missing, short, nested, encoded and placeholder paths', () => {
  for (const path of ['', undefined, 'short', '/abcdefg', 'abc/defgh', 'a'.repeat(129), 'replace-with-random', 'abcd%32efg', 'abcd?efgh', ' a2345678']) {
    assert.throws(() => normalizeAdminPath(path), /ADMIN_PATH/);
  }
  assert.equal(normalizeAdminPath('aZ1_9-cD'), '/aZ1_9-cD');
  assert.equal(normalizeAdminPath('/aZ1_9-cD'), '/aZ1_9-cD');
  assert.equal(normalizeAdminPath('a'.repeat(128)).length,129);
});

test('TOTP matches RFC 6238 SHA-1 vectors, retains leading zeroes and rejects replay/outside window', () => {
  const secret = encodeBase32(Buffer.from('12345678901234567890'));
  assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const vectors = [[59,'287082'], [1111111109,'081804'], [1111111111,'050471'], [1234567890,'005924'], [2000000000,'279037'], [20000000000,'353130']];
  for (const [time, code] of vectors) {
    const step = Math.floor(time / 30);
    assert.equal(totpCode(secret, step), code);
    assert.equal(matchTotp(secret, code, -1, time * 1000), step);
    assert.equal(matchTotp(secret, code, step, time * 1000), null);
  }
  const now = 1234567890000, step = Math.floor(now / 30000);
  for (const offset of [-1, 0, 1]) assert.equal(matchTotp(secret, totpCode(secret, step + offset), -1, now), step + offset);
  for (const offset of [-2, 2]) assert.equal(matchTotp(secret, totpCode(secret, step + offset), -1, now), null);
  for (const code of ['12345', '1234567', ' 005924', 5924, null, ['005924'], 'abcdef']) assert.equal(matchTotp(secret, code, -1, now), null);
});

test('secure entry and 2FA work over HTTP, WebSocket, restart and backup restore', async t => {
  // All directories, server and data fixtures are prepared before the acceptance steps.
  const root = await mkdtemp(join(tmpdir(), 'monitor-security-'));
  const config = {API_SECRET:'security-fixture-only-long-password', ADMIN_PATH:'safeFixture-9T2w8X', DATA_DIR:join(root,'data'), PUBLIC_IP:'8.8.8.8', TRUSTED_PROXIES:'127.0.0.1/32', SCHEDULER_ENABLED:'false'};
  let controller = await createController(config), base, token = '', secret, recovery, originalToken;
  let ip = 0;
  const listen = async () => { const address = await controller.listen(0,'127.0.0.1'); base = `http://127.0.0.1:${address.port}`; };
  await listen();
  const request = async (path, data, auth = token, extra = {}) => {
    const response = await fetch(base + path, {method: data === undefined ? 'GET':'POST', headers:{'Content-Type':'application/json', 'X-Forwarded-For':`198.51.100.${++ip % 250 + 1}`, ...(auth ? {Authorization:`Bearer ${auth}`} : {}), ...extra}, body:data === undefined ? undefined:JSON.stringify(data)});
    const raw = await response.text(); let body; try {body=JSON.parse(raw);} catch {body=raw;}
    return {status:response.status, headers:response.headers, body};
  };
  const admin = (data, auth = token) => request(`/${config.ADMIN_PATH}/api`, data, auth);
  const login = (extra = {}) => admin({action:'login', username:'admin', password:config.API_SECRET, ...extra}, '');
  const restart = async (updates = {}) => { await controller.close(); controller = await createController({...config,...updates}); await listen(); };
  try {
    await t.test('S01 startup, homepage, hidden routes and no anonymous path disclosure', async () => {
      assert.equal((await request('/healthz')).status,200);
      const home = await request('/'); assert.equal(home.status,200); assert.doesNotMatch(home.body, /adminEntry|safeFixture/);
      for (const path of ['/admin','/admin/','/admin/api','/wrongFixture9','/safeFixture-9T2w8X/extra']) assert.equal((await request(path)).status,404,path);
      assert.equal((await request('/admin/api',{action:'login',username:'admin',password:config.API_SECRET})).status,404);
      const entry = await request(`/${config.ADMIN_PATH}/`); assert.equal(entry.status,200); assert.match(entry.body,/name="adminEntry"/); assert.equal(entry.headers.get('referrer-policy'),'no-referrer');
      const cfg = await request('/api/config'); assert.equal(cfg.body.authorization,false); assert.equal('admin_path' in cfg.body,false); assert.equal(cfg.headers.get('cache-control'),'no-store');
      const good = await login(); assert.equal(good.status,200); token=originalToken=good.body.token;
      assert.equal((await request('/api/config')).body.admin_path,`/${config.ADMIN_PATH}`);
    });
    await t.test('S02 password reauthentication, local QR/manual secret and unconfirmed binding', async () => {
      assert.equal((await admin({action:'two_factor_setup',password:config.API_SECRET},'')).status,401);
      assert.equal((await admin({action:'two_factor_setup',password:'wrong'})).status,400);
      const setup = await admin({action:'two_factor_setup',password:config.API_SECRET}); assert.equal(setup.status,200); secret=setup.body.secret;
      const png=PNG.sync.read(Buffer.from(setup.body.qrCode.split(',')[1],'base64'));
      const decoded=jsQR(new Uint8ClampedArray(png.data),png.width,png.height);
      assert.equal(decoded.data,setup.body.uri);
      const uri=new URL(decoded.data); assert.equal(uri.protocol,'otpauth:'); assert.equal(uri.searchParams.get('secret'),secret); assert.equal(uri.searchParams.get('digits'),'6'); assert.equal(uri.searchParams.get('period'),'30');
      assert.equal(uri.searchParams.get('algorithm'),'SHA1');
      assert.equal((await admin({action:'two_factor_status'})).body.enabled,false);
      const other = await login(); assert.ok(other.body.token);
      const otp=totpCode(secret,Math.floor(Date.now()/30000)-1);
      assert.equal((await admin({action:'two_factor_enable',password:config.API_SECRET,otp},other.body.token)).status,400);
      assert.equal((await admin({action:'two_factor_enable',password:config.API_SECRET,otp:'abc'})).status,400);
    });
    await t.test('S03 activation, encrypted persistence, sanitized settings and old session revocation', async () => {
      const existing = new WebSocket(base.replace('http:', 'ws:') + '/api/ws', {headers:{Authorization:`Bearer ${originalToken}`}});
      await once(existing, 'open', {signal:AbortSignal.timeout(5000)});
      const closed = once(existing, 'close', {signal:AbortSignal.timeout(5000)});
      const result=await admin({action:'two_factor_enable',password:config.API_SECRET,otp:totpCode(secret,Math.floor(Date.now()/30000)-1)});
      assert.equal(result.status,200); token=result.body.token; recovery=result.body.recoveryCodes; assert.equal(recovery.length,10);
      assert.equal((await closed)[0],1008);
      assert.equal((await admin({action:'list'},originalToken)).status,401);
      assert.equal((await admin({action:'two_factor_status'})).body.enabled,true);
      assert.equal(JSON.stringify(readSecurity(controller.env.DB)).includes(secret),false);
      const settings=await admin({action:'get_settings'}); assert.equal(JSON.stringify(settings.body).includes(secret),false); assert.equal('password' in settings.body.settings,false);
      await admin({action:'save_settings',settings:{two_factor_enabled:false,admin_security:{secret:null}}});
      assert.equal((await admin({action:'two_factor_status'})).body.enabled,true);
      const wsStatus=await new Promise((resolve,reject) => {
        const ws=new WebSocket(base.replace('http:','ws:')+'/api/ws',{headers:{Cookie:`cfsm_auth=${encodeURIComponent(originalToken)}`}});
        ws.on('message', raw => {const body=JSON.parse(raw); if(body.type==='hello') { resolve(ws); }}); ws.on('error',reject);
      });
      assert.equal([...controller.env.REALTIME_HUB.frontendSockets].some(socket=>socket.context.isAdmin),false);
      wsStatus.terminate();
    });
    await t.test('S04 password-only challenge grants no session; valid OTP, replay and recovery race', async () => {
      const challenge=await login(); assert.equal(challenge.status,200); assert.equal(challenge.body.requiresTwoFactor,true); assert.equal(challenge.body.token,undefined); assert.equal(challenge.headers.get('set-cookie'),null);
      assert.equal((await login({password:'wrong'})).status,401);
      assert.equal((await login({otp:'abcdef'})).status,401);
      const otp=totpCode(secret,Math.floor(Date.now()/30000));
      const verified=await login({otp}); assert.equal(verified.status,200); assert.ok(verified.body.token);
      assert.equal((await login({otp})).status,401);
      const race=await Promise.all([login({recoveryCode:recovery[0]}),login({recoveryCode:recovery[0]})]);
      assert.deepEqual(race.map(r=>r.status).sort(),[200,401]);
      assert.equal((await admin({action:'two_factor_status'})).body.recoveryCodesRemaining,9);
    });
    await t.test('S05 restart and SQLite backup preserve 2FA, used codes and sessions', async () => {
      const snapshot=join(root,'snapshot.sqlite'); await controller.env.DB.backup(snapshot);
      await restart();
      assert.equal((await login()).body.requiresTwoFactor,true);
      assert.equal((await login({recoveryCode:recovery[0]})).status,401);
      assert.equal((await admin({action:'two_factor_status'})).body.enabled,true);
      await controller.close(); await copyFile(snapshot,join(root,'restored.sqlite'));
      // Restore into the already prepared isolated data directory.
      await copyFile(snapshot,join(config.DATA_DIR,'monitor.sqlite'));
      controller=await createController(config); await listen();
      assert.equal((await login()).body.requiresTwoFactor,true);
      assert.equal((await login({recoveryCode:recovery[0]})).status,401);
      const secure=await admin({action:'login',username:'admin',password:config.API_SECRET,recoveryCode:recovery[1]},'');
      assert.equal(secure.status,200);token=secure.body.token;
      const cookie=await request(`/${config.ADMIN_PATH}/api`,{action:'login',username:'admin',password:config.API_SECRET,recoveryCode:recovery[2]},'',{'X-Forwarded-Proto':'https'});
      assert.match(cookie.headers.get('set-cookie'),/HttpOnly; SameSite=Lax; Secure/);
    });
    await t.test('S06 disable requires password plus second factor and revokes previous tokens', async () => {
      assert.equal((await admin({action:'two_factor_disable',password:'wrong',recoveryCode:recovery[3]})).status,400);
      assert.equal((await admin({action:'two_factor_disable',password:config.API_SECRET,otp:'abcdef'})).status,400);
      const disabled=await admin({action:'two_factor_disable',password:config.API_SECRET,recoveryCode:recovery[3]});
      assert.equal(disabled.status,200);assert.equal(disabled.body.enabled,false);
      assert.equal((await admin({action:'list'})).status,401);token=disabled.body.token;
      assert.equal((await admin({action:'two_factor_status'})).body.recoveryCodesRemaining,0);
      assert.ok((await login()).body.token);
    });
    await t.test('S07 expired setup and changed entry cannot reuse previous access', async () => {
      await restart();
      const setup=await admin({action:'two_factor_setup',password:config.API_SECRET});
      const state=readSecurity(controller.env.DB); state.pending.expiresAt=Date.now()-1; writeSecurity(controller.env.DB,state);
      assert.equal((await admin({action:'two_factor_enable',password:config.API_SECRET,otp:totpCode(setup.body.secret,Math.floor(Date.now()/30000))})).status,400);
      await restart({ADMIN_PATH:'newFixture-84pV9'});
      assert.equal((await admin({action:'list'})).status,404);
      assert.equal((await request('/api/config')).body.authorization,false);
    });
    await t.test('S08 failed login and second-factor guesses are rate limited', async () => {
      const headers={'Content-Type':'application/json','X-Forwarded-For':'203.0.113.5'};
      const data={action:'login',username:'admin',password:'wrong'};
      let result;
      for(let n=0;n<21;n++) result=await fetch(base+'/newFixture-84pV9/api',{method:'POST',headers,body:JSON.stringify(data)});
      assert.equal(result.status,429);assert.equal(result.headers.get('retry-after'),'60');
      for(let n=0;n<11;n++) result=await request('/newFixture-84pV9/api',{...data,otp:'123456'},'');
      assert.equal(result.status,429);
    });
  } finally { await controller.close(); await rm(root,{recursive:true,force:true}); }
});
