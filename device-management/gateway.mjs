import {DeviceManagementError,normalizeMac,normalizeOwnerType,normalizeRegistration} from './contracts.mjs';
import {createPhonismReader} from './phonism.mjs';
import {createOperatorSession,readOperatorSession,requireOperatorSession,listAuditRecords} from './audit.mjs';
import {isPilotDevice,listLeases,deviceWriteScope} from './lease.mjs';
import {createWritePreview,applyWritePreview,verifyLease,runRecoveryAction,readWebexMembers} from './write.mjs';

const ORIGINS=new Set(['https://visionbank-dashboard.onrender.com','https://ahmedadeyemi-cts.github.io']);
const PREFIX='/api/webex/device-management/';
const WEBEX='https://webexapis.com/v1';

const output=(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{...headers,'Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin'}});
const bounded=async(operation,ms=15000)=>{let timer;try{return await Promise.race([operation,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DeviceManagementError('upstream-timeout',503)),ms);})]);}finally{clearTimeout(timer);}};

function validIp(ip){
  if(typeof ip!=='string'||ip.length>45||! /^[\da-f:.]+$/i.test(ip))return false;
  if(ip.includes(':')){try{return new URL('http://['+ip+']/').hostname.length>2;}catch{return false;}}
  const parts=ip.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255);
}

async function readSmallJson(request,maxBytes=2048){
  const type=request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
  if(type!=='application/json')throw new DeviceManagementError('json-required',415);
  const length=Number(request.headers.get('Content-Length')||0);
  if(Number.isFinite(length)&&length>maxBytes)throw new DeviceManagementError('body-too-large',413);
  const text=await request.text();
  if(new TextEncoder().encode(text).byteLength>maxBytes)throw new DeviceManagementError('body-too-large',413);
  try{return JSON.parse(text);}catch{throw new DeviceManagementError('invalid-json');}
}

async function responseJson(response){
  let data={};try{data=await response.json();}catch{}
  if(!response.ok){const error=new DeviceManagementError('webex-read-unavailable',response.status===401||response.status===403?503:502);error.upstreamStatus=response.status;throw error;}
  return data;
}

function nextLink(response){
  const link=response.headers.get('Link')||'';
  const match=link.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
  return match?.[1]||null;
}
async function readPaged(webexFetch,env,url,keys,maxPages=20,maxRows=2000){
  const rows=[];let next=url,pages=0;
  while(next&&pages<maxPages&&rows.length<maxRows){
    const response=await bounded(webexFetch(env,next,{method:'GET'}));
    const data=await responseJson(response);
    const collection=keys.map(k=>data?.[k]).find(Array.isArray)||[];
    rows.push(...collection.slice(0,maxRows-rows.length));
    next=nextLink(response);pages++;
  }
  return {rows,pages,truncated:Boolean(next)||rows.length>=maxRows};
}

function id(value){return typeof value==='string'&&value.trim()?value.trim():null;}
function display(value,max=160){return String(value??'').trim().slice(0,max);}
function macOrNull(value){try{return value?normalizeMac(value):null;}catch{return null;}}
function locationOf(value){
  const raw=value?.location||value?.locationInfo||{};
  return {id:id(raw.id||value?.locationId),name:display(raw.name||value?.locationName||'',120)};
}
function ownerType(value){
  const raw=value?.memberType||value?.type||value?.ownerType;
  try{return normalizeOwnerType(raw);}catch{return null;}
}
function memberRow(value){
  const location=locationOf(value),type=ownerType(value),extension=display(value?.extension||'',32);
  const rawName=display(value?.displayName||value?.name||[value?.firstName,value?.lastName].filter(Boolean).join(' '),160);
  const name=rawName||(type==='PLACE'?(extension?'Workspace '+extension:'Workspace'):(extension?'Extension '+extension:'Member'));
  return {id:id(value?.id||value?.memberId||value?.personId||value?.workspaceId),
    name,type,extension,phoneNumber:display(value?.phoneNumber||value?.number||'',64),
    locationId:location.id,locationName:location.name,lineType:display(value?.lineType||'',40),port:Number.isSafeInteger(value?.port)?value.port:null,
    registrationStatus:normalizeRegistration(value?.registrationStatus||value?.status)};
}

function memberSearchText(member){
  return [member?.name,member?.extension,member?.phoneNumber,member?.locationName,member?.locationId,member?.type==='PLACE'?'workspace':'user']
    .filter(Boolean).join(' ').toLowerCase();
}

function memberResultLimit(value){
  const parsed=Number.parseInt(String(value||''),10);
  return Number.isFinite(parsed)&&parsed>0?Math.min(parsed,100):50;
}

function availableMembersUrl(deviceId,org,filters={}){
  const params=new URLSearchParams({orgId:String(org),usageType:'SHARED_LINE'});
  for(const [key,value] of Object.entries(filters)){
    const cleanValue=display(value||'',160);
    if(cleanValue)params.set(key,cleanValue);
  }
  return WEBEX+'/telephony/config/devices/'+encodeURIComponent(deviceId)+'/availableMembers?'+params.toString();
}

async function searchEligibleMembers({webexFetch,env,org,deviceId,query='',locationId=null}) {
  const q=display(query||'',160);
  const baseFilters=locationId?{locationId}:{};
  const urls=[availableMembersUrl(deviceId,org,baseFilters)];
  if(q){
    urls.push(availableMembersUrl(deviceId,org,{...baseFilters,memberName:q}));
    urls.push(availableMembersUrl(deviceId,org,{...baseFilters,extension:q}));
    urls.push(availableMembersUrl(deviceId,org,{...baseFilters,phoneNumber:q}));
  }
  const attempts=await Promise.all(urls.map(async endpoint=>{
    try{return {...await readPaged(webexFetch,env,endpoint,['members','items'],6,600),error:null};}
    catch(error){return {rows:[],truncated:false,error};}
  }));
  if(attempts.every(x=>x.error))throw attempts.find(x=>x.error).error;
  const unique=new Map();
  for(const attempt of attempts)for(const raw of attempt.rows){
    const row=memberRow(raw);
    if(row.id&&row.type&&row.locationId&&!unique.has(String(row.id)))unique.set(String(row.id),row);
  }
  const members=[...unique.values()].filter(m=>!q||memberSearchText(m).includes(q.toLowerCase()));
  return {members,truncated:attempts.some(x=>x.truncated)};
}

