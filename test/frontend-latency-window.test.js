import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'vite';
import { reactive } from 'vue';
import { mergeLatencyWindows, updateLatencyWindow, refreshLatencyWindow } from '../src/frontend/utils/latencyWindow.js';

const interval = 360000;
const now = Date.now();
const start = now - 19 * interval;
const empty = () => Object.fromEntries(['ping', 'loss'].map(key => [key,
  Array.from({ length: 20 }, (_, index) => ({ ts: start + index * interval }))
]));

test('live samples populate and replace the current bucket without inventing old samples', () => {
  const original = empty();
  const first = updateLatencyWindow(original, { ping_ct: 306, loss_ct: 0 }, now, {}, now);
  assert.equal(first.ping.at(-1).ct, 306);
  assert.equal(first.loss.at(-1).ct, 0);
  assert.equal(original.ping.at(-1).ct, undefined);
  assert.ok(first.ping.slice(0, -1).every(point => point.ct === undefined));
  const second = updateLatencyWindow(first, { ping_ct: 65, loss_ct: 15 }, now + 2000, {}, now + 2000);
  assert.equal(second.ping.length, 20);
  assert.equal(second.ping.at(-1).ct, 65);
  assert.equal(second.loss.at(-1).ct, 15);
  assert.equal(second.ping.at(-1).sample_ts, now + 2000);
});

test('bucket rollover and long idle periods retain real gaps and expire old data', () => {
  let window = updateLatencyWindow(empty(), { ping_ct: 90, loss_ct: 0 }, now, {}, now);
  window = updateLatencyWindow(window, { ping_ct: 190, loss_ct: 10 }, now + 3 * interval, {}, now + 3 * interval);
  assert.equal(window.ping[16].ct, 90);
  assert.equal(window.ping[17].ct, undefined);
  assert.equal(window.ping[18].ct, undefined);
  assert.equal(window.ping[19].ct, 190);
  const idle = updateLatencyWindow(window, null, null, {}, now + 24 * interval);
  assert.equal(idle.ping.length, 20);
  assert.ok(idle.ping.every(point => point.ct === undefined));
});

test('stale REST refreshes and replays do not overwrite newer live samples', () => {
  const old = updateLatencyWindow(empty(), { ping_ct: 300, loss_ct: 0 }, now, {}, now);
  const live = updateLatencyWindow(old, { ping_ct: 60, loss_ct: 5 }, now + 4000, {}, now + 4000);
  const replay = updateLatencyWindow(live, { ping_ct: 300, loss_ct: 0 }, now, {}, now + 5000);
  assert.equal(replay.ping.at(-1).ct, 60);
  const refresh = mergeLatencyWindows([old, live], {}, now + 6000);
  assert.equal(refresh.ping.at(-1).ct, 60);
  assert.equal(refresh.loss.at(-1).ct, 5);
  const recovered = updateLatencyWindow(empty(), { ping_ct: 160 }, now - 2 * interval, {}, now);
  const reconnected = mergeLatencyWindows([recovered, live], {}, now + 6000);
  assert.equal(reconnected.ping[17].ct, 160);
  assert.equal(reconnected.ping[19].ct, 60);
});

test('timeouts, disabled probes, zero loss, and seconds timestamps stay distinct', () => {
  let window = updateLatencyWindow(empty(), { ping_ct: 0, loss_ct: 100, ping_cu: false, loss_cu: false, ping_cm: null, loss_cm: 0 }, now / 1000, {}, now);
  assert.equal(window.ping.at(-1).ct, 0);
  assert.equal(window.loss.at(-1).ct, 100);
  assert.equal(window.ping.at(-1).cu, false);
  assert.equal(window.ping.at(-1).cm, null);
  assert.equal(window.loss.at(-1).cm, 0);
  window = updateLatencyWindow(window, { cpu: 50 }, now + 1000, {}, now + 1000);
  assert.equal(window.loss.at(-1).ct, 100);
  const invalid = updateLatencyWindow(window, { ping_ct: 999 }, now + 60000, {}, now);
  assert.equal(invalid.ping.at(-1).ct, 0);
});

test('REST backfill keeps pending live reports and honors cleared persisted history', () => {
  const persisted = { ...updateLatencyWindow(empty(), { ping_ct: 306 }, now, {}, now), last_updated: now };
  const live = updateLatencyWindow(persisted, { ping_ct: 65 }, now + 2000, {}, now + 2000);
  const refreshed = refreshLatencyWindow(live, persisted, {}, now + 3000);
  assert.equal(refreshed.ping.at(-1).ct, 65);
  const cleared = refreshLatencyWindow(live, { ...empty(), last_updated: now + 2000 }, {}, now + 4000);
  assert.ok(cleared.ping.every(point => point.ct === undefined));
  const nextTick = updateLatencyWindow(refreshed, null, null, {}, now + 4000);
  assert.strictEqual(nextTick.ping, refreshed.ping, 'unchanged time buckets need not be recreated every second');
});

test('Vue latency cards react to new values, height changes, failures and absent samples', async t => {
  const originalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => 'en' };
  const vite = await createServer({ configFile: false, appType: 'custom', logLevel: 'silent', server: { middlewareMode: true } });
  t.after(async () => { await vite.close(); globalThis.localStorage = originalStorage; });
  const { useServerCardData } = await vite.ssrLoadModule('/src/frontend/composables/useServerCardData.js');
  const props = reactive({ server: { ...empty(), ping_ct: 306, loss_ct: 0 }, sysConfig: {} });
  const card = useServerCardData(props);
  assert.equal(card.threeNetDetails.value[0].latestPing, 306);
  const gaps = card.threeNetDetails.value[0].points;
  assert.ok(gaps.every(point => /no samples/i.test(point.pingTooltip)));
  assert.ok(gaps.every(point => point.pingColor === 'var(--text-muted)'));
  assert.equal(card.formatLossValue(null), '--');
  props.server = { ...props.server, ...updateLatencyWindow(props.server, { ping_ct: 306, loss_ct: 0 }, now, {}, now) };
  const high = card.threeNetDetails.value[0].points.at(-1);
  assert.match(high.pingTooltip, /306 ms/);
  props.server = { ...props.server, ping_ct: 65, ...updateLatencyWindow(props.server, { ping_ct: 65, loss_ct: 25 }, now + 1000, {}, now + 1000) };
  const lower = card.threeNetDetails.value[0].points.at(-1);
  assert.equal(card.threeNetDetails.value[0].latestPing, 65);
  assert.ok(lower.pingHeight < high.pingHeight);
  assert.ok(lower.lossHeight > high.lossHeight);
  props.server = { ...props.server, ping_ct: null, ...updateLatencyWindow(props.server, { ping_ct: null, loss_ct: 100 }, now + 2000, {}, now + 2000) };
  assert.equal(card.formatPingValue(card.threeNetDetails.value[0].latestPing), 'TIMEOUT');
  assert.match(card.threeNetDetails.value[0].points.at(-1).pingTooltip, /TIMEOUT/);
});
