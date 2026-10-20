
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright-core');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const site='https://visionbank-dashboard.onrender.com',desktop='https://desktop.wxcc-us1.cisco.com';
try{
 const page=await browser.newPage();const requests=[];const errors=[];let dashboardCount=0;
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async route=>{
  const u=new URL(route.request().url());
  if(u.origin===desktop)return route.fulfill({contentType:'text/html',body:'<iframe style="width:1200px;height:900px" src="'+site+'/wxcc.html?view=agent-desktop"></iframe>'});
  if(u.origin===site){const p=path.join(process.cwd(),u.pathname.slice(1));if(fs.existsSync(p)&&fs.statSync(p).isFile())return route.fulfill({body:fs.readFileSync(p),contentType:p.endsWith('.js')||p.endsWith('.mjs')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.html')?'text/html':'image/png'});return route.fulfill({status:404,body:''});}
  requests.push(u.pathname);
  const now=Date.now();
  if(u.pathname==='/security/check')return route.fulfill({json:{allowed:true}});
  if(u.pathname==='/api/license/access')return route.fulfill({json:{allowed:true,enforcementEnabled:false}});
  if(u.pathname==='/api/webex/dashboard'){
   dashboardCount++;if(dashboardCount===1)return route.fulfill({status:503,headers:{'Retry-After':'1'},json:{success:false,error:'dashboard-refresh-pending'}});
   return route.fulfill({json:{success:true,generatedAtEpoch:now,generatedAtCentral:'Now',queues:[],agents:[],statistics:{}}});
  }
  if(u.pathname==='/api/webex/agent-performance')return route.fulfill({json:{success:true,schemaVersion:1,timezone:'America/Chicago',observedAt:now,dayStart:now,rows:[]}});
  if(u.pathname==='/api/webex/chat-reports')return route.fulfill({json:{success:true,schemaVersion:2,build:'2026.09.24-chat-integrated-2',channel:'chat',timezone:'America/Chicago',liveRows:[],queueSnapshot:{},rows:[],completedRows:[],summary:{},liveObservedAt:now,dailyObservedAt:now,completedObservedAt:now}});
  return route.fulfill({json:{success:true}});
 });
 await page.goto(desktop);
 let frame;for(let i=0;i<50&&!frame;i++){frame=page.frames().find(f=>f.url().startsWith(site));if(!frame)await page.waitForTimeout(50);}
 await frame.waitForFunction(()=>window.VB_REPORT_HEALTH?.state==='ready',{},{timeout:15000});
 assert.equal(dashboardCount,2,'one dashboard request plus bounded 503 retry');
 for(const p of ['/api/webex/daily-reports','/api/webex/analytics-trends','/api/webex/chat-customer-names','/motd'])assert(!requests.includes(p),'hidden request '+p);
 assert(!requests.some(p=>p.includes('imichatinit')),'customer widget skipped');
 assert.equal(errors.length,0,JSON.stringify(errors));
 await frame.evaluate(()=>location.reload());
 await page.waitForTimeout(1000);
 assert.equal(dashboardCount,2,'fresh snapshot reused after frame reload');
 console.log('PASS: 503 recovery; no duplicate dashboard fetch; hidden reports, analytics, names and widget skipped; fresh remount cache; no browser exceptions.');
}finally{await browser.close();}
