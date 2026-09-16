import { readdir, readFile, realpath, stat, mkdir, mkdtemp, copyFile, writeFile, rename, rm, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';

const VERSION = /^(?:v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?|Snapshot-\d+)$/;
// Old archives remain immutable; only supported targets are exposed for download.
const ARCHIVE_ASSET = /^cf-probe-(?:linux-(?:amd64|arm64|386|armv[567]|loong64)|freebsd-(?:amd64|arm64|386|arm)|darwin-(?:amd64|arm64)|windows-(?:amd64|arm64|386)\.exe)$/;
const ASSET = /^cf-probe-(?:linux|freebsd)-(?:amd64|arm64)$/;
const noCache = { 'Cache-Control':'no-store' };
const notFound = () => new Response('Agent artifact not available', {status:404, headers:noCache});

function normalizeManifest(raw, directory) {
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schema_version !== 1 || raw.version !== directory || !VERSION.test(raw.version) || !Number.isFinite(Date.parse(raw.published_at)) || !Array.isArray(raw.assets) || !raw.assets.length) return null;
  const seen = new Set();
  const assets = [];
  for (const asset of raw.assets) {
    if (!asset || typeof asset !== 'object') return null;
    if (!ARCHIVE_ASSET.test(asset.name) || seen.has(asset.name) || !Number.isSafeInteger(asset.size) || asset.size < 1 || !/^[a-f0-9]{64}$/.test(asset.sha256)) return null;
    seen.add(asset.name);
    assets.push({name:asset.name,size:asset.size,sha256:asset.sha256});
  }
  return {schema_version:1,version:raw.version,published_at:raw.published_at,prerelease:raw.prerelease === true || raw.version.includes('-'),assets};
}

// Public, read-only downloads. The optional archive contains version directories
// made by the same builder; absent versions are never fetched from upstream.
export class AgentDistribution {
  constructor(bundledRoot, archiveRoot) {
    this.bundledRoot = resolve(bundledRoot);
    this.roots = [...new Set([this.bundledRoot, ...(archiveRoot ? [resolve(archiveRoot)] : [])])];
  }