function numberOwnerRow(value){
  const owner=value?.owner||{},location=locationOf({location:value?.location});
  const type=ownerType({memberType:owner.type||owner.ownerType});
  const extension=display(value?.extension||owner?.extension||'',32);
  const rawName=display(owner?.displayName||owner?.name||[owner?.firstName,owner?.lastName].filter(Boolean).join(' '),160);
  const name=rawName||(type==='PLACE'?(extension?'Workspace '+extension:'Workspace'):(extension?'Extension '+extension:'Member'));
  return {
    id:id(owner?.id),name,type,extension,phoneNumber:display(value?.phoneNumber||owner?.phoneNumber||'',64),
    locationId:location.id,locationName:location.name,available:false,availability:'unavailable',
    unavailableReason:'webex-not-available',appearances:[]
  };
}

function numberFallbackEndpoints(org,query){
  const clean=display(query,160);
  if(!clean)return [];
  const base=WEBEX+'/telephony/config/numbers?orgId='+encodeURIComponent(org)+'&max=50';
  const urls=[base+'&ownerName='+encodeURIComponent(clean)];
  if(/[0-9]/.test(clean))urls.push(base+'&extension='+encodeURIComponent(clean));
  if(/^\+?[\d\s().-]{7,}$/.test(clean))urls.push(base+'&phoneNumber='+encodeURIComponent(clean));
  return [...new Set(urls)];
}

async function findUnavailableMemberMatches({env,org,webexFetch,phonismReader,deviceId,query,eligibleIds,limit=5}){
  if(!query||String(query).trim().length<3)return [];
  const pages=await Promise.all(numberFallbackEndpoints(org,query).map(async endpoint=>{
    try{return (await readPaged(webexFetch,env,endpoint,['phoneNumbers'],2,100)).rows;}catch{return [];}
  }));
  const unique=new Map();
  for(const raw of pages.flat()){
    const row=numberOwnerRow(raw);
    if(!row.id||!row.type||!row.locationId||eligibleIds.has(String(row.id)))continue;
    if(!memberSearchText(row).includes(String(query).toLowerCase()))continue;
    unique.set(String(row.id),row);
  }
  const candidates=[...unique.values()].slice(0,Math.min(Math.max(Number(limit)||5,1),5));
  return mapLimit(candidates,3,async row=>{
    const lookup=row.extension||row.phoneNumber||row.name;
    const eligible=lookup?await searchEligibleMembers({
      webexFetch,env,org,deviceId,query:lookup,locationId:row.locationId
    }).catch(()=>({members:[]})): {members:[]};
    const recovered=eligible.members.find(m=>String(m.id)===String(row.id));
    if(recovered)return {...recovered,available:true,availability:'available',recoveredBy:'location-filter'};
    const appearances=await findMemberAppearances({
      env,org,webexFetch,phonismReader,locationId:row.locationId,targetMemberId:row.id,excludeDeviceId:deviceId
    }).catch(()=>[]);
    return {...row,appearances,
      unavailableReason:appearances.length?'webex-not-available-existing-appearance':'webex-not-available'};
  });
}

function deviceBase(value){
  return {webexDeviceId:id(value?.id),callingDeviceId:id(value?.callingDeviceId),displayName:display(value?.displayName||value?.name||value?.model,160),
    model:display(value?.model||value?.product||value?.type,120),mac:macOrNull(value?.mac||value?.macAddress),
    connectionStatus:display(value?.connectionStatus||value?.status||'',60),personId:id(value?.personId),workspaceId:id(value?.workspaceId)};
}
async function readCallingDevice(webexFetch,env,org,base){
  if(!base.callingDeviceId)return {...base,id:base.webexDeviceId,locationId:null,locationName:'',owner:null,line1:null,line2:null,syncStatus:'unknown',syncStatusLabel:'Calling ID unavailable'};
  const q='?orgId='+encodeURIComponent(org);
  let detail={},members=[];
  try{detail=await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(base.callingDeviceId)+q,{method:'GET'})));}catch(error){detail={_error:error.code};}
  try{const data=await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(base.callingDeviceId)+'/members'+q,{method:'GET'})));members=(data.members||data.items||[]).map(memberRow).filter(m=>m.id);}catch(error){members=[];detail._membersError=error.code;}
  members.sort((a,b)=>(a.port??99)-(b.port??99));
  const primary=members.find(m=>m.lineType.toUpperCase()==='PRIMARY'||m.port===1)||members[0]||null;
  const second=members.find(m=>m!==primary&&(m.port===2||m.lineType.toUpperCase()!=='PRIMARY'))||null;
  const loc=locationOf(detail);const locationId=loc.id||primary?.locationId||null,locationName=loc.name||primary?.locationName||'';
  const owner=primary?{id:primary.id,name:primary.name,type:primary.type,extension:primary.extension,phoneNumber:primary.phoneNumber}:base.personId?{id:base.personId,name:'',type:'PEOPLE'}:base.workspaceId?{id:base.workspaceId,name:'',type:'PLACE'}:null;
  const overall=normalizeRegistration(detail?.registrationStatus||detail?.status||base.connectionStatus);
  const line=x=>x?{id:x.id,memberId:x.id,name:x.name,type:x.type,extension:x.extension,phoneNumber:x.phoneNumber,
    locationId:x.locationId,locationName:x.locationName,registrationStatus:x.registrationStatus==='unknown'?overall:x.registrationStatus,port:x.port}:null;
  return {...base,id:base.callingDeviceId,locationId,locationName,owner,line1:line(primary),line2:line(second),
    syncStatus:detail._error||detail._membersError?'attention':'in-sync',syncStatusLabel:detail._error?'Device details limited':detail._membersError?'Line membership unavailable':'Read-only Webex data',syncMessage:detail._error||detail._membersError||'',lastProvision:'Not reported',phonismStatus:'Not connected'};
}

