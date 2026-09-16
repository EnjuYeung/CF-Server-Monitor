import { mkdtemp, rm, chmod } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { loadSiteSettings } from '../utils/settings.js';

let backingUp = false;
export async function handleBackup(request, env) {
  if (!await checkAuth(request, env, await loadSiteSettings(env.DB))) return simpleAuthResponse();
  if (backingUp) return new Response('Backup already running', { status: 409 });
  backingUp = true;
  const directory = await mkdtemp(join(tmpdir(), 'server-monitor-backup-'));
  const path = join(directory, 'monitor.sqlite');
  try {
    await env.DB.backup(path);
    await chmod(path, 0o600);
    const stream = createReadStream(path);
    stream.once('close', () => { rm(directory, { recursive: true, force: true }).catch(console.error); backingUp = false; });
    return new Response(Readable.toWeb(stream), { headers: {
      'Content-Type': 'application/vnd.sqlite3', 'Cache-Control': 'no-store',
      'Content-Disposition': `attachment; filename="server-monitor-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite"`
    } });
  } catch (error) {
    backingUp = false;
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
