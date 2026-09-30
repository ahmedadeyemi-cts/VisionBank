import {defaults} from '../../callback-settings/policy.mjs';
import {CallbackExecution} from '../../callback-settings/execution.mjs';
import {NativeCallbackError} from '../../callback-settings/native.mjs';
import {validateWindow} from '../../callback-settings/selection.mjs';
import {MemoryStorage,QUEUE,ACTOR} from './fixtures.mjs';
export const approval=(more={})=>({enabled:true,phase:'pilot',queueId:QUEUE,
  callbackEntryPointId:'22222222-2222-4222-8222-222222222222',callbackAni:'+12025550123',callbackDefaultsVerified:true,
  attemptPolicyVerified:true,attemptSemantics:'total-customer-dial-attempts',validatedTotalAttempts:3,
  validatedNativeMaximumAttempts:3,reviewedFlowSha256:'a'.repeat(64),agentMessageVerified:true,
  testNumbers:['+12025550123'],...more});
export const cid=n=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0');
export async function nativeFixture({settings={},policy={}}={}){
 const clock={now:Date.parse('2026-09-30T18:00:00Z')},storage=new MemoryStorage(),records=[];
 const state={version:1,settings:{...defaults(),enabled:true,queueId:QUEUE,...settings}};await storage.put('state',state);
 const client={posts:0,mode:'success',records,
  configuration:async()=>({queueActive:true,voiceQueue:true,webCallbackEnabled:true,reportedMaximumAttempts:3}),
  list:async()=>structuredClone(records),matches:(r,p)=>r.sourceInteraction===p.sourceInteraction&&r.queueId===p.queueId&&r.callbackNumber===p.callbackNumber&&r.startTime===p.startTime,
  create:async payload=>{client.posts++;const r={...payload,id:crypto.randomUUID()};
   if(client.mode==='reject')throw new NativeCallbackError('native-http-400',{status:400});
   if(client.mode!=='unknown')records.push(r);
   if(client.mode==='accepted-timeout'||client.mode==='unknown')throw new NativeCallbackError('native-transport-unconfirmed',{uncertain:true});
   return r;}};
 const env={CALLBACK_EXECUTION_CONFIG:JSON.stringify(approval(policy))};
 const make=()=>new CallbackExecution({storage},env,{client,now:()=>clock.now});
 const batch=(rows=[{contactId:cid(1),number:'+12025550123',disposition:'candidate'}])=>({mutationId:crypto.randomUUID(),expectedVersion:1,
  preview:{scope:'selected',queue:{id:QUEUE},rows,window:validateWindow('2026-09-30','14:00',state.settings,clock.now)},actor:ACTOR,requestId:crypto.randomUUID()});
 return {storage,clock,client,env,state,make,engine:make(),batch};
}
