// Real installation/update/uninstall in disposable Linux containers. No host services.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import https from 'node:https';

const exec=promisify(execFile);
const docker=process.env.TEST_DOCKER_CLI||'docker';
const image=process.env.AGENT_TEST_IMAGE||'server-monitor:agent-native';
const systemdImage=process.env.AGENT_SYSTEMD_TEST_IMAGE;
const evidence=resolve('output/test-results/agent-integration');await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'deployment-fixture-'));
const prefix='cfsm-agent-'+randomUUID().slice(0,8), network=prefix+'-net';
const edgeNetwork=prefix+'-edge';
const names={controller:prefix+'-controller',proxy:prefix+'-proxy',agent:prefix+'-agent',systemd:prefix+'-systemd'};
const cli=async args=>(await exec(docker,args,{maxBuffer:8*1024*1024,timeout:240000})).stdout.trim();
const version=JSON.parse(await readFile('agent/release.json','utf8')).version;
// Optional immutable release built before the change, to exercise real cf-probe migration.
const legacyDirectory=process.env.AGENT_LEGACY_DIST ? resolve(process.env.AGENT_LEGACY_DIST) : null;
const oldVersion=legacyDirectory ? JSON.parse(await readFile(join(legacyDirectory,'manifest.json'),'utf8')).version : 'v1.0.99';
const [oldMajor,oldMinor]=oldVersion.replace(/^v/,'').split('.').map(Number);
const oldService=legacyDirectory&&oldMajor===1&&oldMinor<2 ? 'cf-probe' : 'jan-probe';
assert.notEqual(oldVersion,version,'Legacy fixture must precede the candidate release');
const key='agent-deployment-fixture-secret';
const adminPath='native-Agent-Deployment-92';
let token='',id,base,controllerArgs;const created=[];const results=[];
await writeFile(join(evidence,'deployment.json'),JSON.stringify({date:new Date().toISOString(),root,version,preparation:'pending',results},null,2));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(callback,label,timeout=120000) {
  const start=Date.now();let last;
  while(Date.now()-start<timeout){try{if(await callback())return;}catch(error){last=error.message;}await wait(1000);}
  throw new Error(`${label} timed out${last?': '+last:''}`);
}
async function step(id,feature,operation,expected,callback){
  const start=Date.now();try{results.push({id,feature,operation,expected,status:'PASS',durationMs:0,evidence:await callback()});results.at(-1).durationMs=Date.now()-start;console.log(JSON.stringify(results.at(-1)));}
  catch(error){results.push({id,feature,operation,expected,status:'FAIL',evidence:error.stack});throw error;}
  finally{await writeFile(join(evidence,'deployment.json'),JSON.stringify({date:new Date().toISOString(),root,version,results},null,2));}
}

// Prepare images, old version, certificate, proxy, archive and empty data directory first.
const architecture=await cli(['version','--format','{{.Server.Arch}}']);
if(!legacyDirectory) await exec(process.execPath,['scripts/agent.js','build','-targets',`linux/${architecture}`,'-version',oldVersion,'-out',join(root,'old-agent')],{timeout:180000,maxBuffer:8*1024*1024});
await mkdir(join(root,'data','agent-releases'),{recursive:true});
await cp(legacyDirectory||join(root,'old-agent',oldVersion),join(root,'data','agent-releases',oldVersion),{recursive:true});
await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','2','-subj','/CN=proxy','-addext','subjectAltName=DNS:proxy,DNS:localhost,IP:127.0.0.1'],{timeout:30000});
const certificate=await readFile(join(root,'cert.pem'));
await writeFile(join(root,'proxy.mjs'),`import https from 'node:https';import http from 'node:http';import net from 'node:net';import fs from 'node:fs';
const server=https.createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(req,res)=>{
const upstream=http.request({host:'controller',port:8080,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);});
server.on('upgrade',(req,socket,head)=>{const upstream=net.connect(8080,'controller',()=>{upstream.write(req.method+' '+req.url+' HTTP/1.1\\r\\n'+Object.entries({...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}).map(([k,v])=>k+': '+v+'\\r\\n').join('')+'\\r\\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());});server.listen(8443,'0.0.0.0');`);
await writeFile(join(root,'Dockerfile.agent'),'FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates procps && rm -rf /var/lib/apt/lists/*\nCMD ["sleep","infinity"]\n');
const installImage=prefix+'-installer';
await cli(['build','-f',join(root,'Dockerfile.agent'),'-t',installImage,root]);
if(systemdImage) await cli(['image','inspect',systemdImage]);

