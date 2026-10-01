import {earliestWork} from './work-index.mjs';
// Link the immutable original contact via NewContact.ScheduleSourceInteractionId.
// The local ledger supplies its one confirmed Webex schedule ID; phone/time alone never links calls.
import {SettingsError} from './policy.mjs';
import {callbackNumber} from './selection.mjs';
import {releaseNumber,released} from './reservations.mjs';
const vars=raw=>{
  if(Array.isArray(raw)){const out={};for(const v of raw){if(v&&typeof v.name==='string'){if(Object.hasOwn(out,v.name))throw new SettingsError('duplicate-outcome-variable',503);out[v.name]=v.value;}}return out;}
  return raw&&typeof raw==='object'?raw:{};
};
export function correlateOutcome(record,tasks,now=Date.now()){
  const matching=[];
  for(const task of tasks){
    const g=vars(task.globalVariables),source=g.VB_CallbackSourceInteractionId;
    if(source!==record.contactId)continue;
    if(g.VB_CallbackScheduleId!==undefined&&g.VB_CallbackScheduleId!==record.scheduleId)throw new SettingsError('callback-schedule-tag-conflict',503);
    if(task.isCallback!==true||typeof task.isActive!=='boolean'||callbackNumber(task.callbackData?.callbackNumber)!==callbackNumber(record.payload.callbackNumber))throw new SettingsError('callback-outcome-correlation-mismatch',503);
    if(!Number.isFinite(task.createdTime)||task.createdTime<record.window.startEpoch-60000||task.createdTime>now+5000)throw new SettingsError('callback-outcome-timestamp-invalid',503);
    const count=g.VB_CallbackAttempts;
    if(count!==undefined&&count!==null&&!(typeof count==='number'&&Number.isSafeInteger(count)&&count>=0&&count<=100||typeof count==='string'&&/^(?:0|[1-9]\d{0,2})$/.test(count)&&Number(count)<=100))throw new SettingsError('callback-attempt-evidence-invalid',503);
    matching.push({task,g,count:count===undefined||count===null?null:Number(count)});
  }
  if(!matching.length)return {status:'unconfirmed',terminal:false,attemptsMade:null,interactionIds:[],message:'No call report is linked to the original callback source interaction yet. Completion and attempts remain unconfirmed.'};
  matching.sort((a,b)=>(b.task.lastActivityTime||b.task.endedTime||b.task.createdTime)-(a.task.lastActivityTime||a.task.endedTime||a.task.createdTime));
  const active=matching.filter(v=>v.task.isActive),sample=(active[0]||matching[0]),raw=String(sample.g.VB_CallbackOutcome||'').toUpperCase();
  const counts=matching.map(v=>v.count).filter(v=>v!==null),attempts=counts.length?Math.max(...counts):null;
  const connected=matching.some(v=>Number.isFinite(v.task.callbackData?.callbackConnectTime)&&v.task.callbackData.callbackConnectTime>=v.task.createdTime&&v.task.callbackData.callbackConnectTime<=now);
  const ended=matching.every(v=>!v.task.isActive&&Number.isFinite(v.task.endedTime)&&v.task.endedTime>=v.task.createdTime&&v.task.endedTime<=now);
  let status='outcome-unconfirmed',terminal=false;
  if(active.length)status=connected?'connected':raw==='DIALING'?'dialing':raw==='QUEUED'?'awaiting-agent':'callback-active';
  else if(ended&&connected){status='completed';terminal=true;}
  else if(ended&&['EXHAUSTED','EXPIRED','CANCELED','FAILED'].includes(raw)){status=({EXHAUSTED:'exhausted',EXPIRED:'expired',CANCELED:'canceled',FAILED:'failed-terminal'})[raw];terminal=true;}
  else if(['NO_ANSWER','BUSY','RETRY_PENDING'].includes(raw))status='retry-pending';
  const retry=sample.task.callbackData?.callbackRetryCount;
  return {status,terminal,attemptsMade:attempts,providerRetryCount:Number.isSafeInteger(retry)&&retry>=0?retry:null,policyExceeded:attempts!==null&&attempts>record.policy.totalAttempts,
    correlation:'sourceInteraction',sourceInteraction:record.contactId,scheduleId:record.scheduleId,interactionIds:matching.map(v=>v.task.id),agent:sample.task.lastAgent?.name||null,lastOutcome:raw||null,
    message:terminal?'Call outcome confirmed from source-interaction-linked Webex reporting.':'Source-interaction-linked callback activity is reported; final outcome is not yet confirmed.'};
}
export class CallbackOutcomes {
  constructor(execution){this.ex=execution;this.storage=execution.storage;this.now=execution.now;}
  async observe(id){
    const r=await this.storage.get('callback:'+id);if(!r?.scheduleId||r.management||released(r))return;
    const now=this.now();if(now<r.window.startEpoch)return;
    try{
      const native=this.ex.native(),outcome=correlateOutcome(r,await native.history(r),now);
      if(outcome.status==='unconfirmed'){
        await this.storage.transaction(async tx=>{const latest=await tx.get('callback:'+id);if(latest?.revision===r.revision)await tx.put('callback:'+id,{...latest,outcomeObservation:{...outcome,checkedAt:now}});});return;
      }
      // A terminal flow/report result still cannot release a number with other pending work.
      let clear=false;if(outcome.terminal){const [future,active]=await Promise.all([native.list(r.payload.callbackNumber),native.active(r.payload.callbackNumber)]);clear=!future.length&&!active.length;}
      await this.storage.transaction(async tx=>{
        const latest=await tx.get('callback:'+id);if(latest?.revision!==r.revision||latest.management||released(latest))return;
        const updated={...latest,attemptsMade:outcome.attemptsMade===null?latest.attemptsMade:Math.max(latest.attemptsMade||0,outcome.attemptsMade),
          outcomeObservation:{...outcome,checkedAt:now,reservationReleaseVerified:clear},status:outcome.terminal&&!clear?'outcome-unconfirmed':outcome.status,revision:latest.revision+1,updatedAt:new Date(now).toISOString()};
        await tx.put('callback:'+id,updated);if(clear){await releaseNumber(tx,updated);await tx.delete('monitor:'+id);}
        if(latest.status!==updated.status)await tx.put('callback-audit:'+id+':'+String(updated.revision).padStart(8,'0'),{action:updated.status,at:updated.updatedAt,contactId:id,scheduleId:r.scheduleId,source:'Webex source-interaction-linked reporting'});
      });
    }catch(e){
      await this.storage.transaction(async tx=>{const latest=await tx.get('callback:'+id);if(latest?.revision===r.revision)await tx.put('callback:'+id,{...latest,outcomeObservation:{checkedAt:now,status:'unavailable',message:e.code||'callback-outcome-unavailable'}});});
    }
  }
  async run(){
    const item=await earliestWork(this.storage,'monitor:',this.now());if(!item)return false;
    const r=await this.storage.get('callback:'+item.contactId);
    if(!r||released(r)){await this.storage.delete('monitor:'+item.contactId);return true;}
    const age=this.now()-r.window.startEpoch;
    if(age>15*86400000){await this.storage.delete('monitor:'+item.contactId);return true;}
    await this.storage.put('monitor:'+item.contactId,{...item,due:this.now()+(age>86400000?900000:60000)});
    await this.observe(item.contactId);return true;
  }
  async ensureAlarm(){
    const item=await earliestWork(this.storage,'monitor:');if(!item)return;
    const due=Math.max(this.now()+1000,item.due),alarm=await this.storage.getAlarm();
    if(alarm===null||alarm>due)await this.storage.setAlarm(due);
  }
}
