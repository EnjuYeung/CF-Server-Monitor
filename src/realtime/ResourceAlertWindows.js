import { isValidRealtimeId } from '../utils/realtimeId.js';
const RESOURCE_ALERT_STORAGE_KEY = 'resource_alert_windows_v1';
const RESOURCE_ALERT_BUCKET_MS = 60 * 1000;
const RESOURCE_ALERT_MAX_BUCKETS = 10;
const RESOURCE_ALERT_MAX_SERVERS = 1000;
const RESOURCE_ALERT_EVALUATE_RULE_BATCH_MAX = 20;
const RESOURCE_ALERT_SNAPSHOT_INTERVAL_MS = 60 * 1000;
const RESOURCE_ALERT_LATEST_TOLERANCE_MS = 2 * 60 * 1000;
const RESOURCE_ALERT_MIN_SAMPLE_RATIO = 0.4;
const RESOURCE_ALERT_MIN_SAMPLE_COUNT = 2;
const RESOURCE_ALERT_MODE_AVERAGE = 'average';
const RESOURCE_ALERT_MODE_CONTINUOUS = 'continuous';
function getAlertCutoffMinute(now, buckets) {
  return Math.floor(now / RESOURCE_ALERT_BUCKET_MS) * RESOURCE_ALERT_BUCKET_MS -
    Math.max(0, buckets - 1) * RESOURCE_ALERT_BUCKET_MS;
}

function toFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeMetricTimestamp(value, fallback = Date.now()) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return number < 10000000000 ? number * 1000 : number;
}

function normalizeResourceAlertSample(sample) {
  if (!sample || typeof sample !== 'object') {
    return null;
  }

  const data = sample.data || sample.payload || sample.metrics;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }

  const metrics = data.metrics || data.payload || data;
  const ts = normalizeMetricTimestamp(sample.ts || sample.timestamp || metrics.sample_timestamp || metrics.last_updated || metrics.timestamp);
  const cpu = toFiniteNumber(metrics.cpu);
  const ramTotal = toFiniteNumber(metrics.ram_total);
  const ramUsed = toFiniteNumber(metrics.ram_used);
  const ram = ramTotal && ramTotal > 0 && ramUsed !== null
    ? (ramUsed / ramTotal) * 100
    : null;
  const diskTotal = toFiniteNumber(metrics.disk_total);
  const diskUsed = toFiniteNumber(metrics.disk_used);
  const disk = diskTotal && diskTotal > 0 && diskUsed !== null
    ? (diskUsed / diskTotal) * 100
    : null;
  const netIn = Math.max(0, toFiniteNumber(metrics.net_in_speed) ?? 0);
  const netOut = Math.max(0, toFiniteNumber(metrics.net_out_speed) ?? 0);

  return {
    ts,
    minuteTs: Math.floor(ts / RESOURCE_ALERT_BUCKET_MS) * RESOURCE_ALERT_BUCKET_MS,
    cpu,
    ram,
    disk,
    netIn,
    netOut,
    netTotal: netIn + netOut
  };
}

function normalizeThresholds(thresholds = {}) {
  const normalize = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  return {
    cpu: normalize(thresholds.cpuPercent),
    ram: normalize(thresholds.ramPercent),
    disk: normalize(thresholds.diskPercent),
    netIn: normalize(thresholds.netInBps),
    netOut: normalize(thresholds.netOutBps),
    netTotal: normalize(thresholds.netTotalBps)
  };
}

function normalizeResourceAlertMode(value) {
  return String(value || '').trim().toLowerCase() === RESOURCE_ALERT_MODE_CONTINUOUS
    ? RESOURCE_ALERT_MODE_CONTINUOUS
    : RESOURCE_ALERT_MODE_AVERAGE;
}

function getMetricValue(sample, metric) {
  const value = sample?.[metric];
  return Number.isFinite(value) ? value : null;
}

function summarizeMetric(samples, metric) {
  const values = samples
    .map(sample => getMetricValue(sample, metric))
    .filter(value => value !== null);
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return {
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: sum / values.length
  };
}

function getResourceAlertSampleSpan(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return 0;
  return Math.max(0, samples[samples.length - 1].minuteTs - samples[0].minuteTs);
}

function getResourceAlertLatestTolerance(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return RESOURCE_ALERT_LATEST_TOLERANCE_MS;
  const avgSpacing = getResourceAlertSampleSpan(samples) / (samples.length - 1);
  return Math.max(RESOURCE_ALERT_LATEST_TOLERANCE_MS, avgSpacing * 1.5);
}

function hasSufficientResourceAlertSamples(samples, windowMinutes) {
  if (!Array.isArray(samples) || samples.length < RESOURCE_ALERT_MIN_SAMPLE_COUNT) return false;

  const requiredByCount = Math.ceil(windowMinutes * RESOURCE_ALERT_MIN_SAMPLE_RATIO);
  if (samples.length >= requiredByCount) return true;

  const targetSpan = Math.max(1, windowMinutes - 1) *
    RESOURCE_ALERT_BUCKET_MS *
    RESOURCE_ALERT_MIN_SAMPLE_RATIO;
  return getResourceAlertSampleSpan(samples) >= targetSpan;
}

