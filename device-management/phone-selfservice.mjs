import {DeviceManagementError,normalizeMac,validateTemporaryDuration} from './contracts.mjs';

const ENROLL_PREFIX='device-phone-enrollment:';
const USER_PREFIX='device-phone-user:';
const ACCESS_PREFIX='device-phone-access:';
const TELEMETRY_PREFIX='device-phone-telemetry:';
const INTENT_PREFIX='device-phone-intent:';
const USER_RE=/^[A-Za-z0-9]{8,15}$/;
const PASSWORD_RE=/^[A-Za-z0-9]{12,15}$/;
const ACCESS_RE=/^[A-Za-z0-9]{20,32}$/;
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const DURATIONS=[15,30,60,120,240,480,720];

const clean=(value,max=180)=>String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);
const xmlEscape=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const randomAlphaNumeric=(length)=>{
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes=crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes,b=>chars[b%chars.length]).join('');
};
const sha256=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(String(value)))),b=>b.toString(16).padStart(2,'0')).join('');
const safeIp=value=>{
  const ip=clean(value,45);
  if(!ip)return null;
  if(ip.includes(':')){try{return new URL('http://['+ip+']/').hostname.length>2?ip:null;}catch{return null;}}
  const parts=ip.split('.');return parts.length===4&&parts.every(p=>/^\d{1,3}$/.test(p)&&Number(p)<=255)?ip:null;
};
const enrollmentKey=mac=>ENROLL_PREFIX+normalizeMac(mac).replace(/:/g,'');
const telemetryKey=mac=>TELEMETRY_PREFIX+normalizeMac(mac).replace(/:/g,'');

async function readJson(kv,key){
  if(!kv?.get)return null;
  const raw=await kv.get(key);
  if(!raw)return null;
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
}
async function putJson(kv,key,value,options){
  if(!kv?.put)throw new DeviceManagementError('phone-selfservice-store-unavailable',503);
  await kv.put(key,JSON.stringify(value),options);
  return value;
}
async function accessKey(token){return ACCESS_PREFIX+await sha256(token);}

