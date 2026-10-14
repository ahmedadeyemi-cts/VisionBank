import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
test('background readiness uses save preparation but never changes a line, syncs or reboots',async()=>{
 const map=new Map(),calls=[];let background;
 const env={WEBEX_ORG_ID:'org',DEVICE_WRITE_SCOPE:'organization',LOGS:{get:async k=>map.get(k)||null,put:async(k,v)=>map.set(k,v)}};
 const handler=createDeviceManagementHandler({checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader:{discover:async()=>({domain:{id:'d'},tenants:[{id:'t',webexLocationId:'loc'}]}),tenantPhones:async()=>({phones:[{id:'p',mac:'001122334455'}]})},webexFetch:async(_,url,options)=>{
  calls.push(options.method);assert.equal(options.method,'GET');const path=new URL(url).pathname;
  if(path==='/v1/devices')return Response.json({items:[{id:'dev',callingDeviceId:'call',mac:'001122334455',orgId:'org',locationId:'loc'}]});
  if(path.endsWith('/members'))return Response.json({members:[{id:'primary',port:1,memberType:'PEOPLE'}]});
  if(path.endsWith('/availableMembers'))return Response.json({members:[{id:'target',extension:'1404',memberType:'PEOPLE',location:{id:'loc'}}]});
  return new Response(null,{status:404});
 }});
 const request=path=>{const r=new Request('https://worker.example/api/webex/device-management/'+path,{headers:{Origin:'https://visionbank-dashboard.onrender.com','CF-Connecting-IP':'198.51.100.12'}});Object.defineProperty(r,'cf',{value:{colo:'TEST'}});return r;};
 const r=await handler(request('save-readiness?deviceId=call&locationId=loc&phonismPhoneId=p&q=1404&background=1'),env,{}, {waitUntil:p=>background=p});
 assert.equal(r.status,202);const start=await r.json();await background;
 const result=await (await handler(request('save-readiness-result?id='+start.probeId),env)).json();
 assert.equal(result.ready,true,JSON.stringify(result));assert.equal(result.lookupSource,'organization-inventory');assert.ok(calls.length>0);assert.equal(map.size,1);assert.ok([...map.keys()][0].startsWith('device-save-readiness:'));
 const denied=await handler(new Request('https://worker.example/api/webex/device-management/save-readiness'),env);assert.equal(denied.status,403);
});
