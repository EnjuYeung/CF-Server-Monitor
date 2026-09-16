import { LATENCY_WINDOW } from './constants.js'
import { normalizeTimestamp } from './time.js'

const NODES = ['ct', 'cu', 'cm', 'bd', 'node_1', 'node_2', 'node_3', 'node_4']
const SERIES = ['ping', 'loss']

// Keep the REST window's time grid. Advance whole buckets, never fill a gap
// with the last known value, and use sample timestamps to reject old replays.
export function mergeLatencyWindows(windows, config = {}, now = Date.now()) {
  const points = Number.isInteger(Number(config.points)) && Number(config.points) > 0
    ? Number(config.points) : LATENCY_WINDOW.POINTS
  const hours = Number(config.hours) > 0 ? Number(config.hours) : LATENCY_WINDOW.HOURS
  const source = windows.flatMap(window => SERIES.map(key => window?.[key]))
    .find(series => Array.isArray(series) && series.length === points)
  const firstTs = normalizeTimestamp(source?.[0]?.ts, null)
  const nextTs = normalizeTimestamp(source?.[1]?.ts, null)
  const interval = firstTs && nextTs > firstTs ? nextTs - firstTs : hours * 3600000 / points
  let start = firstTs || Math.floor(now / interval) * interval - (points - 1) * interval
  const shift = Math.max(0, Math.floor((now - start) / interval) - points + 1)
  start += shift * interval
  const result = Object.fromEntries(SERIES.map(key => [key,
    Array.from({ length: points }, (_, index) => ({ ts: start + index * interval }))
  ]))

  for (const window of windows) {
    for (const key of SERIES) {
      for (const point of Array.isArray(window?.[key]) ? window[key] : []) {
        if (!point || !NODES.some(node => Object.hasOwn(point, node))) continue
        const sampleTs = normalizeTimestamp(point.sample_ts ?? point.ts, null)
        if (!sampleTs || sampleTs > now) continue
        const index = Math.floor((sampleTs - start) / interval)
        if (index < 0 || index >= points) continue
        const bucket = result[key][index]
        if (sampleTs < (bucket.sample_ts || 0)) continue
        result[key][index] = { ...point, ts: bucket.ts, sample_ts: sampleTs }
      }
    }
  }
  return result
}

export function updateLatencyWindow(server, metrics, timestamp, config = {}, now = Date.now()) {
  if (!metrics && server.ping?.length > 1 && server.loss?.length === server.ping.length) {
    const interval = server.ping[1].ts - server.ping[0].ts
    if (interval > 0 && now < server.ping.at(-1).ts + interval) {
      return { ping: server.ping, loss: server.loss }
    }
  }
  const sampleTs = normalizeTimestamp(timestamp, null)
  const sample = {}
  if (metrics && sampleTs) {
    for (const key of SERIES) {
      const point = { ts: sampleTs, sample_ts: sampleTs }
      for (const node of NODES) {
        const field = `${key}_${node}`
        if (Object.hasOwn(metrics, field)) point[node] = metrics[field]
      }
      sample[key] = [point]
    }
  }
  return mergeLatencyWindows([server, sample], config, now)
}

export function refreshLatencyWindow(server, snapshot, config = {}, now = Date.now()) {
  const persistedTs = normalizeTimestamp(snapshot.last_updated, 0)
  // REST owns persisted history (including a deliberate clear). Only retain
  // local samples newer than the last persisted report while backfilling.
  const live = Object.fromEntries(SERIES.map(key => [key,
    (server[key] || []).filter(point => normalizeTimestamp(point.sample_ts, 0) > persistedTs)
  ]))
  return mergeLatencyWindows([snapshot, live], config, now)
}
