import { DEFAULT_NOTIFICATION_TEMPLATE, normalizeBooleanSetting, normalizeNotificationTemplate, normalizeNotificationWebhookBody, normalizeNotificationWebhookFormat, normalizeNotificationWebhookHeaders, normalizeNotificationWebhookMethod } from '../../shared/notificationConfig.js';
import { NOTIFICATION_MAX_RETRIES, NOTIFICATION_RETRY_DELAY_MS } from '../../utils/config.js';
import { formatNotificationTime } from './time.js';

// Rejected credentials never succeed on retry.
const PERMANENT_HTTP_STATUSES = new Set([401, 403]);
// Business codes meaning the token/URL, bot or message must change before a send can succeed.
// Verified from each channel's documentation and from real responses to invalid tokens.
const PERMANENT_BUSINESS_CODES = Object.freeze({
  feishu: new Set([9499, 19001, 19021, 19022, 19024]),
  dingtalk: new Set([300005, 310000, 400013, 400101, 400102, 400105, 400106, 40035, 43004, 430101, 430102, 430103, 430104]),
  wecom: new Set([93000, 93001, 93004, 93006, 93008, 93017, 93019, 40008, 44004, 45002]),
  serverchan: new Set([40001]),
  wxpusher: new Set([1001, 1002])
});

export class DeliveryFailure extends Error {
  constructor(message, { permanent = false, status = 0 } = {}) {
    super(message);
    this.name = 'DeliveryFailure';
    this.permanent = permanent;
    this.status = status;
  }
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

// Retries network errors, 5xx and 429 only; any other answer is final for this attempt.
async function requestWithRetry(url, options, retries = NOTIFICATION_MAX_RETRIES) {
  for (let i = 0; i < retries; i++) {
    const last = i === retries - 1;
    try {
      const response = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
      if (last || response.ok || (response.status < 500 && response.status !== 429)) return response;
    } catch (e) {
      if (last) throw e;
    }
    await pause(NOTIFICATION_RETRY_DELAY_MS);
  }
  throw new Error('Max retries exceeded');
}

async function readResponseText(response) {
  try { return (await response.text()).slice(0, 4000); } catch { return ''; }
}

function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function httpFailure(response, detail = '') {
  const reason = String(detail || response.statusText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return new DeliveryFailure(`HTTP ${response.status}${reason ? ` ${reason}` : ''}`, {
    permanent: PERMANENT_HTTP_STATUSES.has(response.status), status: response.status
  });
}

async function fetchWithRetry(url, options, retries) {
  const response = await requestWithRetry(url, options, retries);
  if (response.ok) return response;
  const text = await readResponseText(response);
  const body = parseJson(text);
  throw httpFailure(response, body?.description || body?.message || body?.msg || body?.error || text);
}

// Channels that answer HTTP 200 for business errors must be judged by their body.
async function postAndConfirm(channel, url, options, { isSuccess, code, message }) {
  const response = await requestWithRetry(url, options);
  const text = await readResponseText(response);
  const body = parseJson(text);
  if (response.ok && body && isSuccess(body)) return;
  const businessCode = body ? code(body) : undefined;
  if (businessCode === undefined || businessCode === null || businessCode === '') {
    if (!response.ok) throw httpFailure(response, text);
    throw new DeliveryFailure('无效的响应');
  }
  const reason = String(message(body) ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
  throw new DeliveryFailure(`code ${businessCode}${reason ? ` ${reason}` : ''}`, {
    permanent: PERMANENT_BUSINESS_CODES[channel].has(Number(businessCode)) || PERMANENT_HTTP_STATUSES.has(response.status),
    status: response.status
  });
}

// Never echo a token or webhook key back into stored failure reasons.
function redactSecret(text, secret) {
  let result = String(text ?? '');
  for (const part of String(secret || '').split(/[^A-Za-z0-9_-]+/).filter(part => part.length >= 8)) {
    result = result.split(part).join('***');
  }
  return result.slice(0, 500);
}

function deliveryFailure(label, error, secret) {
  return { error: redactSecret(`${label}: ${error?.message || error}`, secret), permanent: error?.permanent === true };
}

// A missing or unrecognised configuration cannot succeed until it is changed.
const configurationFailure = error => ({ error, permanent: true });

function stripMarkdown(value) {
  return String(value || '')
    .replace(/\*\*/g, '')
    .replace(/^[\s✅⚠️⏰💌•-]+/u, '')
    .trim();
}

function inferNotificationEvent(msg) {
  const firstLine = String(msg || '').split('\n').find(line => line.trim());
  return stripMarkdown(firstLine || '通知') || '通知';
}

function escapeJsonStringFragment(value) {
  return JSON.stringify(String(value ?? '')).slice(1, -1);
}

function renderTemplate(template, data, options = {}) {
  const source = String(template || '');
  return source.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, key) => {
    const value = data[key] ?? '';
    return options.jsonString ? escapeJsonStringFragment(value) : String(value);
  });
}

function normalizeNotificationClients(context = {}) {
  const source = Array.isArray(context.clients)
    ? context.clients
    : (context.client ? String(context.client).split(',') : []);
  const clients = source
    .map(client => String(client || '').trim())
    .filter(Boolean);
  if (clients.length > 0) return Array.from(new Set(clients));
  return ['CF Server Monitor'];
}

function inferNotificationEmoji(event) {
  const normalizedEvent = String(event || '');
  if (/恢复|测试|成功/.test(normalizedEvent)) return '✅';
  if (/到期|提醒/.test(normalizedEvent)) return '⚠️';
  if (/离线|告警|失败|异常/.test(normalizedEvent)) return '❌';
  return 'ℹ️';
}

function buildNotificationContext(settings, msg, context = {}) {
  const now = formatNotificationTime(Date.now(), settings);
  const clients = normalizeNotificationClients(context);
  const count = Number.isFinite(Number(context.count)) && Number(context.count) > 0
    ? Number(context.count)
    : clients.length;
  const event = context.event || inferNotificationEvent(msg);
  return {
    title: '💌 Server Monitor',
    event,
    emoji: context.emoji || inferNotificationEmoji(event),
    client: context.client || clients.join(', '),
    clients: clients.join(', '),
    count: String(count),
    message: context.message || String(msg || ''),
    time: context.time || now
  };
}

function formatNotificationMessage(settings, msg, context) {
  const template = normalizeNotificationTemplate(settings?.notification_template || DEFAULT_NOTIFICATION_TEMPLATE);
  return renderTemplate(template, context) || String(msg || '');
}

function parseWebhookHeaders(rawHeaders, context) {
  const raw = renderTemplate(normalizeNotificationWebhookHeaders(rawHeaders), context).trim();
  const headers = {};
  if (!raw) return headers;

  if (raw.startsWith('{')) {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers must be an object');
    }
    for (const [key, value] of Object.entries(parsed)) {
      const normalizedKey = String(key || '').trim();
      if (!normalizedKey || /^(host|content-length)$/i.test(normalizedKey)) continue;
      headers[normalizedKey] = String(value ?? '');
    }
    return headers;
  }

