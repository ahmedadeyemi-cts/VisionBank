// Webex Contact Center: v3 book, v2 entry list, current unversioned entry bulk API.
export const ADDRESS_BOOK_ID='b404018a-eecb-4671-ba18-7a18b259cff0';
const clean=v=>String(v??'').trim(),digits=v=>clean(v).replace(/\D/g,'');
const nameKey=v=>clean(v).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' and ').replace(/[^a-zA-Z0-9._\-\s]/g,'').replace(/\s+/g,' ').trim();
const norm=v=>nameKey(v).toLowerCase();
export function dialNumber(c){
 const phone=digits(c.phone),extension=digits(c.extension);
 if(phone.length===10)return '+1'+phone;
 if(phone.length>=11&&phone.length<=15)return '+'+phone;
 if(!phone&&/^\d{2,8}$/.test(extension))return extension;
 return '';
}
export function planAddressBook(contacts,entries,managed={}){
 const desired=[],skipped=[];
 for(const c of contacts){
  const name=nameKey(c.name||[c.firstName,c.lastName].filter(Boolean).join(' ')),number=dialNumber(c);
  // Only authoritative directory identities are managed; local-only rows remain untouched.
  if(!c.webexDirectoryId)continue;
  if(!name||name.length>80||!number){skipped.push(c.webexDirectoryId);continue;}
  desired.push({sourceId:c.webexDirectoryId,name,number,extension:digits(c.extension)});
 }
 const actions=[],links={},conflicts=[];
 const sourceCounts=new Map(),nameCounts=new Map(),used=new Set();
 for(const c of desired){sourceCounts.set(c.sourceId,(sourceCounts.get(c.sourceId)||0)+1);nameCounts.set(norm(c.name),(nameCounts.get(norm(c.name))||0)+1);}
 for(const c of desired){
  if(sourceCounts.get(c.sourceId)!==1||nameCounts.get(norm(c.name))!==1){conflicts.push(c.sourceId);continue;}
  const old=managed[c.sourceId];let entry=old?entries.find(e=>e.id===old.id):null;
  if(entry&&((entry.name!==old.name||entry.number!==old.number)&&!(entry.name===c.name&&entry.number===c.number))){conflicts.push(c.sourceId);continue;}
  if(!entry){
   const matches=entries.filter(e=>norm(e.name)===norm(c.name));
   if(matches.length===1)entry=matches[0];
   else if(matches.length){conflicts.push(c.sourceId);continue;}
  }
  if(entry&&used.has(entry.id)){conflicts.push(c.sourceId);continue;}
  if(entry){
   used.add(entry.id);links[c.sourceId]={id:entry.id,name:entry.name,number:entry.number};
   if(entry.name===c.name&&entry.number===c.number)continue;
  }
  actions.push({sourceId:c.sourceId,kind:entry?'updated':'added',item:{...(entry?{id:entry.id,version:entry.version}:{}),name:c.name,number:c.number}});
 }
 return {actions,links,conflicts,skipped,preserved:entries.filter(e=>!used.has(e.id)).length};
}
export async function listEntries(request,base){
 const rows=[],ids=new Set();let total=null;
 for(let page=0;page<100;page++){
  const p=await request(base+'/v2/address-book/'+ADDRESS_BOOK_ID+'/entry?page='+page+'&pageSize=100');
  if(!Array.isArray(p.data)||!Number.isInteger(p.meta?.totalPages)||!Number.isInteger(p.meta?.totalRecords)||p.meta.page!==page)throw Error('Incomplete address-book pagination');
  if(total===null)total=p.meta.totalRecords;
  if(total!==p.meta.totalRecords)throw Error('Address book changed during pagination; retry next sync');
  for(const e of p.data){if(!e.id||typeof e.name!=='string'||typeof e.number!=='string'||ids.has(e.id))throw Error('Invalid or repeated address-book entry');ids.add(e.id);rows.push(e);}
  if(page+1>=p.meta.totalPages){if(rows.length!==total)throw Error('Incomplete address-book entries');return rows;}
 }
 throw Error('Address-book pagination limit exceeded');
}
export async function syncAddressBook(env,webexFetch,store){
 const lease=await store('address-book/begin',{});
 if(!lease.acquired)return lease.status;
 const token=lease.token,managed={...lease.managed};
 let added=0,updated=0,plan;
 const request=async(path,options={})=>{
  const r=await webexFetch(env,path,{...options,signal:AbortSignal.timeout(20000)});
  if(!r.ok)throw Error('Webex address book HTTP '+r.status+(r.status===403?' — check cjp:config_read/config_write and user-profile permissions':''));
  return r.json();
 };
 try{
  const org=clean(env.WEBEX_ORG_ID);
  if(!/^[0-9a-f-]{36}$/i.test(org))throw Error('Invalid Contact Center organization');
  const region=await env.WEBEX_AUTH_KV.get('webex-region-state','json');
  const origin=region?.baseUrl||'https://api.wxcc-us1.cisco.com';
  if(!/^https:\/\/api\.wxcc-[a-z0-9-]+\.cisco\.com$/.test(origin))throw Error('Unexpected Contact Center API region');
  const base=origin+'/organization/'+encodeURIComponent(org);
  const book=await request(base+'/v3/address-book/'+ADDRESS_BOOK_ID);
  if(book.id!==ADDRESS_BOOK_ID||book.name!=='CEG Address Book')throw Error('CEG Address Book identity did not match');
  const entries=await listEntries(request,base);
  plan=planAddressBook(lease.contacts,entries,managed);
  Object.assign(managed,plan.links);
  await store('address-book/checkpoint',{token,managed});
  for(let start=0;start<plan.actions.length;start+=40){
   // Renew the single-flight lease before each batch. Never overlap scheduled/manual runs.
   await store('address-book/checkpoint',{token,managed});
   const batch=plan.actions.slice(start,start+40);
   const result=await request(base+'/address-book/'+ADDRESS_BOOK_ID+'/entry/bulk',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({items:batch.map((a,i)=>({itemIdentifier:i,requestAction:'SAVE',item:{...a.item,organizationId:org}}))})});
   if(!Array.isArray(result.items)||result.items.length!==batch.length)throw Error('Incomplete address-book bulk result; retry will reconcile');
   let failed=0;const seen=new Set();
   for(const item of result.items){
    const i=item.itemIdentifier;
    if(!Number.isInteger(i)||i<0||i>=batch.length||seen.has(i))throw Error('Invalid address-book bulk result');
    seen.add(i);const action=batch[i];
    if(item.status<200||item.status>=300){failed++;continue;}
    const id=action.item.id||clean(item.href).split('/').pop();
    if(!/^[0-9a-f-]{36}$/i.test(id)){failed++;continue;}
    managed[action.sourceId]={id,name:action.item.name,number:action.item.number};
    if(action.kind==='added')added++;else updated++;
   }
   await store('address-book/checkpoint',{token,managed});
   if(failed)throw Error(failed+' address-book changes failed; successful changes saved and remaining changes will retry');
  }
  const verified=await listEntries(request,base);
  for(const action of plan.actions){const link=managed[action.sourceId];if(!verified.some(e=>e.id===link?.id&&e.name===action.item.name&&e.number===action.item.number))throw Error('Address-book read-back has not confirmed all changes');}
  const status={state:plan.conflicts.length||plan.skipped.length?'attention':'ready',completedAt:Date.now(),added,updated,conflicts:plan.conflicts.length,skipped:plan.skipped.length,preserved:plan.preserved,bookId:ADDRESS_BOOK_ID,message:plan.conflicts.length||plan.skipped.length?'Some directory entries need review; existing contacts were preserved.':'CEG Address Book is synchronized.'};
  await store('address-book/finish',{token,managed,status});
  return status;
 }catch(error){
  const status={state:'error',attemptedAt:Date.now(),added,updated,bookId:ADDRESS_BOOK_ID,message:String(error.message).slice(0,240)};
  await store('address-book/finish',{token,managed,status});
  return status;
 }
}
