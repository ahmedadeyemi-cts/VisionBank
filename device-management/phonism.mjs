import {DeviceManagementError,normalizeMac,normalizeRegistration} from './contracts.mjs';

export const PHONISM_BASE='https://app.phonism.com/api/v3';

const clean=(value,max=160)=>String(value??'').trim().slice(0,max);
const id=value=>value===null||value===undefined||String(value).trim()===''?null:String(value).trim();

function metadata(value){
  const out={};
  if(Array.isArray(value)){
    for(const row of value){
      const name=clean(row?.name,120).toLowerCase();
      if(name)out[name]=clean(row?.value,500);
    }
    return out;
  }
  if(value&&typeof value==='object'){
    for(const [name,raw] of Object.entries(value)){
      const key=clean(name,120).toLowerCase();
      if(key)out[key]=clean(raw,500);
    }
  }
  return out;
}

function metadataValues(value,name){
  const target=String(name||'').toLowerCase();
  if(Array.isArray(value))return value.filter(row=>String(row?.name||'').toLowerCase()===target).map(row=>clean(row?.value,500)).filter(Boolean);
  if(value&&typeof value==='object'&&Object.prototype.hasOwnProperty.call(value,target))return [clean(value[target],500)].filter(Boolean);
  return [];
}

function macOrNull(value){
  try{return value?normalizeMac(value):null;}catch{return null;}
}

function safePath(path){
  if(typeof path!=='string'||!path.startsWith('/')||path.startsWith('//'))throw new DeviceManagementError('invalid-phonism-path');
  return path;
}

export async function defaultPhonismFetch(env,path,{method='GET',signal}={}){
  if(method!=='GET')throw new DeviceManagementError('phonism-read-only',405);
  const key=String(env?.PHONISM_API_KEY||'');
  if(key.length<16)throw new DeviceManagementError('phonism-api-key-not-configured',503);
  const response=await fetch(PHONISM_BASE+safePath(path),{
    method:'GET',redirect:'manual',signal,
    headers:{Accept:'application/json','x-api-key':key}
  });
  if(response.status>=300&&response.status<400)throw new DeviceManagementError('phonism-unexpected-redirect',502);
  return response;
}

async function readJson(response){
  let body={};try{body=await response.json();}catch{}
  if(!response.ok||!body||!Array.isArray(body.errors)){
    const status=response.status===401||response.status===403?503:502;
    throw new DeviceManagementError('phonism-read-unavailable',status);
  }
  if(body.errors.length){
    const joined=body.errors.map(x=>String(x||'').toLowerCase()).join(' ');
    if(joined.includes('api key'))throw new DeviceManagementError('phonism-authentication-failed',503);
    throw new DeviceManagementError('phonism-read-unavailable',502);
  }
  return body;
}

function nextPath(value){
  if(!value)return null;
  try{
    const base=new URL(PHONISM_BASE),u=new URL(String(value),base);
    if(u.origin!==base.origin)return null;
    let path=u.pathname;
    const prefix=base.pathname.replace(/\/$/,'');
    if(path===prefix)path='/';
    else if(path.startsWith(prefix+'/'))path=path.slice(prefix.length);
    return path+u.search;
  }catch{return null;}
}

async function paged(env,path,fetcher,maxPages=30,maxRows=3000){
  const rows=[];let next=path,pages=0;
  while(next&&pages<maxPages&&rows.length<maxRows){
    const response=await fetcher(env,next,{method:'GET'});
    const body=await readJson(response);
    const data=Array.isArray(body.data)?body.data:(body.data==null?[]:[body.data]);
    rows.push(...data.slice(0,maxRows-rows.length));
    next=nextPath(body.next);pages++;
  }
  return {rows,pages,truncated:Boolean(next)||rows.length>=maxRows};
}

function flattenCompanies(rows){
  const out=[];
  const walk=value=>{
    if(!value||typeof value!=='object')return;
    out.push(value);
    for(const child of Array.isArray(value.children)?value.children:[])walk(child);
  };
  for(const row of rows)walk(row);
  return out;
}

function companyRow(value){
  const meta=metadata(value?.metadata);
  return {id:id(value?.id),name:clean(value?.name,160),type:clean(value?.type,80),
    webexOrganizationId:meta.webex_organization_id||null};
}

function tenantRow(value){
  const meta=metadata(value?.metadata);
  return {id:id(value?.id),companyId:id(value?.company_id),name:clean(value?.name,160),
    webexLocationId:meta.webex_location_id||null,
    city:clean(value?.city,100),state:clean(value?.state_or_province,100)};
}

function integrationRow(value){
  return {id:id(value?.id),companyId:id(value?.company_id),tenantId:id(value?.tenant_id),
    type:clean(value?.type,100),name:clean(value?.name,160),
    lastConnectedAt:value?.last_connected_at||null};
}

