import fs from 'node:fs';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const browser=await chromium.launch({headless:true,channel:'chrome'});
const site='https://visionbank-dashboard.onrender.com',desktop='https://desktop.wxcc-us1.cisco.com';
try{
 for(const [name,parent,child,allowed,visible,approved,nested] of [
  ['trusted desktop',desktop,'/wxcc.html?view=agent-desktop',true,true,true,false],
  ['security denied',desktop,'/wxcc.html?view=agent-desktop',false,true,false,false],
  ['untrusted parent','https://untrusted.example','/wxcc.html?view=agent-desktop',true,false,true,false],
  ['other page',desktop,'/security.html?view=agent-desktop',true,false,true,false],
  ['regular dashboard embedded',desktop,'/wxcc.html',true,false,true,false],
  ['nested frame',desktop,'/wxcc.html?view=agent-desktop',true,false,true,true]
 ]){
  const p=await browser.newPage();let checked=0;
  await p.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.pathname==='/security/check'){checked++;return route.fulfill({json:{allowed}});}
   if(u.origin===site&&u.pathname.endsWith('.js'))return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(u.pathname.slice(1),'utf8')});
   if(u.origin===site)return route.fulfill({contentType:'text/html',body:'<html><head><script src="/portal-frame-policy.js"></script><script src="/portal-session.js"></script><script src="/portal-security-precheck.js" defer></script></head><body><div id="access-denied-overlay"><div id="access-denied-message"></div></div><main>Queues and agents</main></body></html>'});
   return route.fulfill({contentType:'text/html',body:'<iframe src="'+(nested&&u.pathname!=='/nested'?parent+'/nested':site+child)+'"></iframe>'});
  });
  await p.goto(parent);await p.waitForFunction(()=>document.querySelector('iframe'));
  let frame;for(let i=0;i<50&&!frame;i++){frame=p.frames().find(f=>f.url().startsWith(site));if(!frame)await p.waitForTimeout(50);}
  assert.ok(frame,name);await frame.waitForFunction(()=>window.VB_SECURITY);
  assert.equal(await frame.evaluate(()=>document.documentElement.style.display!=='none'),visible,name);
  assert.equal(await frame.evaluate(()=>document.body.classList.contains('security-approved')),approved,name);
  assert.ok(checked>0,'security check still ran');
  console.log('PASS',name);await p.close();
 }
}finally{await browser.close();}
