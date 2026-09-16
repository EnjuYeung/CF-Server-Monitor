import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('../agent', import.meta.url));
const action = process.argv[2] || 'build';
const run = args => {
  const result = spawnSync('go', args, { cwd, stdio:'inherit', env:process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
};
if (action === 'test') {
  run(['vet', './...']);
  run(['test', './...']);
} else if (action === 'build') {
  run(['run', './tools/build', ...(process.env.AGENT_TARGETS ? ['-targets',process.env.AGENT_TARGETS] : []), ...process.argv.slice(3)]);
} else { throw new Error(`Unknown Agent action: ${action}`); }
