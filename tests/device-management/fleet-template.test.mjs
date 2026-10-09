import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {readPhoneEnrollment,initializeFleetKeyConfig,upsertFleetEnrollment} from '../../device-management/phone-selfservice.mjs';

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

function req(url,model='T57W'){
  const request=new Request(url,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-'+model}});
  Object.defineProperty(request,'cf',{value:{colo:'TEST'}});
  return request;
}
async function xml(handler,env,url,model='T57W',executionContext=null){
  const response=await handler(req(url,model),env,{},executionContext);
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
    async phones(){return {phones:[{id:'313135',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink T57W'}],truncated:false};},
    async tenantPhones(){throw new Error('fleet bootstrap should use domain-wide phone inventory');},
    async lines(){return [{lineNumber:1,username:'3223',alias:'Primary User',registrationStatus:'registered'}];},
    async syncHierarchyIntegration(){return {accepted:true,status:202};},
    async tr069Action(){return {accepted:true,status:200};}
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
  const base='https://worker.example/x/'+FLEET+'/805e0cec1993';
  const home=await xml(handler,env,base);
  assert.equal(home.status,200);
  assert.match(home.text,/VisionBank Manage Extensions/);
  assert.match(home.text,/Add Temporary Extension/);
  assert.match(home.text,/Refresh/);
  assert.doesNotMatch(home.text,/Line 2:/);

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


test('Add temporary line input screen is returned without Webex or Phonism provider calls',async()=>{
  const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-06T15:00:00.000Z'});
  await upsertFleetEnrollment(env,{
    device:{id:'call-1',displayName:'Pilot T57W',mac:MAC,model:'Yealink T57W'},
    location:{id:'loc-a',name:'CLIVE'},
    phonismPhoneId:'313135',
    now:new Date().toISOString()
  });

  let providerCalls=0;
  const handler=createDeviceManagementHandler({
    webexFetch:async()=>{providerCalls++;throw new Error('webex-should-not-run');},
    checkAccess:async()=>({allowed:true}),
    loadIpRules:async()=>['approved'],
    phonismReader:{
      async discover(){providerCalls++;throw new Error('phonism-should-not-run');}
    }
  });

  const url='https://worker.example/x/'+FLEET+'/805e0cec1993/q';
  const response=await xml(handler,env,url);
  assert.equal(response.status,200);
  assert.match(response.text,/Add Temporary Extension/);
  assert.match(response.text,/Extension or phone number/);
  assert.equal(providerCalls,0);
});


test('Render fleet entry canonicalizes all handset actions to the direct Worker for every supported Yealink model',async()=>{
  for(const model of ['T53','T54W','T57W','T46U']){
    const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
    await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-09T19:00:00.000Z'});
    await upsertFleetEnrollment(env,{
      device:{id:'call-1',displayName:'Pilot '+model,mac:MAC,model:'Yealink '+model},
      location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:new Date().toISOString()
    });
    const handler=createDeviceManagementHandler({
      webexFetch:async()=>json({message:'unused'},404),
      checkAccess:async()=>({allowed:true}),
      loadIpRules:async()=>['approved'],
      phonismReader:{async discover(){throw new Error('not-needed');}}
    });
    const vanity='https://visionbank-dashboard.onrender.com/x/'+FLEET+'/805e0cec1993';
    const response=await xml(handler,env,vanity,model);
    assert.equal(response.status,200,model+' Render entry');
    assert.match(response.text,/https:\/\/visionbank-security\.ahmedadeyemi\.workers\.dev\/x\//,model+' canonicalizes actions to Worker');
    assert.doesNotMatch(response.text,/https:\/\/visionbank-dashboard\.onrender\.com\/x\//,model+' does not expose Render action URLs');
  }
});

test('direct Worker fleet entry keeps all handset actions on the direct Worker for every supported Yealink model',async()=>{
  for(const model of ['T53','T54W','T57W','T46U']){
    const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
    await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-09T19:00:00.000Z'});
    await upsertFleetEnrollment(env,{
      device:{id:'call-1',displayName:'Pilot '+model,mac:MAC,model:'Yealink '+model},
      location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:new Date().toISOString()
    });
    const handler=createDeviceManagementHandler({
      webexFetch:async()=>json({message:'unused'},404),
      checkAccess:async()=>({allowed:true}),
      loadIpRules:async()=>['approved'],
      phonismReader:{async discover(){throw new Error('not-needed');}}
    });
    const direct='https://visionbank-security.ahmedadeyemi.workers.dev/x/'+FLEET+'/805e0cec1993';
    const response=await xml(handler,env,direct,model);
    assert.equal(response.status,200,model+' Worker entry');
    assert.match(response.text,/https:\/\/visionbank-security\.ahmedadeyemi\.workers\.dev\/x\//,model+' remains on Worker');
    assert.doesNotMatch(response.text,/https:\/\/visionbank-dashboard\.onrender\.com\/x\//,model+' does not expose Render action URLs');
  }
});


test('cached fleet enrollment stays provider-independent after long idle periods',async()=>{
  const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-01T12:00:00.000Z'});
  await upsertFleetEnrollment(env,{
    device:{id:'call-1',displayName:'Idle T54W',mac:MAC,model:'Yealink T54W'},
    location:{id:'loc-a',name:'CLIVE'},
    phonismPhoneId:'313135',
    now:'2026-10-01T12:00:00.000Z'
  });

  let providerCalls=0;
  const handler=createDeviceManagementHandler({
    webexFetch:async()=>{providerCalls++;throw new Error('webex-should-not-run');},
    checkAccess:async()=>({allowed:true}),
    loadIpRules:async()=>['approved'],
    phonismReader:{async discover(){providerCalls++;throw new Error('phonism-should-not-run');}}
  });

  const response=await xml(handler,env,'https://visionbank-dashboard.onrender.com/x/'+FLEET+'/805e0cec1993','T54W');
  assert.equal(response.status,200);
  assert.match(response.text,/Add Temporary Extension/);
  assert.match(response.text,/Refresh/);
  assert.equal(providerCalls,0);
});


test('fleet Button 7 entry and Add Temporary Extension work across supported Yealink model paths',async()=>{
  const models=['T54W','T57W','T53','T46U'];

  for(const model of models){
    const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
    await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-07T19:00:00.000Z'});
    await upsertFleetEnrollment(env,{
      device:{id:'call-1',displayName:'Pilot '+model,mac:MAC,model:'Yealink '+model},
      location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:'2026-10-07T19:00:00.000Z'
    });

    let providerCalls=0;
    const handler=createDeviceManagementHandler({
      webexFetch:async()=>{providerCalls++;throw new Error('provider should not run for cached entry/input');},
      checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],
      phonismReader:{async discover(){providerCalls++;throw new Error('provider should not run for cached entry/input');}}
    });

    const vanity='https://visionbank-dashboard.onrender.com/x/'+FLEET+'/805e0cec1993';
    const home=await xml(handler,env,vanity,model);
    assert.equal(home.status,200,model+' home status');
    assert.match(home.text,/VisionBank Manage Extensions/,model+' home title');
    assert.match(home.text,/Add Temporary Extension/,model+' Add Temporary Extension');
    assert.match(home.text,/Refresh/,model+' Refresh');
    assert.ok(home.text.includes('https://visionbank-security.ahmedadeyemi.workers.dev/x/'),model+' action origin');

    const input=await xml(handler,env,'https://visionbank-security.ahmedadeyemi.workers.dev/x/'+FLEET+'/805e0cec1993/q',model);
    assert.equal(input.status,200,model+' input status');
    assert.match(input.text,/Extension or phone number/,model+' input screen');
    assert.equal(providerCalls,0,model+' cached entry/input should stay provider-independent');
  }
});



test('fleet navigation telemetry records model, action and canonical Worker origin without exposing the fleet key',async()=>{
  const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-09T19:00:00.000Z'});
  await upsertFleetEnrollment(env,{
    device:{id:'call-1',displayName:'Pilot T53',mac:MAC,model:'Yealink T53'},
    location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:'2026-10-09T19:00:00.000Z'
  });
  const handler=createDeviceManagementHandler({
    webexFetch:async()=>json({message:'unused'},404),
    checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],
    phonismReader:{async discover(){throw new Error('not-needed');}}
  });

  const base='https://visionbank-security.ahmedadeyemi.workers.dev/x/'+FLEET+'/805e0cec1993';
  const home=await xml(handler,env,base,'T53');
  assert.equal(home.status,200);
  const search=await xml(handler,env,base+'/q','T53');
  assert.equal(search.status,200);

  const rows=[...env.LOGS.map.entries()]
    .filter(([key])=>key.startsWith('device-phone-navigation:'))
    .map(([,value])=>JSON.parse(value.value))
    .sort((a,b)=>String(a.at).localeCompare(String(b.at)));

  assert.equal(rows.length,2);
  assert.deepEqual(rows.map(row=>row.action),['button7','search-open']);
  for(const row of rows){
    assert.equal(row.handsetModel,'T53');
    assert.equal(row.requestOrigin,'https://visionbank-security.ahmedadeyemi.workers.dev');
    assert.equal(row.generatedOrigin,'https://visionbank-security.ahmedadeyemi.workers.dev');
    assert.equal(row.outcome,'received');
    assert.doesNotMatch(JSON.stringify(row),new RegExp(FLEET));
  }
});

test('fleet fast Save acknowledges immediately and completes background apply across Yealink models',async()=>{
  for(const model of ['T54W','T57W','T53','T46U']){
    const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
    await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-07T19:15:00.000Z'});
    await upsertFleetEnrollment(env,{
      device:{id:'call-1',displayName:'Pilot '+model,mac:MAC,model:'Yealink '+model},
      location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:'2026-10-07T19:15:00.000Z'
    });

    const webex={members:[structuredClone(PRIMARY)],puts:[]};
    const webexFetch=async(_env,url,options={})=>{
      const u=new URL(url),method=options.method||'GET';
      if(u.pathname==='/v1/devices/webex-1')return json({id:'webex-1',callingDeviceId:'call-1',displayName:'Pilot '+model,product:'Yealink '+model,mac:'805E0CEC1993',connectionStatus:'connected',personId:'user-1',locationId:'loc-a',managedBy:'PARTNER',type:'phone'});
      if(u.pathname==='/v1/telephony/config/devices/call-1/members'){
        if(method==='GET')return json({members:structuredClone(webex.members),maxLineCount:4});
        if(method==='PUT'){const body=JSON.parse(options.body);webex.puts.push(body);webex.members=structuredClone(body.members);return new Response(null,{status:204});}
      }
      if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[TARGET]});
      if(u.pathname==='/v1/telephony/config/numbers')return json({phoneNumbers:[]});
      return json({message:'not found'},404);
    };

    const calls=[];
    const phonismReader={
      async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'CLIVE',webexLocationId:'loc-a'}],syncCompany:{id:'500',name:'VisionBank',type:'Enterprise'},webexIntegration:{id:'501'},truncated:false};},
      async tenantPhones(){return {phones:[{id:'313135',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink '+model}],truncated:false};},
      async lines(){return [{lineNumber:1,username:'3223',alias:'Primary User',registrationStatus:'registered'},{lineNumber:2,username:webex.members.find(x=>Number(x.port)===2)?.extension||'',alias:'Temporary User',registrationStatus:'not-monitored'}];},
      async syncHierarchyIntegration(){calls.push('sync');return {accepted:true,status:202};},
      async tr069Action(){calls.push('reboot');return {accepted:true,status:200};}
    };

    const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
    const base='https://visionbank-security.ahmedadeyemi.workers.dev/x/'+FLEET+'/805e0cec1993';

    const search=await xml(handler,env,base+'/q?q=4102',model);
    assert.equal(search.status,200,model+' search status');
    assert.match(search.text,/4102 - Temporary User/,model+' target result');
    assert.doesNotMatch(search.text,/visionbank-dashboard\.onrender\.com/,model+' search response never exposes Render');

    const confirm=await xml(handler,env,base+'/c?member=user-2&q=4102&locationId=loc-a&minutes=30',model);
    assert.equal(confirm.status,200,model+' confirm status');
    assert.match(confirm.text,/Save - 30 minutes/,model+' Save label');
    assert.doesNotMatch(confirm.text,/visionbank-dashboard\.onrender\.com/,model+' confirm response never exposes Render');
    const match=confirm.text.match(/intent=([0-9a-f-]{36})/i);
    assert.ok(match,model+' intent');

    let background=null;
    const executionContext={waitUntil(promise){background=promise;}};
    const applied=await xml(handler,env,base+'/p?intent='+match[1],model,executionContext);
    assert.equal(applied.status,200,model+' apply acknowledgement');
    assert.match(applied.text,/YealinkIPPhoneTextScreen/,model+' TextScreen acknowledgement');
    assert.match(applied.text,/Saving Extension/,model+' fast Save title');
    assert.match(applied.text,/Applying your extension\. Your phone will reboot automatically\. This may take up to 45 seconds\./,model+' reboot wait message');
    assert.doesNotMatch(applied.text,/<MenuItem>/,model+' no post-save menu items');
    assert.doesNotMatch(applied.text,/Return/,model+' no post-save Return prompt');
    assert.ok(background,model+' background task');
    assert.equal(webex.members.find(x=>Number(x.port)===2),undefined,model+' response precedes Webex write');

    await background;
    assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'user-2',model+' Webex background write');
    assert.deepEqual(calls,['sync','reboot'],model+' Phonism sync and reboot');
  }
});


test('background phone Save failure is persisted with the exact failing stage',async()=>{
  const model='T53';
  const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-07T21:30:00.000Z'});
  await upsertFleetEnrollment(env,{
    device:{id:'call-1',displayName:'Diagnostic '+model,mac:MAC,model:'Yealink '+model},
    location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'313135',now:'2026-10-07T21:30:00.000Z'
  });

  let failResolve=false;
  const webexFetch=async(_env,url)=>{
    const u=new URL(url);
    if(u.pathname==='/v1/telephony/config/devices/call-1/members')return json({members:[PRIMARY],maxLineCount:4});
    if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[TARGET]});
    if(u.pathname==='/v1/telephony/config/numbers')return json({phoneNumbers:[]});
    return json({message:'not found'},404);
  };
  const phonismReader={
    async discover(){
      if(failResolve)throw new Error('diagnostic-phonism-failure');
      return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'CLIVE',webexLocationId:'loc-a'}],syncCompany:{id:'500',name:'VisionBank'},webexIntegration:{id:'501'},truncated:false};
    },
    async tenantPhones(){return {phones:[{id:'313135',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink '+model}],truncated:false};}
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
  const base='https://visionbank-security.ahmedadeyemi.workers.dev/x/'+FLEET+'/805e0cec1993';

  const confirm=await xml(handler,env,base+'/c?member=user-2&q=4102&locationId=loc-a&minutes=30',model);
  assert.equal(confirm.status,200);
  const match=confirm.text.match(/intent=([0-9a-f-]{36})/i);
  assert.ok(match);

  failResolve=true;
  let background=null;
  const executionContext={waitUntil(promise){background=promise;}};
  const applied=await xml(handler,env,base+'/p?intent='+match[1],model,executionContext);
  assert.equal(applied.status,200);
  assert.match(applied.text,/Saving Extension/);
  await background;

  const auditRows=[...env.LOGS.map.entries()]
    .filter(([key])=>key.startsWith('device-audit:'))
    .map(([,value])=>JSON.parse(value.value));
  const failure=auditRows.find(row=>row.eventType==='phone-selfservice-failure');
  assert.ok(failure);
  assert.equal(failure.action,'save');
  assert.equal(failure.change.stage,'resolve-write-context');
  assert.equal(failure.change.requestedExtension,'4102');
  assert.match(failure.reason,/resolve-write-context: diagnostic-phonism-failure/);
  assert.equal(failure.result,'failed');
});


test('first Button 7 press auto-enrolls supported Yealink models by MAC with no per-user backend setup',async()=>{
  for(const model of ['T53','T54W','T57W','T46U']){
    const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
    await initializeFleetKeyConfig(env,{key:FLEET,actor:'test-admin',generatedAt:'2026-10-07T21:45:00.000Z'});

    const webexFetch=async(_env,url)=>{
      const u=new URL(url);
      if(u.pathname==='/v1/devices/webex-1')return json({
        id:'webex-1',callingDeviceId:'call-1',displayName:'Auto '+model,product:'Yealink '+model,
        mac:'805E0CEC1993',connectionStatus:'connected',personId:'user-1',locationId:'loc-a',
        managedBy:'PARTNER',type:'phone'
      });
      if(u.pathname==='/v1/telephony/config/devices/call-1/members')return json({members:[PRIMARY],maxLineCount:4});
      return json({message:'not found'},404);
    };

    const phonismReader={
      async discover(){return {
        domain:{id:'40',name:'VisionBank Iowa'},
        tenants:[{id:'101',name:'CLIVE',webexLocationId:'loc-a'}],
        syncCompany:{id:'500',name:'VisionBank',type:'Enterprise'},
        webexIntegration:{id:'501'},truncated:false
      };},
      async phones(){return {phones:[{
        id:'313135',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',
        serviceState:['tr069'],tr069:true,webexDeviceIds:['webex-1'],
        webexDeviceId:'webex-1',webexDeviceType:'Yealink '+model
      }],truncated:false};},
      async tenantPhones(){throw new Error('first fleet enrollment should use domain-wide inventory');},
      async lines(){return [{lineNumber:1,username:'3223',alias:'Primary User',registrationStatus:'registered'}];}
    };

    const handler=createDeviceManagementHandler({
      webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader
    });

    const response=await xml(
      handler,env,
      'https://visionbank-dashboard.onrender.com/x/'+FLEET+'/805e0cec1993',
      model
    );
    assert.equal(response.status,200,model+' first Button 7 status');
    assert.match(response.text,/VisionBank Manage Extensions/,model+' first Button 7 menu');
    assert.match(response.text,/Add Temporary Extension/,model+' Add Temporary Extension');

    const saved=await readPhoneEnrollment(env,MAC);
    assert.ok(saved,model+' enrollment persisted');
    assert.equal(saved.authMode,'fleet-template',model+' fleet auth mode');
    assert.equal(saved.device.id,'call-1',model+' Webex calling device');
    assert.equal(saved.phonismPhoneId,'313135',model+' Phonism phone');
    assert.match(saved.device.model,new RegExp(model),model+' model retained');
  }
});
