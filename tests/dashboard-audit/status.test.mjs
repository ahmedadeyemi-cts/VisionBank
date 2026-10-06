import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {publicRecord,createNativeClient} from '../../callback-settings/native.mjs';
const read=n=>fs.readFileSync(new URL('../../'+n,import.meta.url),'utf8');
function daily(){const window={VB_SECURITY:{allowed:true}},document={readyState:'loading',getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};
 vm.runInNewContext(read('webex-reports.js'),{window,document,Intl,Date,Number,console});return window.VB_WEBEX_REPORTS_TEST;}
test('missing counts/rates are not fabricated zero values',()=>{const d=daily();for(const n of [undefined,null,'',NaN,Infinity,-1]){assert.equal(d.displayCount(n),'—');assert.equal(d.formatRate(n),'—');}assert.equal(d.displayCount(0),'0');});
test('daily denominators are explicitly received and zero denominator is undefined',()=>{const d=daily();assert.equal(d.rateFromCounts(4,10),'40.0%');assert.equal(d.rateFromCounts(0,10),'0.0%');assert.equal(d.rateFromCounts(0,0),'—');assert.equal(d.rateFromCounts(11,10),'—');});
test('missing durations differ from recorded zero duration',()=>{const d=daily();assert.equal(d.displayedDuration(null),'Not reported');assert.equal(d.displayedDuration('00:00:00'),'00:00:00');});
test('pre-cutover default preserves the contact-center dashboard with the reviewed security baseline',()=>{
 const s=read('index.html');assert.equal(createHash('sha256').update(s).digest('hex'),'07fc01d8921e33a22d29ce4ddf9029cdfe9fc1c6c739ea4c3785f49350f46303');
 assert.ok(s.includes('Contact Center Realtime Dashboard'));assert.equal((s.match(/src="dashboard\.js\?v=/g)||[]).length,1);
 for(const asset of ['portal-session.js','portal-auth-fetch.js','portal-security-precheck.js'])assert.ok(s.includes(asset));
 assert.ok(!s.includes('portal-page-auth.js'));
 assert.ok(s.includes('Content-Security-Policy'));
 assert.ok(!/http-equiv=["']refresh|location\.(?:replace|assign)\(/i.test(s));
});
test('restored default retains security approval and existing assets',()=>{
 const s=read('index.html'),precheck=read('portal-security-precheck.js');
 for(const value of ['access-denied-overlay','portal-security-precheck.js'])assert.ok(s.includes(value));
 for(const value of ['/security/check','security-approved','window.VB_SECURITY = data'])assert.ok(precheck.includes(value));
 for(const asset of ['dashboard.js','style.css','assets/VisionBank-Logo.png','portal-security-precheck.js'])assert.ok(fs.existsSync(new URL('../../'+asset,import.meta.url)));
 assert.ok(!s.includes('webex-abandoned-selection.js'));
});
test('Webex testing and callback workspace remain at the separate page',()=>{
 const s=read('webex.html');assert.ok(s.includes('Webex Dashboard'));assert.ok(s.includes('vbCallbackWorkspace'));assert.ok(s.includes('webex-abandoned-selection.js'));
});
test('current visible labels do not promote migration assumptions',()=>{assert.ok(!read('webex-integrated-chat.js').includes('Agents (legacy count)'));assert.ok(!read('webex-reports.js').includes('When agents begin taking calls'));assert.ok(!read('webex-agent.html').includes('Legacy Agents'));});
test('stale queue agent count is not shown as current',()=>assert.ok(read('webex-integrated-chat.js').includes("current&&Number.isSafeInteger(q.agents)&&q.agents>=0?q.agents:'Not reported'")));
test('new report modules are versioned and loaded exactly once',()=>{const s=read('webex.html');for(const n of ['webex-report-health.js','webex.js','webex-reports.js'])assert.equal((s.match(new RegExp('src="'+n.replaceAll('.','\\.')+'\\?v=', 'g'))||[]).length,1);});
test('diagnostic history stays bounded and excludes customer/credential fields',()=>{const values=new Map(),window={},sessionStorage={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)};
 vm.runInNewContext(read('webex-report-health.js'),{window,sessionStorage,JSON,Number,Object});for(let i=0;i<30;i++)window.VB_REPORT_DIAGNOSTICS.record({endpoint:'/api/webex/dashboard',state:i===28?'unavailable':'ready',startedAt:i,finishedAt:i+1,elapsedMs:1,httpStatus:200,failure:'timeout',customerName:'EXCLUDED',token:'EXCLUDED'});
 assert.equal(window.VB_REPORT_HEALTH_HISTORY.length,20);assert.equal(window.VB_REPORT_LAST_FAILURE.failure,'timeout');assert.ok(!JSON.stringify([...values.values()]).includes('EXCLUDED'));
 const next={};vm.runInNewContext(read('webex-report-health.js'),{window:next,sessionStorage,JSON,Number,Object});assert.equal(next.VB_REPORT_HEALTH_HISTORY.length,20);assert.equal(next.VB_REPORT_LAST_FAILURE.failure,'timeout');});
test('an externally edited or missing schedule cannot display confirmed Scheduled',()=>{const now=Date.now(),r={status:'scheduled',window:{startEpoch:now+3600000},payload:{callbackNumber:'+12025550123'}};for(const status of ['schedule-changed-externally','not-in-future-inventory'])assert.equal(publicRecord({...r,nativeObservation:{status}},now).status,'schedule-unconfirmed');});
test('stale active-call reports do not stay live indefinitely',()=>{const now=Date.now(),r={status:'connected',window:{startEpoch:now-3600000},payload:{callbackNumber:'+12025550123'},outcomeObservation:{checkedAt:now-120001}};assert.equal(publicRecord(r,now).status,'activity-stale');});
test('active callback duplicates include reported callbackData target',async()=>{const org='33333333-3333-4333-8333-333333333333',id='22222222-2222-4222-8222-222222222222';let query='';
 const c=createNativeClient({orgId:org,getToken:async()=>'synthetic',fetchImpl:async(url,o)=>{query=JSON.parse(o.body).query;return Response.json({data:{taskDetails:{tasks:[{id,isActive:true,isCallback:true,callbackData:{callbackNumber:'+12025550123'}}],pageInfo:{hasNextPage:false}}}});}});
 assert.equal((await c.active('+12025550123')).length,1);assert.ok(query.includes('callbackData{callbackNumber}'));});
test('active callbacks with no usable target cannot certify an empty duplicate result',async()=>{const c=createNativeClient({orgId:'33333333-3333-4333-8333-333333333333',getToken:async()=>'synthetic',fetchImpl:async()=>Response.json({data:{taskDetails:{tasks:[{id:'22222222-2222-4222-8222-222222222222',isCallback:true,isActive:true}],pageInfo:{hasNextPage:false}}}})});await assert.rejects(c.active('+12025550123'),e=>e.code==='active-callback-number-unavailable');});
