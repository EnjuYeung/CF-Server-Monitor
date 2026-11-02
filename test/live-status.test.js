import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLiveStatusData, getLiveChartTime } from '../src/frontend/utils/liveStatus.js';

test('LV01 live status keeps receipt time and sampling time apart', () => {
  const status = buildLiveStatusData({ ts: 1000, data: { cpu: 5, last_updated: 1, sample_timestamp: 2, timestamp: 3 } }, 2000, 3000);
  assert.deepEqual(status, { cpu: 5, sample_timestamp: 1000, last_updated: 2000, timestamp: 3000 });
});

test('LV02 chart position follows sampling time and falls back to receipt time', () => {
  assert.equal(getLiveChartTime({ sample_timestamp: 1000, last_updated: 2000 }), 1000);
  assert.equal(getLiveChartTime({ sample_timestamp: 0, last_updated: 2000 }), 2000);
  assert.equal(getLiveChartTime({ last_updated: new Date(2000).toISOString() }), 2000);
});
