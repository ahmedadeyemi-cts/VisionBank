import {earliestWork} from './work-index.mjs';
// Native management changes one existing schedule. Never delete/recreate to reschedule.
import {SettingsError,UUID} from './policy.mjs';
import {validateWindow} from './selection.mjs';
import {publicRecord,runtimeGate} from './native.mjs';
import {releaseNumber} from './reservations.mjs';
const ck=id=>'callback:'+id, ok=(x,c,s=409)=>{if(!x)throw new SettingsError(c,s);};
const hash=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(x)))),b=>b.toString(16).padStart(2,'0')).join('');
export class CallbackManagement {
  constructor(execution){this.ex=execution;this.storage=execution.storage;this.now=execution.now;}
  async get(id){ok(UUID.test(id||''),'invalid-mutation-id',400);return await this.storage.get('management:'+id)||null;}
  async enqueue({change,actor,requestId}){
    ok(change&&typeof change==='object'&&!Array.isArray(change),'invalid-management-request',400);
    ok(Object.keys(change).every(k=>['action','contactId','expectedRevision','mutationId','expectedVersion','date','startTime'].includes(k)),'unknown-management-field',400);
    const {action,contactId,expectedRevision,mutationId}=change;
    ok(['cancel','reschedule'].includes(action)&&UUID.test(contactId||'')&&UUID.test(mutationId||'')&&Number.isSafeInteger(expectedRevision)&&expectedRevision>0,'invalid-management-request',400);
    ok(actor?.identityVerified===false&&typeof actor.sourceIp==='string'&&UUID.test(requestId||''),'invalid-management-source',400);
    if(action==='cancel')ok(change.date===undefined&&change.startTime===undefined,'unexpected-management-window',400);
    else ok(Number.isSafeInteger(change.expectedVersion)&&typeof change.date==='string'&&typeof change.startTime==='string','management-window-required',400);
    const fingerprint=await hash(change),now=this.now();
    const operation=await this.storage.transaction(async tx=>{
      const old=await tx.get('management:'+mutationId);if(old){ok(old.fingerprint===fingerprint,'mutation-id-reused');return old;}
      const r=await tx.get(ck(contactId));ok(r,'callback-record-not-found',404);
      ok(r.revision===expectedRevision&&!r.management,'callback-changed-reload');
      ok(r.status==='scheduled'&&UUID.test(r.scheduleId||''),'confirmed-future-schedule-required');
      ok(r.window.startEpoch>now+30000,'callback-window-too-close-to-change');
      const s=await tx.get('state');let desiredWindow=null;
      if(action==='reschedule'){
        ok(s?.settings?.enabled===true,'master-switch-disabled');ok(s.version===change.expectedVersion,'settings-changed-reload');
        ok(s.settings.queueId===r.payload.queueId&&s.settings.callbackEntryPointId===r.entryPoint.id&&(s.settings.maxAttempts===r.policy.totalAttempts||runtimeGate(this.ex.env).attemptPolicyMode==='per-record-policy'),'existing-callback-policy-differs');
        desiredWindow=validateWindow(change.date,change.startTime,{...s.settings,windowMinutes:r.window.durationMinutes||Math.round((r.window.endEpoch-r.window.startEpoch)/60000)},now);
      }
      const bucket=Math.floor(now/60000),key='management-rate:'+actor.sourceIp,v=await tx.get(key),rate=v?.bucket===bucket?v:{bucket,count:0};ok(rate.count<12,'too-many-callback-changes',429);
      const op={id:mutationId,action,contactId,fingerprint,expectedVersion:change.expectedVersion??null,createdAt:new Date(now).toISOString(),actor,requestId,status:'pending',writeAttempts:0,originalWindow:r.window,desiredWindow};
      await tx.put('management:'+mutationId,op);await tx.put('management-work:'+mutationId,{id:mutationId,due:now+100});
      await tx.put(ck(contactId),{...r,management:{id:mutationId,action,status:'pending'},revision:r.revision+1});
      await tx.put('callback-audit:management:'+mutationId+':requested',{action:'Callback '+action+' requested',actor,requestId,at:op.createdAt,contactId,scheduleId:r.scheduleId});
      await tx.put(key,{bucket,count:rate.count+1});await tx.setAlarm(now+100);return op;
    });
    return {success:true,operation,record:publicRecord(await this.storage.get(ck(contactId)),this.now())};
  }
  async finish(op,status,reason=null){
    await this.storage.transaction(async tx=>{
      const current=await tx.get('management:'+op.id),r=await tx.get(ck(op.contactId));
      if(!current||!r||r.management?.id!==op.id)return;
      const at=new Date(this.now()).toISOString(),next={...r,management:null,revision:r.revision+1,updatedAt:at};
      if(status==='completed'){
        if(op.action==='cancel'){next.status='canceled';next.nativeObservation={checkedAt:this.now(),status:'cancellation-confirmed',message:reason||'Webex confirmed cancellation of this schedule.'};}
        else {next.payload=op.desiredPayload;next.window=op.desiredWindow;next.status='scheduled';next.nativeObservation={checkedAt:this.now(),status:'reschedule-confirmed',message:'Webex confirmed the revised window on the same schedule ID.'};}
      }
      next.lastManagement={id:op.id,action:op.action,status,reason,at};
      await tx.put(ck(op.contactId),next);await releaseNumber(tx,next);
      if(status==='completed'&&op.action==='cancel')await tx.delete('monitor:'+op.contactId);
      if(status==='completed'&&op.action==='reschedule')await tx.put('monitor:'+op.contactId,{contactId:op.contactId,due:next.window.startEpoch});
      await tx.put('management:'+op.id,{...current,status,reason,completedAt:at});await tx.delete('management-work:'+op.id);
      await tx.put('callback-audit:management:'+op.id+':result',{action:'Callback '+op.action+' '+status,actor:op.actor,requestId:op.requestId,at,contactId:op.contactId,scheduleId:r.scheduleId,reason});
    });
  }
  async uncertain(op,reason){
    await this.storage.transaction(async tx=>{
      const current=await tx.get('management:'+op.id),r=await tx.get(ck(op.contactId));if(!current||r?.management?.id!==op.id)return;
      const attempts=(current.reconciliationCount||0)+1;
      await tx.put('management:'+op.id,{...current,status:'unconfirmed',reason,reconciliationCount:attempts});
      await tx.put(ck(op.contactId),{...r,management:{id:op.id,action:op.action,status:'unconfirmed'},revision:r.revision+1});
      if(attempts<5)await tx.put('management-work:'+op.id,{id:op.id,due:this.now()+30000});else await tx.delete('management-work:'+op.id);
    });
  }
  async reconcile(op){
    if(this.now()<(op.leaseUntil||0))return;
    const r=await this.storage.get(ck(op.contactId));if(!r||r.management?.id!==op.id)return;
    if(op.writeAttempts===0){await this.finish(op,'not-applied','No native write was attempted; review and submit again.');return;}
    try{
      const n=this.ex.native(),found=await n.get(r.scheduleId);
      if(op.action==='reschedule'&&found&&n.matches(found,op.desiredPayload)){await this.finish(op,'completed');return;}
      if(op.action==='cancel'&&!found&&op.originalWindow.startEpoch>this.now()&&!(await n.active(r.payload.callbackNumber)).length){await this.finish(op,'completed','Cancellation confirmed: schedule absent before its start and no active callback reported.');return;}
      await this.uncertain(op,'native-change-not-confirmed');
    }catch(e){await this.uncertain(op,e.code||'native-change-lookup-failed');}
  }
  async run(){
    const item=await earliestWork(this.storage,'management-work:',this.now());if(!item)return false;
    let op=await this.get(item.id);if(!op){await this.storage.delete('management-work:'+item.id);return true;}
    if(op.status!=='pending'){await this.reconcile(op);return true;}
    const r=await this.storage.get(ck(op.contactId));
    if(!r||r.management?.id!==op.id){await this.storage.delete('management-work:'+op.id);return true;}
    // Mark ownership before any I/O so a restart cannot issue a second write.
    op={...op,status:'checking',leaseUntil:this.now()+45000};await this.storage.put('management:'+op.id,op);await this.storage.put('management-work:'+op.id,{id:op.id,due:op.leaseUntil});await this.storage.setAlarm(op.leaseUntil);
    try{
      ok(r.window.startEpoch>this.now()+30000,'callback-window-too-close-to-change');
      const native=this.ex.native(),found=await native.get(r.scheduleId);
      ok(found&&native.matches(found,r.payload),'native-schedule-changed-review-required');
      ok(!String(found.callbackType||'').includes('campaign'),'campaign-schedule-read-only');
      if(op.action==='reschedule'){
        const state=await this.storage.get('state');ok(state?.version===op.expectedVersion,'settings-changed-reload');
        const ready=await this.ex.readiness(state);ok(ready.ready,ready.blockers[0]||'native-not-ready');
        op.desiredWindow=validateWindow(op.desiredWindow.date,op.desiredWindow.startTime,{...state.settings,windowMinutes:Math.round((r.window.endEpoch-r.window.startEpoch)/60000)},this.now());
        op.desiredPayload={...r.payload,scheduleDate:op.desiredWindow.date,startTime:op.desiredWindow.startTime+':00',endTime:op.desiredWindow.endTime+':00'};
        const [future,active]=await Promise.all([native.list(r.payload.callbackNumber),native.active(r.payload.callbackNumber)]);
        ok(!future.some(v=>v.id!==r.scheduleId)&&!active.length,'another-native-callback-exists');
      }
      await this.storage.transaction(async tx=>{
        const latest=await tx.get('management:'+op.id),record=await tx.get(ck(op.contactId)),state=await tx.get('state');
        ok(latest?.writeAttempts===0&&record?.management?.id===op.id,'management-operation-changed');
        ok(r.window.startEpoch>this.now()+30000,'callback-window-too-close-to-change');
        if(op.action==='reschedule'){ok(state?.settings?.enabled===true&&state.version===op.expectedVersion,'settings-changed-reload');validateWindow(op.desiredWindow.date,op.desiredWindow.startTime,{...state.settings,windowMinutes:Math.round((r.window.endEpoch-r.window.startEpoch)/60000)},this.now());}
        op={...op,status:'writing',writeAttempts:1,leaseUntil:this.now()+30000};await tx.put('management:'+op.id,op);
        await tx.put('management-work:'+op.id,{id:op.id,due:op.leaseUntil});await tx.setAlarm(op.leaseUntil);
      });
      if(op.action==='cancel')await native.cancel(r.scheduleId);else await native.update(r.scheduleId,op.desiredPayload);
      await this.finish(op,'completed');
    }catch(e){
      if(op.writeAttempts===1&&(e.uncertain||!(e instanceof SettingsError)&&!String(e.code||'').match(/^native-http-(400|401|403|404|422|429)$/)))await this.uncertain(op,e.code||'native-change-unconfirmed');
      else await this.finish(op,'not-applied',e.code||'native-change-rejected');
    }
    return true;
  }
  async ensureAlarm(){
    const item=await earliestWork(this.storage,'management-work:');if(!item)return;
    const due=Math.max(this.now()+500,item.due),existing=await this.storage.getAlarm();
    if(existing===null||existing>due)await this.storage.setAlarm(due);
  }
}
