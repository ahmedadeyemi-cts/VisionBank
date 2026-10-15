import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {createPhoneEnrollment,createPhoneIntent,startPhoneIntent,finishPhoneIntent,phoneProgressState,textScreen} from '../../device-management/phone-selfservice.mjs';
import {putLease,getLease} from '../../device-management/lease.mjs';
class KV{
 constructor(){this.map=new Map();}
 async get(k){return this.map.get(k)||null;}
 async put(k,v){this.map.set(k,v);}
 async list(){throw Error('Progress must not scan all leases');}
}
async function setup(model='T57W'){
 const env={WEBEX_ORG_ID:'org',DEVICE_WRITE_SCOPE:'organization',LOGS:new KV(),SESSIONS:new KV()};
 const enrolled=await createPhoneEnrollment(env,{device:{id:'device',mac:'80:5E:0C:EC:19:93',model},location:{id:'location'},phonismPhoneId:'phone',admin:{},baseUrl:'https://worker.example/api/webex/device-management',shortBaseUrl:'https://worker.example/p'});
 const enrollment=JSON.parse(await env.LOGS.get('device-phone-enrollment:805E0CEC1993'));
 const created=await createPhoneIntent(env,enrollment,{memberId:'target',durationMinutes:15});
 const intent=await startPhoneIntent(env,created.intentId,enrollment);
 const now=Date.now();
 const lease={leaseId:crypto.randomUUID(),status:'active',device:enrollment.device,location:enrollment.location,phonismPhoneId:'phone',startsAt:new Date(now-130000).toISOString(),expiresAt:new Date(now+600000).toISOString(),temporaryLine2:{memberId:'target',extension:'1406'},recovery:{syncPending:true},verification:{state:'sync-pending'}};
 const state={reboots:0,webexReads:0,lineReads:0,member:'target',line:'1406',fail:false};
 const webexFetch=async()=>{state.webexReads++;if(state.waitForLineRead)await state.waitForLineRead;return Response.json({members:[{id:state.member,port:2,extension:state.line}]});};
 const phonismReader={async lines(){state.lineReads++;state.onLineRead?.();if(state.failLineRead)throw Error('line-read-failed');return [{lineNumber:2,username:state.line}];},async tr069Action(){state.reboots++;if(state.fail)throw Error('provider-timeout');return {accepted:true};}};
 const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
 const base=enrolled.xmlUrl;
 async function get(action='progress',intentId=intent.intentId){const req=new Request(base+'?a='+action+'&intent='+intentId,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-'+model}});Object.defineProperty(req,'cf',{value:{colo:'TEST'}});const r=await handler(req,env);return {status:r.status,text:await r.text()};}
 async function saved(){await putLease(env,lease);await finishPhoneIntent(env,intent.intentId,{leaseId:lease.leaseId,expiresAt:lease.expiresAt});}
 return {env,enrollment,intent,lease,state,get,saved};
}
test('refresh XML escapes URL and leaves other text screens unchanged',()=>{
 const xml=textScreen('Adding','Wait',{refresh:5,url:'https://example.test/p?a=g&intent=x'});
 assert.match(xml,/refresh="5" url="https:\/\/example.test\/p\?a=g&amp;intent=x"/);
 assert.doesNotMatch(textScreen('Other','Text'),/refresh=|url=/);
});
test('estimate, overdue, failure and ended states do not claim unconfirmed success',()=>{
 const now=Date.now(),intent={status:'processing',startedAt:new Date(now-119999).toISOString()};
 assert.match(phoneProgressState(intent,null,now).text,/Estimated time remaining: 0:01/);
 intent.startedAt=new Date(now-120000).toISOString();
 assert.doesNotMatch(phoneProgressState(intent,null,now).text,/extension is saved/);
 const lease={status:'active',expiresAt:new Date(now+60000).toISOString(),recovery:{syncPending:true}};
 assert.match(phoneProgressState(intent,lease,now).text,/extension is saved/);
 assert.equal(phoneProgressState({...intent,status:'failed'},lease,now).kind,'help');
 assert.equal(phoneProgressState(intent,{...lease,status:'restored'},now).kind,'done');
 assert.equal(phoneProgressState(intent,{...lease,recovery:{syncFailed:true}},now).kind,'help');
});
test('T53, T54W and T57W progress auto-refreshes without provider calls or new saves',async()=>{
 for(const model of ['T53','T54W','T57W']){
  const f=await setup(model);let r=await f.get();assert.equal(r.status,200);assert.match(r.text,/Preparing your phone/);assert.match(r.text,/refresh="5"/);assert.match(r.text,/a=g/);
  await f.saved();r=await f.get();assert.doesNotMatch(r.text,/Restart Now/);assert.equal(f.state.webexReads,0);assert.equal(f.state.lineReads,0);assert.equal(f.state.reboots,0);
  const raw=JSON.parse(await f.env.SESSIONS.get('device-phone-intent:'+f.intent.intentId));raw.startedAt=new Date(Date.now()-121000).toISOString();await f.env.SESSIONS.put('device-phone-intent:'+f.intent.intentId,JSON.stringify(raw));
  r=await f.get();assert.match(r.text,/Taking longer than expected/);assert.match(r.text,/You do not need to save again/);
 }
});
test('Restart Now is gated, revalidates target and accepts only one fallback request',async()=>{
 const f=await setup();await f.saved();await f.get('restart');assert.equal(f.state.reboots,0);
 f.lease.recovery={syncPending:false,syncConfirmedBeforeReboot:true,rebootAt:new Date().toISOString(),rebootAttempted:true};await putLease(f.env,f.lease);
 assert.match((await f.get()).text,/Restarting your phone/);await f.get('restart');assert.equal(f.state.reboots,0);
 f.lease.recovery.rebootAt=new Date(Date.now()-61000).toISOString();await putLease(f.env,f.lease);
 assert.match((await f.get()).text,/Restart Now/);
 const responses=await Promise.all([f.get('restart'),f.get('restart')]);assert.ok(responses.some(r=>r.status===200));assert.equal(f.state.reboots,1);
 await f.get('restart');assert.equal(f.state.reboots,1);assert.match((await f.get()).text,/Restart requested/);
 assert.equal(f.state.webexReads,1);assert.equal(f.state.lineReads,1);
});
test('restart refuses changed assignments and cross-phone leases',async()=>{
 const f=await setup();f.lease.recovery={syncPending:false,syncConfirmedBeforeReboot:true,rebootAt:new Date(Date.now()-61000).toISOString()};await f.saved();
 f.state.member='new-target';assert.equal((await f.get('restart')).status,409);assert.equal(f.state.reboots,0);
 f.lease.device={...f.lease.device,id:'other-device',mac:'AA:BB:CC:DD:EE:FF'};await putLease(f.env,f.lease);assert.equal((await f.get()).status,403);assert.equal(f.state.reboots,0);
});
test('ambiguous restart failure stays claimed to prevent repeated restarts',async()=>{
 const f=await setup();f.lease.recovery={syncPending:false,syncConfirmedBeforeReboot:true,rebootAt:new Date(Date.now()-61000).toISOString()};await f.saved();f.state.fail=true;
 await f.get('restart');await f.get('restart');assert.equal(f.state.reboots,1);assert.ok((await getLease(f.env,f.lease.leaseId)).recovery.manualPhoneRestartAt);
});
test('expired progress intent cannot reach providers or restart',async()=>{
 const f=await setup();const raw={...f.intent,expiresAt:new Date(Date.now()-1000).toISOString()};await f.env.SESSIONS.put('device-phone-intent:'+raw.intentId,JSON.stringify(raw));assert.equal((await f.get()).status,409);assert.equal(f.state.reboots,0);
});

test('canonical Webex ID normalization keeps progress bound to the same physical phone',async()=>{const f=await setup('T54W');f.lease.device={...f.lease.device,id:'normalized-calling-id'};await f.saved();assert.equal((await f.get()).status,200);f.lease.phonismPhoneId='different-phone';await putLease(f.env,f.lease);assert.equal((await f.get()).status,403);});

test('active phone checks sync immediately after initial checks and requests restart without a cron tick',async()=>{
 const f=await setup('T54W');
 f.lease.startsAt=new Date().toISOString();
 f.lease.timing={saveRequestedAt:new Date(Date.now()-15000).toISOString()};
 f.lease.recovery={syncPending:true,syncPendingSince:f.lease.startsAt,initialSyncCheckCompletedAt:new Date().toISOString(),phonePollUntil:new Date(Date.now()+90000).toISOString()};
 await f.saved();
 f.state.line='old';await f.get();assert.equal(f.state.reboots,0);
 f.state.line='1406';assert.equal((await f.get()).status,200);assert.equal(f.state.reboots,1);
 const current=await getLease(f.env,f.lease.leaseId);
 assert.equal(current.recovery.syncPending,false);assert.equal(current.recovery.lastSyncCheckSource,'phone-progress');assert.equal(current.recovery.syncRetryChecks,2);
 assert.ok(current.timing.saveToRestartRequestMs>=15000);assert.ok(current.timing.saveToRestartRequestMs<30000);
 await f.get();assert.equal(f.state.reboots,1);
});
test('phone fast checks wait for initial completion and stop at scheduled handoff',async()=>{
 const f=await setup();f.lease.recovery={syncPending:true,phonePollUntil:new Date(Date.now()+90000).toISOString()};await f.saved();
 await f.get();assert.equal(f.state.webexReads,0);
 f.lease.recovery.initialSyncCheckCompletedAt=new Date().toISOString();f.lease.recovery.phonePollUntil=new Date(Date.now()+9000).toISOString();await putLease(f.env,f.lease);
 await f.get();assert.equal(f.state.webexReads,0);assert.equal(f.state.reboots,0);
});
test('overlapping phone progress coalesces synchronization and reboot',async()=>{
 const f=await setup();f.lease.recovery={syncPending:true,initialSyncCheckCompletedAt:new Date().toISOString(),phonePollUntil:new Date(Date.now()+90000).toISOString()};await f.saved();
 await Promise.all([f.get(),f.get()]);assert.equal(f.state.reboots,1);assert.equal(f.state.webexReads,1);
});


test('countdown follows original Save time, survives refresh, and switches at zero',()=>{
 const start=Date.parse('2026-10-15T18:00:00Z');
 const intent={status:'processing',startedAt:new Date(start).toISOString()};
 for(const [elapsed,label] of [[0,'2:00'],[5000,'1:55'],[15000,'1:45'],[60000,'1:00'],[115000,'0:05'],[119999,'0:01']]){
  const first=phoneProgressState(intent,null,start+elapsed);
  assert.ok(first.text.includes('Estimated time remaining: '+label));
  assert.deepEqual(phoneProgressState(intent,null,start+elapsed),first);
 }
 for(const elapsed of [120000,125000,180000]){
  const state=phoneProgressState(intent,null,start+elapsed);
  assert.equal(state.title,'Taking longer than expected');assert.doesNotMatch(state.text,/Estimated time remaining/);
 }
 const ready={status:'active',expiresAt:new Date(start+900000).toISOString(),recovery:{syncConfirmedBeforeReboot:true,syncPending:false,rebootAt:new Date(start+20000).toISOString()}};
 assert.equal(phoneProgressState(intent,ready,start+25000).title,'Restarting your phone...');
 assert.equal(phoneProgressState(intent,ready,start+81000).kind,'restart');
});

test('T53, T54W and T57W keep fast confirmation beyond the old ninety-second cutoff',async()=>{
 for(const model of ['T53','T54W','T57W']){
  const f=await setup(model);
  f.lease.startsAt=new Date(Date.now()-220000).toISOString();
  f.lease.recovery={syncPending:true,syncPendingSince:f.lease.startsAt,initialSyncCheckCompletedAt:f.lease.startsAt,phonePollUntil:new Date(Date.now()+80000).toISOString()};
  await f.saved();
  assert.equal((await f.get()).status,200);
  assert.equal(f.state.reboots,1);
  assert.equal((await getLease(f.env,f.lease.leaseId)).recovery.lastSyncCheckSource,'phone-progress');
 }
});
test('confirmation starts Phonism and Webex reads concurrently',async()=>{
 const f=await setup();
 f.lease.recovery={syncPending:true,initialSyncCheckCompletedAt:new Date().toISOString(),phonePollUntil:new Date(Date.now()+300000).toISOString()};
 f.state.waitForLineRead=new Promise(resolve=>{f.state.onLineRead=resolve;});
 await f.saved();await f.get();
 assert.equal(f.state.reboots,1);
 assert.equal(f.state.webexReads,1);assert.equal(f.state.lineReads,1);
});
test('parallel check rejects changed assignment even when Phonism read fails',async()=>{
 const f=await setup();
 f.lease.recovery={syncPending:true,initialSyncCheckCompletedAt:new Date().toISOString(),phonePollUntil:new Date(Date.now()+300000).toISOString()};
 f.state.member='someone-else';f.state.failLineRead=true;
 await f.saved();await f.get();
 assert.equal(f.state.reboots,0);
 const lease=await getLease(f.env,f.lease.leaseId);
 assert.equal(lease.recovery.syncFailed,true);
 assert.equal(lease.recovery.syncConfirmError,'webex-line-changed');
});
test('expired assignment cannot reboot during the extended fast-check window',async()=>{
 const f=await setup();
 f.lease.expiresAt=new Date(Date.now()-1000).toISOString();
 f.lease.recovery={syncPending:true,initialSyncCheckCompletedAt:new Date().toISOString(),phonePollUntil:new Date(Date.now()+300000).toISOString()};
 await f.saved();await f.get();
 assert.equal(f.state.reboots,0);assert.equal(f.state.webexReads,0);
});
