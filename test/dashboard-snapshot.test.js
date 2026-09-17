import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileDashboardSnapshot } from '../src/frontend/utils/dashboardSnapshot.js';
import { updateLatencyWindow } from '../src/frontend/utils/latencyWindow.js';

const now = Date.UTC(2026, 8, 17, 10);

test('restoring a dashboard loads the latest persisted metrics without replaying old values', () => {
  const current = { id: 'a', cpu: 10, sample_timestamp: now - 10000, display_timestamp: now - 1000 };
  const snapshot = { id: 'a', name: 'Primary', cpu: 42, last_updated: now };
  const result = reconcileDashboardSnapshot(snapshot, current, { cpu: 10, sample_timestamp: now - 10000 }, {}, now);
  assert.equal(result.cpu, 42);
  assert.equal(result.sample_timestamp, now);
  assert.equal(result.display_timestamp, now);
  assert.equal(result.last_updated, now);
});

test('a delayed snapshot refreshes server metadata without overwriting a newer live sample', () => {
  const live = { cpu: 73, sample_timestamp: now, report_timestamp: now };
  const current = { id: 'a', name: 'Old name', ...live, display_timestamp: now + 1000 };
  const snapshot = { id: 'a', name: 'Renamed', cpu: 21, last_updated: now - 5000, server_group: 'Europe' };
  const result = reconcileDashboardSnapshot(snapshot, current, live, {}, now + 1000);
  assert.equal(result.cpu, 73);
  assert.equal(result.name, 'Renamed');
  assert.equal(result.server_group, 'Europe');
  assert.equal(result.sample_timestamp, now);
  assert.equal(result.display_timestamp, now + 1000);
  assert.equal(result.last_updated, now);
});

test('restoring backfills history while retaining a live latency sample newer than persistence', () => {
  const current = updateLatencyWindow({}, { ping_ct: 65, loss_ct: 0 }, now, {}, now);
  const snapshot = { last_updated: now - 1000, ...updateLatencyWindow({}, { ping_ct: 150, loss_ct: 10 }, now - 360000, {}, now) };
  const result = reconcileDashboardSnapshot(snapshot, current, { sample_timestamp: now, report_timestamp: now }, {}, now);
  assert.equal(result.ping.at(-1).ct, 65);
  assert.equal(result.ping.at(-2).ct, 150);
  assert.equal(result.loss.at(-1).ct, 0);
});

test('an empty or cleared history stays empty after restoring a persisted snapshot', () => {
  const current = updateLatencyWindow({}, { ping_ct: 65 }, now - 1000, {}, now);
  const result = reconcileDashboardSnapshot({ id: 'a', cpu: 0, last_updated: now, ping: [], loss: [] }, current, undefined, {}, now);
  assert.equal(result.cpu, 0);
  assert.equal(result.ping.some(point => Object.hasOwn(point, 'ct')), false);
  const added = reconcileDashboardSnapshot({ id: 'new', name: 'New node' }, undefined, undefined, {}, now);
  assert.equal(added.name, 'New node');
  assert.equal(added.ping.length, 20);
});
