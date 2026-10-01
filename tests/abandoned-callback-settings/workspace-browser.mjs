import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluate,example,queue} from '../voice-statistics/fixtures.mjs';
import {fixture,mutation,QUEUE} from './fixtures.mjs';
import {nativeFixture,approval} from './native-fixtures.mjs';
const cid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const start=Date.now();let stale=false;
let dataset=Array.from({length:32},(_,i)=>({contactId:cid(i+1),ani:'+1515555'+String(i+1).padStart(4,'0'),dnis:'+15155551000',
  startEpoch:start-60000-i*1000,endEpoch:start-1000,agentName:i<30?'Group A':'Group B',abandonmentStage:'In queue',startTimeCentral:'Test time'}));
dataset[30].ani='Anonymous';dataset[31].ani=dataset[0].ani;
function dailyReport(){return {success:true,generatedAtEpoch:Date.now()-(stale?200000:0),summary:{totalCallsReceived:212,answeredCalls:9,abandonedCalls:dataset.length},answeredCalls:[],abandonedCalls:dataset};}
const simulator=await nativeFixture();const runtimeEnv={CALLBACK_EXECUTION_CONFIG:JSON.stringify(approval({testNumbers:[dataset[0].ani]}))};
const backend=fixture({report:dailyReport,runtimeEnv,nativeClient:simulator.client});let outage=false,uncertain=false;const callbackRequests=[];
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),out=path.resolve('../browser-callback-workspace');fs.mkdirSync(out,{recursive:true});
const origin='https://visionbank-dashboard.onrender.com',worker='https://visionbank-security.ahmedadeyemi.workers.dev';
let mode='ready',dayRows='normal',requests=[],errors=[],checks=[];
function dashboard(){const now=Date.now(),at=mode==='stale'?now-46000:now,qs=[{...queue({active:2,offered:1,wrapup:1}),calls:0,agents:1,maxWait:'00:00:00',avgWait:'00:00:00',maxWaitMs:0}];
 const rows=dayRows==='empty'?[]:example(now);if(mode==='partial')rows[0].queueDuration=null;
 const ch=(n)=>({source:'agentSession.channelInfo',reason:'',observedAt:at,reportedSlotCount:n,activeSlots:0,wrapupSlots:0,offeredSlots:0,availableSlots:n,routingState:'available'});
 const statistics={totalCallsReceived:212,totalCallsQueued:11,totalCallsAnswered:9,totalCallsAbandoned:2,entryPoints:[{name:'Alianza',calls:200},{name:'CEG Voice',calls:12}],voicePerformance:evaluate(rows,qs,now,now-3600000)};
 statistics.voicePerformance.observedAt=at;if(mode==='old-worker')delete statistics.voicePerformance;
 return {success:true,timezone:'America/Chicago',generatedAtEpoch:at,generatedAtCentral:'Synthetic test snapshot',reportingDayStartEpoch:now-3600000,settings:{},queueOptions:[],queues:qs,statistics,agents:[{agentId:'test-agent',name:'Example Agent',team:'CEG Agents',number:'3223',status:'Available',duration:'00:10:00',sessionStart:now-600000,voiceChannel:ch(1),chatChannel:ch(5),agentStatus:{state:'Available',tone:'available',observedAt:at},stateIndicator:{revision:4,category:'available',label:'Available',idleVerified:false,observedAt:at,stateStartedAt:at-60000}}]};}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),context=await browser.newContext({viewport:{width:1440,height:1150}}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/webex/abandoned-callback/')) {
 callbackRequests.push({path:u.pathname,method:req.method()});
 if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type'}});
 if(outage)return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify({success:false,error:'injected-outage'})});
 const x=await backend.request(u.pathname.split('/abandoned-callback/')[1]+u.search,req.method()==='POST'?req.postDataJSON():undefined);
 if(uncertain&&req.method()==='POST'){uncertain=false;return route.abort('failed');}
 return route.fulfill({status:x.http,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(x.data)});
 }
 if(!['GET','OPTIONS'].includes(req.method())){errors.push('Unexpected write '+req.method());return route.abort();}
 if(u.origin===origin){const p=path.resolve(root,u.pathname.replace(/^\//,'')||'webex.html');if(!p.startsWith(root+'/')||!fs.existsSync(p))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(p)]||'text/plain',body:fs.readFileSync(p)});}
 if(u.origin!==worker)return route.abort();requests.push(u.pathname);let body={success:true};
 if(u.pathname==='/security/check')body={allowed:true,reason:'synthetic-test'};
 else if(u.pathname==='/api/webex/dashboard')body=dashboard();
 else if(u.pathname==='/api/webex/chat-reports'){const at=Date.now();body={success:true,schemaVersion:2,build:'2026.09.24-chat-integrated-2',channel:'chat',timezone:'America/Chicago',dailyStatus:'ready',liveStatus:'ready',completedStatus:'ready',dailyObservedAt:at,liveObservedAt:at,completedObservedAt:at,rows:[],completedRows:[],liveRows:[],queueSnapshot:{},summary:Object.fromEntries(['offered','handled','abandoned','active','wrapup','waiting','offeredNow','completedToday'].map(k=>[k,{status:'ready',value:0}])),callbacks:{status:'ready',observedAt:at,rows:[],coverage:'Test callback history'}};}
 else if(u.pathname==='/api/webex/daily-reports')body=dailyReport();
 else if(u.pathname==='/api/webex/dashboard/settings')body={success:true,settings:{}};
 else if(u.pathname==='/motd')body={message:''};
 return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(body)});
});
const ok=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
try{
 await backend.request('settings?schema=4',mutation({enabled:false,queueId:QUEUE,maxAttempts:3,callbackEntryPointId:approval().callbackEntryPointId}));
 await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[data-callback-select]');
 await page.waitForFunction(()=>document.querySelector('#vbCallbackWorkspaceStatus')?.textContent.includes('across all dates'));
 ok('callback workspace loads independently of scheduling activation');
 await page.locator('input[data-callback-select]').first().check();await page.locator('#vbCallbackScheduleSelected').click();
 await page.waitForFunction(()=>!document.getElementById('vbCallbackSavePlan').disabled);
 await page.locator('.vb-cb-readiness summary').click();
 ok('readiness is a labeled checklist rather than one dense error paragraph',await page.locator('.vb-cb-readiness-item').count()>=8);
 ok('disabled execution does not prevent saving a plan',await page.locator('#vbCallbackExecute').isDisabled()&&!await page.locator('#vbCallbackSavePlan').isDisabled());
 uncertain=true;await page.locator('#vbCallbackSavePlan').click();await page.waitForFunction(()=>document.getElementById('vbCallbackDraftStatus').textContent.startsWith('Saved plan'));
 ok('lost draft response is reconciled by mutation ID',callbackRequests.filter(r=>r.method==='POST'&&r.path.endsWith('/plans')).length===1);
 ok('saved draft never schedules or dials',simulator.client.posts===0&&callbackRequests.filter(r=>r.path.endsWith('/schedule')||r.path.endsWith('/plan-schedule')).length===0);
 const planId=[...backend.stores.values()][0].data.keys().toArray().find(k=>k.startsWith('plan:')).slice(5);
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:1000});const b=await page.locator('#vbCallbackPlan').boundingBox();ok('expanded readiness dialog fits '+width,b.x>=0&&b.x+b.width<=width+1);}
 await page.setViewportSize({width:1440,height:1150});await page.locator('#vbCallbackPlan').screenshot({path:path.join(out,'saved-plan-readiness.png')});
 await page.locator('#vbCallbackPlanClose').click();await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-plan-id]');
 ok('saved plans survive a browser reload',await page.locator('[data-plan-id]').count()===1);
 dataset=[];await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-plan-id]');
 await page.locator('[data-plan-id] button').filter({hasText:'Open plan'}).click();await page.waitForFunction(()=>!document.getElementById('vbCallbackPreview').disabled);
 await page.locator('#vbCallbackPreview').click();await page.waitForSelector('#vbCallbackPlanRows tr');
 ok('a saved plan previews even when its original is absent from today',await page.locator('#vbCallbackPlanRows tr').count()===1);
 const beforeRows=[...backend.stores.values()][0].data.get('plan:'+planId).revision;
 await page.locator('#vbCallbackSavePlan').click();await page.waitForFunction(()=>document.getElementById('vbCallbackDraftStatus').textContent.includes('revision 2'));
 ok('editing a saved plan updates the same plan instead of duplicating',beforeRows===1&&[...[...backend.stores.values()][0].data.keys()].filter(k=>k.startsWith('plan:')).length===1);
 await backend.request('settings?schema=4',mutation({enabled:true,queueId:QUEUE,maxAttempts:3,callbackEntryPointId:approval().callbackEntryPointId},1));
 await page.locator('#vbCallbackRecheck').click();await page.waitForFunction(()=>document.querySelector('#vbCallbackPlanStatus').textContent.includes('Ready to submit'));
 await page.locator('#vbCallbackPreview').click();await page.waitForFunction(()=>!document.getElementById('vbCallbackExecute').disabled);
 ok('a fresh approved preview enables the final scheduling action');
 uncertain=true;await page.locator('#vbCallbackExecute').click();await page.waitForFunction(()=>document.querySelector('#vbCallbackPlanStatus').textContent.includes('confirmed scheduled'));
 ok('saved-plan submission recovers an uncertain response without duplicate creation',callbackRequests.filter(r=>r.method==='POST'&&r.path.endsWith('/plan-schedule')).length===1);
 await page.locator('#vbCallbackPlanClose').click();const jobsBefore=callbackRequests.filter(r=>r.path.endsWith('/jobs')).length;
 await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('[data-callback-record]');await page.waitForTimeout(100);
 ok('pending jobs are checked automatically after a full reload',callbackRequests.filter(r=>r.path.endsWith('/jobs')).length>jobsBefore);
 await backend.namespace.get('test-org:settings:v1').alarm();await page.locator('#vbCallbackRefreshWorkspace').click();
 await page.waitForFunction(()=>document.querySelector('#vbCallbackRegister').textContent.includes('Scheduled in Webex'));
 ok('Webex schedule ID and status remain visible without today’s abandoned row',(await page.locator('#vbCallbackRegister').textContent()).includes('Webex ID:')&&simulator.client.posts===1);
 ok('reported attempts remain unknown instead of using the requested maximum as an actual count',(await page.locator('#vbCallbackRegister').textContent()).includes('Not reported / 3 requested'));
 await page.locator('#vbCallbackWorkspace').screenshot({path:path.join(out,'callback-register.png')});
 await page.evaluate(()=>{window.VB_SECURITY.allowed=false;document.body.classList.remove('security-approved');});await page.waitForTimeout(50);
 ok('access revocation removes saved-plan and callback data',await page.locator('[data-plan-id]').count()===0&&await page.locator('[data-callback-record]').count()===0);
 ok('no first-party browser errors',errors.length===0);
 const result={passed:true,checks:checks.length,names:checks,errors,nativeSchedulePosts:simulator.client.posts,liveCalls:0,transport:'Actual dashboard/gateway/durable service with isolated synthetic Webex; no external requests'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(error){console.error('FAIL',error);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}finally{await browser.close();}
