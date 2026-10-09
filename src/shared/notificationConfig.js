// Shared notification configuration. No storage, credentials lookup or network effects.
export const TG_NOTIFY_MINUTES_MIN = 2;
export const TG_NOTIFY_MINUTES_MAX = 30;
export const TG_NOTIFY_LEGACY_TRUE_MINUTES = 5;
export const EXPIRE_REMINDER_DAYS_MAX = 7;
export const DEFAULT_NOTIFICATION_TIMEZONE = 'UTC';
export const DEFAULT_EXPIRE_NOTIFICATION_TIME = '12';
export const RESOURCE_ALERT_WINDOW_MIN = 5;
export const RESOURCE_ALERT_WINDOW_MAX = 10;
export const RESOURCE_ALERT_MODE_CONTINUOUS = 'continuous';
export const RESOURCE_ALERT_MODE_AVERAGE = 'average';
export const RESOURCE_ALERT_RULES_MAX = 20;
export const DEFAULT_NOTIFICATION_TEMPLATE = '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n{{time}}';
export const DEFAULT_NOTIFICATION_WEBHOOK_BODY = '{\n  "title": "{{emoji}} {{event}}",\n  "content": "{{notification}}"\n}';
const LEGACY_DEFAULT_NOTIFICATION_TEMPLATES = [
  '{{emoji}}【CF Server Monitor】{{event}}\n\n{{message}}\n\n时间: {{time}}',
  '{{emoji}}【CF Server Monitor】{{event}}\n服务器: {{client}}\n详情:\n{{message}}\n时间: {{time}}',
  '事件: {{event}}\n服务名: {{client}}\n消息: {{message}}\n时间: {{time}}',
  '【CF Server Monitor】{{event}}\n服务器: {{client}}\n数量: {{count}}\n详情:\n{{message}}\n时间: {{time}}',
  '{{emoji}}【CF Server Monitor】{{event}}\n服务器: {{client}}\n数量: {{count}}\n详情:\n{{message}}\n时间: {{time}}'
];
const LEGACY_DEFAULT_NOTIFICATION_WEBHOOK_BODIES = [
  '{\n  "event": "{{event}}",\n  "client": "{{client}}",\n  "message": "{{message}}",\n  "time": "{{time}}"\n}',
  '{\n  "title": "{{title}}",\n  "event": "{{event}}",\n  "client": "{{client}}",\n  "clients": "{{clients}}",\n  "count": "{{count}}",\n  "message": "{{message}}",\n  "notification": "{{notification}}",\n  "time": "{{time}}"\n}',
  '{\n  "title": "{{event}}",\n  "content": "{{notification}}"\n}'
];
export const NOTIFICATION_WEBHOOK_METHODS = ['GET', 'POST'];
export const NOTIFICATION_WEBHOOK_FORMATS = ['json', 'form', 'text'];
export const RESOURCE_ALERT_METRIC_CPU = 'cpu';
export const RESOURCE_ALERT_METRIC_RAM = 'ram';
export const RESOURCE_ALERT_METRIC_DISK = 'disk';
export const RESOURCE_ALERT_METRIC_NET_IN = 'netIn';
export const RESOURCE_ALERT_METRIC_NET_OUT = 'netOut';
export const RESOURCE_ALERT_METRICS = [
  RESOURCE_ALERT_METRIC_CPU,
  RESOURCE_ALERT_METRIC_RAM,
  RESOURCE_ALERT_METRIC_DISK,
  RESOURCE_ALERT_METRIC_NET_IN,
  RESOURCE_ALERT_METRIC_NET_OUT
];
const BYTES_PER_MEGABIT = 1000 * 1000 / 8;

export function normalizeBooleanSetting(value, fallback = 'false') {
  if (value === true || value === 1) return 'true';
  if (value === false || value === 0) return 'false';
  if (value === null || value === undefined || value === '') {
    return fallback === 'true' ? 'true' : 'false';
  }

  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return 'true';
  if (['false', '0', 'no', 'off'].includes(normalized)) return 'false';
  return fallback === 'true' ? 'true' : 'false';
}

export function normalizeTgNotify(value) {
  if (value === true || value === 'true') return String(TG_NOTIFY_LEGACY_TRUE_MINUTES);
  if (
    value === false ||
    value === 'false' ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '0';
  }

  const minutes = Number(value);
  if (
    Number.isInteger(minutes) &&
    (minutes === 0 || (minutes >= TG_NOTIFY_MINUTES_MIN && minutes <= TG_NOTIFY_MINUTES_MAX))
  ) {
    return String(minutes);
  }

  return '0';
}

