import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import proxyaddr from 'proxy-addr';

export function createRequestAdapter(trustedProxies = '') {
  const trust = proxyaddr.compile(trustedProxies.split(',').map(s => s.trim()).filter(Boolean));
  return async (req, readBody = true) => {
    const trusted = trust(req.socket.remoteAddress || '127.0.0.1', 0);
    const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const protocol = trusted && forwardedProto === 'https' ? 'https' : 'http';
    const host = trusted ? String(req.headers['x-forwarded-host'] || req.headers.host) : req.headers.host;
    if (!host || /[\s/@\\]/.test(host)) throw Object.assign(new Error('Invalid Host'), { status: 400 });
    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach(v => headers.append(key, v));
      else if (value !== undefined) headers.set(key, value);
    }
    let body;
    if (readBody && !['GET', 'HEAD'].includes(req.method)) {
      if (Number(req.headers['content-length']) > 2 * 1024 * 1024) { req.resume(); throw Object.assign(new Error('Request body too large'), { status: 413 }); }
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw Object.assign(new Error('Request body too large'), { status: 413 });
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
    }
    const request = new Request(`${protocol}://${host}${req.url}`, { method: req.method, headers, body });
    request.clientIp = proxyaddr(req, trust);
    return request;
  };
}

export async function sendResponse(response, req, res) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) if (key !== 'set-cookie') res.setHeader(key, value);
  const cookies = response.headers.getSetCookie();
  if (cookies.length) res.setHeader('set-cookie', cookies);
  if (req.method === 'HEAD' || !response.body) { res.end(); return; }
  await pipeline(Readable.fromWeb(response.body), res);
}

const MIME = {
  '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.svg':'image/svg+xml',
  '.png':'image/png', '.jpg':'image/jpeg', '.gif':'image/gif', '.webp':'image/webp', '.ico':'image/x-icon',
  '.woff':'font/woff', '.woff2':'font/woff2'
};
export async function staticResponse(request, root) {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const path = decodeURIComponent(new URL(request.url).pathname);
  if (!MIME[extname(path)] || path.startsWith('/assets/')) return null;
  const filename = resolve(root, `.${path}`);
  if (!filename.startsWith(`${resolve(root)}${sep}`)) return new Response('Forbidden', { status: 403 });
  try {
    const info = await stat(filename);
    if (!info.isFile()) return null;
    return new Response(Readable.toWeb(createReadStream(filename)), { headers: {
      'Content-Type': MIME[extname(filename)], 'Content-Length': String(info.size),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': path.startsWith('/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'
    } });
  } catch (error) { if (error.code === 'ENOENT') return new Response('Not Found', {status:404}); throw error; }
}
