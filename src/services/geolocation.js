import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { Reader } from 'maxmind';
import proxyaddr from 'proxy-addr';

export const normalizeIp = value => String(value || '').trim().replace(/^::ffff:/, '');
const isLocal = proxyaddr.compile(['loopback', 'linklocal', 'uniquelocal']);
export function isPublicIp(value) {
  const ip = normalizeIp(value);
  return Boolean(isIP(ip)) && !isLocal(ip) && ip !== '0.0.0.0' && ip !== '::';
}

export async function createGeolocation(filename, publicIp = '') {
  const reader = new Reader(await readFile(filename));
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
  return {
    lookup(ip, reportedIp = '') {
      const target = isPublicIp(ip) ? normalizeIp(ip)
        : isPublicIp(reportedIp) ? normalizeIp(reportedIp) : hostIp;
      if (!target) return '';
      return reader.get(target)?.country?.iso_code || '';
    },
    hostIp
  };
}
