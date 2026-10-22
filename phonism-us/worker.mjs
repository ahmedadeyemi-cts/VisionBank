const UPSTREAM = 'https://app.phonism.com/api/v3';
const MAX_BODY = 262144, MAX_RESPONSE = 4194304;
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
  if (!stream) return new Uint8Array();
  const reader = stream.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const {value, done} = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw new Error('size-limit'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return result;
}

function failure(status, code) {
  return Response.json({error: code}, {status, headers: {
    'cache-control': 'no-store', 'x-phonism-us-error': code
  }});
}

// Only account-internal Durable Object bindings can invoke this class.
// The API key exists only in request memory; nothing is written to storage.
export class PhonismUS {
  constructor(ctx, env) { this.ctx = ctx; this.active = 0; }
  async fetch(request) {
    if (this.ctx.id.jurisdiction !== 'us') return failure(503, 'us-jurisdiction-required');
    const url = new URL(request.url), path = url.pathname + url.search;
    if (url.origin !== 'https://phonism.internal' || !allowedRoute(request.method, path))
      return failure(400, 'route-denied');
    const apiKey = request.headers.get('x-api-key') || '';
    if (apiKey.length < 16 || apiKey.length > 4096) return failure(400, 'api-key-required');
    if (this.active >= 16) return failure(503, 'route-busy');
    this.active++;
    const requestId = crypto.randomUUID(), started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let dispatched = false, status = 500;
    try {
      const body = await bounded(request.body, MAX_BODY);
      if (request.method === 'GET' && body.length) { status = 400; return failure(status, 'body-denied'); }
      if (request.method === 'PUT') {
        let parsed; try { parsed = JSON.parse(new TextDecoder().decode(body)); }
        catch { status = 400; return failure(status, 'invalid-json'); }
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
          status = 400; return failure(status, 'invalid-json');
        }
        if (url.pathname.endsWith('/tr069') && (Object.keys(parsed).length !== 1 ||
            JSON.stringify(parsed.queue) !== '["Reboot"]')) {
          status = 400; return failure(status, 'action-denied');
        }
        if (url.pathname.endsWith('/integrations/sync') &&
            (Object.keys(parsed).some(k => !['asset_type', 'company_id', 'tenant_id'].includes(k)) ||
             !Array.isArray(parsed.asset_type) || !parsed.asset_type.length ||
             parsed.asset_type.some(x => !['Organization','Location','People','Workspace','Device'].includes(x)) ||
             ['company_id','tenant_id'].some(k => k in parsed && !/^\d+$/.test(String(parsed[k]))))) {
          status = 400; return failure(status, 'sync-body-denied');
        }
      }
      dispatched = true;
      const upstream = await fetch(UPSTREAM + path, {method: request.method, redirect: 'manual',
        signal: controller.signal, headers: {Accept: 'application/json', 'x-api-key': apiKey,
          'Cache-Control': 'no-cache', ...(request.method === 'PUT' ? {'Content-Type': 'application/json'} : {})},
        ...(request.method === 'PUT' ? {body} : {})});
      const responseBody = await bounded(upstream.body, MAX_RESPONSE);
      const headers = {'cache-control': 'no-store', 'x-phonism-us-request-id': requestId};
      for (const name of ['content-type', 'retry-after', 'cf-ray', 'x-request-id', 'server']) {
        const value = upstream.headers.get(name); if (value) headers[name] = value;
      }
      status = upstream.status;
      return new Response([204,205,304].includes(status) ? null : responseBody, {status, headers});
    } catch {
      status = dispatched ? 502 : 400;
      return failure(status, dispatched ? 'outcome-unknown' : 'request-rejected');
    } finally {
      clearTimeout(timer); this.active--;
      console.log(JSON.stringify({service: 'phonism-us', requestId, method: request.method,
        status, dispatched, durationMs: Date.now() - started}));
    }
  }
}

export default { fetch() { return new Response('Not found', {status: 404}); } };