export function getTgNotifyMinutes(value) {
  return Number(normalizeTgNotify(value));
}

export function normalizeExpireReminder(value) {
  if (value === true || value === 'true') return String(EXPIRE_REMINDER_DAYS_MAX);
  if (
    value === false ||
    value === 'false' ||
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return '0';
  }

  const days = Number(value);
  if (Number.isInteger(days) && days >= 0 && days <= EXPIRE_REMINDER_DAYS_MAX) {
    return String(days);
  }

  return '0';
}

export function getExpireReminderDays(value) {
  return Number(normalizeExpireReminder(value));
}

export function normalizeNotificationTimezone(value) {
  const timezone = String(value || '').trim();
  if (!timezone || timezone.length > 64) return DEFAULT_NOTIFICATION_TIMEZONE;

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
    return timezone;
  } catch (_) {
    return DEFAULT_NOTIFICATION_TIMEZONE;
  }
}

export function normalizeExpireNotificationTime(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return DEFAULT_EXPIRE_NOTIFICATION_TIME;
  const legacyTimeMatch = raw.match(/^([01]?\d|2[0-3]):[0-5]\d$/);
  const hour = Number(legacyTimeMatch ? legacyTimeMatch[1] : raw);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? String(hour)
    : DEFAULT_EXPIRE_NOTIFICATION_TIME;
}

export function normalizeNotificationWebhookMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  return NOTIFICATION_WEBHOOK_METHODS.includes(method) ? method : 'POST';
}

export function normalizeNotificationWebhookFormat(value) {
  const format = String(value || '').trim().toLowerCase();
  return NOTIFICATION_WEBHOOK_FORMATS.includes(format) ? format : 'json';
}

export function normalizeNotificationWebhookHeaders(value) {
  return String(value || '').slice(0, 4000);
}

export function normalizeNotificationWebhookBody(value) {
  const body = String(value || '').trim();
  if (LEGACY_DEFAULT_NOTIFICATION_WEBHOOK_BODIES.includes(body)) {
    return DEFAULT_NOTIFICATION_WEBHOOK_BODY;
  }
  return (body || DEFAULT_NOTIFICATION_WEBHOOK_BODY).slice(0, 8000);
}

export function normalizeNotificationTemplate(value) {
  const template = String(value || '').trim();
  if (LEGACY_DEFAULT_NOTIFICATION_TEMPLATES.includes(template)) {
    return DEFAULT_NOTIFICATION_TEMPLATE;
  }
  return (template || DEFAULT_NOTIFICATION_TEMPLATE).slice(0, 4000);
}

export function normalizeResourceAlertWindowMinutes(value) {
  const minutes = Number(value);
  if (
    Number.isInteger(minutes) &&
    (minutes === 0 || (minutes >= RESOURCE_ALERT_WINDOW_MIN && minutes <= RESOURCE_ALERT_WINDOW_MAX))
  ) {
    return String(minutes);
  }
  return '0';
}

export function normalizeResourceAlertIntervalMinutes(value) {
  const normalized = normalizeResourceAlertWindowMinutes(value);
  return normalized === '0' ? String(RESOURCE_ALERT_WINDOW_MIN) : normalized;
}

export function normalizeResourceAlertPercent(value) {
  if (value === undefined || value === null || value === '') return '0';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100) return '0';
  return String(Math.round(number * 100) / 100);
}

export function normalizeResourceAlertMbps(value) {
  if (value === undefined || value === null || value === '') return '0';
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 100000) return '0';
  return String(Math.round(number * 100) / 100);
}

export function normalizeResourceAlertMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === RESOURCE_ALERT_MODE_CONTINUOUS
    ? RESOURCE_ALERT_MODE_CONTINUOUS
    : RESOURCE_ALERT_MODE_AVERAGE;
}

export function normalizeResourceAlertMetric(value) {
  const metric = String(value || '').trim();
  return RESOURCE_ALERT_METRICS.includes(metric) ? metric : RESOURCE_ALERT_METRIC_CPU;
}

function parseResourceAlertRulesValue(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }
  return [];
}

function hasExplicitResourceAlertRulesValue(value) {
  if (Array.isArray(value)) return true;
  return typeof value === 'string' && value.trim() !== '';
}

