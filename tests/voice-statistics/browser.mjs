import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
import {evaluate,example,queue} from './fixtures.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),out=path.resolve('../browser-checks');fs.mkdirSync(out,{recursive:true});
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
await context.route('**/*',async route=>{const req=route.request(),u=new URL(req.url());if(!['GET','OPTIONS'].includes(req.method())){errors.push('Unexpected write '+req.method());return route.abort();}
 if(u.origin===origin){const p=path.resolve(root,u.pathname.replace(/^\//,'')||'webex.html');if(!p.startsWith(root+'/')||!fs.existsSync(p))return route.fulfill({status:404,body:''});return route.fulfill({status:200,contentType:({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'})[path.extname(p)]||'text/plain',body:fs.readFileSync(p)});}
 if(u.origin!==worker)return route.abort();requests.push(u.pathname);let body={success:true};
 if(u.pathname==='/security/check')body={allowed:true,reason:'synthetic-test'};
 else if(u.pathname==='/api/webex/dashboard')body=dashboard();
 else if(u.pathname==='/api/webex/chat-reports'){const at=Date.now();body={success:true,schemaVersion:2,build:'2026.09.24-chat-integrated-2',channel:'chat',timezone:'America/Chicago',dailyStatus:'ready',liveStatus:'ready',completedStatus:'ready',dailyObservedAt:at,liveObservedAt:at,completedObservedAt:at,rows:[],completedRows:[],liveRows:[],queueSnapshot:{},summary:Object.fromEntries(['offered','handled','abandoned','active','wrapup','waiting','offeredNow','completedToday'].map(k=>[k,{status:'ready',value:0}])),callbacks:{status:'ready',observedAt:at,rows:[],coverage:'Test callback history'}};}
 else if(u.pathname==='/api/webex/daily-reports')body={success:true,generatedAtEpoch:Date.now(),summary:{totalCallsReceived:212,answeredCalls:9,abandonedCalls:2},answeredCalls:[],abandonedCalls:[]};
 else if(u.pathname==='/api/webex/dashboard/settings')body={success:true,settings:{}};
 else if(u.pathname==='/motd')body={message:''};
 return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(body)});
});
const ok=(name,v=true)=>{assert.ok(v,name);checks.push(name);console.log('PASS',name);};
const card=k=>page.locator('[data-voice-metric="'+k+'"] .stat-value');
const refresh=()=>page.evaluate(async()=>{invalidateWebexDashboardCache();await loadGlobalStats();});
try{await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#vbVoiceStatistics')?.dataset.status==='ready');
 ok('actual dashboard scripts render 16 distinct Voice metrics',await page.locator('[data-voice-metric]').count()===16);
 ok('old ambiguous Voice grid is hidden',!await page.locator('.stat-grid[data-vb-replaced-voice-stats]').isVisible());
 ok('Queued means actual recorded waits, not all queue entries',await card('waited').innerText()==='5');
 ok('Offered and Answered use separate evidence',await card('offered').innerText()==='10'&&await card('answered').innerText()==='9');
 ok('received traffic remains visible separately',await card('received').innerText()==='212');
 ok('offered answer rate has the correct denominator',await card('answerRateOffered').innerText()==='90.00%');
 ok('queue abandonment excludes pre-queue abandon',await card('queueAbandonRate').innerText()==='9.09%');
 ok('active and wrap-up do not inflate Waiting now',await card('nowWaiting').innerText()==='0'&&await card('nowActive').innerText()==='2'&&await card('nowWrapup').innerText()==='1');
 ok('both existing Agent tables and channel indicators remain',await page.locator('#agent-body tr[data-vb-agent-id]').count()===1&&await page.locator('#chat-agents-body tr[data-vb-agent-id]').count()===1&&await page.locator('.vb-channel').count()===4);
 ok('existing Voice report tables remain mounted',await page.locator('#answeredCallsBody').count()===1&&await page.locator('#abandonedCallsBody').count()===1);
 await page.waitForTimeout(2200);ok('recurring integration renders do not duplicate the cards',await page.locator('#vbVoiceStatistics').count()===1&&await page.locator('[data-voice-metric]').count()===16);
 mode='partial';await refresh();ok('missing wait fields show unavailable without erasing offered count',await card('waited').innerText()==='—'&&await card('offered').innerText()==='10');
 mode='old-worker';await refresh();ok('old Worker revision does not silently revive the misleading metric',await card('waited').innerText()==='—'&&(await page.locator('#vbVoiceStatistics .vb-voice-meta').first().innerText()).includes('not available from the reporting service'));
 mode='stale';await refresh();ok('stale metrics expire without substituted zero totals',await card('received').innerText()==='—');
 mode='ready';dayRows='empty';await refresh();ok('genuine empty day shows zero counts and no-sample rates',await card('received').innerText()==='0'&&await card('answerRateOffered').innerText()==='—');
 dayRows='normal';await refresh();ok('new successful snapshot recovers without a browser reload',await card('waited').innerText()==='5');
 for(const width of [1440,1280,1024]){await page.setViewportSize({width,height:1150});await page.waitForTimeout(100);ok('all metric cards stay within their panel at '+width,await page.locator('#vbVoiceStatistics').evaluate(root=>{const box=root.getBoundingClientRect();return [...root.querySelectorAll('[data-voice-metric]')].every(x=>{const b=x.getBoundingClientRect();return b.left>=box.left-1&&b.right<=box.right+1;});}));}
 for(const dark of [false,true]){await page.evaluate(d=>document.body.classList.toggle('dark-mode',d),dark);await page.waitForTimeout(500);ok('metric values remain visible in '+(dark?'dark':'light')+' mode',await card('answered').isVisible()&&await card('answered').innerText()==='9');}
 await page.setViewportSize({width:1440,height:1400});await page.locator('#vbVoiceStatistics').locator('..').screenshot({path:path.join(out,'voice-statistics-r7.png')});
 ok('definitions explicitly distinguish service-target rate from contractual SLA',(await page.locator('#vbVoiceStatistics details').textContent()).includes('not contractual Service Level'));
 ok('no new reporting endpoint requests',requests.every(x=>['/security/check','/api/webex/dashboard','/api/webex/chat-reports','/api/webex/daily-reports','/api/webex/dashboard/settings','/motd'].includes(x)));
 await page.evaluate(()=>{window.VB_SECURITY={allowed:false};});await page.waitForTimeout(1500);ok('access revocation clears all Voice metric certainty',await card('received').innerText()==='—'&&await card('nowWaiting').innerText()==='—');
 ok('no uncaught first-party script errors',errors.length===0);
 const result={passed:true,checks:checks.length,names:checks,errors,mode:'Actual dashboard scripts with synthetic data; no live APIs or call actions',fixtureCounts:{received:212,offered:10,waited:5,answered:9,abandoned:2},artifact:path.join(out,'voice-statistics-r7.png')};fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log('RESULT',JSON.stringify(result));
}catch(e){console.error('FAIL',e);console.log('ERRORS',errors);await page.screenshot({path:path.join(out,'failure.png')});process.exitCode=1;}finally{await browser.close();}
