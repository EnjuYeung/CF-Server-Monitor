import test from 'node:test'
import assert from 'node:assert/strict'
import { createDashboardState } from '../src/frontend/state/dashboardState.js'
import { updateLatencyWindow } from '../src/frontend/utils/latencyWindow.js'

const NOW = Date.UTC(2026, 9, 9, 4)
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const node = (id = 'a', values = {}) => ({ id, name: id, cpu: 10, region: 'CN',
  sample_timestamp: NOW - 10000, last_updated: NOW, ...values })
const snapshot = (servers, sysConfig = {}) => ({ servers, sysConfig })

// The test adapter drives the same transport, clock and restore seam as the browser.
// Assertions only observe the session interface and externally owned resources.
function fixture(t, initial = { one: snapshot([node()]) }, config = {}) {
  const f = { now: NOW, sources: Object.keys(initial), snapshots: initial, sockets: [],
    requests: [], timers: new Set(), errors: [], hidden: false, restore: null,
    fetch: null, config: async () => config }
  const adapter = {
    getSources: () => f.sources,
    getTitle: () => 'Combined',
    loadConfig: () => f.config(),
    async fetchSnapshots(onResult, signal) {
      f.requests.push({ signal })
      if (f.fetch) return f.fetch(onResult, signal)
      for (const source of f.sources) onResult({ baseUrl: source, data: f.snapshots[source] })
    },
    connect(source, index, ids, handlers) {
      const socket = { source, index, ids: [...ids], handlers, isConnected: true, isConnecting: false,
        closes: 0, reconnects: 0,
        close() { this.closes++; this.isConnected = false; handlers.onStatus({ connected: false }) },
        reconnect() { this.reconnects++ },
        send(updates) { handlers.onMessage({ type: 'batchUpdate', ts: f.now, updates }) }
      }
      f.sockets.push(socket)
      return socket
    },
    now: () => f.now,
    every(callback, delay) { const timer = { callback, delay }; f.timers.add(timer); return timer },
    cancel: timer => f.timers.delete(timer),
    isHidden: () => f.hidden,
    onRestore(callback) { f.restore = callback; return () => { f.restore = null } },
    onError: error => f.errors.push(error)
  }
  f.session = createDashboardState(adapter, config)
  f.state = f.session.state
  f.server = (source = 'one', id = 'a') => f.state.servers.find(server => server.source === source && server.id === id)
  f.socket = (source = 'one') => f.sockets.findLast(socket => socket.source === source)
  f.send = (samples, options = {}, source = 'one', id = 'a') => f.socket(source).send([
    { serverId: id, samples, reportTs: f.now, ...options }
  ])
  f.tick = elapsed => {
    f.now += elapsed
    for (const timer of f.timers) if (timer.delay === 1000) timer.callback()
  }
  f.poll = async () => {
    for (const timer of f.timers) if (timer.delay === 60000) timer.callback()
    await flush()
  }
  f.event = async (type, options = {}) => { f.restore?.({ type, ...options }); await flush() }
  t.after(() => f.session.stop())
  return f
}
const sample = (ts, cpu, fields = {}) => ({ ts, data: { cpu, ...fields } })

test('dashboard starts once, owns the snapshot, configuration, statistics and source subscriptions', async t => {
  const f = fixture(t, { one: snapshot([node(), node('b', { region: '', net_rx: 32, net_in_speed: 4 })], { show_three_net_details: false }) })
  const start = f.session.start()
  assert.equal(f.session.start(), start)
  await start
  assert.deepEqual(f.socket().ids, ['a', 'b'])
  assert.equal(f.state.isLoading, false)
  assert.equal(f.state.stats.total, 2)
  assert.equal(f.state.stats.online, 2)
  assert.equal(f.state.stats.globalNetRx, 32)
  assert.equal(f.state.stats.globalSpeedIn, 4)
  assert.equal(f.state.regionStats.CN, 1)
  assert.equal(f.state.unknownStats, 1)
  assert.equal(f.state.config.show_three_net_details, false)
  assert.deepEqual([...f.timers].map(timer => timer.delay), [1000, 60000])
  f.snapshots.one = snapshot([node('c')], { show_three_net_details: false })
  await f.poll()
  assert.equal(f.state.servers[0].id, 'c')
  assert.deepEqual(f.socket().ids, ['c'])
})

