<template>
  <div class="container">
    <TerminalHeader :title="sysConfig.site_title || DEFAULT_SITE_TITLE" />
    
    <div v-if="isLoading" class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-text">$ {{ trans.loading }}</div>
    </div>

    <div v-else-if="appConfig?.is_public === false && !adminAccess.authorized" class="empty-state">{{ trans.privateDashboard }}</div>
    <template v-else>
    <div class="nav-area">
      <div class="header-row">
        <div class="site-title">$ {{ sysConfig.site_title || DEFAULT_SITE_TITLE }}</div>
        <div class="controls-group">
          <div class="view-toggle">
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'bar' }"
              @click="switchView('bar')"
            >▤ {{ trans.barChart }}</button>
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'ring' }"
              @click="switchView('ring')"
            >◌ {{ trans.ringChart }}</button>
            <button
              class="toggle-btn"
              :class="{ active: currentView === 'table' }"
              @click="switchView('table')"
            >≡ {{ trans.table }}</button>
          </div>
        </div>
      </div>
      <div class="filter-wrap" ref="filterWrap">
        <div class="filter-bar" id="ajax-filters">
          <button
            v-for="item in visibleFilterOptions"
            :key="item.code"
            type="button"
            class="filter-tag"
            :class="{ active: selectedRegions.has(item.code), 'filter-tag-unknown': item.code === 'unknown' }"
            :aria-pressed="selectedRegions.has(item.code)"
            :data-filter="item.code"
            @click="setFilter(item.code)"
          >
            <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
            <img v-else-if="item.flagCode" :src="getPublicAssetUrl('flags/' + item.flagCode + '.svg')" :alt="item.code">
            <span class="filter-tag-label">{{ item.label }}</span>
            <span class="filter-tag-count">{{ item.count }}</span>
          </button>
          <div v-if="overflowFilterOptions.length > 0" class="filter-more" :class="{ active: isOverflowFilterActive }">
            <button
              type="button"
              class="filter-tag filter-more-btn"
              :class="{ active: isOverflowFilterActive }"
              :aria-expanded="filterMoreOpen"
              @click.stop="toggleFilterMore"
            >
              <span class="filter-tag-label">{{ filterMoreLabel }}</span>
              <span class="filter-tag-count">{{ overflowFilterOptions.length }}</span>
            </button>
            <div v-if="filterMoreOpen" class="filter-more-menu">
              <button
                v-for="item in overflowFilterOptions"
                :key="item.code"
                type="button"
                class="filter-tag filter-more-item"
                :class="{ active: selectedRegions.has(item.code), 'filter-tag-unknown': item.code === 'unknown' }"
                :aria-pressed="selectedRegions.has(item.code)"
            :data-filter="item.code"
                @click="setFilter(item.code)"
              >
                <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
                <img v-else-if="item.flagCode" :src="getPublicAssetUrl('flags/' + item.flagCode + '.svg')" :alt="item.code">
                <span class="filter-tag-label">{{ item.label }}</span>
                <span class="filter-tag-count">{{ item.count }}</span>
              </button>
            </div>
          </div>
        </div>
        <div ref="filterMeasure" class="filter-measure" aria-hidden="true">
          <button
            v-for="item in filterOptionEntries"
            :key="item.code"
            type="button"
            class="filter-tag filter-measure-tag"
          >
            <span v-if="item.code === 'unknown'" class="filter-tag-icon">🏳️</span>
            <img v-else-if="item.flagCode" :src="getPublicAssetUrl('flags/' + item.flagCode + '.svg')" :alt="item.code">
            <span class="filter-tag-label">{{ item.label }}</span>
            <span class="filter-tag-count">{{ item.count }}</span>
          </button>
          <button ref="filterMoreMeasure" type="button" class="filter-tag filter-more-btn">
            <span class="filter-tag-label">{{ filterMoreLabel }}</span>
            <span class="filter-tag-count">{{ filterOptionEntries.length }}</span>
          </button>
        </div>
      </div>
    </div>

    <div class="global-stats">
      <div class="stat-item">
        <div class="stat-label">{{ trans.servers }}</div>
        <div class="stat-main-value stat-main-value-sm stat-sub-info">
          <span class="stat-online-color">{{ trans.online }}:{{ stats.online }}</span> |
          <span class="stat-offline-color">{{ trans.offline }}:{{ stats.offline }}</span>
        </div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.totalTraffic }}</div>
        <div class="stat-main-value stat-main-value-sm">{{ formatBytes(stats.globalNetRx) }} ↓ | ↑ {{ formatBytes(stats.globalNetTx) }}</div>
      </div>
      <div class="stat-item">
        <div class="stat-label">{{ trans.realtimeSpeed }}</div>
        <div class="stat-main-value stat-main-value-sm">
          <span class="stat-net-down-color">↓ {{ formatBytes(stats.globalSpeedIn) }}/s</span> |
          <span class="stat-net-up-color">↑ {{ formatBytes(stats.globalSpeedOut) }}/s</span>
        </div>
      </div>
      <div
        v-if="sysConfig.show_price"
        class="stat-item stat-action-item"
        @click="financeModalOpen = true"
      >
        <div class="stat-label">{{ trans.remainingValue }}</div>
        <div class="stat-main-value stat-main-value-sm">
          {{ formattedRemainingValue.symbol }}{{ formattedRemainingValue.value }}
          <span class="finance-currency-code">{{ formattedRemainingValue.currency }}</span>
        </div>
      </div>
    </div>

    <div v-if="groupFilterOptions.length > 0" class="filter-bar group-filter-bar" role="group" :aria-label="trans.group">
      <button
        v-for="group in groupFilterOptions"
        :key="group.name"
        type="button"
        class="filter-tag"
        :class="{ active: selectedGroups.has(group.name) }"
        :aria-pressed="selectedGroups.has(group.name)"
        :title="group.name"
        :data-group="group.name"
        @click="setGroupFilter(group.name)"
      >
        <span class="filter-tag-label">{{ group.name }}</span>
        <span class="filter-tag-count">{{ group.count }}</span>
      </button>
    </div>

    <div id="view-card" class="view-panel" :class="{ active: isCardView, 'high-density': filteredServers.length > 12 }">
      <div v-if="servers.length === 0" class="empty-state">
        [!] {{ adminAccess.authorized ? trans.noServer : trans.noData }} <a v-if="adminAccess.authorized" :href="adminAccess.path" class="admin-link-color">{{ trans.backToAdmin }}</a>
      </div>
      <div v-else-if="filteredServers.length === 0" class="empty-state">[*] {{ trans.noData }}</div>
      <div v-else class="servers-grid">
        <component
          :is="currentCardComponent"
          v-for="server in filteredServers"
          :key="server.source + ':' + server.id + '-' + currentView"
          :server="server"
          :sys-config="sysConfig"
          :to="getServerLink(server)"
        />
      </div>
    </div>

    <div id="view-table" class="view-panel" :class="{ active: currentView === 'table' }">
      <div class="table-container">
        <table class="terminal-table">
          <thead>
            <tr>
              <th></th>
              <th>{{ trans.hostname }}</th>
              <th>{{ trans.region }}</th>
              <th>{{ trans.osArch }}</th>
              <th>{{ trans.cpu }}</th>
              <th>{{ trans.ram }}</th>
              <th>{{ trans.disk }}</th>
              <th>{{ trans.use }}</th>
              <th class="table-col-conn">TCP/UDP</th>
              <th width="95">{{ trans.dl }}</th>
              <th width="95">{{ trans.ul }}</th>
              <th width="70">{{ trans.update }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="isLoading">
              <td class="table-empty-state" colspan="12">
                <div class="loading-spinner-small"></div>
                <span>$ {{ trans.loading }}</span>
              </td>
            </tr>
            <tr v-else-if="filteredServers.length === 0">
              <td class="table-empty-state" colspan="12">[*] {{ trans.noData }}</td>
            </tr>
            <tr 
              v-for="server in filteredServers" 
              :key="server.source + ':' + server.id"
              @click="goToServer(server)"
              class="table-cursor-pointer"
              :data-region="(server.region || 'xx').toLowerCase()"
            >
              <td class="table-center-cell">
                <div class="status-indicator table-status-indicator-inline" :style="{ background: getStatusColor(server) }"></div>
              </td>
              <td><b class="table-server-name">{{ server.name }}</b></td>
              <td>
                <span v-if="server.region && server.region !== 'xx'" class="country-os-icons">
                  <img :src="getPublicAssetUrl('flags/' + getFlagRegionCode(server.region) + '.svg')" :alt="server.region" class="flag-img">
                </span>
                <span v-else class="country-os-icons">
                  <span class="flag-fallback">🏳️</span>
                </span>
                {{ (server.region || 'XX').toUpperCase() }}
              </td>
              <td>
                <span class="table-system-info">
                  <OsIcon :os="server.os" />
                  <span class="os-label">{{ formatSystemOs(server.os) }} / {{ server.arch || 'N/A' }} </span>
                </span>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container stat-bar-small table-usage-bar">
                  <div class="stat-bar-fill" :style="{ width: (parseFloat(server.cpu) || 0) + '%', background: getUsageColor(parseFloat(server.cpu) || 0) }"></div>
                </div>
                  <span>{{ (parseFloat(server.cpu) || 0).toFixed(1) }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: (server.ram_total > 0 ? ((server.ram_used / server.ram_total) * 100).toFixed(2) : 0) + '%', background: getUsageColor(server.ram_total > 0 ? ((server.ram_used / server.ram_total) * 100) : 0) }"></div>
                  </div>
                  <span>{{ server.ram_total > 0 ? ((server.ram_used / server.ram_total) * 100).toFixed(2) : '0.00' }}%</span>
                </div>
              </td>
              <td>
                <div class="table-stat">
                  <div class="stat-bar-container table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: (server.disk_total > 0 ? ((server.disk_used / server.disk_total) * 100).toFixed(2) : 0) + '%', background: getUsageColor(server.disk_total > 0 ? ((server.disk_used / server.disk_total) * 100) : 0) }"></div>
                  </div>
                  <span>{{ server.disk_total > 0 ? ((server.disk_used / server.disk_total) * 100).toFixed(2) : '0.00' }}%</span>
                </div>
              </td>
              <td v-if="sysConfig.show_tf && server.traffic_limit">
                <div class="table-stat">
                    <div class="stat-bar-container stat-bar-small table-usage-bar">
                    <div class="stat-bar-fill" :style="{ width: Math.min(100, calcTrafficUsagePercent(server)) + '%', background: getUsageColor(calcTrafficUsagePercent(server)) }"></div>
                  </div>
                  <span>{{ calcTrafficUsagePercent(server).toFixed(1) }}%</span>
                </div>
              </td>
              <td v-else>-</td>
              <td class="table-conn-cell">
                <span class="conn-pair">{{ formatConnPair(server) }}</span>
              </td>
              <td>{{ formatBytes(server.net_in_speed) }}/s</td>
              <td>{{ formatBytes(server.net_out_speed) }}/s</td>
              <td class="update-time label-small">{{ getUpdateTime(server.last_updated) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    </template>

    <div v-if="!isLoading && sitesRemaining > 0" class="loading-more">
      <div class="loading-spinner-small"></div>
      <span>{{ trans.loadingRemainingSites }} ({{ sitesRemaining }})</span>
    </div>

    <div v-if="hasCorsError" class="modal-overlay active">
      <div class="modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ cors --error</div>
          <button class="modal-close" @click="hasCorsError = null">✕</button>
        </div>
        <div v-for="site in hasCorsError" :key="site" class="danger-box mb-4">
          <div class="flex-center-gap-sm">
            <span class="danger-label">❌ {{ site }} {{ trans.corsBlocked }}</span>
          </div>
        </div>
        <div class="modal-footer flex-justify-end">
          <button @click="hasCorsError = null" class="btn">OK</button>
        </div>
      </div>
    </div>

    <div v-if="financeModalOpen" class="modal-overlay active" @click.self="financeModalOpen = false">
      <div class="modal-dialog finance-modal-dialog">
        <div class="modal-header">
          <div class="modal-title">$ finance --summary</div>
          <button class="modal-close" @click="financeModalOpen = false">✕</button>
        </div>

        <div class="finance-summary-grid">
          <div v-for="item in financeSummaryItems" :key="item.label" class="finance-summary-card">
            <div class="finance-summary-label">{{ item.label }}</div>
            <div class="finance-summary-value">
              <span class="finance-summary-symbol">{{ item.symbol }}</span>{{ item.value }}
            </div>
          </div>
        </div>

        <div class="finance-rate-toolbar">
          <div>
            <div class="finance-section-label">{{ trans.financeServerValues }}</div>
            <div class="finance-source-text">{{ trans.exchangeRateSource }}: {{ financeRateSourceText }}</div>
          </div>
          <label class="finance-currency-picker">
            <span>{{ trans.currency }}</span>
            <select :value="financeCurrency" class="form-select" @change="setFinanceCurrency">
              <option v-for="currency in financeRateCurrencies" :key="currency" :value="currency">
                {{ currency }}
              </option>
            </select>
          </label>
        </div>

        <ul v-if="financeServerRows.length" class="finance-server-grid">
          <li v-for="row in financeServerRows" :key="`${row.source || ''}:${row.id}`" class="finance-server-card">
            <dl class="finance-server-fields">
              <div class="finance-server-field">
                <dt>{{ trans.serverName }}</dt>
                <dd class="finance-server-name">{{ row.name }}</dd>
              </div>
              <div class="finance-server-field finance-server-days">
                <dt>{{ trans.financeRemainingDays }}</dt>
                <dd>{{ row.remainingDays === null ? '—' : `${row.remainingDays} ${trans.days}` }}</dd>
              </div>
              <div class="finance-server-field finance-server-value">
                <dt>{{ trans.remainingValue }}</dt>
                <dd>{{ row.amount.symbol }}{{ row.amount.value }}</dd>
              </div>
            </dl>
          </li>
        </ul>
        <div v-else class="finance-empty">{{ trans.financeNoPaidServers }}</div>

        <div class="modal-footer flex-justify-end">
          <button @click="financeModalOpen = false" class="btn">OK</button>
        </div>
      </div>
    </div>

    <Footer />
  </div>
</template>

<script setup>
import { adminAccess } from '../utils/adminAccess.js'
import { ref, computed, inject, nextTick, onMounted, onUnmounted, watch, toRefs } from 'vue'
import { useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import ServerBarCard from '../components/ServerBarCard.vue'
import ServerRingCard from '../components/ServerRingCard.vue'
import Footer from '../components/Footer.vue'
import OsIcon from '../components/OsIcon.vue'
import { formatBytes, getFlagRegionCode, getApiBases, isServerOnline } from '../utils/api.js'
import { calcTrafficUsagePercent, getUsageColor } from '../composables/useServerCardData'
import { getPublicAssetUrl } from '../utils/config'
import { currentLang, useTranslation } from '../utils/i18n.js'
import { DEFAULT_SITE_TITLE, STORAGE } from '../utils/constants'
import { normalizeDashboardView, normalizeDisplayMode } from '../utils/displayMode.js'
import { useDashboardState } from '../composables/useDashboardState.js'
import {
  DEFAULT_EXCHANGE_RATES,
  DISPLAY_FINANCE_CURRENCIES,
  calculateFinanceSummary,
  calculateServerFinanceRows,
  convertCnyAmount,
  formatFinanceAmount,
  getDailyExchangeRates,
  getStoredFinanceCurrency,
  normalizeFinanceCurrency,
  setStoredFinanceCurrency
} from '../utils/finance.js'

const appConfig = inject('appConfig', null)
const dashboard = useDashboardState(appConfig)
const { servers, stats, regionStats, unknownStats, now, isLoading, sitesRemaining } = toRefs(dashboard.state)
const sysConfig = computed(() => dashboard.state.config)
const currentView = ref('bar')
const selectedRegions = ref(new Set())
const selectedGroups = ref(new Set())
const filterWrap = ref(null)
const filterMeasure = ref(null)
const filterMoreMeasure = ref(null)
const filterVisibleCount = ref(Number.POSITIVE_INFINITY)
const filterMoreOpen = ref(false)
const hasCorsError = ref(null)
watch(() => dashboard.state.corsErrorSites, sites => { hasCorsError.value = sites.length ? [...sites] : null })
const financeModalOpen = ref(false)
const financeCurrency = ref('CNY')
const exchangeRates = ref(DEFAULT_EXCHANGE_RATES)
const exchangeRateSource = ref('default')
const router = useRouter()

const trans = useTranslation()
const financeRateCurrencies = DISPLAY_FINANCE_CURRENCIES
const financeSummary = computed(() => calculateFinanceSummary(servers.value, exchangeRates.value, now.value))
const formattedRemainingValue = computed(() => formatFinanceMetric(financeSummary.value.remainingValueCNY))
const formattedTotalValue = computed(() => formatFinanceMetric(financeSummary.value.totalValueCNY))
const formattedMonthlyAverageCost = computed(() => formatFinanceMetric(financeSummary.value.monthlyAverageCostCNY))

const createFinanceSummaryItem = (label, metric) => ({
  label,
  symbol: metric.symbol,
  value: metric.value
})

const financeSummaryItems = computed(() => [
  createFinanceSummaryItem(trans.value.totalValue, formattedTotalValue.value),
  createFinanceSummaryItem(trans.value.remainingValue, formattedRemainingValue.value),
  createFinanceSummaryItem(trans.value.monthlyAverageCost, formattedMonthlyAverageCost.value)
])

const financeServerRows = computed(() =>
  calculateServerFinanceRows(servers.value, exchangeRates.value, now.value).map(row => ({
    ...row,
    amount: formatFinanceMetric(row.remainingValueCNY)
  }))
)

const financeRateSourceText = computed(() => {
  const sourceText = {
    network: trans.value.financeRateNetwork,
    cache: trans.value.financeRateCache,
    'stale-cache': trans.value.financeRateStaleCache,
    default: trans.value.financeRateDefault
  }
  return sourceText[exchangeRateSource.value] || sourceText.default
})

const formatFinanceMetric = (amountCNY) => {
  return formatFinanceAmount(convertCnyAmount(amountCNY, financeCurrency.value, exchangeRates.value), financeCurrency.value)
}

const setFinanceCurrency = (event) => {
  const currency = normalizeFinanceCurrency(event?.target?.value)
  financeCurrency.value = currency
  setStoredFinanceCurrency(currency)
}

const loadFinanceRates = async () => {
  try {
    const { rates, source } = await getDailyExchangeRates()
    exchangeRates.value = rates
    exchangeRateSource.value = source
  } catch (e) {
    console.log('[INFO] Finance rates fallback:', e)
    exchangeRates.value = DEFAULT_EXCHANGE_RATES
    exchangeRateSource.value = 'default'
  }
}

const filterOptions = computed(() => {
  const normalizedStats = {}
  for (const code in regionStats.value) {
    const lower = code.toLowerCase()
    if (lower === 'xx') continue
    normalizedStats[lower] = regionStats.value[code]
  }
  const sortedRegionStats = Object.fromEntries(
    Object.entries(normalizedStats).sort(([codeA, countA], [codeB, countB]) => {
      if (countB !== countA) return countB - countA
      return codeA.localeCompare(codeB)
    })
  )
  const opts = { ...sortedRegionStats }
  if (unknownStats.value > 0) opts.unknown = unknownStats.value
  return opts
})

const getFilterLabel = (code) => {
  if (code === 'unknown') return '?'
  return code.toUpperCase()
}

const filterOptionEntries = computed(() => Object.entries(filterOptions.value).map(([code, count]) => ({
  code,
  count,
  label: getFilterLabel(code),
  flagCode: code !== 'all' && code !== 'unknown' ? getFlagRegionCode(code) : ''
})))

const filterMoreLabel = computed(() => trans.value.more)
const visibleFilterOptions = computed(() => filterOptionEntries.value.slice(0, filterVisibleCount.value))
const overflowFilterOptions = computed(() => filterOptionEntries.value.slice(filterVisibleCount.value))
const isOverflowFilterActive = computed(() => overflowFilterOptions.value.some(item => selectedRegions.value.has(item.code)))

let filterResizeObserver = null
let filterMeasureTimer = null

const getFilterMaxRows = () => window.matchMedia('(max-width: 768px)').matches ? 2 : 1

const getWrappedRowCount = (widths, wrapWidth, gap) => {
  if (widths.length === 0) return 0

  let rows = 1
  let rowWidth = 0

  for (const width of widths) {
    const nextWidth = rowWidth > 0 ? rowWidth + gap + width : width
    if (nextWidth <= wrapWidth || rowWidth === 0) {
      rowWidth = nextWidth
    } else {
      rows += 1
      rowWidth = width
    }
  }

  return rows
}

const updateFilterVisibleCount = () => {
  const entries = filterOptionEntries.value
  const wrapEl = filterWrap.value
  const measureEl = filterMeasure.value
  if (!wrapEl || !measureEl || entries.length === 0) {
    filterVisibleCount.value = entries.length
    return
  }

  const wrapWidth = wrapEl.clientWidth
  const itemEls = Array.from(measureEl.querySelectorAll('.filter-measure-tag'))
  if (wrapWidth <= 0 || itemEls.length === 0) return

  const gap = Number.parseFloat(window.getComputedStyle(measureEl).columnGap) || 0
  const itemWidths = itemEls.map(el => el.offsetWidth)
  const maxRows = getFilterMaxRows()

  if (getWrappedRowCount(itemWidths, wrapWidth, gap) <= maxRows) {
    filterVisibleCount.value = entries.length
    filterMoreOpen.value = false
    return
  }

  const moreWidth = filterMoreMeasure.value?.offsetWidth || 70
  let visibleCount = 0

  for (let index = 0; index < itemWidths.length; index += 1) {
    const nextVisibleCount = index + 1
    const testWidths = [...itemWidths.slice(0, nextVisibleCount), moreWidth]
    if (getWrappedRowCount(testWidths, wrapWidth, gap) > maxRows) break
    visibleCount = nextVisibleCount
  }

  filterVisibleCount.value = Math.max(1, Math.min(visibleCount, entries.length - 1))
}

const scheduleFilterMeasurement = () => {
  if (filterMeasureTimer) clearTimeout(filterMeasureTimer)
  filterMeasureTimer = setTimeout(async () => {
    filterMeasureTimer = null
    await nextTick()
    updateFilterVisibleCount()
  }, 0)
}

const toggleFilterMore = () => {
  filterMoreOpen.value = !filterMoreOpen.value
}

const closeFilterMoreOnOutsideClick = (event) => {
  if (!filterWrap.value?.contains(event.target)) filterMoreOpen.value = false
}

watch(
  () => filterOptionEntries.value.map(item => `${item.code}:${item.count}:${item.label}`).join('|'),
  scheduleFilterMeasurement,
  { flush: 'post' }
)

watch(filterMoreLabel, scheduleFilterMeasurement, { flush: 'post' })

const filteredServers = computed(() => {
  return servers.value.filter(server => {
    const matchesRegion = selectedRegions.value.size === 0
      || selectedRegions.value.has(server.region ? server.region.toLowerCase() : 'unknown')
    const matchesGroup = selectedGroups.value.size === 0
      || selectedGroups.value.has(server.server_group || 'Default')
    return matchesRegion && matchesGroup
  })
})

const groupFilterOptions = computed(() => {
  const counts = new Map()
  for (const server of servers.value) {
    const name = server.server_group || 'Default'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return Array.from(counts, ([name, count]) => ({ name, count }))
})

const isCardView = computed(() => currentView.value === 'bar' || currentView.value === 'ring')
const currentCardComponent = computed(() => currentView.value === 'ring' ? ServerRingCard : ServerBarCard)

const switchView = (viewName) => {
  const normalizedView = normalizeDashboardView(viewName, sysConfig.value.display_mode)
  currentView.value = normalizedView
  localStorage.setItem(STORAGE.VIEW_PREFERENCE, normalizedView)
}

const setFilter = (code) => {
  toggleSelection(selectedRegions.value, code.toLowerCase())
}

const setGroupFilter = (name) => {
  toggleSelection(selectedGroups.value, name)
}

const toggleSelection = (selection, value) => {
  if (selection.has(value)) selection.delete(value)
  else selection.add(value)
}

const getStatusColor = (server) => {
  return isServerOnline(server) ? 'var(--accent-green)' : 'var(--accent-red)'
}

const formatConnCount = (value) => {
  const number = Number.parseInt(value, 10)
  if (!Number.isFinite(number) || number < 0) return '0'
  return number.toLocaleString('en-US')
}

const formatConnPair = (server) => `${formatConnCount(server.tcp_conn)} / ${formatConnCount(server.udp_conn)}`

const formatSystemOs = (value) => {
  const raw = String(value || '').trim()
  if (!raw) return 'N/A'
  return raw
    .replace(/\s+gnu\/linux(?=\s|$)/gi, '')
    .replace(/\s+linux(?=\s|$)/gi, '')
    .replace(/\s+/g, ' ')
    .trim() || raw
}

const getUpdateTime = (lastUpdated) => {
  if (!lastUpdated) return '-'
  const date = new Date(lastUpdated)
  const diff = now.value - date.getTime()

  const lang = currentLang.value
  // 时间差为负或小于1秒时，显示0秒前
  if (diff < 1000) {
    return lang !== 'en' ? `0${trans.value.secondsAgo}` : `0 ${trans.value.secondsAgo}`
  }

  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)

  if (seconds < 60) {
    return lang !== 'en' ? `${seconds}${trans.value.secondsAgo}` : `${seconds} ${trans.value.secondsAgo}`
  } else if (minutes < 60) {
    return lang !== 'en' ? `${minutes}${trans.value.minutesAgo}` : `${minutes} ${trans.value.minutesAgo}`
  } else if (hours < 24) {
    return lang !== 'en' ? `${hours}${trans.value.hoursAgo}` : `${hours} ${trans.value.hoursAgo}`
  } else if (days < 30) {
    return lang !== 'en' ? `${days}${trans.value.daysAgo}` : `${days} ${trans.value.daysAgo}`
  } else {
    return date.toLocaleString(undefined, { hour12: false })
  }
}

let dashboardActive = true

const getServerLink = (server) => {
  const bases = getApiBases()
  if (bases.length === 0) return `/server/${server.id}`
  
  const apiIndex = bases.indexOf(server.source)
  if (apiIndex === -1 || apiIndex === 0) return `/server/${server.id}`
  
  return `/server/${server.id}?apiIndex=${apiIndex}`
}

const goToServer = (server) => {
  router.push(getServerLink(server))
}

onMounted(async () => {
  financeCurrency.value = getStoredFinanceCurrency()
  loadFinanceRates()

  const rawSavedView = localStorage.getItem(STORAGE.VIEW_PREFERENCE)
  const savedView = normalizeDashboardView(rawSavedView, sysConfig.value.display_mode)
  currentView.value = savedView
  if (rawSavedView && rawSavedView !== savedView) {
    localStorage.setItem(STORAGE.VIEW_PREFERENCE, savedView)
  }
  await dashboard.start()
  if (!dashboardActive) return
  await nextTick()
  if (!dashboardActive) return
  scheduleFilterMeasurement()
  if (window.ResizeObserver && filterWrap.value) {
    filterResizeObserver = new ResizeObserver(scheduleFilterMeasurement)
    filterResizeObserver.observe(filterWrap.value)
  } else {
    window.addEventListener('resize', scheduleFilterMeasurement)
  }
  document.addEventListener('click', closeFilterMoreOnOutsideClick)

})

onUnmounted(() => {
  dashboardActive = false
  document.removeEventListener('click', closeFilterMoreOnOutsideClick)
  window.removeEventListener('resize', scheduleFilterMeasurement)
  if (filterMeasureTimer) clearTimeout(filterMeasureTimer)
  if (filterResizeObserver) filterResizeObserver.disconnect()
})
</script>
