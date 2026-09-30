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
  async function request(path,method='GET',body){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
    try{const token=await Promise.race([getToken(),new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(new NativeCallbackError('native-token-deadline')),{once:true}))]);
      if(typeof token!=='string'||!token)throw new NativeCallbackError('native-token-unavailable');
      const response=await fetchImpl(ORIGIN+path,{method,redirect:'error',signal:controller.signal,
      headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
      if(!response.ok)throw new NativeCallbackError('native-http-'+response.status,{status:response.status,
        uncertain:method==='POST'&&![400,401,403,404,422,429].includes(response.status)});
      let data;try{data=await response.json();}catch{throw new NativeCallbackError('native-invalid-json',{uncertain:method==='POST'});}
      return {data,status:response.status};
    }catch(e){if(e instanceof NativeCallbackError)throw e;throw new NativeCallbackError('native-transport-unconfirmed',{uncertain:method==='POST'});}finally{clearTimeout(timer);}
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
    for(const variant of [...new Set([number,number.replace(/^\+/,'' )])]){
      let totalPages=1;
      for(let page=0;page<totalPages;page++){
        const q=new URLSearchParams({callbackNumber:variant,page:String(page),pageSize:'100'});
        const {data}=await request(base+'?'+q);
        if(!Array.isArray(data?.data)||!Number.isSafeInteger(data.meta?.totalPages)||data.meta.totalPages<0||
          data.meta.totalPages>20||data.meta.page!==page)throw new NativeCallbackError('native-inventory-incomplete');
        totalPages=data.meta.totalPages;
        for(const item of data.data){validateRecord(item);if(callbackNumber(item.callbackNumber)!==callbackNumber(number))throw new NativeCallbackError('native-inventory-filter-mismatch');records.set(item.id,item);}
      }
    }
    return [...records.values()];
  }
  function matches(record,payload){return record.sourceInteraction===payload.sourceInteraction&&record.queueId===payload.queueId&&
    callbackNumber(record.callbackNumber)===payload.callbackNumber&&record.scheduleDate===payload.scheduleDate&&
    record.startTime===payload.startTime&&record.endTime===payload.endTime&&record.timezone===payload.timezone&&
    record.callbackReason===payload.callbackReason&&!record.assigneeAgent;}
  return {list,matches,
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
    async configuration(queueId){
      if(!ID.test(queueId))throw new SettingsError('voice-queue-required');
      const [{data:org},{data:queue}]=await Promise.all([request('/organization/'+orgId+'/organization-setting'),
        request('/organization/'+orgId+'/v2/contact-service-queue/'+queueId)]);
      const o=Array.isArray(org)?org[0]:org,q=queue.data||queue;
      if(!o||!q||q.id!==queueId)throw new NativeCallbackError('native-configuration-incomplete');
      return {queueId:q.id,queueName:q.name,queueActive:q.active===true||q.isActive===true,
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
  if(p.agentMessageVerified!==true)blockers.push('agent-message-display-not-verified');
  if(p.phase==='pilot'&&(!Array.isArray(p.testNumbers)||p.testNumbers.length!==1||!callbackNumber(p.testNumbers[0])))
    blockers.push('one-approved-test-number-required');
  if(p.phase==='live'&&p.singleCallbackPilotPassed!==true)blockers.push('single-callback-pilot-not-passed');
  return {ready:blockers.length===0,blockers,phase:p.phase||'not-configured',queueId:p.queueId||null,
    maxBatch:p.phase==='pilot'?1:1000,testNumbers:(Array.isArray(p.testNumbers)?p.testNumbers:[]).map(callbackNumber).filter(Boolean),
    validatedTotalAttempts:p.validatedTotalAttempts??null,validatedNativeMaximumAttempts:p.validatedNativeMaximumAttempts??null,reviewedFlowSha256:p.reviewedFlowSha256||null};
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
  const status=record.status==='scheduled'&&record.window.startEpoch<=now?'due-outcome-unconfirmed':record.status;
  return {...rest,status,number:payload.callbackNumber};
}
