import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {readPhoneEnrollment,initializeFleetKeyConfig} from '../../device-management/phone-selfservice.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=1000}={}){return {keys:[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
}
const json=(body,status=200)=>Response.json(body,{status});
const FLEET='GSYzrRP442bBBMpiAjuD',MAC='80:5E:0C:EC:19:93';
const PRIMARY={id:'user-1',displayName:'Primary User',memberType:'PEOPLE',extension:'3223',location:{id:'loc-a',name:'CLIVE'},lineType:'PRIMARY',port:1};
const TARGET={id:'user-2',displayName:'Temporary User',memberType:'PEOPLE',extension:'4102',location:{id:'loc-a',name:'CLIVE'}};

function req(url){
  const request=new Request(url,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  Object.defineProperty(request,'cf',{value:{colo:'TEST'}});
  return request;
}
async function xml(handler,env,url){
  const response=await handler(req(url),env,{});
  return {status:response.status,text:await response.text()};
}

test('one fleet-template URL auto-enrolls a matching Phonism/Webex phone and offers temporary Line 2',async()=>{
  const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-05T20:00:00.000Z'});
  const webexFetch=async(_env,url,options={})=>{
    const u=new URL(url),method=options.method||'GET';
    if(u.pathname==='/v1/devices/webex-1')return json({id:'webex-1',callingDeviceId:'call-1',displayName:'Pilot T57W',product:'Yealink T57W',mac:'805E0CEC1993',connectionStatus:'connected',personId:'user-1',locationId:'loc-a',managedBy:'PARTNER',type:'phone'});
    if(u.pathname==='/v1/telephony/config/devices/call-1/members')return json({members:[PRIMARY],maxLineCount:4});
    if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[TARGET]});
    if(u.pathname==='/v1/telephony/config/numbers')return json({phoneNumbers:[]});
    return json({message:'not found'},404);
  };
  const phonismReader={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'CLIVE',webexLocationId:'loc-a'}],syncCompany:{id:'500',name:'VisionBank',type:'Enterprise'},webexIntegration:{id:'501'},truncated:false};},
    async tenantPhones(){return {phones:[{id:'313135',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink T57W'}],truncated:false};},
    async lines(){return [{lineNumber:1,username:'3223',alias:'Primary User',registrationStatus:'registered'}];},
    async syncHierarchyIntegration(){return {accepted:true,status:202};},
    async tr069Action(){return {accepted:true,status:200};}
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
  const base='https://worker.example/x/'+FLEET+'/805e0cec1993';
  const home=await xml(handler,env,base);
  assert.equal(home.status,200);
  assert.match(home.text,/VisionBank Manage Extensions/);
  assert.match(home.text,/Add temporary line/);

  const saved=await readPhoneEnrollment(env,MAC);
  assert.equal(saved.authMode,'fleet-template');
  const fleetRaw=JSON.parse(await env.LOGS.get('device-phone-fleet-keys:v1'));
  assert.ok(fleetRaw.keys[0].lastUsedAt);
  assert.equal(fleetRaw.keys[0].useCount,1);
  assert.equal(saved.device.id,'call-1');
  assert.equal(saved.location.id,'loc-a');
  assert.equal(saved.phonismPhoneId,'313135');

  const status=await xml(handler,env,base+'/s');
  assert.equal(status.status,200);
  assert.match(status.text,/Temporary Line Status/);
  const search=await xml(handler,env,base+'/q');
  assert.equal(search.status,200);
  assert.match(search.text,/Extension or phone number/);
  const duration=await xml(handler,env,base+'/d?member=user-2&q=4102&locationId=loc-a');
  assert.match(duration.text,/15 minutes/);
  assert.match(duration.text,/12 hours/);
});

test('fleet template rejects the wrong fleet key and unknown MAC before a write',async()=>{
  const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-05T20:00:00.000Z'});
  let providerCalls=0;
  const handler=createDeviceManagementHandler({
    webexFetch:async()=>{providerCalls++;return json({},404);},
    checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],
    phonismReader:{async discover(){providerCalls++;return {domain:{id:'40'},tenants:[]};}}
  });
  const wrong=await xml(handler,env,'https://worker.example/x/AAAAAAAAAAAAAAAAAAAA/805e0cec1993');
  assert.equal(wrong.status,403);
  assert.equal(providerCalls,0);
  const unknown=await xml(handler,env,'https://worker.example/x/'+FLEET+'/aabbccddeeff');
  assert.equal(unknown.status,404);
  const fleetRaw=JSON.parse(await env.LOGS.get('device-phone-fleet-keys:v1'));
  assert.equal(fleetRaw.keys[0].lastUsedAt,null);
  assert.equal(fleetRaw.keys[0].useCount,0);
});
