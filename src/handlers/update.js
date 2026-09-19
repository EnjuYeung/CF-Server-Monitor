import { saveMetricsHistory } from '../database/schema.js';
import { getServerDetail, clearServerDetailCache } from '../utils/cache.js';
import { createErrorResponse, createUnauthorizedResponse, createNotFoundResponse, createBadRequestResponse } from '../utils/errors.js';
import { getWssReportScheduleState, loadSiteSettings } from '../utils/settings.js';
import { AGENT_CONFIG_MD5_HEADER, AGENT_CONFIG_SCHEMA_HEADER, describeAgentConfig, normalizeAgentConfigSchemaVersion, serializeCorrection } from '../utils/agentConfig.js';
import { scheduleAgentConfigChanged } from '../utils/agentConfigNotify.js';
import { normalizeAgentVersion, normalizeCorrectionValue, normalizeMetricSamples, getReportMetrics, getHistoryMetrics, toBroadcastSamples } from '../services/ingestion.js';
const logUpdateBadRequest = (reason, details) => console.warn('[Update]', reason, details);
const AGENT_WSS_MODE_HEADER = 'X-Agent-Wss-Mode';
const AGENT_WSS_REASON_HEADER = 'X-Agent-Wss-Reason';
function buildAgentWssStateHeaders(settings = {}, now = Date.now()) {
  const state = getWssReportScheduleState(settings, now);
  return {
    [AGENT_WSS_MODE_HEADER]: state.mode,
    [AGENT_WSS_REASON_HEADER]: state.reason
  };
}

export async function handleUpdate(request, env, ctx) {
  try {
    const data = await request.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) return createBadRequestResponse('Invalid report payload');
    const { id, secret } = data;

    if (secret !== env.API_SECRET) {
      return createUnauthorizedResponse('Invalid secret');
    }

    const regionCode = env.GEOLOCATION.lookup(request.clientIp, data.metrics?.ip_v4 || data.metrics?.ip_v6);
    const agentVersion = normalizeAgentVersion(request.headers.get('X-Agent-Version'));

    const serverDetail = await getServerDetail(env.DB, id, true);

    if (!serverDetail) {
      return createNotFoundResponse('Server not found');
    }

    if (
      Object.prototype.hasOwnProperty.call(data, 'rx_correction') ||
      Object.prototype.hasOwnProperty.call(data, 'tx_correction')
    ) {
      const ackRx = normalizeCorrectionValue(data.rx_correction);
      const ackTx = normalizeCorrectionValue(data.tx_correction);
      if (ackRx === null || ackTx === null) {
        return createBadRequestResponse('Invalid correction');
      }

      await env.DB.prepare(`
        UPDATE servers
        SET rx_correction = NULL, tx_correction = NULL
        WHERE id = ?
          AND (rx_correction IS NOT NULL OR tx_correction IS NOT NULL)
          AND ABS(COALESCE(rx_correction, 0) - ?) < 0.000001
          AND ABS(COALESCE(tx_correction, 0) - ?) < 0.000001
      `).bind(id, ackRx, ackTx).run();
      clearServerDetailCache();
      scheduleAgentConfigChanged(env, ctx, id);

      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    const samples = normalizeMetricSamples(data);
    if (samples.some(sample => sample.ts > Date.now() + 60000 || sample.ts < Date.now() - 7 * 86400000)) return createBadRequestResponse('Invalid sample timestamp');
    if (samples.length === 0) {
      logUpdateBadRequest('Missing metrics', {
        id,
        has_metrics: !!data.metrics,
        has_samples: Array.isArray(data.samples),
        has_batch: Array.isArray(data.batch)
      });
      return createBadRequestResponse('Missing metrics');
    }

    // 获取最后一条插入（如果是批量数据，取最后一个样本）
    const latestSample = samples[samples.length - 1];
    const latestMetrics = getReportMetrics(data, latestSample);
    const historyMetrics = getHistoryMetrics(data, samples, latestSample);
    await saveMetricsHistory(
      env.DB,
      id,
      historyMetrics,
      regionCode,
      latestSample.ts,
      agentVersion
    );

    const broadcastSamples = toBroadcastSamples(id, samples, regionCode, agentVersion, latestMetrics);
    await env.REALTIME_HUB.ingest(id, broadcastSamples);

    const clientConfigSchema = normalizeAgentConfigSchemaVersion(request.headers.get(AGENT_CONFIG_SCHEMA_HEADER));
    if (!clientConfigSchema) {
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }

    try {
      const settings = await loadSiteSettings(env.DB);
      const wssStateHeaders = buildAgentWssStateHeaders(settings);
      const descriptor = await describeAgentConfig(serverDetail, settings, clientConfigSchema);
      const clientConfigMd5 = (request.headers.get(AGENT_CONFIG_MD5_HEADER) || '').trim().toLowerCase();
      const hasCorrection = descriptor.correction !== null;
      const md5Changed = clientConfigMd5 !== descriptor.md5;
      const responseHeaders = {
        'Cache-Control': 'no-store',
        [AGENT_CONFIG_SCHEMA_HEADER]: String(clientConfigSchema),
        [AGENT_CONFIG_MD5_HEADER]: descriptor.md5,
        ...wssStateHeaders
      };

      if (!md5Changed && !hasCorrection) {
        return new Response(null, { status: 204, headers: responseHeaders });
      }

      let body = descriptor.serialized;
      if (hasCorrection) {
        body += serializeCorrection(descriptor.correction);
      }

      return new Response(body, {
        status: 200,
        headers: {
          ...responseHeaders,
          'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
        }
      });
    } catch (configError) {
      console.warn('[Update] Failed to build agent configuration:', configError?.message || configError);
      return new Response('OK', {
        status: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  } catch (e) {
    if (e instanceof SyntaxError) return createBadRequestResponse('Invalid JSON');
    return createErrorResponse(e);
  }
}
