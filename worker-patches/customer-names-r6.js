/* Optional customer names. Independent of all existing report builders and caches.
 * Only customer.name is requested; no email, phone, transcript or guessed identity.
 */
const VB_NAME_REVISION = '2026.09.28-customer-names-r6';
const vbNameCache = new Map();
const vbNameLoads = new Map();
const vbNameCooldown = new Map();
function vbNameIds(url) {
  const values=url.searchParams.getAll('ids');
  if(values.length!==1)throw new Error('invalid-contact-ids');
  const raw=values[0].split(',');
  if(raw.length<1||raw.length>50||raw.some(x=>! /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x)))throw new Error('invalid-contact-ids');
  return [...new Set(raw.map(x=>x.toLowerCase()))].sort();
}
function vbNameValue(value) {
  if(typeof value!=='string')return null;
  const s=value.normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim();
  return s&&s.length<=160?s:null;
}
function vbNameQuery(ids,now,cursor) {
  const from=now-30*86400000;
  return `{taskDetails(from:${from} to:${now} filter:{and:[{channelType:{equals:chat}},{or:[${ids.map(id=>`{id:{equals:${JSON.stringify(id)}}}`).join(',')}]}]}
    ${cursor?`pagination:{cursor:${JSON.stringify(cursor)}}`:''}) {
    tasks {id channelType customer {name}} pageInfo {hasNextPage endCursor}}}`;
}
async function vbNameLoad(env,ids,now) {
  const controller=new AbortController(),deadline=Date.now()+4000;
  let timer;const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('name-lookup-timeout'));},4000);});
  const operation=(async()=>{
    const org=String(env.WEBEX_ORG_ID||'');
    if(!org)throw new Error('name-organization-unavailable');
    const region=await env.WEBEX_AUTH_KV.get(WEBEX_REGION_STATE_KEY,'json');
    if(!region?.baseUrl)throw new Error('name-region-unavailable');
    const rows=new Map(),seen=new Set();let cursor=null;
    for(let page=0;page<5;page++) {
      if(Date.now()>=deadline)throw new Error('name-lookup-timeout');
      const res=await webexFetch(env,`${region.baseUrl}/search?orgId=${encodeURIComponent(org)}`,{
        method:'POST',signal:controller.signal,headers:{'Content-Type':'application/json',Accept:'application/json','Accept-Encoding':'gzip'},
        body:JSON.stringify({query:vbNameQuery(ids,now,cursor),variables:{}})});
      if(res.status===429){const raw=Number(res.headers.get('Retry-After'));vbNameCooldown.set(org,Date.now()+Math.min(300,Number.isFinite(raw)&&raw>0?raw:60)*1000);await res.body?.cancel();throw new Error('name-rate-limited');}
      if(!res.ok){await res.body?.cancel();throw new Error('name-upstream-unavailable');}
      const x=await res.json(),root=x.data?.taskDetails;
      if(x.errors?.length||!Array.isArray(root?.tasks)||typeof root.pageInfo?.hasNextPage!=='boolean')throw new Error('name-contract-unavailable');
      for(const t of root.tasks){
        if(!ids.includes(t.id)||String(t.channelType).toLowerCase()!=='chat'||rows.has(t.id))throw new Error('name-contact-mismatch');
        rows.set(t.id,vbNameValue(t.customer?.name));
      }
      if(!root.pageInfo.hasNextPage)return ids.map(contactId=>({contactId,customerName:rows.get(contactId)??null,nameStatus:rows.get(contactId)?'reported':'not-reported'}));
      const next=root.pageInfo.endCursor;
      if(typeof next!=='string'||!next||seen.has(next))throw new Error('name-pagination-unavailable');
      seen.add(next);cursor=next;
    }
    throw new Error('name-page-limit');
  })();
  try{return await Promise.race([operation,timeout]);}finally{clearTimeout(timer);controller.abort();}
}
async function handleWebexCustomerNames(request,env,cors) {
  const headers={...cors,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  try {
    const access=await checkAccess(request,env);
    if(access?.allowed!==true)return json({success:false,error:'access-denied'},headers,403);
    let ids;try{ids=vbNameIds(new URL(request.url));}catch{return json({success:false,error:'invalid-contact-ids'},headers,400);}
    const org=String(env.WEBEX_ORG_ID||''),now=Date.now();
    if(!org)return json({success:false,error:'customer-names-unavailable'},headers,503);
    const key=org+':'+ids.join(',');
    for(const [k,v] of vbNameCache)if(v.expires<=now)vbNameCache.delete(k);
    const cached=vbNameCache.get(key);
    if(cached)return json(cached.data,headers);
    if((vbNameCooldown.get(org)||0)>now)return json({success:false,error:'customer-names-unavailable'},{...headers,'Retry-After':'60'},503);
    if(!vbNameLoads.has(key)) {
      // One optional name batch per organization at a time, independent of core reports.
      if([...vbNameLoads.keys()].some(k=>k.startsWith(org+':')))return json({success:false,error:'customer-names-busy'},{...headers,'Retry-After':'10'},503);
      const p=vbNameLoad(env,ids,now).then(rows=>{
        const data={success:true,schemaVersion:1,revision:VB_NAME_REVISION,source:'Webex taskDetails.customer.name',identityVerified:false,observedAt:Date.now(),rows};
        vbNameCache.set(key,{data,expires:Date.now()+300000});
        while(vbNameCache.size>50)vbNameCache.delete(vbNameCache.keys().next().value);
        return data;
      }).finally(()=>vbNameLoads.delete(key));vbNameLoads.set(key,p);
    }
    return json(await vbNameLoads.get(key),headers);
  }catch{return json({success:false,error:'customer-names-unavailable'},{...headers,'Retry-After':'60'},503);}
}
