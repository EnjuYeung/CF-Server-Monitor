import { readNotificationConfig, normalizeBooleanSetting } from '../shared/notificationConfig.js';
export { TG_NOTIFY_MINUTES_MIN, TG_NOTIFY_MINUTES_MAX, TG_NOTIFY_LEGACY_TRUE_MINUTES, EXPIRE_REMINDER_DAYS_MAX, DEFAULT_NOTIFICATION_TIMEZONE, DEFAULT_EXPIRE_NOTIFICATION_TIME, RESOURCE_ALERT_WINDOW_MIN, RESOURCE_ALERT_WINDOW_MAX, RESOURCE_ALERT_MODE_CONTINUOUS, RESOURCE_ALERT_MODE_AVERAGE, RESOURCE_ALERT_RULES_MAX, DEFAULT_NOTIFICATION_TEMPLATE, DEFAULT_NOTIFICATION_WEBHOOK_BODY, NOTIFICATION_WEBHOOK_METHODS, NOTIFICATION_WEBHOOK_FORMATS, RESOURCE_ALERT_METRIC_CPU, RESOURCE_ALERT_METRIC_RAM, RESOURCE_ALERT_METRIC_DISK, RESOURCE_ALERT_METRIC_NET_IN, RESOURCE_ALERT_METRIC_NET_OUT, RESOURCE_ALERT_METRICS, normalizeBooleanSetting, normalizeTgNotify, getTgNotifyMinutes, normalizeExpireReminder, getExpireReminderDays, normalizeNotificationTimezone, normalizeExpireNotificationTime, normalizeNotificationWebhookMethod, normalizeNotificationWebhookFormat, normalizeNotificationWebhookHeaders, normalizeNotificationWebhookBody, normalizeNotificationTemplate, normalizeResourceAlertWindowMinutes, normalizeResourceAlertIntervalMinutes, normalizeResourceAlertPercent, normalizeResourceAlertMbps, normalizeResourceAlertMode, normalizeResourceAlertMetric, normalizeResourceAlertThreshold, normalizeResourceAlertRule, normalizeResourceAlertRules, getResourceAlertRuleThresholds, getResourceAlertConfig } from '../shared/notificationConfig.js';
import { normalizeLanguagePreference } from './language.js';
import {
  DEFAULT_SITE_TITLE,
  JWT_SECRET_MIN_LENGTH,
  SITE_SETTINGS_CACHE_TTL_MS
} from './config.js';

export const APPEARANCE_FIELDS = ['site_title', 'custom_bg', 'custom_bg_mobile', 'favicon', 'custom_head', 'custom_script', 'csp_static', 'csp_api', 'display_mode', 'preferred_theme', 'default_language', 'theme_options'];

export const SITE_FIELDS = ['is_public', 'show_price', 'show_expire', 'show_tf', 'show_three_net_details', 'wss_report_enabled', 'wss_report_hours', 'frontend_ws_timeout_minutes', 'long_history_points', 'tg_notify', 'tg_bot_token', 'tg_chat_id', 'notification_timezone', 'expire_notification_time', 'traffic_report_enabled', 'notification_webhook_enabled', 'notification_webhook_url', 'notification_webhook_method', 'notification_webhook_format', 'notification_webhook_headers', 'notification_webhook_body', 'notification_template', 'jwt_secret', 'username', 'password', 'custom_ct', 'custom_cu', 'custom_cm', 'custom_bd', 'node_1', 'node_2', 'node_3', 'node_4', 'custom_ct_name', 'custom_cu_name', 'custom_cm_name', 'custom_bd_name', 'node_1_name', 'node_2_name', 'node_3_name', 'node_4_name', 'expire_reminder', 'resource_alert_rules', 'theme_url', ];

export const LONG_HISTORY_POINT_OPTIONS = [60, 120, 180, 240];
export const DEFAULT_LONG_HISTORY_POINTS = 120;
export const FRONTEND_WS_TIMEOUT_MINUTES_MAX = 1440;
export const ALL_WSS_REPORT_HOURS = Object.freeze(Array.from({ length: 24 }, (_, hour) => hour));
let cachedSiteSettings = null;
let siteSettingsCacheExpiry = 0;
let cachedAppearanceOptions = null;
let appearanceOptionsCacheExpiry = 0;

