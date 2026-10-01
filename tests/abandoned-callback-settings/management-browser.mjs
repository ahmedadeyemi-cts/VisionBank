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
const root=path.resolve('.'),out=path.resolve('../browser-callback-management');fs.mkdirSync(out,{recursive:true});
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
 simulator.client.get=async id=>structuredClone(simulator.client.records.find(r=>r.id===id)||null);
 simulator.client.puts=0;simulator.client.deletes=0;
 simulator.client.update=async(id,p)=>{simulator.client.puts++;const index=simulator.client.records.findIndex(r=>r.id===id);assert.ok(index>=0);simulator.client.records[index]={...p,id};return simulator.client.records[index];};
 simulator.client.cancel=async id=>{simulator.client.deletes++;const i=simulator.client.records.findIndex(r=>r.id===id);assert.ok(i>=0);simulator.client.records.splice(i,1);return {canceled:true,id};};
 simulator.client.history=async()=>[];
 await backend.request('settings',mutation({enabled:true,queueId:QUEUE,maxAttempts:3,callbackEntryPointId:approval().callbackEntryPointId}));
 await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});await page.waitForSelector('input[data-callback-select]');
 await page.locator('input[data-callback-select]').first().check();await page.locator('#vbCallbackScheduleSelected').click();await page.waitForFunction(()=>!document.getElementById('vbCallbackPreview').disabled);await page.locator('#vbCallbackPreview').click();await page.waitForFunction(()=>!document.getElementById('vbCallbackExecute').disabled);await page.locator('#vbCallbackExecute').click();
 await page.waitForFunction(()=>document.querySelector('[data-callback-status]')?.textContent.includes('Preparing callback'));await page.locator('#vbCallbackPlanClose').click();
 const service=()=>backend.namespace.get('test-org:settings:v1');await service().alarm();await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('[data-callback-status]')?.textContent==='Scheduled');await page.locator('#vbCallbackWorkspace').getByRole('button',{name:'Manage schedule'}).click();
 await page.waitForFunction(()=>!document.getElementById('vbCallbackManageSave').disabled);
 ok('confirmed future schedule exposes direct reschedule and cancel actions');
 ok('no mandatory acknowledgement checkbox is added',await page.locator('#vbCallbackManage input[type=checkbox]').count()===0);
 const originalId=simulator.client.records[0].id,originalDate=simulator.client.records[0].scheduleDate;
 await page.locator('#vbCallbackManageTime').fill('10:00');uncertain=true;await page.locator('#vbCallbackManageSave').click();
 await page.waitForTimeout(200);await service().alarm();await page.waitForFunction(()=>document.getElementById('vbCallbackManageStatus')?.textContent.includes('confirmed by Webex'));
 ok('reschedule updates same native schedule ID',simulator.client.records[0].id===originalId&&simulator.client.records[0].startTime==='10:00:00');
 ok('lost reschedule acceptance response does not cause duplicate PUT/POST',simulator.client.posts===1&&simulator.client.puts===1&&callbackRequests.filter(x=>x.path.endsWith('/manage')&&x.method==='POST').length===1);
 await page.locator('#vbCallbackManage').getByRole('button',{name:'Close',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-callback-window]')?.textContent.includes('10:00'));
 ok('revised time survives a full dashboard reload');
 // Master Off still permits cancellation of an already-confirmed future schedule.
 const state=(await backend.request('settings')).data.state;await backend.request('settings',mutation({...state.settings,enabled:false},state.version));
 await page.locator('#vbCallbackWorkspace').getByRole('button',{name:'Manage schedule'}).click();await page.waitForFunction(()=>!document.getElementById('vbCallbackManageCancel').disabled);
 ok('cancel remains available with master Off',await page.locator('#vbCallbackManageSave').isDisabled());
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:1000});const box=await page.locator('#vbCallbackManage').boundingBox();ok('management dialog fits '+width,box&&box.x>=0&&box.x+box.width<=width);}
 await page.locator('#vbCallbackManageCancel').click();await page.waitForTimeout(200);await service().alarm();await page.waitForFunction(()=>document.getElementById('vbCallbackManageStatus')?.textContent==='Canceled in Webex.');
 ok('cancellation confirms separately from local acceptance',simulator.client.deletes===1&&simulator.client.posts===1&&simulator.client.records.length===0);
 await page.locator('#vbCallbackManage').getByRole('button',{name:'Close',exact:true}).click();await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('[data-callback-status]')?.textContent==='Canceled in Webex');
 ok('canceled status is reflected in original abandoned-call row and register',(await page.locator('#vbCallbackRegister').innerText()).includes('Canceled in Webex'));
 ok('canceling callback does not erase original abandonment',await page.locator('input[data-callback-select]').count()>0);
 ok('automatic mode remains paused in pilot',(await backend.request('automation-status')).data.eligible===false);
 ok('no uncaught application errors',errors.length===0);
 const result={passed:true,checks:checks.length,names:checks,errors,nativeSchedulePosts:simulator.client.posts,nativeUpdates:simulator.client.puts,nativeCancellations:simulator.client.deletes,liveCalls:0,transport:'Real frontend/gateway/durable management workflow; all native requests mocked and external traffic intercepted'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(error){console.error('FAIL',error);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}finally{await browser.close();}
