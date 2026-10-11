// Single-origin reference client. The complete contract is in theme-develop.md.
const $ = id => document.getElementById(id);
const metricFields = ['cpu', 'ram_total', 'ram_used', 'net_in_speed', 'net_out_speed'];
const rawBase = document.querySelector('meta[name="apiBase"]')?.content.split(',')[0].trim();
const apiURL = new URL(rawBase || location.origin);
if (!['http:', 'https:'].includes(apiURL.protocol) || apiURL.username || apiURL.password || apiURL.pathname !== '/' || apiURL.search || apiURL.hash) {
  $('connection').textContent = 'API 地址必须是 HTTP 或 HTTPS origin。';
  throw new Error('Invalid API origin');
}
const apiOrigin = apiURL.origin;
const tokenKey = `jwt_token:${apiOrigin}`;
let config = {}, servers = new Map(), socket = null, snapshotTask = null;
let generation = 0, active = false, aborter = null, historyAborter = null, historyVersion = 0;
let snapshotVersion = 0, snapshotAborter = null;
let refreshTimer, displayTimer, heartbeatTimer, reconnectTimer, reconnectAttempt = 0, lastMessageAt = 0;
const token = () => localStorage.getItem(tokenKey) || '';
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
const timestamp = value => number(Number(value)) || 0;
const text = (value, suffix = '') => value === false ? '未启用' : number(value) === null ? '—' : `${value}${suffix}`;
const memory = value => number(value) === null ? '—' : value >= 1024 ? `${(value / 1024).toFixed(1)} GiB` : `${value.toFixed(0)} MiB`;
const speed = value => number(value) === null ? '—' : value >= 1048576 ? `${(value / 1048576).toFixed(1)} MiB/s` : `${(value / 1024).toFixed(1)} KiB/s`;
const status = message => { $('connection').textContent = message; };

