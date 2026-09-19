import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';
import { checkOfflineNodes } from '../src/services/notifications/offline.js';
import { checkTrafficReports } from '../src/services/notifications/traffic.js';
import { checkResourceAlerts } from '../src/services/notifications/resource.js';
import { checkExpiringServers } from '../src/services/notifications/expiry.js';
import { drainNotifications } from '../src/services/outbox.js';
import { clearAllCaches } from '../src/utils/cache.js';
import { cleanupHistory } from '../src/database/schema.js';
import { updateLatencyWindow } from '../src/frontend/utils/latencyWindow.js';
import { reconcileDashboardSnapshot } from '../src/frontend/utils/dashboardSnapshot.js';

// Prepare all fixtures before executing acceptance cases. Never use an existing database.
const root = await mkdtemp(join(tmpdir(), 'monitor-acceptance-'));
const evidence = resolve('output/test-results');
await mkdir(evidence, { recursive: true });
let webhookStatus = 503; const deliveries = [];
const webhook = createServer(async (req, res) => {
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  deliveries.push({ status: webhookStatus, body: Buffer.concat(chunks).toString() });
  res.writeHead(webhookStatus, { 'Content-Type': 'application/json' }).end('{}');
});
webhook.listen(0, '127.0.0.1'); await once(webhook, 'listening');
const config = {
  API_SECRET: 'acceptance-only-random-fixture-secret', ADMIN_PATH: 'acceptance-SafeEntry-82', DATA_DIR: join(root, 'data'),
  PUBLIC_IP: '8.8.8.8', TRUSTED_PROXIES: '127.0.0.1/32', SCHEDULER_ENABLED: 'false'
};
let controller = await createController(config);
let address = await controller.listen(0, '127.0.0.1');
let base = `http://127.0.0.1:${address.port}`;
const sockets = new Set(); const results = [];
let token = ''; let mainId; let hiddenId; let backupPath;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, data, auth = token, headers = {}) {
  const response = await fetch(base + path, { method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type':'application/json' }), ...(auth ? {Authorization:`Bearer ${auth}`} : {}), ...headers },
    body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const text = await response.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: response.status, headers: response.headers, body };
}
const admin = data => request(`/${config.ADMIN_PATH}/api`, data);
const report = (id, metrics, extra = {}) => request('/update', {id, secret:config.API_SECRET, metrics, ...extra}, '');
async function edit(id, updates) {
  const list = await admin({ action:'list' });
  const server = list.body.servers.find(server => server.id === id);
  assert.ok(server);
  const response = await admin({ ...server, action:'edit', ...updates });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}
async function openSocket(path, headers = {}) {
  const messages = [];
  let handshakeDate;
  const ws = new WebSocket(base.replace('http:', 'ws:') + path, { headers });
  ws.on('upgrade', response => { handshakeDate = response.headers.date; });
  sockets.add(ws);
  ws.on('close', () => sockets.delete(ws));
  ws.on('message', raw => { try { messages.push(JSON.parse(raw)); } catch {} });
  await Promise.race([once(ws, 'open'), wait(5000).then(() => { throw new Error('WebSocket open timeout'); })]);
  const find = async predicate => {
    const start = Date.now();
    while (Date.now() - start < 5000) { const found = messages.find(predicate); if (found) return found; await wait(10); }
    throw new Error('WebSocket message timeout: ' + JSON.stringify(messages.slice(-3)));
  };
  await find(message => message.type === 'hello');
  return { ws, messages, find, handshakeDate };
}
async function rejectedSocket(path) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + path);
    ws.on('open', () => { ws.close(); reject(new Error('Unexpected successful upgrade')); });
    ws.on('unexpected-response', (_, response) => { resolve(response.statusCode); response.resume(); ws.terminate(); });
    ws.on('error', () => {});
    setTimeout(() => { ws.terminate(); reject(new Error('Upgrade rejection timeout')); }, 5000).unref();
  });
}
async function step(id, feature, operation, expected, callback) {
  const start = performance.now();
  try {
    const detail = await callback();
    const result = { id, feature, operation, expected, status:'PASS', durationMs:Math.round(performance.now()-start), evidence:detail || 'Assertions passed against HTTP/WS/SQLite' };
    results.push(result); console.log(JSON.stringify(result));
  } catch (error) {
    results.push({id, feature, operation, expected, status:'FAIL', evidence:error.stack});
    console.error(id, error); throw error;
  } finally { await writeFile(join(evidence, 'acceptance.json'), JSON.stringify({ date:new Date().toISOString(), root, results }, null, 2)); }
}

