import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';

const ORIGIN='https://visionbank-dashboard.onrender.com';
const IP='198.51.100.12';
function json(body,status=200,headers={}){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}});}

function fixture({phonismReader}={}){
  const calls=[];
  const defaultPhonism={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[
      {id:'101',name:'DUFF',webexLocationId:'loc-a'},
      {id:'102',name:'AUSTIN',webexLocationId:'loc-b'}
    ],webexIntegration:null,truncated:false};},
    async tenantPhones(_env,tenantId,tenantName){return {phones:tenantId==='101'?[{
      id:'9001',tenantId:'101',tenantName:tenantName||'DUFF',mac:'00:11:22:33:44:55',state:'1',
      serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:10:00',
      webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Partner Managed Phone - Yealink'
    }]:tenantId==='102'?[{
      id:'9002',tenantId:'102',tenantName:tenantName||'AUSTIN',mac:'AA:BB:CC:DD:EE:FF',state:'1',
      serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:11:00',
      webexDeviceIds:['webex-2'],webexDeviceId:'webex-2',webexDeviceType:'Partner Managed Phone - Yealink'
    }]:[],truncated:false};},
    async phone(_env,phoneId,tenant){
      if(String(phoneId)==='9002')return {
        id:'9002',tenantId:String(tenant?.id||'102'),tenantName:tenant?.name||'AUSTIN',mac:'AA:BB:CC:DD:EE:FF',state:'1',
        serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:11:00',
        webexDeviceIds:['webex-2'],webexDeviceId:'webex-2',webexDeviceType:'Partner Managed Phone - Yealink'
      };
      return {
        id:String(phoneId),tenantId:String(tenant?.id||'101'),tenantName:tenant?.name||'DUFF',mac:'00:11:22:33:44:55',state:'1',
        serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:10:00',
        webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Partner Managed Phone - Yealink'
      };
    },
    async lines(_env,phoneId){return phoneId==='9001'?[
      {lineNumber:1,username:'4101',alias:'Alex User',registrationStatus:'registered'},
      {lineNumber:2,username:'4190',alias:'Open Desk',registrationStatus:'unregistered'}
    ]:[];}
  };
  phonismReader=phonismReader||defaultPhonism;
  const webexFetch=async(_env,url,options={})=>{
    calls.push({url,method:options.method||'GET'});
    const u=new URL(url);
    if(u.pathname==='/v1/locations')return json({items:[{id:'loc-a',name:'Dallas',address:{city:'Dallas',state:'TX'}},{id:'loc-b',name:'Austin'}]});
    if(u.pathname==='/v1/devices/webex-1')return json({
      id:'webex-1',callingDeviceId:'call-1',displayName:'Lobby Phone',product:'Yealink T57W',
      mac:'001122334455',connectionStatus:'connected',personId:'user-1',locationId:'loc-a',managedBy:'PARTNER',type:'phone'
    });
    if(u.pathname==='/v1/devices/webex-2')return json({
      id:'webex-2',callingDeviceId:'call-2',displayName:'Test Phone',product:'Yealink T53W',
      mac:'AABBCCDDEEFF',connectionStatus:'connected',workspaceId:'space-y',locationId:'loc-b',managedBy:'PARTNER',type:'phone'
    });
    if(u.pathname==='/v1/telephony/config/devices/call-1')return json({location:{id:'loc-a',name:'Dallas'},status:'registered'});
    if(u.pathname==='/v1/telephony/config/devices/call-1/members')return json({members:[
      {id:'user-1',displayName:'Alex User',memberType:'PEOPLE',extension:'4101',location:{id:'loc-a',name:'Dallas'},lineType:'PRIMARY',port:1},
      {id:'space-1',displayName:'Open Desk',memberType:'PLACE',extension:'4190',location:{id:'loc-a',name:'Dallas'},lineType:'SHARED_CALL_APPEARANCE',port:2}
    ]});
    if(u.pathname==='/v1/telephony/config/devices/call-2/members')return json({members:[
      {id:'space-y',firstName:'Test',memberType:'PLACE',extension:'4000',location:{id:'loc-b',name:'Austin'},lineType:'PRIMARY',port:1}
    ]});
    if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[
      {id:'user-2',displayName:'Taylor User',memberType:'PEOPLE',extension:'4102',location:{id:'loc-a',name:'Dallas'}},
      {id:'user-x',displayName:'Wrong Location',memberType:'PEOPLE',extension:'5102',location:{id:'loc-b',name:'Austin'}},
      {id:'space-x',firstName:'Zeta Workspace',memberType:'PLACE',extension:'5199',location:{id:'loc-a',name:'Dallas'}}
    ]});
    if(u.pathname==='/v1/telephony/config/numbers'){
      const match=u.searchParams.get('extension')==='4000'||String(u.searchParams.get('ownerName')||'').toLowerCase()==='test';
      return json({phoneNumbers:match?[{
        extension:'4000',phoneNumber:'',owner:{id:'space-y',firstName:'Test',type:'PLACE'},location:{id:'loc-b',name:'Austin'}
      }]:[]});
    }
    return json({message:'not found'},404);
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['198.51.100.0/24'],phonismReader});
  return {handler,calls};
}

