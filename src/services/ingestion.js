import { DISK_IO_FIELD_TO_COLUMN, DISK_IO_METRIC_FIELDS, mergeMetricsIntoServer, coerceNumericMetricFields } from '../utils/metrics.js';
import { BROADCAST_DELETE_FIELDS, HISTORY_METRIC_AGGREGATION_POLICY } from '../utils/historyFields.js';
import { UPDATE_MAX_BATCH_SAMPLES } from '../utils/config.js';
import { isValidTrafficCorrection } from '../utils/agentConfig.js';
// 将最新一次上报打包成前端可直接消费的 "当前状态" 对象
// 与 /api/server 和 /api/servers 返回的字段保持一致，便于页面直接合并
function buildPayloadForBroadcast(id, metrics = {}, extra = {}) {
  const payload = {};
  mergeMetricsIntoServer(payload, metrics);
  payload.id = id;
  payload.region = extra.region || '';
  payload.agent_version = extra.agentVersion || metrics.agent_version || '';
  payload.last_updated = extra.timestamp || metrics.timestamp || Date.now();
  payload.timestamp = payload.last_updated;
  return coerceNumericMetricFields(payload);
}

const DISK_IO_COLUMN_TO_FIELD = Object.freeze(Object.fromEntries(
  DISK_IO_METRIC_FIELDS.map(field => [DISK_IO_FIELD_TO_COLUMN[field], field])
));

function normalizeTimestamp(value, fallback = Date.now()) {
  const ts = Number(value);
  if (!Number.isFinite(ts) || ts <= 0) return fallback;
  return ts < 10000000000 ? ts * 1000 : ts;
}

export function normalizeAgentVersion(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/[^0-9A-Za-z.+_-]/g, '')
    .slice(0, 64);
}

export function normalizeCorrectionValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  return isValidTrafficCorrection(value) ? Number(value) : null;
}

export function normalizeMetricSamples(data) {
  const now = Date.now();
  const rawSamples = Array.isArray(data.samples)
    ? data.samples
    : (Array.isArray(data.batch) ? data.batch : []);

  const samples = rawSamples.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const metrics = item.metrics || item.data || item.payload || item;
    if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics) || Object.keys(metrics).length === 0) return null;
    const ts = normalizeTimestamp(item.ts ?? item.timestamp ?? metrics.timestamp, now);
    return { ts, metrics };
  }).filter(Boolean);

  if (samples.length === 0 && data.metrics && typeof data.metrics === 'object' && !Array.isArray(data.metrics) && Object.keys(data.metrics).length > 0) {
    samples.push({
      ts: normalizeTimestamp(data.metrics.timestamp, now),
      metrics: data.metrics
    });
  }

  samples.sort((a, b) => a.ts - b.ts);
  return samples.slice(-UPDATE_MAX_BATCH_SAMPLES);
}

export function getReportMetrics(data, latestSample) {
  const reportMetrics = data?.metrics && typeof data.metrics === 'object' ? data.metrics : null;
  if (!reportMetrics) return latestSample?.metrics || {};
  return {
    ...reportMetrics,
    ...(latestSample?.metrics || {})
  };
}

function hasOwnMetric(source, field) {
  return !!source && Object.prototype.hasOwnProperty.call(source, field);
}

function isPlainMetricObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function toFiniteHistoryMetricNumber(value) {
  if (value === false || value === 'false' || value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function getHistoryMetricSourceValue(source, field) {
  if (!isPlainMetricObject(source)) return null;

  if (hasOwnMetric(source, field)) {
    return source[field];
  }

  const diskField = DISK_IO_COLUMN_TO_FIELD[field];
  if (diskField && isPlainMetricObject(source.disk) && hasOwnMetric(source.disk, diskField)) {
    return source.disk[diskField];
  }

  return null;
}

function getSampleMetricSource(sample) {
  if (!isPlainMetricObject(sample)) return null;
  return sample.metrics || sample.data || sample.payload || sample;
}

function createEmptyHistoryMetricAggregate() {
  return { max: {}, avg: {} };
}

export function mergeHistoryMetricAggregates(...aggregates) {
  const result = createEmptyHistoryMetricAggregate();

  for (const aggregate of aggregates) {
    if (!isPlainMetricObject(aggregate)) continue;

    if (isPlainMetricObject(aggregate.max)) {
      for (const [field, value] of Object.entries(aggregate.max)) {
        const number = toFiniteHistoryMetricNumber(value);
        if (number === null) continue;
        if (!hasOwnMetric(result.max, field) || number > result.max[field]) {
          result.max[field] = number;
        }
      }
    }

    if (isPlainMetricObject(aggregate.avg)) {
      for (const [field, item] of Object.entries(aggregate.avg)) {
        if (!isPlainMetricObject(item)) continue;
        const sum = toFiniteHistoryMetricNumber(item.sum);
        const count = Number(item.count);
        if (sum === null || !Number.isFinite(count) || count <= 0) continue;
        if (!result.avg[field]) {
          result.avg[field] = { sum: 0, count: 0 };
        }
        result.avg[field].sum += sum;
        result.avg[field].count += count;
      }
    }
  }

  return result;
}

function addHistoryMetricAggregateSource(aggregate, source) {
  if (!isPlainMetricObject(source)) return;

  for (const [field, policy] of Object.entries(HISTORY_METRIC_AGGREGATION_POLICY)) {
    const value = toFiniteHistoryMetricNumber(getHistoryMetricSourceValue(source, field));
    if (value === null) continue;

    if (policy === 'max') {
      if (!hasOwnMetric(aggregate.max, field) || value > aggregate.max[field]) {
        aggregate.max[field] = value;
      }
    } else if (policy === 'avg') {
      if (!aggregate.avg[field]) {
        aggregate.avg[field] = { sum: 0, count: 0 };
      }
      aggregate.avg[field].sum += value;
      aggregate.avg[field].count += 1;
    }
  }
}

export function collectHistoryMetricAggregates(samples = [], previousAggregate = null) {
  const aggregate = mergeHistoryMetricAggregates(previousAggregate);
  for (const sample of Array.isArray(samples) ? samples : []) {
    addHistoryMetricAggregateSource(aggregate, getSampleMetricSource(sample));
  }
  return aggregate;
}

function setHistoryMetricResultValue(result, field, value) {
  const diskField = DISK_IO_COLUMN_TO_FIELD[field];
  if (diskField) {
    result[field] = value;
    result.disk = isPlainMetricObject(result.disk)
      ? { ...result.disk, [diskField]: value }
      : { [diskField]: value };
    return;
  }

  result[field] = value;
}

export function applyHistoryMetricAggregates(metrics = {}, aggregate = null) {
  const result = { ...(metrics || {}) };
  const mergedAggregate = mergeHistoryMetricAggregates(aggregate);

  for (const [field, value] of Object.entries(mergedAggregate.max)) {
    setHistoryMetricResultValue(result, field, value);
  }

  for (const [field, item] of Object.entries(mergedAggregate.avg)) {
    if (!item || !Number.isFinite(item.sum) || !Number.isFinite(item.count) || item.count <= 0) continue;
    setHistoryMetricResultValue(result, field, item.sum / item.count);
  }

  return result;
}

export function getHistoryMetrics(data, samples, latestSample) {
  return applyHistoryMetricAggregates(
    getReportMetrics(data, latestSample),
    collectHistoryMetricAggregates(samples)
  );
}

function buildSamplePayloadForBroadcast(metrics = {}, timestamp = Date.now()) {
  const payload = metrics && typeof metrics === 'object' ? { ...metrics } : {};
  BROADCAST_DELETE_FIELDS.forEach(field => delete payload[field]);
  payload.last_updated = timestamp;
  payload.sample_timestamp = timestamp;
  return coerceNumericMetricFields(payload);
}

export function toBroadcastSamples(id, samples, regionCode, agentVersion = '', reportMetrics = null) {
  const lastIndex = samples.length - 1;
  return samples.map((sample, index) => {
    const metrics = reportMetrics && typeof reportMetrics === 'object' && index === lastIndex
      ? { ...reportMetrics, ...(sample.metrics || {}) }
      : (sample.metrics || {});
    if (index !== lastIndex) {
      return { ts: sample.ts, payload: buildSamplePayloadForBroadcast(metrics, sample.ts) };
    }

    const payload = buildPayloadForBroadcast(id, metrics, {
      region: regionCode,
      agentVersion,
      timestamp: sample.ts
    });
    const filtered = Object.assign({}, payload);
    BROADCAST_DELETE_FIELDS.forEach(field => delete filtered[field]);
    filtered.sample_timestamp = sample.ts;
    return { ts: sample.ts, payload: filtered };
  });
}
