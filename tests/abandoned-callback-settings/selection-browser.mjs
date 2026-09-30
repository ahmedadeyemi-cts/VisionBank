import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluate,example,queue} from '../voice-statistics/fixtures.mjs';
import {fixture,mutation,QUEUE} from './fixtures.mjs';
const cid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
const start=Date.now();let stale=false;
let dataset=Array.from({length:32},(_,i)=>({contactId:cid(i+1),ani:'+1515555'+String(i+1).padStart(4,'0'),dnis:'+15155551000',
  startEpoch:start-60000-i*1000,endEpoch:start-1000,agentName:i<30?'Group A':'Group B',abandonmentStage:'In queue',startTimeCentral:'Test time'}));
dataset[30].ani='Anonymous';dataset[31].ani=dataset[0].ani;
function dailyReport(){return {success:true,generatedAtEpoch:Date.now()-(stale?200000:0),summary:{totalCallsReceived:212,answeredCalls:9,abandonedCalls:dataset.length},answeredCalls:[],abandonedCalls:dataset};}
const backend=fixture({report:dailyReport});let outage=false,uncertain=false;const callbackRequests=[];
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),out=path.resolve('../browser-callback-selection');fs.mkdirSync(out,{recursive:true});
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
const open=async p=>{await p.locator('#abandonedCallbackSettingsToggle').click();await p.waitForFunction(()=>!document.getElementById('abandonedCallbackFields').disabled);};
const save=async p=>{await p.locator('#abandonedCallbackSave').click();await p.waitForFunction(()=>!document.getElementById('abandonedCallbackSave').disabled);};
const plan=async all=>{await page.locator(all?'#vbCallbackScheduleAll':'#vbCallbackScheduleSelected').click();await page.waitForFunction(()=>!document.getElementById('vbCallbackPreview').disabled);};
const preview=async()=>{await page.locator('#vbCallbackPreview').click();await page.waitForFunction(()=>document.querySelector('#vbCallbackPlanRows tr')!==null);};
const closePlan=()=>page.locator('#vbCallbackPlanClose').click();
try{
  await backend.request('settings',mutation({enabled:true,queueId:QUEUE}));
  await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});
  await page.waitForSelector('input[data-callback-select]');
  ok('checkboxes added to the original abandoned report; 25 rows on first page',await page.locator('input[data-callback-select]').count()===25);
  ok('existing reporting and channel indicators remain',await page.locator('[data-voice-metric]').count()===16&&await page.locator('.vb-channel').count()===4);
  await page.locator('input[data-callback-select]').first().check();await plan(false);await preview();
  ok('single-call selection previews exactly that call',await page.locator('#vbCallbackPlanRows tr').count()===1&&(await page.locator('#vbCallbackPlanRows').innerText()).includes(cid(1)));
  ok('native execution is explicitly blocked during preparation',await page.locator('#vbCallbackExecute').isDisabled());
  await closePlan();await page.locator('#abandonedNextPage').click();
  await page.locator('[data-callback-select="'+cid(26)+'"]').check();
  ok('individual selections persist across report pages',(await page.locator('#vbCallbackScheduleSelected').innerText()).includes('(2)'));
  await page.locator('#abandonedPrevPage').click();ok('earlier checkbox remains selected',await page.locator('[data-callback-select="'+cid(1)+'"]').isChecked());
  await page.locator('#vbCallbackSelectMatching').click();
  ok('select-all includes all usable numbers across pages',(await page.locator('#vbCallbackScheduleSelected').innerText()).includes('(31)'));
  await plan(false);await preview();
  ok('batch preview groups duplicate customer numbers',await page.locator('#vbCallbackPlanRows tr').count()===31&&(await page.locator('#vbCallbackPlanStatus').innerText()).includes('30 candidates · 1 skipped'));
  await closePlan();await page.locator('#abandonedCallsSearch').fill('Group A');
  ok('filter change clears potentially hidden selections',(await page.locator('#vbCallbackScheduleSelected').innerText()).includes('(0)'));
  ok('bulk button states matching scope when search is active',(await page.locator('#vbCallbackScheduleAll').innerText()).includes('all matching (30)'));
  await plan(true);await preview();ok('bulk preview respects the full filtered result across pages',await page.locator('#vbCallbackPlanRows tr').count()===30);await closePlan();
  await page.locator('#vbCallbackSelectMatching').click();
  dataset.unshift({...dataset[0],contactId:cid(40),ani:'+15155550040',startEpoch:start-30000});
  await page.locator('#refreshDailyReports').click();await page.waitForTimeout(300);
  ok('new arriving abandoned calls are not silently selected',(await page.locator('#vbCallbackScheduleSelected').innerText()).includes('(30)'));
  dataset=dataset.filter(r=>r.contactId!==cid(1));await page.locator('#refreshDailyReports').click();await page.waitForTimeout(300);
  ok('disappearing source records remove stale selection',(await page.locator('#vbCallbackScheduleSelected').innerText()).includes('(29)'));
  await plan(false);await preview();
  for(const width of [1440,1024,768]){
    await page.setViewportSize({width,height:1000});
    ok('preparation dialog fits '+width,await page.locator('#vbCallbackPlan').evaluate(e=>{const b=e.getBoundingClientRect();return b.left>=0&&b.right<=innerWidth+1;}));
  }
  for(const dark of [false,true]){
    await page.evaluate(d=>document.body.classList.toggle('dark-mode',d),dark);
    ok('preview readable in '+(dark?'dark':'light')+' theme',await page.locator('#vbCallbackPlanRows').isVisible());
  }
  await page.setViewportSize({width:1440,height:1100});
  await page.locator('#vbCallbackPlan').screenshot({path:path.join(out,'selection-preview.png')});
  await closePlan();
  const audit=await backend.request('history');ok('previews do not create settings-audit mutations',audit.data.rows.length===1);
  ok('no calling or schedule endpoint was requested',callbackRequests.every(x=>x.method==='GET'||x.method==='OPTIONS'||x.path.endsWith('/settings')||x.path.endsWith('/preview')));
  stale=true;await page.locator('#refreshDailyReports').click();await page.waitForTimeout(300);
  ok('expired report disables selection and bulk actions',await page.locator('#vbCallbackScheduleAll').isDisabled()&&await page.locator('#vbCallbackScheduleSelected').isDisabled());
  stale=false;await page.locator('#refreshDailyReports').click();await page.waitForTimeout(300);
  ok('successful refresh recovers without page reload',!await page.locator('#vbCallbackScheduleAll').isDisabled());
  await page.evaluate(()=>{window.VB_SECURITY={allowed:false};window.VB_ABANDONED_SELECTION.render();});
  ok('access revocation disables all callback selection',await page.locator('#vbCallbackScheduleAll').isDisabled()&&await page.locator('input[data-callback-select]').first().isDisabled());
  ok('no first-party browser errors',errors.length===0);
  const result={passed:true,checks:checks.length,names:checks,errors,transport:'Real dashboard scripts with isolated synthetic reporting and settings; preview only, zero native calls'};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(error){console.error('FAIL',error);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}finally{await browser.close();}