function normalizeResourceAlertRuleId(value, index) {
  const id = String(value || '').trim().replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 64);
  return id || `rule_${index + 1}`;
}

function normalizeResourceAlertRuleName(value, metric, index) {
  const name = String(value || '').trim().slice(0, 80);
  if (name) return name;
  const labels = {
    [RESOURCE_ALERT_METRIC_CPU]: 'CPU',
    [RESOURCE_ALERT_METRIC_RAM]: 'RAM',
    [RESOURCE_ALERT_METRIC_DISK]: 'DISK',
    [RESOURCE_ALERT_METRIC_NET_IN]: 'NET In',
    [RESOURCE_ALERT_METRIC_NET_OUT]: 'NET Out'
  };
  return `${labels[metric] || 'Resource'} Alert ${index + 1}`;
}

function normalizeResourceAlertServers(value) {
  const source = Array.isArray(value)
    ? value
    : (Array.isArray(value?.servers) ? value.servers : []);
  const seen = new Set();
  const servers = [];
  for (const item of source) {
    const id = String(item || '').trim();
    if (!id || id.length > 64 || !/^[A-Za-z0-9._:-]+$/.test(id) || seen.has(id)) continue;
    seen.add(id);
    servers.push(id);
  }
  return servers.slice(0, 1000);
}

function getDefaultResourceAlertThreshold(metric) {
  return metric === RESOURCE_ALERT_METRIC_NET_IN || metric === RESOURCE_ALERT_METRIC_NET_OUT
    ? '100'
    : '80';
}

export function normalizeResourceAlertThreshold(value, metric) {
  const fallback = getDefaultResourceAlertThreshold(metric);
  const normalized = metric === RESOURCE_ALERT_METRIC_NET_IN || metric === RESOURCE_ALERT_METRIC_NET_OUT
    ? normalizeResourceAlertMbps(value)
    : normalizeResourceAlertPercent(value);
  return Number(normalized) > 0 ? normalized : fallback;
}

export function normalizeResourceAlertRule(rule, index = 0) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
  const metric = normalizeResourceAlertMetric(rule.metric);
  const intervalMinutes = normalizeResourceAlertIntervalMinutes(
    rule.intervalMinutes ?? rule.windowMinutes ?? rule.interval ?? rule.minutes
  );

  return {
    id: normalizeResourceAlertRuleId(rule.id, index),
    name: normalizeResourceAlertRuleName(rule.name, metric, index),
    metric,
    threshold: normalizeResourceAlertThreshold(rule.threshold, metric),
    servers: normalizeResourceAlertServers(rule.servers ?? rule.serverIds),
    intervalMinutes,
    mode: normalizeResourceAlertMode(rule.mode)
  };
}

export function normalizeResourceAlertRules(value) {
  const explicitRulesValue = hasExplicitResourceAlertRulesValue(value);
  const source = parseResourceAlertRulesValue(value);
  const seenIds = new Set();
  const rules = source
    .slice(0, RESOURCE_ALERT_RULES_MAX)
    .map((rule, index) => normalizeResourceAlertRule(rule, index))
    .filter(Boolean)
    .map((rule, index) => {
      let id = rule.id;
      if (seenIds.has(id)) {
        const suffix = `_${index + 1}`;
        id = `${id.slice(0, Math.max(0, 64 - suffix.length))}${suffix}`;
        let attempt = index + 1;
        while (seenIds.has(id)) {
          attempt += 1;
          const nextSuffix = `_${attempt}`;
          id = `${rule.id.slice(0, Math.max(0, 64 - nextSuffix.length))}${nextSuffix}`;
        }
      }
      seenIds.add(id);
      return { ...rule, id };
    });

  if (rules.length > 0 || explicitRulesValue) return rules;
  return [];
}

export function getResourceAlertRuleThresholds(rule) {
  const metric = normalizeResourceAlertMetric(rule?.metric);
  const threshold = Number(normalizeResourceAlertThreshold(rule?.threshold, metric));
  return {
    cpuPercent: metric === RESOURCE_ALERT_METRIC_CPU ? threshold : 0,
    ramPercent: metric === RESOURCE_ALERT_METRIC_RAM ? threshold : 0,
    diskPercent: metric === RESOURCE_ALERT_METRIC_DISK ? threshold : 0,
    netInBps: metric === RESOURCE_ALERT_METRIC_NET_IN ? threshold * BYTES_PER_MEGABIT : 0,
    netOutBps: metric === RESOURCE_ALERT_METRIC_NET_OUT ? threshold * BYTES_PER_MEGABIT : 0,
    netTotalBps: 0
  };
}

