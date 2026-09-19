import { getLatestMetricsForAllServers } from '../../database/schema.js';
import { enqueueNotification } from '../outbox.js';
import { getServerLastSeen, isServerOffline } from '../serverPresence.js';
import { getAllServers } from '../../utils/cache.js';
import { getTgNotifyMinutes, loadSiteSettings } from '../../utils/settings.js';
import { formatLastReportTime } from './time.js';
import { hasNotificationTarget } from './delivery.js';

export async function checkOfflineNodes(env) {
  const db = env.DB;
  const siteSettings = await loadSiteSettings(db);
  const tgNotifyMinutes = getTgNotifyMinutes(siteSettings.tg_notify);

  if (tgNotifyMinutes === 0 || !hasNotificationTarget(siteSettings)) return;

  try {
    const allServers = await getAllServers(db);

    const latestMetricsMap = await getLatestMetricsForAllServers(db);

    let alertState = {};
    const stateRes = await db.prepare(
      "SELECT value FROM settings WHERE key = 'alert_state'"
    ).first();

    if (stateRes) {
      try {
        alertState = JSON.parse(stateRes.value);
      } catch (e) {
        alertState = {};
      }
    }

    const now = Date.now();
    const offlineThreshold = tgNotifyMinutes * 60 * 1000;
    const offlineNodes = [];
    const recoveredNodes = [];

    for (const s of allServers) {
      if (s.offline_notify_disabled === '1') continue;

      const latestMetrics = latestMetricsMap.get(s.id);

      const lastSeen = getServerLastSeen(env, s.id, latestMetrics);
      const isOffline = isServerOffline(s, lastSeen, offlineThreshold, now);

      if (isOffline && !alertState[s.id]) {
        offlineNodes.push({
          name: s.name,
          lastReportTime: lastSeen
        });
        alertState[s.id] = true;
      } else if (!isOffline && alertState[s.id]) {
        recoveredNodes.push(s);
        delete alertState[s.id];
      }
    }

    db.transaction(() => {
    if (offlineNodes.length > 0 || recoveredNodes.length > 0) {
      db.prepare(
        'INSERT INTO settings (key, value) VALUES ("alert_state", ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
      ).bind(JSON.stringify(alertState)).run();
    }

    if (offlineNodes.length > 0) {
      const nodeList = offlineNodes
        .map(n => `${n.name}  最后上报: ${formatLastReportTime(n.lastReportTime, siteSettings)}`)
        .join('\n');
      const msg = nodeList;
      enqueueNotification(db, msg, {
        event: '节点离线告警',
        emoji: '❌',
        clients: offlineNodes.map(n => n.name),
        count: offlineNodes.length,
        message: nodeList
      });
    }

    if (recoveredNodes.length > 0) {
      const nodeList = recoveredNodes.map(n => n.name).join('\n');
      const msg = nodeList;
      enqueueNotification(db, msg, {
        event: '节点恢复通知',
        emoji: '✅',
        clients: recoveredNodes.map(n => n.name),
        count: recoveredNodes.length,
        message: nodeList
      });
    }
    });
  } catch (e) {
    console.error('离线检测失败:', e);
  }
}
