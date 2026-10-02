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
    }]:[],truncated:false};},
    async phone(_env,phoneId,tenant){return {
      id:String(phoneId),tenantId:String(tenant?.id||'101'),tenantName:tenant?.name||'DUFF',mac:'00:11:22:33:44:55',state:'1',
      serviceState:['tr069'],tr069:true,lastProvision:'2026-10-01 12:10:00',
      webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Partner Managed Phone - Yealink'
    };},
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
    if(u.pathname==='/v1/telephony/config/devices/call-1')return json({location:{id:'loc-a',name:'Dallas'},status:'registered'});
    if(u.pathname==='/v1/telephony/config/devices/call-1/members')return json({members:[
      {id:'user-1',displayName:'Alex User',memberType:'PEOPLE',extension:'4101',location:{id:'loc-a',name:'Dallas'},lineType:'PRIMARY',port:1},
      {id:'space-1',displayName:'Open Desk',memberType:'PLACE',extension:'4190',location:{id:'loc-a',name:'Dallas'},lineType:'SHARED_CALL_APPEARANCE',port:2}
    ]});
    if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[
      {id:'user-2',displayName:'Taylor User',memberType:'PEOPLE',extension:'4102',location:{id:'loc-a',name:'Dallas'}},
      {id:'user-x',displayName:'Wrong Location',memberType:'PEOPLE',extension:'5102',location:{id:'loc-b',name:'Austin'}}
    ]});
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

test('available members are backend-filtered to the device location',async()=>{
  const f=fixture(),r=await request(f.handler,'members?deviceId=call-1&locationId=loc-a');
  assert.equal(r.status,200);assert.deepEqual(r.data.members.map(x=>x.id),['user-2']);
  assert.equal(r.data.members[0].locationId,'loc-a');
});

test('capabilities reports scoped Webex and Phonism reads while leaving writes disabled',async()=>{
  const f=fixture(),r=await request(f.handler,'capabilities');
  assert.equal(r.status,200);assert.equal(r.data.webex.ready,true);
  assert.equal(r.data.webex.memberRead,'available');
  assert.equal(r.data.webex.deviceScope,'phonism-visionbank-iowa');
  assert.equal(r.data.phonism.ready,true);
  assert.equal(r.data.writes.enabled,false);
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