test('three dashboard clocks separate playback, sample freshness and report liveness after a frozen interval', async t => {
  const f = fixture(t, { one: { ...snapshot([node('a', { cpu: 30 })]), latestReportUpdates: [
    { serverId: 'a', reportTs: NOW, reportAgeMs: 1000, samples: [
      sample(NOW - 10000, 10), sample(NOW - 5000, 20), sample(NOW, 30)
    ] }
  ] } })
  await f.session.start()
  assert.equal(f.server().cpu, 10)
  assert.equal(f.server().sample_timestamp, NOW - 10000)
  assert.equal(f.server().display_timestamp, NOW - 9000)
  assert.equal(f.server().report_timestamp, NOW)
  f.tick(10000)
  assert.equal(f.server().cpu, 30)
  assert.equal(f.server().sample_timestamp, NOW)
  assert.equal(f.server().display_timestamp, NOW + 1000)
  assert.equal(f.server().report_timestamp, NOW)
  f.tick(300000)
  assert.equal(f.state.stats.online, 0)
  assert.equal(f.server().display_timestamp, NOW + 1000)
})

test('ordinary batches sort and deduplicate samples, and a new single sample replaces pending playback', async t => {
  const f = fixture(t)
  await f.session.start()
  f.send([sample(NOW - 1000, 20), sample(NOW - 4000, 40), sample(NOW - 4000, 99)])
  assert.equal(f.server().cpu, 40)
  f.send([sample(NOW, 73)])
  f.tick(5000)
  assert.equal(f.server().cpu, 73)
  assert.equal(f.server().sample_timestamp, NOW)
  f.send([sample(NOW - 8000, 2)], { reportTs: NOW + 5000 })
  assert.equal(f.server().cpu, 73)
  assert.equal(f.server().report_timestamp, NOW + 5000)
})

test('a new batch replaces pending playback and bounded replay keeps recent samples', async t => {
  const f = fixture(t, { one: snapshot([node('a', { sample_timestamp: NOW - 601000 })]) })
  await f.session.start()
  f.send(Array.from({ length: 601 }, (_, i) => sample(NOW - 600000 + i * 1000, i)))
  assert.equal(f.server().cpu, 10) // The oldest sample was trimmed, so it cannot be displayed.
  f.tick(2000)
  assert.equal(f.server().cpu, 1)
  f.send([sample(NOW - 598000, 701), sample(NOW - 597000, 702)])
  assert.equal(f.server().cpu, 701)
  f.tick(3000)
  assert.equal(f.server().cpu, 702)
})

test('a delayed REST snapshot updates metadata and history while keeping a newer live sample', async t => {
  const f = fixture(t)
  await f.session.start()
  const pending = deferred()
  let deliver
  f.fetch = callback => { deliver = callback; return pending.promise }
  f.restore({ type: 'focus' })
  f.send([sample(NOW, 73, { ping_ct: 65, loss_ct: 0 })])
  f.tick(1000)
  deliver({ baseUrl: 'one', data: snapshot([node('a', { name: 'Renamed', cpu: 21,
    server_group: 'Europe', sample_timestamp: NOW - 1000, last_updated: NOW + 25,
    ...updateLatencyWindow({}, { ping_ct: 150, loss_ct: 10 }, NOW - 360000, {}, f.now) })]) })
  pending.resolve()
  await flush()
  assert.equal(f.server().cpu, 73)
  assert.equal(f.server().name, 'Renamed')
  assert.equal(f.server().server_group, 'Europe')
  assert.equal(f.server().sample_timestamp, NOW)
  assert.equal(f.server().display_timestamp, NOW + 1000)
  assert.equal(f.server().ping.at(-1).ct, 65)
  assert.equal(f.server().ping.at(-2).ct, 150)
  assert.equal(f.server().loss.at(-1).ct, 0)
})

test('newer persisted metrics replace older live metrics and old cached reports cannot roll them back', async t => {
  const f = fixture(t)
  await f.session.start()
  f.send([sample(NOW - 5000, 20)])
  f.snapshots.one = { ...snapshot([node('a', { cpu: 42, sample_timestamp: NOW })]),
    latestReportUpdates: [{ serverId: 'a', samples: [sample(NOW - 5000, 20)] }] }
  await f.event('focus')
  assert.equal(f.server().cpu, 42)
  assert.equal(f.server().sample_timestamp, NOW)
  assert.equal(f.server().display_timestamp, NOW)
})

test('latency reconciliation uses persisted sample time even when report receipt is newer', async t => {
  const persistedAt = NOW + 10000, liveAt = NOW + 12000, receivedAt = NOW + 13000
  const history = updateLatencyWindow({}, { ping_ct: 306, loss_ct: 0 }, persistedAt, {}, receivedAt)
  const f = fixture(t, { one: snapshot([node('a', { sample_timestamp: persistedAt, last_updated: receivedAt, ...history })]) })
  f.now = receivedAt
  await f.session.start()
  f.send([sample(liveAt, 73, { ping_ct: 65, loss_ct: 15 })])
  await f.event('focus')
  assert.equal(f.server().ping.at(-1).ct, 65)
  assert.equal(f.server().loss.at(-1).ct, 15)
  assert.equal(f.server().ping.at(-1).sample_ts, liveAt)
  assert.equal(f.server().last_updated, receivedAt)
})

