import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeFixture,approval,cid} from './native-fixtures.mjs';
import {ACTOR,QUEUE,fixture} from './fixtures.mjs';
import {createNativeClient,NativeCallbackError,nativePayload} from '../../callback-settings/native.mjs';
import {correlateOutcome} from '../../callback-settings/outcomes.mjs';
import {createCallbackMaintenance} from '../../callback-settings/maintenance.mjs';
import {numberKey} from '../../callback-settings/reservations.mjs';
const op=(r,action='cancel',more={})=>({change:{action,contactId:r.contactId,expectedRevision:r.revision,mutationId:crypto.randomUUID(),...more},actor:ACTOR,requestId:crypto.randomUUID()});
async function setup(options={}){
 const f=await nativeFixture(options);f.client.puts=0;f.client.deletes=0;f.client.gets=0;
 f.client.get=async id=>{f.client.gets++;return structuredClone(f.client.records.find(r=>r.id===id)||null);};
 f.client.matches=(a,b)=>['sourceInteraction','queueId','callbackNumber','scheduleDate','startTime','endTime','timezone','callbackReason'].every(k=>a[k]===b[k]);
 f.client.update=async(id,payload)=>{f.client.puts++;const i=f.client.records.findIndex(r=>r.id===id);assert.ok(i>=0);f.client.records[i]={...payload,id};if(f.client.updateTimeout)throw new NativeCallbackError('native-transport-unconfirmed',{uncertain:true});return f.client.records[i];};
 f.client.cancel=async id=>{f.client.deletes++;const i=f.client.records.findIndex(r=>r.id===id);if(i>=0)f.client.records.splice(i,1);if(f.client.cancelTimeout)throw new NativeCallbackError('native-transport-unconfirmed',{uncertain:true});return {id,canceled:true};};
 f.client.history=async()=>[];
 await f.engine.enqueue(f.batch());await f.engine.run();f.record=()=>f.storage.get('callback:'+cid(1));return f;
}
test('native update uses PUT of the same ID; DELETE accepts an empty 204',async()=>{
 const f=await nativeFixture(),org='33333333-3333-4333-8333-333333333333',id=crypto.randomUUID(),payload=nativePayload(f.batch().preview.rows[0],f.batch().preview.window,QUEUE),requests=[];
 const c=createNativeClient({orgId:org,getToken:async()=>'test-token',fetchImpl:async(url,opts)=>{requests.push([url,opts.method,opts.body]);return opts.method==='DELETE'?new Response(null,{status:204}):Response.json({...payload,id,orgId:org},{status:200});}});
 await c.update(id,payload);await c.cancel(id);assert.deepEqual(requests.map(r=>r[1]),['PUT','DELETE']);assert.ok(requests.every(r=>r[0].endsWith('/'+id)));assert.equal(JSON.parse(requests[0][2]).id,id);
});
test('management is durable, idempotent and never posts a new native schedule',async()=>{
 const f=await setup(),r=await f.record(),x=op(r);await f.engine.management.enqueue(x);await f.engine.management.enqueue(x);assert.equal(f.client.deletes,0);
 f.clock.now+=200;await f.engine.management.run();await f.make().management.run();assert.equal(f.client.deletes,1);assert.equal(f.client.posts,1);assert.equal((await f.record()).status,'canceled');assert.equal(await f.storage.get(await numberKey(r.payload.callbackNumber)),undefined);
});
test('future callback can be canceled while master switch is off',async()=>{
 const f=await setup(),r=await f.record();await f.storage.put('state',{...f.state,settings:{...f.state.settings,enabled:false}});
 await f.engine.management.enqueue(op(r));f.clock.now+=200;await f.engine.management.run();assert.equal((await f.record()).status,'canceled');
});
test('reschedule preserves ID, original call and requested attempt policy',async()=>{
 const f=await setup(),r=await f.record();await f.engine.management.enqueue(op(r,'reschedule',{expectedVersion:1,date:'2026-09-30',startTime:'15:00'}));f.clock.now+=200;await f.engine.management.run();
 const next=await f.record();assert.equal(next.window.startTime,'15:00');assert.equal(next.scheduleId,r.scheduleId);assert.equal(next.policy.totalAttempts,3);assert.equal(f.client.puts,1);assert.equal(f.client.posts,1);
});
test('concurrent conflicting changes cannot write twice',async()=>{
 const f=await setup(),r=await f.record();const results=await Promise.allSettled([f.engine.management.enqueue(op(r)),f.engine.management.enqueue(op(r))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);f.clock.now+=200;await f.engine.management.run();assert.equal(f.client.deletes,1);
});
test('reused management ID with changed intent is rejected',async()=>{
 const f=await setup(),x=op(await f.record());await f.engine.management.enqueue(x);await assert.rejects(f.engine.management.enqueue({...x,change:{...x.change,expectedRevision:99}}),e=>e.code==='mutation-id-reused');
});
test('already due callback cannot be canceled or rescheduled',async()=>{
 const f=await setup(),r=await f.record();f.clock.now=r.window.startEpoch;await assert.rejects(f.engine.management.enqueue(op(r)),e=>e.code==='callback-window-too-close-to-change');assert.equal(f.client.deletes,0);
});
test('disable after accepting a time change stops its native PUT',async()=>{
 const f=await setup(),r=await f.record(),x=op(r,'reschedule',{expectedVersion:1,date:'2026-09-30',startTime:'15:00'});await f.engine.management.enqueue(x);
 await f.storage.put('state',{...f.state,version:2,settings:{...f.state.settings,enabled:false}});f.clock.now+=200;await f.engine.management.run();assert.equal(f.client.puts,0);assert.equal((await f.engine.management.get(x.change.mutationId)).status,'not-applied');
});
test('lost update response reconciles by GET, not another PUT or POST',async()=>{
 const f=await setup(),r=await f.record(),x=op(r,'reschedule',{expectedVersion:1,date:'2026-09-30',startTime:'15:00'});f.client.updateTimeout=true;
 await f.engine.management.enqueue(x);f.clock.now+=200;await f.engine.management.run();assert.equal((await f.record()).management.status,'unconfirmed');
 f.clock.now+=46000;await f.make().management.run();assert.equal((await f.record()).window.startTime,'15:00');assert.equal(f.client.puts,1);assert.equal(f.client.posts,1);
});
test('lost cancellation response is confirmed only by absence before start and no active callback',async()=>{
 const f=await setup(),x=op(await f.record());f.client.cancelTimeout=true;await f.engine.management.enqueue(x);f.clock.now+=200;await f.engine.management.run();f.clock.now+=46000;await f.make().management.run();assert.equal((await f.record()).status,'canceled');assert.equal(f.client.deletes,1);
});
test('ambiguous cancellation after start never releases number based on disappearance',async()=>{
 const f=await setup(),r=await f.record(),x=op(r);f.client.cancelTimeout=true;await f.engine.management.enqueue(x);f.clock.now+=200;await f.engine.management.run();f.clock.now=r.window.startEpoch+1000;
 await f.make().management.run();assert.equal((await f.record()).management.status,'unconfirmed');assert.ok((await f.storage.get(await numberKey(r.payload.callbackNumber))).includes(r.contactId));
});
test('externally changed native schedule is not overwritten',async()=>{
 const f=await setup(),x=op(await f.record());f.client.records[0].queueId=crypto.randomUUID();await f.engine.management.enqueue(x);f.clock.now+=200;await f.engine.management.run();assert.equal(f.client.deletes,0);assert.equal((await f.engine.management.get(x.change.mutationId)).status,'not-applied');
});
test('management APIs retain network/origin checks and never allow caller-supplied actor',async()=>{
 const f=fixture({allowed:false});assert.equal((await f.request('manage',{})).http,403);const g=fixture();assert.equal((await g.request('manage',{actor:ACTOR})).http,400);
});
const task=(r,now,more={})=>({id:crypto.randomUUID(),createdTime:now-20000,endedTime:now-1000,lastActivityTime:now-1000,isCallback:true,isActive:false,status:'ended',globalVariables:{VB_CallbackSourceInteractionId:r.contactId,VB_CallbackAttempts:2,VB_CallbackOutcome:'COMPLETED'},callbackData:{callbackNumber:r.payload.callbackNumber,callbackConnectTime:now-15000},lastAgent:{id:crypto.randomUUID(),name:'Test Agent'},...more});
test('a phone-number/time match without source interaction ID is not correlated',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;const x=task(r,now,{globalVariables:{}});assert.equal(correlateOutcome(r,[x],now).status,'unconfirmed');
});
test('completed outcome needs a linked actual customer connection',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;assert.equal(correlateOutcome(r,[task(r,now)],now).status,'completed');assert.equal(correlateOutcome(r,[task(r,now,{callbackData:{callbackNumber:r.payload.callbackNumber}})],now).terminal,false);
});
test('active linked task cannot be marked completed',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;const result=correlateOutcome(r,[task(r,now,{isActive:true,endedTime:null})],now);assert.equal(result.status,'connected');assert.equal(result.terminal,false);
});
test('busy and no-answer indicate pending retry, not a replacement callback',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;for(const outcome of ['BUSY','NO_ANSWER']){const result=correlateOutcome(r,[task(r,now,{globalVariables:{VB_CallbackSourceInteractionId:r.contactId,VB_CallbackOutcome:outcome},callbackData:{callbackNumber:r.payload.callbackNumber,callbackRetryCount:2}})],now);assert.equal(result.status,'retry-pending');assert.equal(result.attemptsMade,null);assert.equal(result.providerRetryCount,2);}
});
test('schedule tag with mismatched number fails closed',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;assert.throws(()=>correlateOutcome(r,[task(r,now,{callbackData:{callbackNumber:'+12025550124'}})],now),e=>e.code==='callback-outcome-correlation-mismatch');
});
test('terminal outcome releases number only when future and active native inventories are also clear',async()=>{
 const f=await setup(),r=await f.record();f.clock.now=r.window.startEpoch+60000;f.client.history=async()=>[task(r,f.clock.now)];await f.engine.outcomes.observe(r.contactId);assert.equal((await f.record()).status,'outcome-unconfirmed');
 f.client.records.length=0;await f.engine.outcomes.observe(r.contactId);assert.equal((await f.record()).status,'completed');assert.equal((await f.record()).attemptsMade,2);assert.equal(await f.storage.get(await numberKey(r.payload.callbackNumber)),undefined);
});
test('outcome read failure does not report zero attempts or completed',async()=>{
 const f=await setup(),r=await f.record();f.clock.now=r.window.startEpoch+60000;f.client.history=async()=>{throw new NativeCallbackError('native-http-503');};await f.engine.outcomes.observe(r.contactId);assert.equal((await f.record()).attemptsMade,null);assert.equal((await f.record()).status,'scheduled');assert.ok(await f.storage.get(await numberKey(r.payload.callbackNumber)));
});
test('attempts exceeding the requested limit are surfaced',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000,result=correlateOutcome(r,[task(r,now,{globalVariables:{VB_CallbackSourceInteractionId:r.contactId,VB_CallbackAttempts:4}})],now);assert.equal(result.policyExceeded,true);
});
test('automatic mode is held during the single-number pilot',async()=>{
 const f=await nativeFixture({settings:{mode:'automatic-new-abandoned'}});f.state.automaticSince=f.clock.now-60000;await f.storage.put('state',f.state);assert.equal((await f.engine.automation.status()).eligible,false);await f.engine.automation.tick({});assert.equal(f.client.posts,0);
});
test('automatic mode reserves only new eligible calls; repeated scans do not create duplicate jobs',async()=>{
 const f=await nativeFixture({settings:{mode:'automatic-new-abandoned'},policy:{phase:'live',singleCallbackPilotPassed:true}});f.state.automaticSince=f.clock.now-60000;f.state.lastChangedBy=ACTOR;await f.storage.put('state',f.state);
 const rows=[{contactId:cid(1),ani:'+12025550123',startEpoch:f.clock.now-30000,endEpoch:f.clock.now-1000},{contactId:cid(2),ani:'+12025550124',startEpoch:f.clock.now-180000,endEpoch:f.clock.now-120000}];
 const report={success:true,generatedAtEpoch:f.clock.now,abandonedCalls:rows};assert.equal((await f.engine.automation.tick(report)).queued,1);assert.equal((await f.engine.automation.tick(report)).queued,0);await f.engine.run();assert.equal(f.client.posts,1);assert.equal(await f.storage.get('callback:'+cid(2)),undefined);
});
test('automatic report failure cannot be treated as no abandoned calls',async()=>{
 const f=await nativeFixture({settings:{mode:'automatic-new-abandoned'},policy:{phase:'live',singleCallbackPilotPassed:true}});f.state.automaticSince=f.clock.now-60000;f.state.lastChangedBy=ACTOR;await f.storage.put('state',f.state);await f.engine.automation.tick({success:false});assert.equal((await f.engine.automation.status()).lastError,'automatic-report-unavailable');assert.equal(f.client.posts,0);
});
test('existing scheduled hook does not read reports while automatic mode is off',async()=>{
 let reads=0,writes=0;const tick=createCallbackMaintenance({getAbandonedReport:async()=>{reads++;return {};}});await tick({WEBEX_ORG_ID:'test',ABANDONED_CALLBACK_SETTINGS:{idFromName:x=>x,get:()=>({fetch:async r=>{if(r.method==='POST')writes++;return Response.json({eligible:false});}})}});assert.equal(reads,0);assert.equal(writes,0);
});
test('indexed duplicate lookup remains read-only after more than 1000 historical records',async()=>{
 const f=await setup(),r=await f.record();for(let i=2;i<1100;i++)await f.storage.put('callback:'+cid(i),{...r,contactId:cid(i),status:'completed'});const before=f.storage.data.size;const result=await f.engine.inspect([{contactId:cid(1101),number:r.payload.callbackNumber}]);assert.equal(result[0].status,'reserved');assert.equal(f.storage.data.size,before);
});

