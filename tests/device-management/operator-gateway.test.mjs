import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {buildAuditRecord,writeAuditRecord} from '../../device-management/audit.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=100}={}){
    const keys=[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).sort(([a],[b])=>a.localeCompare(b)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata}));
    return {keys,list_complete:true};
  }
}

const ORIGIN='https://visionbank-dashboard.onrender.com';
const IP='198.51.100.12';
const env={WEBEX_ORG_ID:'org-1',SESSIONS:new MemoryKV(),LOGS:new MemoryKV(),ADMIN:new MemoryKV()};
env.LOGS.map.set('device-identity:config:v1',{value:JSON.stringify({verificationEnabled:false,admins:['ahmed.adeyemi@ussignal.com']}),metadata:null});

const handler=createDeviceManagementHandler({
  webexFetch:async()=>Response.json({items:[]}),
  checkAccess:async()=>({allowed:true}),
  loadIpRules:async()=>['198.51.100.0/24'],
  phonismReader:{}
});

async function request(path,{method='GET',body,sessionId,authorization}={}){
  const headers=new Headers({Origin:ORIGIN,'CF-Connecting-IP':IP,'User-Agent':'Operator Gateway Test'});
  if(body!==undefined)headers.set('Content-Type','application/json');
  if(sessionId)headers.set('X-VB-Operator-Session',sessionId);
  if(authorization)headers.set('Authorization',authorization);
  const req=new Request('https://worker.example/api/webex/device-management/'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  const res=await handler(req,env,{'Access-Control-Allow-Origin':ORIGIN});
  return {status:res.status,data:await res.json()};
}

test('operator-session POST creates a validated server session',async()=>{
  const r=await request('operator-session',{method:'POST',body:{name:'Ahmed Adeyemi',email:'ahmed@example.com'}});
  assert.equal(r.status,201);
  assert.equal(r.data.operator.name,'Ahmed Adeyemi');
  assert.equal(r.data.operator.email,'ahmed@example.com');
  assert.match(r.data.sessionId,/^[0-9a-f-]{36}$/i);
  assert.ok(env.SESSIONS.map.has('device-operator:'+r.data.sessionId));
});

test('operator-session GET validates the current session header',async()=>{
  const created=await request('operator-session',{method:'POST',body:{name:'Test Operator',email:'operator@example.com'}});
  const r=await request('operator-session',{sessionId:created.data.sessionId});
  assert.equal(r.status,200);
  assert.equal(r.data.operator.name,'Test Operator');
});

test('operator-session logout revokes the server-side Device Manager session',async()=>{
  const created=await request('operator-session',{method:'POST',body:{name:'Logout Operator',email:'logout@example.com'}});
  assert.equal(created.status,201);
  const loggedOut=await request('operator-session/logout',{method:'POST',body:{},sessionId:created.data.sessionId});
  assert.equal(loggedOut.status,200);
  const after=await request('operator-session',{sessionId:created.data.sessionId});
  assert.equal(after.status,401);
  assert.equal(after.data.error,'operator-session-required');
});

test('operator-session GET rejects missing sessions',async()=>{
  const r=await request('operator-session');
  assert.equal(r.status,401);
  assert.equal(r.data.error,'operator-session-required');
});

test('operator-session POST fails closed when email verification is enabled',async()=>{
  const localEnv={WEBEX_ORG_ID:'org-1',SESSIONS:new MemoryKV(),LOGS:new MemoryKV(),ADMIN:new MemoryKV()};
  const localHandler=createDeviceManagementHandler({
    webexFetch:async()=>Response.json({items:[]}),
    checkAccess:async()=>({allowed:true}),
    loadIpRules:async()=>['198.51.100.0/24'],
    phonismReader:{}
  });
  const headers=new Headers({Origin:ORIGIN,'CF-Connecting-IP':IP,'User-Agent':'Verification Required Test','Content-Type':'application/json'});
  const req=new Request('https://worker.example/api/webex/device-management/operator-session',{method:'POST',headers,body:JSON.stringify({name:'Test Operator',email:'operator@visionbank.com'})});
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  const res=await localHandler(req,localEnv,{'Access-Control-Allow-Origin':ORIGIN});
  const data=await res.json();
  assert.equal(res.status,403);
  assert.equal(data.error,'operator-verification-required');
});

test('history returns server-stored operator and IP metadata newest first',async()=>{
  const older=buildAuditRecord({
    eventType:'temporary-line-change',action:'save-sync',
    request:new Request('https://x',{headers:{'CF-Connecting-IP':'203.0.113.10','User-Agent':'Test'}}),
    session:{id:'11111111-1111-4111-8111-111111111111',operator:{name:'Older Operator',email:'older@example.com'}},
    device:{name:'Phone A'},location:{name:'DUFF'},result:'completed',now:Date.parse('2026-10-02T12:00:00Z')
  });
  const newer=buildAuditRecord({
    eventType:'temporary-line-change',action:'save-sync',
    request:new Request('https://x',{headers:{'CF-Connecting-IP':'203.0.113.20','User-Agent':'Test'}}),
    session:{id:'22222222-2222-4222-8222-222222222222',operator:{name:'Newer Operator',email:'newer@example.com'}},
    device:{name:'Phone B'},location:{name:'CLIVE'},result:'completed',now:Date.parse('2026-10-02T13:00:00Z')
  });
  await writeAuditRecord(env,older);
  await writeAuditRecord(env,newer);
  const r=await request('history?limit=100');
  assert.equal(r.status,200);
  assert.equal(r.data.rows[0].operatorName,'Newer Operator');
  assert.equal(r.data.rows[0].sourceIp,'203.0.113.20');
  assert.equal(r.data.rows[1].operatorName,'Older Operator');
});
