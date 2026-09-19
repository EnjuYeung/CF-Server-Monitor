import { getLatestMetricsForAllServers } from '../../database/schema.js';
import { enqueueNotification } from '../outbox.js';
import { clearServersListCache, getAllServers } from '../../utils/cache.js';
import { loadSiteSettings, normalizeBooleanSetting } from '../../utils/settings.js';
import { isExpireNotificationTimeDue, getZonedDateSerial, parseDateSerial, formatDateSerial, getZonedDateParts } from './time.js';
import { hasNotificationTarget } from './delivery.js';

const TRAFFIC_REPORT_SERVER_BATCH_SIZE = 50;
const TRAFFIC_REPORT_NOTIFICATION_SOFT_LIMIT = 3000;

function formatTrafficBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let size = bytes;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 || size >= 100 ? 0 : size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function isTrafficReportEnabled(settings, field) {
  return normalizeBooleanSetting(settings?.[field]) === 'true';
}

export function calculateTrafficDelta(current, previous) {
  const currentValue = Math.max(0, Number(current) || 0);
  if (previous === null || previous === undefined) return 0;
  const previousValue = Math.max(0, Number(previous) || 0);
  return currentValue >= previousValue ? currentValue - previousValue : currentValue;
}

export function normalizeTrafficSnapshots(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '{}') : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const result = {};
    for (const type of ['daily', 'weekly', 'monthly']) {
      const snapshot = parsed[type];
      if (!snapshot || typeof snapshot !== 'object') continue;
      const time = Number(snapshot.time);
      if (!Number.isFinite(time) || time <= 0) continue;
      result[type] = {
        time,
        rx_bytes: Math.max(0, Number(snapshot.rx_bytes) || 0),
        tx_bytes: Math.max(0, Number(snapshot.tx_bytes) || 0)
      };
    }
    return result;
  } catch (_) {
    return {};
  }
}

export function getTrafficPeriodKeys(timestamp, timezone) {
  const serial = getZonedDateSerial(timestamp, timezone);
  const parts = getZonedDateParts(timestamp, timezone);
  if (!Number.isFinite(serial) || !parts) return null;
  const weekday = ((serial + 4) % 7 + 7) % 7;
  const mondayOffset = (weekday + 6) % 7;
  return {
    daily: formatDateSerial(serial),
    weekly: formatDateSerial(serial - mondayOffset),
    monthly: `${parts.year}-${parts.month}`
  };
}

export function getDueTrafficReportTypes(timestamp, timezone) {
  const keys = getTrafficPeriodKeys(timestamp, timezone);
  if (!keys) return [];
  const parts = getZonedDateParts(timestamp, timezone);
  const serial = getZonedDateSerial(timestamp, timezone);
  const weekday = ((serial + 4) % 7 + 7) % 7;
  const types = [];
  types.push('daily');
  if (weekday === 1) types.push('weekly');
  if (Number(parts.day) === 1) types.push('monthly');
  return types;
}

function isPreviousTrafficPeriod(snapshot, timestamp, type, timezone) {
  const previousTimestamp = Number(snapshot?.time) * 1000;
  if (!Number.isFinite(previousTimestamp) || previousTimestamp >= timestamp) return false;

  const currentKeys = getTrafficPeriodKeys(timestamp, timezone);
  const previousKeys = getTrafficPeriodKeys(previousTimestamp, timezone);
  if (!currentKeys || !previousKeys) return false;

  if (type === 'daily') {
    return parseDateSerial(currentKeys.daily) - parseDateSerial(previousKeys.daily) === 1;
  }
  if (type === 'weekly') {
    return parseDateSerial(currentKeys.weekly) - parseDateSerial(previousKeys.weekly) === 7;
  }
  if (type === 'monthly') {
    const currentParts = getZonedDateParts(timestamp, timezone);
    const previousParts = getZonedDateParts(previousTimestamp, timezone);
    return currentParts && previousParts &&
      (Number(currentParts.year) * 12 + Number(currentParts.month)) -
      (Number(previousParts.year) * 12 + Number(previousParts.month)) === 1;
  }
  return false;
}

export function updateTrafficSnapshots(value, currentRx, currentTx, timestamp, types, timezone = 'UTC') {
  const snapshots = normalizeTrafficSnapshots(value);
  const nowSeconds = Math.floor(timestamp / 1000);
  const rx = Math.max(0, Number(currentRx) || 0);
  const tx = Math.max(0, Number(currentTx) || 0);
  const usage = {};
  let changed = false;

  for (const type of types) {
    const previous = snapshots[type];
    if (previous && isPreviousTrafficPeriod(previous, timestamp, type, timezone)) {
      usage[type] = {
        rx_bytes: calculateTrafficDelta(rx, previous.rx_bytes),
        tx_bytes: calculateTrafficDelta(tx, previous.tx_bytes)
      };
    }
    snapshots[type] = { time: nowSeconds, rx_bytes: rx, tx_bytes: tx };
    changed = true;
  }
  return { snapshots, usage, changed };
}