export function getResourceAlertConfig(settings = {}) {
  const rules = normalizeResourceAlertRules(settings.resource_alert_rules, settings);

  return {
    enabled: rules.length > 0,
    rules,
    hasRules: rules.length > 0
  };
}

export const NOTIFICATION_FIELDS = Object.freeze([
  'tg_notify', 'expire_reminder', 'resource_alert_rules', 'tg_bot_token', 'tg_chat_id',
  'notification_timezone', 'expire_notification_time', 'traffic_report_enabled',
  'notification_webhook_enabled', 'notification_webhook_url', 'notification_webhook_method',
  'notification_webhook_format', 'notification_webhook_headers', 'notification_webhook_body',
  'notification_template'
]);
const TARGET_FIELDS = new Set(['tg_bot_token', 'tg_chat_id', 'notification_webhook_url']);
const TEST_FIELDS = new Set(NOTIFICATION_FIELDS.filter(field => ![
  'tg_notify', 'expire_reminder', 'resource_alert_rules', 'traffic_report_enabled'
].includes(field)));

/** Read persisted or legacy values without changing the source or selector meaning. */
export function readNotificationConfig(stored = {}) {
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) stored = {};
  return {
    tg_notify: normalizeTgNotify(stored.tg_notify),
    expire_reminder: normalizeExpireReminder(stored.expire_reminder),
    resource_alert_rules: normalizeResourceAlertRules(stored.resource_alert_rules),
    tg_bot_token: stored.tg_bot_token ?? '',
    tg_chat_id: stored.tg_chat_id ?? '',
    notification_timezone: normalizeNotificationTimezone(stored.notification_timezone),
    expire_notification_time: normalizeExpireNotificationTime(stored.expire_notification_time),
    traffic_report_enabled: normalizeBooleanSetting(stored.traffic_report_enabled),
    notification_webhook_enabled: normalizeBooleanSetting(stored.notification_webhook_enabled),
    notification_webhook_url: stored.notification_webhook_url ?? '',
    notification_webhook_method: normalizeNotificationWebhookMethod(stored.notification_webhook_method),
    notification_webhook_format: normalizeNotificationWebhookFormat(stored.notification_webhook_format),
    notification_webhook_headers: normalizeNotificationWebhookHeaders(stored.notification_webhook_headers),
    notification_webhook_body: normalizeNotificationWebhookBody(stored.notification_webhook_body),
    notification_template: normalizeNotificationTemplate(stored.notification_template)
  };
}

export function getResourceAlertThresholdMax(metric) {
  return metric === RESOURCE_ALERT_METRIC_NET_IN || metric === RESOURCE_ALERT_METRIC_NET_OUT ? 100000 : 100;
}

function isValidTimezone(value) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value.trim() }).format(new Date(0));
    return true;
  } catch { return false; }
}

function isIntegerValue(value, min, max) {
  return (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value.trim())))
    && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max;
}

