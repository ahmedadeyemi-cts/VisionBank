import test from 'node:test';import assert from 'node:assert/strict';
import {nativeFixture,cid} from './native-fixtures.mjs';
const record=async f=>(await f.storage.get('callback:'+cid(1)));
test('three customer attempts still creates exactly one native schedule',async()=>{
 const f=await nativeFixture(),b=f.batch(),r=await f.engine.enqueue(b);
 assert.equal(r.job.records[0].status,'submission-pending');assert.equal(f.client.posts,0);
 await f.engine.run();await f.engine.run();const saved=await record(f);
 assert.equal(saved.status,'scheduled');assert.equal(saved.policy.totalAttempts,3);assert.equal(saved.attemptsMade,null);
 assert.equal(saved.postAttempts,1);assert.equal(f.client.posts,1);
});
test('concurrent submissions of same batch reserve one job and one schedule',async()=>{
 const f=await nativeFixture(),b=f.batch();await Promise.all([f.engine.enqueue(b),f.engine.enqueue(b)]);
 await f.engine.run();assert.equal(f.client.posts,1);assert.equal((await f.engine.job(b.mutationId)).contactIds.length,1);
});
test('another mutation cannot duplicate the same original abandoned contact',async()=>{const f=await nativeFixture();await f.engine.enqueue(f.batch());await f.engine.run();const r=await f.engine.enqueue(f.batch());assert.equal(r.job.contactIds.length,0);assert.equal(r.job.skipped[0].reason,'original-contact-already-reserved');assert.equal(f.client.posts,1);});
test('accepted create with lost response is reconciled, not retried',async()=>{const f=await nativeFixture();f.client.mode='accepted-timeout';await f.engine.enqueue(f.batch());await f.engine.run();assert.equal((await record(f)).status,'creation-unconfirmed');await f.make().run();assert.equal((await record(f)).status,'scheduled');assert.equal(f.client.posts,1);});
test('unconfirmed creation never becomes permission for another create',async()=>{const f=await nativeFixture();f.client.mode='unknown';await f.engine.enqueue(f.batch());for(let i=0;i<5;i++)await f.make().run();assert.equal((await record(f)).status,'creation-unconfirmed');assert.equal(f.client.posts,1);});
test('pending jobs survive coordinator restart and no open browser is needed',async()=>{const f=await nativeFixture();await f.engine.enqueue(f.batch());assert.ok(await f.storage.getAlarm());await f.make().run();assert.equal((await record(f)).status,'scheduled');});
test('master disable before dispatch prevents schedule creation',async()=>{const f=await nativeFixture();await f.engine.enqueue(f.batch());await f.storage.put('state',{...f.state,version:2,settings:{...f.state.settings,enabled:false}});await f.engine.run();assert.equal(f.client.posts,0);assert.equal((await record(f)).reason,'master-switch-disabled');});
test('changed attempt setting does not silently alter an accepted pending job',async()=>{const f=await nativeFixture();await f.engine.enqueue(f.batch());await f.storage.put('state',{...f.state,version:2,settings:{...f.state.settings,maxAttempts:5}});await f.engine.run();assert.equal(f.client.posts,0);assert.equal((await record(f)).policy.totalAttempts,3);assert.equal((await record(f)).reason,'settings-changed');});
test('expired native lookup eligibility does not erase durable deduplication',async()=>{const f=await nativeFixture();const b=f.batch();await f.engine.enqueue(b);await f.engine.run();f.clock.now=b.preview.window.startEpoch+1000;f.client.records.length=0;const job=await f.engine.job(b.mutationId);assert.equal(job.records[0].status,'due-outcome-unconfirmed');assert.equal(job.records[0].attemptsMade,null);assert.equal(f.client.posts,1);});
test('pilot refuses bulk and an unapproved customer number server-side',async()=>{const f=await nativeFixture();await assert.rejects(()=>f.engine.enqueue(f.batch([{contactId:cid(1),number:'+12025550123',disposition:'candidate'},{contactId:cid(2),number:'+12025550124',disposition:'candidate'}])),/single-callback-pilot/);await assert.rejects(()=>f.engine.enqueue(f.batch([{contactId:cid(1),number:'+12025550124',disposition:'candidate'}])),/number-not-approved/);assert.equal(f.client.posts,0);});
test('unknown or different retry policy blocks writes',async()=>{const f=await nativeFixture({settings:{maxAttempts:2}});await assert.rejects(()=>f.engine.enqueue(f.batch()),/requested-attempt-limit/);assert.equal(f.client.posts,0);});
test('native rejection is displayed as not scheduled, with no retry loop',async()=>{const f=await nativeFixture();f.client.mode='reject';await f.engine.enqueue(f.batch());await f.engine.run();await f.engine.run();assert.equal((await record(f)).status,'rejected');assert.equal(f.client.posts,1);});