async function mapLimit(rows,limit,fn){
  const out=new Array(rows.length);let cursor=0;
  async function worker(){while(true){const i=cursor++;if(i>=rows.length)return;out[i]=await fn(rows[i],i);}}
  await Promise.all(Array.from({length:Math.min(limit,rows.length||1)},worker));return out;
}

function phonismMatch(device,phones,tenants=[]){
  const tenantById=new Map(tenants.map(t=>[String(t.id),t]));
  const candidates=phones.filter(p=>{
    const tenant=tenantById.get(String(p.tenantId||''));
    return !device.locationId||!tenant?.webexLocationId||String(tenant.webexLocationId)===String(device.locationId);
  });
  const byWebex=candidates.filter(p=>p.webexDeviceId&&[device.webexDeviceId,device.callingDeviceId].includes(p.webexDeviceId));
  if(byWebex.length===1)return {phone:byWebex[0],method:'webex-device-id'};
  const byMac=candidates.filter(p=>p.mac&&device.mac&&p.mac===device.mac);
  if(byMac.length===1)return {phone:byMac[0],method:'mac'};
  return {phone:null,method:byWebex.length>1||byMac.length>1?'ambiguous':'unmatched'};
}

function mergeLine(webexLine,phonismLine){
  if(!webexLine&&!phonismLine)return null;
  return {
    ...(webexLine||{id:null,memberId:null,name:phonismLine?.alias||'Phonism line',type:null,extension:'',phoneNumber:'',port:phonismLine?.lineNumber||null}),
    registrationStatus:webexLine?.registrationStatus||'unknown',
    webexRegistrationStatus:webexLine?.registrationStatus||'unknown',
    phonismRegistrationStatus:phonismLine?.registrationStatus||'unknown',
    phonismLineNumber:phonismLine?.lineNumber||null,
    phonismUsername:phonismLine?.username||'',
    phonismAlias:phonismLine?.alias||''
  };
}

async function mergePhonismInventory(env,org,devices,phonismReader){
  let discovery,phoneInventory;
  try{
    discovery=await phonismReader.discover(env,org);
    phoneInventory=await phonismReader.phones(env,discovery.domain.id,discovery.tenants);
  }catch(error){
    return {devices:devices.map(d=>({...d,line1:mergeLine(d.line1,null),line2:mergeLine(d.line2,null),
      phonismStatus:'Unavailable',phonismMatch:'unavailable',syncStatus:'attention',syncStatusLabel:'Phonism unavailable',
      syncMessage:error?.code||'phonism-read-unavailable'})),phonism:{ready:false,error:error?.code||'phonism-read-unavailable'}};
  }
  const merged=await mapLimit(devices,4,async device=>{
    const match=phonismMatch(device,phoneInventory.phones,discovery.tenants);
    if(!match.phone)return {...device,line1:mergeLine(device.line1,null),line2:mergeLine(device.line2,null),
      phonismStatus:'Not matched',phonismMatch:match.method,syncStatus:'attention',syncStatusLabel:'Phonism device not matched',syncMessage:'No unique Webex device ID or MAC match'};
    let lines=[];try{lines=await phonismReader.lines(env,match.phone.id);}catch{}
    const line1=lines.find(x=>x.lineNumber===1)||null,line2=lines.find(x=>x.lineNumber===2)||null;
    const services=match.phone.serviceState||[];
    return {...device,
      line1:mergeLine(device.line1,line1),line2:mergeLine(device.line2,line2),
      phonismPhoneId:match.phone.id,phonismTenantId:match.phone.tenantId,phonismTenantName:match.phone.tenantName,
      phonismMatch:match.method,phonismStatus:[match.phone.state?'State '+match.phone.state:null,match.phone.tr069?'TR69':null].filter(Boolean).join(' · ')||'Linked',
      phonismServiceState:services,lastProvision:match.phone.lastProvision||'Not reported',
      syncStatus:'linked',syncStatusLabel:'Webex ↔ Phonism linked',syncMessage:match.method==='mac'?'Matched by MAC':'Matched by Webex device ID'};
  });
  return {devices:merged,phonism:{ready:true,domainName:discovery.domain.name,
    tenantCount:discovery.tenants.length,webexIntegrationAvailable:Boolean(discovery.webexIntegration),
    phoneCount:phoneInventory.phones.length,truncated:discovery.truncated||phoneInventory.truncated}};
}

async function firstWebexDeviceForPhone(webexFetch,env,phone){
  const ids=[...(phone.webexDeviceIds||[]),phone.webexDeviceId].filter(Boolean);
  for(const value of [...new Set(ids)]){
    try{
      const response=await bounded(webexFetch(env,WEBEX+'/devices/'+encodeURIComponent(value),{method:'GET'}),12000);
      if(!response.ok)continue;
      const data=await responseJson(response);
      return {data,matchedId:value};
    }catch{}
  }
  return null;
}