function validateRules(value, issues) {
  let source = value;
  if (typeof source === 'string') {
    try { source = JSON.parse(source); } catch { source = null; }
  }
  const issue = (code, index, field) => issues.push({ code, field: 'resource_alert_rules', index, ruleField: field });
  if (!Array.isArray(source)) { issue('invalidResourceAlertRules'); return; }
  if (source.length > RESOURCE_ALERT_RULES_MAX) { issue('resourceAlertRulesLimit'); return; }
  source.forEach((rule, index) => {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) { issue('invalidResourceAlertRules', index); return; }
    const metric = rule.metric === undefined ? RESOURCE_ALERT_METRIC_CPU : rule.metric;
    if (!RESOURCE_ALERT_METRICS.includes(metric)) issue('invalidResourceAlertRules', index, 'metric');
    if (rule.threshold !== undefined) {
      const max = getResourceAlertThresholdMax(metric);
      const threshold = Number(rule.threshold);
      if (!['string', 'number'].includes(typeof rule.threshold) || !Number.isFinite(threshold)
        || threshold > max || Math.round(threshold * 100) <= 0) issue('invalidResourceAlertThreshold', index, 'threshold');
    }
    const interval = [rule.intervalMinutes, rule.windowMinutes, rule.interval, rule.minutes].find(value => value !== undefined);
    if (interval !== undefined && !isIntegerValue(interval, RESOURCE_ALERT_WINDOW_MIN, RESOURCE_ALERT_WINDOW_MAX)) {
      issue('invalidResourceAlertRules', index, 'intervalMinutes');
    }
    if (rule.mode !== undefined && ![RESOURCE_ALERT_MODE_AVERAGE, RESOURCE_ALERT_MODE_CONTINUOUS].includes(String(rule.mode).trim().toLowerCase())) {
      issue('invalidResourceAlertRules', index, 'mode');
    }
    let servers = rule.servers === undefined ? rule.serverIds : rule.servers;
    if (servers !== undefined) {
      if (!Array.isArray(servers)) servers = servers?.servers;
      if (!Array.isArray(servers) || servers.length > 1000 || servers.some(id =>
        typeof id !== 'string' || !id.trim() || id.trim().length > 64 || !/^[A-Za-z0-9._:-]+$/.test(id.trim())
      )) issue('invalidResourceAlertRules', index, 'servers');
    }
  });
}

/** Validate raw edits before fallback; form the effective config and only touched fields. */
export function prepareNotificationConfig({ current = {}, input = {}, intent = 'save' } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || !['save', 'test'].includes(intent)) {
    return { ok: false, issues: [{ code: 'invalidNotificationConfig' }] };
  }
  const changes = {};
  const issues = [];
  for (const field of NOTIFICATION_FIELDS) {
    if (input[field] === undefined || (intent === 'test' && !TEST_FIELDS.has(field))) continue;
    const value = input[field];
    changes[field] = value;
    const reject = code => issues.push({ code, field });
    if (field === 'notification_timezone' && !isValidTimezone(value)) reject('invalidNotificationTimezone');
    else if (field === 'expire_notification_time' && !isIntegerValue(value, 0, 23)) reject('invalidExpireNotificationTime');
    else if (field === 'resource_alert_rules') validateRules(value, issues);
    else if (field === 'tg_notify' || field === 'expire_reminder') {
      const legacy = [true, false, 'true', 'false', '', null].includes(value);
      const max = field === 'tg_notify' ? TG_NOTIFY_MINUTES_MAX : EXPIRE_REMINDER_DAYS_MAX;
      if (!legacy && (!isIntegerValue(value, 0, max) || (field === 'tg_notify' && Number(value) === 1))) reject('invalidNotificationConfig');
    } else if (field === 'notification_webhook_method' && (typeof value !== 'string' || !NOTIFICATION_WEBHOOK_METHODS.includes(value.trim().toUpperCase()))) reject('invalidNotificationConfig');
    else if (field === 'notification_webhook_format' && (typeof value !== 'string' || !NOTIFICATION_WEBHOOK_FORMATS.includes(value.trim().toLowerCase()))) reject('invalidNotificationConfig');
    else if (['traffic_report_enabled', 'notification_webhook_enabled'].includes(field)
      && ![true, false, 1, 0, 'true', 'false', '1', '0', 'yes', 'no', 'on', 'off'].includes(typeof value === 'string' ? value.trim().toLowerCase() : value)) reject('invalidNotificationConfig');
    else if ((TARGET_FIELDS.has(field) || ['notification_webhook_headers', 'notification_webhook_body', 'notification_template'].includes(field))
      && typeof value !== 'string') reject('invalidNotificationConfig');
  }
  if (issues.length) return { ok: false, issues };
  const config = readNotificationConfig({ ...readNotificationConfig(current), ...changes });
  const enabled = config.tg_notify !== '0' || config.expire_reminder !== '0'
    || config.resource_alert_rules.length > 0 || config.traffic_report_enabled === 'true';
  if (intent === 'test' || enabled) {
    const webhook = config.notification_webhook_enabled === 'true';
    const field = webhook ? 'notification_webhook_url' : 'tg_bot_token';
    if (typeof config[field] !== 'string' || !config[field].trim()) {
      return { ok: false, issues: [{ code: webhook ? 'notificationWebhookUrlRequired' : 'tgBotTokenRequired', field }] };
    }
  }
  const patch = Object.fromEntries(Object.keys(changes).map(field => [field, config[field]]));
  return { ok: true, config, patch, issues: [] };
}