export class ResourceAlertWindows {
  constructor(env) { this.env = env; this.windows = new Map(); this.loaded = false; this.dirty = false; this.lastSnapshotAt = 0; }
  delete(id) { this.load(); this.windows.delete(id); this.dirty = true; this.persist(Date.now(), true); }
  normalizeServerIds(ids) {
    if (!Array.isArray(ids) || ids.length > RESOURCE_ALERT_MAX_SERVERS) {
      return { ok: false, ids: [] };
    }

    const seen = new Set();
    const normalized = [];
    for (const id of ids) {
      if (typeof id !== 'string') {
        return { ok: false, ids: [] };
      }

      const value = id.trim();
      if (!isValidRealtimeId(value)) {
        return { ok: false, ids: [] };
      }

      if (seen.has(value)) continue;
      seen.add(value);
      normalized.push(value);
    }
    return { ok: true, ids: normalized };
  }

  normalizeRules(rules) {
    if (
      !Array.isArray(rules) ||
      rules.length === 0 ||
      rules.length > RESOURCE_ALERT_EVALUATE_RULE_BATCH_MAX
    ) {
      return { ok: false, rules: [] };
    }

    const normalized = [];
    for (const rule of rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
        return { ok: false, rules: [] };
      }

      const ruleId = typeof rule.ruleId === 'string'
        ? rule.ruleId.trim()
        : String(rule.ruleId || '').trim();
      if (!isValidRealtimeId(ruleId)) {
        return { ok: false, rules: [] };
      }

      const serverIds = this.normalizeServerIds(rule.serverIds);
      if (!serverIds.ok) {
        return { ok: false, rules: [] };
      }

      normalized.push({
        ruleId,
        serverIds: serverIds.ids,
        mode: rule.mode,
        windowMinutes: rule.windowMinutes,
        thresholds: rule.thresholds
      });
    }

