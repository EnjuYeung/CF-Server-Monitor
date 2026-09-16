import { resolve } from 'node:path';
import { downloadCountryDatabase, writeCountryDatabase } from '../src/services/geoipDatabase.js';

const output = resolve(process.env.GEOIP_PATH || 'geoip/dbip-country-lite.mmdb');
const month = process.env.GEOIP_MONTH || new Date().toISOString().slice(0, 7);
const { data } = await downloadCountryDatabase(month);
await writeCountryDatabase(output, data);
console.log(`GeoIP database ready: ${output} (${month}, ${data.length} bytes)`);