async function scopedPhoneRow(webexFetch,env,org,tenant,phone,phonismReader){
  let phonismLines=[];
  try{phonismLines=await phonismReader.lines(env,phone.id);}catch{}
  const p1=phonismLines.find(x=>x.lineNumber===1)||null,p2=phonismLines.find(x=>x.lineNumber===2)||null;

  const found=await firstWebexDeviceForPhone(webexFetch,env,phone);
  if(!found){
    const line=x=>x?mergeLine(null,x):null;
    return {
      id:'phonism:'+phone.id,webexDeviceId:null,callingDeviceId:null,
      displayName:phone.alias||p1?.alias||'Partner-managed phone',
      model:phone.webexDeviceType||'Partner-managed phone',mac:phone.mac,
      locationId:tenant.webexLocationId||null,locationName:tenant.name||'',
      owner:p1?{id:null,name:p1.alias||p1.username||'Assigned line',type:null,extension:p1.username||'',phoneNumber:''}:null,
      line1:line(p1),line2:line(p2),
      phonismPhoneId:phone.id,phonismTenantId:tenant.id,phonismTenantName:tenant.name,
      phonismMatch:'phonism-only',phonismStatus:[phone.state==='1'?'Ready':phone.state?'State '+phone.state:null,phone.tr069?'TR69':null].filter(Boolean).join(' · ')||'Linked',
      phonismServiceState:phone.serviceState||[],lastProvision:phone.lastProvision||'Not reported',
      syncStatus:'attention',syncStatusLabel:'Webex device lookup unavailable',syncMessage:'Phonism inventory loaded; Webex enrichment unavailable'
    };
  }

  const base=deviceBase(found.data);
  let members=[];
  if(base.callingDeviceId){
    try{
      const data=await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(base.callingDeviceId)+'/members?orgId='+encodeURIComponent(org),{method:'GET'}),12000));
      members=(data.members||data.items||[]).map(memberRow).filter(m=>m.id);
    }catch{}
  }
  members.sort((a,b)=>(a.port??99)-(b.port??99));
  const primary=members.find(m=>m.lineType.toUpperCase()==='PRIMARY'||m.port===1)||members[0]||null;
  const second=members.find(m=>m!==primary&&(m.port===2||m.lineType.toUpperCase()!=='PRIMARY'))||null;
  const overall=normalizeRegistration(base.connectionStatus);
  const webexLine=x=>x?{id:x.id,memberId:x.id,name:x.name,type:x.type,extension:x.extension,phoneNumber:x.phoneNumber,
    locationId:x.locationId,locationName:x.locationName,registrationStatus:x.registrationStatus==='unknown'?overall:x.registrationStatus,port:x.port}:null;
  const w1=webexLine(primary),w2=webexLine(second);
  const owner=primary?{id:primary.id,name:primary.name,type:primary.type,extension:primary.extension,phoneNumber:primary.phoneNumber}:
    p1?{id:null,name:p1.alias||p1.username||phone.alias||'Assigned line',type:null,extension:p1.username||'',phoneNumber:''}:null;
  return {
    ...base,id:base.callingDeviceId||base.webexDeviceId||('phonism:'+phone.id),
    mac:phone.mac||base.mac,locationId:tenant.webexLocationId||found.data?.locationId||null,locationName:tenant.name||'',
    owner,line1:mergeLine(w1,p1),line2:mergeLine(w2,p2),
    phonismPhoneId:phone.id,phonismTenantId:tenant.id,phonismTenantName:tenant.name,
    phonismMatch:'webex-device-id',phonismStatus:[phone.state==='1'?'Ready':phone.state?'State '+phone.state:null,phone.tr069?'TR69':null].filter(Boolean).join(' · ')||'Linked',
    phonismServiceState:phone.serviceState||[],lastProvision:phone.lastProvision||'Not reported',
    syncStatus:'linked',syncStatusLabel:'Webex ↔ Phonism linked',syncMessage:'Scoped through VisionBank Iowa Phonism metadata'
  };
}

function summaryPhoneRow(phone,tenant){
  return {
    id:'phonism:'+phone.id,
    webexDeviceId:phone.webexDeviceId||null,
    callingDeviceId:null,
    displayName:phone.alias||'Partner-managed phone',
    model:phone.webexDeviceType||'Partner-managed phone',
    mac:phone.mac||null,
    locationId:tenant?.webexLocationId||null,
    locationName:tenant?.name||phone.tenantName||'',
    owner:phone.alias?{id:null,name:phone.alias,type:null,extension:'',phoneNumber:''}:null,
    line1:null,line2:null,detailsLoaded:false,
    phonismPhoneId:phone.id,phonismTenantId:phone.tenantId,phonismTenantName:tenant?.name||phone.tenantName||'',
    phonismMatch:'summary',
    phonismStatus:[phone.state==='1'?'Ready':phone.state?'State '+phone.state:null,phone.tr069?'TR69':null].filter(Boolean).join(' · ')||'Linked',
    phonismServiceState:phone.serviceState||[],
    lastProvision:phone.lastProvision||'Not reported',
    syncStatus:'summary',
    syncStatusLabel:'Summary view',
    syncMessage:'Select a location for Webex and line details'
  };
}

async function activeLeaseIndex(env){
  const leases=await listLeases(env,{limit:1000});
  const active=leases.filter(l=>['active','pending-verification','restore-sync-pending','restore-reboot-pending','external-change-sync-pending','external-change-reboot-pending'].includes(String(l?.status||'')));
  const byDevice=new Map(),byMac=new Map();
  for(const lease of active){
    if(lease?.device?.id)byDevice.set(String(lease.device.id),lease);
    if(lease?.device?.mac)byMac.set(String(lease.device.mac).toUpperCase(),lease);
  }
  return {byDevice,byMac};
}

function attachLease(device,index){
  const lease=index?.byDevice?.get(String(device?.id||''))||index?.byMac?.get(String(device?.mac||'').toUpperCase())||null;
  return {...device,temporaryLease:lease?{
    leaseId:lease.leaseId,status:lease.status,startsAt:lease.startsAt,expiresAt:lease.expiresAt,
    durationMinutes:lease.durationMinutes,temporaryLine2:lease.temporaryLine2,baselineLine2:lease.baselineLine2
  }:null};
}

