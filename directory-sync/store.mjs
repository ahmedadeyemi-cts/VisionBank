import {removeApprovedLegacy} from './legacy-cleanup.mjs';
import {DIRECTORY_KEY,planSync} from './sync.mjs';
export class DirectoryStore {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){return this.ctx.blockConcurrencyWhile(async()=>{
  try{
   const storage=this.ctx.storage;let state=await storage.get('directory-state');
   if(!state){const contacts=await this.env.DIRECTORY_KV.get(DIRECTORY_KEY,'json');if(!Array.isArray(contacts))throw Error('Directory unavailable');state={contacts,revision:0,sync:null};await storage.put('directory-state',state);}
   if(!await storage.get('legacy-cleanup-20261015')){
    const clean=await removeApprovedLegacy(state.contacts);
    if(clean.removed){
     await storage.put('directory-backup:'+state.revision,state);
     state={...state,contacts:clean.rows,revision:state.revision+1};
     if(state.sync&&clean.removed===35)state.sync={...state.sync,unmatched:0,ambiguous:0};
     await storage.put('directory-state',state);
    }
    await this.env.DIRECTORY_KV.put(DIRECTORY_KEY,JSON.stringify(state.contacts));
    await storage.put('legacy-cleanup-20261015',{completedAt:Date.now(),removed:clean.removed});
   }
   const path=new URL(request.url).pathname;
   if(request.method==='GET'&&path==='/directory/get')return Response.json({success:true,...state,count:state.contacts.length});
   if(request.method!=='POST')return Response.json({error:'method-not-allowed'},{status:405});
   const body=await request.json();let next,summary;
   if(path==='/directory/error'){state.sync={...state.sync,state:'error',attemptedAt:Date.now(),message:String(body.message).slice(0,180)};await storage.put('directory-state',state);return Response.json({success:true});}
   if(path==='/directory/save'){
    if(body.revision!==state.revision)return Response.json({error:'The directory changed since you loaded it. Reload before saving so newer updates are not overwritten.'},{status:409});
    if(!Array.isArray(body.contacts)||body.contacts.length>5000)throw Error('Invalid directory');next=body.contacts;
   }else if(path==='/directory/sync'){
    if(!Array.isArray(body.sources)||!body.sources.length||body.sources.some(s=>!s.id||!['PEOPLE','PLACE'].includes(s.type)))throw Error('Incomplete source');
    const p=planSync(state.contacts,body.sources);next=p.rows;
    summary={state:'ready',source:'Webex',intervalHours:3,completedAt:Date.now(),matched:p.matched,updated:p.changes.filter(c=>c.fields.some(f=>f!=='webexDirectoryId')).length,deleted:p.deleted.length,protected:p.protectedCount,unmatched:p.unmatched.length,ambiguous:p.ambiguous.length};
   }else return Response.json({error:'not-found'},{status:404});
   if(JSON.stringify(next)!==JSON.stringify(state.contacts)){
    await storage.put('directory-backup:'+state.revision,state);
    // This object serializes sync and manual saves; revision checks reject stale editors.
    state={contacts:next,revision:state.revision+1,sync:summary||state.sync};await storage.put('directory-state',state);
   }else if(summary){state.sync=summary;await storage.put('directory-state',state);}
   await this.env.DIRECTORY_KV.put(DIRECTORY_KEY,JSON.stringify(state.contacts));
   return Response.json({success:true,...state,count:state.contacts.length});
  }catch(error){return Response.json({error:String(error.message).slice(0,180)},{status:503});}
 });}
}