function request(path,data){return new Promise((resolve,reject)=>{
  const url=new URL(path,base);
  const req=https.request(url,{ca:certificate,method:data?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}},res=>{
    const chunks=[];res.on('data',d=>chunks.push(d));res.on('end',()=>{const text=Buffer.concat(chunks).toString();let body;try{body=JSON.parse(text);}catch{body=text;}resolve({status:res.statusCode,headers:res.headers,body});});
  });req.on('error',reject);req.setTimeout(10000,()=>req.destroy(new Error('HTTP timeout')));req.end(data?JSON.stringify(data):undefined);
});}
const admin=data=>request(`/${adminPath}/api`,data);
try{
  await cli(['network','create','--internal',network]);
  await cli(['network','create',edgeNetwork]);
  await cli(['run','-d','--name',names.proxy,'--network',edgeNetwork,'-p','127.0.0.1::8443','-v',`${root}:/fixture:ro`,'--entrypoint','node',image,'/fixture/proxy.mjs']);created.push(names.proxy);
  await cli(['network','connect','--alias','proxy',network,names.proxy]);
  const proxyNetworks=JSON.parse(await cli(['inspect','-f','{{json .NetworkSettings.Networks}}',names.proxy]));
  const proxyIp=proxyNetworks[network].IPAddress;
  base='https://'+await cli(['port',names.proxy,'8443/tcp']);
  await writeFile(join(evidence,'browser-fixture.json'),JSON.stringify({base,adminPath,names,network,edgeNetwork,root,installImage},null,2));
  controllerArgs=['run','-d','--name',names.controller,'--network',network,'--network-alias','controller','-e',`API_SECRET=${key}`,'-e',`ADMIN_PATH=${adminPath}`,'-e',`TRUSTED_PROXIES=${proxyIp}/32`,'-e','PUBLIC_IP=8.8.8.8','-v',`${join(root,'data')}:/app/data`,image];
  await cli(controllerArgs);created.push(names.controller);
  await cli(['run','-d','--name',names.agent,'--network',network,'-v',`${join(root,'cert.pem')}:/fixture-ca.pem:ro`,'-e','CURL_CA_BUNDLE=/fixture-ca.pem','-e','SSL_CERT_FILE=/fixture-ca.pem',installImage]);created.push(names.agent);
  if(systemdImage){
    await cli(['run','-d','--name',names.systemd,'--network',network,'--privileged','--cgroupns=private','--tmpfs','/run','--tmpfs','/run/lock','-v',`${join(root,'cert.pem')}:/fixture-ca.pem:ro`,'-e','CURL_CA_BUNDLE=/fixture-ca.pem','-e','SSL_CERT_FILE=/fixture-ca.pem','-e','container=docker',systemdImage,'/sbin/init']);created.push(names.systemd);
    await until(async()=> ['running','degraded'].includes(await cli(['exec',names.systemd,'systemctl','show','--property=SystemState','--value'])),'systemd environment preparation',30000);
    // systemd services do not inherit docker-exec's SSL_CERT_FILE environment.
    await cli(['exec',names.systemd,'sh','-c','cp /fixture-ca.pem /usr/local/share/ca-certificates/monitor-fixture.crt && update-ca-certificates']);
  }
  await step('ND01','Docker 启动和归档','在隔离 bridge 中启动主控和独立 TLS 反代','健康检查、TLS 登录、2 个 Linux 产物及持久归档可用',async()=>{
    await until(async()=> (await request('/healthz')).status===200,'controller startup');
    const login=await admin({action:'login',username:'admin',password:key});assert.equal(login.status,200);token=login.body.token;
    assert.match(login.headers['set-cookie'][0],/Secure/);
    for (const path of ['/install.sh', '/install-alpine.sh', '/install-openwrt.sh', '/install-synology.sh', '/install-mac.sh', '/cf-server-monitor.ps1', '/uninstall.sh', '/uninstall.ps1']) assert.equal((await request(path)).status,404,path);
    const versions=await request('/agent/releases.json');assert.equal(versions.status,200);
    const expected = ['cf-probe-linux-amd64','cf-probe-linux-arm64'].sort();
    assert.deepEqual(versions.body.find(v=>v.version===version).assets.map(a=>a.name).sort(),expected);
    const archived=JSON.parse(await readFile(join(root,'data','agent-releases',version,'manifest.json'),'utf8'));assert.deepEqual(archived.assets.map(a=>a.name).sort(),expected);
    for (const release of versions.body) {
      assert.ok(release.assets.every(asset=>expected.includes(asset.name)));
      for (const name of ['cf-probe-freebsd-amd64','cf-probe-freebsd-arm64']) assert.equal((await request(`/agent/${release.version}/${name}`)).status,404);
    }
    id=(await admin({action:'add',name:'Native Linux TLS Agent'})).body.id;
    await writeFile(join(evidence,'browser-fixture.json'),JSON.stringify({base,adminPath,id,names,network,edgeNetwork,root,installImage},null,2));
    return {tls:true,secureCookie:true,targets:2,archived:true,unsupportedDownloads:404,internalNetwork:true};
  });
  await step('ND02','一键安装及 HTTPS/WSS 上报','在独立 Linux 环境从主控安装旧版测试程序并开启自动更新','原生服务启动，正确连接 TLS 主控，等待更新',async()=>{
    const installed=await cli(['exec',names.agent,'sh','-c','curl -fsSL https://proxy:8443/agent/install.sh -o /tmp/install.sh && sh /tmp/install.sh install --install-version='+oldVersion+' -id='+id+' -secret='+key+' -url=https://proxy:8443/update -auto_update=1 -debug=1']);
    await writeFile(join(evidence,'linux-install.log'),installed);
    assert.ok((await cli(['exec',names.agent,'/usr/local/bin/'+oldService,'version'])).includes(oldVersion));
    await until(async()=> (await request('/api/server?id='+id)).body.agent_version===oldVersion,'native TLS report',45000);
    await until(async()=> (await cli(['exec',names.agent,'cat','/var/log/'+oldService+'.log'])).includes('WSS connected'),'native WSS',45000);
    return {installedVersion:oldVersion,tlsAgent:true,wssConnected:true};
  });
  await step('ND03','实际自动更新与配置保留','等待旧版从主控下载新版并由原生服务更新重启','安装文件和上报版本变为当前版本，配置及流量文件保留',async()=>{
    await until(async()=> (await cli(['exec',names.agent,'/usr/local/bin/jan-probe','version'])).includes(version),'binary self update');
    await until(async()=> (await request('/api/server?id='+id)).body.agent_version===version,'report after self update');
    const cfg=await cli(['exec',names.agent,'cat','/etc/config/cf-probe/config.conf']);
    assert.ok(cfg.includes(id));assert.ok(cfg.includes('AUTO_UPDATE="1"'));assert.ok(cfg.includes('CONTROLLER_URL="https://proxy:8443/update"'));
    await cli(['exec',names.agent,'test','-s','/etc/config/cf-probe/traffic.dat']);
    const log=await cli(['exec',names.agent,'cat','/var/log/'+oldService+'.log']);assert.ok(log.includes('auto update scheduled target='+version));
    const currentLog=await cli(['exec',names.agent,'cat','/var/log/jan-probe.log']);assert.ok(currentLog.includes('startup check and every 24h'));
    if(legacyDirectory) await cli(['exec',names.agent,'test','!','-e','/usr/local/bin/cf-probe']);
    await cli(['exec',names.agent,'sh','-c','test "$(cat /proc/$(cat /run/jan-probe.pid)/comm)" = jan-probe']);
    await writeFile(join(evidence,'linux-update.log'),log+'\n'+currentLog);
    return {from:oldVersion,to:version,service:'jan-probe',legacyServiceMigrated:oldService==='cf-probe',configPreserved:true,trafficPreserved:true,dailyChecks:true};
  });
  await step('ND04','主控重建持久化','删除测试主控容器并使用原数据卷重新创建','历史及两个 Agent 版本保留，探针恢复连接',async()=>{
    const before=(await request('/api/server?id='+id)).body;
    await cli(['rm','-f',names.controller]);await cli(controllerArgs);
    await until(async()=> (await request('/healthz')).status===200,'controller recreation');
    assert.equal((await request('/api/server?id='+id)).body.agent_version,version);
    assert.ok((await request('/agent/releases.json')).body.some(v=>v.version===oldVersion));
    await until(async()=> Number((await request('/api/server?id='+id)).body.last_updated)>Number(before.last_updated),'fresh report after controller restart',180000);
    return {dataRetained:true,oldVersionRetained:true,reconnected:true};
  });
  await step('ND05','未启用自动更新的安装','覆盖安装显式关闭 AUTO_UPDATE，再通过主控下发配置','本地开关保持关闭，进程不上报自动更新任务，配置与流量保留',async()=>{
    await cli(['exec',names.agent,'/usr/local/bin/jan-probe','install','-auto_update=0','-debug=1']);
    const server=(await admin({action:'list'})).body.servers.find(s=>s.id===id);
    assert.equal((await admin({...server,action:'edit',auto_update:'1',collect_interval:2,report_interval:30})).status,200);
    await until(async()=> (await cli(['exec',names.agent,'cat','/etc/config/cf-probe/config.conf'])).includes('COLLECT_INTERVAL="2"'),'remote configuration after manual update');
    const cfg=await cli(['exec',names.agent,'cat','/etc/config/cf-probe/config.conf']);assert.ok(cfg.includes('AUTO_UPDATE="0"'));assert.ok(cfg.includes(id));
    const log=await cli(['exec',names.agent,'cat','/var/log/jan-probe.log']);
    const recent=log.slice(log.lastIndexOf('Jan Monitor Probe started'));
    assert.ok(recent.includes('auto update disabled: local AUTO_UPDATE=0'));
    assert.ok(!recent.includes('auto update enabled:')&&!recent.includes('auto update scheduled'));
    await cli(['exec',names.agent,'test','-s','/etc/config/cf-probe/traffic.dat']);
    return {autoUpdate:false,remoteCheckboxDoesNotEnable:true,configPreserved:true,trafficPreserved:true};
  });
  await step('ND06','原生卸载','从主控下载临时卸载器并执行 uninstall','新旧程序、配置和服务进程清除',async()=>{
    const result=await cli(['exec',names.agent,'sh','-c','sh /tmp/install.sh uninstall --download-url=https://proxy:8443/agent']);await writeFile(join(evidence,'linux-uninstall.log'),result);
    await cli(['exec',names.agent,'sh','-c','test ! -e /usr/local/bin/jan-probe && test ! -e /usr/local/bin/cf-probe && test ! -e /etc/config/cf-probe/config.conf']);
    await cli(['exec',names.agent,'sh','-c',"ps -eo comm=,stat= | awk '($1 == \"cf-probe\" || $1 == \"jan-probe\") && $2 !~ /^Z/ { found=1 } END { exit found }'"]);
    return {binaryRemoved:true,configRemoved:true};
  });
  const installLatest=async(serverId,mode='auto')=>{
    const server=(await admin({action:'list'})).body.servers.find(s=>s.id===serverId);
    assert.equal((await admin({...server,action:'edit',connection_mode:mode,report_interval:30,collect_interval:2})).status,200);
    await cli(['exec',names.agent,'sh','-c',`sh /tmp/install.sh install -id=${serverId} -secret=${key} -url=https://proxy:8443/update -connection_mode=${mode} -interval=30 -auto_update=0 -debug=1`]);
    await until(async()=> (await request('/api/server?id='+serverId)).body.agent_version===version,'installed Agent report',45000);
  };
  const verifyRemoved=async(container=names.agent)=>{
    await until(async()=> {
      try {await cli(['exec',container,'sh','-c','test ! -e /usr/local/bin/jan-probe && test ! -e /usr/local/bin/cf-probe && test ! -d /etc/config/cf-probe']);return true;}catch{return false;}
    },'remote uninstall files',45000);
    await cli(['exec',container,'sh','-c',"ps -eo comm=,stat= | awk '($1 == \"cf-probe\" || $1 == \"jan-probe\") && $2 !~ /^Z/ { found=1 } END { exit found }'"]);
    await until(async()=> {try {await cli(['exec',container,'sh','-c','for d in /tmp/jan-probe-uninstall-*; do test ! -d "$d" || exit 1; done']);return true;}catch{return false;}},'temporary uninstaller cleanup',10000);
  };
  await step('ND07','在线删除自动卸载','安装新版、建立 WSS，再从后台删除节点','Agent 无需手动命令即停止，程序、配置与临时卸载器清除',async()=>{
    const serverId=(await admin({action:'add',name:'Remote uninstall WSS'})).body.id;
    await installLatest(serverId);
    await until(async()=> (await cli(['exec',names.agent,'cat','/var/log/jan-probe.log'])).includes('WSS connected'),'WSS before deletion',45000);
    assert.equal((await admin({action:'delete',id:serverId})).status,200);
    await verifyRemoved();
    assert.equal((await request('/api/server?id='+serverId)).status,404);
    return {wss:true,binaryRemoved:true,configRemoved:true,processStopped:true,temporaryHelperRemoved:true};
  });
  await step('ND08','离线 HTTP 删除和主控重建','暂停纯 HTTP Agent，批量删除并重建主控后恢复 Agent','持久删除指令在下次 HTTP 上报送达并实际卸载',async()=>{
    const serverId=(await admin({action:'add',name:'Offline remote uninstall HTTP'})).body.id;
    const otherId=(await admin({action:'add',name:'Other offline deleted node'})).body.id;
    await installLatest(serverId,'http');
    await cli(['exec',names.agent,'sh','-c','kill -STOP "$(cat /run/jan-probe.pid)"']);
    assert.equal((await admin({action:'batch_delete',ids:[serverId,otherId]})).status,200);
    const before=(await request('/update',{id:serverId,secret:key,metrics:{cpu:1}})).body;
    assert.equal(before.type,'agent_uninstall');
    await cli(['rm','-f',names.controller]);await cli(controllerArgs);
    await until(async()=> (await request('/healthz')).status===200,'controller recreation after deletion');
    assert.deepEqual((await request('/update',{id:serverId,secret:key,metrics:{cpu:1}})).body,before);
    await cli(['exec',names.agent,'sh','-c','kill -CONT "$(cat /run/jan-probe.pid)"']);
    await verifyRemoved();
    return {http:true,offlineCommandPersisted:true,batchDelete:true,controllerRecreated:true,binaryRemoved:true,processStopped:true};
  });
  if(legacyDirectory) await step('ND09','旧版兼容和手动卸载回退','安装修改前真实旧版，删除节点后等待一次 HTTP 上报，再手动卸载','旧版保持运行且不误删；新版临时卸载器可清理旧版',async()=>{
    const serverId=(await admin({action:'add',name:'Legacy deletion compatibility'})).body.id;
    const row=(await admin({action:'list'})).body.servers.find(s=>s.id===serverId);
    await admin({...row,action:'edit',connection_mode:'http',report_interval:30});
    await cli(['exec',names.agent,'sh','-c',`sh /tmp/install.sh install --install-version=${oldVersion} -id=${serverId} -secret=${key} -url=https://proxy:8443/update -connection_mode=http -interval=30 -auto_update=0 -debug=1`]);
    await until(async()=> (await request('/api/server?id='+serverId)).body.agent_version===oldVersion,'legacy report',45000);
    await admin({action:'delete',id:serverId});
    await until(async()=> (await cli(['exec',names.agent,'cat',`/var/log/${oldService}.log`])).includes('report response http=404'),'legacy deleted response',45000);
    assert.ok((await cli(['exec',names.agent,`/usr/local/bin/${oldService}`,'version'])).includes(oldVersion));
    await cli(['exec',names.agent,'sh','-c',`kill -0 "$(cat /run/${oldService}.pid)"`]);
    await cli(['exec',names.agent,'sh','-c','sh /tmp/install.sh uninstall --download-url=https://proxy:8443/agent']);
    await verifyRemoved();
    return {legacyVersion:oldVersion,legacyNotAutoRemoved:true,manualFallbackWorks:true};
  });
  if(systemdImage){
    await step('ND10','真实 systemd 系统服务自动卸载','在独立 systemd 容器安装并删除节点','独立卸载单元完成清理，jan-probe 服务移除且不再重启',async()=>{
      await until(async()=> ['running','degraded'].includes(await cli(['exec',names.systemd,'systemctl','show','--property=SystemState','--value'])),'systemd container startup',30000);
      const serverId=(await admin({action:'add',name:'Systemd root remote uninstall'})).body.id;
      await cli(['exec',names.systemd,'sh','-c',`curl -fsSL https://proxy:8443/agent/install.sh -o /tmp/install.sh && sh /tmp/install.sh install -id=${serverId} -secret=${key} -url=https://proxy:8443/update -auto_update=0 -debug=1`]);
      await until(async()=> (await request('/api/server?id='+serverId)).body.agent_version===version,'systemd root report',45000);
      await cli(['exec',names.systemd,'systemctl','is-active','jan-probe']);
      await admin({action:'delete',id:serverId});await verifyRemoved(names.systemd);
      await cli(['exec',names.systemd,'test','!','-e','/etc/systemd/system/jan-probe.service']);
      return {realSystemd:true,systemServiceRemoved:true,binaryRemoved:true,independentUnit:true};
    });
    await step('ND11','真实 systemd 专用用户服务自动卸载','以 cfsm 用户安装并从后台删除节点','用户卸载单元独立执行，仅清理 cfsm Agent，用户服务和程序清除',async()=>{
      await cli(['exec',names.systemd,'useradd','-m','-s','/bin/sh','cfsm']);
      const uid=await cli(['exec',names.systemd,'id','-u','cfsm']);
      await cli(['exec',names.systemd,'loginctl','enable-linger','cfsm']);
      await cli(['exec',names.systemd,'systemctl','start',`user@${uid}.service`]);
      const asCfsm=['exec',names.systemd,'runuser','-u','cfsm','--','env','HOME=/home/cfsm',`XDG_RUNTIME_DIR=/run/user/${uid}`,`DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus`,'SSL_CERT_FILE=/fixture-ca.pem'];
      const serverId=(await admin({action:'add',name:'Systemd cfsm remote uninstall'})).body.id;
      await cli([...asCfsm,'sh','/tmp/install.sh','install',`-id=${serverId}`,`-secret=${key}`,'-url=https://proxy:8443/update','-auto_update=0','-debug=1']);
      await until(async()=> (await request('/api/server?id='+serverId)).body.agent_version===version,'systemd user report',45000);
      await cli([...asCfsm,'systemctl','--user','is-active','jan-probe']);
      await admin({action:'delete',id:serverId});
      await until(async()=> {try {await cli(['exec',names.systemd,'sh','-c','test ! -d /home/cfsm/.cf-probe && test ! -e /home/cfsm/.config/systemd/user/jan-probe.service']);return true;}catch{return false;}},'systemd user uninstall',45000);
      await verifyRemoved(names.systemd);
      return {realSystemd:true,dedicatedUser:true,userServiceRemoved:true,userBinaryRemoved:true};
    });
  }
}finally{
  for(const name of created) { try{await writeFile(join(evidence,name+'.log'),await cli(['logs',name]));}catch{} }
  if(process.env.AGENT_KEEP_TEST_ENV!=='1') {
    for(const name of created.reverse()){try{await cli(['rm','-f',name]);}catch{}}
    try{await cli(['network','rm',network]);}catch{}
    try{await cli(['network','rm',edgeNetwork]);}catch{}
    try{await cli(['image','rm',installImage]);}catch{}
  }
  // Keep only the isolated fixture and evidence for diagnosis; no production state is touched.
}