async function request(handler,path,{method='GET',origin=ORIGIN,cf=true,headers={},env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32)}}={}){
  const req=new Request('https://worker.example/api/webex/device-management/'+path,{method,headers:{Origin:origin,'CF-Connecting-IP':IP,...headers}});
  if(cf)Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  const res=await handler(req,env,{'Access-Control-Allow-Origin':ORIGIN});
  return {status:res.status,data:await res.json()};
}
test('locations are normalized through the read-only gateway',async()=>{
  const f=fixture(),r=await request(f.handler,'locations');
  assert.equal(r.status,200);assert.equal(r.data.success,true);
  assert.deepEqual(r.data.locations[0],{id:'loc-a',name:'Dallas',address:'Dallas, TX'});
  assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('inventory correlates calling device, primary line and Line 2 without writes',async()=>{
  const f=fixture(),r=await request(f.handler,'inventory?locationId=loc-a');
  assert.equal(r.status,200);assert.equal(r.data.devices.length,1);
  const d=r.data.devices[0];
  assert.equal(d.id,'call-1');assert.equal(d.mac,'00:11:22:33:44:55');
  assert.equal(d.locationId,'loc-a');assert.equal(d.line1.extension,'4101');assert.equal(d.line2.extension,'4190');
  assert.equal(d.line1.webexRegistrationStatus,'registered');
  assert.equal(d.line1.phonismRegistrationStatus,'registered');
  assert.ok(f.calls.every(c=>c.method==='GET'));
});

test('single-device detail enriches one summary phone without loading the whole location',async()=>{
  const f=fixture(),r=await request(f.handler,'device-detail?locationId=loc-a&phonismPhoneId=9001');
  assert.equal(r.status,200);
  assert.equal(r.data.device.id,'call-1');
  assert.equal(r.data.device.phonismPhoneId,'9001');
  assert.equal(r.data.device.detailsLoaded,true);
  assert.equal(r.data.device.line1.extension,'4101');
  assert.equal(r.data.device.line2.extension,'4190');
});

test('available members include users and workspaces across Webex locations',async()=>{
  const f=fixture(),r=await request(f.handler,'members?deviceId=call-1');
  assert.equal(r.status,200);
  assert.equal(r.data.scope,'organization');
  assert.equal(r.data.totalMatches,3);
  assert.deepEqual(r.data.members.map(x=>x.id),['user-2','user-x','space-x']);
  assert.deepEqual(r.data.members.map(x=>x.locationId),['loc-a','loc-b','loc-a']);
  assert.deepEqual(r.data.members.map(x=>x.locationName),['Dallas','Austin','Dallas']);
});

test('available-member search filters server-side and bounds browser results',async()=>{
  const f=fixture();
  const byLocation=await request(f.handler,'members?deviceId=call-1&q=Austin&limit=50');
  assert.equal(byLocation.status,200);
  assert.equal(byLocation.data.totalMatches,1);
  assert.deepEqual(byLocation.data.members.map(x=>x.id),['user-x']);
  assert.equal(byLocation.data.truncated,false);

  const workspace=await request(f.handler,'members?deviceId=call-1&q=Zeta%20Workspace&limit=50');
  assert.equal(workspace.status,200);
  assert.equal(workspace.data.totalMatches,1);
  assert.equal(workspace.data.members[0].id,'space-x');
  assert.equal(workspace.data.members[0].name,'Zeta Workspace');
  assert.equal(workspace.data.members[0].type,'PLACE');
  assert.equal(workspace.data.members[0].available,true);

  const unavailable=await request(f.handler,'members?deviceId=call-1&q=4000&limit=50');
  assert.equal(unavailable.status,200);
  assert.equal(unavailable.data.eligibleMatches,0);
  assert.equal(unavailable.data.unavailableMatches,1);
  assert.equal(unavailable.data.members[0].id,'space-y');
  assert.equal(unavailable.data.members[0].name,'Test');
  assert.equal(unavailable.data.members[0].extension,'4000');
  assert.equal(unavailable.data.members[0].locationName,'Austin');
  assert.equal(unavailable.data.members[0].available,false);
  assert.equal(unavailable.data.members[0].unavailableReason,'webex-not-available-existing-appearance');
  assert.equal(unavailable.data.members[0].appearances[0].deviceName,'Test Phone');
  assert.equal(unavailable.data.members[0].appearances[0].port,1);

  const bounded=await request(f.handler,'members?deviceId=call-1&limit=1');
  assert.equal(bounded.status,200);
  assert.equal(bounded.data.totalMatches,3);
  assert.deepEqual(bounded.data.members.map(x=>x.id),['user-2']);
  assert.equal(bounded.data.truncated,true);
});

test('capabilities reports scoped Webex and Phonism reads while leaving writes disabled',async()=>{
  const f=fixture(),r=await request(f.handler,'capabilities');
  assert.equal(r.status,200);assert.equal(r.data.webex.ready,true);
  assert.equal(r.data.webex.memberRead,'available');
  assert.equal(r.data.webex.deviceScope,'phonism-visionbank-iowa');
  assert.equal(r.data.phonism.ready,true);
  assert.equal(r.data.writes.enabled,false);
  assert.equal(r.data.writes.scope,'disabled');
});

test('organization write scope marks a non-pilot VisionBank phone as write eligible',async()=>{
  const f=fixture();
  const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',DEVICE_WRITE_PILOT_MACS:'00:11:22:33:44:55'};
  const cap=await request(f.handler,'capabilities',{env});
  assert.equal(cap.status,200);
  assert.equal(cap.data.writes.scope,'organization');
  assert.equal(cap.data.writes.organizationWide,true);
  assert.equal(cap.data.writes.previewReady,true);
  const detail=await request(f.handler,'device-detail?locationId=loc-b&phonismPhoneId=9002',{env});
  assert.equal(detail.status,200);
  assert.equal(detail.data.device.mac,'AA:BB:CC:DD:EE:FF');
  assert.equal(detail.data.device.writeEligible,true);
  assert.equal(detail.data.device.line1.extension,'4000');
});
test('untrusted origin, unverifiable source and empty allowlist fail closed',async()=>{
  const f=fixture();
  assert.equal((await request(f.handler,'locations',{origin:'https://evil.example'})).status,403);
  assert.equal((await request(f.handler,'locations',{cf:false})).status,403);
  const handler=createDeviceManagementHandler({webexFetch:async()=>json({items:[]}),checkAccess:async()=>({allowed:true}),loadIpRules:async()=>[]});
  assert.equal((await request(handler,'locations')).status,403);
});

test('POST and future mutation routes are impossible in read-only phase',async()=>{
  const f=fixture(),r=await request(f.handler,'apply',{method:'POST'});
  assert.equal(r.status,405);assert.equal(r.data.error,'read-only-phase');
  assert.equal(f.calls.length,0);
});

test('upstream error details are not leaked to browser responses',async()=>{
  const handler=createDeviceManagementHandler({
    webexFetch:async()=>json({message:'sensitive provider detail',trackingId:'secret-ish'},403),
    checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved']
  });
  const r=await request(handler,'locations');
  assert.equal(r.status,503);assert.equal(r.data.error,'webex-read-unavailable');
  assert.equal(Object.hasOwn(r.data,'message'),false);assert.equal(Object.hasOwn(r.data,'trackingId'),false);
});

test('inventory merges Phonism line registration by Webex device ID',async()=>{
  const phonismReader={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'DUFF',webexLocationId:'loc-a'}],webexIntegration:{id:'501'},truncated:false};},
    async tenantPhones(){return {phones:[{id:'9001',tenantId:'101',tenantName:'DUFF',mac:'00:11:22:33:44:55',state:'1',serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:10:00',webexDeviceIds:['webex-1'],webexDeviceId:'webex-1'}],truncated:false};},
    async lines(){return [
      {lineNumber:1,username:'sip1',alias:'Alex User',registrationStatus:'registered'},
      {lineNumber:2,username:'sip2',alias:'Open Desk',registrationStatus:'unregistered'}
    ];}
  };
  const f=fixture({phonismReader});
  const r=await request(f.handler,'inventory?locationId=loc-a',{env:{WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32)}});
  assert.equal(r.status,200);
  const d=r.data.devices[0];
  assert.equal(d.phonismMatch,'webex-device-id');
  assert.equal(d.phonismTenantName,'DUFF');
  assert.equal(d.line1.webexRegistrationStatus,'registered');
  assert.equal(d.line1.phonismRegistrationStatus,'registered');
  assert.equal(d.line2.webexRegistrationStatus,'registered');
  assert.equal(d.line2.phonismRegistrationStatus,'unregistered');
  assert.equal(d.lastProvision,'2026-10-01 12:10:00');
  assert.equal(r.data.phonism.ready,true);
});

test('capabilities reports Phonism discovery while keeping writes disabled',async()=>{
  const phonismReader={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'DUFF',webexLocationId:'loc-a'}],webexIntegration:{id:'501'},truncated:false};},
    async tenantPhones(){return {phones:[{id:'9001',webexDeviceIds:['webex-1'],webexDeviceId:'webex-1'}],truncated:false};},
    async lines(){return [{lineNumber:1,registrationStatus:'registered'}];}
  };
  const f=fixture({phonismReader});
  const r=await request(f.handler,'capabilities',{env:{WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32)}});
  assert.equal(r.status,200);
  assert.equal(r.data.phonism.ready,true);
  assert.equal(r.data.phonism.domainName,'VisionBank Iowa');
  assert.equal(r.data.phonism.registrationMonitoring,'available');
  assert.equal(r.data.writes.enabled,false);
});

test('inventory fails closed when Phonism scope is unavailable',async()=>{
  const phonismReader={
    async discover(){const e=new Error('nope');e.code='phonism-read-unavailable';throw e;}
  };
  const f=fixture({phonismReader});
  const r=await request(f.handler,'inventory?locationId=loc-a',{env:{WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32)}});
  assert.equal(r.status,503);
  assert.equal(r.data.error,'phonism-read-unavailable');
  assert.equal(r.data.readOnly,true);
});
