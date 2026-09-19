import { enqueueNotification } from '../outbox.js';
import { clearServersListCache, getAllServers } from '../../utils/cache.js';
import { getExpireReminderDays, loadSiteSettings, debug } from '../../utils/settings.js';
import { detectBillingCycle, normalizeBillingCycle, renewExpireDateIfNeeded } from '../../shared/billing.js';
import { isExpireNotificationTimeDue, getZonedDateSerial, parseDateSerial } from './time.js';
import { hasNotificationTarget } from './delivery.js';

export async function checkExpiringServers(db, options = {}) {
  const siteSettings = await loadSiteSettings(db);
  const now = Number(options?.now || Date.now());

  if (options?.scheduled && !isExpireNotificationTimeDue(siteSettings, now)) {
    return false;
  }

  try {
    const allServers = await getAllServers(db);
    const expiringServers = [];
    const reminderDays = getExpireReminderDays(siteSettings.expire_reminder);
    const shouldNotify = reminderDays > 0 && hasNotificationTarget(siteSettings);
    let hasRenewedServers = false;
    const currentDateSerial = getZonedDateSerial(now, siteSettings.notification_timezone);

    for (const s of allServers) {
      if (!s.expire_date) continue;

      const billingCycle = normalizeBillingCycle(detectBillingCycle(s.price) || s.billing_cycle);
      const renewal = renewExpireDateIfNeeded(s.expire_date, billingCycle, s.auto_renewal, now, 1);
      if (renewal.renewed) {
        await db.prepare(
          'UPDATE servers SET expire_date = ?, billing_cycle = ? WHERE id = ?'
        ).bind(renewal.expire_date, billingCycle, s.id).run();
        s.expire_date = renewal.expire_date;
        s.billing_cycle = billingCycle;
        hasRenewedServers = true;
        debug(`[Cron] 服务器 ${s.name} 已自动续费，到期日期更新为 ${s.expire_date}`);
      }

      if (!shouldNotify) continue;

      const expireDateSerial = parseDateSerial(s.expire_date);
      if (!Number.isFinite(expireDateSerial) || !Number.isFinite(currentDateSerial)) continue;

      const days = expireDateSerial - currentDateSerial;

      debug(`[Cron] 检测到服务器 ${s.name} 到期日期 ${s.expire_date}，剩余天数 ${days} 天`);

      if (days > 0 && days <= reminderDays) {
        expiringServers.push({ name: s.name, expire_date: s.expire_date, days });
      }
    }

    if (hasRenewedServers) {
      clearServersListCache();
    }

    if (expiringServers.length > 0) {
      const serverList = expiringServers.map(s => `${s.name}  剩余${s.days}天  ${s.expire_date}`).join('\n');
      const msg = serverList;
      debug(`[Cron] 发送到期提醒通知: ${msg}`);
      const dayKey = getTrafficPeriodKeys(now, siteSettings.notification_timezone).daily;
      db.transaction(() => {
        const claim = db.prepare(`INSERT INTO settings(key,value) VALUES ('expiry_report_last',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value`).bind(dayKey).run();
        if (!claim.meta.changes) return;
        enqueueNotification(db, msg, {
        event: '服务器到期提醒',
        emoji: '⚠️',
        clients: expiringServers.map(s => s.name),
        count: expiringServers.length,
        message: serverList
        }, now);
      });
    }
    return true;
  } catch (e) {
    console.error('到期检测失败:', e);
    return false;
  }
}