test('cleared persisted history stays empty while samples newer than persistence survive', async t => {
  const f = fixture(t)
  await f.session.start()
  f.send([sample(NOW, 65, { ping_ct: 65 })])
  f.snapshots.one = snapshot([node('a', { cpu: 0, sample_timestamp: NOW, ping: [], loss: [] })])
  await f.event('focus')
  assert.equal(f.server().cpu, 0)
  assert.equal(f.server().ping.length, 20)
  assert.equal(f.server().ping.some(point => Object.hasOwn(point, 'ct')), false)
  f.tick(1000)
  f.send([sample(NOW + 1000, 70, { ping_ct: 70 })])
  await f.event('focus')
  assert.equal(f.server().ping.at(-1).ct, 70)
  assert.equal(f.server().ping.at(-1).sample_ts, NOW + 1000)
})

test('an old or duplicate sample advances receipt liveness and a delayed snapshot cannot undo it', async t => {
  const f = fixture(t)
  await f.session.start()
  f.tick(300000)
  assert.equal(f.state.stats.online, 0)
  f.send([sample(NOW - 10000, 1)])
  assert.equal(f.server().cpu, 10)
  assert.equal(f.server().sample_timestamp, NOW - 10000)
  assert.equal(f.server().last_updated, f.now)
  assert.equal(f.state.stats.online, 1)
  await f.event('focus')
  assert.equal(f.server().last_updated, f.now)
  assert.equal(f.state.stats.online, 1)
})

test('sources with the same UUID have independent metrics, playback and latency', async t => {
  const f = fixture(t, { one: snapshot([node()]), two: snapshot([node('a', { cpu: 20, region: 'US' })]) })
  await f.session.start()
  f.send([sample(NOW - 5000, 71, { ping_ct: 71 }), sample(NOW, 72, { ping_ct: 72 })], {}, 'two')
  assert.equal(f.server('one').cpu, 10)
  assert.equal(f.server('two').cpu, 71)
  f.send([sample(NOW, 81, { ping_ct: 81 })], {}, 'one')
  f.tick(5000)
  assert.equal(f.server('one').cpu, 81)
  assert.equal(f.server('two').cpu, 72)
  assert.equal(f.server('one').ping.at(-1).ct, 81)
  assert.equal(f.server('two').ping.at(-1).ct, 72)
  assert.equal(f.state.config.site_title, 'Combined')
  assert.equal(f.state.stats.total, 2)
})

test('snapshot deletion invalidates pending playback and old socket callbacks across UUID recreation', async t => {
  const f = fixture(t)
  await f.session.start()
  const oldSocket = f.socket()
  f.send([sample(NOW - 5000, 71), sample(NOW, 72)])
  f.snapshots.one = snapshot([])
  await f.event('focus')
  oldSocket.send([{ serverId: 'a', samples: [sample(NOW + 1000, 99)] }])
  f.tick(1000)
  assert.equal(f.state.servers.length, 0)
  assert.equal(oldSocket.closes, 1)
  f.snapshots.one = snapshot([node('a', { cpu: 5, sample_timestamp: NOW - 10000 })])
  await f.event('focus')
  oldSocket.send([{ serverId: 'a', samples: [sample(NOW + 1000, 99)] }])
  f.tick(10000)
  assert.equal(f.server().cpu, 5)
  f.send([sample(f.now, 6)])
  assert.equal(f.server().cpu, 6)
})

test('only a changed subscription reconnects; removing a source discards its cached state', async t => {
  const f = fixture(t, { one: snapshot([node()]), two: snapshot([node('a', { cpu: 20 })]) })
  await f.session.start()
  const first = f.socket('one'), second = f.socket('two')
  f.send([sample(NOW, 77)], {}, 'two')
  f.snapshots.one = snapshot([node(), node('b')])
  await f.event('focus')
  assert.equal(first.closes, 1)
  assert.equal(second.closes, 0)
  f.sources = ['one']
  await f.event('focus')
  assert.equal(second.closes, 1)
  assert.equal(f.state.servers.length, 2)
  f.sources = ['one', 'two']
  await f.event('focus')
  assert.equal(f.server('two').cpu, 20)
})

