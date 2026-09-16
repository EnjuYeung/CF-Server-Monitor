import { getMetricsHistory, clearHistory } from './database/schema.js';
import { handleAdminAPI } from './handlers/admin.js';
import { serveFrontend } from './handlers/frontend.js';
import { handleUpdate } from './handlers/update.js';
import { handleServerAPI, handleServersAPI } from './handlers/dashboard.js';
import { handleTheme } from './handlers/theme.js';
import { isValidThemeOptions, loadSettings, loadSiteSettings, loadAppearanceOptions, normalizeFrontendWsTimeoutMinutes, normalizeLongHistoryPoints, saveThemeOptions, setDebug, debug } from './utils/settings.js';
import { omitNullLossProbeFields } from './handlers/dashboard.js';
import { checkAuth, simpleAuthResponse } from './middleware/auth.js';
import { getServerDetail } from './utils/cache.js';
import { createSuccessResponse, createUnauthorizedResponse, createBadRequestResponse, createNotFoundResponse } from './utils/errors.js';
import { getCorsAllowedOrigins, createOptionsResponse, applyCors } from './utils/cors.js';
import { getRemoteVersion } from './utils/version.js';
import { isAdminEntry } from './utils/adminPath.js';
import {
  HISTORY_ALL_QUERY_COLUMNS
} from './utils/historyFields.js';
import {
  CURRENT_VERSION,
  DASHBOARD_LATENCY_WINDOW_HOURS,
  DASHBOARD_LATENCY_WINDOW_POINTS
} from './utils/config.js';
function cleanThemeAssetResponse(response) {
  const headers = new Headers(response.headers);
  headers.delete('X-CFSM-Theme-Asset');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchHistoryData(env, request, id, hours, columns, sys = null) {
  if (!id) return createBadRequestResponse('Missing ID');

  const ALLOWED_HOURS = [0.167, 0.5, 1, 6, 12, 24, 48, 96, 168];
  if (!ALLOWED_HOURS.includes(hours)) {
    return createBadRequestResponse('Invalid hours parameter');
  }
  
  if (!sys) {
    sys = await loadSiteSettings(env.DB);
  }
  const isLoggedIn = await checkAuth(request, env, sys);
  
  if (sys.is_public !== 'true' && !isLoggedIn) {
    return simpleAuthResponse();
  }
  
  if (hours > 24 && !isLoggedIn) {
    return createUnauthorizedResponse();
  }
  
  const server = await getServerDetail(env.DB, id, isLoggedIn);
  if (!server) return createNotFoundResponse();
  
  // 最多查询7天数据
  const clampedHours = Math.min(hours, 168);
  const longHistoryPoints = clampedHours > 1
    ? Number(normalizeLongHistoryPoints(sys.long_history_points))
    : null;

  const data = await getMetricsHistory(env.DB, id, clampedHours, columns, server, longHistoryPoints);
  const sanitizedData = Array.isArray(data)
    ? data.map(omitNullLossProbeFields)
    : data;
  
  return createSuccessResponse(sanitizedData);
}

export default {
  async fetch(request, env, ctx) {
    setDebug(env.DEBUG);

    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    const corsAllowedOrigins = getCorsAllowedOrigins(env);
    
    if (!env.API_SECRET || env.API_SECRET.length === 0) {
      const response = createBadRequestResponse('API_SECRET is required');
      return applyCors(response, request, corsAllowedOrigins);
    }
    
    if (method === 'OPTIONS') {
      return createOptionsResponse(request, corsAllowedOrigins);
    }

    if (method === 'GET' && path.startsWith('/assets/')) {
      try {
        const themeAssetResponse = await serveFrontend(request, env, await loadSettings(env.DB));
        if (themeAssetResponse.headers.get('X-CFSM-Theme-Asset') === '1') {
          return applyCors(cleanThemeAssetResponse(themeAssetResponse), request, corsAllowedOrigins);
        }
      } catch (e) {
      }
    }

    let sys = null;

    async function ensureSiteSettings() {
      if (!sys) {
        sys = await loadSiteSettings(env.DB);
      }
      return sys;
    }

    async function ensureFullSettings() {
      sys = await loadSettings(env.DB);
      return sys;
    }

    const routes = [
      { method: 'POST', path: '/update', handler: () => handleUpdate(request, env, ctx) },
      { method: 'GET', path: '/api/config', handler: async () => {
        await ensureSiteSettings();
        const appearanceOptions = await loadAppearanceOptions(env.DB);
        const isLoggedIn = await checkAuth(request, env, sys);
        const remoteVersion = isLoggedIn ? await getRemoteVersion(env) : null;

        return createSuccessResponse({
          version: CURRENT_VERSION,
          ...(isLoggedIn ? {
            admin_path: env.ADMIN_PATH,
            last_agent_version: remoteVersion?.agent || null
          } : {}),
          is_public: sys.is_public === 'true',
          authorization: isLoggedIn,
          custom_ct_name: sys.custom_ct_name || '电信',
          custom_cu_name: sys.custom_cu_name || '联通',
          custom_cm_name: sys.custom_cm_name || '移动',
          custom_bd_name: sys.custom_bd_name || 'BGP',
          node_1_name: sys.node_1_name || 'Node 1',
          node_2_name: sys.node_2_name || 'Node 2',
          node_3_name: sys.node_3_name || 'Node 3',
          node_4_name: sys.node_4_name || 'Node 4',
          site_title: appearanceOptions.site_title || '',
          display_mode: appearanceOptions.display_mode || 'bar',
          preferred_theme: appearanceOptions.preferred_theme || 'auto',
          default_language: appearanceOptions.default_language || 'auto',
          theme_options: appearanceOptions.theme_options || {},
          frontend_ws_timeout_minutes: Number(normalizeFrontendWsTimeoutMinutes(sys.frontend_ws_timeout_minutes)),
          long_history_points: Number(normalizeLongHistoryPoints(sys.long_history_points)),
          latency_window: {
            points: DASHBOARD_LATENCY_WINDOW_POINTS,
            hours: DASHBOARD_LATENCY_WINDOW_HOURS
          }
        });
      }},
      { method: 'GET', path: '/theme', handler: async () => {
        const themeResult = await handleTheme()
        if (!themeResult.ok) {
          return new Response(JSON.stringify({
            error: themeResult.error || 'themeStoreProxyFailed',
            code: 502,
            fallback: 'client'
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json' }
          })
        }

        return createSuccessResponse(themeResult.themeStore, {
          'X-CFSM-Theme-Source': themeResult.cached ? 'cache' : 'raw'
        })
      }},
      { method: 'POST', path: '/api/theme_options', handler: async () => {
        await ensureSiteSettings();
        if (!await checkAuth(request, env, sys)) {
          return simpleAuthResponse();
        }

        let data;
        try {
          data = await request.json();
        } catch (_) {
          return createBadRequestResponse('invalidJson');
        }

        const themeOptions = data?.theme_options;
        if (!isValidThemeOptions(themeOptions)) {
          return createBadRequestResponse('invalidThemeOptionsFormat');
        }

        await saveThemeOptions(env.DB, themeOptions);
        sys.theme_options = themeOptions;
        return createSuccessResponse({
          success: true,
          theme_options: themeOptions,
          message: 'updateSuccess'
        });
      }},
      { method: 'GET', path: '/api/server', handler: async () => {
        await ensureSiteSettings();
        return handleServerAPI(request, env, sys);
      }},
      { method: 'GET', path: '/api/servers', handler: async () => {
        await ensureFullSettings();
        return handleServersAPI(request, env, sys);
      }},

      { method: 'GET', path: '/api/history/all', handler: async () => {
        await ensureSiteSettings();
        const id = url.searchParams.get('id');
        const hours = parseFloat(url.searchParams.get('hours') || '24');
        const allColumns = HISTORY_ALL_QUERY_COLUMNS.join(', ');
        return fetchHistoryData(env, request, id, hours, allColumns, sys);
      }},
      { method: 'POST', path: `${env.ADMIN_PATH}/api`, handler: async () => {
        await ensureSiteSettings();
        return handleAdminAPI(request, env, sys, ensureFullSettings, ctx);
      }},
      { method: 'POST', path: '/clearHistory', handler: async () => {
        await ensureSiteSettings();
        if (!await checkAuth(request, env, sys)) {
          return simpleAuthResponse();
        }
        env.REALTIME_HUB?.discardPendingHistory();
        const result = await clearHistory(env.DB);
        return createSuccessResponse(result);
      }}
    ];

    for (const route of routes) {
      if (route.method === method && route.path === path) {
        const response = await route.handler();

        return applyCors(response, request, corsAllowedOrigins);
      }
    }

    if (method !== 'GET' || (path !== '/' && !isAdminEntry(path, env))) return applyCors(createNotFoundResponse(), request, corsAllowedOrigins);
    const fullSettings = await loadSettings(env.DB);
    const frontendResponse = await serveFrontend(request, env, fullSettings);
    return applyCors(frontendResponse, request, corsAllowedOrigins);
  }
};
