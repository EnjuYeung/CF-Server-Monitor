import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Reader } from 'maxmind';

const output = resolve(process.env.GEOIP_PATH || 'geoip/dbip-country-lite.mmdb');
const month = process.env.GEOIP_MONTH || new Date().toISOString().slice(0, 7);
const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`;
const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
if (!response.ok) throw new Error(`GeoIP download failed: HTTP ${response.status}`);
const data = gunzipSync(Buffer.from(await response.arrayBuffer()), { maxOutputLength: 64 * 1024 * 1024 });
const reader = new Reader(data);
if (!reader.get('8.8.8.8')?.country?.iso_code) throw new Error('Invalid country database');
await mkdir(dirname(output), { recursive: true });
await writeFile(`${output}.tmp`, data);
await rename(`${output}.tmp`, output);
console.log(`GeoIP database ready: ${output} (${month}, ${data.length} bytes)`);
