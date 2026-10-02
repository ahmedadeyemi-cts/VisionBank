import {DeviceManagementError,normalizeMac,normalizeOwnerType,normalizeRegistration} from './contracts.mjs';
import {createPhonismReader} from './phonism.mjs';

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
  const location=locationOf(value);
  return {id:id(value?.id||value?.memberId||value?.personId||value?.workspaceId),
    name:display(value?.firstName&&value?.lastName?value.firstName+' '+value.lastName:value?.displayName||value?.name,160),
    type:ownerType(value),extension:display(value?.extension||'',32),phoneNumber:display(value?.phoneNumber||value?.number||'',64),
    locationId:location.id,locationName:location.name,lineType:display(value?.lineType||'',40),port:Number.isSafeInteger(value?.port)?value.port:null,
    registrationStatus:normalizeRegistration(value?.registrationStatus||value?.status)};
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
  const line=x=>x?{id:x.id,memberId:x.id,name:x.name,type:x.type,extension:x.extension,phoneNumber:x.phoneNumber,registrationStatus:x.registrationStatus==='unknown'?overall:x.registrationStatus,port:x.port}:null;
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

async function readPhonismCapabilities(env,org,phonismReader){
  const checks=[];
  if(!env.PHONISM_API_KEY)return {detected:false,ready:false,message:'PHONISM_API_KEY is not configured',detail:'Add the Phonism API key as a Cloudflare secret.',checks};
  try{
    const discovery=await phonismReader.discover(env,org);
    checks.push({label:'VisionBank domain',status:discovery.domain.name||'Found'});
    checks.push({label:'Phonism tenants',status:String(discovery.tenants.length)+' available'});
    checks.push({label:'Webex integration',status:discovery.webexIntegration?'Found':'Not uniquely identified'});
    const inventory=await phonismReader.phones(env,discovery.domain.id,discovery.tenants);
    checks.push({label:'Phonism phone inventory',status:String(inventory.phones.length)+' available'});
    let lineRead='not-tested',registrationMonitoring='unknown';
    const sample=inventory.phones[0];
    if(sample)try{
      const lines=await phonismReader.lines(env,sample.id);lineRead='available';
      registrationMonitoring=lines.some(x=>x.registrationStatus!=='unknown')?'available':'not-reported-on-sample';
      checks.push({label:'Phone line status read',status:'Available'});
      checks.push({label:'Line registration monitoring',status:registrationMonitoring});
    }catch{lineRead='unavailable';checks.push({label:'Phone line status read',status:'Unavailable'});}
    const ready=Boolean(discovery.domain)&&inventory.phones.length>=0;
    return {detected:true,ready,message:ready?'Read-only Phonism discovery available':'Phonism discovery is incomplete',
      detail:'VisionBank Iowa can be read through the server-side Phonism API key. Writes and Sync remain disabled.',
      checks,domainName:discovery.domain.name,tenantCount:discovery.tenants.length,phoneCount:inventory.phones.length,
      webexIntegrationAvailable:Boolean(discovery.webexIntegration),lineRead,registrationMonitoring};
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
      if(request.method!=='GET'||!['capabilities','locations','inventory','members','history'].includes(part))throw new DeviceManagementError('read-only-phase',405);
      const sourceIp=request.headers.get('CF-Connecting-IPv6')||request.headers.get('CF-Connecting-IP');
      if(!request.cf||request.headers.has('CF-Worker')||!validIp(sourceIp))throw new DeviceManagementError('source-not-verifiable',403);
      if((await bounded(checkAccess(request,env),8000))?.allowed!==true)throw new DeviceManagementError('access-denied',403);
      const rules=await bounded(loadIpRules(env),8000);
      if(!Array.isArray(rules)||!rules.some(v=>typeof v==='string'&&v.trim()))throw new DeviceManagementError('approved-network-required',403);
      const org=String(env.WEBEX_ORG_ID||'').trim();if(!org)throw new DeviceManagementError('webex-org-not-configured',503);

      if(part==='history')return output({success:true,rows:[],readOnly:true,message:'Device-management writes are not enabled yet.'},200,headers);

      if(part==='locations'){
        const page=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations']);
        const locations=page.rows.map(x=>({id:id(x?.id),name:display(x?.name||x?.displayName,120),address:display([x?.address?.city,x?.address?.state].filter(Boolean).join(', '),160)})).filter(x=>x.id);
        return output({success:true,locations,truncated:page.truncated,readOnly:true},200,headers);
      }
      if(part==='capabilities'){
        const checks=[];let locationsOk=false,devicesOk=false,memberRead='not-tested',callingCount=0,deviceCount=0;
        try{const p=await readPaged(webexFetch,env,WEBEX+'/locations?orgId='+encodeURIComponent(org),['items','locations'],3,500);locationsOk=true;checks.push({label:'Webex locations read',status:'Available ('+p.rows.length+')'});}catch{checks.push({label:'Webex locations read',status:'Unavailable'});}
        try{
          const p=await readPaged(webexFetch,env,WEBEX+'/devices?orgId='+encodeURIComponent(org),['items','devices'],5,1000);devicesOk=true;deviceCount=p.rows.length;
          const first=p.rows.map(deviceBase).find(x=>x.callingDeviceId);callingCount=p.rows.map(deviceBase).filter(x=>x.callingDeviceId).length;
          checks.push({label:'Webex device inventory',status:'Available ('+deviceCount+')'});
          checks.push({label:'Calling device IDs',status:callingCount?callingCount+' detected':'None detected'});
          if(first)try{await responseJson(await bounded(webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(first.callingDeviceId)+'/members?orgId='+encodeURIComponent(org),{method:'GET'})));memberRead='available';checks.push({label:'Calling device members read',status:'Available'});}catch(error){memberRead='unavailable';checks.push({label:'Calling device members read',status:'Unavailable'});}
        }catch{checks.push({label:'Webex device inventory',status:'Unavailable'});}
        const ready=locationsOk&&devicesOk;
        const phonism=await readPhonismCapabilities(env,org,phonismReader);
        return output({success:true,webex:{detected:true,ready,message:ready?'Read-only Webex discovery available':'Webex discovery is incomplete',
          detail:ready?'Existing OAuth can read locations and devices. Partner-managed line/member support is reported separately.':'One or more required read APIs are unavailable with the existing authorization.',
          checks,deviceCount,callingDeviceCount:callingCount,memberRead},phonism,
          writes:{enabled:false,previewReady:false,message:'Read-only capability phase'},readOnly:true},200,headers);
      }

      if(part==='inventory'){
        const requestedLocation=id(url.searchParams.get('locationId'));
        const page=await readPaged(webexFetch,env,WEBEX+'/devices?orgId='+encodeURIComponent(org),['items','devices'],10,500);
        const bases=page.rows.map(deviceBase).filter(x=>x.callingDeviceId);
        let devices=await mapLimit(bases,4,base=>readCallingDevice(webexFetch,env,org,base));
        if(requestedLocation)devices=devices.filter(d=>String(d.locationId||'')===requestedLocation);
        const merged=await mergePhonismInventory(env,org,devices,phonismReader);
        return output({success:true,devices:merged.devices,phonism:merged.phonism,truncated:page.truncated,
          generatedAt:new Date().toISOString(),readOnly:true},200,headers);
      }
      if(part==='members'){
        const deviceId=id(url.searchParams.get('deviceId')),locationId=id(url.searchParams.get('locationId'));
        if(!deviceId||!locationId)throw new DeviceManagementError('device-and-location-required');
        const endpoint=WEBEX+'/telephony/config/devices/'+encodeURIComponent(deviceId)+'/availableMembers?orgId='+encodeURIComponent(org)+'&locationId='+encodeURIComponent(locationId)+'&usageType=SHARED_LINE';
        const page=await readPaged(webexFetch,env,endpoint,['members','items'],10,1000);
        const members=page.rows.map(memberRow).filter(m=>m.id&&m.type&&String(m.locationId||'')===locationId);
        return output({success:true,members,truncated:page.truncated,locationId,deviceId,readOnly:true},200,headers);
      }
      throw new DeviceManagementError('not-found',404);
    }catch(error){
      const status=Number.isInteger(error?.status)?error.status:500;
      const code=typeof error?.code==='string'?error.code:'device-management-unavailable';
      return output({success:false,error:code,readOnly:true},status,headers);
    }
  };
}
