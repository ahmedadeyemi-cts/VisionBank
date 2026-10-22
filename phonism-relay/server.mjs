import http from 'node:http';
import {createHash, timingSafeEqual, randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const UPSTREAM = 'https://app.phonism.com/api/v3';
const MAX_BODY = 262144, MAX_RESPONSE = 4194304;
const digest = value => createHash('sha256').update(value).digest();
const allowedRead = /^\/(?:hierarchy\/?|hierarchy\/\d+(?:\/(?:tenants\/?|integrations|phones))?|tenants\/\d+\/phones|phones\/\d+(?:\/lines)?)$/;

export function allowedRoute(method, rawPath) {
  if (typeof rawPath !== 'string' || rawPath.length > 2048 || /[%\\#\s]/.test(rawPath)) return false;
  const [path, query = ''] = rawPath.split('?');
  if (rawPath.split('?').length > 2) return false;
  if (method === 'GET') {
    if (!allowedRead.test(path)) return false;
    for (const [key, value] of new URLSearchParams(query)) {
      if (!['limit', 'start_after_id', 'children', 'page', 'offset'].includes(key) ||
          !/^(?:\d+|true|false)$/.test(value)) return false;
    }
    return true;
  }
  return method === 'PUT' && !query &&
    (/^\/hierarchy\/\d+\/integrations\/sync$/.test(path) || /^\/phones\/\d+\/tr069$/.test(path));
}

async function bounded(stream, limit) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new Error('size-limit');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function createRelay({token = process.env.PHONISM_RELAY_TOKEN || '', fetcher = fetch,
  log = entry => console.log(JSON.stringify(entry)), timeoutMs = 15000, maxConcurrent = 16} = {}) {
  let active = 0;
  const ready = token.length >= 32;
  const send = (res, status, code) => {
    res.writeHead(status, {'content-type': 'application/json', 'cache-control': 'no-store',
      'x-phonism-relay-error': code});
    res.end(JSON.stringify({error: code}));
  };
  return http.createServer({maxHeaderSize: 16384, requestTimeout: 20000, headersTimeout: 10000}, async (req, res) => {
    if (req.method === 'GET' && req.url === '/healthz') {
      res.writeHead(ready ? 200 : 503, {'content-type': 'application/json', 'cache-control': 'no-store'});
      res.end(JSON.stringify({ready, service: 'visionbank-phonism-relay'})); return;
    }
    if (!ready) return send(res, 503, 'relay-not-configured');
    const auth = String(req.headers.authorization || '');
    if (!timingSafeEqual(digest(auth), digest('Bearer ' + token))) return send(res, 401, 'relay-unauthorized');
    if (!req.url.startsWith('/api/v3/')) return send(res, 404, 'relay-route-denied');
    const path = req.url.slice('/api/v3'.length);
    if (!allowedRoute(req.method, path)) return send(res, 400, 'relay-route-denied');
    const apiKey = String(req.headers['x-api-key'] || '');
    if (apiKey.length < 16 || apiKey.length > 4096) return send(res, 400, 'relay-api-key-required');
    if (active >= maxConcurrent) return send(res, 503, 'relay-busy');
    active++;
    const requestId = randomUUID(), started = Date.now(), controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    res.on('close', () => { if (!res.writableEnded) controller.abort(); });
    let dispatched = false, status = 500;
    try {
      const body = await bounded(req, MAX_BODY);
      if (req.method === 'GET' && body.length) { status = 400; return send(res, status, 'relay-body-denied'); }
      if (req.method === 'PUT') {
        let parsed; try { parsed = JSON.parse(body.toString()); } catch { status = 400; return send(res, status, 'relay-invalid-json'); }
        if (path.endsWith('/tr069') && (Object.keys(parsed || {}).length !== 1 ||
            JSON.stringify(parsed?.queue) !== '["Reboot"]')) {
          status = 400; return send(res, status, 'relay-action-denied');
        }
      }
      dispatched = true;
      const upstream = await fetcher(UPSTREAM + path, {method: req.method, redirect: 'manual',
        signal: controller.signal, headers: {Accept: 'application/json', 'x-api-key': apiKey,
          'Cache-Control': 'no-cache', ...(req.method === 'PUT' ? {'Content-Type': 'application/json'} : {})},
        ...(req.method === 'PUT' ? {body} : {})});
      const responseBody = upstream.body ? await bounded(upstream.body, MAX_RESPONSE) : Buffer.alloc(0);
      const headers = {'cache-control': 'no-store', 'x-phonism-relay-request-id': requestId};
      for (const name of ['content-type', 'retry-after', 'cf-ray', 'x-request-id', 'server']) {
        const value = upstream.headers.get(name); if (value) headers[name] = value;
      }
      status = upstream.status;
      res.writeHead(status, headers); res.end(responseBody);
    } catch {
      status = dispatched ? 502 : 400;
      if (!res.destroyed && !res.headersSent) send(res, status, dispatched ? 'relay-outcome-unknown' : 'relay-request-rejected');
    } finally {
      clearTimeout(timer); active--;
      // Never log keys, bodies, query strings, phone numbers or upstream error text.
      log({requestId, method: req.method, status, dispatched, durationMs: Date.now() - started});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelay();
  server.listen(Number(process.env.PORT || 10000), '0.0.0.0');
  process.on('SIGTERM', () => { server.close(); setTimeout(() => process.exit(0), 20000).unref(); });
}
