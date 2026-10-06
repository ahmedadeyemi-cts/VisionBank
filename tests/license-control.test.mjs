import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadLicenseConfig,loadLicenseState,updateLicenseConfig,activateLicense,licenseStatus,
  refreshLicense,licenseExemptPath,createLicenseControlHandler,testLicenseAuthority
} from '../license-control.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async get(key){return this.map.get(key)??null;}
  async put(key,value){this.map.set(key,value);}
  async delete(key){this.map.delete(key);}
}
const now=Date.now();
const ADMIN='admin@visionbank.com';
function env(){
  const e={LOGS:new MemoryKV(),SESSIONS:new MemoryKV(),ADMIN:new MemoryKV(),LICENSE_CONFIG_KEY:'x'.repeat(48)};
  e.SESSIONS.map.set('session-admin',JSON.stringify({username:ADMIN,role:'admin',expires:now+3600000}));
  e.SESSIONS.map.set('session-view',JSON.stringify({username:'viewer@visionbank.com',role:'view',expires:now+3600000}));
  e.ADMIN.map.set(ADMIN,JSON.stringify({email:ADMIN,role:'admin'}));
  e.ADMIN.map.set('viewer@visionbank.com',JSON.stringify({email:'viewer@visionbank.com',role:'view'}));
  return e;
}
function req(path,{method='GET',session='session-admin',body=null}={}){
  return new Request('https://worker.example'+path,{
    method,
    headers:{Authorization:'Bearer '+session,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10'},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}
const primary={
  repository:'ahmedadeyemi-cts/dashboard-license-control',
  authorityUrl:'https://license-primary.example'
};
const mirror={
  repository:'ahmedadeyemi-uss/dashboard-license-control',
  authorityUrl:'https://license-mirror.example'
};
const healthFetch=async url=>Response.json({ok:true,service:'visionbank-license-control',time:new Date().toISOString()});
const activationFetch=async(url,options={})=>{
  if(url.endsWith('/api/v1/activate'))return Response.json({
    installationToken:'install-secret-abc',
    installationId:'inst-1',licenseId:'lic-1',customerName:'VisionBank Iowa',
    status:'active',access:true,expiresAt:'2030-10-05T00:00:00.000Z',
    fullRevalidationAt:'2030-04-05T00:00:00.000Z',fullRevalidationRequired:false,
    heartbeatIntervalHours:24,offlineGraceHours:2160,entitlements:{portal_access:true}
  });
  if(url.endsWith('/api/v1/heartbeat'))return Response.json({
    licenseId:'lic-1',customerName:'VisionBank Iowa',status:'active',access:true,
    expiresAt:'2030-10-05T00:00:00.000Z',fullRevalidationAt:'2030-04-05T00:00:00.000Z',
    fullRevalidationRequired:false,heartbeatIntervalHours:24,offlineGraceHours:2160,
    entitlements:{portal_access:true}
  });
  return Response.json({ok:true});
};

test('default configuration is non-enforcing and points at the live primary licensing authority',async()=>{
  const c=await loadLicenseConfig(env());
  assert.equal(c.enforcementEnabled,false);
  assert.equal(c.activeSource,'primary');
  assert.equal(c.primary.repository,'ahmedadeyemi-cts/dashboard-license-control');
  assert.equal(c.primary.authorityUrl,'https://dashboard-license-control.onrender.com');
  assert.equal(c.mirror.repository,'ahmedadeyemi-uss/dashboard-license-control');
});

test('blank or legacy primary authority is automatically migrated to the live authority',async()=>{
  for(const authorityUrl of ['', 'https://visionbank-license-control.onrender.com']){
    const e=env();
    await e.LOGS.put('portal-license-config:v1',JSON.stringify({
      activeSource:'primary',
      primary:{repository:'ahmedadeyemi-cts/dashboard-license-control',authorityUrl},
      mirror:{repository:'ahmedadeyemi-uss/dashboard-license-control',authorityUrl:''},
      enforcementEnabled:false,
      systemId:'system-1',
      installationName:'VisionBank Production'
    }));
    const c=await loadLicenseConfig(e);
    assert.equal(c.primary.authorityUrl,'https://dashboard-license-control.onrender.com');
    assert.equal(c.primary.repository,'ahmedadeyemi-cts/dashboard-license-control');
  }
});

test('only Security admin can update licensing source configuration',async()=>{
  const e=env();
  await assert.rejects(
    ()=>updateLicenseConfig(e,req('/api/license/config',{method:'POST',session:'session-view'}),{primary}),
    error=>error.code==='license-admin-required'&&error.status===403
  );
  const c=await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{
    activeSource:'primary',primary,mirror,installationName:'VisionBank Production'
  });
  assert.equal(c.primary.authorityUrl,primary.authorityUrl);
  assert.equal(c.mirror.authorityUrl,mirror.authorityUrl);
  assert.ok(c.systemId);
});

test('enforcement cannot be enabled before activation',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  await assert.rejects(
    ()=>updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror,enforcementEnabled:true}),
    error=>error.code==='valid-license-required-before-enforcement'&&error.status===409
  );
});

