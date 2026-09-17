import { normalizeTimestamp } from './time.js'
import { refreshLatencyWindow } from './latencyWindow.js'

// A REST response can arrive after a newer live sample. Refresh metadata and
// persisted history without replacing metrics received while it was in flight.
export function reconcileDashboardSnapshot(snapshot, current, liveSample, config = {}, now = Date.now()) {
  const snapshotTs = normalizeTimestamp(snapshot.sample_timestamp ?? snapshot.timestamp ?? snapshot.last_updated, 0)
  const liveTs = normalizeTimestamp(liveSample?.sample_timestamp, 0)
  const keepLive = liveTs > snapshotTs
  const reportTs = Math.max(
    normalizeTimestamp(snapshot.report_timestamp ?? snapshot.last_updated, 0),
    keepLive ? normalizeTimestamp(liveSample.report_timestamp, 0) : 0
  )
  return {
    ...current,
    ...snapshot,
    ...(keepLive ? liveSample : {}),
    sample_timestamp: keepLive ? liveTs : snapshotTs,
    display_timestamp: keepLive ? current?.display_timestamp || liveTs : snapshotTs,
    report_timestamp: reportTs,
    last_updated: reportTs,
    ...refreshLatencyWindow(current || {}, snapshot, config, now)
  }
}