export function buildTrafficReportContent(servers, rows, label) {
  const usageByServer = new Map((rows || []).map(row => [row.server_id, row]));
  const lines = [];
  const clients = [];
  let totalRx = 0;
  let totalTx = 0;
  let measuredCount = 0;
  const missingLabels = {
    '每日': '暂无昨日数据',
    '每周': '暂无上周数据',
    '每月': '暂无上月数据'
  };

  for (const server of servers) {
    const usage = usageByServer.get(server.id);
    if (!usage) continue;
    clients.push(server.name);
    if (usage.missing) {
      lines.push(`${server.name}  ${missingLabels[label] || '暂无上一周期数据'}`);
      continue;
    }
    const rx = Math.max(0, Number(usage.rx_bytes) || 0);
    const tx = Math.max(0, Number(usage.tx_bytes) || 0);
    totalRx += rx;
    totalTx += tx;
    measuredCount += 1;
    lines.push(`${server.name}  ↓ ${formatTrafficBytes(rx)} + ↑ ${formatTrafficBytes(tx)}  = ${formatTrafficBytes(rx + tx)}`);
  }

  if (lines.length === 0) return null;
  if (measuredCount > 0) {
    lines.push(`总计  ↓ ${formatTrafficBytes(totalRx)} + ↑ ${formatTrafficBytes(totalTx)}  = ${formatTrafficBytes(totalRx + totalTx)}`);
  }
  return {
    msg: lines.join('\n'),
    context: {
      event: `${label}流量报告`,
      emoji: '📊',
      clients,
      count: clients.length,
      message: lines.join('\n')
    }
  };
}

export function buildTrafficReportPayloads(servers, rows, label, batchSize = TRAFFIC_REPORT_SERVER_BATCH_SIZE) {
  const rowServerIds = new Set((Array.isArray(rows) ? rows : []).map(row => row.server_id));
  const normalizedServers = (Array.isArray(servers) ? servers : [])
    .filter(server => rowServerIds.has(server.id));
  const normalizedBatchSize = Math.max(1, Math.floor(Number(batchSize) || TRAFFIC_REPORT_SERVER_BATCH_SIZE));
  const batches = [];
  let currentBatch = [];

  for (const server of normalizedServers) {
    const candidate = [...currentBatch, server];
    const candidateReport = buildTrafficReportContent(candidate, rows, label);
    const exceedsCount = candidate.length > normalizedBatchSize;
    const exceedsLength = currentBatch.length > 0 &&
      candidateReport?.msg.length > TRAFFIC_REPORT_NOTIFICATION_SOFT_LIMIT;
    if (exceedsCount || exceedsLength) {
      batches.push(currentBatch);
      currentBatch = [server];
    } else {
      currentBatch = candidate;
    }
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  const totalBatches = batches.length;
  const payloads = [];

  for (let index = 0; index < batches.length; index += 1) {
    const batchServers = batches[index];
    const report = buildTrafficReportContent(batchServers, rows, label);
    if (!report) continue;
    if (totalBatches > 1) {
      report.context.event = `${label}流量报告（${index + 1}/${totalBatches}）`;
    }
    payloads.push(report);
  }

  return payloads;
}

export async function checkTrafficReports(db, options = {}) {
  const settings = await loadSiteSettings(db);
  const now = Number(options.now || Date.now());
  if (!isTrafficReportEnabled(settings, 'traffic_report_enabled')) return false;
  if (options.scheduled && !isExpireNotificationTimeDue(settings, now)) return false;
  const dueTypes = getDueTrafficReportTypes(now, settings.notification_timezone)
    .filter(type => !options.reportTypes || options.reportTypes.includes(type));
  const servers = await getAllServers(db);
  const latestMetrics = await getLatestMetricsForAllServers(db);
  const periodKeys = getTrafficPeriodKeys(now, settings.notification_timezone);
  const changed = db.transaction(() => {
    const claimed = dueTypes.filter(type => db.prepare(`INSERT INTO settings(key,value) VALUES (?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value <> excluded.value`)
      .bind(`traffic_report_last_${type}`, periodKeys[type]).run().meta.changes > 0);
    if (!claimed.length) return false;
    const usage = { daily: [], weekly: [], monthly: [] };
    for (const server of servers) {
      const metrics = latestMetrics.get(server.id);
      if (!metrics) continue;
      const result = updateTrafficSnapshots(server.traffic_snapshots, metrics.net_rx, metrics.net_tx, now, claimed, settings.notification_timezone);
      db.prepare('UPDATE servers SET traffic_snapshots=? WHERE id=?').bind(JSON.stringify(result.snapshots), server.id).run();
      for (const type of claimed) usage[type].push(result.usage[type] ? { server_id: server.id, ...result.usage[type] } : {server_id:server.id, missing:true});
    }
    if (hasNotificationTarget(settings)) {
      const labels = {daily:'每日',weekly:'每周',monthly:'每月'};
      for (const type of claimed) for (const report of buildTrafficReportPayloads(servers, usage[type], labels[type])) {
        enqueueNotification(db, report.msg, report.context, now);
      }
    }
    return true;
  });
  if (changed) clearServersListCache();
  return changed;
}
