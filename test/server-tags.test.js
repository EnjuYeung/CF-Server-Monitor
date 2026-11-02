import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeServerTags, parseServerTags, TAG_COLORS } from '../src/shared/serverTags.js';
import { normalizeServerInput } from '../src/services/serverInput.js';
import { normalizePrice } from '../src/shared/billing.js';
import { isFreePrice, formatBillingPrice } from '../src/frontend/utils/server.js';
import { calculateFinanceSummary, calculateServerFinanceRows } from '../src/frontend/utils/finance.js';

test('tag colors accept only exact suffix syntax and preserve case and comma boundaries', () => {
  const tags = parseServerTags('1Gbps<green>,lower<#aBc>,UPPER<#123456>,foo,Foo,old,repeat');
  assert.deepEqual(tags.map(t => t.text), ['1Gbps', 'lower', 'UPPER', 'foo', 'Foo', 'old', 'repeat']);
  assert.deepEqual(tags.map(t => t.background), ['#00D4AA', '#AABBCC', '#123456', '#00D4AA', '#4DA6FF', '#FFB870', '#39D2C0']);
  for (const raw of ['a[red]', 'a:red', 'a(red)', 'a<RED>', 'a<orange>', 'a<#12>', 'a<#1234>', 'a<#12345678>', 'a< red>', 'a<red >', 'a<red>suffix', 'a<red><blue>', '<red>', '<img src=x onerror=alert(1)>', 'a<url(https://invalid)>']) {
    const [tag] = parseServerTags(raw);
    assert.equal(tag.text, raw, raw); assert.equal(tag.background, '#39D2C0', raw);
  }
  assert.equal(parseServerTags('a，b；c;d').length, 1);
  assert.deepEqual(parseServerTags(' , a,, b ,').map(t => t.text), ['a', 'b']);
  assert.deepEqual(parseServerTags(''), []);
});

test('default tag mapping cycles six colors; named palette also includes red', () => {
  const tags = parseServerTags('a,b,c,d,e,f,g');
  assert.deepEqual(tags.map(t => t.background), ['#39D2C0', '#B392F0', '#F778BA', '#00D4AA', '#4DA6FF', '#FFB870', '#39D2C0']);
  assert.equal(parseServerTags('a<red>')[0].background, '#F85149');
  assert.equal(Object.keys(TAG_COLORS).length, 7);
  assert.equal(parseServerTags('white<#FFF>')[0].foreground, '#000000');
  assert.equal(parseServerTags('black<#000>')[0].foreground, '#FFFFFF');
});

test('server input keeps valid color suffixes through add/edit/import normalization and bounds labels', () => {
  const tags = '1Gbps<green>,lower<#aBc>,UPPER<#123456>,plain，text,a[red],x<orange>';
  assert.equal(normalizeServerInput({ name: 'fixture', tags }, {}).tags, tags);
  const long = '服'.repeat(40) + '<#abc>';
  assert.equal(normalizeServerTags(long), '服'.repeat(32) + '<#abc>');
  assert.equal(normalizeServerTags('😀'.repeat(40) + '<red>'), '😀'.repeat(32) + '<red>');
  assert.equal(parseServerTags(normalizeServerTags(Array(15).fill('x<blue>').join(','))).length, 12);
  for (const value of [tags, long, 'a,,b', '\u0000tag<#abc>', 'label<#12>']) {
    const normalized = normalizeServerTags(value);
    assert.equal(normalizeServerTags(normalized), normalized);
  }
});

test('finance depends only on valid positive prices and zero alone is displayed as free', () => {
  const now = Date.UTC(2026, 8, 19);
  const paid = { id: 'paid', name: 'Paid', price: '30', currency: '¥', billing_cycle: 'month', expire_date: new Date(now + 15 * 86400000).toISOString() };
  const expected = calculateFinanceSummary([paid], undefined, now);
  for (const tags of ['白嫖中', '白嫖中<green>', 'free<#fff>', '']) {
    const tagged = { ...paid, tags };
    assert.deepEqual(calculateFinanceSummary([tagged], undefined, now), expected);
    assert.equal(calculateServerFinanceRows([tagged], undefined, now)[0].remainingValueCNY, 15);
  }
  for (const price of ['0', '0.00', '¥0']) assert.equal(isFreePrice(price), true);
  for (const price of ['', null, '-1', '-2', 'invalid', '30']) assert.equal(isFreePrice(price), false);
  assert.equal(normalizePrice('-1'), '');
  assert.equal(formatBillingPrice({ price: '-1' }, 'zh'), '');
  assert.equal(formatBillingPrice({ price: '0' }, 'zh'), '免费');
  assert.equal(calculateServerFinanceRows(['0', '-1', '', 'invalid'].map(price => ({ ...paid, price })), undefined, now).length, 0);
});

test('finance values each server by its remaining term instead of one billing cycle', () => {
  const now = Date.UTC(2026, 8, 19);
  const server = (days, overrides = {}) => ({ id: `days-${days}`, name: 'Paid', price: '30', currency: '¥', billing_cycle: 'month', expire_date: new Date(now + days * 86400000).toISOString(), ...overrides });
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
  const prepaid = calculateFinanceSummary([server(90)], undefined, now);
  near(prepaid.remainingValueCNY, 90); near(prepaid.totalValueCNY, 90); near(prepaid.monthlyAverageCostCNY, 30);
  near(calculateServerFinanceRows([server(90)], undefined, now)[0].remainingValueCNY, 90);
  const partial = calculateFinanceSummary([server(15)], undefined, now);
  near(partial.remainingValueCNY, 15); near(partial.totalValueCNY, 15);
  const expired = calculateFinanceSummary([server(-1)], undefined, now);
  near(expired.remainingValueCNY, 0); near(expired.totalValueCNY, 0); assert.equal(expired.expiredCount, 1);
  const noExpiry = calculateFinanceSummary([server(0, { expire_date: '' })], undefined, now);
  near(noExpiry.totalValueCNY, 30); near(noExpiry.remainingValueCNY, 0); assert.equal(noExpiry.missingExpireCount, 1);
  const longTerm = calculateFinanceSummary([server(365 * 120)], undefined, now);
  near(longTerm.remainingValueCNY, 30); near(longTerm.totalValueCNY, 30);
  const mixed = calculateFinanceSummary([server(90), server(15), server(0, { expire_date: '' })], undefined, now);
  near(mixed.totalValueCNY, 135); near(mixed.remainingValueCNY, 105); assert.equal(mixed.configuredCount, 3);
});
