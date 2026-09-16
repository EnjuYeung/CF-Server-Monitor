import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { AgentDistribution } from '../src/services/agentDistribution.js';
import { getRemoteVersion } from '../src/utils/version.js';

test('Native Agent catalog, historical versions, safe downloads and fail-closed files', async t => {
  const root = await mkdtemp(join(tmpdir(),'agent-distribution-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bundled = join(root,'bundled'), archive = join(root,'archive');
  const binary = Buffer.from('Agent artifact fixture');
  const sha256 = createHash('sha256').update(binary).digest('hex');
  const asset = {name:'cf-probe-linux-arm64',size:binary.length,sha256};
  async function release(base,version,assets=[asset]) {
    await mkdir(join(base,version),{recursive:true});
    await writeFile(join(base,version,'manifest.json'),JSON.stringify({schema_version:1,version,published_at:'2026-09-16T00:00:00Z',prerelease:version.includes('-'),assets}));
    await writeFile(join(base,version,asset.name),binary);
  }
  await release(bundled,'v1.1.0');
  await release(archive,'v1.0.99');
  await release(archive,'v99.0.0-beta.1');
  await release(archive,'v1.1.0'); // Bundled files take precedence over an archive collision.
  await release(archive,'v99.0.0',[{...asset,name:'../../private.conf'}]);
  await mkdir(join(archive,'v88.0.0')); await writeFile(join(archive,'v88.0.0','manifest.json'),'null');
  await writeFile(join(root,'private.conf'),'private fixture');
  await writeFile(join(bundled,'install.sh'),'#!/bin/sh\n');
  const registry = new AgentDistribution(bundled,archive);
  const request = (path,method='GET')=>registry.handle(new Request('http://controller/agent/'+path,{method}));
  assert.equal((await registry.latest()).version,'v1.1.0');
  assert.deepEqual(await getRemoteVersion({AGENT_DISTRIBUTION:registry}),{agent:'v1.1.0'});
  const catalog = await request('releases.json');
  assert.equal(catalog.headers.get('cache-control'),'no-store');
  assert.equal((await catalog.json()).length,3);
  for (const version of ['v1.1.0','v1.0.99']) {
    const response = await request(`${version}/${asset.name}`);
    assert.equal(response.headers.get('content-type'),'application/octet-stream');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),binary);
    const head = await request(`${version}/${asset.name}`,'HEAD');
    assert.equal(head.headers.get('content-length'),String(binary.length)); assert.equal(await head.text(),'');
    assert.equal(await (await request(`${version}/checksums.txt`)).text(),`${sha256}  ${asset.name}\n`);
  }
  assert.equal(await (await request('install.sh')).text(),'#!/bin/sh\n');
  for (const path of ['v9.0.0/'+asset.name,'v1.1.0/config.conf','v1.1.0/..%2f..%2fprivate.conf','%ZZ']) assert.equal((await request(path)).status,404,path);
  assert.equal((await request('latest','POST')).status,405);
  const retained = join(root,'retained');
  await new AgentDistribution(bundled).archiveTo(retained);
  await new AgentDistribution(bundled).archiveTo(retained); // Idempotent restarts.
  const nextImage = join(root,'next-image');
  await release(nextImage,'v1.2.0');
  await new AgentDistribution(nextImage).archiveTo(retained);
  const upgraded = new AgentDistribution(nextImage,retained);
  assert.equal((await upgraded.latest()).version,'v1.2.0');
  assert.equal((await upgraded.handle(new Request(`http://controller/agent/v1.1.0/${asset.name}`))).status,200);
  const conflicting = join(root,'conflicting');
  await release(conflicting,'v1.1.0',[{...asset,sha256:'0'.repeat(64)}]);
  await assert.rejects(new AgentDistribution(conflicting).archiveTo(retained),/different artifacts/);
  await rm(join(bundled,'v1.1.0',asset.name));
  await symlink(join(root,'private.conf'),join(bundled,'v1.1.0',asset.name));
  assert.equal((await request(`v1.1.0/${asset.name}`)).status,404);
  const empty = new AgentDistribution(join(root,'missing'));
  assert.equal(await empty.latest(),null);
  assert.equal((await empty.handle(new Request('http://controller/agent/latest'))).status,404);
});
