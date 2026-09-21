import { normalizePrice, normalizeCurrency, detectCurrencySymbol, detectBillingCycle, normalizeBillingCycle, isEnabledFlag, renewExpireDateIfNeeded } from '../../shared/billing.js';
export { normalizePrice, normalizeCurrency, detectCurrencySymbol, detectBillingCycle, normalizeBillingCycle, isEnabledFlag, renewExpireDateIfNeeded } from '../../shared/billing.js';

export { isDisabledProbeMetric } from '../../shared/metrics.js';

export const BILLING_CYCLES = Object.freeze([
  { value: 'month', months: 1, labelZh: '月', labelEn: 'Monthly', shortLabelZh: '月', shortLabelEn: 'M', labelJa: '月払い', shortLabelJa: '月' },
  { value: 'quarter', months: 3, labelZh: '季', labelEn: 'Quarterly', shortLabelZh: '季', shortLabelEn: 'Q', labelJa: '3か月払い', shortLabelJa: '3か月' },
  { value: 'half_year', months: 6, labelZh: '半年', labelEn: 'Half-yearly', shortLabelZh: '半年', shortLabelEn: 'HY', labelJa: '半年払い', shortLabelJa: '半年' },
  { value: 'year', months: 12, labelZh: '年', labelEn: 'Yearly', shortLabelZh: '年', shortLabelEn: 'Y', labelJa: '年払い', shortLabelJa: '年' },
  { value: 'two_years', months: 24, labelZh: '两年', labelEn: 'Two years', shortLabelZh: '2年', shortLabelEn: '2Y', labelJa: '2年払い', shortLabelJa: '2年' },
  { value: 'three_years', months: 36, labelZh: '三年', labelEn: 'Three years', shortLabelZh: '3年', shortLabelEn: '3Y', labelJa: '3年払い', shortLabelJa: '3年' },
  { value: 'four_years', months: 48, labelZh: '四年', labelEn: 'Four years', shortLabelZh: '4年', shortLabelEn: '4Y', labelJa: '4年払い', shortLabelJa: '4年' },
  { value: 'five_years', months: 60, labelZh: '五年', labelEn: 'Five years', shortLabelZh: '5年', shortLabelEn: '5Y', labelJa: '5年払い', shortLabelJa: '5年' }
]);

