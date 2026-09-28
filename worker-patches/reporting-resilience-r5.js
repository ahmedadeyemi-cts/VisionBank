/* Reporting-only resilience. Not a standalone Worker. No credentials or routing writes.
 * Uses the existing webexFetch authentication/rotation unchanged. All caches are
 * per organization and Central reporting day; failures never become zero totals.
 */
const VB_REPORTING_R5 = '2026.09.28-reporting-r5';
const vbRepCache = new Map();
const vbRepConnections = new Map();
const vbRepCooldown = new Map();
function vbRepError(code, http = 503, retryAfter = 5) {
  const e = new Error(code); e.code = code; e.http = http; e.retryAfter = retryAfter; return e;
}
async function vbRepBound(promise, deadline, code = 'report-deadline') {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(vbRepError(code)), Math.max(1, deadline - Date.now()));
  })]); } finally { clearTimeout(timer); }
}
function vbRepRetryAfter(value) {
  const n = Number(value);
  if (value && Number.isFinite(n) && n >= 0) return Math.max(1, Math.ceil(n));
  const at = Date.parse(value || '');
  return Number.isFinite(at) ? Math.max(1, Math.ceil((at - Date.now()) / 1000)) : 5;
}
async function vbRepSearch(env, query, deadline) {
  const org = String(env.WEBEX_ORG_ID || '');
  const section = /\b(agentSession|taskLegDetails|taskDetails)\s*\(/.exec(query)?.[1] || 'search';
  const start = Date.now(); let http = null, outcome = 'error';
  try {
    const until = vbRepCooldown.get(org) || 0;
    if (until > Date.now()) throw vbRepError('upstream-rate-limited', 429, Math.ceil((until - Date.now()) / 1000));
    const region = await vbRepBound(env.WEBEX_AUTH_KV.get(WEBEX_REGION_STATE_KEY, 'json'), deadline);
    if (!region?.baseUrl || !org) throw vbRepError('report-region-unavailable');
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= deadline) throw vbRepError('report-deadline');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(1, deadline - Date.now()));
      try {
        const response = await vbRepBound(webexFetch(env, `${region.baseUrl}/search?orgId=${encodeURIComponent(org)}`, {
          method: 'POST', signal: controller.signal,
          headers: {'Content-Type': 'application/json', Accept: 'application/json', 'Accept-Encoding': 'gzip'},
          body: JSON.stringify({query, variables: {}})
        }), deadline);
        http = response.status;
        if (http === 429) {
          const retry = vbRepRetryAfter(response.headers.get('Retry-After'));
          vbRepCooldown.set(org, Date.now() + retry * 1000);
          await response.body?.cancel();
          throw vbRepError('upstream-rate-limited', http, retry);
        }
        if ([502,503,504].includes(http) && attempt === 0 && deadline - Date.now() > 2000) {
          await response.body?.cancel();
          await vbRepBound(new Promise(r => setTimeout(r, 750)), deadline);
          continue;
        }
        const text = await vbRepBound(response.text(), deadline);
        if (!response.ok) throw vbRepError('upstream-http-error', http);
        let data; try { data = JSON.parse(text); } catch { throw vbRepError('upstream-invalid-json'); }
        if (Array.isArray(data.errors) && data.errors.length) throw vbRepError('upstream-graphql-error');
        if (!data.data || typeof data.data !== 'object') throw vbRepError('upstream-missing-data');
        outcome = 'ok'; return data.data;
      } finally { clearTimeout(timer); controller.abort(); }
    }
    throw vbRepError('upstream-retry-exhausted');
  } catch (e) {
    outcome = e.code || (e.name === 'AbortError' ? 'report-deadline' : 'upstream-unavailable');
    throw e.code ? e : vbRepError(outcome);
  } finally {
    console.log(JSON.stringify({event:'vb-report-query',revision:VB_REPORTING_R5,section,
      elapsedMs:Date.now()-start,http,outcome}));
  }
}
async function vbRepPaged(env, makeQuery, rootName, collectionName, maxPages = 100) {
  const deadline = Date.now() + 35000, rows = [], seen = new Set(); let cursor = null;
  for (let page = 0; page < maxPages; page++) {
    const data = await vbRepSearch(env, makeQuery(cursor), deadline), root = data[rootName];
    if (!Array.isArray(root?.[collectionName]) || typeof root.pageInfo?.hasNextPage !== 'boolean')
      throw vbRepError('report-invalid-pagination-contract');
    rows.push(...root[collectionName]);
    if (!root.pageInfo.hasNextPage) return rows;
    const next = root.pageInfo.endCursor;
    if (typeof next !== 'string' || !next || seen.has(next)) throw vbRepError('report-invalid-cursor');
    seen.add(next); cursor = next;
  }
  throw vbRepError('report-page-limit');
}
async function vbRepCached(env, name, ttl, load) {
  const day = getCentralDayStartEpochMs(Date.now());
  const key = `${env.WEBEX_ORG_ID}:${name}:${day}`;
  for (const [k,e] of vbRepCache) if (e.day !== day && !e.promise) vbRepCache.delete(k);
  let entry = vbRepCache.get(key);
  if (entry?.data && entry.expires > Date.now()) return entry.data;
  if (!entry?.promise) {
    entry = {day, data:null, expires:0, promise:null}; vbRepCache.set(key, entry);
    const started = Date.now();
    entry.promise = vbRepBound(Promise.resolve().then(load), started + 37000).then(data => {
      entry.data = data; entry.expires = Date.now()+ttl; return data;
    }).finally(() => {entry.promise=null; console.log(JSON.stringify({event:'vb-report-section',
      revision:VB_REPORTING_R5,section:name,elapsedMs:Date.now()-started,ok:entry.data!==null}));});
  }
  return entry.promise;
}
// Original report assembly/metrics are retained. Only the shared cache and read
// transport are replaced, independently bounding the four report sections.
vbChatSection = (env,name,ttl,load) => vbRepCached(env,'chat-'+name,ttl,load);
vbChatQuery = (env,query,deadline) => vbRepSearch(env,query,deadline);
async function vbRepConnectionTimes(env,tasks,now,deadline) {
  const result = new Map(), org=String(env.WEBEX_ORG_ID);
  for (const [k,e] of vbRepConnections) if (e.expires < Date.now()) vbRepConnections.delete(k);
  const pending=[];
  for (const t of tasks.slice().sort((a,b)=>b.createdTime-a.createdTime)) {
    if (t.isContactHandled!==true) continue;
    const cached=vbRepConnections.get(org+':'+t.id);
    if(cached) result.set(t.id,cached.at); else if(pending.length<10) pending.push(t);
  }
  // Optional enrichment never holds essential totals longer than 2.5 seconds.
  const stop=Math.min(deadline,Date.now()+2500);
  let i=0;
  const run=async()=>{
    while(i<pending.length && stop-Date.now()>300) {
      const task=pending[i++];
      try {
        const at=await vbRepBound(vbChatFirstConnection(env,task,now,stop),stop,'optional-enrichment-deadline');
        if(at!==null) {result.set(task.id,at);vbRepConnections.set(org+':'+task.id,{at,expires:Date.now()+86400000});}
      } catch { /* Missing optional timestamps are explicitly reported below. */ }
    }
  };
  await Promise.all([run(),run()]);
  while(vbRepConnections.size>2000)vbRepConnections.delete(vbRepConnections.keys().next().value);
  return result;
}
vbChatCollectLegacyDaily = async function(env,now) {
  const from=vbChatCentralStart(now),deadline=Date.now()+35000;
  const tasks=vbChatNormalizeTasks(await vbChatPages(env,c=>vbChatTaskQuery(from,now,c),deadline),from,now);
  const times=await vbRepConnectionTimes(env,tasks,now,deadline);
  const warnings=[];
  if(tasks.some(t=>t.isContactHandled===true&&!times.has(t.id)))warnings.push(
    'Some first-connected timestamps are unavailable; optional enrichment does not block chat totals. No timestamps are estimated.');
  if(!tasks.length)warnings.push('No Contact Center chat records were returned today. This does not confirm widget routing.');
  return {success:true,schemaVersion:2,build:VB_CHAT_REPORT_VERSION,generatedAt:now,
    dailyStatus:'ready',summary:vbChatDailySummary(tasks),
    rows:tasks.map(t=>vbChatRow(t,times.get(t.id))).sort((a,b)=>b.startedAt-a.startedAt),warnings};
};
const vbRepRetainedCollect=vbChatCollect;
vbChatCollect=async function(env,now) {
  const started=Date.now(),data=await vbRepRetainedCollect(env,now);
  return {...data,reportingRevision:VB_REPORTING_R5,reportingDiagnostics:{elapsedMs:Date.now()-started,
    coreSectionsIndependent:true,optionalEnrichmentBudgetMs:2500,queryBudgetMs:35000,
    daily:data.dailyStatus,live:data.liveStatus,completed:data.completedStatus,callbacks:data.callbacks?.status}};
};
const vbRepRetainedHandler=handleWebexDashboard;
handleWebexDashboard=async function(request,env,cors) {
  const r=await vbRepRetainedHandler(request,env,cors);
  if(r.status>=500) return json({success:false,error:'reporting-temporarily-unavailable',
    reportingRevision:VB_REPORTING_R5,retryAfterSeconds:5},{...cors,'Retry-After':'5','Cache-Control':'no-store'},503);
  return r;
};
