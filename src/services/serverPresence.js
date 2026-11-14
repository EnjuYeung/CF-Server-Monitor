// A live agent is identified by authenticated receipt, not the timestamp of a sampled history row.
export function getServerLastSeen(env, serverId, latestMetrics) {
  return env.AGENT_REPORTS?.lastSeen(serverId, latestMetrics?.timestamp) || latestMetrics?.timestamp || 0;
}

// HTTP and idle WS may report only every 180 seconds. Allow one period plus transport jitter.
export function getOfflineDeadlineMs(server, thresholdMs) {
  const reportInterval = [30, 60, 120, 180].includes(Number(server.report_interval)) ? Number(server.report_interval) : 60;
  return Math.max(thresholdMs, reportInterval * 1000 + 30000);
}

export function isServerOffline(server, lastSeen, thresholdMs, now = Date.now()) {
  return !lastSeen || now - lastSeen > getOfflineDeadlineMs(server, thresholdMs);
}

/**
 * Receipts could not arrive while the controller was stopped. Until one full
 * deadline has passed since start, a node not heard from since start is unknown.
 */
export function isAwaitingFirstReceiptSinceStart(server, lastSeen, thresholdMs, startedAt, now = Date.now()) {
  if (!(startedAt > 0) || (lastSeen && lastSeen >= startedAt)) return false;
  return now - startedAt <= getOfflineDeadlineMs(server, thresholdMs);
}
