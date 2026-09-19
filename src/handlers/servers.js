import { createSuccessResponse, createBadRequestResponse } from '../utils/errors.js';
import { scheduleAgentConfigChanged } from '../utils/agentConfigNotify.js';
import { createServer, editServers, sortServers, deleteServers } from '../services/servers.js';

export const SERVER_ACTIONS = new Set(['add', 'edit', 'batch_edit', 'delete', 'batch_delete', 'save_order', 'export_servers', 'import_servers']);

// Authentication is performed by the admin router before dispatching here.
export function handleServerAction({ env, sys, data, ctx }) {
  try {
    const db = env.DB;
    switch (data.action) {
      case 'add': {
        const id = createServer(db, { ...data, id: crypto.randomUUID(), name: data.name ?? 'New Server' }, sys);
        return createSuccessResponse({ success: true, id, message: 'serverAdded' });
      }
      case 'edit':
      case 'batch_edit': {
        const inputs = data.action === 'edit' ? [data] : data.servers;
        if (!Array.isArray(inputs)) throw new Error('invalidServerData');
        const ids = editServers(db, inputs, sys);
        env.REALTIME_HUB?.revokeFrontendSessions();
        for (const id of ids) scheduleAgentConfigChanged(env, ctx, id);
        return createSuccessResponse({ success: true, message: 'serverUpdated' });
      }
      case 'delete':
      case 'batch_delete':
        deleteServers(env, data.action === 'delete' ? [data.id] : data.ids);
        return createSuccessResponse({ success: true, message: data.action === 'delete' ? 'serverDeleted' : 'batchDeleted' });
      case 'save_order':
        sortServers(db, data.orders);
        return createSuccessResponse({ success: true, message: 'sortOrderSaved' });
      case 'export_servers':
        return createSuccessResponse({ success: true, servers: db.prepare('SELECT * FROM servers ORDER BY sort_order ASC').all().results, message: 'serversExported' });
      case 'import_servers': {
        if (!Array.isArray(data.servers) || !data.servers.length) throw new Error('noServersToImport');
        let imported = 0;
        const errors = [];
        for (const [index, server] of data.servers.entries()) {
          try { createServer(db, server, sys); imported++; }
          catch (error) { errors.push({ index, id: server?.id || '(invalid)', error: error.message }); }
        }
        return createSuccessResponse({ success: true, imported, skipped: errors.length, skippedIds: errors.map(item => item.id), errors, message: imported ? 'serversImported' : 'noServersImported' });
      }
    }
  } catch (error) {
    return createBadRequestResponse(error.message);
  }
}
