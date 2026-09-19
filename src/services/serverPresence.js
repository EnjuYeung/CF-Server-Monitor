// A live agent is identified by authenticated receipt, not the timestamp of a sampled history row.
export function getServerLastSeen(env, serverId, latestMetrics) {
  return env.REALTIME_HUB?.latestReports.lastSeen(serverId, latestMetrics?.timestamp) || latestMetrics?.timestamp || 0;
}

export function isServerOffline(server, lastSeen, thresholdMs, now = Date.now()) {
  // HTTP and idle WS may report only every 180 seconds. Allow one period plus transport jitter.
  const reportInterval = [30, 60, 120, 180].includes(Number(server.report_interval)) ? Number(server.report_interval) : 60;
  const deadline = Math.max(thresholdMs, reportInterval * 1000 + 30000);
  return !lastSeen || now - lastSeen > deadline;
}
