import {createPhonismReader} from './phonism.mjs';
import {normalizeMac} from './contracts.mjs';
import {deviceWriteScope,isPilotDevice} from './lease.mjs';
import {readPhoneEnrollment,upsertFleetEnrollment} from './phone-selfservice.mjs';
export const AUTO_ENROLLMENT_KEY='device-phone-auto-enrollment:v1';
const normalize=value=>{try{return normalizeMac(value);}catch{return null;}};
const orgUuid=value=>{const text=String(value||'');try{return atob(text).match(/^ciscospark:\/\/[^/]+\/ORGANIZATION\/([0-9a-f-]{36})$/i)?.[1]?.toLowerCase()||text.toLowerCase();}catch{return text.toLowerCase();}};
const bounded=async promise=>{let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('inventory-check-timeout')),45000);})]);}finally{clearTimeout(timer);}};
const read=async(env,key)=>{const raw=await env.LOGS.get(key);return raw?JSON.parse(raw):null;};
async function webexInventory(env,webexFetch,org){
 const encoded=btoa('ciscospark://us/ORGANIZATION/'+orgUuid(org));
 let next='https://webexapis.com/v1/devices?orgId='+encodeURIComponent(encoded)+'&max=100',pages=0;const rows=[];
 while(next){
  if(++pages>50)throw Error('webex-inventory-incomplete');
  const url=new URL(next);if(url.origin!=='https://webexapis.com'||url.pathname!=='/v1/devices')throw Error('webex-pagination-invalid');
  const response=await webexFetch(env,url.href,{method:'GET',signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error('webex-inventory-http-'+response.status);
  const data=await response.json();if(!Array.isArray(data.items))throw Error('webex-inventory-invalid');
  rows.push(...data.items);next=(response.headers.get('Link')||'').match(/<([^>]+)>\s*;\s*rel="?next"?/i)?.[1]||null;
 }
 return rows;
}
export async function reconcilePhoneEnrollments({env,webexFetch,phonismReader=createPhonismReader(),now=Date.now()}){
 const report={startedAt:new Date(now).toISOString(),status:'running',inventory:0,enrolled:0,created:0,updated:0,existing:0,pending:0,issues:[]};
 const issue=(name,mac,code)=>report.issues.push({name:String(name||'Phone').slice(0,160),mac:mac||null,code});
 try{
  if(!env?.LOGS?.get||!env.LOGS.put)throw Error('enrollment-store-unavailable');
  if(deviceWriteScope(env)==='disabled')throw Error('device-write-not-enabled');
  const fleet=await read(env,'device-phone-fleet-keys:v1');
  if(!fleet?.keys?.some(k=>k.id===fleet.activeKeyId&&k.status==='active'))throw Error('fleet-key-not-configured');
  const org=String(env.WEBEX_ORG_ID||'');if(!org)throw Error('webex-org-not-configured');
  const discovery=await bounded(phonismReader.discover(env,org));
  if(discovery.truncated)throw Error('phonism-discovery-incomplete');
  const [inventory,devices]=await bounded(Promise.all([phonismReader.phones(env,discovery.domain.id,discovery.tenants),webexInventory(env,webexFetch,org)]));
  if(inventory.truncated||!Array.isArray(inventory.phones))throw Error('phonism-inventory-incomplete');
  const phones=inventory.phones;report.inventory=phones.length;
  const tenantById=new Map(discovery.tenants.map(t=>[String(t.id),t]));
  const phoneMacs=new Map(),webexMacs=new Map();
  for(const p of phones){const mac=normalize(p.mac);phoneMacs.set(mac,[...(phoneMacs.get(mac)||[]),p]);}
  for(const d of devices){if(orgUuid(d.orgId)!==orgUuid(org))continue;const mac=normalize(d.mac||d.macAddress);if(mac)webexMacs.set(mac,[...(webexMacs.get(mac)||[]),d]);}
  for(const phone of phones){
   const mac=normalize(phone.mac),tenant=tenantById.get(String(phone.tenantId));
   if(!mac){issue(phone.alias,mac,'invalid-mac');continue;}
   if(!isPilotDevice(env,mac)){issue(phone.alias,mac,'outside-enabled-scope');continue;}
   if(phoneMacs.get(mac).length!==1){issue(phone.alias,mac,'duplicate-phonism-mac');continue;}
   if(!tenant?.webexLocationId){issue(phone.alias,mac,'location-mapping-missing');continue;}
   const matches=webexMacs.get(mac)||[];
   if(matches.length!==1){issue(phone.alias,mac,matches.length?'duplicate-webex-mac':'webex-device-missing');continue;}
   const device=matches[0],deviceId=device.callingDeviceId||device.id;
   if(!deviceId||device.locationId!==tenant.webexLocationId){issue(phone.alias,mac,'device-location-mismatch');continue;}
   try{
    const existing=await readPhoneEnrollment(env,mac);
    if(existing?.status==='revoked'){issue(phone.alias,mac,'enrollment-revoked');continue;}
    const same=existing?.device?.id===deviceId&&existing.location?.id===tenant.webexLocationId&&existing.phonismPhoneId===String(phone.id);
    if(existing?.status==='active'&&same){report.existing++;report.enrolled++;continue;}
    if(existing&&existing.authMode!=='fleet-template'){issue(phone.alias,mac,'existing-credential-enrollment-needs-review');continue;}
    if(report.created+report.updated>=50||Date.now()-now>120000){report.pending++;continue;}
    await upsertFleetEnrollment(env,{device:{id:deviceId,displayName:device.displayName||phone.alias,mac,model:device.product||device.model||phone.webexDeviceType},location:{id:tenant.webexLocationId,name:tenant.name},phonismPhoneId:phone.id});
    report[existing?'updated':'created']++;report.enrolled++;
   }catch{issue(phone.alias,mac,'enrollment-write-failed');}
  }
  for(const [mac,matches] of webexMacs){
   if(phoneMacs.has(mac))continue;
   for(const d of matches)if(d.type==='phone'&&['CISCO','PARTNER'].includes(String(d.managedBy).toUpperCase()))issue(d.displayName,mac,'phonism-phone-missing');
  }
  report.status=report.issues.length||report.pending?'attention':'healthy';
 }catch(error){report.status='error';report.error=String(error?.code||error?.message||'enrollment-check-failed').slice(0,160);}
 report.completedAt=new Date().toISOString();report.issueCount=report.issues.length;report.issues=report.issues.slice(0,50);
 if(env?.LOGS?.put)await env.LOGS.put(AUTO_ENROLLMENT_KEY,JSON.stringify(report));
 return report;
}
export async function automaticEnrollmentHealth(env){
 let state=null;try{state=await read(env,AUTO_ENROLLMENT_KEY);}catch{}
 if(!state)return {label:'Automatic phone enrollment',status:'Awaiting first check',severity:'info',detail:'Runs every five minutes. New phones need matching Webex and Phonism records.'};
 const stale=Date.now()-Date.parse(state.completedAt)>15*60000;
 return {label:'Automatic phone enrollment',status:state.status==='error'?'Check failed':state.enrolled+' enrolled'+(state.issueCount?'; '+state.issueCount+' need attention':'')+(state.pending?'; '+state.pending+' pending':''),severity:state.status==='healthy'&&!stale?'ok':'warning',detail:'Runs every five minutes. Last check: '+state.completedAt,cause:stale?'The enrollment check is overdue.':state.error||(state.issues||[]).slice(0,5).map(i=>i.name+': '+i.code.replace(/-/g,' ')).join('; '),remediation:state.status==='healthy'&&!stale?'No action needed.':'Check the listed phone mappings in Webex and Phonism. Revoked enrollments are not re-enabled automatically.'};
}