const defaults = {
  site_title: DEFAULT_SITE_TITLE,
  custom_bg: '',
  custom_bg_mobile: '',
  favicon: '',
  custom_head: '',
  custom_script: '',
  csp_static: '',
  csp_api: '',
  display_mode: 'ring',
  preferred_theme: 'auto',
  default_language: 'auto',
  theme_options: {},
  is_public: 'true',
  show_price: 'true',
  show_expire: 'true',
  show_tf: 'true',
  show_three_net_details: 'true',
  wss_report_enabled: 'true',
  wss_report_hours: [...ALL_WSS_REPORT_HOURS],
  frontend_ws_timeout_minutes: '0',
  long_history_points: String(DEFAULT_LONG_HISTORY_POINTS),
  ...readNotificationConfig(),
  jwt_secret: '',
  custom_ct: 'gd-ct-dualstack.ip.zstaticcdn.com',
  custom_cu: 'gd-cu-dualstack.ip.zstaticcdn.com',
  custom_cm: 'gd-cm-dualstack.ip.zstaticcdn.com',
  custom_bd: '',
  node_1: '',
  node_2: '',
  node_3: '',
  node_4: '',
  custom_ct_name: '电信',
  custom_cu_name: '联通',
  custom_cm_name: '移动',
  custom_bd_name: 'BGP',
  node_1_name: 'Node 1',
  node_2_name: 'Node 2',
  node_3_name: 'Node 3',
  node_4_name: 'Node 4',
  theme_url: '',
};

export function normalizeLongHistoryPoints(value) {
  const points = Number(value);
  return String(
    LONG_HISTORY_POINT_OPTIONS.includes(points)
      ? points
      : DEFAULT_LONG_HISTORY_POINTS
  );
}

export function normalizeFrontendWsTimeoutMinutes(value) {
  const minutes = Number(value);
  return String(
    Number.isInteger(minutes) && minutes >= 0 && minutes <= FRONTEND_WS_TIMEOUT_MINUTES_MAX
      ? minutes
      : 0
  );
}

export function generateRandomSecret(byteLength = 32) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let result = '';
  for (const byte of bytes) {
    result += byte.toString(16).padStart(2, '0');
  }
  return result;
}

export function isValidJwtSecret(secret) {
  return typeof secret === 'string' && secret.length >= JWT_SECRET_MIN_LENGTH;
}

function tryParseJSON(str) {
  if (!str) return null;
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function copyFields(target, source, fields) {
  if (!source || typeof source !== 'object') return;
  for (const field of fields) {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  }
}

export function normalizeDisplayMode(value, fallback = 'bar') {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'list') return 'table';
  if (mode === 'bar' || mode === 'ring' || mode === 'table') return mode;
  return fallback === 'ring' || fallback === 'table' ? fallback : 'bar';
}

export function normalizePreferredTheme(value, fallback = 'auto') {
  const theme = String(value || '').trim().toLowerCase();
  if (theme === 'dark' || theme === 'light' || theme === 'auto') return theme;
  return fallback === 'dark' || fallback === 'light' ? fallback : 'auto';
}

export function normalizeDefaultLanguage(value, fallback = 'auto') {
  return normalizeLanguagePreference(value, fallback);
}

export function normalizeWssReportHours(value) {
  if (value === undefined || value === null || value === '') {
    return [...ALL_WSS_REPORT_HOURS];
  }

  let source = value;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch (_) {
      source = source.split(',').map(item => item.trim()).filter(Boolean);
    }
  }
  if (!Array.isArray(source)) return [...ALL_WSS_REPORT_HOURS];

  return Array.from(new Set(source
    .map(hour => {
      if (typeof hour === 'number') return hour;
      if (typeof hour === 'string' && /^\d{1,2}$/.test(hour.trim())) return Number(hour);
      return NaN;
    })
    .filter(hour => Number.isInteger(hour) && hour >= 0 && hour <= 23)))
    .sort((a, b) => a - b);
}

export function isWssReportConfigured(settings = {}) {
  return normalizeBooleanSetting(settings?.wss_report_enabled) === 'true';
}

