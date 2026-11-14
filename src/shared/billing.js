const BILLING_CYCLES = Object.freeze([
  { value: 'month', months: 1 },
  { value: 'quarter', months: 3 },
  { value: 'half_year', months: 6 },
  { value: 'year', months: 12 },
  { value: 'two_years', months: 24 },
  { value: 'three_years', months: 36 },
  { value: 'four_years', months: 48 },
  { value: 'five_years', months: 60 }
]);

const CURRENCY_OPTIONS = Object.freeze([
  // 主流货币
  { symbol: '$' },
  { symbol: '¥' },
  { symbol: '€' },
  { symbol: '£' },
  { symbol: '¥JPY' },
  { symbol: 'HK$' },
  { symbol: 'A$' },
  { symbol: 'C$' },
  { symbol: 'S$' },
  { symbol: 'NZ$' },
  { symbol: '₣' },
  { symbol: '₩' },
  { symbol: '₹' },
  // 亚太货币
  { symbol: '฿' },
  { symbol: '₫' },
  { symbol: '₱' },
  { symbol: 'Rp' },
  { symbol: 'RM' },
  { symbol: '₺' },
  { symbol: '₪' },
  { symbol: '৳' },
  { symbol: '₨' },
  { symbol: 'LKR' },
  { symbol: '₮' },
  // 其他地区
  { symbol: '₽' },
  { symbol: 'R$' },
  { symbol: 'kr' },
  { symbol: 'zł' },
  { symbol: '₴' },
  { symbol: '₸' },
  { symbol: 'R' },
  { symbol: '₦' },
  { symbol: 'EGP' },
  { symbol: 'د.إ' },
  { symbol: '﷼' },
  { symbol: 'Q' }
]);

const CYCLE_ALIASES = new Map([
  ['月', 'month'],
  ['monthly', 'month'],
  ['month', 'month'],
  ['mo', 'month'],
  ['季', 'quarter'],
  ['季度', 'quarter'],
  ['quarter', 'quarter'],
  ['quarterly', 'quarter'],
  ['半年', 'half_year'],
  ['halfyear', 'half_year'],
  ['half_year', 'half_year'],
  ['half-yearly', 'half_year'],
  ['年', 'year'],
  ['一年', 'year'],
  ['year', 'year'],
  ['yearly', 'year'],
  ['annual', 'year'],
  ['两年', 'two_years'],
  ['二年', 'two_years'],
  ['two_years', 'two_years'],
  ['2 years', 'two_years'],
  ['三年', 'three_years'],
  ['three_years', 'three_years'],
  ['3 years', 'three_years'],
  ['四年', 'four_years'],
  ['four_years', 'four_years'],
  ['4 years', 'four_years'],
  ['五年', 'five_years'],
  ['five_years', 'five_years'],
  ['5 years', 'five_years']
]);

const NORMALIZED_CURRENCIES = new Set(CURRENCY_OPTIONS.map(item => item.symbol));

export function normalizePrice(value) {
  if (value === null || value === undefined) return '';

  const raw = String(value).trim();
  if (!raw) return '';

  const numberText = raw.match(/-?[\d.,]+/)?.[0];
  if (!numberText) return '';

  const normalized = numberText.replace(/,/g, '');
  const num = Number.parseFloat(normalized);
  if (!Number.isFinite(num)) return '';
  if (num < 0) return '';

  return num.toFixed(2);
}

export function normalizeCurrency(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Normalize common variants
  const normalized = raw === '￥' ? '¥' : raw;

  // Try matching multi-char symbols first (HK$, A$, C$, S$, NZ$, R$, RM, zł)
  for (const item of CURRENCY_OPTIONS) {
    if (item.symbol.length > 1 && normalized.startsWith(item.symbol)) {
      return item.symbol;
    }
  }

  // Fallback to single-char match
  const symbol = normalized[0];
  return NORMALIZED_CURRENCIES.has(symbol) ? symbol : '';
}

export function detectCurrencySymbol(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.includes('￥')) return '¥';

  // Try matching multi-char symbols first (HK$, A$, C$, S$, NZ$, R$, RM, zł)
  for (const item of CURRENCY_OPTIONS) {
    if (item.symbol.length > 1 && raw.includes(item.symbol)) {
      return item.symbol;
    }
  }

  // Fallback to single-char match
  return CURRENCY_OPTIONS.find(item => item.symbol.length === 1 && raw.includes(item.symbol))?.symbol || '';
}

export function detectBillingCycle(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';

  if (/五年|5\s*(y|yr|yrs|year|years)/i.test(raw)) return 'five_years';
  if (/四年|4\s*(y|yr|yrs|year|years)/i.test(raw)) return 'four_years';
  if (/三年|3\s*(y|yr|yrs|year|years)/i.test(raw)) return 'three_years';
  if (/(两年|二年)|2\s*(y|yr|yrs|year|years)/i.test(raw)) return 'two_years';
  if (/半年|half[-_\s]?year/i.test(raw)) return 'half_year';
  if (/季|quarter|\/q\b/i.test(raw)) return 'quarter';
  if (/年|annual|year|yr\b|\/y\b/i.test(raw)) return 'year';
  if (/月|monthly|month|mo\b|\/m\b/i.test(raw)) return 'month';

  return '';
}