async function findMemberAppearances({env,org,webexFetch,phonismReader,locationId,targetMemberId,excludeDeviceId}){
  const discovery=await phonismReader.discover(env,org);
  const tenant=discovery.tenants.find(t=>String(t.webexLocationId||'')===String(locationId||''));
  if(!tenant)return [];
  const inventory=await phonismReader.tenantPhones(env,tenant.id,tenant.name);
  const hits=await mapLimit(inventory.phones,4,async phone=>{
    try{
      const found=await firstWebexDeviceForPhone(webexFetch,env,phone);
      if(!found)return null;
      const base=deviceBase(found.data),deviceId=base.callingDeviceId||base.webexDeviceId;
      if(!deviceId||String(deviceId)===String(excludeDeviceId||''))return null;
      const data=await readWebexMembers(webexFetch,env,org,deviceId);
      const match=(data.members||[]).find(m=>String(m?.id||'')===String(targetMemberId||''));
      if(!match)return null;
      const primary=(data.members||[]).find(m=>Number(m?.port)===1||String(m?.lineType||'').toUpperCase()==='PRIMARY')||null;
      const primaryRow=primary?memberRow(primary):null;
      return {
        deviceId,deviceName:base.displayName||phone.alias||'Phone',model:base.model||phone.webexDeviceType||'',
        mac:phone.mac||base.mac||'',ownerName:primaryRow?.name||'',ownerExtension:primaryRow?.extension||'',
        port:Number(match?.port)||null,lineType:display(match?.lineType||'',40),locationName:tenant.name||''
      };
    }catch{return null;}
  });
  return hits.filter(Boolean).sort((a,b)=>(a.port??99)-(b.port??99)||String(a.deviceName).localeCompare(String(b.deviceName))).slice(0,20);
}