  for (const line of raw.split(/\r?\n/)) {
    const index = line.indexOf(':');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    if (!key || /^(host|content-length)$/i.test(key)) continue;
    headers[key] = line.slice(index + 1).trim();
  }
  return headers;
}

function buildWebhookQueryParams(settings, context) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  try {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.entries(parsed).map(([key, value]) => [key, String(value ?? '')]);
    }
  } catch (_) {}

  const params = new URLSearchParams(renderTemplate(rawBody, context));
  return Array.from(params.entries());
}

function buildWebhookUrl(settings, context, method) {
  const rawUrl = settings.notification_webhook_url;
  const renderedUrl = renderTemplate(String(rawUrl || '').trim(), context);
  if (!renderedUrl) throw new Error('missing webhook url');

  const url = new URL(renderedUrl);
  if (method === 'GET') {
    for (const [key, value] of buildWebhookQueryParams(settings, context)) {
      if (!key) continue;
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildWebhookBody(settings, context, format) {
  const rawBody = normalizeNotificationWebhookBody(settings.notification_webhook_body);
  if (format === 'json') {
    const body = renderTemplate(rawBody, context, { jsonString: true });
    return JSON.stringify(JSON.parse(body));
  }
  if (format === 'form') {
    try {
      const body = renderTemplate(rawBody, context, { jsonString: true });
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(parsed)) {
          params.set(key, String(value ?? ''));
        }
        return params.toString();
      }
    } catch (_) {}
  }
  return renderTemplate(rawBody, context);
}

async function sendCustomWebhookNotification(settings, context) {
  const method = normalizeNotificationWebhookMethod(settings.notification_webhook_method);
  const format = normalizeNotificationWebhookFormat(settings.notification_webhook_format);
  const endpoint = buildWebhookUrl(settings, context, method);
  const headers = parseWebhookHeaders(settings.notification_webhook_headers, context);
  const options = { method, headers };

  if (method !== 'GET') {
    const contentTypeHeader = Object.keys(headers).find(key => key.toLowerCase() === 'content-type');
    if (!contentTypeHeader) {
      headers['Content-Type'] = format === 'json'
        ? 'application/json'
        : (format === 'form' ? 'application/x-www-form-urlencoded' : 'text/plain; charset=utf-8');
    }
    options.body = buildWebhookBody(settings, context, format);
  }

  await fetchWithRetry(endpoint, options);
}

export function hasNotificationTarget(settings) {
  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    return String(settings?.notification_webhook_url || '').trim().length > 0;
  }
  return String(settings?.tg_bot_token || '').trim().length > 0;
}

