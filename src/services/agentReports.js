import { clearHistory, saveMetricsHistory } from '../database/schema.js';
import { LatestReports } from '../realtime/LatestReports.js';
import { AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS } from '../utils/config.js';
import { AppError } from '../utils/errors.js';
import {
  applyHistoryMetricAggregates,
  collectHistoryMetricAggregates,
  getReportMetrics,
  mergeHistoryMetricAggregates,
  normalizeMetricSamples,
  toBroadcastSamples
} from './ingestion.js';

export class InvalidAgentReport extends Error {}
export class AgentReportsClosed extends AppError {
  constructor() { super('Server restarting', 503); }
}

// Owns accepted reports and pending history across HTTP/WS and socket lifetimes.
// The publish adapter only handles alerts and viewer delivery, not receipt/history.
export class AgentReports {
  #db;
  #publish;
  #latestReports;
  #historyWrites = new Map();
  #processing = new Set();
  #historyGeneration = 0;
  #closing = false;
  #closeTask;

  constructor(db, publish) {
    this.#db = db;
    this.#publish = publish;
    this.#latestReports = new LatestReports(db);
  }

  receive(serverId, data, options = {}) {
    if (this.#closing) return Promise.reject(new AgentReportsClosed());
    return this.#track(this.#receive(serverId, data, options));
  }

  // Also accepts already decoded in-process updates used by the realtime module.
  ingest(serverId, samples, reportTs = Date.now()) {
    if (this.#closing) return Promise.reject(new AgentReportsClosed());
    return this.#track(this.#ingest(serverId, samples, reportTs));
  }

  latestUpdates(serverIds, now = Date.now()) {
    return this.#latestReports.getMany(serverIds, now);
  }

  lastSeen(serverId, fallback = 0) {
    return this.#latestReports.lastSeen(serverId, fallback);
  }

  removeServer(serverId) {
    this.#historyWrites.delete(String(serverId));
    this.#latestReports.delete(serverId);
  }

  clearHistory() {
    this.#historyGeneration++;
    for (const state of this.#historyWrites.values()) {
      delete state.pendingAggregate;
      delete state.latestPayload;
    }
    return clearHistory(this.#db);
  }

  close() {
    this.#closing = true;
    return this.#closeTask ||= this.#close();
  }

  async #close() {
    await Promise.allSettled([...this.#processing]);
    for (const [serverId, state] of this.#historyWrites) {
      const payload = state.latestPayload;
      if (payload && state.pendingAggregate) {
        await this.#writeHistory(serverId, payload, state.pendingAggregate);
        delete state.pendingAggregate;
      }
    }
    this.#latestReports.clear();
  }

  #track(task) {
    this.#processing.add(task);
    const finished = () => this.#processing.delete(task);
    task.then(finished, finished);
    return task;
  }

  async #receive(serverId, data, {
    transport = 'http', regionCode = '', agentVersion = '', reportIntervalMs
  }) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new InvalidAgentReport('Invalid report payload');
    }
    if (transport !== 'http' && transport !== 'ws') throw new TypeError('Unsupported report transport');
    const samples = normalizeMetricSamples(data);
    const now = Date.now();
    if (samples.some(sample => sample.ts > now + 60000 || sample.ts < now - 7 * 86400000)) {
      throw new InvalidAgentReport('Invalid sample timestamp');
    }
    if (!samples.length) throw new InvalidAgentReport('Missing metrics');
    const latestSample = samples.at(-1);
    const metrics = getReportMetrics(data, latestSample);
    const aggregate = collectHistoryMetricAggregates(samples);
    const payload = { metrics, regionCode, agentVersion, timestamp: latestSample.ts, reportIntervalMs };
    const key = String(serverId);
    const state = this.#historyWrites.get(key) || {};
    this.#historyWrites.set(key, state);
    const generation = this.#historyGeneration;

    if (transport === 'http') {
      // A failed HTTP write must not publish or record receipt of this report.
      await this.#writeHistory(serverId, payload, aggregate);
      if (this.#historyWrites.get(key) === state) {
        await this.#ingest(serverId, toBroadcastSamples(serverId, samples, regionCode, agentVersion, metrics));
      }
      return { persisted: true };
    }

    // WS receipt and viewer updates precede the throttled history attempt.
    await this.#ingest(serverId, toBroadcastSamples(serverId, samples, regionCode, agentVersion, metrics));
    return this.#persistIfDue(key, state, payload, aggregate, generation);
  }

  async #ingest(serverId, samples, reportTs = Date.now()) {
    this.#latestReports.set(serverId, samples, reportTs);
    await this.#publish([{ serverId, samples }], reportTs);
  }

  #writeHistory(serverId, payload, aggregate) {
    return saveMetricsHistory(
      this.#db, serverId, applyHistoryMetricAggregates(payload.metrics, aggregate),
      payload.regionCode, payload.timestamp, payload.agentVersion
    );
  }

  async #persistIfDue(serverId, state, payload, aggregate, generation) {
    // Deletion or history clearing may happen while realtime publication awaits.
    if (this.#historyWrites.get(serverId) !== state || generation !== this.#historyGeneration) {
      return { persisted: false, nextWriteAfterMs: 0 };
    }
    const now = Date.now();
    state.latestPayload = payload;
    state.pendingAggregate = mergeHistoryMetricAggregates(state.pendingAggregate, aggregate);
    if (state.flushing) return { persisted: false, nextWriteAfterMs: 0 };

    const intervalMs = Math.max(1000, Number(payload.reportIntervalMs) || AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS);
    const lastWriteAt = Number(state.lastWriteAt) || 0;
    if (lastWriteAt > 0 && now < lastWriteAt + intervalMs) {
      return { persisted: false, nextWriteAfterMs: lastWriteAt + intervalMs - now };
    }

    state.flushing = true;
    const aggregateForWrite = state.pendingAggregate;
    delete state.pendingAggregate;
    try {
      await this.#writeHistory(serverId, payload, aggregateForWrite);
      state.lastWriteAt = Date.now();
      return { persisted: true, nextWriteAfterMs: intervalMs };
    } catch (error) {
      // A failed in-flight write must not resurrect history discarded meanwhile.
      if (this.#historyWrites.get(serverId) === state && generation === this.#historyGeneration) {
        state.pendingAggregate = mergeHistoryMetricAggregates(aggregateForWrite, state.pendingAggregate);
      }
      throw error;
    } finally {
      state.flushing = false;
    }
  }
}
