import {DeviceManagementError} from './contracts.mjs';
import {readOperatorSession} from './audit.mjs';

const CONFIG_KEY='device-identity:config:v1';
const ADMIN_AUDIT_PREFIX='device-identity-audit:';
const CHALLENGE_PREFIX='device-verify:';
const RATE_PREFIX='device-verify-rate:';
const CODE_TTL_SECONDS=10*60;
const RESEND_SECONDS=60;
const MAX_ATTEMPTS=5;
const MAX_SENDS_PER_HOUR=5;
const DEFAULT_VERIFICATION_HOURS=24;
const MAX_VERIFICATION_HOURS=720;

export const SHARED_ADMIN_MAILBOXES=['infotech@visionbank.com'];

export const DEFAULT_DEVICE_ADMINS=[
  'ahmed.adeyemi@ussignal.com',
  'matthew.saylor@visionbank.com',
  'rhonda.whitney@visionbank.com',
  'marc.maehner@visionbank.com',
  'chad.bockholt@visionbank.com',
  'joshua.stjohn@visionbank.com',
  'infotech@visionbank.com',
  'david.vanbruggen@visionbank.com'
];

const clean=(value,max=254)=>String(value??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);
const email=value=>clean(value,254).toLowerCase();
const validEmail=value=>/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email(value));
const validAdminEmail=value=>validEmail(value)&&['visionbank.com','ussignal.com'].includes(email(value).split('@')[1]||'');
const uniqueEmails=values=>[...new Set((Array.isArray(values)?values:[]).map(email).filter(validEmail))].sort();
const hours=value=>Math.min(Math.max(Number.parseInt(String(value??''),10)||DEFAULT_VERIFICATION_HOURS,1),MAX_VERIFICATION_HOURS);
const cleanOverrides=value=>{
  const out={};
  if(value&&typeof value==='object'&&!Array.isArray(value)){
    for(const [key,val] of Object.entries(value)){
      const mail=email(key);
      if(validEmail(mail))out[mail]=hours(val);
    }
  }
  return out;
};

export async function loadIdentityConfig(env){
  let saved=null;
  try{
    saved=await env?.LOGS?.get?.(CONFIG_KEY,'json');
    if(typeof saved==='string')saved=JSON.parse(saved);
  }catch{saved=null;}
  return {
    verificationEnabled:saved?.verificationEnabled!==false,
    admins:uniqueEmails(saved?.admins?.length?saved.admins:DEFAULT_DEVICE_ADMINS),
    defaultVerificationHours:hours(saved?.defaultVerificationHours??DEFAULT_VERIFICATION_HOURS),
    verificationHoursByEmail:cleanOverrides(saved?.verificationHoursByEmail),
    updatedAt:saved?.updatedAt||null,
    updatedBy:saved?.updatedBy||null
  };
}

