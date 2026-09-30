import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluate,example,queue} from '../voice-statistics/fixtures.mjs';
import {fixture,mutation,QUEUE} from './fixtures.mjs';
const EP='22222222-2222-4222-8222-222222222222';let epName='Pilot_Callback_EP',epOutage=false;
const backend=fixture({nativeClient:{entryPoints:async()=>{if(epOutage)throw Error('injected discovery failure');return [{id:EP,name:epName,callbackEnabled:true}];}}});let outage=false,uncertain=false;
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),out=path.resolve('../browser-callback-settings');fs.mkdirSync(out,{recursive:true});
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
 else if(u.pathname==='/api/webex/daily-reports')body={success:true,generatedAtEpoch:Date.now(),summary:{totalCallsReceived:212,answeredCalls:9,abandonedCalls:2},answeredCalls:[],abandonedCalls:[]};
 else if(u.pathname==='/api/webex/dashboard/settings')body={success:true,settings:{}};
 else if(u.pathname==='/motd')body={message:''};
 return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(body)});
});
const ok=(name,value=true)=>{assert.ok(value,name);checks.push(name);console.log('PASS',name);};
const open=async p=>{await p.locator('#abandonedCallbackSettingsToggle').click();await p.waitForFunction(()=>!document.getElementById('abandonedCallbackFields').disabled);};
const save=async p=>{await p.locator('#abandonedCallbackSave').click();await p.waitForFunction(()=>!document.getElementById('abandonedCallbackSave').disabled);};
try{
  await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#vbVoiceStatistics')?.dataset.status==='ready');
  ok('existing Voice metrics and both Agent tables still load',await page.locator('[data-voice-metric]').count()===16&&await page.locator('#agent-body tr[data-vb-agent-id]').count()===1);
  ok('settings panel starts closed',!await page.locator('#abandonedCallbackSettingsPanel').isVisible());
  await open(page);ok('first load defaults Off, with no login form',!await page.locator('#abandonedCallbackEnabled').isChecked()&&await page.locator('#abandonedCallbackSettingsPanel input[type=password]').count()===0);
  ok('new maximum defaults to 3 total attempts',await page.locator('#abandonedCallbackMaxAttempts').inputValue()==='3');
  ok('entry point list is loaded by ID from Webex',await page.locator('#abandonedCallbackEntryPoint option[value="'+EP+'"]').count()===1);
  await page.locator('#abandonedCallbackEntryPoint').selectOption(EP);
  await page.locator('#abandonedCallbackMaxAttempts').fill('2');
  await page.locator('#abandonedCallbackQueue').selectOption(QUEUE);await page.locator('#abandonedCallbackEnabled').check();await save(page);
  ok('one Save records enable and audit',/Saved\./.test(await page.locator('#abandonedCallbackLoadStatus').innerText()));
  ok('enabled does not pretend the callback engine is connected',(await page.locator('#abandonedCallbackProcessing').innerText()).includes('Enabled — processing paused'));
  ok('last changed shows server source IP and no guessed computer name',(await page.locator('#abandonedCallbackLastChange').innerText()).includes('198.51.100.12')&&(await page.locator('#abandonedCallbackLastChange').innerText()).includes('Not reported'));
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.VB_SECURITY?.allowed);await open(page);
  ok('enabled survives complete browser refresh',await page.locator('#abandonedCallbackEnabled').isChecked());
  ok('custom attempt limit survives reload',await page.locator('#abandonedCallbackMaxAttempts').inputValue()==='2');
  ok('saved entry-point ID survives browser reload',await page.locator('#abandonedCallbackEntryPoint').inputValue()===EP);
  epName='Renamed_Callback_EP';await page.locator('#abandonedCallbackClose').click();await open(page);
  await page.waitForFunction(()=>document.querySelector('#abandonedCallbackEntryPoint option:checked')?.textContent.includes('Renamed_Callback_EP'));
  ok('Webex rename appears without changing selected ID',await page.locator('#abandonedCallbackEntryPoint').inputValue()===EP);
  epOutage=true;await page.locator('#abandonedCallbackClose').click();await open(page);
  await page.waitForFunction(()=>document.getElementById('abandonedCallbackEntryPointStatus').textContent.includes('discovery is unavailable'));
  ok('discovery outage keeps the saved ID instead of resetting it',await page.locator('#abandonedCallbackEntryPoint').inputValue()===EP);
  epOutage=false;await page.locator('#abandonedCallbackClose').click();await open(page);
  await page.waitForFunction(()=>document.querySelector('#abandonedCallbackEntryPoint option:checked')?.textContent.includes('Renamed_Callback_EP'));

  await page.locator('#abandonedCallbackHistory summary').click();await page.waitForSelector('#abandonedCallbackHistoryRows tr');
  ok('audit survives refresh with one enable row',await page.locator('#abandonedCallbackHistoryRows tr').count()===1);
  const second=await context.newPage();await second.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});await second.waitForFunction(()=>window.VB_SECURITY?.allowed);await open(second);
  ok('another tab sees the same persisted switch',await second.locator('#abandonedCallbackEnabled').isChecked());
  await page.locator('#abandonedCallbackEnabled').uncheck();await save(page);
  await second.locator('#abandonedCallbackForm details summary').click();await second.locator('#abandonedCallbackDelay').fill('45');await save(second);
  ok('concurrent stale edit loads current version without overwriting disable',(await second.locator('#abandonedCallbackLoadStatus').innerText()).includes('Another dashboard changed')&&!await second.locator('#abandonedCallbackEnabled').isChecked());
  await second.close();await page.locator('#abandonedCallbackEnabled').check();await save(page);
  outage=true;await page.locator('#abandonedCallbackClose').click();await page.locator('#abandonedCallbackSettingsToggle').click();
  await page.waitForFunction(()=>document.getElementById('abandonedCallbackLoadStatus').textContent.includes('unavailable'));
  ok('settings outage does not reset previously enabled switch',await page.locator('#abandonedCallbackEnabled').isChecked());
  ok('settings outage leaves reporting cards and tables intact',await page.locator('[data-voice-metric="received"] .stat-value').innerText()==='212'&&await page.locator('#queue-body tr').count()>0);
  outage=false;await page.locator('#abandonedCallbackClose').click();await open(page);
  await page.locator('#abandonedCallbackForm details summary').click();await page.locator('#abandonedCallbackDelay').fill('90');uncertain=true;await save(page);
  ok('lost save response reconciles accepted mutation without a duplicate',(await page.locator('#abandonedCallbackLoadStatus').innerText()).includes('server confirmed'));
  const recorded=await backend.request('history');ok('attempt change is recorded in the same source-IP audit',recorded.data.rows.at(-1).previous.maxAttempts===3&&recorded.data.rows.at(-1).next.maxAttempts===2);ok('all intended changes have exactly one audit record',recorded.data.rows.length===4);
  for(const width of [1440,1280,1024]){await page.setViewportSize({width,height:1200});await page.waitForTimeout(100);
    ok('settings panel fits viewport '+width,await page.locator('#abandonedCallbackSettingsPanel').evaluate(e=>{const b=e.getBoundingClientRect();return b.left>=-1&&b.right<=window.innerWidth+1;}));
    ok('dedicated button remains accessible '+width,await page.locator('#abandonedCallbackSettingsToggle').evaluate(e=>{const b=e.getBoundingClientRect();return b.left>=-1&&b.right<=window.innerWidth+1;}));}
  for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark-mode',d),dark);await page.waitForTimeout(100);
    const color=await page.locator('#abandonedCallbackSettingsPanel').evaluate(e=>getComputedStyle(e).backgroundColor);
    ok('panel adopts '+(dark?'dark':'light')+' theme',color===(dark?'rgb(15, 23, 42)':'rgb(255, 255, 255)'));}
  await page.setViewportSize({width:1440,height:1400});await page.locator('#abandonedCallbackSettingsPanel').screenshot({path:path.join(out,'callback-settings.png')});
  await page.locator('#abandonedCallbackClose').click();ok('panel closes without reloading reporting',!await page.locator('#abandonedCallbackSettingsPanel').isVisible());
  await page.evaluate(()=>{window.VB_SECURITY={allowed:false};});await page.locator('#abandonedCallbackSettingsToggle').click();
  ok('access revocation disables controls and removes IP audit data',await page.locator('#abandonedCallbackEnabled').isDisabled()&&(await page.locator('#abandonedCallbackLastChange').innerText())==='');
  ok('no uncaught first-party errors',errors.length===0);
  const result={passed:true,checks:checks.length,names:checks,errors,transport:'Actual dashboard scripts and isolated synthetic settings backend; no live API requests or customer calls'};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(e){console.error('FAIL',e);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}finally{await browser.close();}
