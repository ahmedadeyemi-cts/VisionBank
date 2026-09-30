import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,mutation} from './fixtures.mjs';
import {defaults} from '../../callback-settings/policy.mjs';
const EP='33333333-3333-4333-8333-333333333333';
const setup=()=>fixture({nativeClient:{entryPoints:async()=>[{id:EP,name:'Pilot callback',callbackEnabled:true}]}});
const oldKeys=Object.keys(defaults()).filter(k=>k!=='callbackEntryPointId');
test('already-open v2 browser receives only settings keys its validator recognizes',async()=>{
 const f=setup(),r=await f.request();assert.equal(r.http,200);assert.equal(r.data.settingsSchemaVersion,2);
 assert.deepEqual(Object.keys(r.data.state.settings).sort(),oldKeys.sort());assert.equal(r.data.processing.ready,false);
});
test('v3 browser explicitly negotiates editable entry-point settings',async()=>{
 const f=setup(),r=await f.request('settings?schema=3');assert.equal(r.http,200);assert.equal(r.data.settingsSchemaVersion,3);assert.equal(r.data.state.settings.callbackEntryPointId,'');
});
test('v2 response does not erase a saved entry point and v2 edits preserve it',async()=>{
 const f=setup();await f.request('settings?schema=3',mutation({callbackEntryPointId:EP}));
 const legacy=await f.request();assert.equal(Object.hasOwn(legacy.data.state.settings,'callbackEntryPointId'),false);
 const change={mutationId:crypto.randomUUID(),expectedVersion:1,settings:{...legacy.data.state.settings,maxAttempts:2}};
 const saved=await f.request('settings',change);assert.equal(saved.http,200);assert.equal(Object.hasOwn(saved.data.state.settings,'callbackEntryPointId'),false);
 const current=await f.request('settings?schema=3');assert.equal(current.data.state.settings.callbackEntryPointId,EP);assert.equal(current.data.state.settings.maxAttempts,2);
});
test('compatibility does not permit unknown mutation fields or enable native dialing',async()=>{
 const f=setup(),r=await f.request('settings?schema=3',mutation({fakePermission:true}));assert.equal(r.http,400);assert.equal(r.data.error,'unknown-setting');
 assert.equal((await f.request('settings?schema=3')).data.processing.ready,false);
});