try {
  await step('A01', '安装与启动', '全新目录启动主控，GET /healthz、/、安全入口和静态文件', 'SQLite 自动初始化，页面和健康检查返回 200', async () => {
    assert.equal((await request('/healthz')).body.storage, 'sqlite');
    const html = await request('/'); assert.equal(html.status, 200); assert.match(html.body, /\/static\//);
    assert.equal((await request(`/${config.ADMIN_PATH}`)).status, 200);
    const asset = html.body.match(/src="([^"]+\.js)"/)[1]; assert.equal((await request(asset)).status, 200);
    const publicConfig = (await request('/api/config')).body;
    assert.equal('turnstile_enabled' in publicConfig, false);
    return {health:200, home:200, admin:200, static:200, schema:controller.env.DB.prepare('PRAGMA user_version').first().user_version};
  });
  await step('A02', '管理员登录', 'POST /<ADMIN_PATH>/api login', '获得有效会话，可以读取设置', async () => {
    const login = await request(`/${config.ADMIN_PATH}/api`, {action:'login',username:'admin',password:config.API_SECRET}, '');
    assert.equal(login.status,200); token=login.body.token; assert.ok(token);
    const settings=await admin({action:'get_settings'});assert.equal(settings.status,200);
    assert.equal(settings.body.settings.username,'admin');
    return {login:200, settings:200};
  });
  await step('A02b', '日文默认语言设置', '保存 default_language=ja，读取后台设置及公共配置', '两处均返回 ja，并在 A15 重启后保留', async () => {
    const saved = await admin({action:'save_settings',settings:{default_language:'ja'}});
    assert.equal(saved.status,200);
    assert.equal((await admin({action:'get_settings'})).body.settings.default_language,'ja');
    assert.equal((await request('/api/config')).body.default_language,'ja');
    return {saved:200,adminLanguage:'ja',publicLanguage:'ja'};
  });
  await step('A03', '并发添加与数据隔离', '同时添加 10 台服务器，并在同一毫秒分别上报', '全部成功，数据按 UUID 隔离，无分区串台', async () => {
    const added=await Promise.all(Array.from({length:10},(_,i)=>admin({action:'add',name:`Agent ${i+1}`})));
    added.forEach(r=>assert.equal(r.status,200,JSON.stringify(r.body)));
    mainId=added[0].body.id; hiddenId=added[1].body.id; const timestamp=Date.now();
    await Promise.all(added.map((r,i)=>report(r.body.id,{cpu:i+1,ram_total:1024,ram_used:256,timestamp,net_rx:10000,net_tx:20000})));
    for(let i=0;i<10;i++) assert.equal((await request(`/api/server?id=${added[i].body.id}`)).body.cpu,i+1);
    return {created:10, uniqueIds:new Set(added.map(r=>r.body.id)).size, correctlyIsolated:10};
  });
  await step('A03b', '服务器导入导出、编辑、删除', '添加临时服务器，导出、删除后导入原记录，再清理', '成功导入一条，重复 ID 跳过，删除级联清理历史', async () => {
    const added=await admin({action:'add',name:'Import fixture'}); assert.equal(added.status,200);
    const id=added.body.id; await report(id,{cpu:17,timestamp:Date.now()});
    const exported=await admin({action:'export_servers'}); const row=exported.body.servers.find(s=>s.id===id); assert.ok(row);
    assert.equal((await admin({action:'delete',id})).status,200);
    assert.equal(controller.env.DB.prepare('SELECT count(*) n FROM metrics_history WHERE server_id=?').bind(id).first().n,0);
    const imported=await admin({action:'import_servers',servers:[row,row,{id:'invalid'}]});
    assert.equal(imported.body.imported,1); assert.equal(imported.body.skipped,2);
    await edit(id,{name:'Restored fixture',region:'DE'});
    const saved=(await admin({action:'list'})).body.servers.find(s=>s.id===id); assert.equal(saved.name,'Restored fixture');
    assert.equal((await admin({action:'delete',id})).status,200);
    return {imported:1,skipped:2,edit:true,cascade:true};
  });
  await step('A04', 'HTTP 配置协商', '上报 schema 7，再带返回 MD5 重报同一包', '返回配置及 204；重复包只保留一条历史', async () => {
    const data={id:mainId,secret:config.API_SECRET,metrics:{cpu:42,timestamp:Date.now()}};
    // Header names are the Agent protocol, not controller implementation details.
    const {AGENT_CONFIG_SCHEMA_HEADER,AGENT_CONFIG_MD5_HEADER}=await import('../src/utils/agentConfig.js');
    const actual=await request('/update',data,'',{[AGENT_CONFIG_SCHEMA_HEADER]:'7'});
    assert.equal(actual.status,200);assert.match(actual.body,/schema_version=7/);
    const md5=actual.headers.get(AGENT_CONFIG_MD5_HEADER);assert.ok(md5);
    assert.equal((await request('/update',data,'',{[AGENT_CONFIG_SCHEMA_HEADER]:'7',[AGENT_CONFIG_MD5_HEADER]:md5})).status,204);
    const n=controller.env.DB.prepare('SELECT count(*) AS n FROM metrics_history WHERE server_id=? AND timestamp=?').bind(mainId,data.metrics.timestamp).first().n;
    assert.equal(n,1); return {configuration:200, unchanged:204, duplicateRows:n};
  });
  await step('A05', 'WS 上报、面板推送与配置下发', '实际连接 Agent WS 与浏览器 WS，发送指标并修改配置', '收到落库确认、实时指标和配置推送', async () => {
    const before = (await request('/api/servers')).body.servers.find(s => s.id === mainId);
    const viewer=await openSocket('/api/ws');viewer.ws.send(JSON.stringify({type:'subscribe',scope:'all',ids:[mainId]}));await viewer.find(m=>m.type==='subscribed');
    const agent=await openSocket('/update', {'X-Agent-Version':'fixture-7'});agent.ws.send(JSON.stringify({id:mainId,secret:config.API_SECRET,metrics:{cpu:88,ping_ct:306,loss_ct:0,timestamp:Date.now()},config_schema:'7',config_md5:''}));
    assert.ok(Number.isFinite(Date.parse(agent.handshakeDate)), 'Agent WS handshake must provide a Date header for clock calibration');
    const ack=await agent.find(m=>m.type==='ack');assert.equal(ack.persisted,true);
    assert.equal((await request(`/api/server?id=${mainId}`)).body.agent_version, 'fixture-7');
    const update=await viewer.find(m=>m.type==='batchUpdate');assert.equal(update.updates[0].serverId,mainId);
    const persistedWindow = (await request('/api/servers')).body.servers.find(s => s.id === mainId);
    assert.equal(persistedWindow.ping.at(-1).ct,306,'new history must invalidate the cached window');
    await wait(20);
    agent.ws.send(JSON.stringify({id:mainId,secret:config.API_SECRET,metrics:{cpu:88,ping_ct:65,loss_ct:10,timestamp:Date.now()}}));
    const live = await viewer.find(m => m.type === 'batchUpdate' && m.updates.some(u => u.serverId === mainId && u.samples.some(s => s.payload?.ping_ct === 65)));
    const sample = live.updates.find(u => u.serverId === mainId).samples.find(s => s.payload?.ping_ct === 65);
    const liveWindow = updateLatencyWindow(before,sample.payload,sample.ts);
    assert.equal(liveWindow.ping.at(-1).ct,65);
    assert.equal(liveWindow.loss.at(-1).ct,10);
    const pendingSnapshot = (await request('/api/servers')).body.servers.find(s => s.id === mainId);
    assert.ok(pendingSnapshot.sample_timestamp < sample.ts, 'Live sample must still be awaiting persistence');
    assert.ok(pendingSnapshot.last_updated >= sample.ts, 'Receipt time must include the pending report');
    const liveSample = { ...sample.payload, sample_timestamp: sample.ts, report_timestamp: pendingSnapshot.last_updated };
    const restored = reconcileDashboardSnapshot(pendingSnapshot, { ...persistedWindow, ...liveSample, ...liveWindow }, liveSample);
    assert.equal(restored.ping.at(-1).ct,65,'snapshot refresh must retain unpersisted live latency');
    assert.equal(restored.loss.at(-1).ct,10,'snapshot refresh must retain unpersisted live loss');
    await edit(mainId,{report_interval:120});await agent.find(m=>m.type==='config');
    agent.ws.close();viewer.ws.close();return {persisted:ack.persisted,realtime:true,configPush:true,handshakeDate:true,latency:{persisted:306,live:65,loss:10,points:liveWindow.ping.length,retainedAfterRefresh:true}};
  });
  await step('A06', '地区识别与手动覆盖', '同机回环上报后指定 JP 地区', '自动识别 US，手动值 JP 优先', async () => {
    await report(mainId,{cpu:44,timestamp:Date.now()});assert.equal((await request(`/api/server?id=${mainId}`)).body.region,'US');
    await edit(mainId,{region:'JP'});assert.equal((await request(`/api/server?id=${mainId}`)).body.region,'JP');
    return {sameHostAuto:'US',manual:'JP'};
  });
  await step('A07', '历史查询', '请求 10 分钟、1 小时、24 小时、7 天历史', '各范围均返回按时间排序的数据', async () => {
    for(const hours of [0.167,1,24,168]) {const response=await request(`/api/history/all?id=${mainId}&hours=${hours}`);assert.equal(response.status,200);assert.ok(response.body.length>0);}
    return {ranges:[0.167,1,24,168],status:200};
  });
  await step('A08', '手动备份', 'POST /<ADMIN_PATH>/backup，实际下载并打开 SQLite 文件', '完整性通过，包含设置、服务器和历史', async () => {
    const response=await fetch(base+`/${config.ADMIN_PATH}/backup`,{method:'POST',headers:{Authorization:`Bearer ${token}`}});assert.equal(response.status,200);
    backupPath=join(root,'snapshot.sqlite');await writeFile(backupPath,Buffer.from(await response.arrayBuffer()));
    const backup=new DatabaseSync(backupPath,{readOnly:true});
    assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    const count=backup.prepare('SELECT count(*) AS n FROM servers').get().n;assert.equal(count,10);
    assert.ok(backup.prepare('SELECT count(*) AS n FROM metrics_history').get().n>0);backup.close();
    return {integrity:'ok',servers:count,downloaded:true};
  });
  await step('A09', '通知失败补发', '本地 Webhook 返回 503，执行离线检测和发送，再改为 200 重试', '失败记录保留，重试成功后标记送达', async () => {
    assert.equal((await admin({action:'save_settings',settings:{tg_notify:'2',notification_webhook_enabled:'true',notification_webhook_url:`http://127.0.0.1:${webhook.address().port}/notify`}})).status,200);
    const row=controller.env.DB.prepare('SELECT data FROM server_latest WHERE server_id=?').bind(mainId).first();const data=JSON.parse(row.data);data.timestamp=Date.now()-600000;
    controller.env.DB.prepare('UPDATE server_latest SET timestamp=?,data=? WHERE server_id=?').bind(data.timestamp,JSON.stringify(data),mainId).run();
    controller.env.DB.prepare('UPDATE server_presence SET last_seen=? WHERE server_id=?').bind(data.timestamp,mainId).run();
    await checkOfflineNodes(controller.env);await drainNotifications(controller.env.DB);
    let queued=controller.env.DB.prepare('SELECT * FROM notification_outbox WHERE delivered_at IS NULL').all().results;assert.equal(queued.length,1);assert.equal(queued[0].attempts,1);
    await checkOfflineNodes(controller.env);assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox').first().n,1);
    webhookStatus=200;await drainNotifications(controller.env.DB,{now:queued[0].next_attempt});
    assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE delivered_at IS NULL').first().n,0);
    return {failedHttpAttempts:deliveries.filter(d=>d.status===503).length,successfulRetry:deliveries.filter(d=>d.status===200).length,duplicateEvents:0};
  });
  await step('A10', '资源告警与流量、到期报告', '通过 HTTP 上报高 CPU 样本，执行定时任务对应服务', '资源告警和各报告进入持久队列，重复检查不重复入队', async () => {
    const settings={traffic_report_enabled:'true',notification_timezone:'UTC',expire_notification_time:'0',expire_reminder:'7',resource_alert_rules:[{id:'cpu-rule',name:'High CPU',metric:'cpu',threshold:80,servers:[mainId],intervalMinutes:5,mode:'average'}]};
    assert.equal((await admin({action:'save_settings',settings})).status,200);
    const now=Date.now();const samples=Array.from({length:6},(_,i)=>({ts:now-(5-i)*60000,metrics:{cpu:99,ram_total:1024,ram_used:512,net_rx:10000,net_tx:20000}}));
    assert.equal((await request('/update',{id:mainId,secret:config.API_SECRET,samples},'')).status,200);
    await checkResourceAlerts(controller.env);
    assert.ok(controller.env.DB.prepare('SELECT value FROM runtime_state WHERE key=?').bind('resource_alert_windows_v1').first());
    const resource=controller.env.DB.prepare('SELECT payload FROM notification_outbox ORDER BY id DESC LIMIT 1').first();assert.match(resource.payload,/High CPU|资源/);
    await checkTrafficReports(controller.env.DB,{now});
    await edit(mainId,{expire_date:new Date(now+2*86400000).toISOString().slice(0,10),auto_renewal:'0'});
    await checkExpiringServers(controller.env.DB,{now});
    const before=controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox').first().n;
    await checkTrafficReports(controller.env.DB,{now});await checkExpiringServers(controller.env.DB,{now});
    assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox').first().n,before);
    return {queuedEvents:before,duplicateReportEvents:0};
  });
  await step('A11', '异常输入与权限', '错误密码、密钥、JSON、时间范围；匿名备份；隐藏服务器 WS 订阅', '返回 400/401/404；隐藏服务器不推送', async () => {
    assert.equal((await request(`/${config.ADMIN_PATH}/api`,{action:'login',username:'admin',password:'wrong'},'')).status,401);
    assert.equal((await request('/update',{id:mainId,secret:'wrong',metrics:{cpu:1}},'')).status,401);
    const invalid=await fetch(base+'/update',{method:'POST',body:'{'});assert.equal(invalid.status,400);
    assert.equal((await request(`/api/history/all?id=${mainId}&hours=169`)).status,400);
    assert.equal((await report(mainId,[])).status,400);
    assert.equal((await request(`/${config.ADMIN_PATH}/api`,null)).status,400);
    assert.equal((await request(`/${config.ADMIN_PATH}/api`,[])).status,400);
    assert.equal((await fetch(base+'/update',{method:'POST',body:'x'.repeat(2097153)})).status,413);
    assert.equal((await request('/static/missing.js')).status,404);
    assert.equal((await fetch(base+`/${config.ADMIN_PATH}/backup`,{method:'POST'})).status,401);
    await edit(hiddenId,{is_hidden:'1'});
    assert.equal((await request(`/api/server?id=${hiddenId}`,undefined,'')).status,404);
    const spy=await openSocket(`/api/ws?subscribe=${hiddenId}`);await report(hiddenId,{cpu:95,timestamp:Date.now()});await wait(200);
    assert.equal(spy.messages.some(m=>m.type==='batchUpdate'),false);spy.ws.close();
    await admin({action:'save_settings',settings:{is_public:'false'}});
    assert.equal((await request('/api/servers',undefined,'')).status,401);assert.equal(await rejectedSocket('/api/ws'),401);
    const authenticated=await openSocket(`/api/ws?token=${encodeURIComponent(token)}`);authenticated.ws.close();
    await admin({action:'save_settings',settings:{is_public:'true'}});
    return {malformedJson:400,badSecret:401,anonymousBackup:401,hiddenRest:404,hiddenWsUpdates:0,privateWs:401};
  });
  await step('A12', '写入故障不能确认成功', '用 SQLite 故障触发器阻止历史写入，分别 HTTP/WS 上报', 'HTTP 500；WS 返回 error，不返回 persisted:true', async () => {
    const db=controller.env.DB;db.exec("CREATE TRIGGER simulated_disk_failure BEFORE INSERT ON metrics_history BEGIN SELECT RAISE(ABORT,'simulated disk error'); END");
    try {
      assert.equal((await report(mainId,{cpu:12,timestamp:Date.now()})).status,500);
      const agent=await openSocket('/update');agent.ws.send(JSON.stringify({id:hiddenId,secret:config.API_SECRET,metrics:{cpu:13,timestamp:Date.now()}}));
      const error=await agent.find(m=>m.type==='error');assert.equal(error.code,500);assert.equal(agent.messages.some(m=>m.persisted===true),false);agent.ws.close();
    } finally {db.exec('DROP TRIGGER simulated_disk_failure');}
    return {http:500,wsError:500,falsePersistenceAck:0};
  });
  await step('A13', '50 Agent / 10 面板边界', '补齐 50 台，拒绝第 51 台，建立 50 条 Agent WS 和 10 条看板 WS', '全部正确确认与广播，主控保持健康', async () => {
    await edit(hiddenId,{is_hidden:'0'});
    const added=await Promise.all(Array.from({length:40},(_,i)=>admin({action:'add',name:`Load ${i+11}`})));added.forEach(r=>assert.equal(r.status,200));
    assert.equal((await admin({action:'add',name:'Over capacity'})).status,400);
    const servers=(await admin({action:'list'})).body.servers;assert.equal(servers.length,50);
    const viewers=await Promise.all(Array.from({length:10},()=>openSocket('/api/ws')));
    for(const v of viewers) {v.ws.send(JSON.stringify({type:'subscribe',scope:'all',ids:servers.map(s=>s.id)}));await v.find(m=>m.type==='subscribed');}
    const agents=await Promise.all(servers.map(()=>openSocket('/update')));
    const start=performance.now();
    agents.forEach((a,i)=>a.ws.send(JSON.stringify({id:servers[i].id,secret:config.API_SECRET,metrics:{cpu:i+1,ram_total:1024,ram_used:512,timestamp:Date.now()}})));
    await Promise.all(agents.map(a=>a.find(m=>m.type==='ack')));
    for(const v of viewers) {await v.find(()=>new Set(v.messages.filter(m=>m.type==='batchUpdate').flatMap(m=>m.updates.map(u=>u.serverId))).size===50);}
    const elapsed=Math.round(performance.now()-start);assert.ok(elapsed<5000,`Batch took ${elapsed}ms`);
    assert.equal((await request('/healthz')).status,200);
    for(const {ws} of [...agents,...viewers]) ws.close();
    return {agentConnections:50,viewerConnections:10,deliveredServerUpdates:500,batchMs:elapsed,overCapacity:400};
  });
  await step('A14', '历史边界与清理', '写入近 7 天样本，模拟过期记录并执行清理', '7 天内可查，过期历史删除，最新状态仍保留', async () => {
    assert.equal((await report(mainId,{cpu:31,timestamp:Date.now()-7*86400000+60000})).status,200);
    assert.equal((await report(mainId,{cpu:32,timestamp:Date.now()-8*86400000})).status,400);
    controller.env.DB.prepare('UPDATE metrics_history SET timestamp=? WHERE id=(SELECT min(id) FROM metrics_history)').bind(Date.now()-8*86400000).run();
    cleanupHistory(controller.env.DB);assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM metrics_history WHERE timestamp < ?').bind(Date.now()-7*86400000).first().n,0);
    assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM server_latest').first().n,50);
    return {expiredHistory:0,latestStates:50};
  });
  await step('A15', '重启与通知持久化', '关闭并重启主控，使用原会话读取服务器、历史、未发送通知', '50 台服务器和待发送事件保留，原 JWT 仍有效', async () => {
    const pending=controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE delivered_at IS NULL').first().n;assert.ok(pending>0);
    await admin({action:'save_settings',settings:{is_public:'false'}});
    await wait(100);for(const ws of sockets) ws.terminate();
    await controller.close();controller=await createController(config);address=await controller.listen(0,'127.0.0.1');base=`http://127.0.0.1:${address.port}`;
    assert.equal((await request('/api/servers',undefined,'')).status,401);
    const list=await admin({action:'list'});assert.equal(list.status,200);assert.equal(list.body.servers.length,50);
    assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE delivered_at IS NULL').first().n,pending);
    await controller.env.REALTIME_HUB.resourceAlerts.load();
    assert.ok(controller.env.REALTIME_HUB.resourceAlerts.windows.size > 0);
    await drainNotifications(controller.env.DB);assert.equal(controller.env.DB.prepare('SELECT count(*) AS n FROM notification_outbox WHERE delivered_at IS NULL').first().n,0);
    assert.equal((await admin({action:'get_settings'})).body.settings.default_language,'ja');
    assert.equal((await request('/api/config')).body.default_language,'ja');
    return {servers:50,persistedPendingEvents:pending,redelivered:true,jwtStillValid:true,privateStillEnforced:true,defaultLanguage:'ja'};
  });
  await step('A16', '手动恢复', '停机后将 A08 备份复制到新的数据目录并启动', '恢复到 10 台服务器，数据库完整性通过', async () => {
    await controller.close();const restore=join(root,'restore');await mkdir(restore);await copyFile(backupPath,join(restore,'monitor.sqlite'));
    controller=await createController({...config,DATA_DIR:restore});address=await controller.listen(0,'127.0.0.1');base=`http://127.0.0.1:${address.port}`;
    assert.equal((await admin({action:'list'})).body.servers.length,10);
    assert.equal(controller.env.DB.prepare('PRAGMA integrity_check').first().integrity_check,'ok');
    return {restoredServers:10,integrity:'ok'};
  });
  await step('A17', '清空历史保留配置与最新状态', '上报指标后调用清空历史接口，再执行待写缓冲清理', '历史为空，最新状态和服务器配置保留，停止不恢复旧历史', async () => {
    const agent=await openSocket('/update');
    agent.ws.send(JSON.stringify({id:mainId,secret:config.API_SECRET,metrics:{cpu:77,timestamp:Date.now()}}));
    await agent.find(m=>m.type==='ack');
    agent.messages.length=0;
    agent.ws.send(JSON.stringify({id:mainId,secret:config.API_SECRET,metrics:{cpu:78,timestamp:Date.now()+1}}));
    await agent.find(m=>m.type==='ack');
    assert.equal((await request('/clearHistory',{})).status,200);
    await controller.env.REALTIME_HUB.close();
    const db=controller.env.DB;
    assert.equal(db.prepare('SELECT count(*) n FROM metrics_history').first().n,0);
    assert.equal(db.prepare('SELECT count(*) n FROM servers').first().n,10);
    assert.ok(db.prepare('SELECT data FROM server_latest WHERE server_id=?').bind(mainId).first());
    return {historyRows:0,servers:10,latestRetained:true,stalePendingRows:0};
  });
} finally {
  for(const ws of sockets) ws.terminate();
  await controller.close();
  await new Promise(resolve=>webhook.close(resolve));
  console.log(`Evidence: ${join(evidence,'acceptance.json')}`);
}
