import {DeviceManagementError,normalizeMac,normalizeOwnerType,normalizeRegistration} from './contracts.mjs';
import {createPhonismReader} from './phonism.mjs';
import {createOperatorSession,readOperatorSession,requireOperatorSession,deleteOperatorSession,listAuditRecords} from './audit.mjs';
import {isPilotDevice,listLeases,deviceWriteScope} from './lease.mjs';
import {createWritePreview,applyWritePreview,verifyLease,runRecoveryAction,readWebexMembers,endTemporaryLease} from './write.mjs';
import {
  identityPolicy,getAdminSettings,setVerificationEnabled,setDefaultVerificationHours,
  setUserVerificationHours,removeUserVerificationHours,addDeviceAdmin,removeDeviceAdmin,
  requestVerificationCode,confirmVerificationCode,verificationRequired,loadIdentityConfig,verificationHoursFor,requireDeviceAdmin
} from './identity.mjs';
import {
  createPhoneEnrollment,revokePhoneEnrollment,phoneEnrollmentStatus,phoneEnrollmentIndex,phoneTelemetryIndex,
  authenticatePhone,authenticatePhoneAccess,authenticatePhoneFleetKey,readPhoneEnrollment,upsertFleetEnrollment,
  getFleetKeySettings,rotateFleetKey,recordFleetKeyUse,
  recordPhoneSeen,handlePhoneCheckin,createPhoneIntent,readPhoneIntent,startPhoneIntent,failPhoneIntent,finishPhoneIntent,phoneSession,
  attachPhoneSelfService,phoneDurationOptions,phoneDurationLabel,textMenu,inputScreen,phoneXmlResponse,phoneNoContent,
  phoneUnauthorized,phoneErrorMenu
} from './phone-selfservice.mjs';

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
    const hasAlpha=/[a-z]/i.test(q),hasDigit=/\d/.test(q);
    if(hasAlpha||!hasDigit)urls.push(availableMembersUrl(deviceId,org,{...baseFilters,memberName:q}));
    if(hasDigit)urls.push(availableMembersUrl(deviceId,org,{...baseFilters,extension:q}));
    if(/^\+?[\d\s().-]{7,}$/.test(q))urls.push(availableMembersUrl(deviceId,org,{...baseFilters,phoneNumber:q}));
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

