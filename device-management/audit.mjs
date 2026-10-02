import {DeviceManagementError} from './contracts.mjs';

const SESSION_PREFIX='device-operator:';
const AUDIT_PREFIX='device-audit:';
const SESSION_TTL_SECONDS=12*60*60;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

const clean=(value,max)=>String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);

export function validateOperator(value){
  if(!value||typeof value!=='object')throw new DeviceManagementError('operator-required');
  const name=clean(value.name,100);
  const email=clean(value.email,254).toLowerCase();
  if(name.length<2)throw new DeviceManagementError('operator-name-required');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email))throw new DeviceManagementError('operator-email-invalid');
  if(Object.keys(value).some(k=>!['name','email'].includes(k)))throw new DeviceManagementError('unknown-operator-field');
  return {name,email};
}

export function requestSource(request){
  const ip=clean(request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP')||'',64);
  const userAgent=clean(request.headers.get('User-Agent')||'',300);
  return {ip:ip||'unknown',userAgent:userAgent||'unknown'};
}

export async function createOperatorSession(env,request,value,{now=Date.now()}={}){
  if(!env?.SESSIONS?.put)throw new DeviceManagementError('operator-session-store-unavailable',503);
  const operator=validateOperator(value),sessionId=crypto.randomUUID(),source=requestSource(request);
  const startedAt=new Date(now).toISOString(),expiresAt=new Date(now+SESSION_TTL_SECONDS*1000).toISOString();
  const session={id:sessionId,operator,startedAt,expiresAt,startedFrom:source};
  await env.SESSIONS.put(SESSION_PREFIX+sessionId,JSON.stringify(session),{expirationTtl:SESSION_TTL_SECONDS});
  return session;
}

export async function readOperatorSession(env,sessionId,{now=Date.now()}={}){
  const id=String(sessionId||'').trim();
  if(!UUID.test(id)||!env?.SESSIONS?.get)return null;
  const raw=await env.SESSIONS.get(SESSION_PREFIX+id);
  if(!raw)return null;
  let session;try{session=typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
  if(!session?.operator?.name||!session?.operator?.email)return null;
  const expiry=Date.parse(session.expiresAt||'');
  if(!Number.isFinite(expiry)||expiry<=now){
    if(env.SESSIONS.delete)await env.SESSIONS.delete(SESSION_PREFIX+id);
    return null;
  }
  return session;
}

export async function requireOperatorSession(env,request){
  const session=await readOperatorSession(env,request.headers.get('X-VB-Operator-Session'));
  if(!session)throw new DeviceManagementError('operator-session-required',401);
  return session;
}

export function buildAuditRecord({eventType,action,request,session=null,systemActor=null,device={},location={},change={},webexStatus='not-run',phonismStatus='not-run',result='pending',reason='',originalAuditId=null,now=Date.now()}){
  const source=request?requestSource(request):{ip:'system',userAgent:'system'};
  const actor=systemActor?{
    type:'system',name:clean(systemActor.name||'VisionBank Device Manager – Automated',120),
    email:clean(systemActor.email||'',254),sessionId:null,
    originalOperator:systemActor.originalOperator?{
      name:clean(systemActor.originalOperator.name||'',100),
      email:clean(systemActor.originalOperator.email||'',254)
    }:null
  }:{
    type:'human',name:clean(session?.operator?.name||'',100),
    email:clean(session?.operator?.email||'',254),sessionId:clean(session?.id||'',64)
  };
  if(actor.type==='human'&&(!actor.name||!actor.email))throw new DeviceManagementError('operator-session-required',401);
  return {
    auditId:crypto.randomUUID(),
    at:new Date(now).toISOString(),
    eventType:clean(eventType||'device-change',80),
    action:clean(action||'unknown',120),
    actor,
    sourceIp:source.ip,
    userAgent:source.userAgent,
    device:{id:clean(device.id||'',160),name:clean(device.name||device.displayName||'',160),mac:clean(device.mac||'',32)},
    location:{id:clean(location.id||'',160),name:clean(location.name||'',160)},
    change,
    reason:clean(reason,500),
    webexStatus:clean(webexStatus,80),
    phonismStatus:clean(phonismStatus,80),
    result:clean(result,80),
    originalAuditId:clean(originalAuditId||'',64)||null
  };
}

export async function writeAuditRecord(env,record){
  if(!env?.LOGS?.put)throw new DeviceManagementError('device-audit-store-unavailable',503);
  const atMs=Date.parse(record.at);
  const reverse=String(9999999999999-(Number.isFinite(atMs)?atMs:Date.now())).padStart(13,'0');
  const key=AUDIT_PREFIX+reverse+':'+record.auditId;
  const metadata={
    auditId:record.auditId,at:record.at,eventType:record.eventType,action:record.action,
    operatorName:record.actor?.name||'',operatorEmail:record.actor?.email||'',actorType:record.actor?.type||'',
    sourceIp:record.sourceIp,deviceName:record.device?.name||'',locationName:record.location?.name||'',
    webexStatus:record.webexStatus,phonismStatus:record.phonismStatus,result:record.result
  };
  await env.LOGS.put(key,JSON.stringify(record),{metadata});
  return record;
}

export async function listAuditRecords(env,{limit=100}={}){
  if(!env?.LOGS?.list)throw new DeviceManagementError('device-audit-store-unavailable',503);
  const safeLimit=Math.min(Math.max(Number(limit)||100,1),100);
  const listed=await env.LOGS.list({prefix:AUDIT_PREFIX,limit:safeLimit});
  const rows=(listed.keys||[]).map(k=>k.metadata).filter(Boolean).sort((a,b)=>String(b.at||'').localeCompare(String(a.at||'')));
  return {rows,complete:listed.list_complete===true};
}

export function automatedActor(originalOperator=null){
  return {
    name:'VisionBank Device Manager – Automated',
    email:'',
    originalOperator:originalOperator?{name:clean(originalOperator.name,100),email:clean(originalOperator.email,254)}:null
  };
}
