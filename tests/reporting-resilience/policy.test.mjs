import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from '../../scripts/build-reporting-resilience-r5.mjs';
const baseline=fs.readFileSync(process.env.VB_REPORT_BASELINE,'utf8');
const extension=fs.readFileSync(new URL('../../worker-patches/reporting-resilience-r5.js',import.meta.url),'utf8');
const {candidate,proof}=build(baseline,extension);
function rig(fetcher){
  const logs=[],queries=[];
  const context=vm.createContext({Request,Response,Headers,AbortController,URL,Date,Intl,TextEncoder,TextDecoder,
    setTimeout,clearTimeout,console:{log:x=>logs.push(x),warn:()=>{},error:()=>{}},
    fetch(){throw new Error('No live fetch allowed in tests');},
    __read:async(env,url,options)=>{queries.push(JSON.parse(options.body).query);return fetcher(env,url,options);}});
  vm.runInContext(candidate.replace('export default','globalThis.worker ='),context);
  vm.runInContext(`webexFetch=(...x)=>__read(...x);globalThis.api={search:vbRepSearch,paged:vbRepPaged,cache:vbRepCached,
    agents:vbRepFetchAgents,daily:vbChatCollectLegacyDaily,handler:(...x)=>handleWebexDashboard(...x),
    deny(){checkAccess=async()=>({allowed:false});},failBuild(){buildWebexDashboardData=async()=>{throw new Error('PRIVATE');};checkAccess=async()=>({allowed:true});},
    timed:vbRepBound,retry:vbRepRetryAfter};`,context);
  const env={WEBEX_ORG_ID:'test-org',WEBEX_AUTH_KV:{get:async()=>({baseUrl:'https://api.test'})}};
  return {api:context.api,env,logs,queries};
}
const data=x=>new Response(JSON.stringify({data:x}),{headers:{'Content-Type':'application/json'}});
test('build retains exact security, OAuth, scheduled and nonreporting bytes',()=>{
  assert.equal(proof.baselineSha256,'23e48e129e366270fc3d8f2fc843f84ed2ef283a32caa4766e2fd3cb2af6bc10');
  for(const count of Object.values(proof.securityRoutes))assert.equal(count,1);
  assert.ok(candidate.includes(baseline.slice(0,baseline.indexOf('ttlMs: 15000, budgetMs: 20000'))));
});
test('refuses arbitrary/partial baseline',()=>assert.throws(()=>build(baseline+' ',extension)));
test('authenticated transport is reused; compressed responses requested',async()=>{
  const r=rig(async(e,u,o)=>{assert.equal(o.headers['Accept-Encoding'],'gzip');assert.ok(o.signal);return data({taskDetails:{tasks:[]}});});
  const x=await r.api.search(r.env,'{taskDetails(from:1 to:2){tasks{id}}}',Date.now()+1000);
  assert.ok(Array.isArray(x.taskDetails.tasks));assert.equal(r.queries.length,1);
});
for(const [name,response,code]of [
  ['invalid JSON',()=>new Response('not-json'), 'upstream-invalid-json'],
  ['GraphQL error at HTTP 200',()=>new Response(JSON.stringify({errors:[{message:'private provider detail'}]})),'upstream-graphql-error'],
  ['missing data',()=>new Response('{}'),'upstream-missing-data']
])test(name+' is not a successful empty result',async()=>{const r=rig(async()=>response());await assert.rejects(r.api.search(r.env,'{taskDetails{}}',Date.now()+1000),e=>e.code===code);});
test('429 honors Retry-After and blocks subsequent upstream calls',async()=>{
 const r=rig(async()=>new Response('{}',{status:429,headers:{'Retry-After':'60'}}));
 for(let i=0;i<2;i++)await assert.rejects(r.api.search(r.env,'{taskDetails{}}',Date.now()+1000),e=>e.http===429&&e.retryAfter>0);
 assert.equal(r.queries.length,1);
});
test('one retry recovers a 503; never infinite',async()=>{
 let n=0;const r=rig(async()=>++n===1?new Response('{}',{status:503}):data({taskDetails:{tasks:[]}}));
 await r.api.search(r.env,'{taskDetails{}}',Date.now()+4000);assert.equal(n,2);
});
test('hung transport is bounded without changing authentication',async()=>{
 const r=rig(async()=>new Promise(()=>{}));const start=Date.now();
 await assert.rejects(r.api.search(r.env,'{taskDetails{}}',Date.now()+25));assert.ok(Date.now()-start<500);
});
test('pagination handles opaque string cursors',async()=>{
 let n=0;const r=rig(async()=>data({taskDetails:{tasks:[{id:++n}],pageInfo:{hasNextPage:n===1,endCursor:'opaque:cursor=='}}}));
 const rows=await r.api.paged(r.env,c=>'{taskDetails '+(c||'first')+'}', 'taskDetails','tasks');
 assert.equal(rows.length,2);assert.ok(r.queries[1].includes('opaque:cursor=='));
});
test('repeated cursor rejects rather than reporting truncated totals',async()=>{
 const r=rig(async()=>data({taskDetails:{tasks:[],pageInfo:{hasNextPage:true,endCursor:'repeat'}}}));
 await assert.rejects(r.api.paged(r.env,()=>'{taskDetails{}}','taskDetails','tasks'),e=>e.code==='report-invalid-cursor');
});
test('missing pagination metadata is not interpreted as empty',async()=>{
 const r=rig(async()=>data({taskDetails:{tasks:[]}}));await assert.rejects(r.api.paged(r.env,()=>'', 'taskDetails','tasks'));
});
test('page limit is explicit failure',async()=>{
 let n=0;const r=rig(async()=>data({taskDetails:{tasks:[],pageInfo:{hasNextPage:true,endCursor:'p'+(++n)}}}));
 await assert.rejects(r.api.paged(r.env,()=>'', 'taskDetails','tasks',2),e=>e.code==='report-page-limit');assert.equal(n,2);
});
test('cache coalesces simultaneous reads and reuses only fresh successful data',async()=>{
 const r=rig(async()=>data({}));let n=0;const load=async()=>{n++;await new Promise(r=>setTimeout(r,10));return {ok:true};};
 await Promise.all([r.api.cache(r.env,'test',1000,load),r.api.cache(r.env,'test',1000,load)]);
 await r.api.cache(r.env,'test',1000,load);assert.equal(n,1);
});
test('cache does not cross organizations',async()=>{
 const r=rig(async()=>data({}));let n=0;const load=async()=>({n:++n});
 await r.api.cache(r.env,'test',1000,load);await r.api.cache({...r.env,WEBEX_ORG_ID:'other'},'test',1000,load);assert.equal(n,2);
});
test('failed cached build can recover and is not converted to zero',async()=>{
 const r=rig(async()=>data({}));await assert.rejects(r.api.cache(r.env,'test',1000,async()=>{throw new Error('fail');}));
 const d=await r.api.cache(r.env,'test',1000,async()=>({ok:true}));assert.equal(d.ok,true);
});
test('only dashboard-specific agent query is narrowed to active sessions',async()=>{
 const r=rig(async()=>data({agentSession:{agentSessions:[],pageInfo:{hasNextPage:false,endCursor:null}}}));
 await r.api.agents(r.env,Date.now()-2592000000,Date.now());
 assert.match(r.queries[0],/filter:\s*\{ isActive: \{ equals: true \} \}/);
 assert.ok(candidate.includes('async function fetchWebexAgentSessions(env, from, to)')); // original control path retained
});
test('daily chat core makes no duplicate live query',async()=>{
 const r=rig(async()=>data({taskDetails:{tasks:[],pageInfo:{hasNextPage:false,endCursor:null}}}));
 const d=await r.api.daily(r.env,Date.now());assert.equal(d.dailyStatus,'ready');assert.equal(r.queries.length,1);
 assert.ok(!r.queries[0].includes('isActive: { equals: true }'));
});
test('failed optional timestamp enrichment does not discard valid chat totals',async()=>{
 const now=Date.now(),started=now-60000;
 const task={id:'synthetic-contact',channelType:'chat',createdTime:started,endedTime:now-1000,status:'ended',isActive:false,
 isContactOffered:true,isContactHandled:true,queueCount:0,queueDuration:0,lastQueue:{id:'q',name:'test'},lastAgent:{id:'a',name:'test'}};
 const r=rig(async(e,u,o)=>JSON.parse(o.body).query.includes('activities(')?new Response('{}',{status:400}):data({taskDetails:{tasks:[task],pageInfo:{hasNextPage:false,endCursor:null}}}));
 const d=await r.api.daily(r.env,now);assert.equal(d.dailyStatus,'ready');assert.equal(d.rows.length,1);
 assert.equal(d.rows[0].connectedAt,null);assert.ok(d.warnings.some(w=>w.includes('unavailable')));
});
test('access remains fail closed before reporting builds',async()=>{
 const r=rig(async()=>{throw new Error('should not fetch');});r.api.deny();
 const response=await r.api.handler(new Request('https://example.test/api/webex/dashboard'),r.env,{});
 assert.equal(response.status,403);assert.equal(r.queries.length,0);
});
test('public reporting error is sanitized and has retry guidance',async()=>{
 const r=rig(async()=>data({}));r.api.failBuild();const response=await r.api.handler(new Request('https://example.test'),r.env,{});
 assert.equal(response.status,503);assert.equal(response.headers.get('Retry-After'),'5');assert.ok(!(await response.text()).includes('PRIVATE'));
});
test('query diagnostics omit query bodies, org and credentials',async()=>{
 const r=rig(async()=>data({taskDetails:{tasks:[]}}));await r.api.search(r.env,'{taskDetails(from:1 to:2){tasks{id}}}',Date.now()+1000);
 const logs=r.logs.join('');assert.ok(!logs.includes('test-org'));assert.ok(!logs.includes('tasks{id}'));assert.ok(logs.includes('elapsedMs'));
});
test('all frontend request timers exceed backend deadline and avoid forced duplicates',()=>{
 const web=fs.readFileSync(new URL('../../webex.js',import.meta.url),'utf8');
 const chat=fs.readFileSync(new URL('../../webex-integrated-chat.js',import.meta.url),'utf8');
 const voice=fs.readFileSync(new URL('../../webex-reports.js',import.meta.url),'utf8');
 assert.ok(web.includes('WEBEX_FETCH_TIMEOUT_MS = 45000'));assert.ok(chat.includes('controller.abort(),45000'));
 assert.ok(voice.includes('controller.abort(),45000'));assert.ok(voice.includes('if (requestInFlight) return requestInFlight;'));
 assert.ok(chat.includes('nextChatAttempt'));assert.ok(chat.includes('Math.min(60000'));
});
