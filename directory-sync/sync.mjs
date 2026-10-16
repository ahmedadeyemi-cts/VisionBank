export const CRON='17 */3 * * *';
export const DIRECTORY_KEY='visionbank-directory';
export const SYNC_VERSION=3;
export const STATUS_KEY='visionbank-directory-sync-status';
const clean=v=>String(v??'').trim(),key=v=>clean(v).toLowerCase().replace(/\s+/g,' '),digits=v=>clean(v).replace(/\D/g,'');
export const protectedEntry=c=>/^wg/i.test(clean(c.firstName));
export const excludedEntry=c=>{const name=clean(c.name||[c.firstName,c.lastName].filter(Boolean).join(' '));return /^FAX_/i.test(name)||/^Contact Center RTMS$/i.test(name)||/^Voice Messaging Group(?:\s|$)/i.test(name);};
export function sourceRows({people,workspaces,numbers,locations}){
 const locs=new Map(locations.map(x=>[x.id,x.name]));
 const rows=[];
 for(const [type,entities]of [['PEOPLE',people],['PLACE',workspaces]])for(const entity of entities){
  const ns=numbers.filter(n=>n.owner?.id===entity.id&&n.owner?.type===type&&(n.phoneNumberType==='PRIMARY'||!n.phoneNumber));
  const n=ns.length===1?ns[0]:null,person=type==='PEOPLE'?entity:null;
  rows.push({id:entity.id,type,name:clean(entity.displayName),firstName:clean(person?.firstName),lastName:clean(person?.lastName),emails:person?.emails||[],email:clean(person?.emails?.[0]),extension:n?digits(n.extension):'',phone:n?digits(n.phoneNumber):'',clearFields:n?['phone','extension']:[],location:clean(locs.get(entity.locationId)||locs.get(n?.location?.id)||n?.location?.name)});
 }
 // Assigned service lines are separate Webex owners, not users or workspaces.
 const serviceTypes=new Set(['VOICE_MESSAGING','VOICEMAIL_GROUP','VIRTUAL_LINE','CALL_QUEUE','CONTACT_CENTER_ADAPTER','AUTO_ATTENDANT','PAGING_GROUP']);
 for(const n of numbers){
  const o=n.owner;if(!o?.id||!serviceTypes.has(o.type))continue;
  const phone=digits(n.phoneNumber),extension=digits(n.extension);
  if(!phone&&!extension)continue;
  const name=[clean(o.firstName),clean(o.lastName)].filter(Boolean).join(' ');
  if(!name)throw Error('Assigned Webex service has no name');
  rows.push({id:'service:'+o.type+':'+o.id+':'+(phone||extension),type:o.type,name,firstName:clean(o.firstName),lastName:clean(o.lastName),emails:[],email:'',phone,extension,clearFields:['phone','extension'],location:clean(locs.get(n.location?.id)||n.location?.name)});
 }
 return rows;
}

