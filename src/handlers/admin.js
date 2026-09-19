import { handleServerAction, SERVER_ACTIONS } from './servers.js';
import { PING_NODE_FIELDS, normalizePingNodeFields } from '../services/serverInput.js';
import { getServerLastSeen, isServerOffline } from '../services/serverPresence.js';
import { buildAuthCookie, buildClearAuthCookie, checkAuth, simpleAuthResponse, validatePasswordCredentials, generateToken } from '../middleware/auth.js';
import { consumeFactor, readSecurity } from '../services/twoFactor.js';
import { commitAdminSettings, upgradePasswordHash } from '../services/adminSettings.js';
import { handleTwoFactorAction } from './twoFactor.js';
import { getLatestMetricsForAllServers } from '../database/schema.js';
import { getAllServers } from '../utils/cache.js';
import { isValidThemeOptions, isWssReportEnabled, normalizeBooleanSetting, normalizeDefaultLanguage, normalizeDisplayMode, normalizeExpireNotificationTime, normalizeExpireReminder, normalizeFrontendWsTimeoutMinutes, normalizeLongHistoryPoints, normalizeNotificationTemplate, normalizeNotificationTimezone, normalizeNotificationWebhookBody, normalizeNotificationWebhookFormat, normalizeNotificationWebhookHeaders, normalizeNotificationWebhookMethod, normalizePreferredTheme, normalizeResourceAlertRules, normalizeTgNotify, normalizeWssReportHours, saveThemeOptions, SITE_FIELDS, APPEARANCE_FIELDS } from '../utils/settings.js';
import { mergeMetricsIntoServer } from '../utils/metrics.js';
import { hashPassword } from '../utils/common.js';
import { createSuccessResponse, createBadRequestResponse, createUnauthorizedResponse, createErrorResponse } from '../utils/errors.js';
import { sendNotification } from '../services/notifications/delivery.js';
import { scheduleAgentReportModeChanged } from '../utils/agentConfigNotify.js';
import { THEME_PREVIEW_AUTH_TTL_SECONDS } from '../utils/config.js';

const THEME_PREVIEW_AUTH_COOKIE = 'cfsm_theme_preview_auth';
function sanitizeCspDomains(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .split(',')
    .map(s => s.trim())
    .map(normalizeCspOrigin)
    .filter(Boolean)
    .filter((domain, index, arr) => arr.indexOf(domain) === index)
    .join(',');
}

function normalizeCspOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw || /[\s;"']/.test(raw)) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return '';
    if (url.username || url.password || url.search || url.hash) return '';
    if (url.pathname && url.pathname !== '/') return '';
    return url.origin;
  } catch (_) {
    return '';
  }
}

function hasAppearanceInput(settings) {
  if (settings.appearance_options !== undefined) return true;
  return APPEARANCE_FIELDS
    .filter(field => field !== 'theme_options')
    .some(field => settings[field] !== undefined);
}

function extractBearerToken(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const parts = authHeader.trim().split(/\s+/);
  return parts[0] === 'Bearer' && parts[1] ? parts[1] : '';
}

function buildThemePreviewUrl(request, themeUrl) {
  const previewUrl = new URL('/', request.url);
  previewUrl.searchParams.set('theme_url', themeUrl);
  return previewUrl.toString();
}

function buildThemePreviewAuthCookie(request, token) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=${encodeURIComponent(token)}; Max-Age=${THEME_PREVIEW_AUTH_TTL_SECONDS}; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function buildClearThemePreviewAuthCookie(request) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return `${THEME_PREVIEW_AUTH_COOKIE}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure}`;
}

function createSuccessResponseWithCookies(data, cookies = []) {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  for (const cookie of cookies) {
    if (cookie) headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify(data), { status: 200, headers });
}

function normalizeThemeUrl(value) {
  if (value === undefined) return undefined;
  const raw = String(value || '').trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'github.com') return null;
    if (url.username || url.password || url.search || url.hash) return null;

    const parts = url.pathname.split('/').filter(Boolean);
    const ref = parts[3];
    if (
      parts.length < 4 ||
      parts[2] !== 'tree' ||
      !/^[A-Za-z0-9._-]+$/.test(parts[0]) ||
      !/^[A-Za-z0-9._-]+$/.test(parts[1]) ||
      !/^[A-Za-z0-9._-]+$/.test(ref) ||
      parts.some(part => part === '.' || part === '..' || /[%\\]/.test(part))
    ) {
      return null;
    }

    return `https://github.com/${parts.join('/')}`;
  } catch (_) {
    return null;
  }
}

