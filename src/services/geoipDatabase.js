import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { gunzip } from 'node:zlib';
import { promisify } from 'node:util';
import { Reader } from 'maxmind';

const unzip = promisify(gunzip);
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;
const MAX_DATABASE_BYTES = 64 * 1024 * 1024;

export function parseCountryDatabase(data) {
  if (!data.length || data.length > MAX_DATABASE_BYTES) throw new Error('Invalid GeoIP database size');
  const reader = new Reader(data);
  if (!Number.isFinite(reader.metadata.buildEpoch.getTime()) || reader.metadata.ipVersion !== 6 ||
      !['8.8.8.8', '2001:4860:4860::8888'].every(ip => /^[A-Z]{2}$/.test(reader.get(ip)?.country?.iso_code || ''))) {
    throw new Error('Invalid IPv4/IPv6 country database');
  }
  return { data, reader };
}

export async function readCountryDatabase(filename) {
  return parseCountryDatabase(await readFile(filename));
}

export async function downloadCountryDatabase(month, { signal } = {}) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Invalid GeoIP month');
  const timeout = AbortSignal.timeout(120000);
  const downloadSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const response = await fetch(`https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`, { signal: downloadSignal });
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
    await response.body?.cancel();
    throw new Error(response.ok ? 'GeoIP download exceeds size limit' : `GeoIP download failed: HTTP ${response.status}`);
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_DOWNLOAD_BYTES) throw new Error('GeoIP download exceeds size limit');
    chunks.push(chunk);
  }
  downloadSignal.throwIfAborted();
  const data = await unzip(Buffer.concat(chunks), { maxOutputLength: MAX_DATABASE_BYTES });
  downloadSignal.throwIfAborted();
  return parseCountryDatabase(data);
}

export async function writeCountryDatabase(filename, data, { signal } = {}) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    signal?.throwIfAborted();
    await mkdir(dirname(filename), { recursive: true });
    await writeFile(temporary, data, { flag: 'wx', mode: 0o644, flush: true });
    signal?.throwIfAborted();
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}
