import { isValidRealtimeId } from '../utils/realtimeId.js';
import { ResourceAlertWindows } from './ResourceAlertWindows.js';
import { maskPublicIpUpdate } from '../utils/publicMetrics.js';
import { LatestReports } from './LatestReports.js';
import { saveMetricsHistory } from '../database/schema.js';
import { getServerDetail, clearServerDetailCache } from '../utils/cache.js';
import { getWssReportScheduleState, loadSiteSettings } from '../utils/settings.js';
import {
  AGENT_CONFIG_LEGACY_SCHEMA_VERSION,
  AGENT_CONFIG_SCHEMA_VERSION,
  DEFAULT_WSS_REPORT_INTERVAL,
  describeAgentConfig,
  normalizeWssReportInterval,
  normalizeAgentConfigSchemaVersion,
  serializeCorrection
} from '../utils/agentConfig.js';
import {
  applyHistoryMetricAggregates,
  collectHistoryMetricAggregates,
  getReportMetrics,
  mergeHistoryMetricAggregates,
  normalizeAgentVersion,
  normalizeCorrectionValue,
  normalizeMetricSamples,
  toBroadcastSamples
} from '../services/ingestion.js';
import {
  AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS,
  AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS,
  AGENT_SERVER_DETAIL_TTL_MS,
} from '../utils/config.js';

const MAX_SUBSCRIBE_IDS = 500;
const WS_POLICY_VIOLATION = 1008;
const WS_TRY_AGAIN_LATER = 1013;
const AGENT_REPORT_KIND = 'agent-report';
const AGENT_WSS_SCHEDULE_INACTIVE = 'wss_schedule_inactive';
const AGENT_WSS_SCHEDULE_DISABLED = 'wss_disabled';
const ALLOWED_AGENT_REPORT_INTERVALS = new Set([30, 60, 120, 180]);
function normalizeConfigSchema(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const number = Number(raw);
  return Number.isInteger(number) && number > 0 ? String(number) : raw;
}

function normalizeConfigMd5(value) {
  const raw = String(value ?? '').trim().toLowerCase();
  return raw || 'none';
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return undefined;
}

export class RealtimeHub {
  constructor(env) {
    this.frontendSockets = new Set();
    this.processing = new Set();
    this.env = env;
    // 仅用于新页面快速接上最近一包数据；hub 重启或休眠回收后允许自然丢失。
    this.latestReports = new LatestReports(env.DB);
    this.resourceAlerts = new ResourceAlertWindows(env);
    this.agentServerDetails = new Map();
    this.agentHistoryWrites = new Map();
    this.standardAgentWebSocketCount = 0;
    this.standardAgentWebSockets = new Set();
    this.lastAgentRealtimeHintAt = 0;

  }

  _isValidScope(scope) {
    return scope === 'all' || isValidRealtimeId(scope);
  }