function getThemeRawIndexUrl(themeUrl) {
  const normalized = normalizeThemeUrl(themeUrl);
  if (!normalized) return '';

  const url = new URL(normalized);
  const parts = url.pathname.split('/').filter(Boolean);
  const owner = parts[0];
  const repo = parts[1];
  const ref = parts[3];
  const themePath = [owner, repo, ref, ...parts.slice(4)]
    .map(part => encodeURIComponent(part))
    .join('/');
  return `https://raw.githubusercontent.com/${themePath}/index.html`;
}

async function validateThemeUrlAvailable(themeUrl) {
  if (!themeUrl) return true;

  const rawIndexUrl = getThemeRawIndexUrl(themeUrl);
  if (!rawIndexUrl) return false;

  try {
    const res = await fetch(rawIndexUrl, {
      method: 'GET',
      headers: { 'User-Agent': 'CFSM-Theme-Validate' }
    });
    return res.ok;
  } catch (_) {
    return false;
  }
}

async function handleLoginAction({ request, env, sys, data }) {
  const { username, password } = data;

  if (!username || !password) {
    return createBadRequestResponse('missingCredentials');
  }

  const securityVersion = readSecurity(env.DB).version;
  const passwordHash = sys?.password;
  const credentialResult = await validatePasswordCredentials(username, password, env, sys);

  if (!credentialResult.valid) {
    return createUnauthorizedResponse('invalidCredentials');
  }

  const security = readSecurity(env.DB);
  if (security.version !== securityVersion) return createUnauthorizedResponse('invalidCredentials');
  if (security.secret) {
    if (!data.otp && !data.recoveryCode) return createSuccessResponse({ requiresTwoFactor: true });
    if (!consumeFactor(env, data.otp, data.recoveryCode)) return createUnauthorizedResponse('invalidTwoFactorCode');
  }

  if (credentialResult.needsPasswordUpgrade) {
    try {
      const upgradedPasswordHash = await hashPassword(password);
      if (!upgradePasswordHash(env.DB, securityVersion, passwordHash, upgradedPasswordHash)) {
        return createUnauthorizedResponse('invalidCredentials');
      }
      if (sys) {
        sys.password = upgradedPasswordHash;
      }
    } catch (e) {
      console.error('Password hash upgrade failed:', e);
    }
  }

  try {
    const token = await generateToken(env, sys, securityVersion);
    return createSuccessResponse({
      success: true,
      token: token,
      admin_path: env.ADMIN_PATH,
      message: 'loginSuccessful'
    }, {
      'Set-Cookie': buildAuthCookie(request, token)
    });
  } catch (e) {
    return createErrorResponse(e);
  }
}

function handleLogoutAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearAuthCookie(request),
    buildClearThemePreviewAuthCookie(request)
  ]);
}

function handleClearThemePreviewAuthAction({ request }) {
  return createSuccessResponseWithCookies({
    success: true
  }, [
    buildClearThemePreviewAuthCookie(request)
  ]);
}

const PUBLIC_ADMIN_ACTION_HANDLERS = {
  login: handleLoginAction,
  logout: handleLogoutAction,
  clear_theme_preview_auth: handleClearThemePreviewAuthAction
};

async function handleGetSettingsAction({ env, sys, loadFullSettings }) {
  const fullSettings = loadFullSettings ? await loadFullSettings() : sys;
  const { jwt_secret, password, ...safeSettings } = fullSettings || {};
  return createSuccessResponse({
    success: true,
    settings: { ...safeSettings, username: safeSettings.username || env.API_USER_NAME || 'admin' },
    api_secret: env.API_SECRET
  });
}

async function handleStartThemePreviewAction({ request, data }) {
  const normalizedThemeUrl = normalizeThemeUrl(data.theme_url);
  if (!normalizedThemeUrl) {
    return createBadRequestResponse('invalidThemeUrl');
  }
  if (!await validateThemeUrlAvailable(normalizedThemeUrl)) {
    return createBadRequestResponse('invalidThemeUrl');
  }

  const token = extractBearerToken(request);
  if (!token) {
    return simpleAuthResponse();
  }

  return createSuccessResponse({
    success: true,
    preview_url: buildThemePreviewUrl(request, normalizedThemeUrl)
  }, {
    'Set-Cookie': buildThemePreviewAuthCookie(request, token)
  });
}

async function handleSaveThemeOptionsAction({ env, sys, data }) {
  const themeOptions = data.theme_options ?? data.settings?.theme_options;
  if (!isValidThemeOptions(themeOptions)) {
    return createBadRequestResponse('invalidThemeOptionsFormat');
  }

  await saveThemeOptions(env.DB, themeOptions);
  if (sys) {
    sys.theme_options = themeOptions;
  }

  return createSuccessResponse({
    success: true,
    theme_options: themeOptions,
    message: 'updateSuccess'
  });
}

