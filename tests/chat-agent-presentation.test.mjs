import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../webex-integrated-chat.js', import.meta.url), 'utf8');
const start = source.indexOf('  function buildChatAgentPresentation(');
const end = source.indexOf('  function renderAgentActivity(', start);
assert(start >= 0 && end > start);
const context = vm.createContext({});
vm.runInContext(source.slice(start, end) + '\nthis.present=buildChatAgentPresentation;', context);
const now = 1800000000000;
const ready = value => ({status:'ready', value});
const live = (rows=[]) => ({liveStatus:'ready',liveObservedAt:now,liveRows:rows,
  summary:{active:ready(rows.filter(r=>r.status==='Active').length),wrapup:ready(rows.filter(r=>r.status==='Wrap-up').length)}});
const dash = (routing=null) => ({success:true,generatedAtEpoch:now,agents:[{agentId:'a',name:'Agent A',status:'available',chatChannel:{routingState:routing}}]});
const history = () => ({dailyStatus:'ready',dailyObservedAt:now,rows:Array.from({length:10},()=>({agentId:'a',agent:'Agent A',handled:true,isActive:false}))});
const present = (b,l,d) => JSON.parse(JSON.stringify(context.present(b,l,d,now)));
const task = (status='Active',agentId='a') => ({status,agentId,agent:'Agent A'});
test('Missing Chat state is Not reported, never the Voice available fallback',()=>{
 const a=present(dash(),live(),null).rows[0];assert.equal(a.routingState,'Not reported');assert.equal(a.routingTone,'unknown');
});
test('A reported Chat Available state is retained',()=>{
 const a=present(dash('available'),live(),null).rows[0];assert.equal(a.routingState,'Available');assert.equal(a.routingTone,'available');assert.equal(a.activity,'No active chat reported');
});
test('Accepted Chat is Engaged without overwriting actual routing availability',()=>{
 const a=present(dash('available'),live([task()]),null).rows[0];assert.equal(a.activity,'Engaged — Chat');assert.equal(a.active,1);assert.equal(a.routingState,'Available');
});
test('Wrap-up is not an active conversation',()=>{
 const a=present(dash(),live([task('Wrap-up')]),null).rows[0];assert.equal(a.activity,'Wrap-up — Chat');assert.equal(a.active,0);assert.equal(a.wrapup,1);
});
test('History-only agent remains visible but has no fabricated current status or workload',()=>{
 const a=present({...dash(),agents:[]},live(),history()).rows[0];assert.equal(a.dataSource,'History only');assert.equal(a.activity,'History only');assert.equal(a.routingState,'Not reported');assert.equal(a.active,null);assert.equal(a.lastHandlerContactsToday,10);
});
test('Missing active roster does not imply signed out when a current Chat task exists',()=>{
 const a=present({...dash(),agents:[]},live([task()]),history()).rows[0];assert.equal(a.dataSource,'Live Chat record');assert.equal(a.activity,'Engaged — Chat');assert.equal(a.routingState,'Not reported');
});
test('Stale session state does not display its former Available value',()=>{
 const a=present({...dash('available'),generatedAtEpoch:now-45001},live(),history()).rows[0];assert.equal(a.routingState,'Stale data');assert.equal(a.routingTone,'unknown');
});
test('Stale live data cannot assert zero work',()=>{
 const a=present(dash(),{...live(),liveObservedAt:now-45001},history()).rows[0];assert.equal(a.active,null);assert.equal(a.activity,'Not reported');
});
test('Missing task ownership invalidates per-agent workload',()=>{
 const a=present(dash(),live([task('Active','')]),null).rows[0];assert.equal(a.active,null);assert.equal(a.activity,'Not reported');
});
test('Summary and task disagreement is not hidden by zero counts',()=>{
 const l=live();l.summary.active=ready(1);const a=present(dash(),l,null).rows[0];assert.equal(a.active,null);
});
test('Concurrent tasks are counted independently',()=>{
 const a=present(dash(),live([task(),task(),task('Wrap-up')]),null).rows[0];assert.equal(a.active,2);assert.equal(a.wrapup,1);assert.equal(a.activity,'Engaged — Chat');
});
test('Explicit provider Unavailable and custom idle reasons are preserved',()=>{
 assert.equal(present(dash('unavailable'),live(),null).rows[0].routingState,'Unavailable');
 assert.equal(present(dash('Lunch'),live(),null).rows[0].routingState,'Lunch');
});
test('More than five seconds of future skew does not mark data fresh',()=>{
 const b={...dash('available'),generatedAtEpoch:now+6000};assert.equal(present(b,live(),null).sessionFresh,false);
});
test('Old or unavailable daily results cannot be substituted as fresh history',()=>{
 const d={...history(),dailyObservedAt:now-150001};assert.equal(present(null,live(),d).rows.length,0);
});
test('Whitespace/null IDs are not made into phantom agents',()=>{
 const b={...dash(),agents:[{agentId:null},{agentId:'  '}]};assert.equal(present(b,live(),null).rows.length,0);
});
test('HTML version pins and labels load the corrected scripts once',()=>{
 const html=fs.readFileSync(new URL('../webex.html',import.meta.url),'utf8');
 assert.equal((html.match(/src="webex-integrated-chat.js\?v=20260924-3"/g)||[]).length,1);
 assert(html.includes('webex.js?v=20260924-agent3'));
 const voice=fs.readFileSync(new URL('../webex.js',import.meta.url),'utf8');
 assert(voice.includes('tr.dataset.vbAgentId = String(a.agentId || "")'));
 assert(!voice.includes('No Webex agents are currently logged in.'));
});
