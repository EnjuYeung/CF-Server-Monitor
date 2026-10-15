import { STORAGE } from './constants.js'

const sortKeys = new Set(['name', 'region'])
const nameCollator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'accent' })

const normalizeListSort = value => {
  if (!sortKeys.has(value?.key) || !['asc', 'desc'].includes(value?.direction)) return null
  return { key: value.key, direction: value.direction }
}

export const nextListSort = (current, key) => {
  if (!sortKeys.has(key)) return null
  const sort = normalizeListSort(current)
  if (sort?.key !== key) return { key, direction: 'asc' }
  return sort.direction === 'asc' ? { key, direction: 'desc' } : null
}

const regionCode = value => {
  const code = String(value ?? '').trim().toUpperCase()
  return code === 'XX' ? '' : code
}

export const sortListServers = (servers, preference) => {
  const result = [...servers]
  const sort = normalizeListSort(preference)
  if (!sort) return result
  const direction = sort.direction === 'asc' ? 1 : -1
  // A stable sort keeps equal values in the latest snapshot's default order.
  return result.sort((a, b) => {
    if (sort.key === 'name') return direction * nameCollator.compare(a.name ?? '', b.name ?? '')
    const aRegion = regionCode(a.region), bRegion = regionCode(b.region)
    const unknownOrder = Number(aRegion === '') - Number(bRegion === '')
    if (unknownOrder) return unknownOrder
    return direction * (aRegion < bRegion ? -1 : aRegion > bRegion ? 1 : 0)
  })
}

export const readListSortPreference = () => {
  try {
    return normalizeListSort(JSON.parse(globalThis.localStorage.getItem(STORAGE.LIST_SORT_PREFERENCE)))
  } catch {
    return null
  }
}

export const writeListSortPreference = preference => {
  try {
    const sort = normalizeListSort(preference)
    if (sort) globalThis.localStorage.setItem(STORAGE.LIST_SORT_PREFERENCE, JSON.stringify(sort))
    else globalThis.localStorage.removeItem(STORAGE.LIST_SORT_PREFERENCE)
  } catch {
    // Sorting remains available when browser storage is unavailable or full.
  }
}
