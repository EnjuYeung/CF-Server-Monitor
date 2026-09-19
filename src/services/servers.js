import { normalizeServerInput, isValidUUID } from './serverInput.js';
import { clearMetricsHistoryCache, clearServersListCache } from '../utils/cache.js';
import { clearDashboardLatencyHistoryCache } from '../database/schema.js';

export function validateServerIds(db, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 50 || new Set(ids).size !== ids.length || ids.some(id => !isValidUUID(id))) throw new Error('invalidServerIdInList');
  for (const id of ids) if (!db.prepare('SELECT id FROM servers WHERE id=?').bind(id).first()) throw new Error('invalidServerId');
  return ids;
}

export function createServer(db, input, settings) {
  if (!isValidUUID(input?.id)) throw new Error('invalidServerId');
  const fields = normalizeServerInput(input, settings);
  const order = input.sort_order ?? db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM servers').first().value;
  if (!Number.isInteger(order) || order < 0) throw new Error('invalidSortId');
  const timestamp = input.timestamp ?? Date.now();
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('invalidTimestamp');
  const row = { id: input.id, ...fields, sort_order: order, timestamp };
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO servers (${keys.map(key => `"${key}"`).join(',')}) VALUES (${keys.map(() => '?').join(',')})`).bind(...Object.values(row)).run();
  clearServersListCache();
  return input.id;
}

export function editServers(db, inputs, settings) {
  validateServerIds(db, inputs.map(input => input?.id));
  const rows = inputs.map(input => ({ id: input.id, values: normalizeServerInput({ ...db.prepare('SELECT * FROM servers WHERE id=?').bind(input.id).first(), ...input }, settings) }));
  db.transaction(() => {
    for (const { id, values } of rows) db.prepare(`UPDATE servers SET ${Object.keys(values).map(key => `"${key}"=?`).join(',')} WHERE id=?`).bind(...Object.values(values), id).run();
  });
  clearServersListCache();
  return rows.map(row => row.id);
}

export function sortServers(db, ids) {
  validateServerIds(db, ids);
  db.transaction(() => ids.forEach((id, order) => db.prepare('UPDATE servers SET sort_order=? WHERE id=?').bind(order, id).run()));
  clearServersListCache();
}

export function deleteServers(env, ids) {
  validateServerIds(env.DB, ids);
  env.DB.transaction(() => ids.forEach(id => env.DB.prepare('DELETE FROM servers WHERE id=?').bind(id).run()));
  for (const id of ids) {
    clearMetricsHistoryCache(id);
    clearDashboardLatencyHistoryCache(id);
    env.REALTIME_HUB?.removeServer(id);
  }
  clearServersListCache();
}
