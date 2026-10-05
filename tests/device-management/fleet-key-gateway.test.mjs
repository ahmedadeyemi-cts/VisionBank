import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {initializeFleetKeyConfig} from '../../device-management/phone-selfservice.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=1000}={}){return {keys:[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
}
const FLEET='GSYzrRP442bBBMpiAjuD';
function request(path,{token=null,method='GET',body=null}={}){
  const headers={Origin:'https://visionbank-dashboard.onrender.com','CF-Connecting-IP':'203.0.113.44'};
  if(token)headers.Authorization='Bearer '+token;
  if(body!==null)headers['Content-Type']='application/json';
  const req=new Request('https://worker.example/api/webex/device-management/'+path,{method,headers,...(body!==null?{body:JSON.stringify(body)}:{})});
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  return req;
}
function handler(){
  return createDeviceManagementHandler({
    webexFetch:async()=>Response.json({}, {status:503}),
    checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],
    phonismReader:{}
  });
}

test('fleet key admin endpoints require an authorized Device Manager admin session',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV(),ADMIN:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:FLEET,actor:'seed',generatedAt:'2026-10-05T20:00:00.000Z'});
  const h=handler();

  const denied=await h(request('admin-settings/fleet-keys'),env,{});
  assert.equal(denied.status,403);

  const token='security-session-fleet';
  await env.SESSIONS.put(token,JSON.stringify({username:'ahmed.adeyemi@ussignal.com',role:'superadmin',expires:Date.now()+3600000}));
  await env.ADMIN.put('ahmed.adeyemi@ussignal.com',JSON.stringify({username:'ahmed.adeyemi@ussignal.com',email:'ahmed.adeyemi@ussignal.com',role:'superadmin'}));
  const allowed=await h(request('admin-settings/fleet-keys',{token}),env,{});
  assert.equal(allowed.status,200);
  const before=await allowed.json();
  assert.equal(before.active.key,FLEET);
  assert.match(before.templateUrl,/\/x\/GSYzrRP442bBBMpiAjuD\/\{\{mac_address\}\}$/);

  const rotated=await h(request('admin-settings/fleet-keys/rotate',{token,method:'POST',body:{confirm:true,expectedActiveKeyId:before.activeKeyId}}),env,{});
  assert.equal(rotated.status,201);
  const after=await rotated.json();
  assert.notEqual(after.active.key,FLEET);
  assert.equal(after.keys.some(row=>row.key===FLEET&&row.status==='retiring'),true);
});
