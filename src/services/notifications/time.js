import { normalizeNotificationTimezone, normalizeExpireNotificationTime } from '../../utils/settings.js';
const DAY_MS = 86400000;

export function getZonedDateParts(timestamp = Date.now(), timezone = 'UTC') {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  const timeZone = normalizeNotificationTimezone(timezone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(part => [part.type, part.value])
  );
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  };
}

export function formatNotificationTime(timestamp = Date.now(), settings = {}) {
  const parts = getZonedDateParts(timestamp, settings?.notification_timezone);
  if (!parts) return '无效时间';
  const pad = value => String(value).padStart(2, '0');
  return `${Number(parts.year)}/${Number(parts.month)}/${Number(parts.day)} ` +
    `${pad(parts.hour)}:${pad(parts.minute)}:${pad(parts.second)}`;
}

export function formatLastReportTime(timestamp, settings = {}) {
  if (!timestamp) return '无上报记录';

  return formatNotificationTime(timestamp, settings);
}

export function isExpireNotificationTimeDue(settings = {}, timestamp = Date.now()) {
  const parts = getZonedDateParts(timestamp, settings.notification_timezone);
  if (!parts) return false;
  return Number(parts.hour) >= Number(normalizeExpireNotificationTime(settings.expire_notification_time));
}

export function getZonedDateSerial(timestamp, timezone) {
  const parts = getZonedDateParts(timestamp, timezone);
  if (!parts) return NaN;
  return Math.floor(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / DAY_MS);
}

export function parseDateSerial(dateString) {
  const match = String(dateString || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return NaN;
  }
  return Math.floor(date.getTime() / DAY_MS);
}

export function formatDateSerial(serial) {
  const date = new Date(serial * DAY_MS);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
