import {SettingsError,UUID} from './policy.mjs';
import {buildPreview,parseSelection} from './selection.mjs';
import {parsePlanChange,planFingerprint,previewSavedPlan} from './plans.mjs';
const fail=(ok,code,status=400)=>{if(!ok)throw new SettingsError(code,status);};
export async function handlePlanRequest({part,body,store,queueOptions,getReport,actor,requestId,bounded}) {
  const call=async(path,body)=>{
    const r=await bounded(store.fetch(new Request('https://callback-settings.internal/'+path,{method:body?'POST':'GET',
      headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{})})),12000);
    const data=await r.json();if(!r.ok||data.success!==true)throw new SettingsError(data.error||'callback-storage-unavailable',r.status);
    return data;
  };
  const stateResponse=()=>call('settings');
  if(part==='plans') {
    const change=parsePlanChange(body),prior=await call('plans?mutationId='+change.mutationId);
    if(prior.mutation){fail(prior.mutation.fingerprint===await planFingerprint(change),'mutation-id-reused',409);return {success:true,plan:prior.plan,replayed:true,nativeScheduleCreated:false};}
    if(change.action==='archive')return call('plans',{change,actor,requestId});
    const value=await stateResponse(),options=await queueOptions();
    let preview,sourceObservedAt;
    if(change.expectedPlanRevision>0){
      const old=(await call('plans?id='+change.planId)).plan;fail(old.revision===change.expectedPlanRevision,'plan-changed-reload',409);
      preview=previewSavedPlan(change.selection,value.state,{...old,queueId:value.state.settings.queueId,callbackEntryPointId:value.state.settings.callbackEntryPointId,requestedTotalAttempts:value.state.settings.maxAttempts},options);
      sourceObservedAt=old.sourceObservedAt;
    } else {const report=await getReport();preview=buildPreview(change.selection,value.state,report,options);sourceObservedAt=report.generatedAtEpoch;}
    return call('plans',{change,preview,sourceObservedAt,actor,requestId});
  }
  fail(body&&typeof body==='object'&&!Array.isArray(body),'invalid-plan-request');
  fail(Object.keys(body).every(k=>['planId','expectedPlanRevision','expectedVersion','date','startTime','mutationId'].includes(k)),'unknown-plan-field');
  fail(UUID.test(body.planId||'')&&Number.isSafeInteger(body.expectedPlanRevision)&&body.expectedPlanRevision>0,'invalid-plan-version');
  if(part==='plan-schedule')fail(UUID.test(body.mutationId||''),'invalid-mutation-id');
  else fail(body.mutationId===undefined,'unknown-selection-field');
  const plan=(await call('plans?id='+body.planId)).plan;
  const selection=parseSelection({contactIds:plan.contactIds,scope:plan.scope,expectedVersion:body.expectedVersion,date:body.date,startTime:body.startTime});
  if(part==='plan-schedule') {
    const r=await bounded(store.fetch(new Request('https://callback-settings.internal/jobs?id='+body.mutationId)));
    if(r.ok){const previous=await r.json();const intent={contactIds:[...selection.contactIds].sort(),scope:selection.scope,expectedVersion:selection.expectedVersion,date:selection.date,startTime:selection.startTime,planId:plan.id,planRevision:body.expectedPlanRevision};
      fail(JSON.stringify(previous.job.intent)===JSON.stringify(intent),'mutation-id-reused',409);return {success:true,job:previous.job,replayed:true};}
    fail(r.status===404,'callback-ledger-unavailable',503);
  }
  fail(plan.revision===body.expectedPlanRevision,'plan-changed-reload',409);
  const value=await stateResponse(),options=await queueOptions(),preview=previewSavedPlan(selection,value.state,plan,options);
  const ledger=await call('records?ids='+encodeURIComponent(plan.contactIds.join(','))),previous=new Map(ledger.rows.map(r=>[r.contactId,r]));
  for(const row of preview.rows)if(previous.has(row.contactId)){row.disposition='skipped';row.reason='callback-already-reserved';}
  if(part==='plan-preview'){
    const candidates=preview.rows.filter(r=>r.disposition==='candidate');
    if(candidates.length){const inspection=await call('inspect',{rows:candidates.map(({contactId,number})=>({contactId,number}))});
      const byId=new Map(inspection.rows.map(r=>[r.contactId,r]));
      for(const row of candidates){row.nativeInventory=byId.get(row.contactId)||{status:'unavailable'};
        if(['reserved','duplicate'].includes(row.nativeInventory.status)){row.disposition='skipped';row.reason=row.nativeInventory.reason;}}
    }
  }
  preview.candidates=preview.rows.filter(r=>r.disposition==='candidate').length;preview.skipped=preview.selected-preview.candidates;
  preview.processing=value.processing;
  preview.canSchedule=value.processing?.ready===true&&preview.candidates>0&&preview.candidates<=value.processing.maxBatch&&preview.rows.filter(r=>r.disposition==='candidate').every(r=>part==='plan-schedule'||['clear','not-checked'].includes(r.nativeInventory?.status));
  preview.warning=preview.canSchedule?'Preview only. Schedule submits once; native duplicate checks run again.':value.processing?.readiness?.summary||'Scheduling remains paused. The saved plan will not execute automatically.';
  if(part==='plan-preview')return preview;
  return call('schedule',{mutationId:body.mutationId,expectedVersion:selection.expectedVersion,preview,actor,requestId});
}