export const CURRENCY_OPTIONS = Object.freeze([
  { symbol: '$', nameZh: '美元', nameEn: 'US Dollar', nameJa: '米ドル' },
  { symbol: '¥', nameZh: '人民币', nameEn: 'Chinese Yuan', nameJa: '人民元' },
  { symbol: '€', nameZh: '欧元', nameEn: 'Euro', nameJa: 'ユーロ' },
  { symbol: '£', nameZh: '英镑', nameEn: 'British Pound', nameJa: '英ポンド' },
  { symbol: '¥JPY', nameZh: '日元', nameEn: 'Japanese Yen', nameJa: '日本円' },
  { symbol: 'HK$', nameZh: '港币', nameEn: 'Hong Kong Dollar', nameJa: '香港ドル' },
  { symbol: 'A$', nameZh: '澳元', nameEn: 'Australian Dollar', nameJa: '豪ドル' },
  { symbol: 'C$', nameZh: '加拿大元', nameEn: 'Canadian Dollar', nameJa: 'カナダドル' },
  { symbol: 'S$', nameZh: '新加坡元', nameEn: 'Singapore Dollar', nameJa: 'シンガポールドル' },
  { symbol: 'NZ$', nameZh: '新西兰元', nameEn: 'New Zealand Dollar', nameJa: 'ニュージーランドドル' },
  { symbol: '₣', nameZh: '瑞士法郎', nameEn: 'Swiss Franc', nameJa: 'スイスフラン' },
  { symbol: '₩', nameZh: '韩元', nameEn: 'Korean Won', nameJa: '韓国ウォン' },
  { symbol: '₹', nameZh: '印度卢比', nameEn: 'Indian Rupee', nameJa: 'インドルピー' },
  { symbol: '฿', nameZh: '泰铢', nameEn: 'Thai Baht', nameJa: 'タイバーツ' },
  { symbol: '₫', nameZh: '越南盾', nameEn: 'Vietnamese Dong', nameJa: 'ベトナムドン' },
  { symbol: '₱', nameZh: '菲律宾比索', nameEn: 'Philippine Peso', nameJa: 'フィリピンペソ' },
  { symbol: 'Rp', nameZh: '印尼盾', nameEn: 'Indonesian Rupiah', nameJa: 'インドネシアルピア' },
  { symbol: 'RM', nameZh: '马来西亚林吉特', nameEn: 'Malaysian Ringgit', nameJa: 'マレーシアリンギット' },
  { symbol: '₺', nameZh: '土耳其里拉', nameEn: 'Turkish Lira', nameJa: 'トルコリラ' },
  { symbol: '₪', nameZh: '以色列新谢克尔', nameEn: 'Israeli Shekel', nameJa: 'イスラエル新シェケル' },
  { symbol: '৳', nameZh: '孟加拉塔卡', nameEn: 'Bangladeshi Taka', nameJa: 'バングラデシュタカ' },
  { symbol: '₨', nameZh: '巴基斯坦卢比', nameEn: 'Pakistani Rupee', nameJa: 'パキスタンルピー' },
  { symbol: 'LKR', nameZh: '斯里兰卡卢比', nameEn: 'Sri Lankan Rupee', nameJa: 'スリランカルピー' },
  { symbol: '₮', nameZh: '蒙古图格里克', nameEn: 'Mongolian Tugrik', nameJa: 'モンゴルトゥグルグ' },
  { symbol: '₽', nameZh: '卢布', nameEn: 'Russian Ruble', nameJa: 'ロシアルーブル' },
  { symbol: 'R$', nameZh: '巴西雷亚尔', nameEn: 'Brazilian Real', nameJa: 'ブラジルレアル' },
  { symbol: 'kr', nameZh: '克朗', nameEn: 'Krona (SEK/NOK/DKK)', nameJa: 'クローナ（SEK/NOK/DKK）' },
  { symbol: 'zł', nameZh: '波兰兹罗提', nameEn: 'Polish Zloty', nameJa: 'ポーランドズロチ' },
  { symbol: '₴', nameZh: '乌克兰格里夫纳', nameEn: 'Ukrainian Hryvnia', nameJa: 'ウクライナフリヴニャ' },
  { symbol: '₸', nameZh: '哈萨克坦戈', nameEn: 'Kazakhstani Tenge', nameJa: 'カザフスタンテンゲ' },
  { symbol: 'R', nameZh: '南非兰特', nameEn: 'South African Rand', nameJa: '南アフリカランド' },
  { symbol: '₦', nameZh: '尼日利亚奈拉', nameEn: 'Nigerian Naira', nameJa: 'ナイジェリアナイラ' },
  { symbol: 'EGP', nameZh: '埃及镑', nameEn: 'Egyptian Pound', nameJa: 'エジプトポンド' },
  { symbol: 'د.إ', nameZh: '阿联酋迪拉姆', nameEn: 'UAE Dirham', nameJa: 'UAE ディルハム' },
  { symbol: '﷼', nameZh: '沙特里亚尔', nameEn: 'Saudi Riyal', nameJa: 'サウジリヤル' },
  { symbol: 'Q', nameZh: '危地马拉格查尔', nameEn: 'Guatemalan Quetzal', nameJa: 'グアテマラケツァル' }
]);

export function isFreePrice(value) {
  const price = normalizePrice(value);
  return price === '0.00';
}

export function getBillingCycleOption(value) {
  const normalized = normalizeBillingCycle(value);
  return BILLING_CYCLES.find(item => item.value === normalized) || BILLING_CYCLES[0];
}

export function formatBillingPrice(server, lang = 'zh') {
  const price = normalizePrice(server?.price);
  if (!price) return '';
  if (isFreePrice(price)) return lang === 'ja' ? '無料' : lang === 'zh' ? '免费' : 'Free';

  const currency = normalizeCurrency(server?.currency || detectCurrencySymbol(server?.price));
  const cycle = getBillingCycleOption(detectBillingCycle(server?.price) || server?.billing_cycle);
  const cycleLabel = getBillingCycleLabel(cycle, lang, true);

  return `${currency}${price}/${cycleLabel}`;
}

export function getBillingCycleLabel(option, language, short = false) {
  const prefix = short ? 'shortLabel' : 'label';
  const suffix = language === 'ja' ? 'Ja' : language === 'zh' ? 'Zh' : 'En';
  return option[`${prefix}${suffix}`] || option[`${prefix}En`];
}

export function getCurrencyName(option, language) {
  const suffix = language === 'ja' ? 'Ja' : language === 'zh' ? 'Zh' : 'En';
  return option[`name${suffix}`] || option.nameEn || option.symbol;
}
