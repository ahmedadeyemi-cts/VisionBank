import {AGENT_MESSAGE, SettingsError} from './policy.mjs';
import {callbackNumber} from './selection.mjs';
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const ORIGIN='https://api.wxcc-us1.cisco.com';
export class NativeCallbackError extends Error {
  constructor(code,{uncertain=false,status=503}={}){super(code);this.code=code;this.uncertain=uncertain;this.status=status;}
}
export function nativePayload(row,window,queueId){
  const number=callbackNumber(row.number);
  if(!ID.test(row.contactId)||!ID.test(queueId)||!number||number.length>15)throw new SettingsError('invalid-native-payload');
  if(window.endEpoch-window.startEpoch<1800000||window.endEpoch-window.startEpoch>28800000)throw new SettingsError('native-window-must-be-30-to-480-minutes');
  return {customerName:'Customer name not provided',callbackNumber:number,timezone:'America/Chicago',
    scheduleDate:window.date,startTime:window.startTime+':00',endTime:window.endTime+':00',queueId,
    callbackReason:AGENT_MESSAGE,sourceInteraction:row.contactId};
}
// Strictly REST: no Desktop session and no automatic replay of a create request.
export function createNativeClient({orgId,getToken,fetchImpl=fetch,timeoutMs=15000}){
  if(!ID.test(orgId))throw new SettingsError('invalid-native-organization');
  const base='/v1/callbacks/organization/'+orgId+'/scheduled-callback';
  async function request(path,method='GET',body,deadlineMs=timeoutMs){
    const writesSchedule=path.startsWith(base)&&method!=='GET';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),Math.min(timeoutMs,deadlineMs));
    try{const token=await Promise.race([getToken(),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new NativeCallbackError('native-token-deadline')),{once:true}))]);
      if(typeof token!=='string'||!token)throw new NativeCallbackError('native-token-unavailable');
      const response=await fetchImpl(ORIGIN+path,{method,redirect:'manual',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
      if(response.status>=300&&response.status<400)throw new NativeCallbackError('native-redirect-rejected',{uncertain:writesSchedule});
      if(!response.ok)throw new NativeCallbackError('native-http-'+response.status,{status:response.status,
        uncertain:writesSchedule&&![400,401,403,404,422,429].includes(response.status)});
      if(method==='DELETE'&&response.status===204)return {data:null,status:204};
      let data;try{data=await response.json();}catch{throw new NativeCallbackError('native-invalid-json',{uncertain:writesSchedule});}
      return {data,status:response.status};
    }catch(e){if(e instanceof NativeCallbackError)throw e;throw new NativeCallbackError('native-transport-unconfirmed',{uncertain:writesSchedule});}finally{clearTimeout(timer);}
  }
  function validateRecord(x){
    if(!x||!ID.test(x.id||'')||x.orgId!==orgId||!callbackNumber(x.callbackNumber)||
      !ID.test(x.queueId||'')||!/^20\d{2}-\d{2}-\d{2}$/.test(x.scheduleDate||'')||
      !/^\d{2}:\d{2}:\d{2}$/.test(x.startTime||'')||!/^\d{2}:\d{2}:\d{2}$/.test(x.endTime||'')||
      typeof x.timezone!=='string')throw new NativeCallbackError('native-record-contract-invalid');
    return x;
  }
  async function list(number){
    if(!callbackNumber(number))throw new SettingsError('invalid-callback-number');
    const records=new Map();
    const canonical=callbackNumber(number), digits=canonical.slice(1);
    const variants=[canonical,digits,...(/^\+1\d{10}$/.test(canonical)?[digits.slice(1),digits.slice(1,4)+'-'+digits.slice(4,7)+'-'+digits.slice(7)]:[])];
    const deadline=Date.now()+9000;
    for(const variant of [...new Set(variants)]){
      let totalPages=1;
      for(let page=0;page<totalPages;page++){
        const q=new URLSearchParams({callbackNumber:variant,page:String(page),pageSize:'100'});
        if(Date.now()>=deadline)throw new NativeCallbackError('native-inventory-timeout');
        const {data}=await request(base+'?'+q,'GET',undefined,deadline-Date.now());
        if(!Array.isArray(data?.data)||!Number.isSafeInteger(data.meta?.totalPages)||data.meta.totalPages<0||
          data.meta.totalPages>20||data.meta.page!==page)throw new NativeCallbackError('native-inventory-incomplete');
        totalPages=data.meta.totalPages;
        for(const item of data.data){validateRecord(item);if(callbackNumber(item.callbackNumber)!==callbackNumber(number))throw new NativeCallbackError('native-inventory-filter-mismatch');records.set(item.id,item);}
      }
    }
    return [...records.values()];
  }
  async function active(number) {
    const normalized=callbackNumber(number);if(!normalized)throw new SettingsError('invalid-callback-number');
    const to=Date.now(),deadline=to+9000,seen=new Set(),found=[],cursors=new Set();let cursor=null;
    for(let page=0;page<20;page++){
      if(Date.now()>=deadline)throw new NativeCallbackError('active-callback-lookup-timeout');
      const query=`{taskDetails(from:${to-15*86400000} to:${to} filter:{and:[{isActive:{equals:true}},{isCallback:{equals:true}}]} ${cursor?`pagination:{cursor:${JSON.stringify(cursor)}}`:''}){tasks{id origin destination customer{phoneNumber} callbackData{callbackNumber} isActive isCallback createdTime} pageInfo{hasNextPage endCursor}}}`;
      const {data}=await request('/search?orgId='+encodeURIComponent(orgId),'POST',{query,variables:{}},deadline-Date.now());
      const tasks=data?.data?.taskDetails,info=tasks?.pageInfo;
      if(data.error||data.errors?.length||!Array.isArray(tasks?.tasks)||typeof info?.hasNextPage!=='boolean')throw new NativeCallbackError('active-callback-inventory-incomplete');
      for(const r of tasks.tasks){
        if(!ID.test(r.id||'')||r.isActive!==true||r.isCallback!==true||seen.has(r.id))throw new NativeCallbackError('active-callback-record-invalid');
        seen.add(r.id);
        const numbers=[r.callbackData?.callbackNumber,r.origin,r.destination,r.customer?.phoneNumber].map(callbackNumber).filter(Boolean);
        if(!numbers.length)throw new NativeCallbackError('active-callback-number-unavailable');
        if(numbers.includes(normalized))found.push({id:r.id});
      }
      if(!info.hasNextPage)return found;
      if(typeof info.endCursor!=='string'||!info.endCursor||cursors.has(info.endCursor))throw new NativeCallbackError('active-callback-pagination-invalid');
      cursors.add(info.endCursor);cursor=info.endCursor;
    }
    throw new NativeCallbackError('active-callback-inventory-incomplete');
  }
  function matches(record,payload){return record.sourceInteraction===payload.sourceInteraction&&record.queueId===payload.queueId&&
    callbackNumber(record.callbackNumber)===payload.callbackNumber&&record.scheduleDate===payload.scheduleDate&&
    record.startTime===payload.startTime&&record.endTime===payload.endTime&&record.timezone===payload.timezone&&
    record.callbackReason===payload.callbackReason&&!record.assigneeAgent;}
  return {list,active,matches,
    async history(record){
      if(!ID.test(record?.scheduleId||'')||!Number.isFinite(record?.window?.startEpoch))throw new SettingsError('invalid-outcome-record');
      const to=Date.now(),from=record.window.startEpoch-60000;if(from>to)return [];
      if(to-from>15*86400000)throw new NativeCallbackError('outcome-report-window-expired');
      const results=[],seen=new Set(),cursors=new Set(),deadline=Date.now()+9000;let cursor=null;
      for(let page=0;page<20;page++){
        if(Date.now()>=deadline)throw new NativeCallbackError('callback-outcome-lookup-timeout');
        const query=`{taskDetails(from:${Math.floor(from)} to:${to} filter:{isCallback:{equals:true}} ${cursor?`pagination:{cursor:${JSON.stringify(cursor)}}`:''}){tasks{id status createdTime endedTime lastActivityTime isActive isCallback globalVariables callbackData{callbackNumber callbackConnectTime callbackRetryCount callbackStatus} lastAgent{id name}} pageInfo{hasNextPage endCursor}}}`;
        const {data}=await request('/search?orgId='+encodeURIComponent(orgId),'POST',{query,variables:{}},deadline-Date.now()),d=data?.data?.taskDetails;
        if(data.errors?.length||data.error||!Array.isArray(d?.tasks)||typeof d.pageInfo?.hasNextPage!=='boolean')throw new NativeCallbackError('callback-outcome-inventory-incomplete');
        for(const r of d.tasks){if(!ID.test(r.id||'')||r.isCallback!==true||typeof r.isActive!=='boolean'||seen.has(r.id))throw new NativeCallbackError('callback-outcome-record-invalid');seen.add(r.id);results.push(r);}
        if(!d.pageInfo.hasNextPage)return results;
        cursor=d.pageInfo.endCursor;if(typeof cursor!=='string'||!cursor||cursors.has(cursor))throw new NativeCallbackError('callback-outcome-pagination-invalid');cursors.add(cursor);
      }
      throw new NativeCallbackError('callback-outcome-inventory-incomplete');
    },
    async update(id,payload){
      if(!ID.test(id))throw new SettingsError('invalid-schedule-id');
      const {data,status}=await request(base+'/'+id,'PUT',{...payload,id});
      try{validateRecord(data);if(status!==200||data.id!==id||!matches(data,payload))throw Error('mismatch');}
      catch{throw new NativeCallbackError('native-update-response-unconfirmed',{uncertain:true});}
      return data;
    },
    async cancel(id){
      if(!ID.test(id))throw new SettingsError('invalid-schedule-id');
      const {status}=await request(base+'/'+id,'DELETE');
      if(status!==204)throw new NativeCallbackError('native-cancel-response-unconfirmed',{uncertain:true});
      return {id,canceled:true};
    },
    async create(payload){
      const {data,status}=await request(base,'POST',payload);
      try{validateRecord(data);if(status!==201||!matches(data,payload))throw Error('mismatch');}
      catch{throw new NativeCallbackError('native-create-response-unconfirmed',{uncertain:true});}
      return data;
    },
    async get(id){if(!ID.test(id))throw new SettingsError('invalid-schedule-id');
      try{const {data}=await request(base+'/'+id);return validateRecord(data);}
      catch(e){if(e.status===404)return null;throw e;}
    },
    async entryPoints(){
      const options=new Map(),seen=new Set(),deadline=Date.now()+5000;let totalPages=1,totalRecords=null;
      for(let page=0;page<totalPages;page++){
        if(Date.now()>=deadline)throw new NativeCallbackError('entry-point-discovery-timeout');
        const {data}=await request('/organization/'+orgId+'/v2/entry-point?page='+page+'&pageSize=100','GET',undefined,deadline-Date.now());
        const m=data?.meta;
        if(!Array.isArray(data?.data)||m?.orgid!==orgId||m.page!==page||!Number.isSafeInteger(m.totalPages)||m.totalPages<0||m.totalPages>20)throw new NativeCallbackError('entry-point-inventory-incomplete');
        if(!Number.isSafeInteger(m.totalRecords)||m.totalRecords<0||m.totalRecords>2000||m.totalPages!==Math.ceil(m.totalRecords/100))throw new NativeCallbackError('entry-point-inventory-incomplete');
        if(page>0&&(m.totalPages!==totalPages||m.totalRecords!==totalRecords))throw new NativeCallbackError('entry-point-inventory-changed');
        totalPages=m.totalPages;totalRecords=m.totalRecords;
        for(const e of data.data){
          if(!ID.test(e?.id||'')||typeof e.name!=='string'||!e.name.trim()||e.name.length>80||seen.has(e.id))throw new NativeCallbackError('entry-point-record-invalid');
          seen.add(e.id);
          if(e.entryPointType==='OUTBOUND'&&e.channelType==='TELEPHONY'&&e.active===true)
            options.set(e.id,{id:e.id,name:e.name,callbackEnabled:e.callbackEnabled===true});
        }
      }
      if(seen.size!==totalRecords)throw new NativeCallbackError('entry-point-inventory-incomplete');
      return [...options.values()].sort((a,b)=>a.name.localeCompare(b.name)||a.id.localeCompare(b.id));
    },
    async configuration(queueId,entryPointId){
      if(!ID.test(queueId))throw new SettingsError('voice-queue-required');
      if(!ID.test(entryPointId||''))throw new SettingsError('callback-entry-point-required');
      const [{data:org},{data:queue},points]=await Promise.all([request('/organization/'+orgId+'/organization-setting'),
        request('/organization/'+orgId+'/v2/contact-service-queue/'+queueId),this.entryPoints()]);
      const o=Array.isArray(org)?org[0]:org,q=queue.data||queue,e=points.find(point=>point.id===entryPointId);
      if(!o||!q||q.id!==queueId||!e||e.id!==entryPointId)throw new NativeCallbackError('native-configuration-incomplete');
      return {callbackEntryPointId:e.id,callbackEntryPointName:e.name,entryPointActive:true,entryPointOutbound:true,entryPointCallbackEnabled:e.callbackEnabled===true,queueId:q.id,queueName:q.name,queueActive:q.active===true||q.isActive===true,
        voiceQueue:/^(telephony|voice)$/i.test(q.channelType||''),webCallbackEnabled:o.webCallBackEnabled===true,
        reportedMaximumAttempts:o.maximumCallbackAttempts??null,reportedRetryIntervalSeconds:o.retryCallbackInterval??null};
    }
  };
}
export function runtimeGate(env){
  let p;try{p=JSON.parse(env.CALLBACK_EXECUTION_CONFIG||'{}');}catch{p={};}
  if(!p||typeof p!=='object'||Array.isArray(p))p={};
  const blockers=[];
  if(p.enabled!==true)blockers.push('native-execution-not-enabled');
  if(!['pilot','live'].includes(p.phase))blockers.push('pilot-phase-not-configured');
  if(!ID.test(p.queueId||''))blockers.push('approved-queue-not-configured');
  if(!ID.test(p.callbackEntryPointId||'')||!callbackNumber(p.callbackAni)||p.callbackDefaultsVerified!==true)
    blockers.push('callback-entrypoint-and-caller-id-not-verified');
  if(p.attemptPolicyVerified!==true||p.attemptSemantics!=='total-customer-dial-attempts'||!Number.isInteger(p.validatedTotalAttempts)||p.validatedTotalAttempts<1||p.validatedTotalAttempts>10||!Number.isInteger(p.validatedNativeMaximumAttempts)||p.validatedNativeMaximumAttempts<0||!/^[\da-f]{64}$/i.test(p.reviewedFlowSha256||''))blockers.push('callback-attempt-policy-not-verified');
  if(p.attemptPolicyMode==='per-record-policy'&&p.flowPolicyLookupVerified!==true)blockers.push('callback-attempt-policy-not-verified');
  if(p.agentMessageVerified!==true)blockers.push('agent-message-display-not-verified');
  if(p.phase==='pilot'&&(!Array.isArray(p.testNumbers)||p.testNumbers.length!==1||!callbackNumber(p.testNumbers[0])))
    blockers.push('one-approved-test-number-required');
  if(p.phase==='live'&&p.singleCallbackPilotPassed!==true)blockers.push('single-callback-pilot-not-passed');
  return {ready:blockers.length===0,blockers,phase:p.phase||'not-configured',queueId:p.queueId||null,callbackEntryPointId:p.callbackEntryPointId||null,
    maxBatch:p.phase==='pilot'?1:1000,testNumbers:(Array.isArray(p.testNumbers)?p.testNumbers:[]).map(callbackNumber).filter(Boolean),
    attemptPolicyMode:p.attemptPolicyMode==='per-record-policy'?'per-record-policy':'fixed-reviewed',validatedTotalAttempts:p.validatedTotalAttempts??null,validatedNativeMaximumAttempts:p.validatedNativeMaximumAttempts??null,reviewedFlowSha256:p.reviewedFlowSha256||null};
}
export function clientFromEnvironment(env){
  return createNativeClient({orgId:env.WEBEX_ORG_ID,getToken:async()=>{
    if(!env.WEBEX_AUTH_KV?.get)throw new NativeCallbackError('native-auth-binding-not-configured');
    const s=await env.WEBEX_AUTH_KV.get('webex-oauth-state','json');
    if(!s?.accessToken||!Number.isFinite(Number(s.accessExpiresAt))||Number(s.accessExpiresAt)<=Date.now()+60000)throw new NativeCallbackError('native-auth-awaiting-normal-renewal');
    return s.accessToken;
  }});
}
export function publicRecord(record,now=Date.now()){
  const {payload,...rest}=record;
  // A vanished schedule or elapsed time never proves queued, called, or completed.
  let status=record.management ? record.management.status==='unconfirmed' ? 'change-unconfirmed' : 'change-pending' : record.status==='scheduled'&&record.window.startEpoch<=now?'due-outcome-unconfirmed':record.status;
  if(!record.management&&record.status==='scheduled'&&['schedule-changed-externally','not-in-future-inventory'].includes(record.nativeObservation?.status))status='schedule-unconfirmed';
  if(['dialing','connected','awaiting-agent','callback-active','retry-pending'].includes(status)&&(!Number.isFinite(record.outcomeObservation?.checkedAt)||now-record.outcomeObservation.checkedAt>120000))status='activity-stale';
  return {...rest,status,number:payload.callbackNumber};
}
