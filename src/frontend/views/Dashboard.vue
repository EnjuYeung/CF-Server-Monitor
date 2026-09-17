<template>
  <div class="container" :class="{ 'mikus-dashboard': isMikusTheme }">
    <TerminalHeader :title="sysConfig.site_title || DEFAULT_SITE_TITLE" />
    
    <div v-if="isLoading" class="loading-state" :class="{ 'mikus-loading-state': isMikusTheme }">
      <template v-if="isMikusTheme">
        <div class="mikus-loading-inner">
          <img class="mikus-loading-gif" :src="mikusAsset('loli.gif')" alt="Loading">
          <div class="mikus-loading-brand">
            <img class="mikus-loading-logo" :src="mikusAsset('miku.png')" alt="">
            <span>{{ sysConfig.site_title || 'Komari' }}</span>
          </div>
          <div class="mikus-loading-progress" aria-hidden="true">
            <div class="mikus-loading-progress-fill"></div>
          </div>
          <div class="mikus-loading-status">$ {{ trans.loading }}</div>
        </div>
      </template>
      <template v-else>
        <div class="loading-spinner"></div>
        <div class="loading-text">$ {{ trans.loading }}</div>
      </template>
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
            :class="{ active: currentFilter === item.code, 'filter-tag-unknown': item.code === 'unknown' }"
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
                :class="{ active: currentFilter === item.code, 'filter-tag-unknown': item.code === 'unknown' }"
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

    <div class="global-stats" :class="{ 'mikus-global-stats': isMikusTheme }">
      <div v-if="isMikusTheme" class="mikus-stats-mascot" aria-hidden="true">
        <img class="mikus-stats-mascot-img" :src="mikusAsset('QWQ.webp')" alt="">
      </div>
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
        :class="{ active: currentGroupFilter === group.name }"
        :aria-pressed="currentGroupFilter === group.name"
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
          :key="server.id + '-' + currentView"
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
              :key="server.id"
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
            <div class="finance-section-label">{{ trans.todayExchangeRates }}</div>
            <div class="finance-source-text">{{ trans.exchangeRateSource }}: {{ financeRateSourceText }}</div>
          </div>
          <label class="finance-currency-picker">
            <span>{{ trans.exchangeRateBase }}</span>
            <select :value="financeCurrency" class="form-select" @change="setFinanceCurrency">
              <option v-for="currency in financeRateCurrencies" :key="currency" :value="currency">
                {{ currency }}
              </option>
            </select>
          </label>
        </div>

        <div class="finance-rate-grid">
          <div v-for="row in exchangeRateRows" :key="row.currency" class="finance-rate-row">
            <span>{{ row.currency }}</span>
            <b>{{ row.targetSymbol }}{{ row.rate }}</b>
          </div>
        </div>

        <div class="finance-modal-meta">
          <span>{{ trans.configuredPrices }}: {{ financeSummary.configuredCount }}</span>
          <span>{{ trans.expired }}: {{ financeSummary.expiredCount }}</span>
          <span>{{ trans.financeMissingExpire }}: {{ financeSummary.missingExpireCount }}</span>
        </div>

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
import { ref, computed, inject, nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import TerminalHeader from '../components/TerminalHeader.vue'
import ServerBarCard from '../components/ServerBarCard.vue'
import ServerRingCard from '../components/ServerRingCard.vue'
import Footer from '../components/Footer.vue'
import OsIcon from '../components/OsIcon.vue'
import { fetchConfig, fetchServersAll, fetchServersAllWithProgress, formatBytes, createLiveSocket, getFlagRegionCode, getApiBases, isServerOnline } from '../utils/api.js'
import { calcTrafficUsagePercent, getUsageColor } from '../composables/useServerCardData'
import { getTitle, hasMultipleApiBases, getPublicAssetUrl } from '../utils/config'
import { currentLang, useTranslation } from '../utils/i18n.js'
import { TIME, DEFAULT_SITE_TITLE, STORAGE, LATENCY_WINDOW } from '../utils/constants'
import { normalizeTimestamp as normalizeMetricTimestamp } from '../utils/time.js'
import { normalizeDashboardView, normalizeDisplayMode, resolveDisplayMode } from '../utils/displayMode.js'
import { getPlaybackElapsedMs, resolvePlaybackCursor } from '../utils/playback.js'
import { refreshLatencyWindow, updateLatencyWindow } from '../utils/latencyWindow.js'
import { reconcileDashboardSnapshot } from '../utils/dashboardSnapshot.js'
import { getMikusAssetUrl, isMikusThemeEnabled, normalizeThemeOptions, setMikusThemeClass } from '../utils/themeOptions.js'
import {
  CURRENCY_SYMBOLS,
  DEFAULT_EXCHANGE_RATES,
  DISPLAY_FINANCE_CURRENCIES,
  calculateFinanceSummary,
  convertCnyAmount,
  formatFinanceAmount,
  getDailyExchangeRates,
  getStoredFinanceCurrency,
  normalizeFinanceCurrency,
  setStoredFinanceCurrency
} from '../utils/finance.js'

const servers = ref([])
const stats = ref({ total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 })
const unknownStats = ref(0)
const appConfig = inject('appConfig', null)
const sysConfig = ref({
  show_price: true,
  show_expire: true,
  show_tf: true,
  show_three_net_details: true,
  custom_ct_name: appConfig?.custom_ct_name || '电信',
  custom_cu_name: appConfig?.custom_cu_name || '联通',
  custom_cm_name: appConfig?.custom_cm_name || '移动',
  custom_bd_name: appConfig?.custom_bd_name || 'BGP',
  display_mode: 'bar',
  site_title: DEFAULT_SITE_TITLE,
  theme_options: normalizeThemeOptions(appConfig?.theme_options),
  latency_window: appConfig?.latency_window || {
    points: LATENCY_WINDOW.POINTS,
    hours: LATENCY_WINDOW.HOURS
  }
})
const regionStats = ref({})
const currentView = ref('bar')
const currentFilter = ref('all')
const currentGroupFilter = ref(null)
const filterWrap = ref(null)
const filterMeasure = ref(null)
const filterMoreMeasure = ref(null)
const filterVisibleCount = ref(Number.POSITIVE_INFINITY)
const filterMoreOpen = ref(false)
const liveConnected = ref(false)
const isLoading = ref(true)
const sitesRemaining = ref(0)
const hasCorsError = ref(null)
const financeModalOpen = ref(false)
const financeCurrency = ref('CNY')
const exchangeRates = ref(DEFAULT_EXCHANGE_RATES)
const exchangeRateSource = ref('default')
const now = ref(Date.now())
const router = useRouter()

const trans = useTranslation()
const financeRateCurrencies = DISPLAY_FINANCE_CURRENCIES
const isMikusTheme = computed(() => isMikusThemeEnabled(sysConfig.value.theme_options))

const mikusAsset = (filename) => getMikusAssetUrl(filename)

watch(isMikusTheme, (enabled) => {
  setMikusThemeClass(enabled)
}, { immediate: true })

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

const exchangeRateRows = computed(() => {
  const baseRate = exchangeRates.value[financeCurrency.value] || DEFAULT_EXCHANGE_RATES[financeCurrency.value] || 1
  return financeRateCurrencies.map(currency => {
    const targetRate = exchangeRates.value[currency] || DEFAULT_EXCHANGE_RATES[currency] || 1
    const rate = targetRate / baseRate
    return {
      currency,
      targetSymbol: CURRENCY_SYMBOLS[currency] || '',
      rate: new Intl.NumberFormat('zh-CN', {
        maximumFractionDigits: 6,
        minimumFractionDigits: 6
      }).format(rate)
    }
  })
})

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
const isOverflowFilterActive = computed(() => overflowFilterOptions.value.some(item => item.code === currentFilter.value))

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
    const matchesRegion = currentFilter.value === 'all'
      || (currentFilter.value === 'unknown'
        ? !server.region
        : (server.region || 'xx').toLowerCase() === currentFilter.value)
    const matchesGroup = currentGroupFilter.value === null
      || (server.server_group || 'Default') === currentGroupFilter.value
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
  const nextFilter = code.toLowerCase()
  currentFilter.value = currentFilter.value === nextFilter ? 'all' : nextFilter
  filterMoreOpen.value = false
}

