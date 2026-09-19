import { LATEST_REPORT_CACHE_TTL_MS, LATEST_REPORT_CACHE_MAX_SERVERS } from '../utils/config.js';
import { maskPublicIpUpdate } from '../utils/publicMetrics.js';
function normalizeTimestamp(value, fallback = 0) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return fallback;
  return timestamp < 10000000000 ? timestamp * 1000 : timestamp;
}

function getLatestSampleTimestamp(samples) {
  if (!Array.isArray(samples)) return 0;
  let latest = 0;
  for (const sample of samples) {
    if (!sample || typeof sample !== 'object') continue;
    const data = sample.data || sample.payload || sample.metrics || {};
    const timestamp = normalizeTimestamp(
      sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp,
      0
    );
    if (timestamp > latest) latest = timestamp;
  }
  return latest;
}


// One owner for replay packets; authenticated receipt time is persisted independently of history sampling.
export class LatestReports {
  constructor(db) { this.db = db; this.updates = new Map(); }
  set(serverId, samples, reportTs = Date.now()) {
    if (!serverId || !Array.isArray(samples) || !samples.length) return;
    serverId = String(serverId);
    this.db?.prepare('INSERT INTO server_presence(server_id,last_seen) VALUES (?,?) ON CONFLICT(server_id) DO UPDATE SET last_seen=MAX(last_seen, excluded.last_seen)').bind(serverId, reportTs).run();
    this.prune(reportTs);
    const latestSampleTs = getLatestSampleTimestamp(samples);
    const previous = this.updates.get(serverId);
    if (previous?.latestSampleTs > latestSampleTs) return;
    if (previous?.latestSampleTs === latestSampleTs) return;
    this.updates.delete(serverId);
    this.updates.set(serverId, { ...maskPublicIpUpdate({ serverId, reportTs, samples }), latestSampleTs });
    while (this.updates.size > LATEST_REPORT_CACHE_MAX_SERVERS) this.updates.delete(this.updates.keys().next().value);
  }
  lastSeen(serverId, fallback = 0) {
    return this.db?.prepare('SELECT last_seen FROM server_presence WHERE server_id=?').bind(serverId).first()?.last_seen || fallback || 0;
  }
  prune(now) {
    for (const [id, update] of this.updates) if (now - update.reportTs > LATEST_REPORT_CACHE_TTL_MS) this.updates.delete(id);
  }
  getMany(serverIds, now = Date.now()) {
    this.prune(now);
    return serverIds.map(id => this.updates.get(String(id))).filter(Boolean).map(({latestSampleTs, ...update}) => ({ ...update, reportAgeMs: Math.max(0, now - update.reportTs) }));
  }
  delete(id) { this.updates.delete(String(id)); }
  clear() { this.updates.clear(); }
}
