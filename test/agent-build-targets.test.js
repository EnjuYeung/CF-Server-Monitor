import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { createController } from '../src/server.js';
import { AgentDistribution } from '../src/services/agentDistribution.js';

test('built release serves and archives exactly four verified 64-bit ELF Agents', async t => {
  const root = await mkdtemp(join(tmpdir(),'agent-built-platforms-'));
  let controller;
  t.after(async () => { await controller?.close(); await rm(root,{recursive:true,force:true}); });
  const version = JSON.parse(await readFile('agent/release.json','utf8')).version;
  const expected = ['cf-probe-linux-amd64','cf-probe-linux-arm64','cf-probe-freebsd-amd64','cf-probe-freebsd-arm64'].sort();
  const archive = join(root,'agent-releases');
  const registry = new AgentDistribution(resolve('agent-dist'));
  await registry.archiveTo(archive);
  await registry.archiveTo(archive);
  const archived = JSON.parse(await readFile(join(archive,version,'manifest.json'),'utf8'));
  assert.deepEqual(archived.assets.map(asset=>asset.name).sort(),expected);
  await assert.rejects(access(resolve('agent-dist','install.ps1')), {code:'ENOENT'});
  controller = await createController({ API_SECRET:'agent-platform-runtime-fixture', ADMIN_PATH:'agentPlatformCheck-84', DATA_DIR:root, AGENT_ARCHIVE_DIR:archive, PUBLIC_IP:'8.8.8.8', SCHEDULER_ENABLED:'false' });
  const {port} = await controller.listen(0,'127.0.0.1');
  const base = `http://127.0.0.1:${port}/agent`;
  const manifest = await (await fetch(`${base}/${version}/manifest.json`)).json();
  assert.deepEqual(manifest.assets.map(asset=>asset.name).sort(),expected);
  assert.equal((await (await fetch(`${base}/latest`)).text()).trim(),version);
  const catalog = await (await fetch(`${base}/releases.json`)).json();
  assert.ok(catalog.every(release=>release.assets.every(asset=>expected.includes(asset.name))));
  for (const asset of manifest.assets) {
    const response = await fetch(`${base}/${version}/${asset.name}`);
    assert.equal(response.status,200);
    const binary = Buffer.from(await response.arrayBuffer());
    assert.equal(binary.length,asset.size);
    assert.equal(createHash('sha256').update(binary).digest('hex'),asset.sha256);
    assert.equal(binary.subarray(0,4).toString('hex'),'7f454c46');
    assert.equal(binary[4],2,'ELF must be 64-bit');
    assert.equal(binary[5],1,'ELF must be little-endian');
    assert.equal(binary[7],asset.name.includes('freebsd')?9:0);
    assert.equal(binary.readUInt16LE(18),asset.name.endsWith('amd64')?62:183);
  }
  for (const name of ['cf-probe-linux-386','cf-probe-linux-armv5','cf-probe-linux-armv6','cf-probe-linux-armv7','cf-probe-linux-loong64','cf-probe-freebsd-386','cf-probe-freebsd-arm','cf-probe-darwin-amd64','cf-probe-darwin-arm64','cf-probe-windows-amd64.exe','cf-probe-windows-arm64.exe','cf-probe-windows-386.exe']) {
    assert.equal((await fetch(`${base}/${version}/${name}`)).status,404);
  }
  assert.equal((await fetch(`${base}/install.ps1`)).status,404);
});