export function getWssReportScheduleState(settings = {}, now = Date.now()) {
  const date = now instanceof Date ? now : new Date(now);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;

  if (!isWssReportConfigured(settings)) {
    return {
      configured: false,
      active: false,
      mode: 'disabled',
      reason: 'wss_disabled'
    };
  }

  const hours = normalizeWssReportHours(settings?.wss_report_hours);
  if (hours.length === 0) {
    return {
      configured: true,
      active: false,
      mode: 'inactive',
      reason: 'wss_schedule_empty'
    };
  }

  const currentHour = safeDate.getUTCHours();
  if (hours.includes(currentHour)) {
    return {
      configured: true,
      active: true,
      mode: 'active',
      reason: 'wss_schedule_active'
    };
  }

  return {
    configured: true,
    active: false,
    mode: 'inactive',
    reason: 'wss_schedule_inactive'
  };
}

export function isWssReportEnabled(settings = {}, now = Date.now()) {
  return getWssReportScheduleState(settings, now).active;
}

async function saveJwtSecretIfMissing(db, secret) {
  await db.prepare(`
    INSERT INTO settings (key, value)
    VALUES ('site_options', json_object('jwt_secret', ?))
    ON CONFLICT(key) DO UPDATE SET value = CASE
      WHEN json_valid(value)
        AND typeof(json_extract(value, '$.jwt_secret')) = 'text'
        AND length(json_extract(value, '$.jwt_secret')) >= ?
      THEN value
      WHEN json_valid(value)
      THEN json_set(value, '$.jwt_secret', ?)
      ELSE json_object('jwt_secret', ?)
    END
  `).bind(secret, JWT_SECRET_MIN_LENGTH, secret, secret).run();

  const siteRow = await db.prepare(
    "SELECT value FROM settings WHERE key = 'site_options'"
  ).first();
  const siteOptions = siteRow && siteRow.value
    ? tryParseJSON(siteRow.value)
    : null;

  return isValidJwtSecret(siteOptions?.jwt_secret) ? siteOptions.jwt_secret : secret;
}

async function ensurePersistedJwtSecret(db, result, siteOptions) {
  if (isValidJwtSecret(siteOptions?.jwt_secret)) {
    return siteOptions.jwt_secret;
  }

  const secret = isValidJwtSecret(result.jwt_secret)
    ? result.jwt_secret
    : generateRandomSecret(32);

  return saveJwtSecretIfMissing(db, secret);
}

export async function loadSiteSettings(db, options = {}) {
  const forceRefresh = options === true || Boolean(options && options.forceRefresh);
  const now = Date.now();
  if (!forceRefresh && cachedSiteSettings && now < siteSettingsCacheExpiry) {
    debug('Settings缓存命中');
    return cachedSiteSettings;
  }
  debug('Settings缓存更新');

  const result = { ...defaults };
  let siteOptions = null;

  try {
    const siteRow = await db.prepare(
      "SELECT value FROM settings WHERE key = 'site_options'"
    ).first();
    if (siteRow) {
      const parsed = tryParseJSON(siteRow.value);
      if (parsed) {
        siteOptions = parsed;
      }
    }


    copyFields(result, siteOptions, SITE_FIELDS);

    if (!isValidJwtSecret(siteOptions?.jwt_secret) || !isValidJwtSecret(result.jwt_secret)) {
      result.jwt_secret = await ensurePersistedJwtSecret(db, result, siteOptions);
    }
    Object.assign(result, readNotificationConfig(result));
    result.long_history_points = normalizeLongHistoryPoints(result.long_history_points);
    result.show_three_net_details = normalizeBooleanSetting(result.show_three_net_details, defaults.show_three_net_details);
    result.wss_report_enabled = normalizeBooleanSetting(result.wss_report_enabled, defaults.wss_report_enabled);
    result.wss_report_hours = normalizeWssReportHours(result.wss_report_hours);
    result.frontend_ws_timeout_minutes = normalizeFrontendWsTimeoutMinutes(result.frontend_ws_timeout_minutes);
  } catch (e) {
    throw new Error('Unable to load site settings', { cause: e });
  }

  cachedSiteSettings = result;
  siteSettingsCacheExpiry = now + SITE_SETTINGS_CACHE_TTL_MS;
  return result;
}

export function clearSiteSettingsCache() {
  cachedSiteSettings = null;
  siteSettingsCacheExpiry = 0;
}