async function request(path, { body, auth = true, signal = aborter?.signal } = {}) {
  const headers = body ? { 'Content-Type': 'application/json' } : {};
  if (auth && token()) headers.Authorization = `Bearer ${token()}`;
  const response = await fetch(`${apiOrigin}${path}`, {
    method: body ? 'POST' : 'GET', headers, credentials: 'include', signal,
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const raw = await response.text();
  let data; try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    const error = new Error(`请求失败（${response.status}）`);
    error.status = response.status; error.code = data?.error; throw error;
  }
  return data;
}

function applyAppearance() {
  document.title = config.site_title || '监控看板';
  $('site-title').textContent = document.title;
  const options = config.theme_options?.minimal;
  const supported = options && !Array.isArray(options) && options.schemaVersion === 1;
  document.body.dataset.accent = supported && options.accent === 'blue' ? 'blue' : 'green';
  document.body.dataset.density = supported && options.density === 'compact' ? 'compact' : 'comfortable';
  const valid = preference => ['auto', 'light', 'dark'].includes(preference);
  const saved = localStorage.getItem('theme_preference');
  const preference = valid(saved) ? saved : valid(config.preferred_theme) ? config.preferred_theme : 'auto';
  $('theme').value = preference;
  const light = preference === 'light' || (preference === 'auto' && !matchMedia('(prefers-color-scheme: dark)').matches);
  document.body.classList.toggle('light', light);
  $('logout').hidden = !config.authorization;
  $('login-panel').hidden = !!config.authorization;
  $('seven-days').disabled = !config.authorization;
  if (!config.authorization) $('history-hours').value = '24';
  const path = config.authorization && /^\/[A-Za-z0-9_-]{8,128}$/.test(config.admin_path || '') ? config.admin_path : '';
  $('admin-link').hidden = !path;
  if (path) $('admin-link').href = `${apiOrigin}${path}`;
  else $('admin-link').removeAttribute('href');
}

function renderServers() {
  const fragment = document.createDocumentFragment();
  for (const [id, item] of servers) {
    const row = document.createElement('tr'); row.dataset.serverId = id;
    row.dataset.sampleAt = item.sampleAt; row.dataset.receivedAt = item.receivedAt;
    const name = document.createElement('td');
    const label = document.createElement('strong'); label.className = 'name'; label.textContent = item.server.name || id;
    const presence = document.createElement('span');
    const online = item.receivedAt > 0 && Date.now() - item.receivedAt < 300000;
    presence.className = `presence ${online ? 'online' : 'offline'}`;
    presence.textContent = item.receivedAt ? online ? '在线' : '离线' : '尚未上报';
    name.append(label, presence); row.append(name);
    const values = [text(item.metrics.cpu, '%'), `${memory(item.metrics.ram_used)} / ${memory(item.metrics.ram_total)}`, `${speed(item.metrics.net_in_speed)} / ${speed(item.metrics.net_out_speed)}`];
    values.forEach((value, index) => {
      const cell = document.createElement('td'); cell.className = index === 0 ? 'metric cpu' : 'metric';
      cell.dataset.label = ['CPU', '内存', '下载 / 上传'][index];
      cell.textContent = value; row.append(cell);
    });
    fragment.append(row);
  }
  $('server-rows').replaceChildren(fragment);
  $('server-count').textContent = `${servers.size} 台`;
  $('empty').hidden = servers.size > 0;
  $('empty').textContent = !config.is_public && !config.authorization ? '此看板未公开，请使用已知安全路径登录。' : '暂无可见节点。';
}

function updateHistoryChoices() {
  const selected = $('history-server').value;
  const choices = [...servers].map(([id, item]) => new Option(item.server.name || id, id));
  $('history-server').replaceChildren(...choices);
  if (servers.has(selected)) $('history-server').value = selected;
  else {
    historyVersion++; historyAborter?.abort(); $('history-rows').replaceChildren();
    $('history-message').textContent = '选择节点后查询历史。';
  }
  $('history-submit').disabled = !servers.size;
}

function mergeUpdate(update, packetTs) {
  const item = servers.get(update.serverId);
  if (!item) return; // Membership belongs to the snapshot, never a WS packet.
  if (update.instance_id && update.instance_id !== item.server.instance_id) return;
  const receivedAt = Number.isFinite(update.reportAgeMs) ? Date.now() - Math.max(0, update.reportAgeMs) : timestamp(update.reportTs || packetTs);
  item.receivedAt = Math.max(item.receivedAt, receivedAt);
  for (const sample of [...(update.samples || [])].sort((a, b) => timestamp(a.ts) - timestamp(b.ts))) {
    const payload = sample.data || sample.payload || sample.metrics;
    const sampleAt = timestamp(sample.ts || payload?.sample_timestamp);
    if (!payload || typeof payload !== 'object' || !sampleAt || sampleAt < item.sampleAt) continue;
    for (const field of metricFields) if (field in payload) item.metrics[field] = payload[field];
    item.sampleAt = sampleAt;
  }
}

function reconcileSnapshot(snapshot) {
  const identities = items => JSON.stringify([...items].map(([id, item]) => [id, item.server.instance_id || '']));
  const previousIds = identities(servers);
  const selected = $('history-server').value;
  const selectedInstance = servers.get(selected)?.server.instance_id;
  const next = new Map();
  for (const server of snapshot.servers || []) {
    const existing = servers.get(server.id);
    const previous = (existing?.server.instance_id || '') === (server.instance_id || '') ? existing : null;
    const sampleAt = timestamp(server.sample_timestamp);
    const metrics = Object.fromEntries(metricFields.map(field => [field, server[field]]));
    next.set(server.id, {
      server,
      metrics: previous && previous.sampleAt > sampleAt ? previous.metrics : metrics,
      sampleAt: Math.max(previous?.sampleAt || 0, sampleAt),
      receivedAt: Math.max(previous?.receivedAt || 0, timestamp(server.last_updated))
    });
  }
  servers = next;
  if (selected && servers.get(selected)?.server.instance_id !== selectedInstance) {
    historyVersion++; historyAborter?.abort(); $('history-rows').replaceChildren();
    $('history-message').textContent = '节点已重建，请重新查询历史。';
  }
  for (const update of snapshot.latestReportUpdates || []) mergeUpdate(update, 0);
  updateHistoryChoices(); renderServers();
  if (socket && previousIds !== identities(servers)) {
    closeSocket(); connectSocket(generation); // Old callbacks cannot affect the new membership.
  } else subscribe();
}

function subscribe() {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'subscribe', scope: 'all', ids: [...servers.keys()] }));
}

function closeSocket() {
  clearInterval(heartbeatTimer);
  if (!socket) return;
  const old = socket; socket = null;
  old.onopen = old.onmessage = old.onclose = old.onerror = null;
  old.close();
}

function clearPrivateData() {
  servers.clear(); historyVersion++; historyAborter?.abort();
  $('history-rows').replaceChildren(); closeSocket(); updateHistoryChoices(); renderServers();
}

