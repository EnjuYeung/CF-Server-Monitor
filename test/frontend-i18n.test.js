import assert from 'node:assert/strict';
import test from 'node:test';
import 'vue';
import { normalizeLanguagePreference, resolveBrowserLanguage } from '../src/utils/language.js';
import { normalizeDefaultLanguage } from '../src/utils/settings.js';
import { BILLING_CYCLES, CURRENCY_OPTIONS, formatBillingPrice, getBillingCycleLabel, getCurrencyName } from '../src/frontend/utils/server.js';

const storage = new Map();
globalThis.localStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};
globalThis.document = { documentElement: { lang: '' } };
globalThis.window = new EventTarget();
const { translations, applyDefaultLanguage, setLanguage, getLanguage, toggleLanguage } = await import('../src/frontend/utils/i18n.js');

test('Japanese catalogue covers every English and Chinese key and preserves placeholders', () => {
  const keys = Object.keys(translations.en).sort();
  assert.deepEqual(Object.keys(translations.zh).sort(), keys);
  assert.deepEqual(Object.keys(translations.ja).sort(), keys);
  const placeholders = value => [...value.matchAll(/\{([a-zA-Z]\w*)\}/g)].map(match => match[1]).sort();
  for (const key of keys) {
    assert.equal(typeof translations.ja[key], 'string', key);
    assert.ok(translations.ja[key].trim(), key);
    assert.deepEqual(placeholders(translations.ja[key]), placeholders(translations.en[key]), key);
  }
});

test('frontend and backend accept Japanese and normalize unsupported preferences', () => {
  for (const normalize of [normalizeLanguagePreference, normalizeDefaultLanguage]) {
    assert.equal(normalize(' JA '), 'ja');
    assert.equal(normalize('auto'), 'auto');
    assert.equal(normalize('zh'), 'zh');
    assert.equal(normalize('en'), 'en');
    assert.equal(normalize('unsupported'), 'auto');
    assert.equal(normalize('', 'ja'), 'ja');
  }
});

test('browser language detection follows the preferred supported language', () => {
  for (const language of ['ja', 'ja-JP', 'ja_JP', 'JA-jp']) {
    assert.equal(resolveBrowserLanguage([language, 'zh-CN', 'en']), 'ja');
  }
  assert.equal(resolveBrowserLanguage(['zh-TW', 'ja']), 'zh');
  assert.equal(resolveBrowserLanguage(['en-US', 'ja-JP']), 'en');
  assert.equal(resolveBrowserLanguage(['fr-FR', 'ja-JP']), 'ja');
  assert.equal(resolveBrowserLanguage(['yue-HK']), 'zh');
  assert.equal(resolveBrowserLanguage(['fr-FR']), 'en');
  assert.equal(resolveBrowserLanguage([]), 'en');
});

test('Japanese selection persists, overrides site defaults and updates document language', () => {
  storage.clear();
  applyDefaultLanguage('ja');
  assert.equal(getLanguage(), 'ja');
  assert.equal(document.documentElement.lang, 'ja');
  setLanguage('en');
  applyDefaultLanguage('ja');
  assert.equal(getLanguage(), 'en');
  setLanguage('ja');
  assert.equal(storage.get('language_preference'), 'ja');
  applyDefaultLanguage('zh');
  assert.equal(getLanguage(), 'ja');
  assert.equal(document.documentElement.lang, 'ja');
  setLanguage('unsupported');
  assert.equal(getLanguage(), 'ja');
  assert.equal(toggleLanguage(), 'en');
  assert.equal(toggleLanguage(), 'zh');
  assert.equal(document.documentElement.lang, 'zh-CN');
  assert.equal(toggleLanguage(), 'ja');
});

test('billing periods and currency names have Japanese labels without changing values', () => {
  assert.equal(formatBillingPrice({ price: '0' }, 'ja'), '無料');
  assert.equal(formatBillingPrice({ price: '100', currency: '¥JPY', billing_cycle: 'month' }, 'ja'), '¥JPY100.00/月');
  assert.equal(formatBillingPrice({ price: '100', currency: '$', billing_cycle: 'year' }, 'en'), '$100.00/Y');
  for (const cycle of BILLING_CYCLES) {
    assert.ok(cycle.labelJa && cycle.shortLabelJa);
    assert.equal(getBillingCycleLabel(cycle, 'ja'), cycle.labelJa);
  }
  for (const currency of CURRENCY_OPTIONS) assert.ok(currency.nameJa, currency.symbol);
  assert.equal(getCurrencyName(CURRENCY_OPTIONS.find(item => item.symbol === '¥JPY'), 'ja'), '日本円');
  assert.equal(getCurrencyName({ symbol: 'CUSTOM', nameEn: 'Custom' }, 'ja'), 'Custom');
});