export function phoneDurationOptions(){return [...DURATIONS];}
export function phoneDurationLabel(minutes){
  const value=validateTemporaryDuration(minutes);
  if(value<60)return value+' minutes';
  const hours=value/60;
  return Number.isInteger(hours)?hours+(hours===1?' hour':' hours'):value+' minutes';
}
export function phoneXmlResponse(xml,status=200,headers={}){
  return new Response(xml,{status,headers:{'Content-Type':'application/xml; charset=UTF-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
}
export function phoneNoContent(status=204,headers={}){
  return new Response(null,{status,headers:{'Cache-Control':'no-store',...headers}});
}
export function phoneUnauthorized(){
  return phoneXmlResponse(textMenu('VisionBank Device Manager',[
    {prompt:'Phone authorization required',uri:'SoftKey:Exit'}
  ]),401,{'WWW-Authenticate':'Basic realm="VisionBank Device Manager", charset="UTF-8"'});
}

export function textMenu(title,items,{cancelAction='SoftKey:Exit',timeout=120}={}){
  const safeItems=(Array.isArray(items)?items:[]).slice(0,30);
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<YealinkIPPhoneTextMenu style="numbered" Beep="no" wrapList="yes" Timeout="'+Number(timeout||120)+'" cancelAction="'+xmlEscape(cancelAction)+'">'+
    '<Title wrap="yes">'+xmlEscape(title)+'</Title>'+
    safeItems.map(item=>'<MenuItem><Prompt>'+xmlEscape(item.prompt)+'</Prompt><URI>'+xmlEscape(item.uri)+'</URI></MenuItem>').join('')+
    '</YealinkIPPhoneTextMenu>';
}

export function inputScreen(title,prompt,url,parameter='q',{cancelAction='SoftKey:Exit',type='string'}={}){
  return '<?xml version="1.0" encoding="UTF-8"?>\n'+
    '<YealinkIPPhoneInputScreen type="'+xmlEscape(type)+'" Beep="no" Password="no" Timeout="120" cancelAction="'+xmlEscape(cancelAction)+'">'+
    '<Title wrap="yes">'+xmlEscape(title)+'</Title><URL>'+xmlEscape(url)+'</URL>'+
    '<InputField type="'+xmlEscape(type)+'" password="no" editable="yes"><Prompt>'+xmlEscape(prompt)+'</Prompt>'+
    '<Parameter>'+xmlEscape(parameter)+'</Parameter></InputField></YealinkIPPhoneInputScreen>';
}

export function phoneErrorMenu(code,homeUrl){
  const messages={
    'phone-enrollment-not-found':'This phone is not enrolled for self-service.',
    'phone-enrollment-revoked':'Phone self-service is disabled for this phone.',
    'phone-credential-invalid':'Phone authorization failed.',
    'phone-active-lease':'A temporary Line 2 is already active. Wait for it to expire or manage it from the Device Management page.',
    'target-member-not-available':'That extension or number is no longer available for this phone.',
    'device-state-changed-review-again':'The phone assignment changed. Start again and review the current lines.',
    'device-write-not-enabled':'Phone self-service is not enabled for this device.',
    'phonism-enterprise-sync-company-required':'Phonism Sync is not ready for this phone.',
    'preview-expired':'The confirmation expired. Start again.'
  };
  return textMenu('VisionBank Device Manager',[
    {prompt:messages[code]||'The requested phone change could not be completed.',uri:homeUrl||'SoftKey:Exit'},
    ...(homeUrl?[{prompt:'Return to Manage Extensions',uri:homeUrl}]:[])
  ]);
}

export async function createPhoneEnrollment(env,{device,location,phonismPhoneId,admin,baseUrl,shortBaseUrl,now=Date.now()}){
  if(!env?.LOGS?.put||!env?.LOGS?.get)throw new DeviceManagementError('phone-selfservice-store-unavailable',503);
  const mac=normalizeMac(device?.mac);
  if(!device?.id||!location?.id||!phonismPhoneId)throw new DeviceManagementError('device-location-phonism-required');
  const accessToken=randomAlphaNumeric(22),accessHash=await sha256(accessToken),checkinKey=randomAlphaNumeric(24);
  const enrollmentId=crypto.randomUUID(),createdAt=new Date(now).toISOString();
  const record={
    enrollmentId,status:'active',authMode:'device-link',accessHash,
    checkinHash:await sha256(enrollmentId+'|'+checkinKey),
    device:{id:String(device.id),name:clean(device.displayName||device.name||device.model||'Phone',160),mac,model:clean(device.model||'',120)},
    location:{id:String(location.id),name:clean(location.name||'',120)},
    phonismPhoneId:String(phonismPhoneId),createdAt,updatedAt:createdAt,
    createdBy:{email:clean(admin?.email||'',254),username:clean(admin?.username||'',160)}
  };
  const old=await readJson(env.LOGS,enrollmentKey(mac));
  if(old?.username)await env.LOGS.delete?.(USER_PREFIX+old.username);
  if(old?.accessHash)await env.LOGS.delete?.(ACCESS_PREFIX+old.accessHash);
  await putJson(env.LOGS,enrollmentKey(mac),record);
  await putJson(env.LOGS,ACCESS_PREFIX+accessHash,{mac,status:'active',enrollmentId});
  const root=String(baseUrl||'').replace(/\/$/,'');
  const shortRoot=String(shortBaseUrl||'').replace(/\/$/,'');
  const xmlUrl=shortRoot+'/'+accessToken;
  const buttonUrl=xmlUrl+'?m=$mac&i=$ip';
  if(buttonUrl.length>99)throw new DeviceManagementError('phone-button-url-too-long',500);
  const checkinBase=root+'/phone/checkin?e='+encodeURIComponent(enrollmentId)+'&k='+encodeURIComponent(checkinKey);
  return {
    enrollment:{enrollmentId,status:'active',authMode:'device-link',createdAt,device:record.device,location:record.location,phonismPhoneId:record.phonismPhoneId},
    xmlUrl,buttonUrl,lineKey:7,
    checkinUrls:{
      startup:checkinBase+'&event=startup&mac=$mac&ip=$ip&model=$model&firmware=$firmware',
      registered:checkinBase+'&event=registered&mac=$mac&ip=$ip&model=$model&firmware=$firmware',
      ipChange:checkinBase+'&event=ip-change&mac=$mac&ip=$ip&model=$model&firmware=$firmware'
    },
    provisioning:[
      'linekey.7.type = 27',
      'linekey.7.value = '+buttonUrl,
      'linekey.7.label = Manage Ext',
      'action_url.setup_completed = '+checkinBase+'&event=startup&mac=$mac&ip=$ip&model=$model&firmware=$firmware',
      'action_url.registered = '+checkinBase+'&event=registered&mac=$mac&ip=$ip&model=$model&firmware=$firmware',
      'action_url.ip_change = '+checkinBase+'&event=ip-change&mac=$mac&ip=$ip&model=$model&firmware=$firmware'
    ].join('\n')
  };
}

export async function revokePhoneEnrollment(env,mac,{now=Date.now()}={}){
  const key=enrollmentKey(mac),record=await readJson(env.LOGS,key);
  if(!record)return {status:'not-enrolled'};
  if(record.username)await env.LOGS.delete?.(USER_PREFIX+record.username);
  if(record.accessHash)await env.LOGS.delete?.(ACCESS_PREFIX+record.accessHash);
  const next={...record,status:'revoked',updatedAt:new Date(now).toISOString(),revokedAt:new Date(now).toISOString(),passwordHash:null,checkinHash:null,accessHash:null};
  await putJson(env.LOGS,key,next);
  return {status:'revoked',enrollmentId:record.enrollmentId};
}

export async function phoneEnrollmentStatus(env,mac){
  const record=await readJson(env.LOGS,enrollmentKey(mac));
  if(!record)return {status:'not-enrolled',enrolled:false};
  return {status:record.status||'unknown',enrolled:record.status==='active',enrollmentId:record.enrollmentId||null,
    authMode:record.authMode|| (record.username?'basic':'unknown'),
    createdAt:record.createdAt||null,updatedAt:record.updatedAt||null,device:record.device||null};
}

export async function phoneEnrollmentIndex(env){
  if(!env?.LOGS?.list)return {byMac:new Map()};
  const listed=await env.LOGS.list({prefix:ENROLL_PREFIX,limit:1000});
  const byMac=new Map();
  for(const key of listed.keys||[]){
    const record=await readJson(env.LOGS,key.name);
    if(record?.device?.mac)byMac.set(String(record.device.mac).toUpperCase(),record);
  }
  return {byMac};
}

export async function phoneTelemetryIndex(env){
  if(!env?.LOGS?.list)return {byMac:new Map()};
  const listed=await env.LOGS.list({prefix:TELEMETRY_PREFIX,limit:1000});
  const byMac=new Map();
  for(const key of listed.keys||[]){
    const record=await readJson(env.LOGS,key.name);
    if(record?.mac)byMac.set(String(record.mac).toUpperCase(),record);
  }
  return {byMac};
}

export async function authenticatePhoneAccess(env,token){
  const value=String(token||'').trim();
  if(!ACCESS_RE.test(value))throw new DeviceManagementError('phone-credential-invalid',403);
  const lookup=await readJson(env.LOGS,await accessKey(value));
  if(!lookup||lookup.status!=='active')throw new DeviceManagementError('phone-credential-invalid',403);
  const enrollment=await readJson(env.LOGS,enrollmentKey(lookup.mac));
  if(!enrollment||enrollment.status!=='active'||enrollment.enrollmentId!==lookup.enrollmentId||enrollment.accessHash!==await sha256(value)){
    throw new DeviceManagementError('phone-enrollment-revoked',403);
  }
  return enrollment;
}

export async function authenticatePhone(env,request){
  const auth=String(request.headers.get('Authorization')||'');
  if(!auth.startsWith('Basic '))throw new DeviceManagementError('phone-credential-required',401);
  let decoded='';
  try{decoded=atob(auth.slice(6).trim());}catch{throw new DeviceManagementError('phone-credential-invalid',401);}
  const split=decoded.indexOf(':');
  if(split<1)throw new DeviceManagementError('phone-credential-invalid',401);
  const username=decoded.slice(0,split),password=decoded.slice(split+1);
  if(!USER_RE.test(username)||!PASSWORD_RE.test(password))throw new DeviceManagementError('phone-credential-invalid',401);
  const lookup=await readJson(env.LOGS,USER_PREFIX+username);
  if(!lookup||lookup.status!=='active')throw new DeviceManagementError('phone-credential-invalid',401);
  const expected=lookup.passwordHash,actual=await sha256(username+'|'+password);
  if(!expected||expected!==actual)throw new DeviceManagementError('phone-credential-invalid',401);
  const enrollment=await readJson(env.LOGS,enrollmentKey(lookup.mac));
  if(!enrollment||enrollment.status!=='active'||enrollment.username!==username)throw new DeviceManagementError('phone-enrollment-revoked',403);
  return enrollment;
}

export async function recordPhoneSeen(env,request,enrollment,{reportedIp=null,model=null,firmware=null,event='xml-browser',now=Date.now()}={}){
  const sourceIp=safeIp(request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP'))||'unknown';
  const telemetry={
    mac:enrollment.device.mac,deviceId:enrollment.device.id,enrollmentId:enrollment.enrollmentId,
    phoneIp:safeIp(reportedIp),sourceIp,model:clean(model||enrollment.device.model||'',120),firmware:clean(firmware||'',120),
    event:clean(event,40),lastSeenAt:new Date(now).toISOString()
  };
  const previous=await readJson(env.LOGS,telemetryKey(enrollment.device.mac));
  await putJson(env.LOGS,telemetryKey(enrollment.device.mac),{...previous,...telemetry,phoneIp:telemetry.phoneIp||previous?.phoneIp||null,firmware:telemetry.firmware||previous?.firmware||''});
  return {...previous,...telemetry,phoneIp:telemetry.phoneIp||previous?.phoneIp||null,firmware:telemetry.firmware||previous?.firmware||''};
}

export async function handlePhoneCheckin(env,request){
  const url=new URL(request.url),enrollmentId=clean(url.searchParams.get('e'),64),key=clean(url.searchParams.get('k'),64);
  if(!UUID.test(enrollmentId)||!key)throw new DeviceManagementError('phone-checkin-invalid',403);
  let enrollment=null;
  const listed=await env.LOGS.list({prefix:ENROLL_PREFIX,limit:1000});
  for(const entry of listed.keys||[]){
    const candidate=await readJson(env.LOGS,entry.name);
    if(candidate?.enrollmentId===enrollmentId){enrollment=candidate;break;}
  }
  if(!enrollment||enrollment.status!=='active'||!enrollment.checkinHash)throw new DeviceManagementError('phone-checkin-invalid',403);
  if(await sha256(enrollmentId+'|'+key)!==enrollment.checkinHash)throw new DeviceManagementError('phone-checkin-invalid',403);
  const suppliedMac=url.searchParams.get('mac');
  if(suppliedMac){
    let mac;try{mac=normalizeMac(suppliedMac);}catch{throw new DeviceManagementError('phone-checkin-mac-mismatch',403);}
    if(mac!==enrollment.device.mac)throw new DeviceManagementError('phone-checkin-mac-mismatch',403);
  }
  await recordPhoneSeen(env,request,enrollment,{
    reportedIp:url.searchParams.get('ip'),model:url.searchParams.get('model'),firmware:url.searchParams.get('firmware'),event:url.searchParams.get('event')||'checkin'
  });
  return {success:true};
}

export async function createPhoneIntent(env,enrollment,{memberId,memberQuery,memberLocationId,durationMinutes,now=Date.now()}){
  const minutes=validateTemporaryDuration(durationMinutes),intentId=crypto.randomUUID(),mutationId=crypto.randomUUID();
  const intent={intentId,mutationId,enrollmentId:enrollment.enrollmentId,memberId:clean(memberId,180),memberQuery:clean(memberQuery,160),
    memberLocationId:clean(memberLocationId,180)||null,durationMinutes:minutes,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+5*60_000).toISOString(),status:'pending'};
  if(!intent.memberId)throw new DeviceManagementError('target-member-not-available',409);
  await putJson(env.SESSIONS,INTENT_PREFIX+intentId,intent,{expirationTtl:300});
  return intent;
}

export async function readPhoneIntent(env,intentId,enrollment){
  if(!UUID.test(String(intentId||'')))throw new DeviceManagementError('preview-expired',409);
  const intent=await readJson(env.SESSIONS,INTENT_PREFIX+intentId);
  if(!intent||intent.enrollmentId!==enrollment.enrollmentId||Date.parse(intent.expiresAt||'')<=Date.now())throw new DeviceManagementError('preview-expired',409);
  return intent;
}

export async function finishPhoneIntent(env,intentId,result){
  const intent=await readJson(env.SESSIONS,INTENT_PREFIX+intentId);
  if(intent)await putJson(env.SESSIONS,INTENT_PREFIX+intentId,{...intent,status:'completed',result,completedAt:new Date().toISOString()},{expirationTtl:300});
}

export function phoneSession(enrollment){
  return {
    id:'phone:'+enrollment.enrollmentId,actorType:'device',verified:true,verificationMethod:'device-token',verifiedAt:new Date().toISOString(),
    operator:{name:(enrollment.device.model?enrollment.device.model+' ':'Phone ')+enrollment.device.mac,email:''},
    deviceIdentity:{mac:enrollment.device.mac,model:enrollment.device.model||'',enrollmentId:enrollment.enrollmentId}
  };
}

export function attachPhoneSelfService(device,enrollmentIndex,telemetryIndex){
  const mac=String(device?.mac||'').toUpperCase(),enrollment=enrollmentIndex?.byMac?.get(mac)||null,telemetry=telemetryIndex?.byMac?.get(mac)||null;
  return {...device,phoneSelfService:{
    enrolled:enrollment?.status==='active',status:enrollment?.status||'not-enrolled',enrollmentId:enrollment?.enrollmentId||null,
    authMode:enrollment?.authMode|| (enrollment?.username?'basic':'unknown'),
    phoneIp:telemetry?.phoneIp||null,sourceIp:telemetry?.sourceIp||null,model:telemetry?.model||device?.model||'',firmware:telemetry?.firmware||'',
    lastSeenAt:telemetry?.lastSeenAt||null,lastEvent:telemetry?.event||null
  }};
}