function refreshSnapshot(epoch = generation) {
  if (!active || epoch !== generation) return Promise.resolve();
  if (snapshotTask) return snapshotTask;
  const version = ++snapshotVersion;
  snapshotAborter = new AbortController();
  const signal = snapshotAborter.signal;
  const task = (async () => {
    try {
      const nextConfig = await request('/api/config', { signal });
      if (!active || epoch !== generation || version !== snapshotVersion) return;
      config = nextConfig;
      if (!config.authorization) localStorage.removeItem(tokenKey);
      applyAppearance();
      if (!config.is_public && !config.authorization) {
        clearPrivateData(); status('看板未公开'); return;
      }
      const snapshot = await request('/api/servers', { signal });
      if (!active || epoch !== generation || version !== snapshotVersion) return;
      reconcileSnapshot(snapshot);
      connectSocket(epoch);
      $('notice').textContent = '';
    } catch (error) {
      if (error.name === 'AbortError' || !active || epoch !== generation || version !== snapshotVersion) return;
      if (error.status === 401) {
        localStorage.removeItem(tokenKey); config.authorization = false;
        applyAppearance(); clearPrivateData();
        $('notice').textContent = '会话已失效，请重新登录。';
      } else $('notice').textContent = '暂时无法补取数据，保留已收到的状态。';
    } finally { if (snapshotTask === task) snapshotTask = null; }
  })();
  snapshotTask = task; return task;
}

function connectSocket(epoch) {
  if (!active || epoch !== generation || socket || (!config.is_public && !config.authorization)) return;
  clearTimeout(reconnectTimer);
  const url = new URL('/api/ws', apiOrigin); url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('subscribe', 'all');
  if (token()) url.searchParams.set('token', token()); // Never log this URL.
  const current = new WebSocket(url); socket = current;
  const live = () => active && epoch === generation && socket === current;
  current.onopen = () => {
    if (!live()) return;
    reconnectAttempt = 0; lastMessageAt = Date.now(); status('实时连接正常'); subscribe();
    void refreshSnapshot(epoch);
    heartbeatTimer = setInterval(() => {
      if (!live()) return;
      if (Date.now() - lastMessageAt > 45000) current.close();
      else if (current.readyState === WebSocket.OPEN) current.send(JSON.stringify({ type: 'ping', ts: Date.now() }));
    }, 20000);
  };
  current.onmessage = event => {
    if (!live()) return;
    lastMessageAt = Date.now();
    let message; try { message = JSON.parse(event.data); } catch { return; }
    if (message.type === 'batchUpdate') {
      for (const update of message.updates || []) mergeUpdate(update, message.ts);
      renderServers();
    }
  };
  current.onerror = () => { if (live()) current.close(); };
  current.onclose = () => {
    if (!live()) return;
    socket = null; clearInterval(heartbeatTimer); status('连接中断，正在重试…');
    snapshotVersion++; snapshotAborter?.abort(); snapshotTask = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(async () => {
      await refreshSnapshot(epoch); connectSocket(epoch);
    }, Math.min(30000, 1000 * 2 ** Math.min(reconnectAttempt++, 5)));
  };
}

function stopSession() {
  active = false; generation++;
  clearInterval(refreshTimer); clearInterval(displayTimer); clearTimeout(reconnectTimer);
  aborter?.abort(); historyAborter?.abort(); historyVersion++;
  snapshotVersion++; snapshotAborter?.abort();
  snapshotTask = null; closeSocket();
  window.removeEventListener('focus', onFocus);
  window.removeEventListener('online', onOnline);
  document.removeEventListener('visibilitychange', onVisibility);
}

async function startSession() {
  stopSession(); active = true; aborter = new AbortController(); reconnectAttempt = 0;
  window.addEventListener('focus', onFocus);
  window.addEventListener('online', onOnline);
  document.addEventListener('visibilitychange', onVisibility);
  const epoch = generation;
  await refreshSnapshot(epoch);
  if (!active || epoch !== generation) return;
  connectSocket(epoch);
  refreshTimer = setInterval(() => void refreshSnapshot(epoch), 60000);
  displayTimer = setInterval(renderServers, 1000);
}

async function recover(force = false) {
  if (!active) { await startSession(); return; }
  if (force || !socket || socket.readyState !== WebSocket.OPEN || Date.now() - lastMessageAt > 45000) {
    clearTimeout(reconnectTimer); closeSocket();
  }
  const epoch = generation;
  await refreshSnapshot(epoch); connectSocket(epoch);
}

