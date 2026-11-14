import { loadSiteSettings } from '../utils/settings.js';
import { sendNotification } from './notifications/delivery.js';
import { NOTIFICATION_OUTBOX_TTL_MS } from '../utils/config.js';

export function enqueueNotification(db, msg, context, now = Date.now()) {
  db.prepare('INSERT INTO notification_outbox (payload, created_at) VALUES (?, ?)')
    .bind(JSON.stringify({ msg, context }), now).run();
}

const drains = new WeakMap();
export function drainNotifications(db, { now = Date.now(), sender = sendNotification } = {}) {
  if (drains.has(db)) return drains.get(db);
  const task = (async () => {
    const settings = await loadSiteSettings(db);
    const rows = db.prepare(`SELECT * FROM notification_outbox WHERE delivered_at IS NULL AND failed_at IS NULL
      AND next_attempt <= ? AND created_at >= ? ORDER BY id LIMIT 12`).bind(now, now - NOTIFICATION_OUTBOX_TTL_MS).all().results;
    for (let offset = 0; offset < rows.length; offset += 3) {
      await Promise.all(rows.slice(offset, offset + 3).map(async row => {
        let result;
        try {
          const payload = JSON.parse(row.payload);
          result = await sender(settings, payload.msg, payload.context);
        } catch (cause) { result = { status: 'failed', error: cause.message }; }
        if (result?.status === 'unconfigured') return;
        if (result?.status === 'failed' && result.permanent) {
          // The same configuration cannot succeed: stop and keep the reason for the admin.
          const error = String(result.error || 'Notification configuration rejected').slice(0, 1000);
          db.prepare('UPDATE notification_outbox SET attempts=attempts+1, failed_at=?, last_error=? WHERE id=?').bind(now, error, row.id).run();
          console.warn(JSON.stringify({ event: 'notification_stopped', id: row.id, error }));
        } else if (result?.status !== 'delivered') {
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

/** After the channel configuration changes, stopped events from the last 24 hours are sent again. */
export function requeueStoppedNotifications(db, now = Date.now()) {
  const result = db.prepare(`UPDATE notification_outbox SET failed_at=NULL, next_attempt=?
    WHERE failed_at IS NOT NULL AND delivered_at IS NULL AND created_at >= ?`).bind(now, now - NOTIFICATION_OUTBOX_TTL_MS).run();
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

/** The latest stop reason, unless a later notification has been delivered. */
export function getNotificationDeliveryIssue(db) {
  const failed = db.prepare('SELECT failed_at, last_error FROM notification_outbox WHERE failed_at IS NOT NULL ORDER BY failed_at DESC, id DESC LIMIT 1').first();
  if (!failed) return null;
  const delivered = Number(db.prepare('SELECT max(delivered_at) AS t FROM notification_outbox').first()?.t) || 0;
  if (delivered > failed.failed_at) return null;
  const stopped = db.prepare('SELECT count(*) AS n FROM notification_outbox WHERE failed_at IS NOT NULL').first().n;
  return { failed_at: failed.failed_at, error: failed.last_error || '', stopped };
}
