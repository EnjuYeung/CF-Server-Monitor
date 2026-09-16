import { mkdirSync, chownSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';

const directory = resolve(process.env.DATA_DIR || '/app/data');
mkdirSync(directory, { recursive: true, mode: 0o700 });
// Docker creates fresh bind-mount directories as root. Give only this data
// directory and its ordinary files to the unprivileged application account.
if (process.getuid?.() === 0) {
  chownSync(directory, 1000, 1000);
  const agentArchive = join(directory, 'agent-releases');
  try { if (lstatSync(agentArchive).isDirectory()) chownSync(agentArchive, 1000, 1000); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    if (lstatSync(path).isFile()) chownSync(path, 1000, 1000);
  }
  process.setgid(1000); process.setuid(1000);
}
const child = spawn(process.execPath, ['src/server.js'], { stdio: 'inherit' });
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal));
child.on('exit', code => process.exit(code ?? 1));
