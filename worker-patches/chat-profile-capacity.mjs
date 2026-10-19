// Configuration capacity is separate from historical/reporting channel records.
const cache=new Map();
const id=v=>typeof v==='string'?v.trim():'';
async function resource(env,request,base,path){
 const key=base+path,now=Date.now(),old=cache.get(key);
 if(old&&old.until>now)return old.promise;
 const entry={until:now+60000,promise:null};
 entry.promise=(async()=>{const r=await request(env,key,{signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error('configuration-http-'+r.status);const p=await r.json();if(!p||typeof p!=='object'||Array.isArray(p))throw Error('invalid-configuration');return p;})();
 cache.set(key,entry);if(cache.size>1000)cache.delete(cache.keys().next().value);
 entry.promise.catch(()=>{entry.until=Date.now()+10000;});return entry.promise;
}
export async function enrichChatCapacity(agents,env,request,baseUrl){
 const base=baseUrl+'/organization/'+encodeURIComponent(env.WEBEX_ORG_ID);
 return Promise.all(agents.map(async a=>{
  let capacity;
  try{
   const get=(type,value)=>resource(env,request,base,'/'+type+'/'+encodeURIComponent(value));
   if(!id(a.agentId))throw Error('agent-id-missing');
   const user=await get('user',a.agentId);if(user.id!==a.agentId)throw Error('agent-id-mismatch');
   let profileId=id(user.multimediaProfileId),assignment='agent',siteId=id(user.siteId);
   if(!profileId&&id(a.teamId)){
    const team=await get('team',a.teamId);if(team.id!==a.teamId)throw Error('team-id-mismatch');
    profileId=id(team.multiMediaProfileId);siteId=id(team.siteId)||siteId;assignment='team';
   }
   if(!profileId&&siteId){const site=await get('site',siteId);if(site.id!==siteId)throw Error('site-id-mismatch');profileId=id(site.multimediaProfileId);assignment='site';}
   if(!profileId)throw Error('profile-not-assigned');
   const profile=await get('multimedia-profile',profileId);
   if(profile.id!==profileId||profile.active!==true||!Number.isSafeInteger(profile.chat)||profile.chat<0)throw Error('profile-unavailable');
   capacity={status:'ready',limit:profile.chat,source:'webex-multimedia-profile',assignment,profileId,observedAt:Date.now()};
  }catch(e){capacity={status:'unavailable',limit:null,source:'webex-multimedia-profile',reason:e.message,observedAt:Date.now()};}
  return {...a,chatCapacity:capacity};
 }));
}