test('activation encrypts installation token and then allows enforcement',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  const s=await activateLicense(e,req('/api/license/activate',{method:'POST'}),{licenseKey:'VBL-ABCDE-FGHIJ-KLMNO-PQRST',fetcher:activationFetch});
  assert.equal(s.allowed,true);
  assert.equal(s.status,'active');
  const stored=await loadLicenseState(e);
  assert.match(stored.installationToken,/^v1\./);
  assert.equal(JSON.stringify(stored).includes('install-secret-abc'),false);
  const c=await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror,enforcementEnabled:true});
  assert.equal(c.enforcementEnabled,true);
  const status=await licenseStatus(e,{refreshIfDue:false});
  assert.equal(status.allowed,true);
  assert.equal(status.customerName,'VisionBank Iowa');
});

test('active source can switch to mirror without exposing installation token',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  await activateLicense(e,req('/api/license/activate',{method:'POST'}),{licenseKey:'VBL-ABCDE-FGHIJ-KLMNO-PQRST',fetcher:activationFetch});
  const c=await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{
    activeSource:'mirror',primary,mirror
  });
  assert.equal(c.activeSource,'mirror');
  const status=await licenseStatus(e,{refreshIfDue:false});
  assert.equal(status.authorityUrl,mirror.authorityUrl);
  assert.equal(Object.hasOwn(status,'installationToken'),false);
});

test('revoked heartbeat immediately denies access once enforcement is active',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  await activateLicense(e,req('/api/license/activate',{method:'POST'}),{licenseKey:'VBL-ABCDE-FGHIJ-KLMNO-PQRST',fetcher:activationFetch});
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror,enforcementEnabled:true});
  const revokedFetch=async url=>{
    if(url.endsWith('/api/v1/heartbeat'))return Response.json({
      status:'revoked',access:false,expiresAt:'2030-10-05T00:00:00.000Z',
      heartbeatIntervalHours:24,offlineGraceHours:2160
    },{status:403});
    return healthFetch(url);
  };
  const s=await refreshLicense(e,{force:true,fetcher:revokedFetch});
  assert.equal(s.allowed,false);
  assert.equal(s.status,'revoked');
  assert.equal(s.reason,'license-revoked');
});

test('authority requests use Cloudflare-supported manual redirect mode',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  let seen=null;
  const fetcher=async(url,options)=>{seen={url,redirect:options.redirect,method:options.method};return Response.json({ok:true,service:'dashboard-license-control'});};
  const result=await testLicenseAuthority(e,req('/api/license/test',{method:'POST'}),{source:'primary',fetcher});
  assert.equal(result.ok,true);
  assert.equal(seen.redirect,'manual');
  assert.equal(seen.method,'GET');
});

test('authority outage records error but keeps access during offline grace',async()=>{
  const e=env();
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror});
  await activateLicense(e,req('/api/license/activate',{method:'POST'}),{licenseKey:'VBL-ABCDE-FGHIJ-KLMNO-PQRST',fetcher:activationFetch});
  await updateLicenseConfig(e,req('/api/license/config',{method:'POST'}),{primary,mirror,enforcementEnabled:true});
  const fail=async()=>{throw new TypeError('network down');};
  const s=await refreshLicense(e,{force:true,fetcher:fail});
  assert.equal(s.allowed,true);
  assert.equal(s.lastValidationError,'license-authority-unreachable');
});

test('license handler exposes status to authenticated Security session and protects config writes',async()=>{
  const e=env(),handler=createLicenseControlHandler({fetcher:healthFetch});
  const status=await handler(req('/api/license/status',{session:'session-view'}),e,{});
  assert.equal(status.status,200);
  const denied=await handler(req('/api/license/config',{method:'POST',session:'session-view',body:{primary}}),e,{});
  assert.equal(denied.status,403);
});

test('Security and licensing routes are always exempt from license enforcement',()=>{
  for(const p of [
    '/security/check','/api/login','/api/logout','/api/setup-mfa','/api/confirm-mfa',
    '/api/session/status','/api/license/status','/api/users/list','/api/security/sessions',
    '/api/get-hours','/api/get-ip-rules','/api/logs'
  ])assert.equal(licenseExemptPath(p),true,p);
  for(const p of ['/api/webex/dashboard','/api/webex/device-management/inventory','/api/webex/daily-reports'])
    assert.equal(licenseExemptPath(p),false,p);
});