async function sendToTarget(settings, msg, notificationContext = {}) {
  const context = buildNotificationContext(settings || {}, msg, notificationContext);
  const formattedMsg = formatNotificationMessage(settings || {}, msg, context);
  context.notification = formattedMsg;
  const title = context.title;

  if (normalizeBooleanSetting(settings?.notification_webhook_enabled) === 'true') {
    if (!String(settings?.notification_webhook_url || '').trim()) return configurationFailure("自定义 Webhook 通知失败: 缺少 URL");
    try {
      await sendCustomWebhookNotification(settings, context);
      return;
    } catch (e) {
      return deliveryFailure("自定义 Webhook 通知发送失败", e, settings.notification_webhook_url);
    }
  }

  if(!settings.tg_bot_token) return;
  if(settings.tg_bot_token.indexOf("onebot:") == 0) {
    // OneBot 协议 (QQ 等)，私聊格式: onebot:http://127.0.0.1:3000/send_private_msg?access_token=xxx
    // 群聊格式: onebot:http://127.0.0.1:3000/send_group_msg?access_token=xxx
    let onebotUrl = settings.tg_bot_token.replace("onebot:", "");
    const targetId = settings.tg_chat_id || '';
    const isGroup = onebotUrl.indexOf("send_group_msg") != -1;
    if (!targetId) {
      return configurationFailure("OneBot 通知失败: 缺少 tg_chat_id（私人: QQ号，群: group:群号）");
    }
    try {
      const endpoint = onebotUrl.trim();
      const body = {
        [isGroup ? 'group_id' : 'user_id']: targetId,
        message: [
          {
            type: 'text',
            data: {
              text: `${title}\n${String(formattedMsg || '').replace(/\*/g, '')}\n`
            }
          }
        ]
      };
      const response = await fetchWithRetry(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('Invalid OneBot delivery response'); }
      if (result?.status !== 'ok' || result.retcode !== 0) {
        const code = Number.isSafeInteger(result?.retcode) ? result.retcode : 'invalid';
        throw new Error(`OneBot did not confirm delivery (retcode ${code})`);
      }
    } catch (e) {
      return deliveryFailure("OneBot 通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("open.feishu.cn")) {
    // 飞书机器人 Webhook
    try {
      await postAndConfirm('feishu', settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          msg_type: "interactive",
          card: {
            schema: "2.0",
            header: { template: "blue", title: { content: title, tag: "plain_text" } },
            body: { elements: [{ tag: "markdown", content: formattedMsg }] }
          }
        })
      }, {
        isSuccess: body => (body.code ?? body.StatusCode) === 0,
        code: body => body.code ?? body.StatusCode,
        message: body => body.msg ?? body.StatusMessage
      });
    } catch (e) {
      return deliveryFailure("飞书通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("oapi.dingtalk.com") || settings.tg_bot_token.includes("api.dingtalk.com")) {
    // 钉钉机器人 Webhook
    try {
      await postAndConfirm('dingtalk', settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "markdown",
          markdown: { title: title, text: formattedMsg }
        })
      }, { isSuccess: body => body.errcode === 0, code: body => body.errcode, message: body => body.errmsg });
    } catch (e) {
      return deliveryFailure("钉钉通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("https://api.day.app/") || settings.tg_bot_token.indexOf("bark:") == 0) {
    let barkUrl = settings.tg_bot_token;
    if(barkUrl.indexOf("bark:") == 0) {
      barkUrl = barkUrl.replace("bark:", "");
    }
    try {
      await fetchWithRetry(barkUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          markdown: formattedMsg,
          group: "Server Monitor"
        })
      });
    } catch (e) {
      return deliveryFailure("Bark通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("https://qyapi.weixin.qq.com")){
    try {
      await postAndConfirm('wecom', settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          msgtype: "text",
          text: {
            content: formattedMsg.replace(/\*/g, '')
          }
        })
      }, { isSuccess: body => body.errcode === 0, code: body => body.errcode, message: body => body.errmsg });
    } catch (e) {
      return deliveryFailure("企业微信通知发送失败", e, settings.tg_bot_token);
    }
  // Server 酱（使用 sendkey）
  }else if(settings.tg_bot_token.includes("https://sctapi.ftqq.com/") || settings.tg_bot_token.indexOf("server:") == 0) {
    let serverUrl = settings.tg_bot_token;
    if(serverUrl.indexOf("server:") == 0) {
      serverUrl = serverUrl.replace("server:", "");
    }
    try {
      await postAndConfirm('serverchan', serverUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          desp: formattedMsg
        })
      }, { isSuccess: body => body.code === 0, code: body => body.code, message: body => body.message ?? body.info });
    } catch (e) {
      return deliveryFailure("Server酱通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("https://wxpusher.zjiecode.com/api/send/message/SPT_")) {
    const match = settings.tg_bot_token.match(/\/message\/([^/]+)/);
    const spt = match ? match[1] : null;
    if (!spt) return configurationFailure("WxPusher 通知失败: 无法提取 SPT");
    try {
      // 1000 only means accepted; a recipient list where every entry failed is not a send.
      const rejected = body => Array.isArray(body.data) && body.data.length > 0 && body.data.every(target => target?.code !== 1000);
      await postAndConfirm('wxpusher', "https://wxpusher.zjiecode.com/api/send/message/simple-push", {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          "content": formattedMsg,
          "summary": title,
          "contentType":3,
          "spt": spt,
        })
      }, {
        isSuccess: body => body.code === 1000 && body.success !== false && !rejected(body),
        code: body => (body.code !== 1000 ? body.code : body.data?.find(target => target?.code !== 1000)?.code),
        message: body => (body.code !== 1000 ? body.msg : body.data?.find(target => target?.code !== 1000)?.status)
      });
    } catch (e) {
      return deliveryFailure("WxPusher通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_bot_token.includes("/message?token=")) {
    try {
      await fetchWithRetry(settings.tg_bot_token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title,
          message: formattedMsg,
          priority: 5,
          extras: {
            "client::display": { "contentType": "text/markdown" }
          }
        })
      });
    } catch (e) {
      return deliveryFailure("Gotify通知发送失败", e, settings.tg_bot_token);
    }
  }else if(settings.tg_chat_id) {
    // Telegram Bot (最后 fallback，通过 chat_id 判断)
    try {
      await fetchWithRetry(`https://api.telegram.org/bot${settings.tg_bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.tg_chat_id,
          text: formattedMsg
        })
      });
    } catch (e) {
      // 404 is an unknown bot token, 400 a wrong chat_id or rejected message.
      if (e instanceof DeliveryFailure && (e.status === 400 || e.status === 404)) e.permanent = true;
      return deliveryFailure("Telegram 通知发送失败", e, settings.tg_bot_token);
    }
  }else {
    return configurationFailure("未知的通知方式");
  }
}

// Only an actual successful send may consume an outbox row.
export async function sendNotification(settings, msg, context = {}) {
  if (!hasNotificationTarget(settings)) return { status: 'unconfigured' };
  try {
    const failure = await sendToTarget(settings, msg, context);
    if (!failure) return { status: 'delivered' };
    const { error, permanent } = typeof failure === 'string' ? { error: failure, permanent: false } : failure;
    // permanent: retrying with the same configuration cannot succeed.
    return permanent ? { status: 'failed', error, permanent: true } : { status: 'failed', error };
  } catch (error) {
    return { status: 'failed', error: error.message };
  }
}