const setGroupFilter = (name) => {
  currentGroupFilter.value = currentGroupFilter.value === name ? null : name
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

const PLAYBACK_TICK_MS = 1000
const MAX_BUFFER_SAMPLES_PER_SERVER = 600
const playbackBuffers = new Map()
const latestAppliedSamples = new Map()

const getServerReportTimestamp = (server, fallback = null) => {
  return normalizeMetricTimestamp(server?.report_timestamp ?? server?.last_updated, fallback)
}

const getServerSampleTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.sample_timestamp ?? server?.timestamp ?? server?.last_updated, null)
}

const getServerDisplayTimestamp = (server) => {
  return normalizeMetricTimestamp(server?.display_timestamp, null)
}

const withDisplayTiming = (server, displayTs = null, currentTs = Date.now()) => {
  const reportTs = getServerReportTimestamp(server, null)
  const sampleTs = getServerSampleTimestamp(server) || displayTs || reportTs
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server) || sampleTs || reportTs)
  const timed = {
    ...server,
    current_timestamp: currentTs
  }
  if (reportTs) {
    timed.report_timestamp = reportTs
    timed.last_updated = reportTs
  }
  if (!sampleTs || !ownTs) return timed
  return {
    ...timed,
    sample_timestamp: sampleTs,
    display_timestamp: ownTs,
    sample_lag_seconds: Math.max(0, Math.floor((ownTs - sampleTs) / 1000))
  }
}

