import { isIP } from 'node:net';
import proxyaddr from 'proxy-addr';
import { readCountryDatabase, downloadCountryDatabase, writeCountryDatabase } from './geoipDatabase.js';

export const GEOIP_UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const normalizeIp = value => String(value || '').trim().replace(/^::ffff:/, '');
const isLocal = proxyaddr.compile(['loopback', 'linklocal', 'uniquelocal']);
export function isPublicIp(value) {
  const ip = normalizeIp(value);
  return Boolean(isIP(ip)) && !isLocal(ip) && ip !== '0.0.0.0' && ip !== '::';
}

export async function createGeolocation(filename, publicIp = '', { updatePath } = {}) {
  let database, bundledError;
  let persisted = false;
  try { database = await readCountryDatabase(filename); }
  catch (error) { bundledError = error; }
  if (updatePath) {
    try {
      const cached = await readCountryDatabase(updatePath);
      if (!database || cached.reader.metadata.buildEpoch >= database.reader.metadata.buildEpoch) {
        database = cached;
        persisted = true;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn(JSON.stringify({ event: 'geoip_cache_failed', error: error.message }));
    }
  }
  if (!database) throw bundledError;
  // Same-host agents may connect over a loopback/private bridge address. Discover
  // only this controller's egress address; remote Agent addresses stay local.
  let hostIp = normalizeIp(publicIp);
  if (hostIp && !isPublicIp(hostIp)) throw new Error('PUBLIC_IP must be a public IPv4/IPv6 address');
  if (!hostIp) {
    try {
      const response = await fetch('https://api64.ipify.org', { signal: AbortSignal.timeout(3000) });
      const candidate = normalizeIp(await response.text());
      if (response.ok && isPublicIp(candidate)) hostIp = candidate;
    } catch { /* Manual PUBLIC_IP and region override remain available offline. */ }
  }
  let nextCheckAt = 0;
  let pending = null;
  let stopped = false;
  const cancellation = new AbortController();
  return {
    lookup(ip, reportedIp = '') {
      const target = isPublicIp(ip) ? normalizeIp(ip)
        : isPublicIp(reportedIp) ? normalizeIp(reportedIp) : hostIp;
      if (!target) return '';
      return database.reader.get(target)?.country?.iso_code || '';
    },
    hostIp,
    updateIfDue(now = Date.now()) {
      if (pending) return pending;
      if (stopped || !updatePath || now < nextCheckAt) return Promise.resolve({ status: 'skipped' });
      // Reserve the next attempt before I/O so failures and concurrent ticks do
      // not retry every minute. A restart performs a fresh background check.
      nextCheckAt = now + GEOIP_UPDATE_INTERVAL_MS;
      const month = new Date(now).toISOString().slice(0, 7);
      pending = (async () => {
        try {
          const candidate = await downloadCountryDatabase(month, { signal: cancellation.signal });
          if (candidate.reader.metadata.buildEpoch < database.reader.metadata.buildEpoch) {
            throw new Error('Downloaded GeoIP database is older than the active database');
          }
          if (persisted && candidate.data.equals(database.data)) {
            console.log(JSON.stringify({ event: 'geoip_unchanged', month }));
            return { status: 'unchanged' };
          }
          await writeCountryDatabase(updatePath, candidate.data, { signal: cancellation.signal });
          // Switch readers only after the verified file has been committed.
          database = candidate;
          persisted = true;
          console.log(JSON.stringify({ event: 'geoip_updated', month, buildEpoch: database.reader.metadata.buildEpoch, bytes: database.data.length }));
          return { status: 'updated' };
        } catch (error) {
          if (!stopped) console.warn(JSON.stringify({ event: 'geoip_update_failed', month, error: error.message }));
          return { status: stopped ? 'stopped' : 'failed', error: error.message };
        } finally { pending = null; }
      })();
      return pending;
    },
    async close() {
      stopped = true;
      cancellation.abort();
      await pending;
    }
  };
}
