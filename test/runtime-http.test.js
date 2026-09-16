import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createRequestAdapter, sendResponse } from '../src/runtime/http.js';
import { createGeolocation, isPublicIp } from '../src/services/geolocation.js';

for (const trusted of [false, true]) test(`actual HTTP proxy headers: trusted=${trusted}`, async () => {
  const adapt = createRequestAdapter(trusted ? '127.0.0.1/32' : '');
  const server = createServer(async (req,res) => {
    const request=await adapt(req);
    await sendResponse(Response.json({url:request.url,ip:request.clientIp}),req,res);
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/test`,{headers:{
      'X-Forwarded-For':'8.8.8.8','X-Forwarded-Host':'monitor.example','X-Forwarded-Proto':'https'
    }});
    const data=await response.json();
    assert.equal(data.ip,trusted?'8.8.8.8':'127.0.0.1');
    assert.equal(new URL(data.url).protocol,trusted?'https:':'http:');
    assert.equal(new URL(data.url).hostname,trusted?'monitor.example':'127.0.0.1');
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test('offline GeoIP supports IPv4, IPv6 and same-host fallback', async () => {
  const geo=await createGeolocation('geoip/dbip-country-lite.mmdb','8.8.8.8');
  assert.equal(geo.lookup('8.8.8.8'),'US');
  assert.match(geo.lookup('2001:4860:4860::8888'),/^[A-Z]{2}$/);
  assert.equal(geo.lookup('127.0.0.1'),'US');
  assert.equal(geo.lookup('172.19.0.1'),'US');
  for(const ip of ['::1','192.168.1.1','127.0.0.1','::ffff:10.0.0.1','invalid']) assert.equal(isPublicIp(ip),false);
});
