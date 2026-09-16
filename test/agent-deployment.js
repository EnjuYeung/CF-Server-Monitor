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
const evidence=resolve('output/test-results/agent-integration');await mkdir(evidence,{recursive:true});
const root=await mkdtemp(join(evidence,'deployment-fixture-'));
const prefix='cfsm-agent-'+randomUUID().slice(0,8), network=prefix+'-net';
const edgeNetwork=prefix+'-edge';
const names={controller:prefix+'-controller',proxy:prefix+'-proxy',agent:prefix+'-agent'};
const cli=async args=>(await exec(docker,args,{maxBuffer:8*1024*1024,timeout:240000})).stdout.trim();
const version=JSON.parse(await readFile('agent/release.json','utf8')).version;
const oldVersion='v1.0.99';
const key='agent-deployment-fixture-secret';
const adminPath='native-Agent-Deployment-92';
let token='',id,base,controllerArgs;const created=[];const results=[];
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
await exec(process.execPath,['scripts/agent.js','build','-targets',`linux/${architecture}`,'-version',oldVersion,'-out',join(root,'old-agent')],{timeout:180000,maxBuffer:8*1024*1024});
await mkdir(join(root,'data','agent-releases'),{recursive:true});
await cp(join(root,'old-agent',oldVersion),join(root,'data','agent-releases',oldVersion),{recursive:true});
await exec('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','2','-subj','/CN=proxy','-addext','subjectAltName=DNS:proxy,DNS:localhost,IP:127.0.0.1'],{timeout:30000});
const certificate=await readFile(join(root,'cert.pem'));
await writeFile(join(root,'proxy.mjs'),`import https from 'node:https';import http from 'node:http';import net from 'node:net';import fs from 'node:fs';
const server=https.createServer({key:fs.readFileSync('/fixture/key.pem'),cert:fs.readFileSync('/fixture/cert.pem')},(req,res)=>{
const upstream=http.request({host:'controller',port:8080,path:req.url,method:req.method,headers:{...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});upstream.on('error',()=>res.writeHead(502).end());req.pipe(upstream);});
server.on('upgrade',(req,socket,head)=>{const upstream=net.connect(8080,'controller',()=>{upstream.write(req.method+' '+req.url+' HTTP/1.1\\r\\n'+Object.entries({...req.headers,'x-forwarded-proto':'https','x-forwarded-host':req.headers.host}).map(([k,v])=>k+': '+v+'\\r\\n').join('')+'\\r\\n');if(head.length)upstream.write(head);socket.pipe(upstream).pipe(socket);});upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());});server.listen(8443,'0.0.0.0');`);
await writeFile(join(root,'Dockerfile.agent'),'FROM debian:bookworm-slim\nRUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates procps && rm -rf /var/lib/apt/lists/*\nCMD ["sleep","infinity"]\n');
const installImage=prefix+'-installer';
await cli(['build','-f',join(root,'Dockerfile.agent'),'-t',installImage,root]);

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
  controllerArgs=['run','-d','--name',names.controller,'--network',network,'--network-alias','controller','-e',`API_SECRET=${key}`,'-e',`ADMIN_PATH=${adminPath}`,'-e',`TRUSTED_PROXIES=${proxyIp}/32`,'-e','PUBLIC_IP=8.8.8.8','-v',`${join(root,'data')}:/app/data`,image];
  await cli(controllerArgs);created.push(names.controller);
  await cli(['run','-d','--name',names.agent,'--network',network,'-v',`${join(root,'cert.pem')}:/fixture-ca.pem:ro`,'-e','CURL_CA_BUNDLE=/fixture-ca.pem','-e','SSL_CERT_FILE=/fixture-ca.pem',installImage]);created.push(names.agent);
  await step('ND01','Docker 启动和归档','在隔离 bridge 中启动主控和独立 TLS 反代','健康检查、TLS 登录、16 个产物及持久归档可用',async()=>{
    await until(async()=> (await request('/healthz')).status===200,'controller startup');
    const login=await admin({action:'login',username:'admin',password:key});assert.equal(login.status,200);token=login.body.token;
    assert.match(login.headers['set-cookie'][0],/Secure/);
    const versions=await request('/agent/releases.json');assert.equal(versions.status,200);
    assert.equal(versions.body.find(v=>v.version===version).assets.length,16);
    const archived=JSON.parse(await readFile(join(root,'data','agent-releases',version,'manifest.json'),'utf8'));assert.equal(archived.assets.length,16);
    id=(await admin({action:'add',name:'Native Linux TLS Agent'})).body.id;
    await writeFile(join(evidence,'browser-fixture.json'),JSON.stringify({base,adminPath,id,names,network,edgeNetwork,root,installImage},null,2));
    return {tls:true,secureCookie:true,targets:16,archived:true,internalNetwork:true};
  });
  await step('ND02','一键安装及 HTTPS/WSS 上报','在独立 Linux 环境从主控安装旧版测试程序并开启自动更新','原生服务启动，正确连接 TLS 主控，等待更新',async()=>{
    const installed=await cli(['exec',names.agent,'sh','-c','curl -fsSL https://proxy:8443/agent/install.sh -o /tmp/install.sh && sh /tmp/install.sh install --install-version='+oldVersion+' -id='+id+' -secret='+key+' -url=https://proxy:8443/update -auto_update=1 -debug=1']);
    await writeFile(join(evidence,'linux-install.log'),installed);
    assert.ok((await cli(['exec',names.agent,'/usr/local/bin/cf-probe','version'])).includes(oldVersion));
    await until(async()=> (await request('/api/server?id='+id)).body.agent_version===oldVersion,'native TLS report',45000);
    await until(async()=> (await cli(['exec',names.agent,'cat','/var/log/cf-probe.log'])).includes('WSS connected'),'native WSS',45000);
    return {installedVersion:oldVersion,tlsAgent:true,wssConnected:true};
  });
  await step('ND03','实际自动更新与配置保留','等待旧版从主控下载新版并由原生服务更新重启','安装文件和上报版本变为当前版本，配置及流量文件保留',async()=>{
    await until(async()=> (await cli(['exec',names.agent,'/usr/local/bin/cf-probe','version'])).includes(version),'binary self update');
    await until(async()=> (await request('/api/server?id='+id)).body.agent_version===version,'report after self update');
    const cfg=await cli(['exec',names.agent,'cat','/etc/config/cf-probe/config.conf']);
    assert.ok(cfg.includes(id));assert.ok(cfg.includes('AUTO_UPDATE="1"'));assert.ok(cfg.includes('CONTROLLER_URL="https://proxy:8443/update"'));
    await cli(['exec',names.agent,'test','-s','/etc/config/cf-probe/traffic.dat']);
    const log=await cli(['exec',names.agent,'cat','/var/log/cf-probe.log']);assert.ok(log.includes('auto update scheduled target='+version));
    await writeFile(join(evidence,'linux-update.log'),log);
    return {from:oldVersion,to:version,configPreserved:true,trafficPreserved:true};
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
  await step('ND05','原生卸载','从主控下载临时卸载器并执行 uninstall','已安装程序、配置和服务进程清除',async()=>{
    const result=await cli(['exec',names.agent,'sh','-c','sh /tmp/install.sh uninstall --download-url=https://proxy:8443/agent']);await writeFile(join(evidence,'linux-uninstall.log'),result);
    await cli(['exec',names.agent,'sh','-c','test ! -e /usr/local/bin/cf-probe && test ! -e /etc/config/cf-probe/config.conf']);
    await cli(['exec',names.agent,'sh','-c',"ps -eo comm=,stat= | awk '$1 == \"cf-probe\" && $2 !~ /^Z/ { found=1 } END { exit found }'"]);
    return {binaryRemoved:true,configRemoved:true};
  });
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