export async function loadAppearanceOptions(db) {
  const now = Date.now();
  if (cachedAppearanceOptions && now < appearanceOptionsCacheExpiry) {
    debug('Appearance缓存命中');
    return cachedAppearanceOptions;
  }
  debug('Appearance缓存更新');

  const result = {};
  copyFields(result, defaults, APPEARANCE_FIELDS);
  let appearanceOptions = null;

  try {
    const appearanceRow = await db.prepare(
      "SELECT value FROM settings WHERE key = 'appearance_options'"
    ).first();
    if (appearanceRow) {
      const parsed = tryParseJSON(appearanceRow.value);
      if (parsed) {
        appearanceOptions = parsed;
      }
    }


    copyFields(result, appearanceOptions, APPEARANCE_FIELDS);
    result.display_mode = normalizeDisplayMode(result.display_mode, defaults.display_mode);
    result.preferred_theme = normalizePreferredTheme(result.preferred_theme);
    result.default_language = normalizeDefaultLanguage(result.default_language);
  } catch (e) {
    throw new Error('Unable to load appearance settings', { cause: e });
  }

  cachedAppearanceOptions = result;
  appearanceOptionsCacheExpiry = now + SITE_SETTINGS_CACHE_TTL_MS;
  return result;
}

export function clearAppearanceSettingsCache() {
  cachedAppearanceOptions = null;
  appearanceOptionsCacheExpiry = 0;
}

export function isValidThemeOptions(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function saveThemeOptions(db, themeOptions) {
  await db.prepare(
    `INSERT INTO settings (key, value)
     VALUES ('appearance_options', json_object('theme_options', json(?)))
     ON CONFLICT(key) DO UPDATE SET value = CASE
       WHEN json_valid(value) THEN CASE
         WHEN json_type(value) = 'object' THEN json_set(value, '$.theme_options', json(?))
         ELSE json_object('theme_options', json(?))
       END
       ELSE json_object('theme_options', json(?))
     END`
  ).bind(
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions),
    JSON.stringify(themeOptions)
  ).run();

  clearAppearanceSettingsCache();
  return themeOptions;
}

export async function loadSettings(db) {
  const [siteSettings, appearanceOptions] = await Promise.all([
    loadSiteSettings(db),
    loadAppearanceOptions(db)
  ]);
  return { ...defaults, ...siteSettings, ...appearanceOptions };
}

// SQLite writes are synchronous so callers can include settings in a transaction.
export function saveSiteOptions(db, updates) {
  const siteRow = db.prepare(
    "SELECT value FROM settings WHERE key = 'site_options'"
  ).first();
  
  const existingSiteOptions = siteRow && siteRow.value
    ? tryParseJSON(siteRow.value) || {}
    : {};
  const siteOptions = { ...existingSiteOptions, ...updates };
  delete siteOptions.show_long_history;
  delete siteOptions.show_time;
  Object.assign(siteOptions, readNotificationConfig(siteOptions));
  siteOptions.long_history_points = normalizeLongHistoryPoints(siteOptions.long_history_points);
  siteOptions.show_three_net_details = normalizeBooleanSetting(siteOptions.show_three_net_details, defaults.show_three_net_details);
  siteOptions.wss_report_enabled = normalizeBooleanSetting(siteOptions.wss_report_enabled, defaults.wss_report_enabled);
  siteOptions.wss_report_hours = normalizeWssReportHours(siteOptions.wss_report_hours);
  siteOptions.frontend_ws_timeout_minutes = normalizeFrontendWsTimeoutMinutes(siteOptions.frontend_ws_timeout_minutes);
  
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind('site_options', JSON.stringify(siteOptions)).run();
  
  clearSiteSettingsCache();
  return siteOptions;
}

export async function getSettingByKey(db, key, returnBoolean = false) {
  const settings = await loadSiteSettings(db);
  if(returnBoolean){
    const value = String(settings[key] ?? '').trim().toLowerCase();
    if(['true', '1', 'yes', 'on'].includes(value)) return true;
    if(['false', '0', 'no', 'off', ''].includes(value)) return false;
  }
  return settings[key];
}

let isDebugEnabled = false;

export function setDebug(debug) {
  isDebugEnabled = debug === 1 || debug === '1' || debug === true;
  if(isDebugEnabled) console.log('DEBUG模式:', isDebugEnabled);
}

export function debug(...args) {
  if (isDebugEnabled) {
    console.debug('[DEBUG]', ...args);
  }
}
