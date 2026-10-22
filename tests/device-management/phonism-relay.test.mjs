import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createRelay, allowedRoute} from '../../phonism-relay/server.mjs';
import {createPhonismReader, defaultPhonismFetch} from '../../device-management/phonism.mjs';
const token = 'test-only-relay-token-000000000000000000';
const apiKey = 'test-only-phonism-api-key';
const env = {PHONISM_API_KEY: apiKey, PHONISM_RELAY_TOKEN: token,
  PHONISM_RELAY_URL: 'https://visionbank-phonism-us.onrender.com'};
async function fixture(t, options = {}) {
  const calls = [], logs = [];
  const server = createRelay({token, log: entry => logs.push(entry),
    fetcher: async (url, options) => {calls.push({url, options}); return Response.json({errors: [], data: []});},
    ...options});
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => {server.closeAllConnections(); server.close();});
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (path, options = {}) => fetch(base + path, {...options,
    headers: {authorization: 'Bearer ' + token, 'x-api-key': apiKey, ...options.headers}});
  return {calls, logs, send, base};
}
test('relay accepts line read and preserves safe upstream response, without logging secrets', async t => {
  const f = await fixture(t);
  const res = await f.send('/api/v3/phones/313135/lines');
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), {errors: [], data: []});
  assert.equal(f.calls[0].url, 'https://app.phonism.com/api/v3/phones/313135/lines');
  assert.equal(f.calls[0].options.headers['x-api-key'], apiKey);
  assert.equal(f.calls[0].options.headers.Authorization, undefined);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.ok(res.headers.get('x-phonism-relay-request-id'));
  assert.ok(!JSON.stringify(f.logs).includes(apiKey));
  assert.ok(!JSON.stringify(f.logs).includes(token));
});
test('unauthorized requests, arbitrary destinations, destructive actions and methods never reach upstream', async t => {
  const f = await fixture(t);
  assert.equal((await f.send('/api/v3/phones/1/lines', {headers: {authorization: 'Bearer wrong'}})).status, 401);
  for (const path of ['/api/v3/phones/1/reset', '/api/v3//evil.example', '/api/v3/phones/%2e%2e/lines',
    '/api/v3/phones/1/lines?url=https://evil.example']) {
    assert.ok((await f.send(path)).status >= 400);
  }
  assert.equal((await f.send('/api/v3/phones/1/lines', {method: 'DELETE'})).status, 400);
  assert.equal((await f.send('/api/v3/phones/1/tr069', {method: 'PUT', body: '{"queue":["FactoryReset"]}'})).status, 400);
  assert.equal(f.calls.length, 0);
});
test('sync and reboot are forwarded once with their original body', async t => {
  const f = await fixture(t);
  for (const [path, body] of [['/hierarchy/30/integrations/sync', {company_id: 40, tenant_id: 101, asset_type: ['Device']}],
    ['/phones/1/tr069', {queue: ['Reboot']}]]) {
    const res = await f.send('/api/v3' + path, {method: 'PUT', body: JSON.stringify(body)});
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(f.calls.at(-1).options.body.toString()), body);
  }
  assert.equal(f.calls.length, 2);
});
test('upstream status and retry metadata survive; redirects are never followed', async t => {
  const f = await fixture(t, {fetcher: async (_, opts) => {
    assert.equal(opts.redirect, 'manual');
    return new Response('blocked', {status: 403, headers: {'content-type': 'text/html', 'cf-ray': 'test-AMS', server: 'cloudflare'}});
  }});
  const res = await f.send('/api/v3/phones/1/lines');
  assert.equal(res.status, 403); assert.equal(res.headers.get('cf-ray'), 'test-AMS');
  assert.equal(res.headers.get('content-type'), 'text/html');
});
test('transport failures are marked unknown and never retried by relay', async t => {
  let count = 0;
  const f = await fixture(t, {fetcher: async () => {count++; throw new Error('private upstream details');}});
  const res = await f.send('/api/v3/phones/1/tr069', {method: 'PUT', body: '{"queue":["Reboot"]}'});
  assert.equal(res.status, 502); assert.equal(res.headers.get('x-phonism-relay-error'), 'relay-outcome-unknown');
  assert.ok(!(await res.text()).includes('private')); assert.equal(count, 1);
});
test('missing configuration is unhealthy and denies requests', async t => {
  const f = await fixture(t, {token: ''});
  assert.equal((await f.send('/healthz')).status, 503);
  assert.equal((await f.send('/api/v3/phones/1/lines')).status, 503);
  assert.equal(f.calls.length, 0);
});
test('supported inventory pagination is allowed; path traversal and unknown parameters are denied', () => {
  for (const path of ['/hierarchy/?limit=100', '/hierarchy/40?children=false', '/hierarchy/40/tenants/?limit=100',
    '/hierarchy/40/phones?limit=100&start_after_id=99', '/tenants/101/phones?limit=100']) assert.ok(allowedRoute('GET', path), path);
  for (const path of ['/phones/1/../2', '/phones/1\\lines', '/phones/1#fragment', '/phones/%31/lines',
    '/phones/1/lines?secret=1']) assert.equal(allowedRoute('GET', path), false, path);
});
test('all client reads and writes route through configured relay', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, opts) => {
    calls.push({url, opts}); return Response.json({errors: [], data: []});
  });
  const reader = createPhonismReader();
  await reader.lines(env, '313135');
  await reader.syncHierarchyIntegration(env, '30', {tenantId: '101'});
  await reader.tr069Action(env, '313135', 'Reboot');
  assert.equal(calls.length, 3);
  for (const {url, opts} of calls) {
    assert.ok(url.startsWith(env.PHONISM_RELAY_URL + '/api/v3/'));
    assert.equal(opts.headers.Authorization, 'Bearer ' + token);
    assert.equal(opts.headers['x-api-key'], apiKey);
    assert.equal(opts.redirect, 'manual');
  }
});
test('partial or unsafe relay configuration fails closed without any fetch', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {count++; throw Error('must not run');});
  for (const config of [{PHONISM_RELAY_URL: 'http://example.com'}, {PHONISM_RELAY_TOKEN: ''},
    {PHONISM_RELAY_URL: 'https://example.com/path'}, {PHONISM_RELAY_URL: ''}]) {
    await assert.rejects(defaultPhonismFetch({...env, ...config}, '/phones/1/lines'));
  }
  assert.equal(count, 0);
});
test('unknown relay outcomes stop client sync retries and never fall back to direct Phonism', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++; return Response.json({error: 'relay-outcome-unknown'}, {status: 502,
      headers: {'x-phonism-relay-error': 'relay-outcome-unknown'}});
  });
  await assert.rejects(createPhonismReader().syncHierarchyIntegration(env, '30'),
    e => e.providerFailure === 'relay-unavailable');
  assert.equal(count, 1);
});

test('relay deadline bounds a stalled upstream call without retrying it', async t => {
  let count = 0;
  const f = await fixture(t, {timeoutMs: 30, fetcher: async (_, {signal}) => {
    count++; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('timeout')), {once: true}));
  }});
  const res = await f.send('/api/v3/phones/1/lines');
  assert.equal(res.status, 502); assert.equal(count, 1);
  assert.equal(res.headers.get('x-phonism-relay-error'), 'relay-outcome-unknown');
});
test('Render gateway errors without relay provenance cannot trigger duplicate writes', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {count++; return new Response('gateway unavailable', {status: 502});});
  await assert.rejects(createPhonismReader().syncHierarchyIntegration(env, '30'),
    e => e.providerFailure === 'relay-unavailable');
  assert.equal(count, 1);
});
test('explicit upstream temporary rejection still permits the existing bounded sync retry', async t => {
  let count = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    count++;
    return Response.json({errors: []}, {status: count === 1 ? 503 : 202,
      headers: {'x-phonism-relay-request-id': 'test-correlation', 'Retry-After': '0'}});
  });
  assert.equal((await createPhonismReader().syncHierarchyIntegration(env, '30')).accepted, true);
  assert.equal(count, 2);
});