const toLiveSample = (serverId, data, timestamp, reportTs) => {
  if (!serverId || !data) return
  const ts = normalizeMetricTimestamp(timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp, null)
  if (!ts) return null
  return {
    serverId,
    ts,
    data,
    reportTs
  }
}

const queueLiveSamples = (serverId, samples, reportTs, { replayCachedReport = false, reportAgeMs = 0 } = {}) => {
  if (!serverId || !Array.isArray(samples) || samples.length === 0) return

  const normalized = samples
    .map(sample => toLiveSample(serverId, sample.data, sample.ts, reportTs))
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts)

  if (normalized.length === 0) return

  const current = servers.value.find(s => s.id === serverId)
  const currentTs = getServerSampleTimestamp(current)
  const currentDisplayTs = getServerDisplayTimestamp(current)
  const incoming = replayCachedReport
    ? normalized
    : normalized.filter(sample => !currentTs || sample.ts > currentTs)
  if (incoming.length === 0) return

  const playbackStartTs = resolvePlaybackCursor(incoming[0].ts, currentDisplayTs, {
    replayCachedReport,
    reportAgeMs
  })
  if (playbackStartTs === null) return

  if (incoming.length === 1) {
    playbackBuffers.delete(serverId)
    const sample = incoming[0]
    applyServerSample(serverId, sample.data, sample.ts, playbackStartTs, reportTs)
    return
  }

  const unique = []
  const seen = new Set()
  for (const sample of incoming) {
    if (seen.has(sample.ts)) continue
    seen.add(sample.ts)
    unique.push(sample)
  }
  playbackBuffers.set(serverId, unique.slice(-MAX_BUFFER_SAMPLES_PER_SERVER))
  applyPlaybackSamplesForServer(serverId, playbackStartTs)
}

const queueLiveMessage = (msg, { replayCachedReport = false } = {}) => {
  if (!msg || msg.type !== 'batchUpdate') return

  const messageReportTs = normalizeMetricTimestamp(msg.ts, Date.now())

  const updates = Array.isArray(msg.updates) ? msg.updates : []

  for (const update of updates) {
    if (!update || !update.serverId) continue
    const samples = Array.isArray(update.samples) ? update.samples : []
    const reportTs = normalizeMetricTimestamp(update.reportTs ?? update.report_timestamp, messageReportTs)
    const reportAgeMs = replayCachedReport ? update.reportAgeMs : 0

    const liveSamples = []
    for (const sample of samples) {
      if (!sample || typeof sample !== 'object') continue
      const data = sample.data || sample.payload || sample.metrics
      if (!data) continue
      liveSamples.push({
        ts: sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp ?? update.ts ?? msg.ts,
        data
      })
    }
    queueLiveSamples(update.serverId, liveSamples, reportTs, { replayCachedReport, reportAgeMs })
  }
}