async function saveIdentityConfig(env,config,actor){
  if(!env?.LOGS?.put)throw new DeviceManagementError('device-identity-store-unavailable',503);
  const next={
    verificationEnabled:config.verificationEnabled!==false,
    admins:uniqueEmails(config.admins),
    defaultVerificationHours:hours(config.defaultVerificationHours),
    verificationHoursByEmail:cleanOverrides(config.verificationHoursByEmail),
    updatedAt:new Date().toISOString(),
    updatedBy:actor?.email||actor?.username||'unknown'
  };
  if(!next.admins.length)throw new DeviceManagementError('device-admin-list-required',409);
  if(!next.admins.some(item=>!SHARED_ADMIN_MAILBOXES.includes(item)))throw new DeviceManagementError('device-individual-admin-required',409);
  await env.LOGS.put(CONFIG_KEY,JSON.stringify(next));
  return next;
}
async function readSecuritySession(env,request){
  const auth=String(request.headers.get('Authorization')||'');
  if(!auth.toLowerCase().startsWith('bearer '))return null;
  const token=auth.slice(7).trim();
  if(!token||!env?.SESSIONS?.get)return null;
  const raw=await env.SESSIONS.get(token);
  if(!raw)return null;
  let session;try{session=typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
  if(!session?.expires||Number(session.expires)<=Date.now()){
    if(env.SESSIONS.delete)await env.SESSIONS.delete(token);
    return null;
  }
  const username=email(session.username)||clean(session.username,160).toLowerCase();
  let user=null;
  try{
    const userRaw=await env?.ADMIN?.get?.(username);
    user=userRaw?(typeof userRaw==='string'?JSON.parse(userRaw):userRaw):null;
  }catch{}
  return {token,username,role:clean(session.role||user?.role||'unknown',40),user};
}

export async function resolveDeviceAdmin(env,request,configOverride=null){
  const config=configOverride||await loadIdentityConfig(env);

  const operatorSession=await readOperatorSession(env,request.headers.get('X-VB-Operator-Session'));
  const operatorEmail=email(operatorSession?.operator?.email);
  if(operatorSession?.verified===true&&config.admins.includes(operatorEmail)){
    return {
      username:clean(operatorSession.operator.name||operatorEmail,160),
      email:operatorEmail,role:'verified-operator',sessionId:operatorSession.id,
      authMethod:'verified-email'
    };
  }

  const session=await readSecuritySession(env,request);
  if(!session||!['superadmin','admin'].includes(String(session.role||'').toLowerCase()))return null;
  const identities=uniqueEmails([
    validEmail(session.username)?session.username:'',
    session.user?.email
  ]);
  const adminEmail=identities.find(value=>config.admins.includes(value));
  if(!adminEmail)return null;
  return {username:session.username,email:adminEmail,role:session.role,sessionId:session.token,authMethod:'security-session'};
}

export async function requireDeviceAdmin(env,request){
  const config=await loadIdentityConfig(env);
  const admin=await resolveDeviceAdmin(env,request,config);
  if(!admin)throw new DeviceManagementError('device-admin-session-required',403);
  return {config,admin};
}

function requestIp(request){
  return clean(request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP')||'unknown',64);
}

async function writeAdminAudit(env,request,admin,action,detail={}){
  if(!env?.LOGS?.put)return;
  const now=Date.now(),id=crypto.randomUUID(),reverse=String(9999999999999-now).padStart(13,'0');
  const record={id,at:new Date(now).toISOString(),action,actor:{username:admin.username,email:admin.email,role:admin.role},sourceIp:requestIp(request),detail};
  await env.LOGS.put(ADMIN_AUDIT_PREFIX+reverse+':'+id,JSON.stringify(record),{metadata:{at:record.at,action,adminEmail:admin.email}});
}
export async function identityPolicy(env,request){
  const config=await loadIdentityConfig(env);
  const admin=await resolveDeviceAdmin(env,request,config);
  return {
    verificationEnabled:config.verificationEnabled,
    adminAuthorized:Boolean(admin),
    admin:admin?{email:admin.email,username:admin.username,role:admin.role}:null
  };
}

export async function getAdminSettings(env,request){
  const {config,admin}=await requireDeviceAdmin(env,request);
  return {
    verificationEnabled:config.verificationEnabled,
    admins:config.admins,
    sharedMailboxes:SHARED_ADMIN_MAILBOXES.filter(value=>config.admins.includes(value)),
    defaultVerificationHours:config.defaultVerificationHours,
    verificationHoursByEmail:config.verificationHoursByEmail,
    updatedAt:config.updatedAt,updatedBy:config.updatedBy,
    currentAdmin:{
      email:admin.email,username:admin.username,role:admin.role,authMethod:admin.authMethod,
      sharedMailbox:SHARED_ADMIN_MAILBOXES.includes(admin.email)
    }
  };
}

export function verificationHoursFor(config,emailValue){
  const mail=email(emailValue);
  return hours(config?.verificationHoursByEmail?.[mail]??config?.defaultVerificationHours??DEFAULT_VERIFICATION_HOURS);
}

export async function setVerificationEnabled(env,request,enabled){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const next=await saveIdentityConfig(env,{...config,verificationEnabled:enabled===true},admin);
  await writeAdminAudit(env,request,admin,'verification-setting-changed',{enabled:next.verificationEnabled});
  return next;
}

export async function setDefaultVerificationHours(env,request,value){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const nextHours=hours(value);
  const next=await saveIdentityConfig(env,{...config,defaultVerificationHours:nextHours},admin);
  await writeAdminAudit(env,request,admin,'verification-default-hours-changed',{hours:nextHours});
  return next;
}

export async function setUserVerificationHours(env,request,emailValue,value){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const mail=email(emailValue);
  if(!validEmail(mail))throw new DeviceManagementError('verification-duration-email-invalid');
  const nextHours=hours(value);
  const overrides={...config.verificationHoursByEmail,[mail]:nextHours};
  const next=await saveIdentityConfig(env,{...config,verificationHoursByEmail:overrides},admin);
  await writeAdminAudit(env,request,admin,'verification-user-hours-changed',{email:mail,hours:nextHours});
  return next;
}

export async function removeUserVerificationHours(env,request,emailValue){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const mail=email(emailValue);
  if(!validEmail(mail))throw new DeviceManagementError('verification-duration-email-invalid');
  const overrides={...config.verificationHoursByEmail};
  delete overrides[mail];
  const next=await saveIdentityConfig(env,{...config,verificationHoursByEmail:overrides},admin);
  await writeAdminAudit(env,request,admin,'verification-user-hours-removed',{email:mail});
  return next;
}

export async function addDeviceAdmin(env,request,value){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const nextEmail=email(value);
  if(!validAdminEmail(nextEmail))throw new DeviceManagementError('device-admin-email-invalid');
  const next=await saveIdentityConfig(env,{...config,admins:[...config.admins,nextEmail]},admin);
  await writeAdminAudit(env,request,admin,'device-admin-added',{email:nextEmail});
  return next;
}

export async function removeDeviceAdmin(env,request,value){
  const {config,admin}=await requireDeviceAdmin(env,request);
  const removeEmail=email(value);
  if(!validAdminEmail(removeEmail))throw new DeviceManagementError('device-admin-email-invalid');
  if(removeEmail===admin.email)throw new DeviceManagementError('device-admin-self-remove-denied',409);
  if(!config.admins.includes(removeEmail))throw new DeviceManagementError('device-admin-not-found',404);
  const admins=config.admins.filter(item=>item!==removeEmail);
  if(!admins.length)throw new DeviceManagementError('device-admin-list-required',409);
  if(!admins.some(item=>!SHARED_ADMIN_MAILBOXES.includes(item)))throw new DeviceManagementError('device-individual-admin-required',409);
  const next=await saveIdentityConfig(env,{...config,admins},admin);
  await writeAdminAudit(env,request,admin,'device-admin-removed',{email:removeEmail});
  return next;
}
async function sha256(value){
  const bytes=new TextEncoder().encode(String(value));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

function randomCode(){
  const bytes=new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0]%1000000).padStart(6,'0');
}

function maskEmail(value){
  const [local,domain]=email(value).split('@');
  if(!domain)return '';
  return (local.length<=2?local[0]+'*':local.slice(0,2)+'***'+local.slice(-1))+'@'+domain;
}

async function sendVerificationEmail(env,to,code,{fetcher=fetch}={}){
  if(!env?.BREVO_API_KEY)throw new DeviceManagementError('verification-email-not-configured',503);
  const payload={
    sender:{email:'security@onenecklab.com',name:'VisionBank Security'},
    to:[{email:to}],
    subject:'VisionBank Device Manager verification code',
    textContent:'Your VisionBank Device Manager verification code is '+code+'. It expires in 10 minutes. If you did not request this code, contact IT.',
    htmlContent:'<div style="font-family:Arial,sans-serif;max-width:560px"><h2>VisionBank Device Manager</h2><p>Your verification code is:</p><div style="font-size:30px;font-weight:700;letter-spacing:8px;padding:16px 0">'+code+'</div><p>This code expires in 10 minutes.</p><p style="color:#66756f">If you did not request this code, contact IT.</p></div>'
  };
  const response=await fetcher('https://api.brevo.com/v3/smtp/email',{method:'POST',headers:{'Content-Type':'application/json','api-key':env.BREVO_API_KEY},body:JSON.stringify(payload)});
  if(!response.ok)throw new DeviceManagementError('verification-email-send-failed',502);
}
async function checkSendRate(env,emailValue,ip,{now=Date.now()}={}){
  const key=RATE_PREFIX+await sha256(emailValue+'|'+ip);
  let rate=null;
  try{const raw=await env.SESSIONS.get(key);rate=raw?JSON.parse(raw):null;}catch{}
  const hour=60*60*1000;
  if(!rate||now-Number(rate.windowStart||0)>=hour)rate={windowStart:now,count:0,lastSent:0};
  if(now-Number(rate.lastSent||0)<RESEND_SECONDS*1000)throw new DeviceManagementError('verification-resend-too-soon',429);
  if(Number(rate.count||0)>=MAX_SENDS_PER_HOUR)throw new DeviceManagementError('verification-rate-limited',429);
  rate.count=Number(rate.count||0)+1;rate.lastSent=now;
  await env.SESSIONS.put(key,JSON.stringify(rate),{expirationTtl:60*60});
}

export async function requestVerificationCode(env,request,operator,{now=Date.now(),fetcher=fetch}={}){
  const config=await loadIdentityConfig(env);
  if(!config.verificationEnabled)return {required:false};
  const name=clean(operator?.name,100),mail=email(operator?.email);
  if(name.length<2)throw new DeviceManagementError('operator-name-required');
  if(!validEmail(mail))throw new DeviceManagementError('operator-email-invalid');
  if(!env?.SESSIONS?.put)throw new DeviceManagementError('operator-session-store-unavailable',503);
  await checkSendRate(env,mail,requestIp(request),{now});
  const challengeId=crypto.randomUUID(),code=randomCode();
  const challenge={challengeId,name,email:mail,codeHash:await sha256(challengeId+'|'+mail+'|'+code),attempts:0,createdAt:new Date(now).toISOString(),expiresAt:new Date(now+CODE_TTL_SECONDS*1000).toISOString(),sourceIp:requestIp(request)};
  await env.SESSIONS.put(CHALLENGE_PREFIX+challengeId,JSON.stringify(challenge),{expirationTtl:CODE_TTL_SECONDS});
  try{await sendVerificationEmail(env,mail,code,{fetcher});}
  catch(error){if(env.SESSIONS.delete)await env.SESSIONS.delete(CHALLENGE_PREFIX+challengeId);throw error;}
  return {required:true,challengeId,emailMasked:maskEmail(mail),expiresAt:challenge.expiresAt,resendAfterSeconds:RESEND_SECONDS};
}

export async function confirmVerificationCode(env,request,body,{now=Date.now()}={}){
  const challengeId=clean(body?.challengeId,64),code=clean(body?.code,12);
  if(!/^[0-9a-f-]{36}$/i.test(challengeId)||!/^[0-9]{6}$/.test(code))throw new DeviceManagementError('verification-code-invalid',400);
  const key=CHALLENGE_PREFIX+challengeId;
  const raw=await env?.SESSIONS?.get?.(key);
  if(!raw)throw new DeviceManagementError('verification-challenge-expired',410);
  let challenge;try{challenge=typeof raw==='string'?JSON.parse(raw):raw;}catch{throw new DeviceManagementError('verification-challenge-expired',410);}
  if(Date.parse(challenge.expiresAt||'')<=now){if(env.SESSIONS.delete)await env.SESSIONS.delete(key);throw new DeviceManagementError('verification-challenge-expired',410);}
  if(challenge.sourceIp&&challenge.sourceIp!=='unknown'&&requestIp(request)!==challenge.sourceIp)throw new DeviceManagementError('verification-source-changed',403);
  const expected=await sha256(challengeId+'|'+challenge.email+'|'+code);
  if(expected!==challenge.codeHash){
    challenge.attempts=Number(challenge.attempts||0)+1;
    if(challenge.attempts>=MAX_ATTEMPTS){if(env.SESSIONS.delete)await env.SESSIONS.delete(key);throw new DeviceManagementError('verification-attempts-exceeded',429);}
    await env.SESSIONS.put(key,JSON.stringify(challenge),{expirationTtl:Math.max(60,Math.ceil((Date.parse(challenge.expiresAt)-now)/1000))});
    throw new DeviceManagementError('verification-code-invalid',400);
  }
  if(env.SESSIONS.delete)await env.SESSIONS.delete(key);
  return {operator:{name:challenge.name,email:challenge.email},verifiedAt:new Date(now).toISOString()};
}

export async function verificationRequired(env){
  return (await loadIdentityConfig(env)).verificationEnabled;
}
