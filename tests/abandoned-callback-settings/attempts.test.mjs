import test from 'node:test';
import assert from 'node:assert/strict';
import {defaults,normalizeSettings} from '../../callback-settings/policy.mjs';
import {runtimeGate} from '../../callback-settings/native.mjs';
import {CallbackExecution} from '../../callback-settings/execution.mjs';
import {fixture,mutation,QUEUE,MemoryStorage} from './fixtures.mjs';
import {approval} from './native-fixtures.mjs';
const state=(more={})=>({version:1,settings:{...defaults(),enabled:true,queueId:QUEUE,callbackEntryPointId:approval().callbackEntryPointId,...more}});
const nativeConfig=(more={})=>({callbackEntryPointId:approval().callbackEntryPointId,entryPointActive:true,entryPointOutbound:true,entryPointCallbackEnabled:true,queueActive:true,voiceQueue:true,webCallbackEnabled:true,reportedMaximumAttempts:3,...more});
const engine=(policy=approval(),config=nativeConfig())=>new CallbackExecution({storage:new MemoryStorage()},
  {CALLBACK_EXECUTION_CONFIG:JSON.stringify(policy)},{client:{configuration:async()=>config}});
test('new settings default to three total attempts',()=>assert.equal(defaults().maxAttempts,3));
for(const n of [1,2,3,5,10])test('requested total attempt limit accepts '+n,()=>assert.equal(normalizeSettings({...defaults(),maxAttempts:n}).maxAttempts,n));
for(const n of [0,-1,11,1.5,'3',null,NaN,Infinity])test('invalid attempt limit is rejected '+String(n),()=>assert.throws(()=>normalizeSettings({...defaults(),maxAttempts:n}),/invalid-max-attempts/));
test('explicit saved one-attempt choice is preserved rather than silently upgraded',()=>assert.equal(normalizeSettings({...defaults(),maxAttempts:1}).maxAttempts,1));
test('attempt customization persists and audits old/new value without a new login',async()=>{
  const f=fixture();await f.request('settings',mutation({enabled:true,queueId:QUEUE}));
  assert.equal((await f.request('settings',mutation({enabled:true,queueId:QUEUE,maxAttempts:5},1))).http,200);
  const r=await f.request();assert.equal(r.data.state.settings.maxAttempts,5);assert.equal(r.data.state.settings.enabled,true);
  const h=await f.request('history');assert.equal(h.data.rows[0].previous.maxAttempts,3);assert.equal(h.data.rows[0].next.maxAttempts,5);
});
test('verified three-attempt policy can pass readiness',async()=>assert.equal((await engine().readiness(state())).ready,true));
test('desired count is not falsely enforced merely because it can be saved',async()=>assert.ok((await engine().readiness(state({maxAttempts:2}))).blockers.includes('requested-attempt-limit-not-verified')));
test('changed native setting pauses creation without changing saved enabled value',async()=>{const s=state(),r=await engine(approval(),nativeConfig({reportedMaximumAttempts:4})).readiness(s);assert.ok(r.blockers.includes('webex-attempt-policy-changed'));assert.equal(s.settings.enabled,true);});
test('attempt count needs reviewed total-versus-retry semantics',()=>{for(const p of [{attemptSemantics:'retries-only'},{attemptPolicyVerified:false},{validatedTotalAttempts:null},{validatedNativeMaximumAttempts:null}])assert.equal(runtimeGate({CALLBACK_EXECUTION_CONFIG:JSON.stringify(approval(p))}).ready,false);});
test('a verified custom limit is supported without inventing a native API field',async()=>assert.equal((await engine(approval({validatedTotalAttempts:2})).readiness(state({maxAttempts:2}))).ready,true));
test('manual single-call pilot remains independent from retry count',async()=>{const r=await engine().readiness(state());assert.equal(r.maxBatch,1);assert.equal(r.requestedMaxAttempts,3);assert.equal(r.verifiedTotalAttempts,3);});
