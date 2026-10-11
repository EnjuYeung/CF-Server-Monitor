// Loopback development proxy. Production hosts only the built index.html/assets.
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join, sep, extname } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';

const source = fileURLToPath(new URL('./', import.meta.url));
export function createThemeDevServer(apiOrigin, root = source) {
  const target = new URL(apiOrigin);
  if (!['http:', 'https:'].includes(target.protocol) || target.pathname !== '/' || target.username || target.password || target.search || target.hash) throw new Error('Expected API origin');
  const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
  const upstreams = new Set();
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/') || (req.method === 'POST' && /^\/[A-Za-z0-9_-]{8,128}\/api$/.test(path))) {
      const remote = request(new URL(req.url, target), { method: req.method, headers: { ...req.headers, host: target.host, origin: target.origin } }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      remote.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end('Development proxy unavailable'); });
      req.pipe(remote); return;
    }
    try {
      const filename = resolve(root, path === '/' ? 'index.html' : `.${decodeURIComponent(path)}`);
      if (!filename.startsWith(`${resolve(root)}${sep}`)) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html;charset=UTF-8', '.js': 'text/javascript', '.css': 'text/css' };
      const body = await readFile(filename);
      res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body);
    } catch { res.writeHead(404).end('Not Found'); }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, connection, head) => {
    if (new URL(req.url, target).pathname !== '/api/ws') { connection.destroy(); return; }
    wss.handleUpgrade(req, connection, head, client => {
      const url = new URL(req.url, target); url.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
      const remote = new WebSocket(url, { headers: { Origin: target.origin, ...(req.headers.cookie ? { Cookie: req.headers.cookie } : {}) } });
      upstreams.add(remote); const pending = [];
      client.on('message', data => {
        if (remote.readyState === WebSocket.OPEN) remote.send(data.toString());
        else if (pending.length < 16) pending.push(data.toString());
      });
      remote.on('open', () => { for (const data of pending) remote.send(data); pending.length = 0; });
      remote.on('message', data => { if (client.readyState === WebSocket.OPEN) client.send(data.toString()); });
      remote.on('error', () => client.close(1011));
      remote.on('close', () => { upstreams.delete(remote); client.close(); });
      client.on('close', () => remote.close());
      client.on('error', () => remote.terminate());
    });
  });
  return {
    server,
    async close() {
      for (const client of wss.clients) client.terminate();
      for (const remote of upstreams) remote.terminate();
      wss.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dev = createThemeDevServer(process.argv[2] || 'http://127.0.0.1:8080');
  dev.server.listen(Number(process.argv[3] || 5180), '127.0.0.1', () => console.log(`Theme preview: http://127.0.0.1:${dev.server.address().port}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void dev.close());
}
