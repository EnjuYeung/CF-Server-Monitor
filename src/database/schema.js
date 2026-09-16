import { clearAllCaches, getMetricsHistoryCache, setMetricsHistoryCache, getCacheDuration, clearLatestMetricsCache } from '../utils/cache.js';
import { normalizeLongHistoryPoints, DEFAULT_LONG_HISTORY_POINTS } from '../utils/settings.js';
import { attachDiskMetricsObject, flattenDiskMetrics, isDisabledProbeMetric, normalizeProbeMetricRow } from '../utils/metrics.js';
import { createHistoryTableSql, HISTORY_INSERT_COLUMNS, HISTORY_TABLE_COLUMNS } from '../utils/historyFields.js';
import { DASHBOARD_LATENCY_WINDOW_POINTS, DASHBOARD_LATENCY_WINDOW_HOURS, DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS } from '../utils/config.js';
const DAY_MS = 86400000;
const LATENCY_NODE_FIELDS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'];
const dashboardLatencyHistoryCache = new Map();
export function clearDashboardLatencyHistoryCache() { dashboardLatencyHistoryCache.clear(); }

export async function initDatabase(db) {
  db.transaction(() => {
    db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT,
          server_group TEXT DEFAULT 'Default',
          region TEXT DEFAULT '',
          tags TEXT DEFAULT '',
          note TEXT DEFAULT '',
          price TEXT DEFAULT '',
          billing_cycle TEXT DEFAULT 'month',
          auto_renewal TEXT DEFAULT '0',
          currency TEXT DEFAULT '¥',
          expire_date TEXT DEFAULT '',
          traffic_limit TEXT DEFAULT '',
          traffic_calc_type TEXT DEFAULT 'total',
          traffic_snapshots TEXT DEFAULT '{}',
          "interface" TEXT DEFAULT '',
          reset_day INTEGER DEFAULT 1,
          collect_interval INTEGER DEFAULT 0,
          report_interval INTEGER DEFAULT 60,
          wss_report_interval INTEGER DEFAULT 2,
          connection_mode TEXT DEFAULT 'auto',
          ping_mode TEXT DEFAULT 'tcp',
          auto_update TEXT DEFAULT '0',
          custom_ct TEXT DEFAULT '',
          custom_cu TEXT DEFAULT '',
          custom_cm TEXT DEFAULT '',
          custom_bd TEXT DEFAULT '',
          node_1 TEXT DEFAULT '',
          node_2 TEXT DEFAULT '',
          node_3 TEXT DEFAULT '',
          node_4 TEXT DEFAULT '',
          rx_correction REAL DEFAULT NULL,
          tx_correction REAL DEFAULT NULL,
          offline_notify_disabled TEXT DEFAULT '0',
          is_hidden TEXT DEFAULT '0',
          sort_order INTEGER DEFAULT 0,
          timestamp INTEGER DEFAULT 0
        )
;

      CREATE TRIGGER IF NOT EXISTS servers_capacity BEFORE INSERT ON servers
        WHEN (SELECT count(*) FROM servers) >= 50
        BEGIN SELECT RAISE(ABORT, 'Maximum 50 servers supported'); END;
      CREATE TABLE IF NOT EXISTS server_latest (
        server_id TEXT PRIMARY KEY REFERENCES servers(id) ON DELETE CASCADE,
        timestamp INTEGER NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runtime_state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS notification_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, payload TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, delivered_at INTEGER, last_error TEXT
      );`);
    db.exec(createHistoryTableSql());
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_history_server_time ON metrics_history(server_id, timestamp);
      PRAGMA user_version = 1;`);
  });
}

export async function clearHistory(db) {
  db.transaction(() => {
    db.exec('DELETE FROM metrics_history;');
  });
  clearAllCaches(); clearDashboardLatencyHistoryCache();
  return { success: true, message: 'databaseRebuiltSuccess' };
}

// Rolling retention avoids the empty-current-table gap at week boundaries.
export function cleanupHistory(db, now = Date.now()) {
  const result = db.prepare('DELETE FROM metrics_history WHERE timestamp < ?').bind(now - 7 * DAY_MS).run();
  db.prepare('DELETE FROM notification_outbox WHERE delivered_at IS NOT NULL AND delivered_at < ?').bind(now - 7 * DAY_MS).run();
  return result;
}

