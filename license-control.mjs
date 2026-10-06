const CONFIG_KEY='portal-license-config:v1';
const STATE_KEY='portal-license-state:v1';
const AUDIT_PREFIX='portal-license-audit:';
const ALLOWED_SOURCES=new Set(['primary','mirror','custom']);
const ADMIN_ROLES=new Set(['superadmin','admin']);
const PRIMARY_AUTHORITY_URL='https://dashboard-license-control.onrender.com';
const LEGACY_PRIMARY_AUTHORITY_URL='https://visionbank-license-control.onrender.com';
const DEFAULT_CONFIG={
  enforcementEnabled:false,
  activeSource:'primary',
  installationName:'VisionBank Production',
  systemId:null,
  primary:{repository:'ahmedadeyemi-cts/dashboard-license-control',authorityUrl:PRIMARY_AUTHORITY_URL},
  mirror:{repository:'ahmedadeyemi-uss/dashboard-license-control',authorityUrl:''},
  custom:{repository:'',authorityUrl:''},
  updatedAt:null,updatedBy:null
};

export class LicenseControlError extends Error{
  constructor(code,status=400){super(code);this.code=code;this.status=status;}
}
const clean=(v,max=500)=>String(v??'').trim().replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').slice(0,max);
const email=v=>clean(v,254).toLowerCase();
const nowIso=()=>new Date().toISOString();
const b64url=buffer=>{
  let s='';for(const x of new Uint8Array(buffer))s+=String.fromCharCode(x);
  return btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
};
const unb64url=value=>{
  let v=String(value).replace(/-/g,'+').replace(/_/g,'/');
  while(v.length%4)v+='=';
  const raw=atob(v);
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
async function jsonGet(kv,key){
  if(!kv?.get)return null;
  const raw=await kv.get(key);
  if(!raw)return null;
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
}
async function jsonPut(kv,key,value){
  if(!kv?.put)throw new LicenseControlError('license-store-unavailable',503);
  await kv.put(key,JSON.stringify(value));
  return value;
}
function safeHttpsUrl(value){
  if(!value)return '';
  let u;try{u=new URL(String(value));}catch{throw new LicenseControlError('license-authority-url-invalid');}
  if(u.protocol!=='https:'||u.username||u.password||u.hash)throw new LicenseControlError('license-authority-url-invalid');
  u.pathname=u.pathname.replace(/\/+$/,'');u.search='';
  return u.toString().replace(/\/$/,'');
}
function sourceRow(value={}){
  return {repository:clean(value.repository,180),authorityUrl:value.authorityUrl?safeHttpsUrl(value.authorityUrl):''};
}
function primarySourceRow(value={}){
  const row=sourceRow(value);
  const isPrimaryRepo=row.repository==='ahmedadeyemi-cts/dashboard-license-control'||row.repository==='ahmedadeyemi-cts/visionbank-license-control';
  if(isPrimaryRepo&&(!row.authorityUrl||row.authorityUrl===LEGACY_PRIMARY_AUTHORITY_URL)){
    row.repository='ahmedadeyemi-cts/dashboard-license-control';
    row.authorityUrl=PRIMARY_AUTHORITY_URL;
  }
  return row;
}
export async function loadLicenseConfig(env){
  const saved=await jsonGet(env?.LOGS,CONFIG_KEY);
  return {
    ...DEFAULT_CONFIG,...(saved||{}),
    primary:primarySourceRow(saved?.primary||DEFAULT_CONFIG.primary),
    mirror:sourceRow(saved?.mirror||DEFAULT_CONFIG.mirror),
    custom:sourceRow(saved?.custom||DEFAULT_CONFIG.custom),
    activeSource:ALLOWED_SOURCES.has(saved?.activeSource)?saved.activeSource:'primary',
    enforcementEnabled:saved?.enforcementEnabled===true,
    systemId:clean(saved?.systemId,80)||null,
    installationName:clean(saved?.installationName,160)||DEFAULT_CONFIG.installationName
  };
}
export function activeAuthority(config){
  const source=ALLOWED_SOURCES.has(config?.activeSource)?config.activeSource:'primary';
  const row=config?.[source]||{};
  return {source,repository:clean(row.repository,180),authorityUrl:row.authorityUrl?safeHttpsUrl(row.authorityUrl):''};
}
async function saveConfig(env,config,actor){
  const next={...config,updatedAt:nowIso(),updatedBy:actor?.email||actor?.username||'unknown'};
  await jsonPut(env.LOGS,CONFIG_KEY,next);
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
  if(!session?.expires||Number(session.expires)<=Date.now())return null;
  const username=email(session.username)||clean(session.username,160).toLowerCase();
  let user=null;
  try{
    const u=await env?.ADMIN?.get?.(username);
    user=u?(typeof u==='string'?JSON.parse(u):u):null;
  }catch{}
  return {token,username,role:clean(session.role||user?.role||'view',40).toLowerCase(),email:email(user?.email||username)};
}
export async function requireLicenseSession(env,request){
  const session=await readSecuritySession(env,request);
  if(!session)throw new LicenseControlError('security-session-required',401);
  return session;
}
export async function requireLicenseAdmin(env,request){
  const session=await requireLicenseSession(env,request);
  if(!ADMIN_ROLES.has(session.role))throw new LicenseControlError('license-admin-required',403);
  return session;
}
async function audit(env,request,actor,action,detail={}){
  if(!env?.LOGS?.put)return;
  const t=Date.now(),id=crypto.randomUUID(),reverse=String(9999999999999-t).padStart(13,'0');
  const record={
    id,at:new Date(t).toISOString(),action,
    actor:{username:actor?.username||'',email:actor?.email||'',role:actor?.role||''},
    sourceIp:clean(request.headers.get('CF-Connecting-IP')||request.headers.get('CF-Connecting-IPv6')||'unknown',64),
    detail
  };
  await env.LOGS.put(AUDIT_PREFIX+reverse+':'+id,JSON.stringify(record));
}
async function aesKey(env){
  const secret=String(env?.LICENSE_CONFIG_KEY||'');
  if(secret.length<32)throw new LicenseControlError('license-config-key-unavailable',503);
  const raw=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
  return crypto.subtle.importKey('raw',raw,{name:'AES-GCM'},false,['encrypt','decrypt']);
}
async function seal(env,value){
  const iv=crypto.getRandomValues(new Uint8Array(12)),key=await aesKey(env);
  const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(String(value)));
  return 'v1.'+b64url(iv)+'.'+b64url(cipher);
}
async function open(env,value){
  const [v,iv,cipher]=String(value||'').split('.');
  if(v!=='v1'||!iv||!cipher)throw new LicenseControlError('license-installation-token-invalid',503);
  try{
    const key=await aesKey(env);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(iv)},key,unb64url(cipher));
    return new TextDecoder().decode(plain);
  }catch{throw new LicenseControlError('license-installation-token-invalid',503);}
}
export async function loadLicenseState(env){return jsonGet(env?.LOGS,STATE_KEY);}
async function saveState(env,state){return jsonPut(env.LOGS,STATE_KEY,{...state,updatedAt:nowIso()});}
function stateAccess(config,state,{now=Date.now()}={}){
  if(config?.enforcementEnabled!==true)return {allowed:true,reason:'license-enforcement-disabled'};
  if(!state?.installationToken)return {allowed:false,reason:'license-required'};
  const expires=Date.parse(state.expiresAt||'');
  if(['revoked','expired','suspended'].includes(state.status)||state.access===false)
    return {allowed:false,reason:'license-'+(state.status||'invalid')};
  if(Number.isFinite(expires)&&now>=expires)return {allowed:false,reason:'license-expired'};
  const last=Date.parse(state.lastSuccessfulContactAt||state.activatedAt||'');
  const interval=Number(state.heartbeatIntervalHours||24)*3600000;
  const grace=Number(state.offlineGraceHours||2160)*3600000;
  if(!Number.isFinite(last))return {allowed:false,reason:'license-validation-required'};
  const dueAt=last+interval,deadline=dueAt+grace;
  if(now>deadline)return {
    allowed:false,reason:'license-validation-overdue',
    nextHeartbeatAt:new Date(dueAt).toISOString(),
    offlineDeadline:new Date(deadline).toISOString()
  };
  return {
    allowed:true,reason:now>=dueAt?'license-validation-due':'licensed',
    degraded:now>=dueAt,
    nextHeartbeatAt:new Date(dueAt).toISOString(),
    offlineDeadline:new Date(deadline).toISOString()
  };
}
function publicState(config,state,{now=Date.now()}={}){
  const access=stateAccess(config,state,{now}),authority=activeAuthority(config);
  return {
    enforcementEnabled:config.enforcementEnabled===true,
    allowed:access.allowed,reason:access.reason,degraded:access.degraded===true,
    activeSource:authority.source,repository:authority.repository,authorityUrl:authority.authorityUrl,
    status:state?.status||'unlicensed',customerName:state?.customerName||null,
    licenseId:state?.licenseId||null,installationId:state?.installationId||null,
    expiresAt:state?.expiresAt||null,fullRevalidationAt:state?.fullRevalidationAt||null,
    fullRevalidationRequired:state?.fullRevalidationRequired===true,
    lastHeartbeatAt:state?.lastHeartbeatAt||null,
    lastSuccessfulContactAt:state?.lastSuccessfulContactAt||null,
    lastValidationError:state?.lastValidationError||null,
    nextHeartbeatAt:access.nextHeartbeatAt||null,offlineDeadline:access.offlineDeadline||null,
    heartbeatIntervalHours:Number(state?.heartbeatIntervalHours||24),
    offlineGraceHours:Number(state?.offlineGraceHours||2160),
    updatedAt:state?.updatedAt||null
  };
}
function dueForContact(config,state,{now=Date.now()}={}){
  if(!state?.installationToken)return false;
  if(state.fullRevalidationRequired===true)return true;
  const last=Date.parse(state.lastSuccessfulContactAt||state.activatedAt||'');
  if(!Number.isFinite(last))return true;
  return now-last>=Number(state.heartbeatIntervalHours||24)*3600000;
}
async function authorityRequest(config,path,{method='GET',body=null,token=null,fetcher=fetch,timeoutMs=10000}={}){
  const authority=activeAuthority(config);
  if(!authority.authorityUrl)throw new LicenseControlError('license-authority-not-configured',409);
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const response=await fetcher(authority.authorityUrl+path,{
      method,redirect:'error',signal:controller.signal,
      headers:{
        Accept:'application/json',
        ...(body?{'Content-Type':'application/json'}:{}),
        ...(token?{Authorization:'Bearer '+token}:{})
      },
      ...(body?{body:JSON.stringify(body)}:{})
    });
    let data={};try{data=await response.json();}catch{}
    return {response,data,authority};
  }catch(error){
    throw new LicenseControlError(error?.name==='AbortError'?'license-authority-timeout':'license-authority-unreachable',503);
  }finally{clearTimeout(timer);}
}
export async function testLicenseAuthority(env,request,{source=null,fetcher=fetch}={}){
  const actor=await requireLicenseAdmin(env,request),config=await loadLicenseConfig(env);
  const candidate=source?{...config,activeSource:source}:config;
  const result=await authorityRequest(candidate,'/health',{fetcher,timeoutMs:8000});
  if(!result.response.ok)throw new LicenseControlError('license-authority-health-failed',502);
  await audit(env,request,actor,'license-authority-tested',{
    source:activeAuthority(candidate).source,authorityUrl:activeAuthority(candidate).authorityUrl
  });
  return {ok:true,status:result.response.status,authority:result.authority,service:result.data?.service||null,time:result.data?.time||null};
}
export async function updateLicenseConfig(env,request,payload){
  const actor=await requireLicenseAdmin(env,request),current=await loadLicenseConfig(env);
  const activeSource=ALLOWED_SOURCES.has(payload?.activeSource)?payload.activeSource:current.activeSource;
  const next={
    ...current,activeSource,
    installationName:clean(payload?.installationName??current.installationName,160)||DEFAULT_CONFIG.installationName,
    primary:sourceRow(payload?.primary??current.primary),
    mirror:sourceRow(payload?.mirror??current.mirror),
    custom:sourceRow(payload?.custom??current.custom)
  };
  if(payload?.enforcementEnabled===true){
    const state=await loadLicenseState(env),check=stateAccess({...next,enforcementEnabled:true},state);
    if(!check.allowed)throw new LicenseControlError('valid-license-required-before-enforcement',409);
    next.enforcementEnabled=true;
  }else if(payload?.enforcementEnabled===false)next.enforcementEnabled=false;
  if(!next.systemId)next.systemId=crypto.randomUUID();
  const saved=await saveConfig(env,next,actor);
  await audit(env,request,actor,'license-config-updated',{
    activeSource:saved.activeSource,enforcementEnabled:saved.enforcementEnabled,
    primaryRepository:saved.primary.repository,mirrorRepository:saved.mirror.repository
  });
  return saved;
}
export async function activateLicense(env,request,{licenseKey,fetcher=fetch}={}){
  const actor=await requireLicenseAdmin(env,request);
  let config=await loadLicenseConfig(env);
  if(!config.systemId)config=await saveConfig(env,{...config,systemId:crypto.randomUUID()},actor);
  const key=clean(licenseKey,240);
  if(!key)throw new LicenseControlError('license-key-required');
  const result=await authorityRequest(config,'/api/v1/activate',{
    method:'POST',
    body:{licenseKey:key,systemId:config.systemId,installationName:config.installationName,clientVersion:'VisionBank'},
    fetcher,timeoutMs:15000
  });
  if(!result.response.ok||!result.data?.installationToken||result.data?.access!==true)
    throw new LicenseControlError('license-activation-failed',result.response.status===403?403:502);
  const contact=nowIso(),state={
    installationToken:await seal(env,result.data.installationToken),
    installationId:result.data.installationId||null,
    licenseId:result.data.licenseId||null,
    customerName:result.data.customerName||null,
    status:result.data.status||'active',access:result.data.access===true,
    expiresAt:result.data.expiresAt||null,
    fullRevalidationAt:result.data.fullRevalidationAt||null,
    fullRevalidationRequired:result.data.fullRevalidationRequired===true,
    heartbeatIntervalHours:Number(result.data.heartbeatIntervalHours||24),
    offlineGraceHours:Number(result.data.offlineGraceHours||2160),
    entitlements:result.data.entitlements||{},
    activatedAt:contact,lastHeartbeatAt:contact,lastSuccessfulContactAt:contact,lastValidationError:null,
    authoritySource:result.authority.source,authorityUrl:result.authority.authorityUrl
  };
  await saveState(env,state);
  await audit(env,request,actor,'license-activated',{
    licenseId:state.licenseId,installationId:state.installationId,
    customerName:state.customerName,expiresAt:state.expiresAt
  });
  return publicState(config,state);
}
export async function refreshLicense(env,{request=null,force=false,forceFull=false,fetcher=fetch}={}){
  const config=await loadLicenseConfig(env),state=await loadLicenseState(env);
  if(!state?.installationToken)return publicState(config,state);
  if(!force&&!dueForContact(config,state))return publicState(config,state);
  const token=await open(env,state.installationToken);
  const full=forceFull||state.fullRevalidationRequired===true;
  try{
    const result=await authorityRequest(config,full?'/api/v1/revalidate':'/api/v1/heartbeat',{
      method:'POST',body:{clientVersion:'VisionBank'},token,fetcher,timeoutMs:12000
    });
    const contact=nowIso(),next={
      ...state,
      status:result.data?.status||(result.response.ok?'active':state.status),
      access:result.data?.access===true,
      expiresAt:result.data?.expiresAt||state.expiresAt,
      fullRevalidationAt:result.data?.fullRevalidationAt||state.fullRevalidationAt,
      fullRevalidationRequired:result.data?.fullRevalidationRequired===true,
      heartbeatIntervalHours:Number(result.data?.heartbeatIntervalHours||state.heartbeatIntervalHours||24),
      offlineGraceHours:Number(result.data?.offlineGraceHours||state.offlineGraceHours||2160),
      entitlements:result.data?.entitlements||state.entitlements||{},
      lastHeartbeatAt:contact,lastSuccessfulContactAt:contact,lastValidationError:null,
      authoritySource:result.authority.source,authorityUrl:result.authority.authorityUrl
    };
    await saveState(env,next);
    return publicState(config,next);
  }catch(error){
    const next={...state,lastHeartbeatAt:nowIso(),lastValidationError:error.code||error.message};
    await saveState(env,next);
    return publicState(config,next);
  }
}
export async function licenseStatus(env,{request=null,refreshIfDue=true,fetcher=fetch}={}){
  const config=await loadLicenseConfig(env);
  let state=await loadLicenseState(env);
  if(refreshIfDue&&state?.installationToken&&dueForContact(config,state)){
    await refreshLicense(env,{request,force:true,fetcher});
    state=await loadLicenseState(env);
  }
  return publicState(config,state);
}
export async function deactivateLicense(env,request){
  const actor=await requireLicenseAdmin(env,request),config=await loadLicenseConfig(env);
  await jsonPut(env.LOGS,STATE_KEY,{status:'unlicensed',access:false,deactivatedAt:nowIso(),updatedAt:nowIso()});
  if(config.enforcementEnabled)await saveConfig(env,{...config,enforcementEnabled:false},actor);
  await audit(env,request,actor,'license-local-deactivated',{});
  return publicState({...config,enforcementEnabled:false},await loadLicenseState(env));
}
export function licenseExemptPath(path){
  return path==='/security/check'||
    path==='/api/login'||path==='/api/logout'||path==='/api/setup-mfa'||path==='/api/confirm-mfa'||
    path==='/api/session/status'||path.startsWith('/api/license/')||
    path==='/api/get-hours'||path==='/api/set-hours'||path==='/api/get-ip-rules'||path==='/api/set-ip-rules'||
    path==='/api/logs'||path==='/api/validate-ip'||path.startsWith('/api/users/')||path.startsWith('/api/security/')||
    path==='/api/webex/device-management/identity-policy'||
    path==='/api/webex/device-management/admin-settings'||
    path.startsWith('/api/webex/device-management/admin-settings/');
}
export async function requireLicensedAccess(env,{fetcher=fetch}={}){
  return licenseStatus(env,{refreshIfDue:true,fetcher});
}
export async function scheduledLicenseCheck(env,{fetcher=fetch}={}){
  const config=await loadLicenseConfig(env),state=await loadLicenseState(env);
  if(config.enforcementEnabled!==true||!state?.installationToken||!dueForContact(config,state))
    return publicState(config,state);
  return refreshLicense(env,{force:true,fetcher});
}
const response=(body,status=200,cors={})=>new Response(JSON.stringify(body),{
  status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'}
});
function publicConfig(config){
  return {
    enforcementEnabled:config.enforcementEnabled,activeSource:config.activeSource,
    installationName:config.installationName,systemId:config.systemId,
    primary:config.primary,mirror:config.mirror,custom:config.custom,
    updatedAt:config.updatedAt,updatedBy:config.updatedBy
  };
}
export function createLicenseControlHandler({fetcher=fetch}={}){
  return async function handle(request,env,cors={}){
    try{
      const url=new URL(request.url),path=url.pathname,method=request.method.toUpperCase();
      if(path==='/api/license/access'&&method==='GET'){
        const status=await licenseStatus(env,{request,refreshIfDue:true,fetcher});
        return response({
          success:true,
          enforcementEnabled:status.enforcementEnabled,
          allowed:status.allowed,
          reason:status.reason,
          status:status.status,
          degraded:status.degraded===true
        },200,cors);
      }
      if(path==='/api/license/status'&&method==='GET'){
        await requireLicenseSession(env,request);
        return response({success:true,...await licenseStatus(env,{request,refreshIfDue:true,fetcher})},200,cors);
      }
      if(path==='/api/license/config'&&method==='GET'){
        await requireLicenseSession(env,request);
        return response({success:true,...publicConfig(await loadLicenseConfig(env))},200,cors);
      }
      if(path==='/api/license/config'&&method==='POST'){
        let body={};try{body=await request.json();}catch{}
        return response({success:true,...publicConfig(await updateLicenseConfig(env,request,body))},200,cors);
      }
      if(path==='/api/license/test'&&method==='POST'){
        let body={};try{body=await request.json();}catch{}
        return response({success:true,...await testLicenseAuthority(env,request,{source:body.source||null,fetcher})},200,cors);
      }
      if(path==='/api/license/activate'&&method==='POST'){
        let body={};try{body=await request.json();}catch{}
        return response({success:true,...await activateLicense(env,request,{licenseKey:body.licenseKey,fetcher})},200,cors);
      }
      if(path==='/api/license/refresh'&&method==='POST'){
        await requireLicenseSession(env,request);
        let body={};try{body=await request.json();}catch{}
        return response({success:true,...await refreshLicense(env,{
          request,force:true,forceFull:body.full===true,fetcher
        })},200,cors);
      }
      if(path==='/api/license/deactivate'&&method==='POST')
        return response({success:true,...await deactivateLicense(env,request)},200,cors);
      return response({error:'license-route-not-found'},404,cors);
    }catch(error){
      return response({error:error.code||'license-control-failed'},Number.isInteger(error.status)?error.status:500,cors);
    }
  };
}
