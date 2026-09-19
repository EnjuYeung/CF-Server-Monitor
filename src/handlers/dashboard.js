import { maskPublicIpFields, toPublicIpReachability } from '../utils/publicMetrics.js';
import { checkAuth, simpleAuthResponse } from '../middleware/auth.js';
import { getServerLastSeen, isServerOffline } from '../services/serverPresence.js';
import { getDashboardLatencyHistory, getLatestMetrics, getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers, getServerDetail } from '../utils/cache.js';
import { mergeMetricsIntoServer, coerceNumericMetricFields } from '../utils/metrics.js';
import { normalizeLongHistoryPoints } from '../utils/settings.js';
import { createSuccessResponse, createBadRequestResponse, createNotFoundResponse } from '../utils/errors.js';
import {
  DASHBOARD_LATENCY_WINDOW_HOURS,
  DASHBOARD_LATENCY_WINDOW_POINTS,
} from '../utils/config.js';

const PROBE_FIELDS = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4'];

// REST 接口中，丢包值为 null 表示该探针没有可用样本；此时隐藏对应的延迟和丢包字段。
export function omitNullLossProbeFields(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const result = { ...item };
  for (const field of PROBE_FIELDS) {
    if (result[`loss_${field}`] === null) {
      delete result[`loss_${field}`];
      delete result[`ping_${field}`];
    }
  }
  return result;
}

function createEmptyLatencyWindow() {
  return { ping: [], loss: [] };
}

function normalizePublicIpFields(item, ensureFields = true) {
  Object.assign(item, maskPublicIpFields(item));
  if (ensureFields) {
    item.ip_v4 = toPublicIpReachability(item.ip_v4);
    item.ip_v6 = toPublicIpReachability(item.ip_v6);
  }
  return item;
}

function withoutPrivateServerFields(server) {
  const item = { ...server };
  delete item.bandwidth;
  delete item.note;
  delete item.auto_update;
  delete item.traffic_snapshots;
  return normalizePublicIpFields(item);
}

function normalizeLatestReportSample(sample) {
  if (!sample || typeof sample !== 'object') return null;
  const data = sample?.data || sample?.payload || sample?.metrics;
  if (!data || typeof data !== 'object') return null;

  const publicData = coerceNumericMetricFields(normalizePublicIpFields({ ...data }, false));
  const ts = sample.ts ?? sample.timestamp;
  return ts === undefined ? { data: publicData } : { ts, data: publicData };
}

function normalizeLatestReportUpdate(update) {
  if (!update || !Array.isArray(update.samples)) return null;

  const samples = update.samples
    .map(normalizeLatestReportSample)
    .filter(Boolean);
  if (samples.length === 0) return null;

  return {
    ...update,
    samples
  };
}

function attachLatencyHistoryToServers(servers, latencyHistory) {
  for (const server of servers || []) {
    const window = latencyHistory?.get(String(server.id)) || createEmptyLatencyWindow();
    server.ping = window.ping;
    server.loss = window.loss;
  }
}

function getRealtimeStateForServers(env, serverIds) {
  return { latestReportUpdates: (env.REALTIME_HUB?.latestReports.getMany(serverIds) || []).map(normalizeLatestReportUpdate).filter(Boolean) };
}

export async function handleServerAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  
  if (!id) return createBadRequestResponse('Missing ID');
  
  const server = await getServerDetail(env.DB, id, isLoggedIn);
  if (!server) return createNotFoundResponse('Server not found');
  
  const [latestMetrics, realtimeState] = await Promise.all([
    getLatestMetrics(env.DB, id, server),
    getRealtimeStateForServers(env, [id])
  ]);
  mergeMetricsIntoServer(server, latestMetrics, getServerLastSeen(env, id, latestMetrics));
  server.latestReportUpdates = realtimeState.latestReportUpdates;
  server.sysConfig = {
    long_history_points: Number(normalizeLongHistoryPoints(sys.long_history_points))
  };
  
  return createSuccessResponse(omitNullLossProbeFields(withoutPrivateServerFields(server)));
}

export async function handleServersAPI(request, env, sys) {
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  const results = (await getAllServers(env.DB, isLoggedIn)).map(withoutPrivateServerFields);
  const shouldIncludeLatencyHistory = sys.show_three_net_details === 'true';
  
  const serverIds = results.map(server => server.id).filter(Boolean);
  const [latestMetricsMap, realtimeState, latencyHistory] = await Promise.all([
    getLatestMetricsForAllServers(env.DB),
    getRealtimeStateForServers(env, serverIds),
    shouldIncludeLatencyHistory
      ? getDashboardLatencyHistory(env.DB, results)
      : Promise.resolve(new Map())
  ]);
  attachLatencyHistoryToServers(results, latencyHistory);
  
  const now = Date.now();
  let globalOnline = 0;
  let globalSpeedIn = 0, globalSpeedOut = 0, globalNetTx = 0, globalNetRx = 0;
  const regionStats = {};
  
  for (const server of results) {
    const latestMetrics = latestMetricsMap.get(server.id);
    
    let isOnline = false;
    
    if (latestMetrics) {
      const lastSeen = getServerLastSeen(env, server.id, latestMetrics);
      isOnline = !isServerOffline(server, lastSeen, 300000, now);
      mergeMetricsIntoServer(server, latestMetrics, lastSeen);
    }
    normalizePublicIpFields(server);
    
    if (isOnline) {
      globalOnline++;
      globalSpeedIn += parseFloat(server.net_in_speed) || 0;
      globalSpeedOut += parseFloat(server.net_out_speed) || 0;
    }
    
    globalNetRx += parseFloat(server.net_rx || 0);
    globalNetTx += parseFloat(server.net_tx || 0);
    
    let cCode = (server.region || '').toUpperCase();
    if (cCode !== '') {
      regionStats[cCode] = (regionStats[cCode] || 0) + 1;
    }
  }
  
  const globalOffline = results.length - globalOnline;

  const data = {
    servers: results,
    latestReportUpdates: realtimeState.latestReportUpdates,
    stats: {
      total: results.length,
      online: globalOnline,
      offline: globalOffline,
      globalSpeedIn,
      globalSpeedOut,
      globalNetTx,
      globalNetRx
    },
    regionStats,
    sysConfig: {
      show_price: sys.show_price === 'true',
      show_expire: sys.show_expire === 'true',
      show_tf: sys.show_tf === 'true',
      show_three_net_details: sys.show_three_net_details === 'true',
      custom_ct_name: sys.custom_ct_name || '电信',
      custom_cu_name: sys.custom_cu_name || '联通',
      custom_cm_name: sys.custom_cm_name || '移动',
      custom_bd_name: sys.custom_bd_name || 'BGP',
      display_mode: sys.display_mode || 'bar',
      latency_window: {
        points: DASHBOARD_LATENCY_WINDOW_POINTS,
        hours: DASHBOARD_LATENCY_WINDOW_HOURS
      }
    }
  };

  return createSuccessResponse(data);
}
