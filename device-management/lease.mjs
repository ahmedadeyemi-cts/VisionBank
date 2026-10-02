import {DeviceManagementError,leaseExpiryDecision} from './contracts.mjs';

const PREFIX='device-lease:';
const clean=(value,max=200)=>String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,max);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function pilotMacs(env){
  return new Set(String(env?.DEVICE_WRITE_PILOT_MACS||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean));
}

export function deviceWriteScope(env){
  const configured=String(env?.DEVICE_WRITE_SCOPE||'').trim().toLowerCase();
  if(['organization','org','all'].includes(configured))return 'organization';
  return pilotMacs(env).size?'pilot':'disabled';
}

export function isPilotDevice(env,mac){
  const value=String(mac||'').trim().toUpperCase();
  if(!value)return false;
  if(deviceWriteScope(env)==='organization')return true;
  return pilotMacs(env).has(value);
}

export async function putLease(env,lease){
  if(!env?.LOGS?.put)throw new DeviceManagementError('device-lease-store-unavailable',503);
  if(!UUID.test(String(lease?.leaseId||'')))throw new DeviceManagementError('invalid-lease-id');
  const expires=Date.parse(lease.expiresAt||'');
  if(!Number.isFinite(expires))throw new DeviceManagementError('invalid-lease-expiry');
  const ttl=Math.max(3600,Math.ceil((expires-Date.now())/1000)+24*60*60);
  await env.LOGS.put(PREFIX+lease.leaseId,JSON.stringify(lease),{expirationTtl:ttl,metadata:{
    leaseId:lease.leaseId,status:lease.status||'active',deviceId:clean(lease.device?.id),mac:clean(lease.device?.mac,32),
    locationId:clean(lease.location?.id),locationName:clean(lease.location?.name),expiresAt:lease.expiresAt,
    operatorName:clean(lease.operator?.name,100),operatorEmail:clean(lease.operator?.email,254)
  }});
  return lease;
}

export async function getLease(env,leaseId){
  if(!UUID.test(String(leaseId||''))||!env?.LOGS?.get)return null;
  const raw=await env.LOGS.get(PREFIX+leaseId);
  if(!raw)return null;
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
}

export async function listLeases(env,{limit=200}={}){
  if(!env?.LOGS?.list)throw new DeviceManagementError('device-lease-store-unavailable',503);
  const listed=await env.LOGS.list({prefix:PREFIX,limit:Math.min(Math.max(Number(limit)||200,1),1000)});
  const leases=[];
  for(const key of listed.keys||[]){
    const lease=await getLease(env,key.name.slice(PREFIX.length));
    if(lease)leases.push(lease);
  }
  return leases.sort((a,b)=>String(a.expiresAt||'').localeCompare(String(b.expiresAt||'')));
}

export function createLease({device,location,baselineLine2,temporaryLine2,durationMinutes,operator,auditId,phonismPhoneId,phonismTenantId,phonismCompanyId,now=Date.now()}){
  const leaseId=crypto.randomUUID(),startsAt=new Date(now).toISOString(),expiresAt=new Date(now+Number(durationMinutes)*60000).toISOString();
  return {
    leaseId,status:'active',startsAt,expiresAt,durationMinutes:Number(durationMinutes),
    device:{id:device.id,name:device.displayName||device.name||'',mac:device.mac||''},
    location:{id:location.id,name:location.name||''},
    baselineLine2:baselineLine2||null,temporaryLine2:temporaryLine2||null,
    operator:{name:operator?.name||'',email:operator?.email||''},auditId:auditId||null,
    phonismPhoneId:phonismPhoneId||null,phonismTenantId:phonismTenantId||null,phonismCompanyId:phonismCompanyId||null,
    verification:{webex:'saved',phonism:'sync-queued',state:'pending-verification',lastCheckedAt:null}
  };
}

export function decideExpiry(lease,currentLine2){
  return leaseExpiryDecision({lease,currentLine2});
}