const replayLatestReportUpdates = (data, { preserveLive = false } = {}) => {
  const updates = Array.isArray(data?.latestReportUpdates) ? data.latestReportUpdates : []
  if (updates.length === 0) return
  queueLiveMessage({ type: 'batchUpdate', ts: Date.now(), updates }, { replayCachedReport: !preserveLive })
}

const applyServerSample = (serverId, data, sampleTs, displayTs, reportTs = null) => {
  if (!serverId || !data) return
  const idx = servers.value.findIndex(s => s.id === serverId)
  const existing = idx >= 0 ? servers.value[idx] : null
  const currentReportTs = getServerReportTimestamp(existing, null)
  const nextReportTs = normalizeMetricTimestamp(reportTs, currentReportTs || now.value)
  const merged = withDisplayTiming({
    ...data,
    id: serverId,
    report_timestamp: nextReportTs,
    last_updated: nextReportTs,
    sample_timestamp: sampleTs,
    timestamp: sampleTs
  }, displayTs, now.value)
  latestAppliedSamples.set(serverId, merged)

  if (idx >= 0) {
    servers.value[idx] = {
      ...existing, ...merged,
      ...updateLatencyWindow(existing, data, sampleTs, sysConfig.value.latency_window, Date.now())
    }
  } else {
    servers.value.push({ ...merged, name: serverId,
      ...updateLatencyWindow({}, data, sampleTs, sysConfig.value.latency_window, Date.now())
    })
  }
}

const applyPlaybackSamplesForServer = (serverId, displayTs = null) => {
  const samples = playbackBuffers.get(serverId)
  if (!samples || samples.length === 0) return
  const server = servers.value.find(s => s.id === serverId)
  const ownTs = normalizeMetricTimestamp(displayTs, getServerDisplayTimestamp(server))
  if (!ownTs) return

  let selected = null
  while (samples.length > 0 && samples[0].ts <= ownTs) {
    selected = samples.shift()
  }
  if (selected && selected.ts >= (getServerSampleTimestamp(server) || 0)) {
    applyServerSample(serverId, selected.data, selected.ts, ownTs, selected.reportTs)
  }
  if (samples.length === 0) playbackBuffers.delete(serverId)
}

const applyPlaybackSamples = () => {
  for (const serverId of Array.from(playbackBuffers.keys())) {
    applyPlaybackSamplesForServer(serverId)
  }
}

const advanceServerClocks = () => {
  const currentTs = now.value
  servers.value = servers.value.map(server => {
    const reportTs = getServerReportTimestamp(server, null)
    const isOnline = reportTs && (currentTs - reportTs) < TIME.ONLINE_THRESHOLD_MS
    const currentDisplayTs = getServerDisplayTimestamp(server) || getServerSampleTimestamp(server) || reportTs
    const elapsedMs = getPlaybackElapsedMs(currentTs, server.current_timestamp, PLAYBACK_TICK_MS)
    const nextDisplayTs = isOnline && currentDisplayTs ? currentDisplayTs + elapsedMs : currentDisplayTs
    const latency = sysConfig.value.show_three_net_details
      ? updateLatencyWindow(server, null, null, sysConfig.value.latency_window, currentTs) : {}
    return withDisplayTiming({ ...server, ...latency }, nextDisplayTs, currentTs)
  })
  applyPlaybackSamples()
}

const recomputeStats = (currentTs = Date.now()) => {
  const list = servers.value || []
  let online = 0
  let speedIn = 0, speedOut = 0, netRx = 0, netTx = 0
  const regionCounts = {}
  let unknownCount = 0
  for (const s of list) {
    const ts = new Date(s.last_updated || 0).getTime()
    const isOnline = ts && (currentTs - ts) < TIME.ONLINE_THRESHOLD_MS
    if (isOnline) {
      online++
      speedIn += parseFloat(s.net_in_speed) || 0
      speedOut += parseFloat(s.net_out_speed) || 0
    }
    netRx += parseFloat(s.net_rx) || 0
    netTx += parseFloat(s.net_tx) || 0
    if (s.region) {
      const key = String(s.region).toUpperCase()
      regionCounts[key] = (regionCounts[key] || 0) + 1
    } else {
      unknownCount++
    }
  }
  stats.value = {
    total: list.length,
    online,
    offline: list.length - online,
    globalNetRx: netRx,
    globalNetTx: netTx,
    globalSpeedIn: speedIn,
    globalSpeedOut: speedOut
  }
  regionStats.value = regionCounts
  unknownStats.value = unknownCount
}

