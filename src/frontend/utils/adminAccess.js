import { reactive } from 'vue'

const entry = typeof document === 'undefined' ? '' : document.querySelector('meta[name="adminEntry"]')?.content || ''
export const isAdminEntryPage = !!entry
export const adminAccess = reactive({ path: entry, authorized: false })

export function updateAdminAccess(config) {
  adminAccess.authorized = config?.authorization === true
  adminAccess.path = (adminAccess.authorized ? config.admin_path : '') || entry
}

export function adminEndpoint(suffix = '') {
  if (!adminAccess.path) throw new Error('Secure admin entry required')
  return `${adminAccess.path}${suffix}`
}
