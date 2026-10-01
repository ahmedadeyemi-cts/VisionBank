import {SettingsError, UUID, normalizeSettings} from './policy.mjs';
import {nativePayload, clientFromEnvironment, runtimeGate, publicRecord, NativeCallbackError} from './native.mjs';
import {validateWindow,callbackNumber} from './selection.mjs';
import {numberKey,initializeNumberIndex,releaseNumber,released} from './reservations.mjs';
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const respond=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const recordKey=id=>'callback:'+id;
export class CallbackExecution {
  constructor(ctx,env,{client,now=()=>Date.now()}={}){this.storage=ctx.storage;this.env=env;this.client=client;this.now=now;}
  native(){return this.client||clientFromEnvironment(this.env);}
  async readiness(state){
    const g=runtimeGate(this.env),blockers=[...g.blockers];
    if(state?.settings?.enabled!==true)blockers.push('master-switch-disabled');
    if(state?.settings?.mode!=='manual')blockers.push('automatic-processing-not-enabled-in-this-stage');
    if(g.queueId&&state?.settings?.queueId!==g.queueId)blockers.push('queue-not-approved-for-this-release');
    if(!state?.settings?.callbackEntryPointId)blockers.push('callback-entry-point-required');
    else if(g.callbackEntryPointId!==state.settings.callbackEntryPointId)blockers.push('callback-entry-point-review-required');
    if(g.ready&&state?.settings?.maxAttempts!==g.validatedTotalAttempts)blockers.push('requested-attempt-limit-not-verified');
    let native=null;
    if(g.ready){try{native=await this.native().configuration(g.queueId,g.callbackEntryPointId);
      if(!native.queueActive||!native.voiceQueue)blockers.push('native-voice-queue-unavailable');
      if(native.reportedMaximumAttempts!==g.validatedNativeMaximumAttempts)blockers.push('webex-attempt-policy-changed');
      if(!native.webCallbackEnabled)blockers.push('native-web-callback-disabled');
      if(native.callbackEntryPointId!==state?.settings?.callbackEntryPointId||!native.entryPointActive||!native.entryPointOutbound||!native.entryPointCallbackEnabled)blockers.push('webex-callback-entry-point-mismatch');
    }catch(e){blockers.push(e.code||'native-configuration-unavailable');}}
    const messages={
      'callback-entry-point-required':'Select the outbound Callback entry point in Abandoned Callback Settings.',
      'callback-entry-point-review-required':'The selected callback entry point differs from the reviewed routing configuration. New schedules remain paused until the new route is verified.',
      'webex-callback-entry-point-mismatch':'The selected entry point is no longer an active Webex callback-enabled outbound entry point. Check Channels > Settings in Control Hub.',
      'requested-attempt-limit-not-verified':`Saved maximum is ${state?.settings?.maxAttempts} total attempts; the reviewed Webex policy permits ${g.validatedTotalAttempts}. Verify a matching policy before scheduling.`,
      'webex-attempt-policy-changed':'Webex retry settings changed after validation. Recheck the policy before submitting new callbacks.',
      'native-execution-not-enabled':'Calling is not activated: the scheduled-call flow integration is not yet complete.',
      'callback-attempt-policy-not-verified':'The flow needs a bounded customer-call retry path. IVR input retries do not enforce the requested call-attempt limit.',
      'callback-entrypoint-and-caller-id-not-verified':'Verify the callback entry point and caller ID before enabling execution.',
      'pilot-phase-not-configured':'The callback pilot is not configured.',
      'approved-queue-not-configured':'Select an approved Voice queue for the pilot.',
      'one-approved-test-number-required':'One approved test number is required for the pilot.',
      'master-switch-disabled':'The saved callback switch is Off.',
      'agent-message-display-not-verified':'The flow must expose the saved callback reason to the receiving agent.',
      'automatic-processing-not-enabled-in-this-stage':'Automatic scheduling is not enabled in this stage. Use manual selection.'};
    return {ready:blockers.length===0,phase:g.phase,maxBatch:g.maxBatch,requestedMaxAttempts:state?.settings?.maxAttempts??null,verifiedTotalAttempts:g.validatedTotalAttempts,blockers,native,
      state:state?.settings?.enabled?blockers.length?'enabled-paused':'enabled-ready':'disabled',
      message:blockers.length?blockers.map(code=>messages[code]||code).join(' '):g.phase==='pilot'?'Ready for one approved test callback. Bulk remains held.':'Native scheduling is ready.'};
  }
  async inspect(rows) {
    if(!Array.isArray(rows)||rows.length>1000||rows.some(r=>!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(r.contactId||'')||!callbackNumber(r.number)))throw new SettingsError('invalid-inspection');
    const records=await this.storage.list({prefix:'callback:',limit:1001}),now=this.now();
    return Promise.all(rows.map(async(row,index)=>{
      const local=[...records.values()].find(r=>!released(r)&&callbackNumber(r.payload?.callbackNumber)===callbackNumber(row.number));
      if(local)return {contactId:row.contactId,status:'reserved',reason:'number-has-existing-callback',checkedAt:now};
      if(records.size>1000)return {contactId:row.contactId,status:'unavailable',reason:'callback-ledger-review-required',checkedAt:now};
      if(index>=5)return {contactId:row.contactId,status:'not-checked',reason:'native-inventory-checked-at-submission',checkedAt:null};
      try{const [future,active]=await Promise.all([this.native().list(row.number),this.native().active(row.number)]),found=[...future,...active];
        return {contactId:row.contactId,status:found.length?'duplicate':'clear',reason:found.length?'native-callback-already-exists':null,count:found.length,checkedAt:now,coverage:'future-schedules-and-active-callbacks'};
      }catch(error){return {contactId:row.contactId,status:'unavailable',reason:error.code||'native-inventory-unavailable',checkedAt:now};}
    }));
  }
  async job(id){
    if(!UUID.test(id||''))throw new SettingsError('invalid-job-id');
    const job=await this.storage.get('job:'+id);if(!job)return null;
    const records=[];for(const id of job.contactIds){const r=await this.storage.get(recordKey(id));if(r)records.push(publicRecord(r,this.now()));}
    return {...job,records};
  }
  async enqueue(input){
    const {mutationId,expectedVersion,preview,actor,requestId}=input;
    if(!UUID.test(mutationId||'')||!Number.isSafeInteger(expectedVersion)||!actor?.sourceIp||
      actor.identityVerified!==false||!Array.isArray(preview?.rows)||preview.rows.length>1000)throw new SettingsError('invalid-execution-request');
    const candidates=preview.rows.filter(r=>r.disposition==='candidate');
    if(!candidates.length)throw new SettingsError('no-eligible-callbacks');
    const intent={contactIds:preview.rows.map(r=>r.contactId).sort(),scope:preview.scope,expectedVersion,date:preview.window.date,startTime:preview.window.startTime};
    const fingerprint=await hash(JSON.stringify(intent));
    const prior=await this.storage.get('job:'+mutationId);
    if(prior){if(prior.fingerprint!==fingerprint)throw new SettingsError('mutation-id-reused',409);return {success:true,job:await this.job(mutationId),replayed:true};}
    const state=await this.storage.get('state'),ready=await this.readiness(state),g=runtimeGate(this.env);
    if(!ready.ready)throw new SettingsError(ready.blockers[0]||'native-not-ready',409);
    if(candidates.length>g.maxBatch)throw new SettingsError('single-callback-pilot-required',409);
    const prepared=[];
    for(const row of candidates){
      const payload=nativePayload(row,preview.window,state.settings.queueId);
      if(g.phase==='pilot'&&!g.testNumbers.includes(payload.callbackNumber))throw new SettingsError('number-not-approved-for-pilot',409);
      prepared.push({contactId:row.contactId,payload,phoneKey:'phone:'+preview.window.date+':'+await hash(payload.callbackNumber)});
    }
    const result=await this.storage.transaction(async tx=>{
      const current=await tx.get('state');
      if(current?.settings?.enabled!==true)throw new SettingsError('master-switch-disabled',409);
      if(current.version!==expectedVersion)throw new SettingsError('settings-changed-reload',409);
      const old=await tx.get('job:'+mutationId);
      if(old){if(old.fingerprint!==fingerprint)throw new SettingsError('mutation-id-reused',409);return old;}
      validateWindow(preview.window.date,preview.window.startTime,current.settings,this.now());
      const job={id:mutationId,fingerprint,intent,createdAt:new Date(this.now()).toISOString(),settingsVersion:expectedVersion,
        contactIds:[],skipped:preview.rows.filter(r=>r.disposition!=='candidate').map(r=>({contactId:r.contactId,reason:r.reason})),actor,requestId};
      await initializeNumberIndex(tx);
      const bucket=Math.floor(this.now()/60000),rateKey='job-rate:'+actor.sourceIp,oldRate=await tx.get(rateKey);
      const rate=oldRate?.bucket===bucket?oldRate:{bucket,count:0};
      if(rate.count>=4)throw new SettingsError('too-many-callback-batches',429);
      for(const item of prepared){
        const activeKey=await numberKey(item.payload.callbackNumber);
        const existing=await tx.get(recordKey(item.contactId)),phone=await tx.get(item.phoneKey),active=await tx.get(activeKey);
        if(active?.length&&!existing){job.skipped.push({contactId:item.contactId,reason:'number-has-existing-callback'});continue;}
        if(existing||phone){job.skipped.push({contactId:item.contactId,reason:existing?'original-contact-already-reserved':'number-already-reserved-for-date'});continue;}
        const record={...item,jobId:mutationId,settingsVersion:expectedVersion,window:preview.window,
          entryPoint:{id:current.settings.callbackEntryPointId,nameAtSubmission:ready.native.callbackEntryPointName||null},policy:{totalAttempts:current.settings.maxAttempts,retryOwner:'webex',nativeMaximumAttempts:ready.native.reportedMaximumAttempts,flowReview:g.reviewedFlowSha256},attemptsMade:null,status:'submission-pending',scheduleId:null,createdAt:job.createdAt,actor,requestId,revision:1,postAttempts:0};
        await tx.put(recordKey(item.contactId),record);await tx.put(item.phoneKey,item.contactId);await tx.put(activeKey,[item.contactId]);
        await tx.put('work:'+item.contactId,{contactId:item.contactId});job.contactIds.push(item.contactId);
      }
      await tx.put('job:'+mutationId,job);await tx.put(rateKey,{bucket,count:rate.count+1});
      await tx.put('callback-audit:job:'+mutationId,{action:'Callback batch requested',at:job.createdAt,actor,requestId,contactIds:job.contactIds});
      if(job.contactIds.length)await tx.setAlarm(this.now()+100);
      return job;
    });
    return {success:true,job:await this.job(result.id),replayed:false};
  }
  async finish(id,status,details={},keepWork=false){
    await this.storage.transaction(async tx=>{
      const r=await tx.get(recordKey(id));if(!r)return;
      const updated={...r,...details,status,revision:r.revision+1,updatedAt:new Date(this.now()).toISOString()};
      await tx.put(recordKey(id),updated);await releaseNumber(tx,updated);if(!keepWork)await tx.delete('work:'+id);
      await tx.put('callback-audit:'+id+':'+String(updated.revision).padStart(8,'0'),{
        action:status,at:updated.updatedAt,contactId:id,scheduleId:updated.scheduleId,actor:r.actor,requestId:r.requestId});
    });
  }
  async reconcile(record){
    const native=this.native(),rows=await native.list(record.payload.callbackNumber);
    const matches=rows.filter(r=>native.matches(r,record.payload));
    if(matches.length===1){await this.finish(record.contactId,'scheduled',{scheduleId:matches[0].id,reconciled:true});return;}
    const count=(record.reconciliationCount||0)+1;
    await this.finish(record.contactId,'creation-unconfirmed',{reconciliationCount:count,
      reason:matches.length>1?'multiple-native-matches':'native-creation-result-unconfirmed'},count<3&&record.window.startEpoch>this.now());
  }
  async nextAlarm(delay=1500){
    await this.storage.transaction(async tx=>{
      const work=await tx.list({prefix:'work:',limit:1});
      if(work.size)await tx.setAlarm(this.now()+delay);else await tx.deleteAlarm();
    });
  }
  async run(){
    const work=await this.storage.list({prefix:'work:',limit:1});if(!work.size)return;
    const id=[...work.values()][0].contactId,r=await this.storage.get(recordKey(id));let delay=1500;
    if(!r){await this.storage.delete('work:'+id);await this.nextAlarm();return;}
    // Durable wake-up precedes external I/O. A restart never replays an uncertain POST.
    await this.storage.setAlarm(this.now()+45000);
    try{
      if(['dispatching','creation-unconfirmed'].includes(r.status)){
        if(r.status==='dispatching'&&this.now()<(r.leaseUntil||0)){delay=45000;return;}
        try{await this.reconcile(r);}catch(e){await this.finish(id,'creation-unconfirmed',{reason:e.code||'reconciliation-unavailable'});}
        delay=15000;return;
      }
      if(r.status!=='submission-pending'){await this.storage.delete('work:'+id);return;}
      const current=await this.storage.get('state');
      if(!current?.settings?.enabled){await this.finish(id,'not-submitted',{reason:'master-switch-disabled'});return;}
      if(current.version!==r.settingsVersion){await this.finish(id,'not-submitted',{reason:'settings-changed'});return;}
      const g=runtimeGate(this.env),readiness=await this.readiness(current);
      if(!readiness.ready){await this.finish(id,'not-submitted',{reason:readiness.blockers.join(', ')});return;}
      if(g.phase==='pilot'&&!g.testNumbers.includes(r.payload.callbackNumber)){await this.finish(id,'not-submitted',{reason:'pilot-number-not-approved'});return;}
      validateWindow(r.window.date,r.window.startTime,current.settings,this.now());
      const native=this.native(),[existing,active]=await Promise.all([native.list(r.payload.callbackNumber),native.active(r.payload.callbackNumber)]);
      if(active.length){await this.finish(id,'not-submitted',{reason:'active-native-callback-already-exists'});return;}
      const same=existing.filter(x=>native.matches(x,r.payload));
      if(same.length===1){await this.finish(id,'scheduled',{scheduleId:same[0].id,reconciled:true});return;}
      if(existing.length){await this.finish(id,'not-submitted',{reason:'native-callback-already-exists'});return;}
      const claimed=await this.storage.transaction(async tx=>{
        const s=await tx.get('state'),latest=await tx.get(recordKey(id));
        if(!s?.settings?.enabled||s.version!==r.settingsVersion||latest?.status!=='submission-pending'||latest.postAttempts!==0)return false;
        validateWindow(r.window.date,r.window.startTime,s.settings,this.now());
        await tx.put(recordKey(id),{...latest,status:'dispatching',postAttempts:1,leaseUntil:this.now()+30000});
        return true;
      });
      if(!claimed){const latest=await this.storage.get(recordKey(id));if(latest?.postAttempts===0)await this.finish(id,'not-submitted',{reason:'state-changed-before-submission'});return;}
      let result;
      try{result=await native.create(r.payload);}
      catch(e){await this.finish(id,e.uncertain?'creation-unconfirmed':'rejected',
        {reason:e.code||'native-create-rejected',postAttempts:1},e.uncertain===true);delay=15000;return;}
      await this.finish(id,'scheduled',{scheduleId:result.id,scheduledAt:new Date(this.now()).toISOString()});
    }catch(e){
      const latest=await this.storage.get(recordKey(id));
      if(latest?.postAttempts===1)throw e; // Runtime retry can only reconcile this record.
      await this.finish(id,'not-submitted',{reason:e.code||'pre-submission-validation-failed'});
    }finally{await this.nextAlarm(delay);}
  }
  async handle(request){
    try{
      const u=new URL(request.url);
      if(request.method==='POST'&&u.pathname==='/inspect'){const input=await request.json();return respond({success:true,rows:await this.inspect(input.rows),observedAt:this.now()});}
      if(request.method==='GET'&&u.pathname==='/readiness'){
        const state=await this.storage.get('state');return respond({success:true,processing:await this.readiness(state)});
      }
      if(request.method==='GET'&&u.pathname==='/jobs'){
        const job=await this.job(u.searchParams.get('id'));return respond({success:!!job,job},job?200:404);
      }
      if(request.method==='GET'&&u.pathname==='/records'){
        const ids=(u.searchParams.get('ids')||'').split(',');
        if(ids.length>1000||ids.some(id=>!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)))throw new SettingsError('invalid-record-ids');
        const rows=[];for(const id of [...new Set(ids)]){const r=await this.storage.get(recordKey(id.toLowerCase()));if(r)rows.push(publicRecord(r,this.now()));}
        return respond({success:true,rows,observedAt:this.now()});
      }
      if(request.method==='POST'&&u.pathname==='/schedule')return respond(await this.enqueue(await request.json()),202);
      return respond({success:false,error:'not-found'},404);
    }catch(e){return respond({success:false,error:e instanceof SettingsError||e instanceof NativeCallbackError?e.code:'callback-service-unavailable'},
      e instanceof SettingsError?e.status:503);}
  }
}