async function handleListAction({ env }) {
  const servers = await getAllServers(env.DB);
  const latestMetricsMap = await getLatestMetricsForAllServers(env.DB);

  const now = Date.now();
  const ONLINE_THRESHOLD = 300000;
  const stats = {
    total: servers.length,
    online: 0,
    offline: 0,
    total_cpu: 0,
    total_net_in: 0,
    total_net_out: 0,
    avg_cpu: 0
  };

  const serversWithStatus = servers.map(server => {
    const latestMetrics = latestMetricsMap.get(server.id);
    const item = { ...server, region_override: server.region || '' };
    let isOnline = false;

    if (latestMetrics) {
      const lastSeen = getServerLastSeen(env, server.id, latestMetrics);
      isOnline = !isServerOffline(server, lastSeen, ONLINE_THRESHOLD, now);
      mergeMetricsIntoServer(item, latestMetrics, lastSeen);
    } else {
      item.last_updated = 0;
      item.is_online = false;
      item.cpu_cores = 0;
      item.cpu_info = '';
      item.arch = '';
      item.os = '';
      item.agent_version = '';
      item.ip_v4 = '0';
      item.ip_v6 = '0';
      item.boot_time = '';
    }

    item.is_online = isOnline;
    if (!item.region) item.region = server.region || '';
    delete item.bandwidth;

    if (isOnline) {
      stats.online++;
      stats.total_cpu += parseFloat(item.cpu) || 0;
      stats.total_net_in += parseFloat(item.net_in_speed) || 0;
      stats.total_net_out += parseFloat(item.net_out_speed) || 0;
    } else {
      stats.offline++;
    }

    return item;
  });

  if (stats.online > 0) {
    stats.avg_cpu = (stats.total_cpu / stats.online).toFixed(2);
  }

  return createSuccessResponse({
    success: true,
    servers: serversWithStatus,
    stats
  });
}

async function handleSendTestNotificationAction({ data }) {
  const {
    tg_bot_token,
    tg_chat_id,
    notification_webhook_enabled,
    notification_webhook_url,
    notification_webhook_method,
    notification_webhook_format,
    notification_webhook_headers,
    notification_webhook_body,
    notification_template,
    notification_timezone,
    expire_notification_time
  } = data;
  const webhookEnabled = normalizeBooleanSetting(notification_webhook_enabled) === 'true';
  if (webhookEnabled) {
    if (!notification_webhook_url || String(notification_webhook_url).trim().length === 0) {
      return createBadRequestResponse('notificationWebhookUrlRequired');
    }
  } else if (!tg_bot_token || tg_bot_token.trim().length === 0) {
    return createBadRequestResponse('tgBotTokenRequired');
  }
  try {
    const testMsg = '这是一条来自 CF Server Monitor 的测试消息。';
    const result = await sendNotification({
      tg_bot_token,
      tg_chat_id: tg_chat_id || '',
      notification_webhook_enabled: normalizeBooleanSetting(notification_webhook_enabled),
      notification_webhook_url: notification_webhook_url || '',
      notification_webhook_method: normalizeNotificationWebhookMethod(notification_webhook_method),
      notification_webhook_format: normalizeNotificationWebhookFormat(notification_webhook_format),
      notification_webhook_headers: normalizeNotificationWebhookHeaders(notification_webhook_headers),
      notification_webhook_body: normalizeNotificationWebhookBody(notification_webhook_body),
      notification_template: normalizeNotificationTemplate(notification_template),
      notification_timezone: normalizeNotificationTimezone(notification_timezone),
      expire_notification_time: normalizeExpireNotificationTime(expire_notification_time)
    }, testMsg, {
      event: '测试通知',
      emoji: '✅',
      clients: ['CF Server Monitor'],
      count: 1,
      message: '这是一条来自 CF Server Monitor 的测试消息。'
    });
    if (result.status !== 'delivered') {
      console.warn('Test notification failed:', result);
      return createBadRequestResponse('testNotificationFailed');
    }
    return createSuccessResponse({ success: true, message: 'testNotificationSent' });
  } catch (e) {
    return createBadRequestResponse('testNotificationFailed');
  }
}

const AUTHENTICATED_ADMIN_ACTION_HANDLERS = {
  get_settings: handleGetSettingsAction,
  start_theme_preview: handleStartThemePreviewAction,
  save_theme_options: handleSaveThemeOptionsAction,
  list: handleListAction,
  send_test_notification: handleSendTestNotificationAction
};

