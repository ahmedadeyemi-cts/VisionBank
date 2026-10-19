import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const src=fs.readFileSync(new URL('../webex-daily-report-worker-patch.js',import.meta.url),'utf8');
const c=vm.createContext({Date,formatWebexEpochCentral:x=>String(x),formatWebexDurationMs:x=>String(x)});
vm.runInContext(src.slice(src.indexOf('function webexReportNumber('),src.indexOf('async function fetchWebexDailyReportTasks(')),c);
const now=1792446051312,start=now-30000;
const task=()=>({id:'test-call',channelType:'telephony',direction:'inbound',createdTime:start,endedTime:now,isActive:false,status:'ended',isContactHandled:false,connectedCount:0,connectedDuration:0,contactHandleType:'abandoned',abandonedType:'agent-connect',queueDuration:10000});
const car=events=>[{id:'test-call',activities:{nodes:events}}];
const payload=(t,events,legs=[])=>c.buildWebexDailyReportPayload([t],legs,car(events),now,start-1000);
for(const event of ['connect','con-to-agent-error','ctq-accepted','agent-connect','agent-connected-error','disconnected']){
 test(event+' alone never proves an agent answered',()=>{
  assert.equal(c.webexReportIsConnectedActivity({eventName:event,previousState:'connect',nextState:'connect'}),false);
 });
}
test('RONA followed by hangup stays abandoned instead of answered',()=>{
 const events=[
  {eventName:'connect',previousState:null,nextState:'con-to-agent-error',duration:14551,createdTime:start},
  {eventName:'con-to-agent-error',previousState:'connect',nextState:'connect',duration:369,createdTime:start+14551},
  {eventName:'connect',previousState:'con-to-agent-error',nextState:'ended',duration:1856,createdTime:start+14920},
  {eventName:'ended',previousState:'connect',nextState:null,duration:0,createdTime:now}
 ];
 const p=payload(task(),events);
 assert.equal(p.answeredCalls.length,0);assert.equal(p.abandonedCalls.length,1);
 assert.equal(p.abandonedCalls[0].contactId,'test-call');
});
test('RONA then queue abandonment remains abandoned once',()=>{
 const t={...task(),abandonedType:'queue'};
 const p=payload(t,[{eventName:'connect'},{eventName:'con-to-agent-error',previousState:'connect',nextState:'parked'}],
 [{taskId:t.id,abandonedType:'queue',isTaskLegHandled:false,connectedCount:0}]);
 assert.equal(p.abandonedCalls.length,1);assert.equal(p.answeredCalls.length,0);
});
test('RONA followed by another agent answering is answered',()=>{
 const t={...task(),contactHandleType:'normal',abandonedType:null};
 const p=payload(t,[{eventName:'connect'},{eventName:'con-to-agent-error'},{eventName:'connected',createdTime:start+16000,duration:14000,agentName:'Test Agent'}]);
 assert.equal(p.answeredCalls.length,1);assert.equal(p.abandonedCalls.length,0);
});
test('offer with no terminal abandonment evidence is not invented as abandoned or answered',()=>{
 const p=payload({...task(),isActive:true,endedTime:null,abandonedType:null,contactHandleType:null},[{eventName:'connect'}]);
 assert.equal(p.answeredCalls.length,0);assert.equal(p.abandonedCalls.length,0);
});
test('actual handled metrics and AAR synthetic connected events remain answer evidence',()=>{
 assert.equal(c.webexReportHasAnswerSignal({...task(),isContactHandled:true},[],[]),true);
 assert.equal(c.webexReportHasAnswerSignal(task(),[{connectedCount:1}],[]),true);
 assert.equal(c.webexReportHasAnswerSignal(task(),[],[{eventName:'connected',source:'AAR'}]),true);
});
test('neighboring connected states do not count offer duration as talk duration',()=>{
 const events=[{eventName:'connect',nextState:'connected',createdTime:start,duration:15000},
 {eventName:'connected',previousState:'connect',createdTime:start+15000,duration:15000},
 {eventName:'ended',previousState:'connected',createdTime:now,duration:0}];
 assert.equal(c.webexReportConnectedActivityDurationMs(events),15000);
 assert.equal(c.webexReportIsConnectedActivity(events[0]),false);
});