  async releases({ allPlatforms = false } = {}) {
    const found = new Map();
    for (const root of this.roots) {
      let entries;
      try { entries = await readdir(root,{withFileTypes:true}); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !VERSION.test(entry.name) || found.has(entry.name)) continue;
        try {
          const file = await this.safeFile(root, `${entry.name}/manifest.json`);
          if (!file || file.info.size > 65536) continue;
          const manifest = normalizeManifest(JSON.parse(await readFile(file.path,'utf8')),entry.name);
          if (manifest) {
            const published = allPlatforms ? manifest : {...manifest,assets:manifest.assets.filter(asset=>ASSET.test(asset.name))};
            if (published.assets.length) found.set(manifest.version,{manifest:published,root});
          }
        } catch (error) { if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error; }
      }
    }
    return [...found.values()];
  }

  async latest() {
    const releases = (await this.releases()).filter(item => !item.manifest.prerelease);
    releases.sort((a,b) => {
      const av = a.manifest.version.replace(/^v/,'').split('.').map(Number);
      const bv = b.manifest.version.replace(/^v/,'').split('.').map(Number);
      return bv[0]-av[0] || bv[1]-av[1] || bv[2]-av[2];
    });
    return releases[0]?.manifest || null;
  }

  // Called by the production entry point, not every in-process test controller.
  // Versioned binaries survive image replacement in the existing data volume.
  async archiveTo(destination) {
    const root = resolve(destination);
    await mkdir(root,{recursive:true});
    const canonical = manifest => JSON.stringify({...manifest,assets:[...manifest.assets].sort((a,b)=>a.name.localeCompare(b.name))});
    for (const entry of await this.releases({ allPlatforms: true })) {
      const target = resolve(root,entry.manifest.version);
      try {
        const existing = normalizeManifest(JSON.parse(await readFile(resolve(target,'manifest.json'),'utf8')),entry.manifest.version);
        if (!existing || canonical(existing) !== canonical(entry.manifest)) throw new Error(`Agent ${entry.manifest.version} already exists with different artifacts; increment agent/release.json version`);
        continue;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      const stage = await mkdtemp(resolve(root,'.agent-stage-'));
      try {
        for (const asset of entry.manifest.assets) {
          const file = await this.safeFile(entry.root,`${entry.manifest.version}/${asset.name}`);
          if (!file || file.info.size !== asset.size) throw new Error(`Incomplete Agent artifact: ${asset.name}`);
          const output = resolve(stage,asset.name);
          await copyFile(file.path,output);
          const hash = createHash('sha256');
          for await (const chunk of createReadStream(output)) hash.update(chunk);
          if (hash.digest('hex') !== asset.sha256) throw new Error(`Agent checksum mismatch: ${asset.name}`);
        }
        await writeFile(resolve(stage,'manifest.json'),JSON.stringify(entry.manifest,null,2)+'\n');
        await writeFile(resolve(stage,'checksums.txt'),entry.manifest.assets.map(a=>`${a.sha256}  ${a.name}\n`).join(''));
        await chmod(stage,0o755);
        await rename(stage,target);
      } finally { await rm(stage,{recursive:true,force:true}); }
    }
  }

  async safeFile(root, path) {
    try {
      const [base, file] = await Promise.all([realpath(root),realpath(resolve(root,path))]);
      if (!file.startsWith(base+sep)) return null;
      const info = await stat(file);
      return info.isFile() ? {path:file,info} : null;
    } catch (error) { if (['ENOENT','ENOTDIR'].includes(error.code)) return null; throw error; }
  }

  async handle(request) {
    if (!['GET','HEAD'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:{...noCache,Allow:'GET, HEAD'}});
    let path;
    try { path = decodeURIComponent(new URL(request.url).pathname).slice('/agent/'.length); }
    catch { return notFound(); }
    const head = request.method === 'HEAD';
    if (path === 'releases.json') {
      const body = JSON.stringify((await this.releases()).map(item=>item.manifest));
      return new Response(head ? null : body,{headers:{...noCache,'Content-Type':'application/json'}});
    }
    if (path === 'latest') {
      const latest = await this.latest();
      return latest ? new Response(head ? null : latest.version+'\n',{headers:{...noCache,'Content-Type':'text/plain'}}) : notFound();
    }
    if (path === 'install.sh') {
      return this.stream(request,await this.safeFile(this.bundledRoot,path),'text/plain; charset=utf-8');
    }
    const parts = path.split('/');
    if (parts.length !== 2 || !VERSION.test(parts[0]) || !(ASSET.test(parts[1]) || ['checksums.txt','manifest.json'].includes(parts[1]))) return notFound();
    const entry = (await this.releases()).find(item=>item.manifest.version===parts[0]);
    if (!entry) return notFound();
    if (parts[1] === 'manifest.json') return new Response(head ? null : JSON.stringify(entry.manifest),{headers:{...noCache,'Content-Type':'application/json'}});
    if (parts[1] === 'checksums.txt') {
      const body = entry.manifest.assets.map(a=>`${a.sha256}  ${a.name}\n`).join('');
      return new Response(head ? null : body,{headers:{...noCache,'Content-Type':'text/plain'}});
    }
    const asset = entry.manifest.assets.find(a=>a.name===parts[1]);
    if (!asset) return notFound();
    const file = await this.safeFile(entry.root,path);
    if (!file || file.info.size !== asset.size) return notFound();
    return this.stream(request,file,'application/octet-stream',asset.sha256);
  }

  stream(request,file,type,hash) {
    if (!file) return notFound();
    const headers = { 'Content-Type':type,'Content-Length':String(file.info.size),...noCache };
    if (hash) headers.ETag = `"${hash}"`;
    return new Response(request.method === 'HEAD' ? null : Readable.toWeb(createReadStream(file.path)),{headers});
  }
}
