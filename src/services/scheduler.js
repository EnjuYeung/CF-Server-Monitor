import { checkOfflineNodes, checkResourceAlerts, checkTrafficReports, checkExpiringServers } from './notification.js';
import { drainNotifications } from './outbox.js';
import { cleanupHistory } from '../database/schema.js';

export function startScheduler(env) {
  const running = new Map();
  let stopped = false;
  const run = (name, job) => {
    if (stopped || running.has(name)) return;
    const promise = Promise.resolve().then(job).catch(error => {
      console.error(JSON.stringify({ event: 'scheduled_job_failed', job: name, error: error.message }));
    }).finally(() => running.delete(name));
    running.set(name, promise);
  };
  const tick = () => {
    const now = Date.now();
    run('offline', () => checkOfflineNodes(env.DB));
    run('resource', () => checkResourceAlerts(env));
    run('traffic', () => checkTrafficReports(env.DB, { scheduled: true, now }));
    run('expiry', () => checkExpiringServers(env.DB, { scheduled: true, now }));
    run('retention', () => cleanupHistory(env.DB, now));
    run('agent-schedule', () => env.REALTIME_HUB.enforceSchedule());
    run('notification-delivery', () => drainNotifications(env.DB));
    run('geoip-update', () => env.GEOLOCATION.updateIfDue(now));
  };
  const interval = setInterval(tick, 60000);
  interval.unref();
  tick();
  return { async stop() { stopped = true; clearInterval(interval); await Promise.allSettled([...running.values()]); } };
}
