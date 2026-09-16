import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import app from './index.js';
import {applyCors, getCorsAllowedOrigins} from './utils/cors.js';
import { clearAllCaches } from './utils/cache.js';
import { SQLiteDatabase } from './database/sqlite.js';
import { initDatabase } from './database/schema.js';
import { loadSiteSettings, getWssReportScheduleState, setDebug } from './utils/settings.js';
import { checkWebSocketAuth, websocketTokenExpiry } from './middleware/auth.js';
import { RealtimeHub } from './realtime/RealtimeHub.js';
import { createGeolocation } from './services/geolocation.js';
import { AgentDistribution } from './services/agentDistribution.js';
import { createRequestAdapter, sendResponse, staticResponse } from './runtime/http.js';
import { handleBackup } from './handlers/backup.js';
import { startScheduler } from './services/scheduler.js';
import { normalizeAgentVersion } from './services/ingestion.js';
import { normalizeAdminPath } from './utils/adminPath.js';
import { AGENT_CONFIG_SCHEMA_HEADER, AGENT_CONFIG_MD5_HEADER, normalizeAgentConfigSchemaVersion } from './utils/agentConfig.js';

export async function createController(options = {}) {
  const config = { ...process.env, ...options };
  if (!config.API_SECRET || config.API_SECRET.length < 16) throw new Error('API_SECRET must contain at least 16 characters');
  const adminPath = normalizeAdminPath(config.ADMIN_PATH);
  const env = {
    ADMIN_PATH: adminPath,
    API_SECRET: config.API_SECRET, API_USER_NAME: config.API_USER_NAME || 'admin',
    CORS_ALLOWED_ORIGINS: config.CORS_ALLOWED_ORIGINS || '', DEBUG: config.DEBUG,
    STATIC_ROOT: resolve(config.STATIC_ROOT || 'dist'), API_BASE: config.API_BASE || '',
    DB: new SQLiteDatabase(resolve(config.DATA_DIR || 'data', 'monitor.sqlite'))
  };
  clearAllCaches();
  env.AGENT_DISTRIBUTION = new AgentDistribution(config.AGENT_DIST_DIR || 'agent-dist', config.AGENT_ARCHIVE_DIR || resolve(config.DATA_DIR || 'data','agent-releases'));
  setDebug(config.DEBUG);
  try {
    await initDatabase(env.DB);
    await loadSiteSettings(env.DB, { forceRefresh: true });
    env.GEOLOCATION = await createGeolocation(resolve(config.GEOIP_PATH || 'geoip/dbip-country-lite.mmdb'), config.PUBLIC_IP, {
      updatePath: resolve(config.DATA_DIR || 'data', 'geoip/dbip-country-lite.mmdb')
    });
  } catch (error) { env.DB.close(); throw error; }
  env.REALTIME_HUB = new RealtimeHub(env);
  const adapt = createRequestAdapter(config.TRUSTED_PROXIES || '');
  const pending = new Set();
  const ctx = { defer(promise) { pending.add(promise); promise.catch(console.error).finally(() => pending.delete(promise)); } };
  let stopping = false;
  const loginAttempts = new Map();
  const server = createServer(async (req, res) => {
    try {
      if (stopping) { res.writeHead(503).end(); return; }
      const request = await adapt(req);
      const path = new URL(request.url).pathname;
      let response;
      if (path === '/healthz') {
        env.DB.prepare('SELECT 1').first();
        response = Response.json({ ok: true, storage: 'sqlite' });
      } else if (path === '/agent' || path.startsWith('/agent/')) {
        response = await env.AGENT_DISTRIBUTION.handle(request);
      } else if (path === `${adminPath}/backup` && request.method === 'POST') {
        response = await handleBackup(request, env);
      } else if (['/update', '/api/ws'].includes(path) && request.method === 'GET') {
        response = new Response('WebSocket upgrade required', { status: 426 });
      } else {
        if (path === `${adminPath}/api` && request.method === 'POST') {
          const body = await request.clone().json();
          if (!body || typeof body !== 'object' || Array.isArray(body)) throw Object.assign(new Error('Invalid admin payload'), { status: 400 });
          if (['login', 'two_factor_setup', 'two_factor_enable', 'two_factor_disable'].includes(body.action)) {
            const now = Date.now();
            for (const [ip, state] of loginAttempts) if (now >= state.reset) loginAttempts.delete(ip);
            const factorAttempt = !!(body.otp || body.recoveryCode) || ['two_factor_enable', 'two_factor_disable'].includes(body.action);
            const limits = [[`ip:${request.clientIp}`, 20], ['account', 100], ...(factorAttempt ? [['factor', 10]] : [])];
            let limited = false;
            for (const [key, limit] of limits) {
              const state = loginAttempts.get(key) || { count: 0, reset: now + 60000 };
              state.count++; loginAttempts.set(key, state);
              limited ||= state.count > limit;
            }
            if (limited) { await sendResponse(Response.json({error:'tooManyAttempts'}, {status:429, headers:{'Retry-After':'60', 'Cache-Control':'no-store'}}), req, res); return; }
          }
        }
        response = await staticResponse(request, env.STATIC_ROOT) || await app.fetch(request, env, ctx);
      }
      response = applyCors(response, request, getCorsAllowedOrigins(env));
      response.headers.set('X-Content-Type-Options', 'nosniff');
      if (path === '/api/config' || path === adminPath || path.startsWith(`${adminPath}/`)) {
        response.headers.set('Cache-Control', 'no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        response.headers.set('X-Robots-Tag', 'noindex, nofollow');
      }
      await sendResponse(response, req, res);
    } catch (error) {
      console.error('[http]', error.message);
      if (!res.headersSent) res.writeHead(error.status || (error instanceof SyntaxError ? 400 : 500), { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.status || error instanceof SyntaxError ? error.message : 'Internal server error' }));
    }
  });
  server.requestTimeout = 30000;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
  // The native Agent calibrates its clock from successful HTTP/WS Date headers.
  // ws writes Upgrade responses directly, bypassing node:http's automatic Date.
  wss.on('headers', headers => headers.push(`Date: ${new Date().toUTCString()}`));
  server.on('upgrade', async (req, socket, head) => {
    const reject = (code, message) => { socket.end(`HTTP/1.1 ${code} ${message}\r\nConnection: close\r\n\r\n`); };
    socket.on('error', () => {});
    try {
      if (stopping || wss.clients.size >= 200) return reject(503, 'Unavailable');
      const request = await adapt(req, false);
      const url = new URL(request.url);
      if (!['/api/ws', '/update'].includes(url.pathname)) return reject(404, 'Not Found');
      const origin = request.headers.get('Origin');
      const origins = env.CORS_ALLOWED_ORIGINS.split(',').map(v => v.trim());
      if (origin && origin !== url.origin && !origins.includes(origin)) return reject(403, 'Forbidden');
      const settings = await loadSiteSettings(env.DB);
      let context;
      if (url.pathname === '/update') {
        const schedule = getWssReportScheduleState(settings);
        if (!schedule.active) {
          const reason = schedule.configured ? 'wss_schedule_inactive' : 'wss_disabled';
          const body = JSON.stringify({ error: reason, code: 409, text: reason, connection_mode: 'http' });
          socket.end(`HTTP/1.1 409 Conflict\r\nContent-Type: application/json\r\nX-Agent-Wss-Mode: ${schedule.mode}\r\nX-Agent-Wss-Reason: ${reason}\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`);
          return;
        }
        context = {
          kind: 'agent-report', clientIp: request.clientIp, wssScheduleCheckAfter: Date.now() + 60000,
          agentVersion: normalizeAgentVersion(request.headers.get('X-Agent-Version')),
          configSchema: normalizeAgentConfigSchemaVersion(url.searchParams.get('config_schema') ?? url.searchParams.get('agent_config_schema') ?? request.headers.get(AGENT_CONFIG_SCHEMA_HEADER)),
          configMd5: url.searchParams.get('config_md5') ?? url.searchParams.get('agent_config_md5') ?? request.headers.get(AGENT_CONFIG_MD5_HEADER) ?? ''
        };
      } else {
        const isAdmin = await checkWebSocketAuth(request, env, settings);
        if (settings.is_public !== 'true' && !isAdmin) return reject(401, 'Unauthorized');
        const scope = (url.searchParams.get('subscribe') || 'all').trim();
        if (!env.REALTIME_HUB._isValidScope(scope)) return reject(400, 'Bad Request');
        context = { scope, serverIds: [], isAdmin, expiresAt: isAdmin ? websocketTokenExpiry(request) : 0 };
      }
      wss.handleUpgrade(req, socket, head, ws => {
        ws.alive = true;
        ws.on('pong', () => { ws.alive = true; });
        ws.context = context;
        env.REALTIME_HUB.acceptSocket(ws, context);
      });
    } catch (error) { console.error('[upgrade]', error.message); reject(500, 'Internal Server Error'); }
  });
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) { if (ws.context.expiresAt && Date.now() >= ws.context.expiresAt) { ws.close(1008, 'session expired'); continue; } if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); } }
  }, 30000);
  heartbeat.unref();
  const scheduler = config.SCHEDULER_ENABLED === 'false' ? null : startScheduler(env);
  return {
    env, server,
    async listen(port = Number(config.PORT || 8080), host = config.HOST || '0.0.0.0') {
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
      return server.address();
    },
    async close() {
      stopping = true; clearInterval(heartbeat);
      const closed = new Promise(resolve => server.close(resolve));
      await env.GEOLOCATION.close();
      await scheduler?.stop();
      await env.REALTIME_HUB.close();
      await Promise.allSettled([...pending]);
      for (const ws of wss.clients) ws.terminate();
      wss.close(); server.closeIdleConnections();
      await closed; env.DB.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.env.AGENT_ARCHIVE_ENABLED !== 'false') {
    await new AgentDistribution(process.env.AGENT_DIST_DIR || 'agent-dist').archiveTo(
      process.env.AGENT_ARCHIVE_DIR || resolve(process.env.DATA_DIR || 'data','agent-releases')
    );
  }
  const controller = await createController();
  const address = await controller.listen();
  console.log(JSON.stringify({ event: 'listening', host: address.address, port: address.port, storage: 'sqlite' }));
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, async () => {
    if (closing) return; closing = true;
    const deadline = setTimeout(() => process.exit(1), 20000); deadline.unref();
    await controller.close(); clearTimeout(deadline); process.exit(0);
  });
}