const runDashboardTick = () => {
  now.value = Date.now()
  advanceServerClocks()
  recomputeStats(now.value)
}

const mergeServersIntoList = (rawServers, { preserveLive = false } = {}) => {
  const existingById = new Map(servers.value.map(s => [s.id, s]))
  const visibleIds = new Set(rawServers.map(s => s.id))
  for (const id of latestAppliedSamples.keys()) {
    if (!visibleIds.has(id)) latestAppliedSamples.delete(id)
  }
  return rawServers.map(s => {
    const prev = existingById.get(s.id)
    if (preserveLive) {
      const merged = reconcileDashboardSnapshot(s, prev, latestAppliedSamples.get(s.id), sysConfig.value.latency_window, now.value)
      return withDisplayTiming(merged, merged.display_timestamp, now.value)
    }
    const sampleTs = normalizeMetricTimestamp(s.sample_timestamp ?? s.timestamp ?? s.last_updated, getServerSampleTimestamp(prev))
    const reportTs = normalizeMetricTimestamp(s.report_timestamp ?? s.last_updated, getServerReportTimestamp(prev, null))
    return withDisplayTiming({ ...prev, ...s, sample_timestamp: sampleTs, report_timestamp: reportTs }, sampleTs, now.value)
  })
}

const loadDashboardConfig = async () => {
  try {
    const localTitle = String(getTitle() || '').trim()
    const config = appConfig || await fetchConfig()
    const siteTitle = String(config?.site_title || '').trim()
    sysConfig.value = {
      ...sysConfig.value,
      site_title: hasMultipleApiBases() && localTitle ? localTitle : (siteTitle || sysConfig.value.site_title),
      display_mode: resolveDisplayMode(config),
      theme_options: normalizeThemeOptions(config?.theme_options),
      latency_window: config?.latency_window || sysConfig.value.latency_window
    }
  } catch (e) {
    console.log('[INFO] Dashboard config pending...', e)
  }
}

const loadDashboardData = async (options = {}) => {
  const bases = getApiBases()
  const isMultiSite = bases.length > 1
  playbackBuffers.clear()

  if (isMultiSite) {
    sitesRemaining.value = bases.length
    hasCorsError.value = null

    try {
      const data = await fetchServersAllWithProgress((data) => {
        if (!dashboardActive) return
        const rawServers = Array.isArray(data.servers)
          ? data.servers
          : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

        servers.value = mergeServersIntoList(rawServers, options)
        recomputeStats(now.value)

        sysConfig.value = {
          show_price: data.sysConfig?.show_price ?? true,
          show_expire: data.sysConfig?.show_expire ?? true,
          show_tf: data.sysConfig?.show_tf ?? true,
          show_three_net_details: data.sysConfig?.show_three_net_details ?? false,
          custom_ct_name: data.sysConfig?.custom_ct_name || sysConfig.value.custom_ct_name,
          custom_cu_name: data.sysConfig?.custom_cu_name || sysConfig.value.custom_cu_name,
          custom_cm_name: data.sysConfig?.custom_cm_name || sysConfig.value.custom_cm_name,
          custom_bd_name: data.sysConfig?.custom_bd_name || sysConfig.value.custom_bd_name,
          display_mode: normalizeDisplayMode(data.sysConfig?.display_mode),
          site_title: sysConfig.value.site_title || DEFAULT_SITE_TITLE,
          theme_options: sysConfig.value.theme_options,
          latency_window: data.sysConfig?.latency_window || sysConfig.value.latency_window
        }

        if (data.corsErrorSites?.length && !hasCorsError.value) hasCorsError.value = [...data.corsErrorSites]
        if (isLoading.value) isLoading.value = false
        sitesRemaining.value = Math.max(0, sitesRemaining.value - 1)
      })
      if (dashboardActive) replayLatestReportUpdates(data, options)
    } catch (e) {
      console.log('[INFO] Multi-site refresh error:', e)
    }

    isLoading.value = false
    return
  }

  // Single-site fallback
  try {
    const data = await fetchServersAll()
    if (!data || !dashboardActive) {
      isLoading.value = false
      return
    }

    const rawServers = Array.isArray(data.servers)
      ? data.servers
      : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))

    now.value = Date.now()
    servers.value = mergeServersIntoList(rawServers, options)
    replayLatestReportUpdates(data, options)
    recomputeStats(now.value)

    sysConfig.value = {
      show_price: data.sysConfig?.show_price ?? true,
      show_expire: data.sysConfig?.show_expire ?? true,
      show_tf: data.sysConfig?.show_tf ?? true,
      show_three_net_details: data.sysConfig?.show_three_net_details ?? false,
      custom_ct_name: data.sysConfig?.custom_ct_name || sysConfig.value.custom_ct_name,
      custom_cu_name: data.sysConfig?.custom_cu_name || sysConfig.value.custom_cu_name,
      custom_cm_name: data.sysConfig?.custom_cm_name || sysConfig.value.custom_cm_name,
      custom_bd_name: data.sysConfig?.custom_bd_name || sysConfig.value.custom_bd_name,
      display_mode: normalizeDisplayMode(data.sysConfig?.display_mode),
      site_title: sysConfig.value.site_title || DEFAULT_SITE_TITLE,
      theme_options: sysConfig.value.theme_options,
      latency_window: data.sysConfig?.latency_window || sysConfig.value.latency_window
    }

    isLoading.value = false
  } catch (e) {
    console.log('[INFO] Full refresh pending...', e)
    isLoading.value = false
  }
}