export async function getMetricsHistory(db, serverId, hours, columns, server = null, longHistoryPoints = DEFAULT_LONG_HISTORY_POINTS) {
  const allowed = new Set(HISTORY_TABLE_COLUMNS.map(([name]) => name));
  const selected = columns.split(',').map(c => c.trim()).filter(c => c !== 'timestamp');
  if (!selected.length || selected.some(c => !allowed.has(c))) throw new Error('Invalid history columns');
  const queryHours = Math.min(Number(hours), 168);
  if (!(queryHours > 0)) throw new Error('Invalid history range');
  const points = queryHours > 1 ? Number(normalizeLongHistoryPoints(longHistoryPoints)) : 160;
  const cached = getMetricsHistoryCache(serverId, queryHours, columns, points);
  if (cached && Date.now() - cached.timestamp < getCacheDuration(queryHours)) return cached.data;
  const now = Date.now(); const start = now - queryHours * 3600000;
  const interval = Math.max(1000, Math.ceil((now - start + 1) / points));
  const rows = db.prepare(`WITH ranked AS (
    SELECT timestamp, ${selected.join(',')}, ROW_NUMBER() OVER (
      PARTITION BY CAST((timestamp - ?) / ? AS INTEGER) ORDER BY timestamp DESC
    ) AS rn FROM metrics_history WHERE server_id = ? AND timestamp >= ? AND timestamp <= ?
  ) SELECT timestamp, ${selected.join(',')} FROM ranked WHERE rn = 1 ORDER BY timestamp`).bind(start, interval, serverId, start, now).all().results;
  const result = rows.map(row => attachDiskMetricsObject(normalizeProbeMetricRow(row)));
  setMetricsHistoryCache(serverId, queryHours, columns, result, points);
  return result;
}
function normalizeLatencyHistoryValue(value, metricType) {
  if (isDisabledProbeMetric(value)) return false;
  if (value === null || value === undefined || value === '') return null;

  const number = Number(value);
  if (!Number.isFinite(number)) return null;

  if (metricType === 'loss') {
    return Math.max(0, Math.min(100, Math.round(number)));
  }
  return number > 0 ? Math.round(number) : null;
}

