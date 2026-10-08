import { createHmac } from 'node:crypto';
import { isValidUUID } from './serverInput.js';

export function getAgentUninstallCommand(env, serverId) {
  if (!isValidUUID(serverId)) return null;
  const row = env.DB.prepare('SELECT command_id, deleted_at FROM agent_removals WHERE server_id=?').bind(serverId).first();
  if (!row) return null;
  const command = {
    type: 'agent_uninstall',
    server_id: serverId,
    command_id: row.command_id,
    issued_at: row.deleted_at
  };
  // Explicit authenticated intent, never a generic 404 or a proxy error.
  const message = `jan-monitor:agent-uninstall:v1\n${command.server_id}\n${command.command_id}\n${command.issued_at}`;
  command.signature = createHmac('sha256', env.API_SECRET).update(message).digest('hex');
  return command;
}