function phoneRow(value,tenantNames=new Map()){
  const meta=metadata(value?.metadata);
  const webexDeviceIds=[...new Set(metadataValues(value?.metadata,'webex_device_id'))];
  const webexDeviceTypes=[...new Set(metadataValues(value?.metadata,'webex_device_type'))];
  const services=Array.isArray(value?.service_state)?value.service_state:[];
  const serviceNames=services.map(x=>clean(typeof x==='string'?x:(x?.name||x?.service||x?.type),80).toLowerCase()).filter(Boolean);
  const tenantId=id(value?.tenant_id);
  return {
    id:id(value?.id),tenantId,tenantName:tenantNames.get(tenantId)||'',
    companyId:id(value?.company_id),mac:macOrNull(value?.mac_address),
    alias:clean(value?.device_alias,160),state:id(value?.state),
    serviceState:serviceNames,tr069:serviceNames.some(x=>x.includes('tr069')),
    lastProvision:value?.last_provision||null,updated:value?.updated||null,
    webexDeviceIds,webexDeviceId:webexDeviceIds[0]||meta.webex_device_id||null,
    webexDeviceTypes,webexDeviceType:webexDeviceTypes[0]||meta.webex_device_type||null
  };
}

function lineRow(value){
  const number=Number(value?.line_number);
  return {
    lineNumber:Number.isSafeInteger(number)&&number>0?number:null,
    voipCredentialId:id(value?.voip_credential_id),
    username:clean(value?.username,100),alias:clean(value?.alias,160),
    registrationStatus:normalizeRegistration(value?.registration_status),
    broadworksUserId:clean(value?.broadworks_user_id,200)||null
  };
}

function chooseDomain(companies,webexOrgId,expectedName='VisionBank Iowa'){
  const normalized=companies.map(companyRow).filter(x=>x.id);
  const byOrg=normalized.filter(x=>x.webexOrganizationId&&x.webexOrganizationId===webexOrgId);
  if(byOrg.length===1)return byOrg[0];
  const byName=normalized.filter(x=>x.type.toLowerCase()==='domain'&&x.name.toLowerCase()===expectedName.toLowerCase());
  if(byName.length===1)return byName[0];
  const domains=normalized.filter(x=>x.type.toLowerCase()==='domain');
  if(domains.length===1)return domains[0];
  throw new DeviceManagementError(byOrg.length>1||byName.length>1?'phonism-domain-ambiguous':'phonism-domain-not-found',503);
}

export function createPhonismReader({fetcher=defaultPhonismFetch,domainName='VisionBank Iowa'}={}){
  return {
    async discover(env,webexOrgId){
      const hierarchy=await paged(env,'/hierarchy/?limit=100',fetcher,20,2000);
      const domain=chooseDomain(flattenCompanies(hierarchy.rows),webexOrgId,domainName);
      const tenantsPage=await paged(env,'/hierarchy/'+encodeURIComponent(domain.id)+'/tenants/?limit=100',fetcher,30,3000);
      const tenants=tenantsPage.rows.map(tenantRow).filter(x=>x.id);
      const integrationsPage=await paged(env,'/hierarchy/'+encodeURIComponent(domain.id)+'/integrations?limit=100',fetcher,10,500);
      const integrations=integrationsPage.rows.map(integrationRow).filter(x=>x.id);
      const webexIntegrations=integrations.filter(x=>(x.type+' '+x.name).toLowerCase().includes('webex'));
      const integration=webexIntegrations.length===1?webexIntegrations[0]:webexIntegrations[0]||null;
      return {domain,tenants,integrations,webexIntegration:integration,
        truncated:hierarchy.truncated||tenantsPage.truncated||integrationsPage.truncated};
    },

    async phones(env,domainId,tenants=[]){
      const tenantNames=new Map(tenants.map(x=>[String(x.id),x.name]));
      const page=await paged(env,'/hierarchy/'+encodeURIComponent(domainId)+'/phones?limit=100',fetcher,50,5000);
      return {phones:page.rows.map(x=>phoneRow(x,tenantNames)).filter(x=>x.id),truncated:page.truncated};
    },

    async tenantPhones(env,tenantId,tenantName=''){
      const page=await paged(env,'/tenants/'+encodeURIComponent(tenantId)+'/phones?limit=100',fetcher,20,2000);
      const names=new Map([[String(tenantId),tenantName]]);
      return {phones:page.rows.map(x=>phoneRow(x,names)).filter(x=>x.id),truncated:page.truncated};
    },

    async lines(env,phoneId){
      const response=await fetcher(env,'/phones/'+encodeURIComponent(phoneId)+'/lines',{method:'GET'});
      const body=await readJson(response);
      const data=Array.isArray(body.data)?body.data:(body.data==null?[]:[body.data]);
      return data.map(lineRow).filter(x=>x.lineNumber);
    }
  };
}
