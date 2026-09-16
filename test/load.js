import { normalizeAdminPath } from '../src/utils/adminPath.js';
const adminPath = normalizeAdminPath(process.env.ADMIN_PATH);
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { writeFile, mkdir } from 'node:fs/promises';
import { WebSocket } from 'ws';

// Run only against an explicitly provided EMPTY disposable installation.
const base=process.env.TEST_BASE_URL;
const secret=process.env.TEST_API_SECRET;
assert.ok(base && secret,'Set TEST_BASE_URL and TEST_API_SECRET for an empty test controller');
const api=async (data,token='') => {
  const response=await fetch(base+adminPath+'/api',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify(data)});
  assert.equal(response.status,200);return response.json();
};
const {token}=await api({action:'login',username:'admin',password:secret});
assert.equal((await api({action:'list'},token)).servers.length,0,'Refusing to load-test a non-empty installation');
const ids=[];const sockets=[];let acks=0;let updates=0;const errors=[];
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const connect=async path=>{
  const ws=new WebSocket(base.replace(/^http/,'ws')+path);sockets.push(ws);
  ws.on('error',e=>errors.push(e.message));
  ws.on('message',raw=>{
    const m=JSON.parse(raw);if(m.type==='ack')acks++;
    if(m.type==='batchUpdate') updates+=m.updates.length;
    if(m.type==='error')errors.push(m);
  });
  await once(ws,'open');return ws;
};
try {
  for(let i=0;i<50;i++)ids.push((await api({action:'add',name:`Load Agent ${i+1}`},token)).id);
  const viewers=await Promise.all(Array.from({length:10},()=>connect('/api/ws')));
  viewers.forEach(ws=>ws.send(JSON.stringify({type:'subscribe',scope:'all',ids})));
  await pause(200);
  const agents=await Promise.all(ids.map(()=>connect('/update')));
  const latency=[];const started=Date.now();const rounds=30;
  for(let round=0;round<rounds;round++) {
    const ts=Date.now();
    agents.forEach((ws,i)=>ws.send(JSON.stringify({id:ids[i],secret,metrics:{cpu:(i+round)%100,ram_total:1024,ram_used:256,net_rx:round*1000,net_tx:round*2000,timestamp:ts}})));
    const start=performance.now();assert.equal((await fetch(base+'/healthz')).status,200);latency.push(performance.now()-start);
    await pause(Math.max(0,2000-(Date.now()-ts)));
  }
  assert.equal(acks,rounds*50);assert.equal(updates,rounds*50*10);assert.deepEqual(errors,[]);
  latency.sort((a,b)=>a-b);
  const result={date:new Date().toISOString(),status:'PASS',seconds:(Date.now()-started)/1000,agents:50,viewers:10,reports:acks,deliveredUpdates:updates,healthP95Ms:Math.round(latency[Math.ceil(latency.length*.95)-1]*100)/100,errors};
  await mkdir('output/test-results',{recursive:true});await writeFile('output/test-results/load.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
} finally {for(const ws of sockets)ws.close();}
