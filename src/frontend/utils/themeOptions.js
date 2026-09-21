export const normalizeThemeOptions = (options) => {
  return options && typeof options === 'object' && !Array.isArray(options)
    ? options
    : {}
}

const MIKUS_ASSET_BASE = '/mikus'
export const isThemeOptionEnabled = (options, key) => {
  const normalizedOptions = normalizeThemeOptions(options)
  if (!Object.prototype.hasOwnProperty.call(normalizedOptions, key)) return false

  const value = normalizedOptions[key]
  if (value === null || value === undefined) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalizedValue = value.trim().toLowerCase()
    if (!normalizedValue) return false
    return !['0', 'false', 'off', 'no', 'disable', 'disabled'].includes(normalizedValue)
  }

  return true
}

export const isMikusThemeEnabled = (options) => isThemeOptionEnabled(options, 'mikus')

export const getMikusAssetUrl = (filename) => {
  const normalizedFilename = String(filename || '').replace(/^\/+/, '')
  return `${MIKUS_ASSET_BASE}/${normalizedFilename}`
}

export const setMikusThemeClass = (enabled) => {
  if (typeof document === 'undefined') return
  const shouldEnable = Boolean(enabled)
  document.body.classList.toggle('mikus-theme', shouldEnable)
  // AmbientBackground owns decoration for both themes; no second canvas loop.
}

export const applyMikusThemeOptions = (options) => {
  setMikusThemeClass(isMikusThemeEnabled(options))
}