test('partial and failed snapshots keep other sources, while a successful empty snapshot removes nodes', async t => {
  const f = fixture(t, { one: snapshot([node()]), two: snapshot([node()]) })
  await f.session.start()
  const pending = deferred()
  let deliver
  f.fetch = callback => { deliver = callback; return pending.promise }
  f.restore({ type: 'focus' })
  assert.equal(f.state.sitesRemaining, 2)
  deliver({ baseUrl: 'one', data: snapshot([node('b')]) })
  assert.equal(f.state.sitesRemaining, 1)
  assert.equal(f.server('two').id, 'a')
  deliver({ baseUrl: 'two', error: new Error('blocked'), corsError: true })
  pending.resolve()
  await flush()
  assert.deepEqual([...f.state.corsErrorSites], ['two'])
  assert.equal(f.state.sitesRemaining, 0)
  assert.equal(f.server('two').id, 'a')
  f.fetch = callback => { callback({ baseUrl: 'one', data: null }); callback({ baseUrl: 'two', data: snapshot([]) }) }
  await f.event('focus')
  assert.equal(f.server('one', 'b').id, 'b')
  assert.equal(f.state.servers.length, 1)
})

test('restore requests are single flight, hidden sessions stay open, and healthy visible sessions reuse sockets', async t => {
  const f = fixture(t)
  await f.session.start()
  const socket = f.socket()
  const initialRequests = f.requests.length
  f.hidden = true
  await f.event('visibilitychange')
  assert.equal(socket.closes, 0)
  assert.equal(f.timers.size, 2)
  assert.equal(f.requests.length, initialRequests)
  f.hidden = false
  const pending = deferred()
  f.fetch = () => pending.promise
  f.restore({ type: 'visibilitychange' })
  f.restore({ type: 'focus' })
  socket.handlers.onStatus({ connected: true })
  await f.poll()
  assert.equal(f.requests.length, initialRequests + 1)
  assert.equal(socket.reconnects, 0)
  pending.resolve()
  await flush()
  await f.event('online')
  await f.event('resume')
  await f.event('pageshow', { persisted: true })
  assert.equal(socket.reconnects, 3)
  socket.isConnected = false
  socket.isConnecting = true
  await f.event('focus')
  assert.equal(socket.reconnects, 3)
  socket.isConnecting = false
  await f.event('focus')
  assert.equal(socket.reconnects, 4)
})

test('resume while hidden reconnects when visible, and latency buckets roll without stale filling', async t => {
  const f = fixture(t)
  await f.session.start()
  f.send([sample(NOW, 20, { ping_ct: 65 })])
  f.hidden = true
  await f.event('resume')
  assert.equal(f.socket().reconnects, 0)
  f.hidden = false
  await f.event('visibilitychange')
  assert.equal(f.socket().reconnects, 1)
  f.tick(360000)
  assert.equal(f.server().ping.at(-1).ct, undefined)
  assert.equal(f.server().ping.at(-2).ct, 65)
})

test('stop cancels requests, timers, listeners and sockets and ignores every late callback', async t => {
  const f = fixture(t)
  await f.session.start()
  const socket = f.socket(), restore = f.restore, timers = [...f.timers]
  const pending = deferred()
  let deliver
  f.fetch = callback => { deliver = callback; return pending.promise }
  restore({ type: 'focus' })
  f.session.stop()
  const stopped = JSON.stringify(f.state)
  assert.equal(f.requests.at(-1).signal.aborted, true)
  assert.equal(f.restore, null)
  assert.equal(f.timers.size, 0)
  assert.equal(socket.closes, 1)
  deliver({ baseUrl: 'one', data: snapshot([node('new')]) })
  socket.send([{ serverId: 'a', samples: [sample(NOW + 1000, 99)] }])
  socket.handlers.onStatus({ connected: true })
  restore({ type: 'online' })
  f.now += 10000
  for (const timer of timers) timer.callback()
  pending.resolve()
  await flush()
  await f.session.start()
  f.session.stop()
  assert.equal(JSON.stringify(f.state), stopped)
  assert.equal(socket.closes, 1)
  assert.equal(f.requests.length, 2)
})

test('stopping during initial configuration or snapshot never starts late subscriptions', async t => {
  for (const stage of ['config', 'snapshot']) {
    const f = fixture(t)
    const pending = deferred()
    let deliver
    if (stage === 'config') f.config = () => pending.promise
    else f.fetch = callback => { deliver = callback; return pending.promise }
    const start = f.session.start()
    await flush()
    f.session.stop()
    deliver?.({ baseUrl: 'one', data: snapshot([node()]) })
    pending.resolve({})
    await start
    assert.equal(f.sockets.length, 0)
    assert.equal(f.state.servers.length, 0)
    assert.equal(f.timers.size, 0)
    assert.equal(f.restore, null)
    if (stage === 'snapshot') assert.equal(f.requests[0].signal.aborted, true)
  }
})