async function resolveWriteContext({env,org,webexFetch,phonismReader,deviceId,locationId,phonismPhoneId}){
  const discovery=await phonismReader.discover(env,org);
  const tenant=discovery.tenants.find(t=>String(t.webexLocationId||'')===String(locationId||''));
  if(!tenant)throw new DeviceManagementError('phonism-tenant-location-mismatch',409);
  const inventory=await phonismReader.tenantPhones(env,tenant.id,tenant.name);
  const phone=inventory.phones.find(p=>String(p.id)===String(phonismPhoneId||''));
  if(!phone)throw new DeviceManagementError('phonism-phone-not-found',404);
  if(!isPilotDevice(env,phone.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  const found=await firstWebexDeviceForPhone(webexFetch,env,phone);
  if(!found)throw new DeviceManagementError('webex-device-not-found',404);
  const base=deviceBase(found.data);
  const resolvedId=base.callingDeviceId||base.webexDeviceId;
  if(!resolvedId||String(resolvedId)!==String(deviceId||''))throw new DeviceManagementError('device-identity-mismatch',409);
  if(String(found.data?.locationId||locationId)!==String(locationId))throw new DeviceManagementError('device-location-mismatch',409);
  return {
    device:{...base,id:resolvedId,displayName:base.displayName||phone.alias||'Partner-managed phone',mac:phone.mac||base.mac},
    location:{id:locationId,name:tenant.name||''},
    phone,tenant,domain:discovery.domain,syncCompany:discovery.syncCompany||null
  };
}

async function readPhonismCapabilities(env,org,phonismReader){
  const checks=[];
  if(!env.PHONISM_API_KEY)return {detected:false,ready:false,message:'PHONISM_API_KEY is not configured',detail:'Add the Phonism API key as a Cloudflare secret.',checks};
  try{
    const discovery=await phonismReader.discover(env,org);
    checks.push({label:'VisionBank domain',status:discovery.domain.name||'Found'});
    checks.push({label:'Phonism tenants',status:String(discovery.tenants.length)+' available'});
    checks.push({label:'Webex integration hierarchy',status:discovery.syncCompany?((discovery.syncCompany.name||'Enterprise')+' · '+(discovery.syncCompany.type||'Enterprise')):'Enterprise parent not resolved'});
    const sampleTenant=discovery.tenants[0]||null;
    let sampleInventory={phones:[]},lineRead='not-tested',registrationMonitoring='unknown';
    if(sampleTenant){
      sampleInventory=await phonismReader.tenantPhones(env,sampleTenant.id,sampleTenant.name);
      checks.push({label:'Phonism tenant phone inventory',status:'Available ('+sampleInventory.phones.length+' in sample tenant)'});
      const sample=sampleInventory.phones[0];
      if(sample)try{
        const lines=await phonismReader.lines(env,sample.id);lineRead='available';
        registrationMonitoring=lines.some(x=>['registered','unregistered','pending'].includes(x.registrationStatus))?'available':'not-reported-on-sample';
        checks.push({label:'Phone line status read',status:'Available'});
        checks.push({label:'Line registration monitoring',status:registrationMonitoring});
      }catch{lineRead='unavailable';checks.push({label:'Phone line status read',status:'Unavailable'});}
    }
    return {detected:true,ready:true,message:'Read-only Phonism discovery available',
      detail:'VisionBank Iowa, its tenants, phone inventory, and line status APIs are reachable. Writes and Sync remain disabled.',
      checks,domainName:discovery.domain.name,tenantCount:discovery.tenants.length,
      sampleTenantPhoneCount:sampleInventory.phones.length,webexIntegrationAvailable:Boolean(discovery.webexIntegration),
      syncCompanyAvailable:Boolean(discovery.syncCompany?.id),syncCompanyName:discovery.syncCompany?.name||null,
      lineRead,registrationMonitoring};
  }catch(error){
    return {detected:true,ready:false,message:'Phonism read failed',
      detail:'The API key is present, but read-only discovery could not complete.',checks,error:error?.code||'phonism-read-unavailable'};
  }
}

export function createDeviceManagementHandler({webexFetch,checkAccess,loadIpRules,phonismReader=createPhonismReader()}){
  if(typeof webexFetch!=='function'||typeof checkAccess!=='function'||typeof loadIpRules!=='function'||!phonismReader)throw new Error('device-management-dependencies-required');
  return async function handler(request,env,cors={}){
    const headers={...cors};
    try{
      const url=new URL(request.url),part=url.pathname.slice(PREFIX.length),origin=request.headers.get('Origin');
      if(!ORIGINS.has(origin))throw new DeviceManagementError('origin-denied',403);
      const readRoutes=new Set(['capabilities','locations','inventory','device-detail','members','history','operator-session','lease-status']);
      const postRoutes=new Set(['operator-session','preview','apply','reboot']);
      if((request.method==='GET'&&!readRoutes.has(part))||(request.method==='POST'&&!postRoutes.has(part))||!['GET','POST'].includes(request.method))throw new DeviceManagementError('read-only-phase',405);
      const sourceIp=request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP');
      if(!request.cf||request.headers.has('CF-Worker')||!validIp(sourceIp))throw new DeviceManagementError('source-not-verifiable',403);
      if((await bounded(checkAccess(request,env),8000))?.allowed!==true)throw new DeviceManagementError('access-denied',403);
      const rules=await bounded(loadIpRules(env),8000);
      if(!Array.isArray(rules)||!rules.some(v=>typeof v==='string'&&v.trim()))throw new DeviceManagementError('approved-network-required',403);

      const writeParts=new Set(['preview','apply','reboot']);
      const writeScope=deviceWriteScope(env);
      if(writeParts.has(part)&&writeScope==='disabled')throw new DeviceManagementError('read-only-phase',405);

      if(part==='operator-session'){
        if(request.method==='POST'){
          const body=await readSmallJson(request,2048);
          const session=await createOperatorSession(env,request,body);
          return output({success:true,sessionId:session.id,operator:session.operator,startedAt:session.startedAt,expiresAt:session.expiresAt},201,headers);
        }
        const session=await readOperatorSession(env,request.headers.get('X-VB-Operator-Session'));
        if(!session)throw new DeviceManagementError('operator-session-required',401);
        return output({success:true,sessionId:session.id,operator:session.operator,startedAt:session.startedAt,expiresAt:session.expiresAt},200,headers);
      }

      if(part==='history'){
        const history=await listAuditRecords(env,{limit:url.searchParams.get('limit')||100});
        return output({success:true,rows:history.rows,complete:history.complete,readOnly:true},200,headers);
      }

      const org=String(env.WEBEX_ORG_ID||'').trim();if(!org)throw new DeviceManagementError('webex-org-not-configured',503);

      if(part==='locations'){
        const page=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations']);
        const locations=page.rows.map(x=>({id:id(x?.id),name:display(x?.name||x?.displayName,120),address:display([x?.address?.city,x?.address?.state].filter(Boolean).join(', '),160)})).filter(x=>x.id);
        return output({success:true,locations,truncated:page.truncated,readOnly:true},200,headers);
      }
      if(part==='capabilities'){
        const checks=[];let locationsOk=false,devicesOk=false,memberRead='not-tested',callingCount=0,deviceCount=0;
        try{
          const p=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations'],3,500);
          locationsOk=true;checks.push({label:'Webex locations read',status:'Available ('+p.rows.length+')'});
        }catch{checks.push({label:'Webex locations read',status:'Unavailable'});}

        const phonism=await readPhonismCapabilities(env,org,phonismReader);
        try{
          const discovery=await phonismReader.discover(env,org);
          let samplePhone=null;
          for(const tenant of discovery.tenants.slice(0,4)){
            const sample=await phonismReader.tenantPhones(env,tenant.id,tenant.name);
            if(sample.phones.length){samplePhone=sample.phones[0];break;}
          }
          if(samplePhone){
            const found=await firstWebexDeviceForPhone(webexFetch,env,samplePhone);
            if(found){
              devicesOk=true;deviceCount=1;
              const base=deviceBase(found.data);
              callingCount=base.callingDeviceId?1:0;
              checks.push({label:'VisionBank Webex device lookup',status:'Available'});
              if(base.callingDeviceId)try{
                const data=await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(base.callingDeviceId)+'/members?orgId='+encodeURIComponent(org),{method:'GET'}),12000));
                memberRead=Array.isArray(data.members)||Array.isArray(data.items)?'available':'unavailable';
                checks.push({label:'Calling device members read',status:memberRead==='available'?'Available':'Unavailable'});
              }catch{memberRead='unavailable';checks.push({label:'Calling device members read',status:'Unavailable'});}
            }
          }
        }catch{}
        if(!devicesOk)checks.push({label:'VisionBank Webex device lookup',status:'Unavailable'});

        const ready=locationsOk&&devicesOk;
        const writeConfigured=writeScope!=='disabled';
        const syncHierarchyReady=phonism?.syncCompanyAvailable===true;
        const writesEnabled=writeConfigured&&phonism?.ready===true&&syncHierarchyReady;
        const writeMessage=writesEnabled
          ?(writeScope==='organization'?'Save & Sync enabled for VisionBank devices':'Pilot Save & Sync enabled for approved devices')
          :writeConfigured?'Review enabled; Enterprise Phonism Sync owner could not be resolved':'Device writes are not configured';
        return output({success:true,webex:{detected:true,ready,
          message:ready?'Webex discovery available':'Webex discovery is incomplete',
          detail:ready?'Webex locations and VisionBank-scoped partner-managed devices can be read through Phonism-stored Webex device IDs.':'Webex location access works, but the VisionBank-scoped device enrichment probe did not complete.',
          checks,deviceCount,callingDeviceCount:callingCount,memberRead,deviceScope:'phonism-visionbank-iowa'},phonism,
          writes:{enabled:writesEnabled,previewReady:writeConfigured,pilot:writeScope==='pilot',
            organizationWide:writeScope==='organization',scope:writeScope,syncHierarchyReady,message:writeMessage},
          readOnly:!writesEnabled},200,headers);
      }

      if(part==='inventory'){
        const requestedLocation=id(url.searchParams.get('locationId'));

        let discovery;
        try{discovery=await phonismReader.discover(env,org);}
        catch{throw new DeviceManagementError('phonism-read-unavailable',503);}

        if(!requestedLocation){
          const all=await phonismReader.phones(env,discovery.domain.id,discovery.tenants);
          const tenantById=new Map(discovery.tenants.map(t=>[String(t.id),t]));
          const leaseIndex=await activeLeaseIndex(env).catch(()=>null);
          const devices=all.phones.map(phone=>attachLease({...summaryPhoneRow(phone,tenantById.get(String(phone.tenantId))||null),writeEligible:isPilotDevice(env,phone.mac)},leaseIndex));
          return output({success:true,devices,summaryOnly:true,truncated:all.truncated,
            phonism:{ready:true,domainName:discovery.domain.name,tenantCount:discovery.tenants.length,phoneCount:devices.length},
            message:'Showing all VisionBank Iowa phones. Select a location for Webex and line details.',
            generatedAt:new Date().toISOString(),readOnly:true},200,headers);
        }

        const tenants=discovery.tenants.filter(t=>String(t.webexLocationId||'')===requestedLocation);
        if(!tenants.length){
          return output({success:true,devices:[],locationRequired:false,
            phonism:{ready:true,domainName:discovery.domain.name,tenantMatched:false},
            message:'No Phonism tenant is mapped to this Webex location.',
            generatedAt:new Date().toISOString(),readOnly:true},200,headers);
        }

        const scoped=[];
        let truncated=false;
        for(const tenant of tenants){
          const inventory=await phonismReader.tenantPhones(env,tenant.id,tenant.name);
          truncated=truncated||inventory.truncated;
          for(const phone of inventory.phones)scoped.push({tenant,phone});
        }
        const detailed=await mapLimit(scoped,4,entry=>scopedPhoneRow(webexFetch,env,org,entry.tenant,entry.phone,phonismReader));
        const leaseIndex=await activeLeaseIndex(env).catch(()=>null);
        const devices=detailed.map(d=>attachLease({...d,writeEligible:isPilotDevice(env,d.mac)},leaseIndex));
        return output({success:true,devices,truncated,
          phonism:{ready:true,domainName:discovery.domain.name,tenantMatched:true,
            tenantCount:tenants.length,phoneCount:scoped.length},
          generatedAt:new Date().toISOString(),readOnly:true},200,headers);
      }
      if(part==='device-detail'){
        const locationId=id(url.searchParams.get('locationId')),phonismPhoneId=id(url.searchParams.get('phonismPhoneId'));
        if(!locationId||!phonismPhoneId)throw new DeviceManagementError('location-and-phonism-phone-required');
        let discovery;
        try{discovery=await phonismReader.discover(env,org);}
        catch{throw new DeviceManagementError('phonism-read-unavailable',503);}
        const tenant=discovery.tenants.find(t=>String(t.webexLocationId||'')===String(locationId));
        if(!tenant)throw new DeviceManagementError('phonism-tenant-location-mismatch',409);
        const phone=await phonismReader.phone(env,phonismPhoneId,tenant);
        if(String(phone.tenantId||'')!==String(tenant.id))throw new DeviceManagementError('phonism-phone-location-mismatch',409);
        const device=await scopedPhoneRow(webexFetch,env,org,tenant,phone,phonismReader);
        const leaseIndex=await activeLeaseIndex(env).catch(()=>null);
        return output({success:true,device:attachLease({...device,detailsLoaded:true,writeEligible:isPilotDevice(env,device.mac)},leaseIndex),
          generatedAt:new Date().toISOString(),readOnly:true},200,headers);
      }

      if(part==='members'){
        const deviceId=id(url.searchParams.get('deviceId'));
        if(!deviceId)throw new DeviceManagementError('device-required');
        const query=display(url.searchParams.get('q')||'',160);
        const limit=memberResultLimit(url.searchParams.get('limit'));
        const searched=await searchEligibleMembers({webexFetch,env,org,deviceId,query});
        const eligibleMatches=searched.members
          .map(m=>({...m,available:true,availability:'available'}))
          .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))||String(a.extension||'').localeCompare(String(b.extension||'')));
        const eligibleIds=new Set(eligibleMatches.map(m=>String(m.id)));
        const fallbackMatches=query?await findUnavailableMemberMatches({
          env,org,webexFetch,phonismReader,deviceId,query,eligibleIds,limit:Math.min(limit,5)
        }):[];
        const recoveredEligible=fallbackMatches.filter(m=>m.available!==false);
        const unavailableMatches=fallbackMatches.filter(m=>m.available===false);
        const allEligible=[...eligibleMatches,...recoveredEligible];
        const matches=[...allEligible,...unavailableMatches]
          .sort((a,b)=>Number(a.available===false)-Number(b.available===false)||
            String(a.name||'').localeCompare(String(b.name||''))||String(a.extension||'').localeCompare(String(b.extension||'')));
        const members=matches.slice(0,limit);
        return output({success:true,members,totalMatches:matches.length,eligibleMatches:allEligible.length,
          unavailableMatches:unavailableMatches.length,truncated:searched.truncated||matches.length>members.length,
          deviceId,scope:'organization',query,limit,searchMode:query?'webex-upstream':'default',readOnly:true},200,headers);
      }

      if(part==='preview'){
        const session=await requireOperatorSession(env,request);
        const body=await readSmallJson(request,4096);
        const allowed=new Set(['deviceId','locationId','phonismPhoneId','targetLine2MemberId','targetLine2Search','targetLine2LocationId','durationMinutes','reason']);
        if(!body||Object.keys(body).some(k=>!allowed.has(k)))throw new DeviceManagementError('invalid-preview-request');
        const deviceId=id(body.deviceId),locationId=id(body.locationId),phonismPhoneId=id(String(body.phonismPhoneId||''));
        if(!deviceId||!locationId||!phonismPhoneId)throw new DeviceManagementError('device-location-phonism-required');
        const ctx=await resolveWriteContext({env,org,webexFetch,phonismReader,deviceId,locationId,phonismPhoneId});
        const current=await readWebexMembers(webexFetch,env,org,deviceId);

        let targetMember=null;
        if(body.targetLine2MemberId){
          const lookup=display(body.targetLine2Search||'',160);
          const searched=await searchEligibleMembers({
            webexFetch,env,org,deviceId,query:lookup,locationId:lookup?id(body.targetLine2LocationId):null
          });
          targetMember=searched.members.find(m=>String(m.id)===String(body.targetLine2MemberId))||null;
          if(!targetMember)throw new DeviceManagementError('target-member-not-available',409);
        }

        const preview=await createWritePreview({
          env,session,device:ctx.device,location:ctx.location,currentMembers:current.members,targetMember,
          durationMinutes:body.durationMinutes,reason:body.reason,
          phonismContext:{phoneId:ctx.phone.id,tenantId:ctx.tenant.id,companyId:ctx.syncCompany?.id||null}
        });
        const expiresAt=new Date(Date.parse(preview.createdAt)+preview.durationMinutes*60000).toISOString();
        const executable=Boolean(ctx.syncCompany?.id);
        return output({success:true,plan:{
          mutationId:preview.mutationId,expectedVersion:0,executable,
          device:preview.device,location:preview.location,
          before:{line2:preview.baselineLine2},after:{line2:preview.targetMember},
          lease:{temporary:true,durationMinutes:preview.durationMinutes,startsAt:preview.createdAt,expiresAt,baselineLine2:preview.baselineLine2},
          phonismActionLabel:'Force Phonism Webex Sync',
          summary:executable?'Webex Line 2 will be saved first, Phonism Sync will be forced immediately through the Enterprise integration, and both systems will be re-read before the temporary lease is considered healthy.':'Review is valid, but Save & Sync remains locked until the Enterprise-level Phonism Sync owner is resolved.'
        },readOnly:false},200,headers);
      }

      if(part==='apply'){
        const session=await requireOperatorSession(env,request);
        const body=await readSmallJson(request,2048);
        if(!body||typeof body.mutationId!=='string'||Object.keys(body).some(k=>!['mutationId'].includes(k)))throw new DeviceManagementError('invalid-apply-request');
        try{
          const result=await applyWritePreview({env,request,session,webexFetch,orgId:org,mutationId:body.mutationId,phonismReader});
          return output({success:true,
            message:result.rebootQueued?'Webex updated, Phonism Sync queued, and phone reboot queued. Refreshing and verifying the new temporary line.':'Webex updated and Phonism Sync queued, but the automatic reboot could not be queued. The line change remains saved; Reboot & Reverify is available.',
            leaseId:result.lease.leaseId,expiresAt:result.lease.expiresAt,verification:result.lease.verification,
            rebootQueued:result.rebootQueued===true,rebootAvailable:Boolean(result.lease.phonismPhoneId),rebootError:result.rebootError||null},200,headers);
        }catch(error){
          if(error?.code==='target-appearance-limit'&&error?.targetMember?.memberId&&error?.location?.id){
            const appearances=await findMemberAppearances({
              env,org,webexFetch,phonismReader,
              locationId:error.targetMember.locationId||error.location.id,
              targetMemberId:error.targetMember.memberId,
              excludeDeviceId:error.device?.id
            }).catch(()=>[]);
            return output({success:false,error:'target-appearance-limit',target:error.targetMember,appearances,readOnly:false},409,headers);
          }
          throw error;
        }
      }

      if(part==='lease-status'){
        const session=await requireOperatorSession(env,request);
        const leaseId=id(url.searchParams.get('leaseId'));
        if(!leaseId)throw new DeviceManagementError('lease-id-required');
        const result=await verifyLease({env,webexFetch,orgId:org,leaseId,phonismReader});
        return output({success:true,leaseId,state:result.state,verification:result.lease.verification,
          expiresAt:result.lease.expiresAt,rebootAvailable:Boolean(result.lease.phonismPhoneId),
          automaticReboot:result.lease.recovery?.automaticReboot===true,rebootAttempted:result.lease.recovery?.rebootAttempted===true},200,headers);
      }

      if(part==='reboot'){
        const session=await requireOperatorSession(env,request);
        const body=await readSmallJson(request,2048);
        if(!body||Object.keys(body).some(k=>!['leaseId'].includes(k))||typeof body.leaseId!=='string')throw new DeviceManagementError('invalid-recovery-request');
        const result=await runRecoveryAction({env,request,session,leaseId:body.leaseId,phonismReader});
        return output({success:true,message:'Reboot queued in Phonism; re-verification required.',
          leaseId:result.lease.leaseId,rebootAvailable:true},200,headers);
      }

      throw new DeviceManagementError('not-found',404);
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      const code=typeof error?.code==='string'?error.code:'device-management-unavailable';
      return output({success:false,error:code,readOnly:true},status,headers);
    }
  };
}
