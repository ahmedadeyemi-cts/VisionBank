import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {build} from '../../scripts/build-dashboard-lifecycle-r8.mjs';
const {parse}=await import(process.env.ACORN_MODULE||'acorn');
const patch=fs.readFileSync(new URL('../../worker-patches/dashboard-request-lifecycle-r8.js',import.meta.url),'utf8');
const original=fs.readFileSync(new URL('../../worker-patches/reporting-resilience-r5.js',import.meta.url),'utf8');
const tree=parse(original,{ecmaVersion:'latest',sourceType:'module'});
const fn=name=>{const n=tree.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return original.slice(n.start,n.end);};
const data=n=>({success:true,generatedAtEpoch:Date.now(),queues:[],agents:[],statistics:{sample:n},reportingDiagnostics:{preserved:true}});
function setup(load=async()=>data(1),{denied=false,short=false}={}){
 let calls=0;const logs=[];
 const c=vm.createContext({Map,Set,Date,JSON,Promise,Number,String,Response,Request,clearTimeout,
  setTimeout:short?(fn,ms)=>setTimeout(fn,Math.min(ms,20)):setTimeout,
  console:{log:s=>logs.push(JSON.parse(s))},getCentralDayStartEpochMs:()=>0,
  vbRepError:(code,http=503,retryAfter=5)=>Object.assign(new Error(code),{code,http,retryAfter}),
  vbRepBuildUncached:async env=>{calls++;return load(env);},
  json:(x,h={},status=200)=>new Response(JSON.stringify(x),{status,headers:{...h,'Content-Type':'application/json'}})});
 vm.runInContext(fn('vbRepBound')+'; let buildWebexDashboardData;'+
  `let handleWebexDashboard=async function(r,e,h){if(${denied})return json({success:false,error:'access-denied'},h,403);try{return json(await buildWebexDashboardData(e),h);}catch{return json({success:false,error:'reporting-temporarily-unavailable'},h,503);}};`+
  patch+';globalThis.api={vbDashR8Build,vbDashR8Cache,handleWebexDashboard};',c);
 return {api:c.api,logs,count:()=>calls,env:{WEBEX_ORG_ID:'org'},call:()=>c.api.vbDashR8Build({WEBEX_ORG_ID:'org'})};
}
test('reproduces old unbounded wait on an orphaned cached promise',async()=>{
 const c=vm.createContext({Date,Map,Promise,String,getCentralDayStartEpochMs:()=>0,vbRepCache:new Map(),vbRepBound:()=>{throw Error('not reached');}});
 vm.runInContext(fn('vbRepCached')+`;vbRepCache.set('org:dashboard:0',{day:0,data:null,expires:0,promise:new Promise(()=>{})});globalThis.pending=vbRepCached({WEBEX_ORG_ID:'org'},'dashboard',5000,()=>{throw Error('unexpected build');});`,c);
 assert.equal(await Promise.race([c.pending,new Promise(r=>setTimeout(()=>r('still-pending'),40))]),'still-pending');
});
test('completed JSON is cached with original snapshot and metrics',async()=>{const f=setup();const a=await f.call(),b=await f.call();assert.equal(f.count(),1);assert.equal(a.generatedAtEpoch,b.generatedAtEpoch);assert.equal(b.statistics.sample,1);assert.equal(b.reportingDiagnostics.cacheResult,'hit');});
test('concurrent callers share completed data, not request promises',async()=>{const f=setup(async()=>{await new Promise(r=>setTimeout(r,30));return data(7);});const results=await Promise.all([f.call(),f.call(),f.call()]);assert.equal(f.count(),1);assert.ok(results.every(r=>r.statistics.sample===7));const entry=f.api.vbDashR8Cache.values().next().value;assert.equal(entry.lease,null);assert.ok(!('promise' in entry));});
test('caller behind a lost owner gets a bounded error, not an indefinite wait',async()=>{const f=setup();f.api.vbDashR8Cache.set('org:dashboard:0',{data:null,expires:0,lease:{token:44,startedAt:Date.now(),until:Date.now()+39000}});const start=Date.now();await assert.rejects(f.call(),e=>e.code==='dashboard-refresh-pending');assert.ok(Date.now()-start<3700);assert.equal(f.count(),0);});
test('expired canceled-owner lease is replaced and report recovers',async()=>{const f=setup();f.api.vbDashR8Cache.set('org:dashboard:0',{data:null,expires:0,lease:{token:44,startedAt:Date.now()-40000,until:Date.now()-1}});assert.equal((await f.call()).statistics.sample,1);assert.equal(f.count(),1);assert.ok(f.logs.some(l=>l.phase==='expired-owner-released'));});
test('old owner cannot overwrite a newer completed report',async()=>{let release,n=0;const f=setup(async()=>++n===1?new Promise(r=>release=r):data(2));const first=f.call();await new Promise(r=>setTimeout(r,5));f.api.vbDashR8Cache.get('org:dashboard:0').lease.until=Date.now()-1;await f.call();release(data(1));assert.equal((await first).statistics.sample,2);assert.equal((await f.call()).statistics.sample,2);});
test('failed build releases its own lease and next call recovers',async()=>{let n=0;const f=setup(async()=>{if(++n===1)throw Error('test failure');return data(2);});await assert.rejects(f.call());assert.equal(f.api.vbDashR8Cache.get('org:dashboard:0').lease,null);assert.equal((await f.call()).statistics.sample,2);});
test('hung owner has an independent build deadline',async()=>{const f=setup(()=>new Promise(()=>{}),{short:true});await assert.rejects(f.call(),e=>e.code==='dashboard-build-deadline');assert.equal(f.api.vbDashR8Cache.get('org:dashboard:0').lease,null);});
test('missing data fails rather than publishing an empty success',async()=>{const f=setup(async()=>({success:true,queues:[],statistics:{}}));await assert.rejects(f.call(),e=>e.code==='dashboard-invalid-data');assert.equal(f.api.vbDashR8Cache.get('org:dashboard:0').data,null);});
test('each organization has separate cached data',async()=>{const f=setup(async env=>data(env.WEBEX_ORG_ID));assert.equal((await f.call()).statistics.sample,'org');assert.equal((await f.api.vbDashR8Build({WEBEX_ORG_ID:'other'})).statistics.sample,'other');assert.equal(f.count(),2);});
test('authorization denial cannot invoke reporting or cached data',async()=>{const f=setup(undefined,{denied:true});const r=await f.api.handleWebexDashboard(new Request('https://test.example/api/webex/dashboard'),f.env,{});assert.equal(r.status,403);assert.equal(f.count(),0);});
test('expired completed cache does not remain live forever',async()=>{let n=0;const f=setup(async()=>data(++n));await f.call();f.api.vbDashR8Cache.get('org:dashboard:0').expires=Date.now()-1;assert.equal((await f.call()).statistics.sample,2);});
test('revision adds no routes, fetch calls, secrets or agent actions',()=>{for(const text of ['fetch(','stateChange','blindTransfer','endV2','env.WEBEX_REFRESH_TOKEN','env.WEBEX_ACCESS_TOKEN','scheduled(','localStorage'])assert.ok(!patch.includes(text),text);assert.ok(patch.includes("cacheMode:'completed-data-only'"));assert.ok(!patch.includes('vbRepCached='));});
test('wrong Worker baseline is rejected',()=>assert.throws(()=>build('export default {}',patch)));
test('exact live source retained; all checked routes preserved',{skip:!process.env.VB_PRIVATE_R8_BASELINE},()=>{const original=fs.readFileSync(process.env.VB_PRIVATE_R8_BASELINE,'utf8');const r=build(original,patch);assert.ok(r.candidate.startsWith(original));assert.ok(Object.values(r.proof.routes).every(n=>n===1));});
