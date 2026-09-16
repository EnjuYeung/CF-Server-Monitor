import { createHmac, createHash, randomBytes, timingSafeEqual, hkdfSync, createCipheriv, createDecipheriv } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STATE_KEY = 'admin_security';
export const digest = value => createHash('sha256').update(value).digest('hex');

export function encodeBase32(bytes) {
  let bits = 0, value = 0, result = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { bits -= 5; result += ALPHABET[(value >>> bits) & 31]; }
  }
  if (bits) result += ALPHABET[(value << (5 - bits)) & 31];
  return result;
}

function decodeBase32(secret) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const char of secret) {
    const digit = ALPHABET.indexOf(char);
    if (digit < 0) throw new Error('Invalid TOTP secret');
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) { bits -= 8; bytes.push((value >>> bits) & 255); }
  }
  return Buffer.from(bytes);
}

// RFC 6238 / RFC 4226: SHA-1, 30 seconds, six digits (including leading zeroes).
export function totpCode(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', decodeBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
}

export function matchTotp(secret, code, lastStep = -1, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30000);
  for (const step of [current, current - 1, current + 1]) {
    if (step >= 0 && step > lastStep && timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}

function encryptionKey(env) {
  return hkdfSync('sha256', env.API_SECRET, 'server-monitor', 'totp-secret-v1', 32);
}

export function sealSecret(secret, env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

function openSecret(sealed, env) {
  const data = Buffer.from(sealed, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(env), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(12, 28));
  return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8');
}

export function readSecurity(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').bind(STATE_KEY).first();
  return row ? JSON.parse(row.value) : { version: 'initial', secret: null, lastStep: -1, recovery: [] };
}

export function writeSecurity(db, state) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind(STATE_KEY, JSON.stringify(state)).run();
}

export function securityStatus(db) {
  const state = readSecurity(db);
  return { enabled: !!state.secret, recoveryCodesRemaining: state.recovery.length };
}

export function startSetup(env, owner, username, origin) {
  const secret = encodeBase32(randomBytes(20));
  const expiresAt = Date.now() + 10 * 60000;
  const issuer = 'Server Monitor';
  const uri = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(`${username}@${new URL(origin).host}`)}?${new URLSearchParams({secret, issuer, algorithm: 'SHA1', digits: '6', period: '30'})}`;
  const state = readSecurity(env.DB);
  if (state.secret) return null;
  state.pending = { secret: sealSecret(secret, env), owner: digest(owner), expiresAt };
  writeSecurity(env.DB, state);
  return { secret, uri, expiresAt };
}

export function enableTwoFactor(env, owner, code) {
  return env.DB.transaction(() => {
    const state = readSecurity(env.DB);
    if (state.secret || !state.pending || state.pending.expiresAt <= Date.now() || state.pending.owner !== digest(owner)) return null;
    const step = matchTotp(openSecret(state.pending.secret, env), code);
    if (step === null) return null;
    const recoveryCodes = Array.from({length: 10}, () => randomBytes(10).toString('hex').match(/.{5}/g).join('-'));
    writeSecurity(env.DB, { version: randomBytes(16).toString('hex'), secret: state.pending.secret, lastStep: step, recovery: recoveryCodes.map(code => digest(code.replaceAll('-', ''))) });
    return recoveryCodes;
  });
}

// Read/verify/consume is synchronous and atomic, including across concurrent HTTP logins.
export function consumeFactor(env, code, recoveryCode, disable = false) {
  return env.DB.transaction(() => {
    const state = readSecurity(env.DB);
    if (!state.secret) return false;
    if (recoveryCode) {
      if (typeof recoveryCode !== 'string') return false;
      const normalized = recoveryCode.replaceAll('-', '').trim().toLowerCase();
      if (!/^[a-f0-9]{20}$/.test(normalized)) return false;
      const hash = digest(normalized);
      const index = state.recovery.indexOf(hash);
      if (index < 0) return false;
      state.recovery.splice(index, 1);
    } else {
      const step = matchTotp(openSecret(state.secret, env), code, state.lastStep);
      if (step === null) return false;
      state.lastStep = step;
    }
    writeSecurity(env.DB, disable ? {version: randomBytes(16).toString('hex'), secret: null, lastStep: -1, recovery: []} : state);
    return true;
  });
}
