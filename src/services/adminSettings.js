import { randomBytes } from 'node:crypto';
import { readSecurity, writeSecurity } from './twoFactor.js';
import { clearAppearanceSettingsCache, saveSiteOptions } from '../utils/settings.js';
import { clearResourceAlertState } from './notifications/resource.js';

function readSiteOptions(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'site_options'").first();
  return row ? JSON.parse(row.value) : {};
}

// No asynchronous work may occur between the version check and these writes.
export function commitAdminSettings(env, expectedVersion, siteOptions, appearanceOptions, resetResourceAlerts = false) {
  return env.DB.transaction(() => {
    const security = readSecurity(env.DB);
    if (security.version !== expectedVersion) return null;
    const current = readSiteOptions(env.DB);
    const username = current.username || env.API_USER_NAME || 'admin';
    const nextUsername = siteOptions.username || env.API_USER_NAME || 'admin';
    const credentialsChanged = !!siteOptions.password ||
      (siteOptions.username !== undefined && nextUsername !== username);
    saveSiteOptions(env.DB, siteOptions);
    if (resetResourceAlerts) clearResourceAlertState(env.DB);
    if (appearanceOptions) {
      const row = env.DB.prepare("SELECT value FROM settings WHERE key = 'appearance_options'").first();
      const currentAppearance = row ? JSON.parse(row.value) : {};
      env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
        .bind('appearance_options', JSON.stringify({ ...currentAppearance, ...appearanceOptions })).run();
      clearAppearanceSettingsCache();
    }
    if (credentialsChanged) {
      // Keep enrolled factors and consumed recovery codes; pending setup belongs to the old session.
      delete security.pending;
      security.version = randomBytes(16).toString('hex');
      writeSecurity(env.DB, security);
    }
    return { credentialsChanged };
  });
}

// A representation-only upgrade must not overwrite credentials changed while hashing.
export function upgradePasswordHash(db, expectedVersion, expectedHash, upgradedHash) {
  return db.transaction(() => {
    if (readSecurity(db).version !== expectedVersion) return false;
    // Another login may already have rehashed the same credential. Real changes rotate the version.
    if (readSiteOptions(db).password !== expectedHash) return true;
    saveSiteOptions(db, { password: upgradedHash });
    return true;
  });
}
