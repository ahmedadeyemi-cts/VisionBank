import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {execFileSync} from 'node:child_process';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'/Users/Ahmed.Adeyemi/visionbank-chat-release-sku_wror/browser-tools/node_modules/playwright-core/index.mjs');
const root=path.resolve('.'),origin='https://visionbank-dashboard.onrender.com',worker='https://visionbank-security.ahmedadeyemi.workers.dev';
const artifacts=path.resolve('../browser-checks');fs.mkdirSync(artifacts,{recursive:true});
const get=p=>JSON.parse(execFileSync('curl',['-fsS','--max-time','45','-H','Origin: '+origin,worker+p],{encoding:'utf8',maxBuffer:10000000}));
const baseline={dashboard:get('/api/webex/dashboard'),live:get('/api/webex/chat-reports?view=live'),daily:get('/api/webex/chat-reports'),voice:get('/api/webex/daily-reports')};
assert.equal(baseline.dashboard.success,true);assert.ok(baseline.dashboard.agents.length,'Need a current row schema');
let category='idle',label='Meeting',voice=[0,0,0],chat=[0,0,0],stale=false,missing=false;
const ch=(limit,v,at)=>({source:'agentSession.channelInfo',reason:'',observedAt:at,reportedSlotCount:limit,capacity:limit,capacitySource:'reported-channel-slots',activeSlots:v[0],wrapupSlots:v[1],offeredSlots:v[2],availableSlots:category==='idle'?0:limit-v.reduce((a,b)=>a+b,0),routingState:v[0]?'engaged':v[1]?'wrapup':v[2]?'reserved':category==='idle'?'idle':'available',interactions:[],unmappedWork:0});
function dashboard(){const d=structuredClone(baseline.dashboard),at=Date.now()-(stale?60000:0);const a={...d.agents[0],agentId:'agent-1',name:'Example Agent',team:'CEG Agents',number:'3223',sessionId:'test-session',status:label,voiceChannel:missing?undefined:ch(1,voice,at),chatChannel:ch(5,chat,at),stateIndicator:{revision:4,category,label,idleVerified:category==='idle',idleReason:category==='idle'?{id:'test-idle',name:label}:null,observedAt:at,stateStartedAt:at-90000},agentStatus:{state:label,tone:category,observedAt:at}};d.agents=[a];d.generatedAtEpoch=at;return d;}
function liveReport(){const d=structuredClone(baseline.live);d.liveObservedAt=Date.now()-(stale?60000:0);d.liveRows=[];for(const k of ['active','wrapup','waiting','offeredNow'])d.summary[k]={value:0,status:'ready'};return d;}
function dailyReport(){const d=structuredClone(baseline.daily);d.dailyObservedAt=Date.now();d.completedObservedAt=Date.now();d.rows=[{agentId:'agent-1',agent:'Example Agent',handled:true,isActive:false}];d.completedRows=[];return d;}
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const context=await browser.newContext({viewport:{width:1700,height:1050},acceptDownloads:true});const page=await context.newPage();let errors=[],requests=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));
const ok=(name,x=true)=>{assert.ok(x,name);checks.push(name);console.log('PASS',name);};
await context.route('**/*',async route=>{
 const req=route.request(),u=new URL(req.url());if(!['GET','OPTIONS'].includes(req.method()))throw new Error('Unexpected mutating request '+req.method());
 if(u.origin===origin){const rel=decodeURIComponent(u.pathname).replace(/^\//,'')||'webex.html';const file=path.resolve(root,rel);if(!file.startsWith(root+'/')||!fs.existsSync(file)){return route.fulfill({status:404,body:''});}const ext=path.extname(file),ct={'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'}[ext]||'text/plain';return route.fulfill({status:200,contentType:ct,body:fs.readFileSync(file)});}
 if(u.origin===worker){requests.push(u.pathname);let body={success:true};if(u.pathname==='/security/check')body={allowed:true,reason:'test-fixture'};else if(u.pathname==='/api/webex/dashboard')body=dashboard();else if(u.pathname==='/api/webex/chat-reports')body=u.searchParams.get('view')==='live'?liveReport():dailyReport();else if(u.pathname==='/api/webex/daily-reports')body=baseline.voice;else if(u.pathname==='/api/webex/dashboard/settings')body={success:true,settings:baseline.dashboard.settings};else if(u.pathname==='/motd')body={message:''};else if(u.pathname==='/api/webex/chat-customer-names')body={success:true,schemaVersion:1,rows:[]};return route.fulfill({status:200,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:JSON.stringify(body)});}
 return route.abort();
});
const main='#agent-body tr[data-vb-agent-id="agent-1"]',lower='#chat-agents-body tr[data-vb-agent-id="agent-1"]';
async function expected(phone,chatTone){await page.waitForFunction(({main,lower,phone,chatTone})=>[main,lower].every(sel=>{const r=document.querySelector(sel);return r?.querySelector('[data-channel=phone]')?.dataset.tone===phone&&r?.querySelector('[data-channel=chat]')?.dataset.tone===chatTone;}),{main,lower,phone,chatTone},{timeout:15000});}
async function refresh(){await page.evaluate(async()=>{invalidateWebexDashboardCache();await loadAgentStatus();});}
try{
 await page.goto(origin+'/webex.html',{waitUntil:'domcontentloaded'});await expected('idle','idle');
 ok('both actual integration tables show yellow for Meeting');
 ok('old activity column replaced without adding another column',(await page.locator('#agent-body').locator('..').locator('thead').innerText()).includes('Channel activity')&&!(await page.locator('#agent-body').locator('..').locator('thead').innerText()).includes('Current Chat activity'));
 ok('lower Agent State remains yellow and separate from channel cell',await page.locator(lower+' [data-vb-overall-state]').getAttribute('data-state')==='idle');
 await page.waitForTimeout(2500);await expected('idle','idle');ok('icons survive repeated one-second renders');
 const scenario=async(cat,l,v,c,pTone,cTone)=>{category=cat;label=l;voice=v;chat=c;await refresh();await expected(pTone,cTone);};
 await scenario('available','Available',[0,0,0],[0,0,0],'available','available');ok('Available/no work independently green');
 await scenario('engaged','Engaged',[1,0,0],[0,0,0],'engaged','available');ok('Voice only does not mark Chat busy');
 await scenario('engaged','Engaged',[0,0,0],[2,0,0],'available','engaged');ok('Chat only does not mark Phone busy');
 await scenario('engaged','Engaged',[1,0,0],[2,0,0],'engaged','engaged');ok('concurrent Voice/Chat both red');
 ok('Chat shows 2 / 5 from actual channel counters',(await page.locator(main+' [data-channel=chat]').innerText()).includes('2 / 5'));
 await scenario('wrapup','Wrap-up',[0,1,0],[0,0,0],'wrapup','available');ok('Voice wrap-up only Phone orange');
 await scenario('wrapup','Wrap-up',[0,0,0],[0,1,0],'available','wrapup');ok('Chat wrap-up only Chat orange');
 await scenario('idle','New Idle Reason',[0,0,0],[0,0,0],'idle','idle');ok('previously unknown Idle reason yellow automatically');
 await scenario('idle','Lunch',[1,0,0],[0,0,0],'engaged','idle');ok('real active work is not hidden by pending Idle evidence');
 await scenario('offered','Reserved',[0,0,1],[0,0,0],'engaged','available');ok('offered Voice occupied not green');
 category='available';label='Available';voice=[0,0,0];chat=[0,0,0];missing=true;await refresh();await expected('unknown','available');ok('missing Phone evidence gray, not invented green');missing=false;
 stale=true;await refresh();await expected('unknown','unknown');ok('stale snapshots turn both indicators gray');stale=false;
 await scenario('idle','Meeting',[0,0,0],[0,0,0],'idle','idle');
 for(const theme of ['dark-mode','']){await page.evaluate(theme=>document.body.className=theme,theme);await page.waitForTimeout(500);await expected('idle','idle');const rgb=await page.locator(main+' .vb-channel-icon').first().evaluate(el=>getComputedStyle(el).backgroundColor);ok('yellow retained in '+(theme||'light')+' theme',rgb==='rgb(250, 204, 21)');const colors=await page.locator(main+' .vb-channel-cell').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,fg:getComputedStyle(el.querySelector('.vb-channel-icon')).color}));ok('cell and icon contrast in '+(theme||'light'),colors.bg===(theme?'rgb(2, 6, 23)':'rgb(255, 255, 255)')&&colors.fg==='rgb(17, 24, 39)');}
 await page.evaluate(()=>document.body.classList.add('dark-mode'));
 await page.locator('#chat-agents-search').fill('Phone: Not available');ok('Channel activity participates in search',(await page.locator(lower).count())===1);await page.locator('#chat-agents-search').fill('');
 const downloaded=page.waitForEvent('download');await page.locator('#chat-agents-export').click();const download=await downloaded;const file=await download.path();const csv=fs.readFileSync(file,'utf8');ok('CSV retains readable phone/chat values without SVG',csv.includes('Channel activity')&&csv.includes('Phone: Not available')&&!csv.includes('<svg'));
 for(const width of [1700,1440,1280]){await page.setViewportSize({width,height:1050});const inside=await page.locator(main+' .vb-channel-activity').evaluate(el=>{const box=el.getBoundingClientRect(),td=el.closest('td').getBoundingClientRect();return box.x>=td.x&&box.right<=td.right;});ok('compact channel icons remain within cell at '+width,inside);for(const row of [main,lower])for(const type of ['phone','chat']){const bounded=await page.locator(row+' [data-channel='+type+']').evaluate(el=>{const r=el.getBoundingClientRect(),c=el.closest('td').getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom;});ok(type+' contents do not overlap the next column at '+width+' '+row,bounded);}}
 await page.setViewportSize({width:1700,height:1050});await page.locator('#tls_al_frm').evaluateAll(xs=>xs.forEach(x=>x.remove()));await page.locator('#agent-body').locator('xpath=ancestor::section[contains(@class,"panel")]').screenshot({path:path.join(artifacts,'channel-activity-dark.png')});
 ok('one legend and two channel icons per row only',(await page.locator('.vb-channel-legend').count())===1&&(await page.locator(main+' .vb-channel').count())===2);
 ok('no buttons or extra confirmation steps in activity cells',(await page.locator('.vb-channel-cell button, .vb-channel-cell input').count())===0);
 ok('no new backend endpoint or altered refresh source',requests.every(p=>['/security/check','/api/webex/dashboard','/api/webex/chat-reports','/api/webex/daily-reports','/api/webex/dashboard/settings','/api/webex/chat-customer-names','/motd'].includes(p)));
 await page.evaluate(()=>{window.VB_SECURITY={allowed:false};});await page.waitForTimeout(1500);ok('security revocation clears current channel certainty',(await page.locator('.vb-channel[data-tone=available],.vb-channel[data-tone=engaged]').count())===0);
 ok('no uncaught dashboard errors',errors.length===0);
 fs.writeFileSync(path.join(artifacts,'synthetic-result.json'),JSON.stringify({passed:true,checks:checks.length,names:checks,errors,mode:'actual dashboard scripts with mocked reporting responses; no live state changes'},null,2));console.log('RESULT',JSON.stringify({passed:true,checks:checks.length,errors,artifacts}));
}catch(e){console.error('FAIL',e);console.log('ERRORS',errors);console.log('ROWS',await page.locator('#agent-body,#chat-agents-body').innerText().catch(()=>''));await page.screenshot({path:path.join(artifacts,'failure.png')});process.exitCode=1;}finally{await browser.close();}
