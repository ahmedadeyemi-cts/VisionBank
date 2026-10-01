// Invoked through the private binding by the existing five-minute Worker schedule.
// Disabled/manual/pilot modes never collect source records or create callbacks.
import {runtimeGate} from './native.mjs';
import {SettingsError,UUID} from './policy.mjs';
import {buildPreview,nextWindow,callbackNumber} from './selection.mjs';
const uuid=async text=>{const b=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const s=Array.from(b.slice(0,16),v=>v.toString(16).padStart(2,'0')).join('');return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');};
export class CallbackAutomation {
  constructor(ex){this.ex=ex;this.storage=ex.storage;this.now=ex.now;}
  async status(){
    const state=await this.storage.get('state'),settings=state?.settings||{},g=runtimeGate(this.ex.env),last=await this.storage.get('automation:last')||{};
    const enabled=settings.enabled===true&&settings.mode==='automatic-new-abandoned';
    return {success:true,enabled,eligible:enabled&&g.ready&&g.phase==='live'&&Number.isFinite(state.automaticSince),frequencyMinutes:5,
      activeSince:state?.automaticSince||null,phase:g.phase,lastScanAt:last.at||null,lastQueued:last.queued||0,lastError:last.error||null,
      message:!enabled?'Automatic processing is off; manual preparation remains available.':g.phase!=='live'||!g.ready?'Automatic processing is paused until the new flow and live-mode pilot approval are verified.':!state.automaticSince?'Save automatic settings to establish a new-call start time.':'New eligible abandoned calls are checked every five minutes. No historical backfill.'};
  }
  async tick(report){
    if(!(await this.status()).eligible)return this.status();
    const now=this.now(),token=crypto.randomUUID();
    const claimed=await this.storage.transaction(async tx=>{const lease=await tx.get('automation:lease');if(lease?.until>now)return false;await tx.put('automation:lease',{token,until:now+45000});return true;});
    if(!claimed)return {success:true,skipped:'scan-in-progress'};
    try{
      const state=await this.storage.get('state'),ready=await this.ex.readiness(state);
      if(!ready.ready||ready.phase!=='live')return {success:true,skipped:'native-not-ready'};
      if(report?.success!==true||!Array.isArray(report.abandonedCalls))throw new SettingsError('automatic-report-unavailable');
      const ids=[];
      for(const r of [...report.abandonedCalls].sort((a,b)=>a.endEpoch-b.endEpoch||String(a.contactId).localeCompare(String(b.contactId)))){
        if(!Number.isFinite(r.endEpoch)||r.endEpoch<state.automaticSince||!callbackNumber(r.ani)||!UUID.test(r.contactId||''))continue;
        if(!await this.storage.get('callback:'+r.contactId))ids.push(r.contactId);
        if(ids.length===20)break;
      }
      if(!ids.length){await this.storage.put('automation:last',{at:new Date(now).toISOString(),queued:0,error:null});return {success:true,queued:0};}
      // Buffer for sequential native preflight, while preserving all customer calling limits.
      const window=nextWindow(state.settings,now+600000),preview=buildPreview({contactIds:ids,scope:'selected',expectedVersion:state.version,date:window.date,startTime:window.startTime},state,report,[{id:state.settings.queueId,name:ready.native.queueName}],now);
      if(!preview.candidates){await this.storage.put('automation:last',{at:new Date(now).toISOString(),queued:0,error:null});return {success:true,queued:0};}
      const mutationId=await uuid(JSON.stringify({version:state.version,ids:[...ids].sort(),date:window.date,start:window.startTime}));
      const result=await this.ex.enqueue({mutationId,expectedVersion:state.version,preview,actor:{...state.lastChangedBy,source:'automatic-worker-on-behalf-of-setting'},requestId:crypto.randomUUID()});
      await this.storage.put('automation:last',{at:new Date(now).toISOString(),queued:result.job.contactIds.length,error:null,jobId:result.job.id});
      return {success:true,queued:result.job.contactIds.length};
    }catch(e){await this.storage.put('automation:last',{at:new Date(now).toISOString(),queued:0,error:e.code||'automatic-scan-failed'});return {success:false,error:e.code||'automatic-scan-failed'};}
    finally{await this.storage.transaction(async tx=>{if((await tx.get('automation:lease'))?.token===token)await tx.delete('automation:lease');});}
  }
}
