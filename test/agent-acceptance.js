import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, chmod, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { WebSocket } from 'ws';
import { createController } from '../src/server.js';

// Isolated runtime prepared before testing. Never installs a service on the host.
const root = await mkdtemp(join(tmpdir(),'native-agent-acceptance-'));
const evidence = resolve('output/test-results/agent-integration');
await mkdir(evidence,{recursive:true});
const version = JSON.parse(await readFile('agent/release.json','utf8')).version;
const osName = {win32:'windows',darwin:'darwin',linux:'linux',freebsd:'freebsd'}[platform()];
const archName = {x64:'amd64',ia32:'386',arm64:'arm64',arm:'armv7'}[arch()];
const asset = `cf-probe-${osName}-${archName}${platform()==='win32'?'.exe':''}`;
const binary = resolve('agent-dist',version,asset);
await readFile(binary); // Fail before cases if the native build is missing.
const config = {API_SECRET:'native-agent-acceptance-fixture-key',ADMIN_PATH:'native-Agent-Acceptance-92',DATA_DIR:join(root,'data'),PUBLIC_IP:'8.8.8.8',SCHEDULER_ENABLED:'false'};
const controller = await createController(config);
const address = await controller.listen(0,'127.0.0.1');
const base = `http://127.0.0.1:${address.port}`;
const badMirror = createServer((req,res)=>{
  res.setHeader('Content-Type','text/plain');
  if (req.url.endsWith('/latest')) res.end(version+'\n');
  else if (req.url.endsWith('/checksums.txt')) res.end('0'.repeat(64)+`  ${asset}\n`);
  else res.end('This corrupted file must never execute');
});
badMirror.listen(0,'127.0.0.1'); await once(badMirror,'listening');
const run = promisify(execFile);
const results = []; const agentLogs = createWriteStream(join(evidence,'native-agent.log'));
let token='', id, agent, logs='', viewer;
const updates=[];
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(check,label,timeout=90000) {
  const start=Date.now();
  while(Date.now()-start<timeout) { if(await check()) return; if(agent?.exitCode!==null&&agent?.exitCode!==undefined) throw new Error(`Agent exited: ${logs.slice(-1500)}`); await wait(250); }
  throw new Error(`Timeout: ${label}; ${logs.slice(-1800)}`);
}
async function api(path,data) {
  const response=await fetch(base+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(10000)});
  assert.equal(response.status,200,await response.clone().text());return response.json();
}
const admin=data=>api(`/${config.ADMIN_PATH}/api`,data);
async function edit(changes) {
  const current=(await admin({action:'list'})).servers.find(s=>s.id===id);
  await admin({...current,...changes,action:'edit'});
}
async function stopAgent() {
  if(!agent||agent.exitCode!==null) return;
  const child=agent, ended=once(child,'exit');
  const timer=setTimeout(()=>child.kill('SIGKILL'),10000);
  child.kill('SIGTERM');
  try { await ended; } finally { clearTimeout(timer);agent=null; }
}
function startAgent() {
  agent=spawn(binary,['run','-config',join(root,'config.conf'),'-debug=1'],{env:{...process.env,TMPDIR:root,TMP:root,TEMP:root},stdio:['ignore','pipe','pipe']});
  for(const stream of [agent.stdout,agent.stderr]) stream.on('data',chunk=>{logs=(logs+chunk).slice(-200000);agentLogs.write(chunk);});
}
async function step(id,feature,operation,expected,callback) {
  const start=Date.now();
  try { const detail=await callback();results.push({id,feature,operation,expected,status:'PASS',durationMs:Date.now()-start,evidence:detail});console.log(JSON.stringify(results.at(-1))); }
  catch(error){results.push({id,feature,operation,expected,status:'FAIL',evidence:error.stack});throw error;}
  finally {await writeFile(join(evidence,'native-acceptance.json'),JSON.stringify({date:new Date().toISOString(),version,platform:platform(),root,results},null,2));}
}
try {
  token=(await admin({action:'login',username:'admin',password:config.API_SECRET})).token;
  id=(await admin({action:'add',name:'Native Agent acceptance'})).id;
  await edit({connection_mode:'http',report_interval:30,collect_interval:0});
  await writeFile(join(root,'config.conf'),`SERVER_ID="${id}"\nSECRET="${config.API_SECRET}"\nWORKER_URL="${base}/update"\nREPORT_INTERVAL="30"\nCONNECTION_MODE="http"\nAUTO_UPDATE="1"\n`,{mode:0o600});
  const bootstrap=join(root,'install.sh');await writeFile(bootstrap,await (await fetch(base+'/agent/install.sh')).text());await chmod(bootstrap,0o700);
  await step('NA01','原生程序下载','从主控运行一键下载脚本的 version 命令，查询版本目录','下载并校验本机程序，版本和主控一致',async()=>{
    if(platform()==='win32') throw new Error('Run this acceptance suite on Linux or macOS; Windows service checks use its CI platform job.');
    const result=await run('sh',[bootstrap,'version',`--download-url=${base}/agent`],{timeout:90000});
    assert.ok(result.stdout.includes(version));
    assert.equal((await api('/api/config')).last_agent_version,version);
    return {version,asset,bootstrap:true};
  });
  await step('NA02','真实 Agent HTTP 上报和版本检查','使用旧 WORKER_URL 配置启动 Go 程序','读取旧配置、写入真实采集指标，从主控检查更新',async()=>{
    startAgent();
    await until(async()=>{const s=await api(`/api/server?id=${id}`);return s.agent_version===version&&Number(s.ram_total)>0;},'HTTP report');
    await until(()=>logs.includes('current version is up to date'),'controller update check');
    const s=await api(`/api/server?id=${id}`);assert.ok(Number(s.cpu_cores)>0);
    return {version:s.agent_version,os:s.os,cpuCores:s.cpu_cores,ramTotal:s.ram_total};
  });
  await step('NA03','HTTP 转 WebSocket 与看板推送','后台切换 auto，订阅看板 WebSocket','Agent 自动连接 WS，实时推送且确认 SQLite 写入',async()=>{
    await edit({connection_mode:'auto',collect_interval:2,wss_report_interval:2});
    viewer=new WebSocket(base.replace('http:','ws:')+'/api/ws?subscribe=all',{headers:{Authorization:`Bearer ${token}`}});
    viewer.on('message',data=>{try{updates.push(JSON.parse(data));}catch{}});await once(viewer,'open');
    viewer.send(JSON.stringify({type:'subscribe',scope:'all',ids:[id]}));
    await until(()=>updates.some(message=>message.type==='subscribed'),'viewer subscription',5000);
    await until(()=>logs.includes('WSS connected')&&logs.includes('persisted=true'),'WS connection and persistence');
    await until(()=>updates.some(m=>JSON.stringify(m).includes(id)&&m.type!=='hello'),'viewer live update');
    return {connected:true,persisted:true,viewerMessages:updates.length};
  });
  await step('NA04','配置下发与 HTTP 回退模式','下发 4 个节点、流量重置日及 http 模式','本地配置正确更新并继续 HTTP 上报',async()=>{
    const node=`127.0.0.1:${address.port}`;
    await edit({connection_mode:'http',reset_day:0,node_1:node,node_2:node,node_3:node,node_4:node});
    await until(async()=>{const raw=await readFile(join(root,'config.conf'),'utf8');return raw.includes('CONNECTION_MODE="http"')&&raw.includes(`NODE_4="${node}"`);},'remote configuration');
    logs='';await until(()=>logs.includes('report response http=204')||logs.includes('report response http=200'),'HTTP after WS mode change');
    const raw=await readFile(join(root,'config.conf'),'utf8');assert.ok(raw.includes('RESET_DAY="0"'));assert.ok(raw.includes('CONTROLLER_URL='));
    return {fourNodes:true,http:true,resetDay:0,legacyAndNativeUrl:true};
  });
  await step('NA05','Agent 重启与数据保留','停止原生进程后使用原配置及流量文件重启','配置、流量文件和服务器历史保留，Agent 恢复上报',async()=>{
    await stopAgent();
    const cfg=await readFile(join(root,'config.conf'),'utf8');const traffic=await readFile(join(root,'traffic.dat'));
    assert.ok(traffic.length>0);logs='';startAgent();await until(()=>logs.includes('report response http='),'report after restart');
    const restored=await readFile(join(root,'config.conf'),'utf8');assert.equal(restored,cfg);
    assert.ok(controller.env.DB.prepare('SELECT COUNT(*) AS n FROM metrics_history WHERE server_id=?').bind(id).first().n>0);
    return {trafficFileBytes:traffic.length,configPreserved:true,historyPreserved:true};
  });
  await step('NA06','损坏下载与不存在的版本','从损坏镜像下载，以及指定未发布版本','脚本失败，不执行损坏文件，不退回上游仓库',async()=>{
    for(const args of [[`--download-url=http://127.0.0.1:${badMirror.address().port}/agent`],[`--download-url=${base}/agent`,'--install-version=v99.99.99']]){
      await assert.rejects(run('sh',[bootstrap,'version',...args],{timeout:30000}),error=>error.code!==0);
    }
    return {checksumRejected:true,missingVersionRejected:true};
  });
} finally {
  await stopAgent();viewer?.terminate();await controller.close();badMirror.closeAllConnections();await new Promise(resolve=>badMirror.close(resolve));agentLogs.end();
  await rm(root,{recursive:true,force:true});
}