let dashboardRefreshPending = null
const refreshData = (options = {}) => {
  if (!dashboardRefreshPending) {
    dashboardRefreshPending = loadDashboardData(options).then(() => {
      if (options.preserveLive && dashboardActive && getLiveSubscriptionKey() !== liveSubscriptionKey) startLiveSocket()
    }).finally(() => { dashboardRefreshPending = null })
  }
  return dashboardRefreshPending
}

let latencyRefreshPending = false
let dashboardActive = true
const refreshLatencyHistory = async () => {
  if (latencyRefreshPending || !sysConfig.value.show_three_net_details) return
  latencyRefreshPending = true
  try {
    const data = await fetchServersAll()
    if (!dashboardActive) return
    const snapshots = new Map((data?.servers || []).map(server => [`${server.source || ''}:${server.id}`, server]))
    servers.value = servers.value.map(server => {
      const snapshot = snapshots.get(`${server.source || ''}:${server.id}`)
      if (!snapshot) return server
      return { ...server, ...refreshLatencyWindow(server, snapshot, sysConfig.value.latency_window, Date.now()) }
    })
  } catch (error) {
    console.log('[INFO] Latency history refresh pending...', error)
  } finally {
    latencyRefreshPending = false
  }
}

// -------------------------------------------------------------------------
// 实时推送：
//   - 订阅 "all"，收到任何服务器的更新都会合并对应 server 的指标
// -------------------------------------------------------------------------
let liveSockets = []
let liveSubscriptionKey = ''
const getLiveSubscriptionKey = () => JSON.stringify([getApiBases(), servers.value.map(server => `${server.source || ''}:${server.id}`).sort()])
let timeUpdateInterval = null
let latencyUpdateInterval = null

const stopLiveSockets = () => {
  if (liveSockets.length === 0) return
  liveSockets.forEach(socket => {
    if (socket) socket.close()
  })
  liveSockets = []
  liveConnected.value = false
}

