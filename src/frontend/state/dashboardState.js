import { readonly, shallowReactive } from 'vue'
import { DEFAULT_SITE_TITLE, LATENCY_WINDOW, TIME } from '../utils/constants.js'
import { normalizeTimestamp } from '../utils/time.js'
import { resolveDisplayMode } from '../utils/displayMode.js'
import { getPlaybackElapsedMs, resolvePlaybackCursor } from '../utils/playback.js'
import { updateLatencyWindow } from '../utils/latencyWindow.js'
import { reconcileDashboardSnapshot } from '../utils/dashboardSnapshot.js'

const TICK_MS = 1000
const MAX_BUFFER_SAMPLES = 600
const nodeKey = (source, id) => JSON.stringify([source, String(id)])
const sampleTime = server => normalizeTimestamp(server?.sample_timestamp ?? server?.timestamp ?? server?.last_updated, null)
const reportTime = server => normalizeTimestamp(server?.report_timestamp ?? server?.last_updated, null)
const displayTime = server => normalizeTimestamp(server?.display_timestamp, null)

// A session owns state and event ordering; adapters supply transport and browser time/events.
export function createDashboardState(adapter, initialConfig = {}) {
  const state = shallowReactive({
    servers: [],
    stats: { total: '-', online: 0, offline: 0, globalNetRx: 0, globalNetTx: 0, globalSpeedIn: 0, globalSpeedOut: 0 },
    regionStats: {}, unknownStats: 0, now: adapter.now(),
    isLoading: true, liveConnected: false, sitesRemaining: 0, corsErrorSites: [],
    config: {
      show_price: true, show_expire: true, show_tf: true, show_three_net_details: true,
      custom_ct_name: initialConfig?.custom_ct_name || '电信',
      custom_cu_name: initialConfig?.custom_cu_name || '联通',
      custom_cm_name: initialConfig?.custom_cm_name || '移动',
      custom_bd_name: initialConfig?.custom_bd_name || 'BGP',
      display_mode: resolveDisplayMode(initialConfig),
      site_title: initialConfig?.site_title || DEFAULT_SITE_TITLE,
      latency_window: initialConfig?.latency_window || { points: LATENCY_WINDOW.POINTS, hours: LATENCY_WINDOW.HOURS }
    }
  })
  const playbackBuffers = new Map()
  const latestAppliedSamples = new Map()
  const connections = new Map()
  const timers = []
  let active = false
  let stopped = false
  let startTask = null
  let refreshTask = null
  let refreshAbort = null
  let removeRestoreListener = null
  let connectionsStarted = false
  let reconnectAfterResume = false

  const sources = () => {
    const configured = adapter.getSources()
    return configured.length ? [...new Set(configured)] : ['']
  }
  const findNode = (source, id) => state.servers.find(server => server.source === source && String(server.id) === String(id))
  const reportError = error => adapter.onError?.(error)

  function withTiming(server, displayTs = null) {
    const reportTs = reportTime(server)
    const sampleTs = sampleTime(server) || displayTs || reportTs
    const ownTs = normalizeTimestamp(displayTs, displayTime(server) || sampleTs || reportTs)
    return {
      ...server, current_timestamp: state.now,
      ...(reportTs ? { report_timestamp: reportTs, last_updated: reportTs } : {}),
      ...(sampleTs && ownTs ? {
        sample_timestamp: sampleTs, display_timestamp: ownTs,
        sample_lag_seconds: Math.max(0, Math.floor((ownTs - sampleTs) / 1000))
      } : {})
    }
  }

  function applySample(source, id, data, sampleTs, displayTs, reportTs) {
    const existing = findNode(source, id)
    // A snapshot owns membership. Late messages cannot reintroduce a removed node.
    if (!existing) return
    const receivedAt = Math.max(normalizeTimestamp(reportTs, 0), reportTime(existing) || 0)
    const merged = withTiming({
      ...data, id: existing.id, source, report_timestamp: receivedAt,
      last_updated: receivedAt, sample_timestamp: sampleTs, timestamp: sampleTs
    }, displayTs)
    latestAppliedSamples.set(nodeKey(source, id), merged)
    const next = { ...existing, ...merged,
      ...updateLatencyWindow(existing, data, sampleTs, state.config.latency_window, state.now) }
    state.servers = state.servers.map(server => server === existing ? next : server)
  }

  function consumePlayback(source, id, cursor = null) {
    const key = nodeKey(source, id)
    const samples = playbackBuffers.get(key)
    const server = findNode(source, id)
    if (!server) { playbackBuffers.delete(key); return }
    if (!samples?.length) return
    const ownTs = normalizeTimestamp(cursor, displayTime(server))
    if (!ownTs) return
    let selected = null
    while (samples.length && samples[0].ts <= ownTs) selected = samples.shift()
    if (selected && selected.ts >= (sampleTime(server) || 0)) {
      applySample(source, id, selected.data, selected.ts, ownTs, selected.reportTs)
    }
    if (!samples.length) playbackBuffers.delete(key)
  }

  function queueSamples(source, id, samples, reportTs, cached, reportAgeMs) {
    const current = findNode(source, id)
    if (!current || !Array.isArray(samples)) return
    const normalized = samples.map(sample => {
      const data = sample?.data || sample?.payload || sample?.metrics
      if (!data || typeof data !== 'object' || Array.isArray(data)) return null
      const ts = normalizeTimestamp(sample.ts ?? sample.timestamp ?? data.sample_timestamp ?? data.last_updated ?? data.timestamp, null)
      return ts ? { ts, data, reportTs } : null
    }).filter(Boolean).sort((a, b) => a.ts - b.ts)
    const incoming = cached ? normalized : normalized.filter(sample => sample.ts > (sampleTime(current) || 0))
    if (!incoming.length) return
    const cursor = resolvePlaybackCursor(incoming[0].ts, displayTime(current), { replayCachedReport: cached, reportAgeMs })
    if (cursor === null) return
    const key = nodeKey(source, id)
    if (incoming.length === 1) {
      if (incoming[0].ts < (sampleTime(current) || 0)) return
      playbackBuffers.delete(key)
      applySample(source, id, incoming[0].data, incoming[0].ts, cursor, reportTs)
      return
    }
    const seen = new Set()
    const unique = incoming.filter(sample => !seen.has(sample.ts) && seen.add(sample.ts))
    playbackBuffers.set(key, unique.slice(-MAX_BUFFER_SAMPLES))
    consumePlayback(source, id, cursor)
  }

  function receive(source, message, cached = false) {
    if (!active || message?.type !== 'batchUpdate') return
    state.now = adapter.now()
    const messageTs = normalizeTimestamp(message.ts, state.now)
    for (const update of Array.isArray(message.updates) ? message.updates : []) {
      if (!update?.serverId) continue
      const reportTs = normalizeTimestamp(update.reportTs ?? update.report_timestamp, messageTs)
      const current = findNode(source, update.serverId)
      if (!current) continue
      const receivedAt = Math.max(reportTs || 0, reportTime(current) || 0)
      if (receivedAt > (reportTime(current) || 0)) {
        state.servers = state.servers.map(server => server === current
          ? { ...server, report_timestamp: receivedAt, last_updated: receivedAt } : server)
      }
      const samples = (Array.isArray(update.samples) ? update.samples : []).map(sample => {
        const data = sample?.data || sample?.payload || sample?.metrics
        return { ...sample, ts: sample?.ts ?? sample?.timestamp ?? data?.sample_timestamp ?? data?.last_updated ?? data?.timestamp ?? update.ts ?? message.ts }
      })
      queueSamples(source, update.serverId, samples, reportTs, cached, cached ? update.reportAgeMs : 0)
    }
    recomputeStats()
  }

  function recomputeStats() {
    let online = 0, speedIn = 0, speedOut = 0, netRx = 0, netTx = 0, unknown = 0
    const regions = {}
    for (const server of state.servers) {
      const ts = reportTime(server)
      if (ts && state.now - ts < TIME.ONLINE_THRESHOLD_MS) {
        online++
        speedIn += parseFloat(server.net_in_speed) || 0
        speedOut += parseFloat(server.net_out_speed) || 0
      }
      netRx += parseFloat(server.net_rx) || 0
      netTx += parseFloat(server.net_tx) || 0
      if (server.region) {
        const key = String(server.region).toUpperCase()
        regions[key] = (regions[key] || 0) + 1
      } else unknown++
    }
    state.stats = { total: state.servers.length, online, offline: state.servers.length - online,
      globalNetRx: netRx, globalNetTx: netTx, globalSpeedIn: speedIn, globalSpeedOut: speedOut }
    state.regionStats = regions
    state.unknownStats = unknown
  }

  function tick() {
    if (!active) return
    state.now = adapter.now()
    state.servers = state.servers.map(server => {
      const ts = reportTime(server)
      const cursor = displayTime(server) || sampleTime(server) || ts
      const next = ts && state.now - ts < TIME.ONLINE_THRESHOLD_MS && cursor
        ? cursor + getPlaybackElapsedMs(state.now, server.current_timestamp, TICK_MS) : cursor
      const latency = state.config.show_three_net_details
        ? updateLatencyWindow(server, null, null, state.config.latency_window, state.now) : {}
      return withTiming({ ...server, ...latency }, next)
    })
    for (const key of [...playbackBuffers.keys()]) {
      const [source, id] = JSON.parse(key)
      consumePlayback(source, id)
    }
    recomputeStats()
  }

  function applySnapshot(source, data, preserveLive) {
    state.now = adapter.now()
    const previous = new Map(state.servers.filter(server => server.source === source).map(server => [String(server.id), server]))
    const raw = Array.isArray(data.servers) ? data.servers
      : Object.entries(data.latestMetricsMap || {}).map(([id, metrics]) => ({ id, ...metrics }))
    const visible = new Set(raw.map(server => String(server.id)))
    for (const id of previous.keys()) if (!visible.has(id)) {
      const key = nodeKey(source, id)
      playbackBuffers.delete(key)
      latestAppliedSamples.delete(key)
    }
    state.config = {
      ...state.config, ...data.sysConfig,
      site_title: state.config.site_title,
      display_mode: resolveDisplayMode(data.sysConfig, state.config.display_mode),
      latency_window: data.sysConfig?.latency_window || state.config.latency_window
    }
    const next = raw.map(server => {
      const snapshot = { ...server, source }
      const prev = previous.get(String(server.id))
      if (preserveLive) {
        const merged = reconcileDashboardSnapshot(snapshot, prev, latestAppliedSamples.get(nodeKey(source, server.id)), state.config.latency_window, state.now)
        return withTiming(merged, merged.display_timestamp)
      }
      const sampleTs = sampleTime(snapshot) || sampleTime(prev)
      return withTiming({ ...prev, ...snapshot, sample_timestamp: sampleTs, report_timestamp: reportTime(snapshot) || reportTime(prev) }, sampleTs)
    })
    state.servers = sources().flatMap(base => base === source ? next : state.servers.filter(server => server.source === base))
    receive(source, { type: 'batchUpdate', ts: state.now, updates: data.latestReportUpdates }, !preserveLive)
    recomputeStats()
    if (connectionsStarted) updateConnections()
  }

  function updateConnectedStatus() {
    state.liveConnected = [...connections.values()].some(entry => entry.connected)
  }

  function updateConnections() {
    if (!active) return
    const bases = sources()
    state.servers = bases.flatMap(source => state.servers.filter(server => server.source === source))
    for (const samples of [playbackBuffers, latestAppliedSamples]) {
      for (const key of samples.keys()) if (!bases.includes(JSON.parse(key)[0])) samples.delete(key)
    }
    for (const [source, entry] of connections) if (!bases.includes(source)) {
      connections.delete(source)
      entry.socket?.close()
    }
    bases.forEach((source, apiIndex) => {
      const ids = state.servers.filter(server => server.source === source).map(server => server.id).filter(Boolean)
      const key = JSON.stringify([...ids].sort())
      const old = connections.get(source)
      if (old?.key === key && old.apiIndex === apiIndex) return
      connections.delete(source)
      old?.socket?.close()
      if (!ids.length) return
      const entry = { key, apiIndex, connected: false, socket: null }
      connections.set(source, entry)
      const current = () => active && connections.get(source) === entry
      entry.socket = adapter.connect(source, apiIndex, ids, {
        onMessage: message => { if (current()) receive(source, message) },
        onStatus: ({ connected }) => {
          if (!current()) return
          entry.connected = !!connected
          updateConnectedStatus()
          if (connected) refresh()
        }
      })
      if (!current()) entry.socket?.close()
    })
    updateConnectedStatus()
    recomputeStats()
  }

  function refresh(preserveLive = true) {
    if (!active) return Promise.resolve()
    if (refreshTask) return refreshTask
    const bases = sources()
    const completed = new Set()
    const controller = new AbortController()
    refreshAbort = controller
    state.sitesRemaining = bases.length > 1 ? bases.length : 0
    state.corsErrorSites = []
    refreshTask = (async () => {
      try {
        await adapter.fetchSnapshots(result => {
          if (!active || controller.signal.aborted) return
          const source = result.baseUrl ?? bases[0]
          if (!bases.includes(source) || !sources().includes(source)) return
          completed.add(source)
          if (result.corsError && !state.corsErrorSites.includes(source)) {
            state.corsErrorSites = [...state.corsErrorSites, source]
          }
          if (!result.error && result.data) {
            applySnapshot(source, result.data, preserveLive)
            state.isLoading = false
          }
          state.sitesRemaining = bases.length > 1 ? bases.length - completed.size : 0
        }, controller.signal)
      } catch (error) { if (active) reportError(error) }
      if (active) {
        state.isLoading = false
        if (connectionsStarted) updateConnections()
      }
    })().finally(() => { refreshTask = null; refreshAbort = null })
    return refreshTask
  }

  function restore(event = {}) {
    if (!active) return
    if (event.type === 'resume' || event.type === 'online' || (event.type === 'pageshow' && event.persisted)) reconnectAfterResume = true
    if (adapter.isHidden()) return
    tick()
    updateConnections()
    for (const entry of connections.values()) {
      const socket = entry.socket
      if (socket && (reconnectAfterResume || (!socket.isConnected && !socket.isConnecting))) socket.reconnect()
    }
    reconnectAfterResume = false
    refresh()
  }

  function start() {
    if (startTask || stopped) return startTask || Promise.resolve()
    active = true
    startTask = (async () => {
      try {
        const config = await adapter.loadConfig()
        if (!active) return
        const title = String(adapter.getTitle() || '').trim()
        state.config = {
          ...state.config,
          site_title: sources().length > 1 && title ? title : config?.site_title || state.config.site_title,
          display_mode: resolveDisplayMode(config, state.config.display_mode),
          latency_window: config?.latency_window || state.config.latency_window
        }
      } catch (error) { if (active) reportError(error) }
      if (!active) return
      await refresh(false)
      if (!active) return
      connectionsStarted = true
      updateConnections()
      removeRestoreListener = adapter.onRestore(restore)
      tick()
      timers.push(adapter.every(tick, TICK_MS), adapter.every(() => refresh(), TIME.POLL_INTERVAL_MS))
    })()
    return startTask
  }

  function stop() {
    if (stopped) return
    stopped = true
    active = false
    refreshAbort?.abort()
    removeRestoreListener?.()
    for (const timer of timers) adapter.cancel(timer)
    for (const entry of connections.values()) {
      const socket = entry.socket
      entry.socket = null
      socket?.close()
    }
    connections.clear()
    playbackBuffers.clear()
    latestAppliedSamples.clear()
    state.liveConnected = false
  }

  return { state: readonly(state), start, stop }
}