    return { ok: true, rules: normalized };
  }

  load() {
    if (this.loaded) return;

    this.loaded = true;
    try {
      const snapshot = JSON.parse(this.env.DB.prepare('SELECT value FROM runtime_state WHERE key = ?').bind(RESOURCE_ALERT_STORAGE_KEY).first()?.value || 'null');
      const windows = Array.isArray(snapshot?.windows) ? snapshot.windows : [];
      const now = Date.now();
      const cutoffMinute = getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS);

      for (const item of windows) {
        if (!item || !item.serverId || !Array.isArray(item.samples)) continue;
        const samples = item.samples
          .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
          .sort((a, b) => a.minuteTs - b.minuteTs)
          .slice(-RESOURCE_ALERT_MAX_BUCKETS);
        if (samples.length > 0) {
          this.windows.set(String(item.serverId), { samples });
        }
      }

      this.lastSnapshotAt = Number(snapshot?.savedAt) || 0;
    } catch (e) {
      console.warn('[resource-alert] load snapshot failed:', e.message || e);
    }
  }

  prune(now = Date.now()) {
    const cutoffMinute = getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS);
    let changed = false;
    for (const [serverId, window] of this.windows) {
      const originalSamples = Array.isArray(window?.samples) ? window.samples : [];
      const samples = originalSamples
        .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
        .sort((a, b) => a.minuteTs - b.minuteTs)
        .slice(-RESOURCE_ALERT_MAX_BUCKETS);

      if (samples.length === 0) {
        this.windows.delete(serverId);
        changed = true;
      } else {
        const sameSamples = samples.length === originalSamples.length &&
          samples.every((sample, index) => sample === originalSamples[index]);
        if (!sameSamples) changed = true;
        this.windows.set(serverId, { samples });
      }
    }

    while (this.windows.size > RESOURCE_ALERT_MAX_SERVERS) {
      const oldestServerId = this.windows.keys().next().value;
      if (oldestServerId === undefined) break;
      this.windows.delete(oldestServerId);
      changed = true;
    }

    if (changed) this.dirty = true;
    return changed;
  }

  async ingest(updates, now = Date.now()) {
    this.load();
    this.prune(now);

    for (const update of updates) {
      if (!update || !update.serverId || !Array.isArray(update.samples)) continue;
      const serverId = String(update.serverId);
      const minuteMap = new Map(
        (this.windows.get(serverId)?.samples || []).map(sample => [sample.minuteTs, sample])
      );

      for (const sample of update.samples) {
        const normalized = normalizeResourceAlertSample(sample);
        if (!normalized) continue;
        minuteMap.set(normalized.minuteTs, normalized);
      }

      const samples = Array.from(minuteMap.values())
        .filter(sample => sample && Number(sample.minuteTs) >= getAlertCutoffMinute(now, RESOURCE_ALERT_MAX_BUCKETS))
        .sort((a, b) => a.minuteTs - b.minuteTs)
        .slice(-RESOURCE_ALERT_MAX_BUCKETS);

      if (samples.length > 0) {
        this.windows.delete(serverId);
        this.windows.set(serverId, { samples });
        this.dirty = true;
      }
    }

    await this.persist(now);
  }

  persist(now = Date.now(), force = false) {
    if (!this.dirty && !force) return;
    if (!force && now - this.lastSnapshotAt < RESOURCE_ALERT_SNAPSHOT_INTERVAL_MS) return;

    this.prune(now);
    const windows = [];
    for (const [serverId, window] of this.windows) {
      if (!window || !Array.isArray(window.samples) || window.samples.length === 0) continue;
      windows.push({
        serverId,
        samples: window.samples
      });
    }

    try {
      this.env.DB.prepare('INSERT INTO runtime_state(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(RESOURCE_ALERT_STORAGE_KEY, JSON.stringify({ savedAt: now, windows })).run();
      this.dirty = false;
      this.lastSnapshotAt = now;
    } catch (e) {
      console.warn('[resource-alert] persist snapshot failed:', e.message || e);
    }
  }

  evaluateRule(rule = {}, now = Date.now()) {
    const windowMinutesNumber = Number(rule.windowMinutes);
    const windowMinutes = Number.isInteger(windowMinutesNumber)
      ? Math.max(5, Math.min(10, windowMinutesNumber))
      : 5;
    const cutoffMinute = getAlertCutoffMinute(now, windowMinutes);
    const mode = normalizeResourceAlertMode(rule.mode);
    const thresholds = normalizeThresholds(rule.thresholds);
    const metricThresholds = [
      ['cpu', thresholds.cpu],
      ['ram', thresholds.ram],
      ['disk', thresholds.disk],
      ['netIn', thresholds.netIn],
      ['netOut', thresholds.netOut],
      ['netTotal', thresholds.netTotal]
    ].filter(([, threshold]) => threshold > 0);

    const alerts = [];
    const evaluatedServerIds = [];
    const evaluations = [];
    if (metricThresholds.length === 0) {
      return { ruleId: rule.ruleId, now, mode, windowMinutes, alerts, evaluatedServerIds, evaluations };
    }

    for (const serverId of rule.serverIds || []) {
      const samples = (this.windows.get(serverId)?.samples || [])
        .filter(sample => sample && Number(sample.minuteTs) >= cutoffMinute)
        .sort((a, b) => a.minuteTs - b.minuteTs);
      if (!hasSufficientResourceAlertSamples(samples, windowMinutes)) continue;

      const latestSample = samples[samples.length - 1];
      if (!latestSample || now - latestSample.ts > getResourceAlertLatestTolerance(samples)) continue;

      const metrics = [];
      const evaluationMetrics = [];
      let canEvaluateAllMetrics = true;
      for (const [metric, threshold] of metricThresholds) {
        const metricSamples = samples
          .map(sample => ({ sample, value: getMetricValue(sample, metric) }))
          .filter(item => item.value !== null);
        if (!hasSufficientResourceAlertSamples(metricSamples.map(item => item.sample), windowMinutes)) {
          canEvaluateAllMetrics = false;
          break;
        }
        const summary = summarizeMetric(metricSamples.map(item => item.sample), metric);
        if (!summary) {
          canEvaluateAllMetrics = false;
          break;
        }

        const triggerValue = mode === RESOURCE_ALERT_MODE_AVERAGE ? summary.avg : summary.current;
        const isTriggered = mode === RESOURCE_ALERT_MODE_AVERAGE
          ? triggerValue > threshold
          : metricSamples.every(item => item.value > threshold);

        const metricEvaluation = {
          metric,
          mode,
          threshold,
          triggerValue,
          triggered: isTriggered,
          ...summary
        };
        evaluationMetrics.push(metricEvaluation);
        if (isTriggered) {
          metrics.push(metricEvaluation);
        }
      }

      if (!canEvaluateAllMetrics) continue;
      evaluatedServerIds.push(serverId);
      evaluations.push({
        serverId,
        mode,
        windowMinutes,
        sampleCount: samples.length,
        minSampleRatio: RESOURCE_ALERT_MIN_SAMPLE_RATIO,
        latestTs: latestSample.ts,
        metrics: evaluationMetrics
      });

      if (metrics.length > 0) {
        alerts.push({
          serverId,
          mode,
          windowMinutes,
          sampleCount: samples.length,
          minSampleRatio: RESOURCE_ALERT_MIN_SAMPLE_RATIO,
          latestTs: latestSample.ts,
          metrics
        });
      }
    }

    return { ruleId: rule.ruleId, now, mode, windowMinutes, alerts, evaluatedServerIds, evaluations };
  }

  async evaluateRules(rules = []) {
    const normalized = this.normalizeRules(rules);
    if (!normalized.ok) throw new Error('invalid resource alert rules');
    rules = normalized.rules;
    this.load();
    const now = Date.now();
    this.prune(now);
    const results = [];

    for (const rule of rules) {
      results.push(this.evaluateRule(rule, now));
    }

    await this.persist(now);
    return { now, results };
  }

}