test('optional schedule tag cannot contradict the source-interaction link',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;assert.throws(()=>correlateOutcome(r,[task(r,now,{globalVariables:{VB_CallbackSourceInteractionId:r.contactId,VB_CallbackScheduleId:crypto.randomUUID()}})],now),e=>e.code==='callback-schedule-tag-conflict');
});
test('blank attempt count is not silently converted to zero',async()=>{
 const f=await setup(),r=await f.record(),now=r.window.startEpoch+60000;assert.throws(()=>correlateOutcome(r,[task(r,now,{globalVariables:{VB_CallbackSourceInteractionId:r.contactId,VB_CallbackAttempts:''}})],now),e=>e.code==='callback-attempt-evidence-invalid');
});
test('due monitor is not hidden behind 1000 future work records',async()=>{
 const {earliestWork}=await import('../../callback-settings/work-index.mjs');const f=await nativeFixture();for(let i=0;i<1001;i++)await f.storage.put('monitor:'+String(i).padStart(6,'0'),{contactId:cid(i),due:f.clock.now+86400000});await f.storage.put('monitor:zz',{contactId:cid(1002),due:f.clock.now-1});assert.equal((await earliestWork(f.storage,'monitor:',f.clock.now)).contactId,cid(1002));
});
test('management completion retains wakeup for a concurrently pending callback create',async()=>{
 const {AbandonedCallbackSettingsV1}=await import('../../callback-settings/store.mjs'),f=await setup();const store=new AbandonedCallbackSettingsV1({storage:f.storage},f.env);store.execution=f.engine;
 await f.engine.management.enqueue(op(await f.record()));f.clock.now+=200;await f.storage.put('work:'+cid(2),{contactId:cid(2)});await f.storage.deleteAlarm();await store.alarm();assert.ok(await f.storage.getAlarm());assert.ok(await f.storage.get('work:'+cid(2)));
});