async function findUnavailableMemberMatches({env,org,webexFetch,phonismReader,deviceId,query,eligibleIds,limit=5,includeAppearances=false}){
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
    if(!includeAppearances)return {...row,appearances:[],unavailableReason:'webex-not-available'};
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

function summaryNumberDirectory(rows){
  const groups=new Map();
  for(const raw of Array.isArray(rows)?rows:[]){
    const row=numberOwnerRow(raw);
    if(!row.id||!row.name||!row.locationId||!row.extension)continue;
    const key=String(row.locationId)+'|'+String(row.name).trim().toLowerCase().replace(/\s+/g,' ');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  const unique=new Map();
  for(const [key,items] of groups){
    const ownerIds=new Set(items.map(x=>String(x.id)));
    const extensions=new Set(items.map(x=>String(x.extension)).filter(Boolean));
    if(ownerIds.size===1&&extensions.size===1)unique.set(key,items[0]);
  }
  return unique;
}

function summaryPhoneRow(phone,tenant,numberDirectory=null){
  const locationId=tenant?.webexLocationId||null;
  const alias=phone.alias||'Partner-managed phone';
  const directoryKey=locationId?String(locationId)+'|'+String(alias).trim().toLowerCase().replace(/\s+/g,' '):'';
  const match=directoryKey&&numberDirectory?.get?.(directoryKey)||null;
  const owner=match?{
    id:match.id,name:alias,type:match.type,extension:match.extension,phoneNumber:match.phoneNumber
  }:phone.alias?{id:null,name:phone.alias,type:null,extension:'',phoneNumber:''}:null;
  return {
    id:'phonism:'+phone.id,
    webexDeviceId:phone.webexDeviceId||null,
    callingDeviceId:null,
    displayName:phone.alias||'Partner-managed phone',
    model:phone.webexDeviceType||'Partner-managed phone',
    mac:phone.mac||null,
    locationId,
    locationName:tenant?.name||phone.tenantName||'',
    owner,
    summaryExtension:match?.extension||'',
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

async function readPhonismCapabilities(env,org,phonismReader,discoveryOverride=null){
  const checks=[];
  if(!env.PHONISM_API_KEY)return {detected:false,ready:false,message:'PHONISM_API_KEY is not configured',detail:'Add the Phonism API key as a Cloudflare secret.',checks};
  try{
    const discovery=discoveryOverride||await phonismReader.discover(env,org);
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

async function requireWriteOperator(env,request){
  const session=await requireOperatorSession(env,request);
  if(await verificationRequired(env)&&session.verified!==true)throw new DeviceManagementError('operator-verification-required',403);
  return session;
}

const PHONE_ACTION_CODE={status:'s',search:'q',duration:'d',confirm:'c',apply:'p',signout:'e',signoutApply:'o'};
const PHONE_CODE_ACTION={s:'status',q:'search',d:'duration',c:'confirm',p:'apply',e:'signout',o:'signoutApply'};
const PHONE_CANONICAL_ORIGIN='https://visionbank-security.ahmedadeyemi.workers.dev';
const PHONE_RENDER_ORIGIN='https://visionbank-dashboard.onrender.com';
const compactPhoneMac=value=>normalizeMac(value).replace(/:/g,'').toLowerCase();

function phoneActionOrigin(request,{fleetKey=false}={}){
  const url=new URL(request.url);
  if(fleetKey&&(url.origin===PHONE_RENDER_ORIGIN||url.origin===PHONE_CANONICAL_ORIGIN))return url.origin;
  return PHONE_CANONICAL_ORIGIN;
}

function phoneRouteUrl(request,part,params={},accessToken=null,fleetKey=null,fleetMac=null){
  const url=new URL(request.url);
  const compactMac=fleetMac?compactPhoneMac(fleetMac):null;
  const actionCode=PHONE_ACTION_CODE[part]||part;
  let target;
  if(fleetKey&&compactMac){
    const suffix=part==='xml'?'':'/'+encodeURIComponent(actionCode);
    target=new URL('/x/'+encodeURIComponent(fleetKey)+'/'+compactMac+suffix,phoneActionOrigin(request,{fleetKey:true}));
  }else if(accessToken){
    target=new URL('/p/'+encodeURIComponent(accessToken),PHONE_CANONICAL_ORIGIN);
    if(part!=='xml')target.searchParams.set('a',actionCode);
  }else target=new URL(PREFIX+'phone/'+part,url.origin);
  for(const [key,value] of Object.entries(params))if(value!==null&&value!==undefined&&String(value)!=='')target.searchParams.set(key,String(value));
  return target.toString();
}

function phoneMemberLabel(member){
  const extension=display(member?.extension||member?.phoneNumber||'',40);
  const name=display(member?.name||member?.displayName||'',80);
  if(extension&&name)return extension+' - '+name;
  return extension||name||'Unknown line';
}

function activePhoneLease(index,enrollment){
  return index?.byDevice?.get(String(enrollment?.device?.id||''))||
    index?.byMac?.get(String(enrollment?.device?.mac||'').toUpperCase())||null;
}

async function phoneMember({webexFetch,env,org,enrollment,intent}){
  const searched=await searchEligibleMembers({
    webexFetch,env,org,deviceId:enrollment.device.id,
    query:intent.memberQuery||'',locationId:intent.memberLocationId||null
  });
  return searched.members.find(member=>String(member.id)===String(intent.memberId))||null;
}

async function applyPhoneIntentWork({env,request,org,webexFetch,phonismReader,enrollment,intent,throwOnFailure=false}){
  try{
    const ctx=await resolveWriteContext({
      env,org,webexFetch,phonismReader,
      deviceId:enrollment.device.id,locationId:enrollment.location.id,phonismPhoneId:enrollment.phonismPhoneId
    });
    const target=await phoneMember({webexFetch,env,org,enrollment,intent});
    if(!target)throw new DeviceManagementError('target-member-not-available',409);
    const refreshed=await readWebexMembers(webexFetch,env,org,enrollment.device.id);
    const session=phoneSession(enrollment);
    const preview=await createWritePreview({
      env,session,device:ctx.device,location:ctx.location,currentMembers:refreshed.members,targetMember:target,
      durationMinutes:intent.durationMinutes,reason:'Phone self-service temporary Line 2',
      phonismContext:{phoneId:ctx.phone.id,tenantId:ctx.tenant.id,companyId:ctx.syncCompany?.id||null}
    });
    const result=await applyWritePreview({env,request,session,webexFetch,orgId:org,mutationId:preview.mutationId,phonismReader});
    await finishPhoneIntent(env,intent.intentId,{leaseId:result.lease.leaseId,expiresAt:result.lease.expiresAt});
    return {result,target};
  }catch(error){
    await failPhoneIntent(env,intent.intentId,error).catch(()=>{});
    if(throwOnFailure)throw error;
    console.error('Phone background Save failed:',error?.code||error?.message||error);
    return null;
  }
}

async function resolveFleetEnrollment({env,org,webexFetch,phonismReader,mac}){
  const normalized=normalizeMac(mac);
  const cached=await readPhoneEnrollment(env,normalized);
  if(cached?.status==='active'&&cached?.authMode==='fleet-template'){
    return cached;
  }
  const discovery=await phonismReader.discover(env,org);
  const matches=[];
  if(typeof phonismReader.phones==='function'){
    const inventory=await phonismReader.phones(env,discovery.domain.id,discovery.tenants);
    const tenantById=new Map(discovery.tenants.map(tenant=>[String(tenant.id),tenant]));
    for(const phone of inventory.phones||[]){
      let phoneMac=null;try{phoneMac=normalizeMac(phone.mac);}catch{}
      if(phoneMac!==normalized)continue;
      const tenant=tenantById.get(String(phone.tenantId||''));
      if(tenant)matches.push({tenant,phone});
    }
  }else{
    const inventories=await Promise.all(discovery.tenants.map(async tenant=>{
      try{return {tenant,inventory:await phonismReader.tenantPhones(env,tenant.id,tenant.name)};}
      catch{return {tenant,inventory:{phones:[]}};}
    }));
    for(const item of inventories){
      for(const phone of item.inventory.phones||[]){
        let phoneMac=null;try{phoneMac=normalizeMac(phone.mac);}catch{}
        if(phoneMac===normalized)matches.push({tenant:item.tenant,phone});
      }
    }
  }
  if(matches.length!==1)throw new DeviceManagementError(matches.length?'phonism-phone-ambiguous':'phonism-phone-not-found',matches.length?409:404);
  const {tenant,phone}=matches[0];
  if(!isPilotDevice(env,phone.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  const row=await scopedPhoneRow(webexFetch,env,org,tenant,phone,phonismReader);
  if(!row?.id||String(row.id).startsWith('phonism:')||!row.locationId)throw new DeviceManagementError('webex-device-not-found',404);
  return upsertFleetEnrollment(env,{
    device:{id:row.id,displayName:row.displayName,mac:row.mac,model:row.model},
    location:{id:row.locationId,name:row.locationName},
    phonismPhoneId:row.phonismPhoneId
  });
}

async function handlePhoneSelfServiceRoute({request,env,part,webexFetch,phonismReader,accessToken=null,fleetKey=null,fleetMac=null,executionContext=null}){
  const sourceIp=request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP');
  if(!request.cf||request.headers.has('CF-Worker')||!validIp(sourceIp))return phoneXmlResponse(phoneErrorMenu('source-not-verifiable',null),403);
  if(part==='phone/checkin'){
    try{await handlePhoneCheckin(env,request);return phoneNoContent();}
    catch(error){return phoneNoContent(Number.isInteger(error?.status)?error.status:403);}
  }

  const org=String(env.WEBEX_ORG_ID||'').trim();
  if(!org)return phoneXmlResponse(phoneErrorMenu('webex-org-not-configured',null),503);
  let normalizedFleetMac=null,enrollment;
  try{
    if(fleetKey){
      await authenticatePhoneFleetKey(env,fleetKey);
      normalizedFleetMac=compactPhoneMac(fleetMac);
      enrollment=await resolveFleetEnrollment({env,org,webexFetch,phonismReader,mac:normalizedFleetMac});
      await recordFleetKeyUse(env,fleetKey);
    }else{
      enrollment=accessToken?await authenticatePhoneAccess(env,accessToken):await authenticatePhone(env,request);
    }
  }catch(error){
    return !fleetKey&&!accessToken&&Number(error?.status)===401?phoneUnauthorized():phoneXmlResponse(phoneErrorMenu(error?.code,null),Number(error?.status)||403);
  }

  const phoneUrl=new URL(request.url);
  if(accessToken&&phoneUrl.searchParams.get('m')){
    let suppliedMac;
    try{suppliedMac=normalizeMac(phoneUrl.searchParams.get('m'));}catch{return phoneXmlResponse(phoneErrorMenu('phone-credential-invalid',null),403);}
    if(suppliedMac!==enrollment.device.mac)return phoneXmlResponse(phoneErrorMenu('phone-credential-invalid',null),403);
  }
  await recordPhoneSeen(env,request,enrollment,{reportedIp:phoneUrl.searchParams.get('i'),event:fleetKey?'fleet-xml-browser':'xml-browser'}).catch(()=>{});
  const home=phoneRouteUrl(request,'xml',{},accessToken,fleetKey,normalizedFleetMac);
  const searchUrl=phoneRouteUrl(request,'search',{},accessToken,fleetKey,normalizedFleetMac);
  try{
    const leaseIndex=await activeLeaseIndex(env),lease=activePhoneLease(leaseIndex,enrollment);
    let line2Loaded=false,line2Row=null;
    const loadLine2=async()=>{
      if(line2Loaded)return line2Row;
      const current=await readWebexMembers(webexFetch,env,org,enrollment.device.id);
      const line2=current.members.find(member=>Number(member?.port)===2)||null;
      line2Row=line2?memberRow(line2):null;
      line2Loaded=true;
      return line2Row;
    };

    if(part==='phone/xml'){
      if(!lease){
        return phoneXmlResponse(textMenu('VisionBank Manage Extensions',[
          {prompt:'Add Temporary Line',uri:searchUrl},
          {prompt:'Refresh',uri:home}
        ]));
      }
      if(!lease.temporaryLine2)await loadLine2();
      const items=[];
      const activeLineLabel=lease.temporaryLine2?phoneMemberLabel(lease.temporaryLine2):(line2Row?phoneMemberLabel(line2Row):null);
      if(activeLineLabel)items.push({prompt:'Line 2: '+activeLineLabel,uri:phoneRouteUrl(request,'status',{},accessToken,fleetKey,normalizedFleetMac)});
      else items.push({prompt:'Line 2: None',uri:phoneRouteUrl(request,'status',{},accessToken,fleetKey,normalizedFleetMac)});
      const expiry=Date.parse(lease.expiresAt||''),minutes=Number.isFinite(expiry)?Math.max(0,Math.ceil((expiry-Date.now())/60000)):null;
      items.push({prompt:'Temporary line active'+(minutes!==null?' · '+minutes+' min left':''),uri:phoneRouteUrl(request,'status',{},accessToken,fleetKey,normalizedFleetMac)});
      items.push({prompt:'Sign Out Temporary Line',uri:phoneRouteUrl(request,'signout',{},accessToken,fleetKey,normalizedFleetMac)});
      items.push({prompt:'Refresh',uri:home});
      return phoneXmlResponse(textMenu('VisionBank Manage Extensions',items));
    }

    if(part==='phone/status'){
      await loadLine2();
      const items=[
        {prompt:(lease?.temporaryLine2||line2Row)?'Current Line 2: '+phoneMemberLabel(lease?.temporaryLine2||line2Row):'Current Line 2: None',uri:home}
      ];
      if(lease){
        const expiry=Date.parse(lease.expiresAt||''),label=Number.isFinite(expiry)?new Date(expiry).toLocaleString('en-US',{timeZone:'America/Chicago'}):lease.expiresAt;
        items.push({prompt:'Auto-remove: '+label+' Central',uri:home});
        items.push({prompt:'Duration: '+phoneDurationLabel(lease.durationMinutes),uri:home});
      }else items.push({prompt:'No active temporary lease',uri:home});
      items.push({prompt:'Return',uri:home});
      return phoneXmlResponse(textMenu('Temporary Line Status',items));
    }

    if(part==='phone/signout'){
      if(!lease)return phoneXmlResponse(textMenu('No Temporary Line',[
        {prompt:'Return',uri:home}
      ],{cancelAction:home}));
      if(!lease?.temporaryLine2)await loadLine2();
      const currentLabel=phoneMemberLabel(lease.temporaryLine2||line2Row);
      return phoneXmlResponse(textMenu('Sign Out '+currentLabel,[
        {prompt:'Sign Out Now',uri:phoneRouteUrl(request,'signoutApply',{},accessToken,fleetKey,normalizedFleetMac)},
        {prompt:'Keep Line Active',uri:home}
      ],{cancelAction:home}));
    }

    if(part==='phone/signoutApply'){
      if(!lease)return phoneXmlResponse(textMenu('Already Signed Out',[
        {prompt:'Return',uri:home}
      ],{cancelAction:home}));
      const session=phoneSession(enrollment);
      const ended=await endTemporaryLease({
        env,request,session,webexFetch,orgId:org,leaseId:lease.leaseId,phonismReader
      });
      const status=ended.result?.status||'unknown';
      const rebootQueued=status==='restored'||status==='external-change-reconciled';
      const baseline=ended.lease?.baselineLine2?phoneMemberLabel(ended.lease.baselineLine2):'No Line 2';
      return phoneXmlResponse(textMenu(rebootQueued?'Signed Out - Phone Restarting':'Sign Out Pending',[
        {prompt:'Restored: '+baseline,uri:home},
        {prompt:rebootQueued?'Rebooting automatically':'Finishing restore automatically',uri:home},
        {prompt:'Return',uri:home}
      ],{cancelAction:home}));
    }

    if(part==='phone/search'){
      if(lease)throw new DeviceManagementError('phone-active-lease',409);
      const q=display(new URL(request.url).searchParams.get('q')||'',80);
      if(!q)return phoneXmlResponse(inputScreen('Add Temporary Line','Extension or phone number',searchUrl,'q',{cancelAction:home}));
      const searched=await searchEligibleMembers({webexFetch,env,org,deviceId:enrollment.device.id,query:q});
      const rows=searched.members.filter(member=>member?.id).slice(0,8);
      if(!rows.length)return phoneXmlResponse(textMenu('No Matching Extensions',[
        {prompt:'Search again',uri:searchUrl},{prompt:'Return',uri:home}
      ],{cancelAction:home}));
      const items=rows.map(member=>({
        prompt:phoneMemberLabel(member),
        uri:phoneRouteUrl(request,'duration',{member:member.id,q,locationId:member.locationId||''},accessToken,fleetKey,normalizedFleetMac)
      }));
      items.push({prompt:'Search again',uri:searchUrl});
      return phoneXmlResponse(textMenu('Select Extension',items,{cancelAction:home}));
    }

    if(part==='phone/duration'){
      if(lease)throw new DeviceManagementError('phone-active-lease',409);
      const url=new URL(request.url),memberId=id(url.searchParams.get('member')),q=display(url.searchParams.get('q')||'',80),locationId=id(url.searchParams.get('locationId'));
      if(!memberId)throw new DeviceManagementError('target-member-not-available',409);
      const searched=await searchEligibleMembers({webexFetch,env,org,deviceId:enrollment.device.id,query:q,locationId});
      const target=searched.members.find(member=>String(member.id)===String(memberId));
      if(!target)throw new DeviceManagementError('target-member-not-available',409);
      const items=phoneDurationOptions().map(minutes=>({
        prompt:phoneDurationLabel(minutes),
        uri:phoneRouteUrl(request,'confirm',{member:memberId,q,locationId:target.locationId||'',minutes},accessToken,fleetKey,normalizedFleetMac)
      }));
      items.push({prompt:'Cancel',uri:home});
      return phoneXmlResponse(textMenu('Use '+phoneMemberLabel(target)+' For',items,{cancelAction:home}));
    }

    if(part==='phone/confirm'){
      if(lease)throw new DeviceManagementError('phone-active-lease',409);
      const url=new URL(request.url),memberId=id(url.searchParams.get('member')),q=display(url.searchParams.get('q')||'',80),locationId=id(url.searchParams.get('locationId'));
      const minutes=Number(url.searchParams.get('minutes'));
      if(!phoneDurationOptions().includes(minutes)||!memberId)throw new DeviceManagementError('invalid-temporary-duration');
      const searched=await searchEligibleMembers({webexFetch,env,org,deviceId:enrollment.device.id,query:q,locationId});
      const target=searched.members.find(member=>String(member.id)===String(memberId));
      if(!target)throw new DeviceManagementError('target-member-not-available',409);
      const intent=await createPhoneIntent(env,enrollment,{memberId,targetMember:target,memberQuery:q,memberLocationId:target.locationId,durationMinutes:minutes});
      return phoneXmlResponse(textMenu(phoneMemberLabel(target),[
        {prompt:'Save - '+phoneDurationLabel(minutes),uri:phoneRouteUrl(request,'apply',{intent:intent.intentId},accessToken,fleetKey,normalizedFleetMac)},
        {prompt:'Change time',uri:phoneRouteUrl(request,'duration',{member:memberId,q,locationId:target.locationId||''},accessToken,fleetKey,normalizedFleetMac)},
        {prompt:'Cancel',uri:home}
      ],{cancelAction:home}));
    }

    if(part==='phone/apply'){
      if(lease)throw new DeviceManagementError('phone-active-lease',409);
      const intentId=new URL(request.url).searchParams.get('intent');
      let intent=await readPhoneIntent(env,intentId,enrollment);
      if(intent.status==='completed'&&intent.result?.expiresAt){
        return phoneXmlResponse(textMenu('Extension Already Added',[
          {prompt:'Temporary until '+new Date(intent.result.expiresAt).toLocaleString('en-US',{timeZone:'America/Chicago'}),uri:home},
          {prompt:'Return',uri:home}
        ]));
      }
      if(intent.status==='processing'){
        return phoneXmlResponse(textMenu('Saving Extension',[
          {prompt:'Change is already in progress',uri:home},
          {prompt:'Phone will restart automatically',uri:home},
          {prompt:'Return',uri:home}
        ]));
      }
      intent=await startPhoneIntent(env,intentId,enrollment);
      if(typeof executionContext?.waitUntil==='function'){
        executionContext.waitUntil(applyPhoneIntentWork({
          env,request,org,webexFetch,phonismReader,enrollment,intent,throwOnFailure:false
        }));
        return phoneXmlResponse(textMenu('Saving Extension',[
          {prompt:'Applying for '+phoneDurationLabel(intent.durationMinutes),uri:home},
          {prompt:'Phone will restart automatically',uri:home},
          {prompt:'Return',uri:home}
        ]));
      }
      const applied=await applyPhoneIntentWork({
        env,request,org,webexFetch,phonismReader,enrollment,intent,throwOnFailure:true
      });
      const {result,target}=applied;
      return phoneXmlResponse(textMenu(result.rebootQueued?'Saved - Phone Restarting':'Saved - Reboot Needed',[
        {prompt:phoneMemberLabel(target),uri:home},
        {prompt:'Active for '+phoneDurationLabel(intent.durationMinutes),uri:home},
        {prompt:result.rebootQueued?'Rebooting automatically':'Reboot needs attention',uri:home},
        {prompt:'Return',uri:home}
      ]));
    }

    return phoneXmlResponse(phoneErrorMenu('not-found',home),404);
  }catch(error){
    return phoneXmlResponse(phoneErrorMenu(error?.code,home),Number.isInteger(error?.status)?error.status:500);
  }
}

export function createDeviceManagementHandler({webexFetch,checkAccess,loadIpRules,phonismReader=createPhonismReader()}){
  if(typeof webexFetch!=='function'||typeof checkAccess!=='function'||typeof loadIpRules!=='function'||!phonismReader)throw new Error('device-management-dependencies-required');
  return async function handler(request,env,cors={},executionContext=null){
    const headers={...cors};
    try{
      const url=new URL(request.url),origin=request.headers.get('Origin');
      let part=url.pathname.slice(PREFIX.length),accessToken=null,fleetKey=null,fleetMac=null;
      if(url.pathname.startsWith('/p/')){
        accessToken=decodeURIComponent(url.pathname.slice(3));
        const rawAction=url.searchParams.get('a')||'xml';
        part='phone/'+(PHONE_CODE_ACTION[rawAction]||rawAction);
      }else if(url.pathname.startsWith('/x/')){
        const segments=url.pathname.split('/').filter(Boolean);
        if(segments.length>=3&&segments.length<=4){fleetKey=decodeURIComponent(segments[1]);fleetMac=decodeURIComponent(segments[2]);}
        const rawAction=segments[3]||url.searchParams.get('a')||'xml';
        part='phone/'+(PHONE_CODE_ACTION[rawAction]||rawAction);
      }
      if(part.startsWith('phone/'))return handlePhoneSelfServiceRoute({request,env,part,webexFetch,phonismReader,accessToken,fleetKey,fleetMac,executionContext});
      if(!ORIGINS.has(origin))throw new DeviceManagementError('origin-denied',403);
      const readRoutes=new Set(['capabilities','locations','inventory','device-detail','members','history','operator-session','lease-status','identity-policy','admin-settings','admin-settings/fleet-keys','phone-enrollment']);
      const postRoutes=new Set(['operator-session','operator-session/logout','verification-request','verification-confirm',
        'admin-settings/verification','admin-settings/default-hours','admin-settings/durations/set','admin-settings/durations/remove',
        'admin-settings/admins/add','admin-settings/admins/remove','admin-settings/fleet-keys/rotate',
        'preview','apply','reboot','phone-enrollment','phone-enrollment/revoke']);
      if((request.method==='GET'&&!readRoutes.has(part))||(request.method==='POST'&&!postRoutes.has(part))||!['GET','POST'].includes(request.method))throw new DeviceManagementError('read-only-phase',405);
      const sourceIp=request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP');
      if(!request.cf||request.headers.has('CF-Worker')||!validIp(sourceIp))throw new DeviceManagementError('source-not-verifiable',403);
      if((await bounded(checkAccess(request,env),8000))?.allowed!==true)throw new DeviceManagementError('access-denied',403);
      const rules=await bounded(loadIpRules(env),8000);
      if(!Array.isArray(rules)||!rules.some(v=>typeof v==='string'&&v.trim()))throw new DeviceManagementError('approved-network-required',403);

      const writeParts=new Set(['preview','apply','reboot']);
      const writeScope=deviceWriteScope(env);
      if(writeParts.has(part)&&writeScope==='disabled')throw new DeviceManagementError('read-only-phase',405);

      if(part==='identity-policy'){
        return output({success:true,...await identityPolicy(env,request)},200,headers);
      }

      if(part==='verification-request'){
        const body=await readSmallJson(request,2048);
        if(!body||Object.keys(body).some(k=>!['name','email'].includes(k)))throw new DeviceManagementError('invalid-verification-request');
        const result=await requestVerificationCode(env,request,body);
        return output({success:true,...result},result.required===false?200:201,headers);
      }

      if(part==='verification-confirm'){
        const body=await readSmallJson(request,1024);
        if(!body||Object.keys(body).some(k=>!['challengeId','code'].includes(k)))throw new DeviceManagementError('invalid-verification-confirmation');
        const verified=await confirmVerificationCode(env,request,body);
        const config=await loadIdentityConfig(env);
        const sessionHours=verificationHoursFor(config,verified.operator.email);
        const session=await createOperatorSession(env,request,verified.operator,{
          verified:true,verificationMethod:'email-code',verifiedAt:verified.verifiedAt,
          ttlSeconds:sessionHours*60*60
        });
        return output({success:true,sessionId:session.id,operator:session.operator,verified:true,
          verificationMethod:session.verificationMethod,verifiedAt:session.verifiedAt,
          sessionHours,startedAt:session.startedAt,expiresAt:session.expiresAt},201,headers);
      }

      if(part==='operator-session/logout'){
        const sessionId=request.headers.get('X-VB-Operator-Session');
        await deleteOperatorSession(env,sessionId);
        return output({success:true},200,headers);
      }

      if(part==='operator-session'){
        if(request.method==='POST'){
          if(await verificationRequired(env))throw new DeviceManagementError('operator-verification-required',403);
          const body=await readSmallJson(request,2048);
          const session=await createOperatorSession(env,request,body,{verified:false,verificationMethod:'disabled'});
          return output({success:true,sessionId:session.id,operator:session.operator,verified:false,
            verificationMethod:session.verificationMethod,startedAt:session.startedAt,expiresAt:session.expiresAt},201,headers);
        }
        const session=await readOperatorSession(env,request.headers.get('X-VB-Operator-Session'));
        if(!session)throw new DeviceManagementError('operator-session-required',401);
        return output({success:true,sessionId:session.id,operator:session.operator,verified:session.verified===true,
          verificationMethod:session.verificationMethod||'none',verifiedAt:session.verifiedAt||null,
          sessionHours:Math.max(1,Math.round(Number(session.ttlSeconds||0)/3600)),
          startedAt:session.startedAt,expiresAt:session.expiresAt},200,headers);
      }

      if(part==='admin-settings'){
        return output({success:true,...await getAdminSettings(env,request)},200,headers);
      }

      if(part==='admin-settings/fleet-keys'){
        await requireDeviceAdmin(env,request);
        return output({success:true,...await getFleetKeySettings(env,{origin:url.origin})},200,headers);
      }

      if(part==='admin-settings/fleet-keys/rotate'){
        const {admin}=await requireDeviceAdmin(env,request);
        const body=await readSmallJson(request,1024);
        if(!body||body.confirm!==true||Object.keys(body).some(k=>!['confirm','expectedActiveKeyId'].includes(k)))throw new DeviceManagementError('invalid-admin-request');
        await rotateFleetKey(env,{expectedActiveKeyId:body.expectedActiveKeyId||null,actor:admin.email||admin.username||'admin'});
        return output({success:true,...await getFleetKeySettings(env,{origin:url.origin})},201,headers);
      }

      if(part==='admin-settings/verification'){
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.enabled!=='boolean'||Object.keys(body).some(k=>k!=='enabled'))throw new DeviceManagementError('invalid-admin-setting');
        const settings=await setVerificationEnabled(env,request,body.enabled);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,
          defaultVerificationHours:settings.defaultVerificationHours,verificationHoursByEmail:settings.verificationHoursByEmail,
          updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='admin-settings/default-hours'){
        const body=await readSmallJson(request,1024);
        if(!body||!Number.isFinite(Number(body.hours))||Object.keys(body).some(k=>k!=='hours'))throw new DeviceManagementError('invalid-admin-setting');
        const settings=await setDefaultVerificationHours(env,request,body.hours);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,
          defaultVerificationHours:settings.defaultVerificationHours,verificationHoursByEmail:settings.verificationHoursByEmail,
          updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='admin-settings/durations/set'){
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.email!=='string'||!Number.isFinite(Number(body.hours))||Object.keys(body).some(k=>!['email','hours'].includes(k)))throw new DeviceManagementError('invalid-admin-setting');
        const settings=await setUserVerificationHours(env,request,body.email,body.hours);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,
          defaultVerificationHours:settings.defaultVerificationHours,verificationHoursByEmail:settings.verificationHoursByEmail,
          updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='admin-settings/durations/remove'){
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.email!=='string'||Object.keys(body).some(k=>k!=='email'))throw new DeviceManagementError('invalid-admin-setting');
        const settings=await removeUserVerificationHours(env,request,body.email);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,
          defaultVerificationHours:settings.defaultVerificationHours,verificationHoursByEmail:settings.verificationHoursByEmail,
          updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='admin-settings/admins/add'){
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.email!=='string'||Object.keys(body).some(k=>k!=='email'))throw new DeviceManagementError('invalid-admin-request');
        const settings=await addDeviceAdmin(env,request,body.email);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='admin-settings/admins/remove'){
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.email!=='string'||Object.keys(body).some(k=>k!=='email'))throw new DeviceManagementError('invalid-admin-request');
        const settings=await removeDeviceAdmin(env,request,body.email);
        return output({success:true,verificationEnabled:settings.verificationEnabled,admins:settings.admins,updatedAt:settings.updatedAt,updatedBy:settings.updatedBy},200,headers);
      }

      if(part==='phone-enrollment'&&request.method==='GET'){
        const mac=url.searchParams.get('mac');
        if(!mac)throw new DeviceManagementError('device-mac-required');
        const status=await phoneEnrollmentStatus(env,mac);
        const telemetry=(await phoneTelemetryIndex(env)).byMac.get(normalizeMac(mac).toUpperCase())||null;
        return output({success:true,...status,telemetry:telemetry?{
          phoneIp:telemetry.phoneIp||null,sourceIp:telemetry.sourceIp||null,model:telemetry.model||'',firmware:telemetry.firmware||'',
          lastSeenAt:telemetry.lastSeenAt||null,lastEvent:telemetry.event||null
        }:null},200,headers);
      }

      if(part==='history'){
        const history=await listAuditRecords(env,{limit:url.searchParams.get('limit')||100});
        return output({success:true,rows:history.rows,complete:history.complete,readOnly:true},200,headers);
      }

      const org=String(env.WEBEX_ORG_ID||'').trim();if(!org)throw new DeviceManagementError('webex-org-not-configured',503);

      if(part==='phone-enrollment'&&request.method==='POST'){
        const {admin}=await requireDeviceAdmin(env,request);
        const body=await readSmallJson(request,2048);
        if(!body||Object.keys(body).some(k=>!['deviceId','locationId','phonismPhoneId'].includes(k)))throw new DeviceManagementError('invalid-phone-enrollment-request');
        const deviceId=id(body.deviceId),locationId=id(body.locationId),phonismPhoneId=id(String(body.phonismPhoneId||''));
        if(!deviceId||!locationId||!phonismPhoneId)throw new DeviceManagementError('device-location-phonism-required');
        const ctx=await resolveWriteContext({env,org,webexFetch,phonismReader,deviceId,locationId,phonismPhoneId});
        const requestUrl=new URL(request.url);
        const baseUrl=new URL(PREFIX.slice(0,-1),requestUrl.origin).toString();
        const shortBaseUrl=new URL('/p',requestUrl.origin).toString();
        const result=await createPhoneEnrollment(env,{device:ctx.device,location:ctx.location,phonismPhoneId:ctx.phone.id,admin,baseUrl,shortBaseUrl});
        return output({success:true,...result,message:'Phone self-service enrollment created for Yealink line key 7. No XML username or password is required; the handset uses its device-bound button URL.'},201,headers);
      }

      if(part==='phone-enrollment/revoke'){
        await requireDeviceAdmin(env,request);
        const body=await readSmallJson(request,1024);
        if(!body||typeof body.mac!=='string'||Object.keys(body).some(k=>k!=='mac'))throw new DeviceManagementError('invalid-phone-enrollment-request');
        return output({success:true,...await revokePhoneEnrollment(env,body.mac)},200,headers);
      }

      if(part==='locations'){
        const page=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations']);
        const locations=page.rows.map(x=>({id:id(x?.id),name:display(x?.name||x?.displayName,120),address:display([x?.address?.city,x?.address?.state].filter(Boolean).join(', '),160)})).filter(x=>x.id);
        return output({success:true,locations,truncated:page.truncated,readOnly:true},200,headers);
      }
      if(part==='capabilities'){
        const checks=[];let locationsOk=false,devicesOk=false,memberRead='not-tested',callingCount=0,deviceCount=0;
        const locationsProbe=(async()=>{
          try{
            const p=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations'],3,500);
            locationsOk=true;checks.push({label:'Webex locations read',status:'Available ('+p.rows.length+')'});
          }catch{checks.push({label:'Webex locations read',status:'Unavailable'});}
        })();

        let discovery=null;
        try{discovery=await phonismReader.discover(env,org);}catch{}
        const phonismPromise=readPhonismCapabilities(env,org,phonismReader,discovery);
        const deviceProbe=(async()=>{
          if(!discovery)return;
          try{
            const samples=await Promise.all(discovery.tenants.slice(0,4).map(async tenant=>{
              try{return await phonismReader.tenantPhones(env,tenant.id,tenant.name);}catch{return {phones:[]};}
            }));
            const samplePhone=samples.find(sample=>sample?.phones?.length)?.phones?.[0]||null;
            if(!samplePhone)return;
            const found=await firstWebexDeviceForPhone(webexFetch,env,samplePhone);
            if(!found)return;
            devicesOk=true;deviceCount=1;
            const base=deviceBase(found.data);
            callingCount=base.callingDeviceId?1:0;
            checks.push({label:'VisionBank Webex device lookup',status:'Available'});
            if(base.callingDeviceId)try{
              const data=await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(base.callingDeviceId)+'/members?orgId='+encodeURIComponent(org),{method:'GET'}),12000));
              memberRead=Array.isArray(data.members)||Array.isArray(data.items)?'available':'unavailable';
              checks.push({label:'Calling device members read',status:memberRead==='available'?'Available':'Unavailable'});
            }catch{memberRead='unavailable';checks.push({label:'Calling device members read',status:'Unavailable'});}
          }catch{}
        })();

        const [phonism]=await Promise.all([phonismPromise,locationsProbe,deviceProbe]);
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
          const [all,numberPage,leaseIndex,enrollmentIndex,telemetryIndex]=await Promise.all([
            phonismReader.phones(env,discovery.domain.id,discovery.tenants),
            readPaged(webexFetch,env,WEBEX+'/telephony/config/numbers?orgId='+encodeURIComponent(org)+'&max=1000',['phoneNumbers'],10,10000)
              .catch(()=>({rows:[],pages:0,truncated:false})),
            activeLeaseIndex(env).catch(()=>null),
            phoneEnrollmentIndex(env).catch(()=>null),
            phoneTelemetryIndex(env).catch(()=>null)
          ]);
          const tenantById=new Map(discovery.tenants.map(t=>[String(t.id),t]));
          const numberDirectory=summaryNumberDirectory(numberPage.rows);
          const devices=all.phones.map(phone=>attachPhoneSelfService(attachLease({
            ...summaryPhoneRow(phone,tenantById.get(String(phone.tenantId))||null,numberDirectory),
            writeEligible:isPilotDevice(env,phone.mac)
          },leaseIndex),enrollmentIndex,telemetryIndex));
          return output({success:true,devices,summaryOnly:true,truncated:all.truncated||numberPage.truncated,
            phonism:{ready:true,domainName:discovery.domain.name,tenantCount:discovery.tenants.length,phoneCount:devices.length},
            summaryExtensionSource:numberPage.rows.length?'webex-number-directory':'unavailable',
            message:'Showing all VisionBank Iowa phones with available primary extension summaries. Select a location for full Webex and line details.',
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
        const [leaseIndex,enrollmentIndex,telemetryIndex]=await Promise.all([
          activeLeaseIndex(env).catch(()=>null),phoneEnrollmentIndex(env).catch(()=>null),phoneTelemetryIndex(env).catch(()=>null)
        ]);
        const devices=detailed.map(d=>attachPhoneSelfService(attachLease({...d,writeEligible:isPilotDevice(env,d.mac)},leaseIndex),enrollmentIndex,telemetryIndex));
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
        const [leaseIndex,enrollmentIndex,telemetryIndex]=await Promise.all([
          activeLeaseIndex(env).catch(()=>null),phoneEnrollmentIndex(env).catch(()=>null),phoneTelemetryIndex(env).catch(()=>null)
        ]);
        const detailed=attachPhoneSelfService(attachLease({...device,detailsLoaded:true,writeEligible:isPilotDevice(env,device.mac)},leaseIndex),enrollmentIndex,telemetryIndex);
        return output({success:true,device:detailed,generatedAt:new Date().toISOString(),readOnly:true},200,headers);
      }

      if(part==='members'){
        const deviceId=id(url.searchParams.get('deviceId'));
        if(!deviceId)throw new DeviceManagementError('device-required');
        const query=display(url.searchParams.get('q')||'',160);
        const limit=memberResultLimit(url.searchParams.get('limit'));
        const includeAppearances=url.searchParams.get('details')==='1';
        const searched=await searchEligibleMembers({webexFetch,env,org,deviceId,query});
        const eligibleMatches=searched.members
          .map(m=>({...m,available:true,availability:'available'}))
          .sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))||String(a.extension||'').localeCompare(String(b.extension||'')));
        const eligibleIds=new Set(eligibleMatches.map(m=>String(m.id)));
        const fallbackMatches=query?await findUnavailableMemberMatches({
          env,org,webexFetch,phonismReader,deviceId,query,eligibleIds,limit:Math.min(limit,5),includeAppearances
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
          detailsPending:Boolean(query&&!includeAppearances&&unavailableMatches.length),deviceId,scope:'organization',query,limit,
          searchMode:query?'webex-upstream':'default',readOnly:true},200,headers);
      }

      if(part==='preview'){
        const session=await requireWriteOperator(env,request);
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
        const session=await requireWriteOperator(env,request);
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
        const session=await requireWriteOperator(env,request);
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