  _normalizeServerIds(ids) {
    if (ids === undefined) return { ok: true, ids: [] };
    if (!Array.isArray(ids) || ids.length > MAX_SUBSCRIBE_IDS) {
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

  _closeInvalidSubscription(ws) {
    try {
      ws.close(WS_POLICY_VIOLATION, 'invalid subscription');
    } catch (_) {}
  }

  _getSubscribeScope(msg, current) {
    if (!Object.prototype.hasOwnProperty.call(msg, 'scope') || msg.scope === undefined) {
      return current.scope || 'all';
    }
    return typeof msg.scope === 'string' ? msg.scope : null;
  }

  // 根据 scope 和 serverIds 判断是否需要接收某台服务器的更新
  _canView(context, serverId) {
    if (context.expiresAt && Date.now() >= context.expiresAt) return false;
    const server = this.env.DB.prepare('SELECT is_hidden FROM servers WHERE id = ?').bind(serverId).first();
    return !!server && (context.isAdmin || String(server.is_hidden) !== '1');
  }

  _shouldDeliver(sessionScope, serverId, serverIds) {
    if (!sessionScope) return false;
    if (sessionScope === 'all') {
      if (!serverIds || serverIds.length === 0) return false;
      return serverIds.includes(serverId);
    }
    return sessionScope === serverId;
  }

  _getFrontendWebSockets() { return Array.from(this.frontendSockets); }
  _getFrontendSubscriberCount() { return this.frontendSockets.size; }
  _getAgentReportWebSockets() { return Array.from(this.standardAgentWebSockets); }

  _sendWsJson(ws, payload) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {}
  }

  acceptSocket(socket, context) {
    const ws = {
      context,
      send(data) {
        if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, 'slow consumer'); return; }
        if (socket.readyState === 1) socket.send(data);
      },
      close: (code, reason) => socket.close(code, reason),
      setContext(value) { this.context = value; },
      getContext() { return this.context; }
    };
    const agent = context.kind === AGENT_REPORT_KIND;
    const sockets = agent ? this.standardAgentWebSockets : this.frontendSockets;
    sockets.add(ws);
    this.standardAgentWebSocketCount = this.standardAgentWebSockets.size;
    let chain = Promise.resolve(); let pending = 0;
    socket.on('message', data => {
      if (++pending > 64) { socket.close(1013, 'too many pending messages'); return; }
      chain = chain.then(() => this.webSocketMessage(ws, data.toString()))
        .catch(error => {
          console.error('[ws] report failed:', error.message);
          this._closeWsWithError(ws, 'Internal error', 500, {}, 1011);
        }).finally(() => { pending--; });
      const task = chain;
      this.processing.add(task); task.finally(() => this.processing.delete(task));
    });
    const cleanup = () => { sockets.delete(ws); this.standardAgentWebSocketCount = this.standardAgentWebSockets.size; };
    socket.on('close', cleanup); socket.on('error', cleanup);
    this._sendWsJson(ws, { type: 'hello', ts: Date.now(), ...(agent ? { protocol: 'update' } : { subscribed: context.scope }) });
    return ws;
  }

  revokeFrontendSessions() {
    for (const ws of this.frontendSockets) ws.close(1008, 'configuration changed');
  }

  removeServer(id) {
    for (const ws of this.standardAgentWebSockets) if (ws.getContext().serverId === id) ws.close(1008, 'server removed');
    this.agentServerDetails.delete(id); this.agentHistoryWrites.delete(id);
    this.latestReports.delete(id); this.resourceAlerts.delete(id);
    this.revokeFrontendSessions();
  }

  async ingest(serverId, samples) {
    await this._ingestRealtimeUpdates([{ serverId, samples }]);
  }

  discardPendingHistory() {
    for (const state of this.agentHistoryWrites.values()) {
      delete state.pendingHistoryAggregate;
      delete state.latestPayload;
    }
  }

  async close() {
    for (const ws of [...this.frontendSockets, ...this.standardAgentWebSockets]) ws.close(1001, 'server restarting');
    await Promise.allSettled([...this.processing]);
    for (const [id, state] of this.agentHistoryWrites) {
      const payload = state.latestPayload;
      if (payload && state.pendingHistoryAggregate) {
        await saveMetricsHistory(this.env.DB, id, applyHistoryMetricAggregates(payload.metrics, state.pendingHistoryAggregate), payload.regionCode, payload.timestamp, payload.agentVersion);
        delete state.pendingHistoryAggregate;
      }
    }
    this.resourceAlerts.load();
    this.resourceAlerts.persist(Date.now(), true);
    this.latestReports.clear();
  }

  _closeWsWithError(ws, message, code = 400, extra = {}, closeCode = WS_POLICY_VIOLATION, closeReason = message) {
    this._sendWsJson(ws, {
      type: 'error',
      ts: Date.now(),
      error: message,
      code,
      ...extra
    });
    try {
      ws.close(closeCode, closeReason);
    } catch (_) {}
  }

  _closeWsForInactiveAgentSchedule(ws) {
    this._closeWsWithError(
      ws,
      'Agent WSS report outside active hours',
      409,
      {
        text: AGENT_WSS_SCHEDULE_INACTIVE,
        connection_mode: 'http'
      },
      WS_TRY_AGAIN_LATER,
      AGENT_WSS_SCHEDULE_INACTIVE
    );
  }

  _closeWsForDisabledAgentSchedule(ws) {
    this._closeWsWithError(
      ws,
      'Agent WSS report disabled',
      409,
      {
        text: AGENT_WSS_SCHEDULE_DISABLED,
        connection_mode: 'http'
      },
      WS_TRY_AGAIN_LATER,
      AGENT_WSS_SCHEDULE_DISABLED
    );
  }

  _decodeWsMessage(message) {
    if (typeof message === 'string') return message;
    if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
    if (ArrayBuffer.isView(message)) {
      return new TextDecoder().decode(message.buffer.slice(message.byteOffset, message.byteOffset + message.byteLength));
    }
    return String(message || '');
  }

  _normalizeAgentReportData(message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
    if (message.type === 'update' && message.payload && typeof message.payload === 'object' && !Array.isArray(message.payload)) {
      const payload = { ...message.payload };
      const inheritedFields = [
        'config_md5',
        'configMd5',
        'agent_config_md5',
        'agentConfigMd5',
        'config_schema',
        'configSchema',
        'agent_config_schema',
        'agentConfigSchema',
        'schema_version'
      ];
      for (const field of inheritedFields) {
        if (payload[field] === undefined && message[field] !== undefined) {
          payload[field] = message[field];
        }
      }
      return {
        ...payload,
        id: message.id ?? payload.id,
        secret: message.secret ?? payload.secret
      };
    }
    return message;
  }

  _getAgentConfigState(data = {}, attachment = {}) {
    const reportedSchema = firstDefined(
      data.config_schema,
      data.configSchema,
      data.agent_config_schema,
      data.agentConfigSchema,
      data.schema_version
    );
    const reportedMd5 = firstDefined(
      data.config_md5,
      data.configMd5,
      data.agent_config_md5,
      data.agentConfigMd5
    );
    const requested = reportedSchema !== undefined || reportedMd5 !== undefined;
    const schema = normalizeConfigSchema(firstDefined(reportedSchema, attachment.configSchema));
    const md5 = normalizeConfigMd5(firstDefined(reportedMd5, attachment.configMd5));
    return { schema, md5, requested };
  }

  _isCorrectionAck(data) {
    return data && (
      Object.prototype.hasOwnProperty.call(data, 'rx_correction') ||
      Object.prototype.hasOwnProperty.call(data, 'tx_correction')
    );
  }

  _normalizeAgentReportIntervalMs(value) {
    const reportInterval = Number(value);
    if (Number.isInteger(reportInterval) && ALLOWED_AGENT_REPORT_INTERVALS.has(reportInterval)) {
      return reportInterval * 1000;
    }
    return null;
  }

  _getReportIntervalMs(serverDetail) {
    const reportIntervalMs = this._normalizeAgentReportIntervalMs(serverDetail?.report_interval);
    if (reportIntervalMs) {
      return reportIntervalMs;
    }
    return AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS;
  }

  _getWssReportIntervalMs(serverDetail) {
    return normalizeWssReportInterval(serverDetail?.wss_report_interval) * 1000;
  }

  async _getAgentServerDetail(serverId, forceRefresh = false) {
    const key = String(serverId || '');
    const now = Date.now();
    const cached = this.agentServerDetails.get(key);
    if (!forceRefresh && cached && now - cached.time < AGENT_SERVER_DETAIL_TTL_MS) {
      return cached.data;
    }

    if (forceRefresh) {
      clearServerDetailCache();
    }
    const server = await getServerDetail(this.env.DB, key, true);
    this.agentServerDetails.set(key, { data: server, time: now });
    return server;
  }

  async _resolveAgentContext(ws, attachment, data) {
    const rawServerId = data.id ?? attachment.serverId;
    const serverId = typeof rawServerId === 'string' ? rawServerId.trim() : String(rawServerId || '').trim();
    if (!isValidRealtimeId(serverId)) {
      this._closeWsWithError(ws, 'Invalid server ID', 400);
      return null;
    }

    if (attachment.authenticated && attachment.serverId && attachment.serverId !== serverId) {
      this._closeWsWithError(ws, 'Server ID changed', 403);
      return null;
    }

    const hasSecret = Object.prototype.hasOwnProperty.call(data, 'secret');
    if (!attachment.authenticated || hasSecret) {
      if (data.secret !== this.env.API_SECRET) {
        this._closeWsWithError(ws, 'Invalid secret', 401);
        return null;
      }
    }

    const serverDetail = await this._getAgentServerDetail(serverId);
    if (!serverDetail) { this._closeWsWithError(ws, 'Server not found', 404); return null; }

    const agentVersion = normalizeAgentVersion(
      data.agent_version ??
      data.metrics?.agent_version ??
      attachment.agentVersion
    );
    const agentConfig = this._getAgentConfigState(data, attachment);
    const reportedReportIntervalMs = this._normalizeAgentReportIntervalMs(firstDefined(
      data.report_interval,
      data.reportInterval
    ));
    const attachedReportIntervalMs = Number(attachment.reportIntervalMs);
    const reportIntervalMs = reportedReportIntervalMs ||
      (attachment.authenticated && Number.isFinite(attachedReportIntervalMs) && attachedReportIntervalMs > 0
        ? attachedReportIntervalMs
        : this._getReportIntervalMs(serverDetail));
    const reportedWssReportInterval = firstDefined(
      data.wss_report_interval,
      data.wssReportInterval
    );
    const reportedWssReportIntervalMs = reportedWssReportInterval === undefined
      ? null
      : normalizeWssReportInterval(reportedWssReportInterval) * 1000;
    const attachedWssReportIntervalMs = Number(attachment.wssReportIntervalMs);
    const wssReportIntervalMs = reportedWssReportIntervalMs ||
      (attachment.authenticated && Number.isFinite(attachedWssReportIntervalMs) && attachedWssReportIntervalMs > 0
        ? attachedWssReportIntervalMs
        : this._getWssReportIntervalMs(serverDetail));
    const nextAttachment = {
      ...attachment,
      kind: AGENT_REPORT_KIND,
      authenticated: true,
      serverId,

      agentVersion,
      reportIntervalMs,
      wssReportIntervalMs,
      configSchema: agentConfig.schema,
      configMd5: agentConfig.md5
    };
    ws.setContext(nextAttachment);

    return {
      attachment: nextAttachment,
      serverId,

      regionCode: this.env.GEOLOCATION.lookup(attachment.clientIp, data.metrics?.ip_v4 || data.metrics?.ip_v6),
      agentVersion,
      reportIntervalMs,
      wssReportIntervalMs,
      agentConfig
    };
  }

  async _loadAgentConfigDescriptor(serverId, forceRefresh = false, schemaVersion = AGENT_CONFIG_SCHEMA_VERSION) {
    const [serverDetail, settings] = await Promise.all([
      this._getAgentServerDetail(serverId, forceRefresh),
      loadSiteSettings(this.env.DB, { forceRefresh })
    ]);
    if (!serverDetail) return null;
    return describeAgentConfig(serverDetail, settings, schemaVersion);
  }

  _buildAgentConfigFrame(descriptor) {
    const configBody = descriptor.serialized + serializeCorrection(descriptor.correction);
    const hasCorrection = descriptor.correction !== null;
    const configPayload = {
      ...descriptor.config,
      config_md5: descriptor.md5
    };

    if (hasCorrection) {
      configPayload.rx_correction = descriptor.correction.rx_correction;
      configPayload.tx_correction = descriptor.correction.tx_correction;
    }

    return { configBody, configPayload, hasCorrection };
  }

  async _buildAgentConfigAck(context) {
    const schemaVersion = normalizeAgentConfigSchemaVersion(context?.agentConfig?.schema);
    if (!context || !context.agentConfig?.requested || !schemaVersion) {
      return null;
    }

    const clientMd5 = normalizeConfigMd5(context.agentConfig.md5);
    try {
      const descriptor = await this._loadAgentConfigDescriptor(context.serverId, false, schemaVersion);
      if (!descriptor) return null;

      const { configBody, configPayload, hasCorrection } = this._buildAgentConfigFrame(descriptor);
      const md5Changed = clientMd5 !== descriptor.md5;
      const ack = {
        config_schema: schemaVersion,
        config_md5: descriptor.md5,
        has_config: md5Changed || hasCorrection
      };

      if (ack.has_config) {
        // `body` keeps compatibility with currently deployed Go agents; `config_body`
        // is the documented field, and `payload` carries the structured form.
        ack.body = configBody;
        ack.config_body = configBody;
        ack.payload = configPayload;
      }

      return ack;
    } catch (e) {
      console.warn('[update-ws] Failed to build agent configuration:', e?.message || e);
      return null;
    }
  }

  _pushAgentConfigFrame(serverId, descriptors) {
    let delivered = 0;
    let matched = 0;

    const descriptorForSchema = (schema) => {
      const schemaVersion = normalizeAgentConfigSchemaVersion(schema);
      if (!schemaVersion) return null;
      if (descriptors instanceof Map) {
        return descriptors.get(schemaVersion) || null;
      }
      return schemaVersion === AGENT_CONFIG_SCHEMA_VERSION ? descriptors : null;
    };

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.getContext() || {};
      if (
        attachment.kind !== AGENT_REPORT_KIND ||
        !attachment.authenticated ||
        attachment.serverId !== serverId
      ) {
        continue;
      }
      matched += 1;

      const descriptor = descriptorForSchema(attachment.configSchema);
      if (!descriptor) continue;

      const { configBody, configPayload, hasCorrection } = this._buildAgentConfigFrame(descriptor);
      const clientMd5 = normalizeConfigMd5(attachment.configMd5);
      if (clientMd5 === descriptor.md5 && !hasCorrection) {
        continue;
      }

      const nextAttachment = { ...attachment };
      if (Object.prototype.hasOwnProperty.call(descriptor.config, 'wss_report_interval')) {
        nextAttachment.wssReportIntervalMs = descriptor.config.wss_report_interval * 1000;
      } else {
        delete nextAttachment.wssReportIntervalMs;
      }
      if (typeof ws.serializeAttachment === 'function') {
        ws.setContext(nextAttachment);
      }

      this._sendWsJson(ws, {
        type: 'config',
        ts: Date.now(),
        config_schema: descriptor.config.schema_version,
        config_md5: descriptor.md5,
        body: configBody,
        config_body: configBody,
        payload: configPayload
      });
      delivered += 1;
    }

    return { matched, delivered };
  }

  _closeAgentReportWebSockets() {
    let matched = 0;
    let closed = 0;

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.getContext() || {};
      if (attachment.kind !== AGENT_REPORT_KIND) continue;
      matched += 1;

      try {
        this._closeWsForDisabledAgentSchedule(ws);
        closed += 1;
      } catch (_) {}
    }

    return { matched, closed };
  }

  _closeInactiveAgentReportWebSockets() {
    let matched = 0;
    let closed = 0;

    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.getContext() || {};
      if (attachment.kind !== AGENT_REPORT_KIND) continue;
      matched += 1;

      try {
        this._closeWsForInactiveAgentSchedule(ws);
        closed += 1;
      } catch (_) {}
    }

    return { matched, closed };
  }

  async enforceSchedule() {
    const settings = await loadSiteSettings(this.env.DB, { forceRefresh: true });
    const scheduleState = getWssReportScheduleState(settings);
    if (!scheduleState.configured) {
      this._closeAgentReportWebSockets();
      return;
    }
    if (!scheduleState.active) {
      this._closeInactiveAgentReportWebSockets();
      return;
    }
  }

  async agentReportModeChanged() {
    const settings = await loadSiteSettings(this.env.DB, { forceRefresh: true });
    const state = getWssReportScheduleState(settings);
    const result = state.active ? { matched: 0, closed: 0 } : (state.configured ? this._closeInactiveAgentReportWebSockets() : this._closeAgentReportWebSockets());
    return { ok: true, wssReportEnabled: state.active, ...result };
  }

  async agentConfigChanged(serverId) {
    if (!isValidRealtimeId(serverId)) throw new Error('invalid serverId');
    clearServerDetailCache();
    this.agentServerDetails.delete(serverId);
    const descriptor = await this._loadAgentConfigDescriptor(serverId, true, AGENT_CONFIG_SCHEMA_VERSION);
    if (!descriptor) return null;
    const descriptors = new Map([[AGENT_CONFIG_SCHEMA_VERSION, descriptor]]);
    for (let version = AGENT_CONFIG_LEGACY_SCHEMA_VERSION; version < AGENT_CONFIG_SCHEMA_VERSION; version++) {
      const legacy = await this._loadAgentConfigDescriptor(serverId, false, version);
      if (legacy) descriptors.set(version, legacy);
    }
    return { ok: true, ...this._pushAgentConfigFrame(serverId, descriptors) };
  }

  async _ackTrafficCorrection(serverId, data) {
    const ackRx = normalizeCorrectionValue(data.rx_correction);
    const ackTx = normalizeCorrectionValue(data.tx_correction);
    if (ackRx === null || ackTx === null) {
      return { ok: false, error: 'Invalid correction' };
    }

    await this.env.DB.prepare(`
      UPDATE servers
      SET rx_correction = NULL, tx_correction = NULL
      WHERE id = ?
        AND (rx_correction IS NOT NULL OR tx_correction IS NOT NULL)
        AND ABS(COALESCE(rx_correction, 0) - ?) < 0.000001
        AND ABS(COALESCE(tx_correction, 0) - ?) < 0.000001
    `).bind(serverId, ackRx, ackTx).run();
    clearServerDetailCache();
    this.agentServerDetails.delete(serverId);
    return { ok: true };
  }

  async _ingestRealtimeUpdates(updates, reportTs = Date.now()) {
    if (!Array.isArray(updates) || !updates.length) return;
    for (const update of updates) this.latestReports.set(update.serverId, update.samples, reportTs);
    await this.resourceAlerts.ingest(updates, reportTs);
    this._broadcastBatch(updates, reportTs);
  }

  _getAgentRealtimeState() { return { frontendActive: this._getFrontendSubscriberCount() > 0 }; }

  _getAgentNextWssReportAfterMs(wssReportIntervalMs, reportIntervalMs, realtimeState) {
    const normalizedWssReportIntervalMs = Math.max(
      1000,
      Number(wssReportIntervalMs) || DEFAULT_WSS_REPORT_INTERVAL * 1000
    );
    const state = typeof realtimeState === 'object' ? realtimeState : { frontendActive: realtimeState === true };
    const normalizedReportIntervalMs = Math.max(
      AGENT_MIN_IDLE_WSS_REPORT_INTERVAL_MS,
      Number(reportIntervalMs) || AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS
    );
    return state.frontendActive
      ? normalizedWssReportIntervalMs
      : normalizedReportIntervalMs;
  }

  async _getAgentHintReportIntervalMs(attachment) {
    const attachedReportIntervalMs = Number(
      attachment?.wssReportIntervalMs ?? attachment?.reportIntervalMs
    );
    if (attachment?.serverId) {
      try {
        const serverDetail = await this._getAgentServerDetail(attachment.serverId);
        if (serverDetail) {
          const configuredReportIntervalMs = this._getWssReportIntervalMs(serverDetail);
          if (configuredReportIntervalMs) return configuredReportIntervalMs;
        }
      } catch (e) {
        console.warn('[update-ws] Failed to load agent interval for realtime hint:', e?.message || e);
      }
    }
    if (Number.isFinite(attachedReportIntervalMs) && attachedReportIntervalMs > 0) {
      return attachedReportIntervalMs;
    }
    return DEFAULT_WSS_REPORT_INTERVAL * 1000;
  }

  async _hintAgentRealtimeIntervals(realtimeState = null) {
    const now = Date.now();
    const state = realtimeState || this._getAgentRealtimeState(now);
    if (!state.frontendActive) return 0;
    if (now - this.lastAgentRealtimeHintAt < 1000) return 0;
    this.lastAgentRealtimeHintAt = now;

    let hinted = 0;
    for (const ws of this._getAgentReportWebSockets()) {
      const attachment = ws.getContext() || {};
      if (
        attachment.kind !== AGENT_REPORT_KIND ||
        !attachment.authenticated ||
        !attachment.serverId
      ) {
        continue;
      }

      const wssReportIntervalMs = await this._getAgentHintReportIntervalMs(attachment);
      const nextWssReportAfterMs = this._getAgentNextWssReportAfterMs(
        wssReportIntervalMs,
        attachment.reportIntervalMs,
        state
      );
      this._sendWsJson(ws, {
        type: 'ack',
        ts: Date.now(),
        realtimeHint: true,
        nextWssReportAfterMs
      });
      hinted += 1;
    }

    return hinted;
  }

  async _persistAgentHistoryIfDue(ws, attachment, payload) {
    const serverId = String(payload.serverId || '');
    const now = Date.now();
    const state = this.agentHistoryWrites.get(serverId) || {};
    state.latestPayload = payload;
    const currentAggregate = payload.historyAggregate ||
      collectHistoryMetricAggregates([{ metrics: payload.metrics }]);

    if (state.flushing) {
      state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
        state.pendingHistoryAggregate,
        currentAggregate
      );
      this.agentHistoryWrites.set(serverId, state);
      return { persisted: false, nextD1WriteAfterMs: 0 };
    }

    state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
      state.pendingHistoryAggregate,
      currentAggregate
    );
    const intervalMs = Math.max(
      1000,
      Number(payload.reportIntervalMs) ||
      Number(attachment.reportIntervalMs) ||
      AGENT_DEFAULT_HISTORY_WRITE_INTERVAL_MS
    );
    const lastWriteTs = Math.max(
      Number(state.lastD1WriteTs) || 0,
      Number(attachment.lastD1WriteTs) || 0
    );
    const nextWriteTs = lastWriteTs + intervalMs;

    if (lastWriteTs > 0 && now < nextWriteTs) {
      state.lastD1WriteTs = lastWriteTs;
      this.agentHistoryWrites.set(serverId, state);
      return { persisted: false, nextD1WriteAfterMs: nextWriteTs - now };
    }

    state.flushing = true;
    const aggregateForWrite = state.pendingHistoryAggregate;
    delete state.pendingHistoryAggregate;
    this.agentHistoryWrites.set(serverId, state);
    try {
      const metrics = applyHistoryMetricAggregates(payload.metrics, aggregateForWrite);
      await saveMetricsHistory(
        this.env.DB,
        serverId,
        metrics,
        payload.regionCode,
        payload.timestamp,
        payload.agentVersion
      );
      const persistedAt = Date.now();
      state.lastD1WriteTs = persistedAt;
      const currentAttachment = ws.getContext() || attachment;
      ws.setContext({
        ...currentAttachment,
        lastD1WriteTs: persistedAt
      });
      return {
        persisted: true,
        nextD1WriteAfterMs: intervalMs
      };
    } catch (e) {
      state.pendingHistoryAggregate = mergeHistoryMetricAggregates(
        aggregateForWrite,
        state.pendingHistoryAggregate
      );
      throw e;
    } finally {
      state.flushing = false;
      this.agentHistoryWrites.set(serverId, state);
    }
  }

  async _handleAgentReportMessage(ws, rawMessage, attachment = {}) {
    let msg = null;
    try {
      msg = JSON.parse(this._decodeWsMessage(rawMessage) || '{}');
    } catch (_) {
      this._closeWsWithError(ws, 'Invalid JSON', 400);
      return;
    }

    if (msg?.type === 'pong') return;
    if (msg?.type === 'ping') { this._sendWsJson(ws, { type: 'pong' }); return; }

    const scheduleCheckAfter = Number(attachment.wssScheduleCheckAfter);
    if (Number.isFinite(scheduleCheckAfter) && Date.now() >= scheduleCheckAfter) {
      const settings = await loadSiteSettings(this.env.DB);
      const scheduleState = getWssReportScheduleState(settings);
      if (!scheduleState.configured) {
        this._closeWsForDisabledAgentSchedule(ws);
        return;
      }
      if (!scheduleState.active) {
        this._closeWsForInactiveAgentSchedule(ws);
        return;
      }
      const nextHour = new Date();
      nextHour.setUTCMinutes(60, 0, 0);
      attachment = { ...attachment, wssScheduleCheckAfter: nextHour.getTime() };
      ws.setContext(attachment);
    }

    const data = this._normalizeAgentReportData(msg);
    if (!data) {
      this._closeWsWithError(ws, 'Invalid report payload', 400);
      return;
    }

    const context = await this._resolveAgentContext(ws, attachment, data);
    if (!context) return;

    if (this._isCorrectionAck(data)) {
      const result = await this._ackTrafficCorrection(context.serverId, data);
      if (!result.ok) {
        this._closeWsWithError(ws, result.error, 400);
        return;
      }
      this._sendWsJson(ws, {
        type: 'ack',
        ts: Date.now(),
        correction: true
      });
      return;
    }

    const samples = normalizeMetricSamples(data);
    if (samples.some(sample => sample.ts > Date.now() + 60000 || sample.ts < Date.now() - 7 * 86400000)) { this._closeWsWithError(ws, 'Invalid sample timestamp', 400); return; }
    if (samples.length === 0) {
      this._closeWsWithError(ws, 'Missing metrics', 400);
      return;
    }

    const latestSample = samples[samples.length - 1];
    const latestMetrics = getReportMetrics(data, latestSample);
    const historyAggregate = collectHistoryMetricAggregates(samples);
    const broadcastSamples = toBroadcastSamples(
      context.serverId,
      samples,
      context.regionCode,
      context.agentVersion,
      latestMetrics
    );
    const reportTs = Date.now();
    const normalizedUpdates = [{
      serverId: context.serverId,
      samples: broadcastSamples
    }];
    const realtimeState = this._getAgentRealtimeState(reportTs);
    await this._ingestRealtimeUpdates(normalizedUpdates, reportTs);

    const persisted = await this._persistAgentHistoryIfDue(ws, context.attachment, {
      serverId: context.serverId,

      metrics: latestMetrics,
      historyAggregate,
      regionCode: context.regionCode,
      timestamp: latestSample.ts,
      agentVersion: context.agentVersion,
      reportIntervalMs: context.reportIntervalMs
    });

    const configAck = await this._buildAgentConfigAck(context);
    const nextWssReportAfterMs = this._getAgentNextWssReportAfterMs(
      context.wssReportIntervalMs,
      context.reportIntervalMs,
      realtimeState
    );
    this._sendWsJson(ws, {
      type: 'ack',
      ts: Date.now(),
      persisted: persisted.persisted,
      nextD1WriteAfterMs: persisted.nextD1WriteAfterMs,
      nextWssReportAfterMs,
      ...(configAck || {})
    });
  }

  _broadcastBatch(updates, ts = Date.now()) {
    const websockets = this._getFrontendWebSockets();

    for (const ws of websockets) {
      const attachment = ws.getContext();
      if (!attachment) continue;

      const scopedUpdates = updates
        .filter(item => this._canView(attachment, item.serverId) && this._shouldDeliver(attachment.scope, item.serverId, attachment.serverIds))
        .map(maskPublicIpUpdate);
      if (scopedUpdates.length === 0) continue;

      const message = JSON.stringify({
        type: 'batchUpdate',
        ts,
        updates: scopedUpdates
      });

      try {
        ws.send(message);
      } catch (_) {
        // WebSocket 已异常关闭，hub 会自动清理
      }
    }
  }

  async webSocketMessage(ws, message) {
    const attachment = ws.getContext() || {};
    if (attachment.kind === AGENT_REPORT_KIND) {
      await this._handleAgentReportMessage(ws, message, attachment);
      return;
    }
    // 保留处理扩展消息的入口
    try {
      const msg = JSON.parse(message || '{}');
      if (msg && msg.type === 'subscribe') {
        const current = ws.getContext() || {};
        const rawScope = this._getSubscribeScope(msg, current);
        if (rawScope === null) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const scope = rawScope.trim().toLowerCase();
        if (!this._isValidScope(scope)) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const normalizedServerIds = this._normalizeServerIds(msg.ids);
        if (!normalizedServerIds.ok) {
          this._closeInvalidSubscription(ws);
          return;
        }

        const serverIds = normalizedServerIds.ids;
        ws.setContext({ ...current, scope, serverIds });
        try {
          ws.send(JSON.stringify({
            type: 'subscribed',
            ts: Date.now(),
            subscribed: scope,
            count: serverIds.length
          }));
        } catch (_) {}
        try {
          await this._hintAgentRealtimeIntervals({
            frontendActive: true,
          });
        } catch (e) {
          console.warn('[ws] Failed to hint agent realtime interval:', e?.message || e);
        }
        return;
      }
      if (msg && msg.type === 'ping') { this._sendWsJson(ws, { type: 'pong' }); return; }
      if (msg && msg.type === 'pong') return;
    } catch (_) {}
  }

}

export default RealtimeHub;