function buildLatencyHistoryPoint(row, metricType, { includeEmpty = false } = {}) {
  const timestamp = Number(row?.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const point = { ts: timestamp };
  if (Number(row.sample_timestamp) > 0) point.sample_ts = Number(row.sample_timestamp);
  for (const field of LATENCY_NODE_FIELDS) {
    const column = `${metricType}_${field}`;
    if (!Object.prototype.hasOwnProperty.call(row, column)) continue;
    const value = normalizeLatencyHistoryValue(row[column], metricType);
    if (value !== null) point[field] = value;
    else if (includeEmpty) point[field] = null;
  }

  return includeEmpty || Object.keys(point).length > 1 ? point : null;
}

function normalizeDashboardLatencyRows(rows, options = {}) {
  const ping = [];
  const loss = [];

  for (const row of rows || []) {
    const pingPoint = buildLatencyHistoryPoint(row, 'ping', options);
    if (pingPoint) ping.push(pingPoint);

    const lossPoint = buildLatencyHistoryPoint(row, 'loss', options);
    if (lossPoint) loss.push(lossPoint);
  }

  ping.sort((a, b) => a.ts - b.ts);
  loss.sort((a, b) => a.ts - b.ts);
  return { ping, loss };
}

function parseDashboardLatencySample(row) {
  if (!row?.sample_json) return null;
  try {
    return JSON.parse(row.sample_json);
  } catch (_) {
    return null;
  }
}

function normalizeDashboardLatencyWindow(sampleRows, { queryStart, intervalMs, points }) {
  const rows = Array.from({ length: points }, (_, index) => {
    const bucketTimestamp = queryStart + index * intervalMs;
    const sample = parseDashboardLatencySample(sampleRows?.[index]);
    if (!sample || typeof sample !== 'object') {
      return { timestamp: bucketTimestamp };
    }

    return {
      ...sample,
      sample_timestamp: Number(sample.timestamp),
      timestamp: bucketTimestamp
    };
  });

  return normalizeDashboardLatencyRows(rows, { includeEmpty: true });
}


export async function getDashboardLatencyHistory(db, servers, options = {}) {
  const now = Number(options.now || Date.now());
  const points = options.points || DASHBOARD_LATENCY_WINDOW_POINTS;
  const intervalMs = Math.ceil(DASHBOARD_LATENCY_WINDOW_HOURS * 3600000 / points);
  // Include the current, unfinished bucket on a stable six-minute grid.
  // A REST refresh must not move a live sample into a different time bucket.
  const start = Math.floor(now / intervalMs) * intervalMs - (points - 1) * intervalMs;
  const result = new Map();
  for (const server of servers) {
    const cached = dashboardLatencyHistoryCache.get(server.id);
    if (options.cache !== false && cached && cached.db === db && cached.points === points && cached.start === start && now >= cached.time && now - cached.time < DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) {
      result.set(server.id, cached.data); continue;
    }
    const rows = db.prepare(`WITH ranked AS (
      SELECT *, CAST((timestamp - ?) / ? AS INTEGER) AS bucket,
        ROW_NUMBER() OVER (PARTITION BY CAST((timestamp - ?) / ? AS INTEGER) ORDER BY timestamp DESC) AS rn
      FROM metrics_history WHERE server_id = ? AND timestamp >= ? AND timestamp <= ?
    ) SELECT * FROM ranked WHERE rn = 1 ORDER BY bucket`).bind(start, intervalMs, start, intervalMs, server.id, start, now).all().results;
    const samples = [];
    for (const row of rows) if (row.bucket < points) samples[row.bucket] = { sample_json: JSON.stringify(row) };
    const window = normalizeDashboardLatencyWindow(samples, { queryStart: start, intervalMs, points });
    result.set(server.id, window);
    if (options.cache !== false) dashboardLatencyHistoryCache.set(server.id, { db, points, start, time: now, data: window });
  }
  for (const [id, item] of dashboardLatencyHistoryCache) if (now - item.time >= DASHBOARD_LATENCY_WINDOW_CACHE_TTL_MS) dashboardLatencyHistoryCache.delete(id);
  return result;
}

export async function saveMetricsHistory(db, serverId, metrics, regionCode = '', timestamp = null, agentVersion = '') {
  const raw = Number(timestamp);
  const now = Number.isFinite(raw) && raw > 0 ? (raw < 1e10 ? raw * 1000 : raw) : Date.now();
  if (now > Date.now() + 60000 || now < Date.now() - 7 * DAY_MS) throw new Error('Sample timestamp outside supported window');
  const parsePing = value => isDisabledProbeMetric(value) ? 'false' : (Number(value) > 0 ? Number(value) : null);
  const parseLoss = value => isDisabledProbeMetric(value) ? 'false' : (value == null ? null : (Number.isFinite(Number(value)) ? Math.max(0, Math.min(100, Number(value))) : null));
  const diskMetrics = flattenDiskMetrics(metrics);
  const columns = HISTORY_INSERT_COLUMNS.filter(column => column !== 'id');
  const values = [
    serverId,
    now,
    agentVersion || '',
    parseFloat(metrics.cpu) || 0,
    metrics.load || metrics.load_avg || '0 0 0',
    parseFloat(metrics.net_in_speed) || 0,
    parseFloat(metrics.net_out_speed) || 0,
    parseFloat(metrics.net_rx) || 0,
    parseFloat(metrics.net_tx) || 0,
    parseInt(metrics.processes) || 0,
    parseInt(metrics.tcp_conn) || 0,
    parseInt(metrics.udp_conn) || 0,
    parsePing(metrics.ping_ct),
    parsePing(metrics.ping_cu),
    parsePing(metrics.ping_cm),
    parsePing(metrics.ping_bd),
    parsePing(metrics.ping_node_1),
    parsePing(metrics.ping_node_2),
    parsePing(metrics.ping_node_3),
    parsePing(metrics.ping_node_4),
    parseLoss(metrics.loss_ct),
    parseLoss(metrics.loss_cu),
    parseLoss(metrics.loss_cm),
    parseLoss(metrics.loss_bd),
    parseLoss(metrics.loss_node_1),
    parseLoss(metrics.loss_node_2),
    parseLoss(metrics.loss_node_3),
    parseLoss(metrics.loss_node_4),
    parseFloat(metrics.ram_total) || 0,
    parseFloat(metrics.ram_used) || 0,
    parseFloat(metrics.swap_total) || 0,
    parseFloat(metrics.swap_used) || 0,
    parseFloat(metrics.disk_total) || 0,
    parseFloat(metrics.disk_used) || 0,
    diskMetrics.disk_read_bps,
    diskMetrics.disk_write_bps,
    diskMetrics.disk_read_iops,
    diskMetrics.disk_write_iops,
    diskMetrics.disk_await_ms,
    diskMetrics.disk_util,
    parseInt(metrics.cpu_cores) || 0,
    metrics.cpu_info || '',
    Array.isArray(metrics.gpu_info) ? JSON.stringify(metrics.gpu_info) : (metrics.gpu_info || ''),
    metrics.arch || '',
    metrics.os || '',
    metrics.kernel_version || '',
    regionCode,
    metrics.ip_v4 || '0',
    metrics.ip_v6 || '0',
    metrics.boot_time || '',
    parseFloat(metrics.net_rx_monthly) || 0,
    parseFloat(metrics.net_tx_monthly) || 0
  ];
  const row = Object.fromEntries(columns.map((column, index) => [column, values[index]]));
  db.batch([
    db.prepare(`INSERT INTO metrics_history (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})
      ON CONFLICT(server_id, timestamp) DO UPDATE SET ${columns.filter(c => !['server_id', 'timestamp'].includes(c)).map(c => `${c}=excluded.${c}`).join(',')}`).bind(...values),
    db.prepare(`INSERT INTO server_latest (server_id, timestamp, data) VALUES (?, ?, ?)
      ON CONFLICT(server_id) DO UPDATE SET timestamp=excluded.timestamp, data=excluded.data
      WHERE excluded.timestamp >= server_latest.timestamp`).bind(serverId, now, JSON.stringify(row))
  ]);
  clearLatestMetricsCache();
  dashboardLatencyHistoryCache.delete(serverId);
}

export async function getLatestMetrics(db, serverId) {
  const row = db.prepare('SELECT data FROM server_latest WHERE server_id = ?').bind(serverId).first();
  return row ? normalizeProbeMetricRow(JSON.parse(row.data)) : null;
}

export async function getLatestMetricsForAllServers(db) {
  return new Map(db.prepare('SELECT server_id, data FROM server_latest').all().results
    .map(row => [row.server_id, normalizeProbeMetricRow(JSON.parse(row.data))]));
}
