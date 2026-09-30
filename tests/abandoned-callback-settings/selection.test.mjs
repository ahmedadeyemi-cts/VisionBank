import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {buildPreview, callbackNumber, localEpoch, nextWindow, parseSelection, validateWindow} from '../../callback-settings/selection.mjs';
import {defaults} from '../../callback-settings/policy.mjs';
import {fixture, mutation, QUEUE} from './fixtures.mjs';
const now = Date.parse('2026-09-30T18:00:00Z');
const cid = n => '10000000-0000-4000-8000-' + String(n).padStart(12, '0');
const row = (n, more={}) => ({contactId:cid(n),ani:'+1515555'+String(n).padStart(4,'0'),startEpoch:now-60000-n,endEpoch:now-1000,...more});
const state = {version:1,settings:{...defaults(),enabled:true,queueId:QUEUE}};
const report = rows => ({success:true,generatedAtEpoch:now,abandonedCalls:rows});
const body = (ids, more={}) => ({scope:'selected',contactIds:ids,expectedVersion:1,date:'2026-09-30',startTime:'14:00',...more});
const run = (rows, b=body(rows.map(r=>r.contactId)), s=state) => buildPreview(b,s,report(rows),[{id:QUEUE,name:'CEG Voice'}],now);
test('one selected call stays one, even when the report contains many calls',()=>{const p=run([row(1),row(2)],body([cid(2)]));assert.equal(p.selected,1);assert.equal(p.rows[0].contactId,cid(2));assert.equal(p.candidates,1);});
test('bulk includes the frozen IDs across all report pages',()=>{const rows=Array.from({length:65},(_,i)=>row(i+1)),p=run(rows,body(rows.map(r=>r.contactId),{scope:'all-matching'}));assert.equal(p.candidates,65);assert.equal(p.canSchedule,false);});
test('new arrivals after selection are not silently added',()=>{assert.equal(run([row(1),row(2)],body([cid(1)],{scope:'all-matching'})).selected,1);});
test('repeated numbers within a batch yield one candidate',()=>{const p=run([row(1),row(2,{ani:row(1).ani})]);assert.equal(p.candidates,1);assert.equal(p.rows[1].reason,'same-number-already-in-batch');});
test('invalid and withheld numbers are skipped rather than dialed',()=>{const p=run([row(1,{ani:'Anonymous'}),row(2,{ani:'3223'}),row(3)]);assert.equal(p.candidates,1);assert.equal(p.skipped,2);});
test('known schedules and recorded attempts are skipped',()=>{const p=run([row(1,{callbackScheduleId:'schedule-1'}),row(2,{callbackAttempts:1})]);assert.equal(p.candidates,0);});
test('unknown IDs do not accept a browser supplied phone number',()=>{const p=run([row(1)],body([cid(2)]));assert.equal(p.rows[0].number,null);assert.equal(p.rows[0].disposition,'skipped');assert.throws(()=>parseSelection({...body([cid(1)]),number:'+15155550001'}));});
test('active, handled and unended records are excluded',()=>{const p=run([row(1,{isActive:true}),row(2,{isContactHandled:true}),row(3,{endEpoch:null})]);assert.equal(p.candidates,0);});
test('previous-day records cannot be bulk included',()=>assert.equal(run([row(1,{startEpoch:now-86400000})]).candidates,0));
test('stale or malformed report cannot produce a successful plan',()=>{for(const r of [{}, {...report([]),generatedAtEpoch:now-200000}])assert.throws(()=>buildPreview(body([cid(1)]),state,r,[{id:QUEUE}],now));});
test('duplicate IDs and oversized selections are rejected',()=>{assert.throws(()=>parseSelection(body([cid(1),cid(1)])));assert.throws(()=>parseSelection(body(Array.from({length:1001},(_,i)=>cid(i)))));});
test('master-off settings still allow an explicitly non-executing preview',()=>{const p=run([row(1)],undefined,{...state,settings:{...state.settings,enabled:false}});assert.equal(p.settingsEnabled,false);assert.equal(p.canSchedule,false);assert.equal(p.previewOnly,true);});
test('DST gaps and ambiguous local times are rejected',()=>{assert.throws(()=>localEpoch('2026-03-08','02:30'));assert.throws(()=>localEpoch('2026-11-01','01:30'));});
test('callback windows observe configured days, delay and end of shift',()=>{assert.throws(()=>validateWindow('2026-09-30','13:05',state.settings,now));assert.throws(()=>validateWindow('2026-09-30','16:50',state.settings,now));assert.equal(nextWindow(state.settings,Date.parse('2026-10-02T23:00:00Z')).date,'2026-10-05');});
test('excluded dates are honored without overwriting the persisted switch',()=>{const s={...state.settings,excludedDates:['2026-09-30']};assert.equal(nextWindow(s,now).date,'2026-10-01');assert.equal(s.enabled,true);});
test('preview gateway reads authoritative reporting and never changes settings or audit',async()=>{
  const f=fixture({report:()=>{const t=Date.now();return {success:true,generatedAtEpoch:t,abandonedCalls:[row(1,{startEpoch:t-60000,endEpoch:t-1000})]};}});
  await f.request('settings',mutation({enabled:true,queueId:QUEUE}));
  const win=nextWindow(state.settings), b=body([cid(1)],{date:win.date,startTime:win.startTime});
  const before=JSON.stringify([...f.stores.values()].map(s=>[...s.data]));
  const result=await f.request('preview',b);assert.equal(result.http,200);assert.equal(result.data.candidates,1);assert.equal(result.data.canSchedule,false);
  assert.equal(JSON.stringify([...f.stores.values()].map(s=>[...s.data])),before);
});
test('native scheduling is rejected even when the master switch is enabled',async()=>{
  const f=fixture();await f.request('settings',mutation({enabled:true,queueId:QUEUE}));
  const result=await f.request('schedule',body([cid(1)]));assert.equal(result.http,409);assert.equal(result.data.error,'callback-execution-not-connected');
});
test('preview retains original network and origin authorization',async()=>{
  const f=fixture({allowed:false});assert.equal((await f.request('preview',body([cid(1)]))).http,403);
  const normal=fixture();assert.equal((await normal.request('preview',body([cid(1)]),{Origin:'https://untrusted.example'})).http,403);
});
test('preview rejects a stale settings version before reading the report',async()=>{
  let reads=0;const f=fixture({report:()=>{reads++;return report([]);}});
  const result=await f.request('preview',body([cid(1)]));assert.equal(result.http,409);assert.equal(reads,0);
});
test('international numbers remain strings; short codes and masked numbers are rejected',()=>{
  assert.equal(callbackNumber('+442079460000'),'+442079460000');
  for(const v of ['911','*553223','Anonymous','+10000000000','***1234'])assert.equal(callbackNumber(v),null);
});
test('selection presentation does not include a scheduler, login prompt or customer-dial API',()=>{
  const text=fs.readFileSync(new URL('../../webex-abandoned-selection.js',import.meta.url),'utf8');
  assert.doesNotMatch(text,/localStorage|sessionStorage|createScheduleCallback|setInterval/);
  assert.match(text,/id\('Execute'\)\.disabled = true/);
});
