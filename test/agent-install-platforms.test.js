import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const exec = promisify(execFile);

test('POSIX bootstrap selects exactly the four supported platform artifacts', async t => {
  const root = await mkdtemp(join(tmpdir(),'agent-bootstrap-platforms-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const bin = join(root,'bin'); await mkdir(bin);
  const payload = '#!/bin/sh\nprintf "bootstrap fixture executed\\n"\n';
  const sha = createHash('sha256').update(payload).digest('hex');
  await writeFile(join(root,'payload'),payload);
  await writeFile(join(bin,'uname'),'#!/bin/sh\ncase "$1" in -s) printf "%s" "$FIXTURE_OS";; -m) printf "%s" "$FIXTURE_ARCH";; esac\n',{mode:0o700});
  await writeFile(join(bin,'curl'),`#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in -o) output="$2"; shift 2;; https://*) url="$1"; shift;; *) shift;; esac
done
printf '%s\\n' "$url" >> "$FIXTURE_ROOT/requests"
case "$url" in
  */latest) printf 'v1.1.1\\n' > "$output";;
  */checksums.txt) printf '%s  %s\\n' "$FIXTURE_SHA" "$FIXTURE_ASSET" > "$output";;
  */"$FIXTURE_ASSET") cp "$FIXTURE_ROOT/payload" "$output";;
  *) exit 22;;
esac
`,{mode:0o700});
  const run = (os,arch,asset) => exec('sh',[resolve('agent/install.sh'),'version','--download-url=https://fixture.invalid/agent'],{
    env:{...process.env,PATH:bin+':'+process.env.PATH,TMPDIR:root,FIXTURE_ROOT:root,FIXTURE_OS:os,FIXTURE_ARCH:arch,FIXTURE_ASSET:asset,FIXTURE_SHA:sha}
  });
  for (const [os,arch,asset] of [
    ['Linux','x86_64','cf-probe-linux-amd64'], ['Linux','aarch64','cf-probe-linux-arm64'],
    ['FreeBSD','amd64','cf-probe-freebsd-amd64'], ['FreeBSD','arm64','cf-probe-freebsd-arm64']
  ]) {
    await writeFile(join(root,'requests'),'');
    const result = await run(os,arch,asset);
    assert.match(result.stdout,/bootstrap fixture executed/);
    const requests = (await readFile(join(root,'requests'),'utf8')).trim().split('\n');
    assert.equal(requests.length,3);
    assert.equal(requests.at(-1),`https://fixture.invalid/agent/v1.1.1/${asset}`);
  }
  for (const [os,arch] of [['Darwin','arm64'],['MINGW64_NT','x86_64'],['Linux','i686'],['Linux','armv5l'],['Linux','armv6l'],['Linux','armv7l'],['Linux','loongarch64'],['FreeBSD','i386'],['FreeBSD','armv7']]) {
    await writeFile(join(root,'requests'),'');
    await assert.rejects(run(os,arch,'not-available'),error=>error.code!==0 && /unsupported (OS|architecture)/.test(error.stderr));
    assert.equal(await readFile(join(root,'requests'),'utf8'),'','unsupported platforms must fail before any download');
  }
});