test('flow policy exposes only saved scheduling policy, not customer phone or credentials',async()=>{
 const {storedFlowPolicy}=await import('../../callback-settings/flow-policy.mjs'),f=await setup(),r=await f.record(),result=storedFlowPolicy(r,r.window.startEpoch+1);assert.equal(result.allowed,true);assert.equal(result.totalAttempts,3);assert.equal(result.sourceInteraction,r.contactId);assert.equal(result.scheduleId,r.scheduleId);assert.ok(!JSON.stringify(result).includes(r.payload.callbackNumber));
});
test('flow policy denies unknown, terminal and out-of-window callbacks',async()=>{
 const {storedFlowPolicy}=await import('../../callback-settings/flow-policy.mjs'),f=await setup(),r=await f.record();assert.equal(storedFlowPolicy(null).allowed,false);assert.equal(storedFlowPolicy({...r,status:'completed'},r.window.startEpoch+1).allowed,false);assert.equal(storedFlowPolicy(r,r.window.startEpoch-1).allowed,false);assert.equal(storedFlowPolicy(r,r.window.endEpoch).allowed,false);
});
test('flow policy requires a distinct server-side token and has no browser CORS grant',async()=>{
 const {handleFlowPolicy}=await import('../../callback-settings/flow-policy.mjs'),secret='synthetic-private-token-'.repeat(3),env={CALLBACK_FLOW_POLICY_TOKEN:secret,WEBEX_ORG_ID:'test',ABANDONED_CALLBACK_SETTINGS:{idFromName:x=>x,get:()=>({fetch:async()=>Response.json({success:true,allowed:false,totalAttempts:3})})}};
 const req=auth=>new Request('https://worker.example/api/webex/abandoned-callback/flow-policy',{method:'POST',headers:{Authorization:auth,'Content-Type':'application/json',Origin:'https://visionbank-dashboard.onrender.com'},body:JSON.stringify({sourceInteraction:cid(1)})});
 assert.equal((await handleFlowPolicy(req(''),env)).status,401);assert.equal((await handleFlowPolicy(req('Bearer wrong'),env)).status,401);const res=await handleFlowPolicy(req('Bearer '+secret),env);assert.equal(res.status,200);assert.equal(res.headers.get('Access-Control-Allow-Origin'),null);assert.equal((await handleFlowPolicy(req('Bearer '+secret),{})).status,503);
});
test('flow policy does not allow caller supplied settings or attempts',async()=>{
 const {handleFlowPolicy}=await import('../../callback-settings/flow-policy.mjs'),secret='synthetic-policy-key-'.repeat(3);const res=await handleFlowPolicy(new Request('https://worker.example/flow-policy',{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({sourceInteraction:cid(1),totalAttempts:99})}),{CALLBACK_FLOW_POLICY_TOKEN:secret});assert.equal(res.status,400);
});
test('per-record attempt mode is not ready without reviewed flow lookup',async()=>{
 const {runtimeGate}=await import('../../callback-settings/native.mjs');assert.equal(runtimeGate({CALLBACK_EXECUTION_CONFIG:JSON.stringify(approval({attemptPolicyMode:'per-record-policy'}))}).ready,false);
});
test('reviewed dynamic attempt policy supports new custom limits without extra schedules',async()=>{
 const f=await nativeFixture({settings:{maxAttempts:2},policy:{attemptPolicyMode:'per-record-policy',flowPolicyLookupVerified:true}});assert.equal((await f.engine.readiness(f.state)).ready,true);await f.engine.enqueue(f.batch());await f.engine.run();const r=await f.storage.get('callback:'+cid(1));assert.equal(r.policy.totalAttempts,2);assert.equal(f.client.posts,1);
});