$('theme').addEventListener('change', () => { localStorage.setItem('theme_preference', $('theme').value); applyAppearance(); });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyAppearance);
$('refresh').addEventListener('click', () => void recover());
const onFocus = () => void recover();
const onOnline = () => void recover(true);
const onVisibility = () => { if (!document.hidden) void recover(); };
window.addEventListener('pagehide', stopSession);
window.addEventListener('pageshow', event => { if (event.persisted) void startSession(); });

$('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const path = '/' + $('admin-path').value.trim().replace(/^\//, '');
  if (!/^\/[A-Za-z0-9_-]{8,128}$/.test(path)) { $('login-message').textContent = '请输入正确的安全后台路径。'; return; }
  $('login-submit').disabled = true; $('login-message').textContent = '正在验证…';
  try {
    const factor = $('factor').value.trim();
    const result = await request(`${path}/api`, {
      auth: false, body: { action: 'login', username: $('username').value, password: $('password').value,
        ...(factor ? /^\d{6}$/.test(factor) ? { otp: factor } : { recoveryCode: factor } : {}) }
    });
    if (result.requiresTwoFactor) {
      $('factor-field').hidden = false; $('factor').required = true; $('factor').focus();
      $('login-message').textContent = '请输入六位动态验证码或恢复码，再次提交。'; return;
    }
    if (!result.token) throw new Error('登录响应缺少令牌');
    stopSession(); clearPrivateData(); localStorage.setItem(tokenKey, result.token);
    $('password').value = ''; $('factor').value = ''; $('admin-path').value = '';
    $('factor-field').hidden = true; $('factor').required = false; $('login-message').textContent = '';
    await startSession();
  } catch (error) {
    $('login-message').textContent = error.status === 429 ? '尝试过于频繁，请稍后重试。' : '登录失败，请检查路径、凭据或验证码。';
  } finally { $('login-submit').disabled = false; }
});

$('logout').addEventListener('click', async () => {
  const path = config.admin_path;
  stopSession(); clearPrivateData(); localStorage.removeItem(tokenKey); config.authorization = false; applyAppearance();
  let cookieFailed = false;
  try { if (path) await request(`${path}/api`, { body: { action: 'logout' }, auth: false, signal: AbortSignal.timeout(5000) }); }
  catch { cookieFailed = true; }
  await startSession();
  if (cookieFailed) $('notice').textContent = '已清除本地会话；暂时无法清除主控 Cookie，请恢复网络后重试登录/退出。';
});

$('history-server').addEventListener('change', () => { historyVersion++; historyAborter?.abort(); $('history-rows').replaceChildren(); });
$('history-form').addEventListener('submit', async event => {
  event.preventDefault();
  const id = $('history-server').value, hours = $('history-hours').value;
  if (!servers.has(id)) return;
  historyAborter?.abort(); historyAborter = new AbortController();
  const version = ++historyVersion, epoch = generation;
  $('history-submit').disabled = true; $('history-message').textContent = '正在查询…';
  try {
    const rows = await request(`/api/history/all?id=${encodeURIComponent(id)}&hours=${hours}`, { signal: historyAborter.signal });
    if (!active || epoch !== generation || version !== historyVersion || !servers.has(id)) return;
    const fragment = document.createDocumentFragment();
    for (const sample of rows) {
      const row = document.createElement('tr');
      const values = [new Date(sample.timestamp).toLocaleString(), text(sample.cpu, '%'), `${memory(sample.ram_used)} / ${memory(sample.ram_total)}`, text(sample.ping_ct, ' ms'), text(sample.loss_ct, '%')];
      values.forEach((value, index) => {
        const cell = document.createElement('td'); cell.dataset.label = ['采样时间', 'CPU', '内存', '电信延迟', '电信丢包'][index];
        cell.textContent = value; row.append(cell);
      });
      fragment.append(row);
    }
    $('history-rows').replaceChildren(fragment); $('history-message').textContent = rows.length ? `${rows.length} 条采样记录` : '此时间范围没有历史数据。';
  } catch (error) {
    if (error.name === 'AbortError' || epoch !== generation || version !== historyVersion) return;
    if (error.status === 401) { localStorage.removeItem(tokenKey); config.authorization = false; applyAppearance(); clearPrivateData(); }
    $('history-rows').replaceChildren(); $('history-message').textContent = error.status === 401 ? '需要有效管理员会话才能查询此范围。' : '历史查询失败，请重试。';
  } finally { if (version === historyVersion) $('history-submit').disabled = !servers.size; }
});

void startSession();
