import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_DEVICE_ADMINS,SHARED_ADMIN_MAILBOXES,loadIdentityConfig,identityPolicy,getAdminSettings,
  setVerificationEnabled,setDefaultVerificationHours,setUserVerificationHours,removeUserVerificationHours,verificationHoursFor,
  addDeviceAdmin,removeDeviceAdmin,requestVerificationCode,confirmVerificationCode
} from '../../device-management/identity.mjs';
import {createOperatorSession} from '../../device-management/audit.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=100}={}){
    const keys=[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata}));
    return {keys,list_complete:true};
  }
}
const IP='198.51.100.12';
const req=(headers={})=>new Request('https://worker.example/device',{headers:{'CF-Connecting-IP':IP,'User-Agent':'Identity Test',...headers}});
const env=()=>({SESSIONS:new MemoryKV(),LOGS:new MemoryKV(),ADMIN:new MemoryKV(),BREVO_API_KEY:'test-key'});

test('default policy starts with verification enabled and seeded admins',async()=>{
  const e=env(),config=await loadIdentityConfig(e);
  assert.equal(config.verificationEnabled,true);
  assert.equal(config.defaultVerificationHours,24);
  assert.deepEqual(config.verificationHoursByEmail,{});
  assert.deepEqual(new Set(config.admins),new Set(DEFAULT_DEVICE_ADMINS));
  assert.deepEqual(SHARED_ADMIN_MAILBOXES,['infotech@visionbank.com']);
});

test('verification code is emailed, hashed at rest, and creates a verified operator identity',async()=>{
  const e=env();let sentCode='';
  const fetcher=async(_url,options)=>{
    const payload=JSON.parse(options.body);
    const match=String(payload.textContent).match(/\b(\d{6})\b/);
    sentCode=match?.[1]||'';
    return new Response(JSON.stringify({messageId:'test'}),{status:201});
  };
  const challenge=await requestVerificationCode(e,req(),{name:'Test Operator',email:'operator@visionbank.com'},{now:Date.parse('2026-10-03T12:00:00Z'),fetcher});
  assert.equal(challenge.required,true);
  assert.match(challenge.challengeId,/^[0-9a-f-]{36}$/i);
  assert.match(sentCode,/^\d{6}$/);
  const stored=[...e.SESSIONS.map.entries()].find(([key])=>key.startsWith('device-verify:'))?.[1]?.value||'';
  assert.equal(stored.includes(sentCode),false);
  assert.match(stored,/codeHash/);
  const confirmed=await confirmVerificationCode(e,req(),{challengeId:challenge.challengeId,code:sentCode},{now:Date.parse('2026-10-03T12:01:00Z')});
  assert.equal(confirmed.operator.email,'operator@visionbank.com');
  assert.equal(confirmed.operator.name,'Test Operator');
  assert.match(confirmed.verifiedAt,/2026-10-03T12:01:00.000Z/);
});

test('verification challenge is bound to the requesting network address',async()=>{
  const e=env();let code='';
  const fetcher=async(_url,options)=>{code=JSON.parse(options.body).textContent.match(/\b(\d{6})\b/)[1];return new Response('{}',{status:201});};
  const challenge=await requestVerificationCode(e,req(),{name:'Test Operator',email:'operator@visionbank.com'},{fetcher});
  const other=req({'CF-Connecting-IP':'203.0.113.5'});
  await assert.rejects(
    ()=>confirmVerificationCode(e,other,{challengeId:challenge.challengeId,code}),
    error=>error.code==='verification-source-changed'
  );
});

test('admin authorization requires a valid VisionBank Security session and seeded identity',async()=>{
  const e=env(),token='security-session-1';
  await e.SESSIONS.put(token,JSON.stringify({username:'ahmed.adeyemi@ussignal.com',role:'superadmin',expires:Date.now()+3600000}));
  await e.ADMIN.put('ahmed.adeyemi@ussignal.com',JSON.stringify({username:'ahmed.adeyemi@ussignal.com',email:'ahmed.adeyemi@ussignal.com',role:'superadmin'}));
  const request=req({Authorization:'Bearer '+token});
  const policy=await identityPolicy(e,request);
  assert.equal(policy.adminAuthorized,true);
  assert.equal(policy.admin.email,'ahmed.adeyemi@ussignal.com');
  const settings=await getAdminSettings(e,request);
  assert.equal(settings.verificationEnabled,true);
  assert.ok(settings.admins.includes('infotech@visionbank.com'));
  assert.ok(settings.sharedMailboxes.includes('infotech@visionbank.com'));
});