const startLiveSocket = () => {
  stopLiveSockets()
  liveSubscriptionKey = getLiveSubscriptionKey()
  const bases = getApiBases()

  // 按 source 分组，每个 apiBase 只传自己的 server IDs
  const idsByIndex = new Map()
  for (const s of servers.value) {
    if (!s.id || !s.source) continue
    const idx = bases.indexOf(s.source)
    if (idx === -1) continue
    if (!idsByIndex.has(idx)) idsByIndex.set(idx, [])
    idsByIndex.get(idx).push(s.id)
  }

  // 如果没有配置多个 API bases，使用原来的单连接方式
  if (bases.length === 0) {
    const allIds = servers.value.map(s => s.id).filter(Boolean)
    liveSockets = [createLiveSocket('all', {
      replay: false,
      timeoutMinutes: 0,
      reconnectForever: true,
      onMessage: queueLiveMessage,
      onStatus: ({ connected }) => {
        liveConnected.value = !!connected
        if (connected) refreshData({ preserveLive: true })
      }
    }, 0, allIds)]
    return
  }

  // 为每个 API base 创建独立的 WebSocket 连接，跳过没有服务器的 base
  liveSockets = bases.map((_, index) => {
    const ids = idsByIndex.get(index)
    if (!ids || ids.length === 0) return null
    return createLiveSocket('all', {
      replay: false,
      timeoutMinutes: 0,
      reconnectForever: true,
      onMessage: queueLiveMessage,
      onStatus: ({ connected }) => {
        const anyConnected = liveSockets.some(s => s && s.isConnected)
        liveConnected.value = anyConnected
        if (connected) refreshData({ preserveLive: true })
      }
    }, index, ids)
  }).filter(Boolean)
}

let reconnectAfterResume = false
const restoreDashboard = (event) => {
  if (event?.type === 'resume' || event?.type === 'online' || (event?.type === 'pageshow' && event.persisted)) {
    reconnectAfterResume = true
  }
  // Hidden tabs keep their subscription and sample cadence. Browser-managed
  // freezing may still suspend callbacks, so catch up when the page returns.
  if (!dashboardActive || document.hidden) return
  runDashboardTick()
  if (liveSockets.length === 0) {
    startLiveSocket()
  } else {
    liveSockets.forEach(socket => {
      if (socket && (reconnectAfterResume || (!socket.isConnected && !socket.isConnecting))) socket.reconnect()
    })
  }
  reconnectAfterResume = false
  refreshData({ preserveLive: true })
}

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

  await loadDashboardConfig()
  const rawSavedView = localStorage.getItem(STORAGE.VIEW_PREFERENCE)
  const savedView = normalizeDashboardView(rawSavedView, sysConfig.value.display_mode)
  currentView.value = savedView
  if (rawSavedView && rawSavedView !== savedView) {
    localStorage.setItem(STORAGE.VIEW_PREFERENCE, savedView)
  }
  await refreshData()
  if (!dashboardActive) return
  await nextTick()
  scheduleFilterMeasurement()
  if (window.ResizeObserver && filterWrap.value) {
    filterResizeObserver = new ResizeObserver(scheduleFilterMeasurement)
    filterResizeObserver.observe(filterWrap.value)
  } else {
    window.addEventListener('resize', scheduleFilterMeasurement)
  }
  document.addEventListener('click', closeFilterMoreOnOutsideClick)
  startLiveSocket()
  document.addEventListener('visibilitychange', restoreDashboard)
  document.addEventListener('resume', restoreDashboard)
  window.addEventListener('focus', restoreDashboard)
  window.addEventListener('online', restoreDashboard)
  window.addEventListener('pageshow', restoreDashboard)

  // 每秒更新 now 变量，使相对时间实时刷新
  runDashboardTick()
  timeUpdateInterval = setInterval(runDashboardTick, 1000)
  latencyUpdateInterval = setInterval(refreshLatencyHistory, TIME.POLL_INTERVAL_MS)
})

onUnmounted(() => {
  dashboardActive = false
  document.removeEventListener('visibilitychange', restoreDashboard)
  document.removeEventListener('resume', restoreDashboard)
  window.removeEventListener('focus', restoreDashboard)
  window.removeEventListener('online', restoreDashboard)
  window.removeEventListener('pageshow', restoreDashboard)
  document.removeEventListener('click', closeFilterMoreOnOutsideClick)
  window.removeEventListener('resize', scheduleFilterMeasurement)
  if (filterMeasureTimer) clearTimeout(filterMeasureTimer)
  if (filterResizeObserver) filterResizeObserver.disconnect()
  if (timeUpdateInterval) clearInterval(timeUpdateInterval)
  if (latencyUpdateInterval) clearInterval(latencyUpdateInterval)
  stopLiveSockets()
  playbackBuffers.clear()
  latestAppliedSamples.clear()
})
</script>
