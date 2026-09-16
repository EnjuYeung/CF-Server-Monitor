export function normalizeAdminPath(value) {
  const segment = String(value || '').replace(/^\//, '');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(segment) || /^replace[-_]/i.test(segment)) {
    throw new Error('ADMIN_PATH is required: use a random 8–128 character path (letters, digits, _ or -) in .env');
  }
  return `/${segment}`;
}

export function isAdminEntry(path, env) {
  return !!env.ADMIN_PATH && (path === env.ADMIN_PATH || path === `${env.ADMIN_PATH}/`);
}