export function normalizeBillingCycle(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'month';

  const direct = BILLING_CYCLES.find(item => item.value === raw);
  if (direct) return direct.value;

  return CYCLE_ALIASES.get(raw.toLowerCase()) || 'month';
}

function getBillingCycleOption(value) {
  const normalized = normalizeBillingCycle(value);
  return BILLING_CYCLES.find(item => item.value === normalized) || BILLING_CYCLES[0];
}

export function isEnabledFlag(value) {
  return value === true || value === 1 || value === '1' || value === 'true';
}

function parseDateOnly(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

function daysInUtcMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toDateString(year, month, day) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0')
  ].join('-');
}

/**
 * The billing day (1–31) a renewal returns to. A stored anchor is used only when
 * it explains the date (31 explains 02-28); otherwise the date's own day wins.
 */
export function resolveBillingAnchorDay(expireDate, anchorDay = null) {
  const parsed = parseDateOnly(expireDate);
  if (!parsed) return null;
  const anchor = Number(anchorDay);
  if (anchorDay !== null && anchorDay !== '' && Number.isInteger(anchor) && anchor >= 1 && anchor <= 31
    && Math.min(anchor, daysInUtcMonth(parsed.year, parsed.month)) === parsed.day) {
    return anchor;
  }
  return parsed.day;
}

function addBillingCycleToDate(dateString, billingCycle, anchorDay = null) {
  const parsed = parseDateOnly(dateString);
  if (!parsed) return String(dateString || '').trim();

  const monthsToAdd = getBillingCycleOption(billingCycle).months;
  const zeroBasedMonth = parsed.month - 1 + monthsToAdd;
  const year = parsed.year + Math.floor(zeroBasedMonth / 12);
  const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
  const anchor = resolveBillingAnchorDay(dateString, anchorDay);
  const day = Math.min(anchor, daysInUtcMonth(year, month));

  return toDateString(year, month, day);
}

const zonedFormatters = new Map();
function getZonedFormatter(timezone) {
  const requested = String(timezone || '').trim() || 'UTC';
  if (zonedFormatters.has(requested)) return zonedFormatters.get(requested);
  let formatter;
  const options = {
    hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit'
  };
  try { formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: requested }); }
  catch { formatter = new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }); }
  if (zonedFormatters.size > 64) zonedFormatters.clear();
  zonedFormatters.set(requested, formatter);
  return formatter;
}

function getZonedParts(timestamp, timezone) {
  const parts = Object.fromEntries(getZonedFormatter(timezone).formatToParts(new Date(timestamp))
    .map(part => [part.type, Number(part.value)]));
  return { ...parts, hour: parts.hour === 24 ? 0 : parts.hour };
}

/** Calendar date in the notification time zone, shifted by whole days. */
export function getZonedDateString(now = Date.now(), timezone = 'UTC', offsetDays = 0) {
  const parts = getZonedParts(Number(now), timezone);
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + (Number(offsetDays) || 0)));
  return toDateString(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function getZoneOffsetMs(timestamp, timezone) {
  const parts = getZonedParts(timestamp, timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
    - Math.floor(timestamp / 1000) * 1000;
}

/** An expiry date ends at 00:00 of that day in the notification time zone. */
export function getExpireTimestamp(dateString, timezone = 'UTC') {
  const parsed = parseDateOnly(dateString);
  if (!parsed) {
    const fallback = new Date(String(dateString || '').trim()).getTime();
    return Number.isFinite(fallback) ? fallback : NaN;
  }
  const localMidnight = Date.UTC(parsed.year, parsed.month - 1, parsed.day);
  const firstGuess = localMidnight - getZoneOffsetMs(localMidnight, timezone);
  return localMidnight - getZoneOffsetMs(firstGuess, timezone);
}

export function renewExpireDateIfNeeded(expireDate, billingCycle, autoRenewal, now = Date.now(), renewBeforeDays = 0, {
  timezone = 'UTC', anchorDay = null
} = {}) {
  const original = String(expireDate || '').trim();
  if (!original || !parseDateOnly(original) || !isEnabledFlag(autoRenewal)) {
    return { expire_date: original, renewed: false };
  }

  let nextDate = original;
  const renewalDate = getZonedDateString(now, timezone, renewBeforeDays);
  const anchor = resolveBillingAnchorDay(original, anchorDay);
  let renewed = false;
  let guard = 0;

  while (nextDate <= renewalDate && guard < 1200) {
    nextDate = addBillingCycleToDate(nextDate, billingCycle, anchor);
    renewed = true;
    guard++;
  }

  return { expire_date: nextDate, renewed };
}