test('verified Device Manager operator on the admin list can manage settings without a separate Security login',async()=>{
  const e=env();
  const request=req();
  const session=await createOperatorSession(e,request,{name:'Ahmed Adeyemi',email:'ahmed.adeyemi@ussignal.com'},{verified:true,verificationMethod:'email-code',ttlSeconds:24*3600});
  const policy=await identityPolicy(e,req({'X-VB-Operator-Session':session.id}));
  assert.equal(policy.adminAuthorized,true);
  assert.equal(policy.admin.email,'ahmed.adeyemi@ussignal.com');
  const settings=await getAdminSettings(e,req({'X-VB-Operator-Session':session.id}));
  assert.equal(settings.currentAdmin.authMethod,'verified-email');
});

test('verification duration defaults to 24 hours and supports per-user overrides',async()=>{
  const e=env(),token='security-session-duration';
  await e.SESSIONS.put(token,JSON.stringify({username:'ahmed.adeyemi@ussignal.com',role:'superadmin',expires:Date.now()+3600000}));
  await e.ADMIN.put('ahmed.adeyemi@ussignal.com',JSON.stringify({username:'ahmed.adeyemi@ussignal.com',email:'ahmed.adeyemi@ussignal.com',role:'superadmin'}));
  const request=req({Authorization:'Bearer '+token});
  let config=await loadIdentityConfig(e);
  assert.equal(verificationHoursFor(config,'operator@visionbank.com'),24);
  config=await setDefaultVerificationHours(e,request,40);
  assert.equal(config.defaultVerificationHours,40);
  assert.equal(verificationHoursFor(config,'operator@visionbank.com'),40);
  config=await setUserVerificationHours(e,request,'operator@visionbank.com',80);
  assert.equal(verificationHoursFor(config,'operator@visionbank.com'),80);
  config=await removeUserVerificationHours(e,request,'operator@visionbank.com');
  assert.equal(verificationHoursFor(config,'operator@visionbank.com'),40);
});

test('listed identity still requires an admin or superadmin Security role',async()=>{
  const e=env(),token='security-session-view';
  await e.SESSIONS.put(token,JSON.stringify({username:'ahmed.adeyemi@ussignal.com',role:'view',expires:Date.now()+3600000}));
  await e.ADMIN.put('ahmed.adeyemi@ussignal.com',JSON.stringify({username:'ahmed.adeyemi@ussignal.com',email:'ahmed.adeyemi@ussignal.com',role:'view'}));
  const policy=await identityPolicy(e,req({Authorization:'Bearer '+token}));
  assert.equal(policy.adminAuthorized,false);
});

test('admins can toggle verification and add or remove allowed-domain admins',async()=>{
  const e=env(),token='security-session-2';
  await e.SESSIONS.put(token,JSON.stringify({username:'ahmed.adeyemi@ussignal.com',role:'superadmin',expires:Date.now()+3600000}));
  await e.ADMIN.put('ahmed.adeyemi@ussignal.com',JSON.stringify({username:'ahmed.adeyemi@ussignal.com',email:'ahmed.adeyemi@ussignal.com',role:'superadmin'}));
  const request=req({Authorization:'Bearer '+token});
  let settings=await setVerificationEnabled(e,request,false);
  assert.equal(settings.verificationEnabled,false);
  settings=await addDeviceAdmin(e,request,'new.admin@visionbank.com');
  assert.ok(settings.admins.includes('new.admin@visionbank.com'));
  settings=await removeDeviceAdmin(e,request,'new.admin@visionbank.com');
  assert.equal(settings.admins.includes('new.admin@visionbank.com'),false);
  await assert.rejects(()=>addDeviceAdmin(e,request,'outside@example.com'),error=>error.code==='device-admin-email-invalid');
});

test('shared Tech Admin mailbox can be an admin but cannot become the only remaining admin',async()=>{
  const e=env(),token='security-session-3';
  await e.LOGS.put('device-identity:config:v1',JSON.stringify({verificationEnabled:true,admins:['infotech@visionbank.com','ahmed.adeyemi@ussignal.com']}));
  await e.SESSIONS.put(token,JSON.stringify({username:'infotech@visionbank.com',role:'superadmin',expires:Date.now()+3600000}));
  await e.ADMIN.put('infotech@visionbank.com',JSON.stringify({username:'infotech@visionbank.com',email:'infotech@visionbank.com',role:'superadmin'}));
  const request=req({Authorization:'Bearer '+token});
  const settings=await getAdminSettings(e,request);
  assert.equal(settings.currentAdmin.sharedMailbox,true);
  await assert.rejects(
    ()=>removeDeviceAdmin(e,request,'ahmed.adeyemi@ussignal.com'),
    error=>error.code==='device-individual-admin-required'
  );
});