export async function handleAdminAPI(request, env, sys, loadFullSettings = null, ctx = null) {
  try {
    const data = await request.json();

    const publicActionHandler = PUBLIC_ADMIN_ACTION_HANDLERS[data.action];
    if (publicActionHandler) {
      return publicActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (!await checkAuth(request, env, sys)) {
      return simpleAuthResponse();
    }

    if (typeof data.action === 'string' && data.action.startsWith('two_factor_')) {
      return handleTwoFactorAction({ request, env, sys, data });
    }

    const authenticatedActionHandler = AUTHENTICATED_ADMIN_ACTION_HANDLERS[data.action];
    if (authenticatedActionHandler) {
      return authenticatedActionHandler({ request, env, sys, data, loadFullSettings, ctx });
    }

    if (SERVER_ACTIONS.has(data.action)) return handleServerAction({ env, sys, data, ctx });

    if (data.action === 'save_settings') {
      const securityVersion = readSecurity(env.DB).version;
      const settings = data.settings || {};
      if ((settings.username !== undefined && (typeof settings.username !== 'string' || settings.username.length > 256)) ||
          (settings.password !== undefined && (typeof settings.password !== 'string' || settings.password.length > 4096))) {
        return createBadRequestResponse('invalidCredentials');
      }
      const normalizedThemeUrl = normalizeThemeUrl(settings.theme_url);
      if (normalizedThemeUrl === null) {
        return createBadRequestResponse('invalidThemeUrl');
      }
      if (normalizedThemeUrl && !await validateThemeUrlAvailable(normalizedThemeUrl)) {
        return createBadRequestResponse('invalidThemeUrl');
      }

      // 如果 tg_notify 或 expire_reminder 开启，验证 tg_bot_token 不为空
      const hasResourceAlertRulesInput = settings.resource_alert_rules !== undefined;
      const tgNotify = settings.tg_notify !== undefined
        ? normalizeTgNotify(settings.tg_notify)
        : normalizeTgNotify(sys?.tg_notify);
      const expireReminder = settings.expire_reminder !== undefined
        ? normalizeExpireReminder(settings.expire_reminder)
        : normalizeExpireReminder(sys?.expire_reminder);
      const currentResourceAlertRules = normalizeResourceAlertRules(sys?.resource_alert_rules);
      const normalizedResourceAlertRules = hasResourceAlertRulesInput
        ? normalizeResourceAlertRules(settings.resource_alert_rules)
        : currentResourceAlertRules;
      const resourceAlertEnabled = normalizedResourceAlertRules.length > 0;
      const trafficReportEnabled = normalizeBooleanSetting(
        settings.traffic_report_enabled !== undefined
          ? settings.traffic_report_enabled
          : sys?.traffic_report_enabled
      ) === 'true';
      if (tgNotify !== '0' || expireReminder !== '0' || resourceAlertEnabled || trafficReportEnabled) {
        const webhookEnabled = settings.notification_webhook_enabled !== undefined
          ? normalizeBooleanSetting(settings.notification_webhook_enabled) === 'true'
          : normalizeBooleanSetting(sys?.notification_webhook_enabled) === 'true';
        const effectiveWebhookUrl = settings.notification_webhook_url !== undefined
          ? settings.notification_webhook_url
          : sys?.notification_webhook_url;
        const effectiveTgBotToken = settings.tg_bot_token !== undefined
          ? settings.tg_bot_token
          : sys?.tg_bot_token;
        if (webhookEnabled) {
          if (!effectiveWebhookUrl || String(effectiveWebhookUrl).trim().length === 0) {
            return createBadRequestResponse('notificationWebhookUrlRequired');
          }
        } else if (!effectiveTgBotToken || String(effectiveTgBotToken).trim().length === 0) {
          return createBadRequestResponse('tgBotTokenRequired');
        }
      }

      const pingNodes = normalizePingNodeFields(settings);
      if (!pingNodes.valid) {
        return createBadRequestResponse('invalidPingNodeFormat');
      }

      if (settings.appearance_options !== undefined && (
        settings.appearance_options === null ||
        typeof settings.appearance_options !== 'object' ||
        Array.isArray(settings.appearance_options)
      )) {
        return createBadRequestResponse('invalidThemeOptionsFormat');
      }

      const shouldSaveAppearanceOptions = hasAppearanceInput(settings);
      const appearanceOptions = {};

      if (shouldSaveAppearanceOptions) {
        const nestedAppearanceOptions = settings.appearance_options || {};
        for (const field of APPEARANCE_FIELDS) {
          const value = field === 'theme_options' ? nestedAppearanceOptions.theme_options : settings[field];
          if (value !== undefined) {
            // CSP 字段格式校验：只允许 https:// 开头的域名，逗号分隔
            if (field === 'csp_static' || field === 'csp_api') {
              appearanceOptions[field] = sanitizeCspDomains(value);
            } else if (field === 'display_mode') {
              appearanceOptions[field] = normalizeDisplayMode(value);
            } else if (field === 'preferred_theme') {
              appearanceOptions[field] = normalizePreferredTheme(value);
            } else if (field === 'default_language') {
              appearanceOptions[field] = normalizeDefaultLanguage(value);
            } else if (field === 'theme_options') {
              if (!isValidThemeOptions(value)) {
                return createBadRequestResponse('invalidThemeOptionsFormat');
              }
              appearanceOptions[field] = value;
            } else {
              appearanceOptions[field] = value;
            }
          }
        }
      }

      const siteOptions = {};
      for (const field of SITE_FIELDS) {
        if (settings[field] !== undefined) {
          if (field === 'password') {
            if (settings[field] && settings[field].length > 0) {
              siteOptions[field] = await hashPassword(settings[field]);
            }
          } else if (PING_NODE_FIELDS.includes(field)) {
            siteOptions[field] = pingNodes.values[field];
          } else if (field === 'tg_notify') {
            siteOptions[field] = tgNotify;
          } else if (field === 'expire_reminder') {
            siteOptions[field] = expireReminder;
          } else if (field === 'long_history_points') {
            siteOptions[field] = normalizeLongHistoryPoints(settings[field]);
          } else if (field === 'frontend_ws_timeout_minutes') {
            siteOptions[field] = normalizeFrontendWsTimeoutMinutes(settings[field]);
          } else if (field === 'resource_alert_rules') {
            siteOptions[field] = normalizedResourceAlertRules;
          } else if (field === 'wss_report_enabled') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'wss_report_hours') {
            siteOptions[field] = normalizeWssReportHours(settings[field]);
          } else if (field === 'show_three_net_details') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_timezone') {
            siteOptions[field] = normalizeNotificationTimezone(settings[field]);
          } else if (field === 'expire_notification_time') {
            siteOptions[field] = normalizeExpireNotificationTime(settings[field]);
          } else if (field === 'traffic_report_enabled') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_webhook_enabled') {
            siteOptions[field] = normalizeBooleanSetting(settings[field]);
          } else if (field === 'notification_webhook_method') {
            siteOptions[field] = normalizeNotificationWebhookMethod(settings[field]);
          } else if (field === 'notification_webhook_format') {
            siteOptions[field] = normalizeNotificationWebhookFormat(settings[field]);
          } else if (field === 'notification_webhook_headers') {
            siteOptions[field] = normalizeNotificationWebhookHeaders(settings[field]);
          } else if (field === 'notification_webhook_body') {
            siteOptions[field] = normalizeNotificationWebhookBody(settings[field]);
          } else if (field === 'notification_template') {
            siteOptions[field] = normalizeNotificationTemplate(settings[field]);
          } else if (field === 'theme_url') {
            siteOptions[field] = normalizedThemeUrl;
          } else {
            siteOptions[field] = settings[field];
          }
        }
      }
      if (!await checkAuth(request, env, sys)) return simpleAuthResponse();
      const committed = commitAdminSettings(env, securityVersion, siteOptions, shouldSaveAppearanceOptions ? appearanceOptions : null, hasResourceAlertRulesInput && !resourceAlertEnabled);
      if (!committed) return simpleAuthResponse();
      env.REALTIME_HUB?.revokeFrontendSessions();
      const shouldCloseAgentWssReports = !isWssReportEnabled({ ...sys, ...siteOptions });
      Object.assign(sys, shouldSaveAppearanceOptions ? appearanceOptions : {}, siteOptions);
      if (shouldCloseAgentWssReports && (
        settings.wss_report_enabled !== undefined ||
        settings.wss_report_hours !== undefined
      )) {
        scheduleAgentReportModeChanged(env, ctx);
      }
      return createSuccessResponseWithCookies({
        success: true,
        requiresLogin: committed.credentialsChanged,
        message: 'updateSuccess'
      }, committed.credentialsChanged ? [buildClearAuthCookie(request), buildClearThemePreviewAuthCookie(request)] : []);
    } 
    return createBadRequestResponse('unknownAction');
    
  } catch (e) {
    console.error('Admin API 错误:', e);
    return createErrorResponse(e);
  }
}
