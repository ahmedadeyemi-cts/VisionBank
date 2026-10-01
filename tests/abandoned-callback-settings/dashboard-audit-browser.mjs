import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluate,example,queue} from '../voice-statistics/fixtures.mjs';
import {fixture,mutation,QUEUE} from './fixtures.mjs';
const EP='22222222-2222-4222-8222-222222222222';let epName='Pilot_Callback_EP',epOutage=false;
const backend=fixture({nativeClient:{entryPoints:async()=>{if(epOutage)throw Error('injected discovery failure');return [{id:EP,name:epName,callbackEnabled:true}];}}});let outage=false,uncertain=false;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),out=path.resolve('../browser-dashboard-audit');fs.mkdirSync(out,{recursive:true});
const origin='https://visionbank-dashboard.onrender.com',worker='https://visionbank-security.ahmedadeyemi.workers.dev';
let dailyMode='normal';let mode='ready',dayRows='normal',requests=[],errors=[],checks=[];
function dashboard(){const now=Date.now(),at=mode==='stale'?now-46000:now,qs=[{...queue({active:2,offered:1,wrapup:1}),calls:0,agents:1,maxWait:'00:00:00',avgWait:'00:00:00',maxWaitMs:0}];
 const rows=dayRows==='empty'?[]:example(now);if(mode==='partial')rows[0].queueDuration=null;
 const ch=(n)=>({source:'agentSession.channelInfo',reason:'',observedAt:at,reportedSlotCount:n,activeSlots:0,wrapupSlots:0,offeredSlots:0,availableSlots:n,routingState:'available'});
 const statistics={totalCallsReceived:212,totalCallsQueued:11,totalCallsAnswered:9,totalCallsAbandoned:2,entryPoints:[{name:'Alianza',calls:200},{name:'CEG Voice',calls:12}],voicePerformance:evaluate(rows,qs,now,now-3600000)};
 statistics.voicePerformance.observedAt=at;if(mode==='old-worker')delete statistics.voicePerformance;
 return {success:true,timezone:'America/Chicago',generatedAtEpoch:at,generatedAtCentral:'Synthetic test snapshot',reportingDayStartEpoch:now-3600000,settings:{},queueOptions:[],queues:qs,statistics,agents:[{agentId:'test-agent',name:'Example Agent',team:'CEG Agents',number:'3223',status:'Available',duration:'00:10:00',sessionStart:now-600000,voiceChannel:ch(1),chatChannel:ch(5),agentStatus:{state:'Available',tone:'available',observedAt:at},stateIndicator:{revision:4,category:'available',label:'Available',idleVerified:false,observedAt:at,stateStartedAt:at-60000}}]};}
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'}),context=await browser.newContext({viewport:{width:1440,height:1150}}),page=await context.newPage();
page.on('pageerror',e=>errors.push(e.message));
await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(u.pathname.startsWith('/api/webex/abandoned-callback/')) {
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
 else if(u.pathname==='/api/webex/daily-reports'){
 if(dailyMode==='outage')return route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify({success:false,error:'test-outage'})});
 const row={contactId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',ani:'+12025550123',startEpoch:Date.now()-30000,endEpoch:Date.now()-20000,startTimeCentral:'Synthetic start',totalCallDuration:'00:00:00'};
 body={success:true,generatedAtEpoch:Date.now()-(dailyMode==='stale'?160000:0),operatingMode:'flow-blind-transfer-transition',operatingModeMessage:'obsolete migration notice',summary:{totalCallsReceived:10,answeredCalls:4,abandonedCalls:2,transferredOutCalls:3,agentAnswerRateApplicable:false},answeredCalls:[row],abandonedCalls:[{...row,contactId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}]};
 if(dailyMode==='incomplete')delete body.answeredCalls;
 }

 else if(u.pathname==='/api/webex/dashboard/settings')body={success:true,settings:{}};
 else if(u.pathname==='/motd')body={message:''};
 return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(body)});
});
const ok=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const refreshDaily=async()=>{await page.locator('#refreshDailyReports').click();await page.waitForTimeout(400);};
try{
 await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.getElementById('dailyAnswered')?.textContent==='4');
 ok('daily answer rate uses received denominator despite obsolete source migration flag',await page.locator('#dailyAnswerRate').innerText()==='40.0%');
 ok('daily abandonment rate has an explicit denominator',await page.locator('#dailyAbandonRate').innerText()==='20.0%'&&(await page.locator('#dailyAbandonRate').evaluate(e=>e.parentElement.textContent)).includes('Abandoned / received'));
 ok('migration assumptions removed from daily metadata',!(await page.locator('#answeredCallsPanel').innerText()).includes('transition mode')&&!(await page.locator('#answeredCallsPanel').innerText()).includes('When agents begin'));
 ok('missing talk duration is not displayed as zero',(await page.locator('#answeredCallsBody').innerText()).includes('Not reported'));
 ok('recorded zero duration remains visible',(await page.locator('#answeredCallsBody').innerText()).includes('00:00:00'));
 await page.locator('#answeredCallsSearch').fill('not-a-match');ok('no matching filter does not claim there were no calls',(await page.locator('#answeredCallsBody').innerText()).includes('No calls match'));
 await page.locator('#answeredCallsSearch').fill('');
 ok('legacy queue label removed',!(await page.locator('#queue-panel').innerText()).includes('legacy'));
 ok('callback workspace remains separate from provider call history',await page.locator('#vbCallbackWorkspace').count()===1&&await page.locator('#vbCallbacks h2').innerText()==='Webex Callback Call History');
 ok('obsolete callback-inventory warning is removed',!(await page.locator('#vbCallbacks').innerText()).includes('inventory is not connected'));
 for(const width of [1440,1024,768]){await page.setViewportSize({width,height:1100});await page.waitForTimeout(50);
  ok('header actions are visible and nonoverlapping '+width,await page.locator('.header-right').evaluate(e=>{const rs=[...e.querySelectorAll('button')].map(b=>b.getBoundingClientRect()).filter(r=>r.width&&r.height);return rs.every(r=>r.left>=0&&r.right<=innerWidth+1)&&rs.every((a,i)=>rs.every((b,j)=>i===j||a.right<=b.left||b.right<=a.left||a.bottom<=b.top||b.bottom<=a.top));}));}
 await page.setViewportSize({width:1440,height:1150});
 dailyMode='incomplete';await refreshDaily();ok('missing report arrays cause unavailable, not empty success',(await page.locator('#answeredCallsBody').innerText()).includes('incomplete')||await page.locator('#dailyAnswered').innerText()==='—');
 ok('failed report removes current-looking totals and disables export',await page.locator('#dailyAnswered').innerText()==='—'&&await page.locator('#exportAnsweredCalls').isDisabled());
 await page.locator('#answeredCallsSearch').fill('test');ok('search cannot redisplay stale rows during a report failure',!(await page.locator('#answeredCallsBody').innerText()).includes('+12025550123'));
 dailyMode='normal';await page.locator('#answeredCallsSearch').fill('');await refreshDaily();await page.waitForFunction(()=>document.getElementById('dailyAnswered').textContent==='4');ok('successful refresh recovers without reloading',!await page.locator('#exportAnsweredCalls').isDisabled());
 dailyMode='stale';await refreshDaily();ok('expired snapshot is unknown rather than current',await page.locator('#dailyAnswered').innerText()==='—'&&await page.locator('#exportAnsweredCalls').isDisabled());
 dailyMode='normal';mode='stale';await page.reload({waitUntil:'domcontentloaded'});await page.waitForSelector('#vb-queue-note');
 ok('stale snapshot does not show a current agent count',await page.locator('#queue-body tr:first-child td:nth-child(7)').innerText()==='Not reported');
 mode='ready';await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.getElementById('dailyAnswered')?.textContent==='4');
 await page.evaluate(()=>{window.VB_SECURITY.allowed=false;document.body.classList.remove('security-approved');});await page.waitForTimeout(1100);
 ok('access revocation removes daily rows and summary',!(await page.locator('#answeredCallsBody').innerText()).includes('+12025550123')&&await page.locator('#dailyAnswered').innerText()==='—');
 await page.goto(origin+'/index.html',{waitUntil:'domcontentloaded'});await page.waitForURL('**/webex.html');ok('old dashboard bookmark opens the current Webex dashboard',page.url().endsWith('/webex.html'));
 await page.waitForFunction(()=>document.getElementById('dailyAnswered')?.textContent==='4');
 ok('diagnostic history is available after refresh',await page.evaluate(()=>Array.isArray(window.VB_REPORT_HEALTH_HISTORY)&&window.VB_REPORT_HEALTH_HISTORY.length>0));
 await page.screenshot({path:path.join(out,'dashboard-audit.png'),fullPage:true});
 ok('no uncaught first-party browser errors',errors.length===0);
 const result={passed:true,checks:checks.length,names:checks,errors,liveCalls:0,transport:'Actual published-source dashboard with isolated synthetic APIs; no external requests or native writes'};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(e){console.error('FAIL',e);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});process.exitCode=1;}finally{await browser.close();}
