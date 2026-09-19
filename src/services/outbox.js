import { loadSiteSettings } from '../utils/settings.js';
import { sendNotification } from './notifications/delivery.js';

export function enqueueNotification(db, msg, context, now = Date.now()) {
  db.prepare('INSERT INTO notification_outbox (payload, created_at) VALUES (?, ?)')
    .bind(JSON.stringify({ msg, context }), now).run();
}

const drains = new WeakMap();
export function drainNotifications(db, { now = Date.now(), sender = sendNotification } = {}) {
  if (drains.has(db)) return drains.get(db);
  const task = (async () => {
    const settings = await loadSiteSettings(db);
    const rows = db.prepare(`SELECT * FROM notification_outbox WHERE delivered_at IS NULL
      AND next_attempt <= ? ORDER BY id LIMIT 12`).bind(now).all().results;
    for (let offset = 0; offset < rows.length; offset += 3) {
      await Promise.all(rows.slice(offset, offset + 3).map(async row => {
        let result;
        try {
          const payload = JSON.parse(row.payload);
          result = await sender(settings, payload.msg, payload.context);
        } catch (cause) { result = { status: 'failed', error: cause.message }; }
        if (result?.status === 'unconfigured') return;
        if (result?.status !== 'delivered') {
          const error = result?.error || 'Invalid notification delivery result';
          const attempts = row.attempts + 1;
          db.prepare('UPDATE notification_outbox SET attempts=?, next_attempt=?, last_error=? WHERE id=?')
            .bind(attempts, now + Math.min(3600000, 60000 * 2 ** Math.min(attempts - 1, 6)), String(error).slice(0, 1000), row.id).run();
        } else {
          db.prepare('UPDATE notification_outbox SET delivered_at=?, attempts=attempts+1, last_error=NULL WHERE id=?').bind(now, row.id).run();
        }
      }));
    }
    return rows.length;
  })().finally(() => drains.delete(db));
  drains.set(db, task);
  return task;
}