export function planSync(contacts,sources){
 if(new Set(sources.map(s=>s.id)).size!==sources.length)throw Error('Duplicate Webex source identity');
 const added=[],excluded=[],blocked=new Set();
 const changes=[],unmatched=[],ambiguous=[],deleted=[];let protectedCount=0,matched=0;
 const candidates=contacts.map((c,index)=>{
  if(protectedEntry(c)){protectedCount++;return null;}
  if(excludedEntry(c)){excluded.push(index);deleted.push(index);return null;}
  let matches=[];
  if(c.webexDirectoryId){matches=sources.filter(s=>s.id===c.webexDirectoryId);if(!matches.length){deleted.push(index);return null;}}
  else {
   const byEmail=clean(c.email)?sources.filter(s=>s.emails.some(e=>key(e)===key(c.email))):[];
   matches=byEmail.length?byEmail:sources.filter(s=>key(s.name)===key(c.name||[c.firstName,c.lastName].filter(Boolean).join(' ')));
  }
  if(matches.length===1&&excludedEntry(matches[0])){excluded.push(index);deleted.push(index);return null;}
  if(matches.length!==1){for(const s of matches)blocked.add(s.id);(matches.length?ambiguous:unmatched).push(index);return null;}
  return matches[0];
 });
 const counts=new Map();for(const s of candidates)if(s)counts.set(s.id,(counts.get(s.id)||0)+1);
 const rows=contacts.map((c,index)=>{
  if(deleted.includes(index))return null;
  const s=candidates[index];if(!s)return c;
  if(counts.get(s.id)!==1){ambiguous.push(index);return c;}
  matched++;const next={...c,webexDirectoryId:s.id};
  if(s.name){next.name=s.name;next.firstName=s.firstName||s.name.split(' ')[0];next.lastName=s.lastName||(s.type==='PLACE'?s.name.split(' ').slice(1).join(' '):'');}
  for(const field of ['phone','extension','email','location'])if(clean(s[field])||s.clearFields?.includes(field))next[field]=s[field];
  if(s.location){const location='Location: '+s.location;next.notes=/^Location:[^\r\n]*/im.test(c.notes||'')?String(c.notes).replace(/^Location:[^\r\n]*/im,()=>location):[clean(c.notes),location].filter(Boolean).join('\n');}
  const fields=Object.keys(next).filter(k=>next[k]!==c[k]);if(fields.length)changes.push({index,fields});return next;
 });
 const result=rows.filter(Boolean),represented=new Set(result.map(r=>r.webexDirectoryId).filter(Boolean));
 for(const s of sources){
  if(represented.has(s.id)||counts.has(s.id)||blocked.has(s.id)||!s.name||(!s.phone&&!s.extension)||protectedEntry(s)||excludedEntry(s))continue;
  const next={webexDirectoryId:s.id,name:s.name,firstName:s.firstName||s.name.split(' ')[0],lastName:s.lastName||((s.type==='PLACE')?s.name.split(' ').slice(1).join(' '):''),phone:s.phone||'',extension:s.extension||'',email:s.email||'',location:s.location||'',notes:s.location?'Location: '+s.location:''};
  result.push(next);added.push(s.id);represented.add(s.id);
 }
 return {rows:result,added,excluded,changes,deleted,matched,protectedCount,unmatched,ambiguous};
}
export async function fetchSources(env,webexFetch){
 const raw=clean(env.WEBEX_ORG_ID);if(!raw)throw Error('Webex organization missing');
 const org=/^[0-9a-f-]{36}$/i.test(raw)?btoa('ciscospark://us/ORGANIZATION/'+raw):raw;
 async function read(path,arrayKey){
  let url='https://webexapis.com/v1/'+path+'&orgId='+encodeURIComponent(org);const rows=[],seen=new Set();
  while(url){if(seen.has(url)||seen.size>=50)throw Error('Incomplete Webex pagination');seen.add(url);const u=new URL(url);if(u.origin!=='https://webexapis.com'||!u.pathname.startsWith('/v1/'))throw Error('Unexpected Webex pagination');
   const r=await webexFetch(env,url,{method:'GET'});if(!r.ok)throw Error('Webex directory read HTTP '+r.status);const p=await r.json();if(!Array.isArray(p[arrayKey]))throw Error('Incomplete Webex directory response');if(arrayKey==='items'&&p[arrayKey].some(x=>!x?.id))throw Error('Incomplete Webex identity');rows.push(...p[arrayKey]);
   url=(r.headers.get('link')||'').match(/<([^>]+)>;\s*rel="next"/i)?.[1]||null;
  }return rows;
 }
 const [people,workspaces,numbers,locations]=await Promise.all([read('people?callingData=true&max=100','items'),read('workspaces?max=100','items'),read('telephony/config/numbers?max=100','phoneNumbers'),read('locations?max=100','items')]);
 if(!people.length||!workspaces.length||!numbers.length||!locations.length)throw Error('Webex directory source is empty');
 return sourceRows({people,workspaces,numbers,locations});
}
export function directoryStore(env){return env.ABANDONED_CALLBACK_SETTINGS.get(env.ABANDONED_CALLBACK_SETTINGS.idFromName(env.WEBEX_ORG_ID+':directory:v1'));}
export async function storeRequest(env,path,body){const r=await directoryStore(env).fetch(new Request('https://internal/directory/'+path,{method:body?'POST':'GET',...(body?{body:JSON.stringify(body),headers:{'Content-Type':'application/json'}}:{})}));const data=await r.json();if(!r.ok){const e=new Error(data.error||'Directory storage unavailable');e.status=r.status;throw e;}return data;}
export async function runDirectorySync(env,webexFetch){
 try{const sources=await fetchSources(env,webexFetch);return await storeRequest(env,'sync',{sources,version:SYNC_VERSION});}
 catch(error){await storeRequest(env,'error',{message:String(error.message).slice(0,180)});throw error;}
}
// Bootstrap once through the existing maintenance trigger; regular sync uses CRON.
export async function initializeDirectorySync(env,webexFetch){const state=await storeRequest(env,'get');if(!state.sync||state.sync.version!==SYNC_VERSION)return runDirectorySync(env,webexFetch);}
