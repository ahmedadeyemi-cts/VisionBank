import {DurableObject} from 'cloudflare:workers';

// Internal service only: no workers.dev, preview URLs, custom domains or routes.
// Fixed GET target, no raw response bodies or credentials returned or persisted.
export class PhonismUSProbe extends DurableObject {
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/probe') return new Response(null, {status:404});
    const started = Date.now();
    const key = request.headers.get('x-api-key') || '';
    let jurisdiction;
    try { jurisdiction = this.ctx.id.jurisdiction; } catch {}
    if (jurisdiction !== 'us') return Response.json({error:'us-jurisdiction-not-confirmed',jurisdiction:jurisdiction || null}, {status:503});
    // Hard cap for this investigation, with no recurring alarms or schedules.
    const count = await this.ctx.storage.get('probe-count') || 0;
    if (count >= 6) return Response.json({error:'probe-limit-reached'}, {status:429});
    await this.ctx.storage.put('probe-count', count + 1);
    let network = {};
    try {
      const trace = await fetch('https://www.cloudflare.com/cdn-cgi/trace', {signal:AbortSignal.timeout(5000)});
      const values = Object.fromEntries((await trace.text()).trim().split('\n').map(line=>line.split('=')));
      network = {observedCountry:values.loc || null, observedColo:values.colo || null};
    } catch { network = {traceUnavailable:true}; }
    try {
      const response = await fetch('https://app.phonism.com/api/v3/phones/313135/lines', {
        method:'GET', redirect:'manual', signal:AbortSignal.timeout(15000),
        headers:{Accept:'application/json','Cache-Control':'no-cache',...(key ? {'x-api-key':key} : {})}
      });
      let validApiEnvelope = false, errorCount = null;
      try {
        const data = await response.json();
        validApiEnvelope = Boolean(data && Array.isArray(data.errors));
        errorCount = validApiEnvelope ? data.errors.length : null;
      } catch {}
      return Response.json({
        test:'cloudflare-us-durable-object-read-only', at:new Date().toISOString(), jurisdiction,
        ...network, authenticated:Boolean(key), phoneId:'313135', httpStatus:response.status,
        contentType:(response.headers.get('content-type') || '').split(';')[0],
        server:response.headers.get('server'), ray:response.headers.get('cf-ray'),
        validApiEnvelope, errorCount, durationMs:Date.now()-started,
        passed:Boolean(key)&&response.ok&&validApiEnvelope&&errorCount===0
      }, {headers:{'Cache-Control':'no-store'}});
    } catch {
      return Response.json({test:'cloudflare-us-durable-object-read-only', jurisdiction, ...network,
        error:'upstream-request-failed',durationMs:Date.now()-started}, {status:502});
    }
  }
}

export default {
  async fetch(request, env) {
    if(request.method!=='POST'||new URL(request.url).pathname!=='/probe')return new Response(null,{status:404});
    const ns=env.US_PROBE.jurisdiction('us');
    return ns.get(ns.idFromName('read-only-20261022')).fetch(request);
  }
};
