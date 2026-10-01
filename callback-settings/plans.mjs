// Durable preparation only. Saving or archiving a plan never starts an alarm or calls Webex.
import {SettingsError, UUID, AGENT_MESSAGE} from './policy.mjs';
import {parseSelection,validateWindow,callbackNumber} from './selection.mjs';
const CONTACT=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const fail=(ok,code,status=400)=>{if(!ok)throw new SettingsError(code,status);};
const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),b=>b.toString(16).padStart(2,'0')).join('');
export function parsePlanChange(body) {
  fail(body && typeof body==='object' && !Array.isArray(body),'invalid-plan');
  fail(Object.keys(body).every(k=>['action','mutationId','planId','expectedPlanRevision','selection'].includes(k)),'unknown-plan-field');
  fail(['save','archive'].includes(body.action)&&UUID.test(body.mutationId||''),'invalid-plan-action');
  const planId=body.planId || body.mutationId;
  fail(UUID.test(planId)&&Number.isSafeInteger(body.expectedPlanRevision)&&body.expectedPlanRevision>=0,'invalid-plan-version');
  if(body.action==='archive')fail(body.expectedPlanRevision>0&&!body.selection,'invalid-plan-archive');
  const selection=body.action==='save'?parseSelection(body.selection):null;
  if(selection)selection.contactIds.sort();
  return {action:body.action,mutationId:body.mutationId,planId,expectedPlanRevision:body.expectedPlanRevision,selection};
}
export const planFingerprint = change => digest(JSON.stringify(change));
const publicPlan = p => ({...p,scheduled:false,message:p.status==='draft'?'Saved plan only. Nothing will run automatically.':p.status==='archived'?'Archived plan; no native schedule was canceled.':'Submitted; consult the callback records for Webex confirmation.'});
export function previewSavedPlan(selection,state,plan,options,now=Date.now()) {
  const x=parseSelection(selection),s=state.settings;
  fail(plan?.status==='draft','plan-not-editable',409);
  fail(x.expectedVersion===state.version,'settings-changed-reload',409);
  fail(x.contactIds.length===plan.contactIds.length&&x.contactIds.every(id=>plan.contactIds.includes(id)),'saved-plan-selection-changed',409);
  fail(plan.queueId===s.queueId&&plan.callbackEntryPointId===s.callbackEntryPointId&&plan.requestedTotalAttempts===s.maxAttempts,'plan-settings-changed-save-again',409);
  fail(options.some(q=>q.id===s.queueId),'voice-queue-not-configured');
  fail(Number.isFinite(plan.sourceObservedAt)&&plan.sourceObservedAt<=now+5000&&now-plan.sourceObservedAt<=31*86400000,'saved-source-expired',409);
  const window=validateWindow(x.date,x.startTime,s,now);
  return {success:true,scope:x.scope,selected:plan.rows.length,candidates:plan.rows.length,skipped:0,queue:options.find(q=>q.id===s.queueId),window,
    rows:plan.rows.map(r=>({contactId:r.contactId,number:r.number,disposition:'candidate',reason:null})),
    source:{kind:'saved-validated-abandonment',observedAt:plan.sourceObservedAt},planId:plan.id,planRevision:plan.revision};
}
export class CallbackPlans {
  constructor(storage,now=()=>Date.now()){this.storage=storage;this.now=now;}
  async get(id){fail(UUID.test(id||''),'invalid-plan-id');const p=await this.storage.get('plan:'+id);if(!p)return null;
    const rows=await this.storage.list({prefix:'plan-source:'+id+':',limit:1001});
    fail(rows.size===p.contactIds.length,'plan-source-incomplete',503);
    return publicPlan({...p,rows:[...rows.values()]});
  }
  async mutation(id){fail(UUID.test(id||''),'invalid-mutation-id');return await this.storage.get('plan-mutation:'+id)||null;}
  async list(before){
    fail(!before || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z:[\da-f-]{36}$/.test(before),'invalid-plan-cursor');
    const index=await this.storage.list({prefix:'plan-index:',reverse:true,limit:21,...(before?{end:'plan-index:'+before}:{})});
    const entries=[...index],more=entries.length>20;entries.splice(20);const plans=[];
    for(const [,id] of entries){const p=await this.storage.get('plan:'+id);fail(!!p,'plan-index-incomplete',503);const {contactIds,...summary}=p;plans.push(publicPlan({...summary,count:contactIds.length}));}
    return {plans,nextBefore:more?entries.at(-1)[0].slice('plan-index:'.length):null};
  }
  async save({change,preview,sourceObservedAt,actor,requestId}) {
    const x=parsePlanChange(change),fingerprint=await planFingerprint(x),now=this.now();
    fail(actor?.identityVerified===false&&typeof actor.sourceIp==='string'&&UUID.test(requestId||''),'invalid-plan-source');
    const result=await this.storage.transaction(async tx=>{
      const replay=await tx.get('plan-mutation:'+x.mutationId);
      if(replay){fail(replay.fingerprint===fingerprint,'mutation-id-reused',409);return replay;}
      const current=await tx.get('plan:'+x.planId);
      fail(current?current.revision===x.expectedPlanRevision:x.expectedPlanRevision===0,'plan-changed-reload',409);
      fail(!current||current.status==='draft','plan-not-editable',409);
      let next;
      if(x.action==='archive'){fail(!!current,'plan-not-found',404);next={...current,status:'archived'};}
      else {
        const state=await tx.get('state');fail(state&&state.version===x.selection.expectedVersion,'settings-changed-reload',409);
        const s=state.settings,window=validateWindow(x.selection.date,x.selection.startTime,s,now);
        const rows=preview?.rows?.filter(r=>r.disposition==='candidate');
        fail(Array.isArray(rows)&&rows.length>0&&rows.length<=1000,'no-eligible-callbacks');
        fail(rows.every(r=>CONTACT.test(r.contactId)&&callbackNumber(r.number)===r.number),'invalid-plan-source');
        fail(new Set(rows.map(r=>r.number)).size===rows.length&&new Set(rows.map(r=>r.contactId)).size===rows.length,'duplicate-plan-source');
        const ids=rows.map(r=>r.contactId).sort();
        fail(!current||JSON.stringify(current.contactIds)===JSON.stringify(ids),'saved-plan-selection-changed',409);
        if(!current){fail(Number.isFinite(sourceObservedAt)&&now-sourceObservedAt<=180000&&sourceObservedAt<=now+5000,'plan-source-stale');
          for(const r of rows)await tx.put('plan-source:'+x.planId+':'+r.contactId,{contactId:r.contactId,number:r.number});}
        next={id:x.planId,status:'draft',contactIds:ids,sourceObservedAt:current?.sourceObservedAt??sourceObservedAt,
          scope:x.selection.scope,window,queueId:s.queueId,callbackEntryPointId:s.callbackEntryPointId,requestedTotalAttempts:s.maxAttempts,
          agentMessage:AGENT_MESSAGE,settingsVersion:state.version,createdAt:current?.createdAt||new Date(now).toISOString()};
      }
      const bucket=Math.floor(now/60000),rk='plan-rate:'+actor.sourceIp,oldRate=await tx.get(rk),rate=oldRate?.bucket===bucket?oldRate:{bucket,count:0};
      fail(rate.count<12,'too-many-plan-changes',429);
      next={...next,revision:(current?.revision||0)+1,updatedAt:new Date(now).toISOString(),lastChangedBy:actor};
      await tx.put('plan:'+x.planId,next);
      if(!current)await tx.put('plan-index:'+next.createdAt+':'+x.planId,x.planId);
      await tx.put('plan-audit:'+x.planId+':'+String(next.revision).padStart(8,'0'),{action:x.action==='archive'?'Plan archived':'Plan saved',at:next.updatedAt,actor,requestId,revision:next.revision});
      await tx.put(rk,{bucket,count:rate.count+1});
      const mutation={fingerprint,planId:x.planId,revision:next.revision};await tx.put('plan-mutation:'+x.mutationId,mutation);return mutation;
    });
    return {success:true,plan:await this.get(result.planId),mutationId:x.mutationId,nativeScheduleCreated:false};
  }
  async fetch(request){
    try{const u=new URL(request.url);
      if(request.method==='POST')return Response.json(await this.save(await request.json()));
      if(u.searchParams.has('mutationId')){const mutation=await this.mutation(u.searchParams.get('mutationId'));return Response.json({success:true,mutation,plan:mutation?await this.get(mutation.planId):null});}
      if(u.searchParams.has('id')){const plan=await this.get(u.searchParams.get('id'));return Response.json({success:!!plan,plan},{status:plan?200:404});}
      return Response.json({success:true,...await this.list(u.searchParams.get('before'))});
    }catch(e){return Response.json({success:false,error:e instanceof SettingsError?e.code:'plan-storage-unavailable'},{status:e instanceof SettingsError?e.status:503});}
  }
}
