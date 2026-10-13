import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import vm from 'node:vm';
import {aggregateSessions,loadDaily,fields} from '../worker-patches/daily-agent-performance.mjs';
const day=Date.UTC(2026,9,13,5),now=day+12*3600000;
const channel=(n,type='telephony')=>({channelId:type,channelType:type,...Object.fromEntries(fields.map(f=>[f,0])),connectedCount:n,connectedDuration:n*60000,ringingCount:n+1,notRespondedCount:1});
const session=(id,n,active=false)=>({agentId:'a',agentSessionId:id,agentName:'A',startTime:day+1000,endTime:active?null:day+3600000,isActive:active,channelInfo:[channel(n),channel(n,'chat')]});
test('Closed and new login sessions combine by permanent ID without double counting',()=>{const old=session('old',12),current=session('new',1,true);const [a]=aggregateSessions([old,current,old],day,now);assert.equal(a.voice.inbound,13);assert.equal(a.voice.missed,2);assert.equal(a.chat.offered,15);assert.equal(a.voice.avgHandleMs,60000);});
test('Logout retains daily row; new login adds rather than replaces',()=>{assert.equal(aggregateSessions([session('one',12)],day,now)[0].voice.inbound,12);assert.equal(aggregateSessions([session('one',12),session('two',0,true)],day,now)[0].voice.inbound,12);});
test('Yesterday closed sessions are excluded, midnight lifetime counters are unavailable',()=>{const old={...session('yesterday',99),startTime:day-3600000,endTime:day-1000};assert.equal(aggregateSessions([old],day,now).length,0);old.isActive=true;old.endTime=null;assert.equal(aggregateSessions([old,session('today',2)],day,now)[0].voice.inbound,null);});
test('Missing counters are not fabricated zeros; weighted handle average',()=>{const x=session('x',2),y=session('y',1);x.channelInfo[0].connectedDuration=2000;y.channelInfo[0].connectedDuration=4000;delete x.channelInfo[0].transferCount;const [a]=aggregateSessions([x,y],day,now);assert.equal(a.voice.avgHandleMs,2000);assert.equal(a.voice.transferred,null);});
test('All pages required; failures cannot return partial totals',async()=>{let n=0;const result=await loadDaily(async()=>({agentSession:{agentSessions:[session(String(++n),1)],pageInfo:{hasNextPage:n<2,endCursor:'next'}}}),day,now);assert.equal(result.rows[0].voice.inbound,2);await assert.rejects(loadDaily(async()=>({agentSession:{agentSessions:[],pageInfo:{hasNextPage:true,endCursor:'same'}}}),day,now));});
test('Browser defaults Today, keeps history rows, supports session, rejects stale and prior-day data',async()=>{
 let clock=now,change,tick;const listeners={};const select={addEventListener:(name,fn)=>{change=fn;}};
 const document={hidden:false,getElementById:id=>id==='agent-performance-period'?select:null,addEventListener:(name,fn)=>{listeners[name]=fn;}};
 const window={VB_SECURITY:{allowed:true},dispatchEvent:()=>{}};
 const report={success:true,schemaVersion:1,timezone:'America/Chicago',dayStart:day,observedAt:now,rows:aggregateSessions([session('old',12)],day,now)};
 const context=vm.createContext({window,document,Intl,Event:class{},AbortController,setTimeout,clearTimeout,setInterval:fn=>{tick=fn;},Date:class extends Date{static now(){return clock;}},fetch:async()=>({ok:true,status:200,json:async()=>report})});
 vm.runInContext(fs.readFileSync(new URL('../webex-agent-performance.js',import.meta.url),'utf8'),context);listeners.DOMContentLoaded();await new Promise(r=>setTimeout(r,10));
 const api=window.VB_AGENT_PERFORMANCE;assert.equal(api.mode(),'today');assert.equal(api.voice([])[0].inbound,12);assert.equal(api.voice([{agentId:'a',inbound:0,status:'Available'}])[0].status,'Available');
 change({target:{value:'session'}});assert.equal(api.voice([{agentId:'a',inbound:0}])[0].inbound,0);
 assert.equal(api.mode('chat'),'today');
 const chat=()=>({rows:[{agentId:'a',offeredSession:2,missedSession:0,ronaSession:0}]});
 assert.equal(api.chat(chat()).rows[0].performanceOffered,13);
 api.setChatMode('session');assert.equal(api.chat(chat()).rows[0].performanceOffered,2);
 change({target:{value:'today'}});assert.equal(api.mode('chat'),'session');assert.equal(api.voice([{agentId:'a',inbound:0}])[0].inbound,12);
 api.setChatMode('today');assert.equal(api.chat(chat()).rows[0].performanceOffered,13);

 change({target:{value:'today'}});clock+=150001;assert.equal(api.voice([{agentId:'a',inbound:0}])[0].inbound,null);clock=day+86400000;assert.equal(api.ready(),false);
 });

test('Backend integration preserves existing source and rejects duplicate integration',async()=>{
 const {integrate}=await import('../scripts/integrate-daily-agent-performance.mjs');
 const source='/* retained */\nif (path === "/api/webex/dashboard" && method === "GET") { return old(); }';
 const result=integrate(source);assert(result.includes(source.slice(source.indexOf('if ('))));assert(result.includes('await checkAccess(request,env)'));assert(result.includes("'Cache-Control':'no-store'"));assert.throws(()=>integrate(result));
 const auth=fs.readFileSync(new URL('../portal-auth-fetch.js',import.meta.url),'utf8');assert(auth.includes('path === "/api/webex/agent-performance"'));
});

test('Logged-in filter retains idle/busy agents, preserves history, synchronizes and remembers preference',()=>{
 const listeners={},stored=new Map(),buttons=[{},{}];
 const document={addEventListener:(name,fn)=>{listeners[name]=fn;},querySelectorAll:()=>buttons.map(b=>({setAttribute:(k,v)=>{b[k]=v;}}))};
 const window={VB_SECURITY:{allowed:true},dispatchEvent:()=>{}};
 const localStorage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)};
 const create=()=>{const c=vm.createContext({window,document,localStorage,Intl,Date:class extends Date{static now(){return now;}},Event:class{}});vm.runInContext(fs.readFileSync(new URL('../webex-agent-performance.js',import.meta.url),'utf8'),c);return window.VB_AGENT_PERFORMANCE;};
 let api=create();assert.equal(api.hideLoggedOut(),true);
 const roster={success:true,generatedAtEpoch:now,agents:[{agentId:'lunch',status:'Lunch'},{agentId:'busy',status:'Engaged'},{agentId:'wrap',status:'Wrap-up'}]};
 const items=[{agentId:'lunch',inbound:12},{agentId:'busy'},{agentId:'wrap'},{agentId:'history',inbound:7},{agentId:'chat',liveRecord:true}];
 api.setHideLoggedOut(true);
 assert.deepEqual(Array.from(api.filterRows(items,roster),a=>a.agentId),['lunch','busy','wrap','chat']);
 assert.equal(api.filterRows(items,roster)[0].inbound,12);assert.equal(items.length,5);
 assert.equal(buttons[0]['aria-pressed'],'true');assert.equal(buttons[1]['aria-pressed'],'true');
 assert.equal(api.filterRows(items,{...roster,generatedAtEpoch:now-45001}).length,5);
 assert.match(api.filterMessage(null),/paused/);
 api=create();assert.equal(api.hideLoggedOut(),true);
 api.setHideLoggedOut(false);assert.equal(api.filterRows(items,roster).length,5);assert.equal(stored.get('vbHideLoggedOutAgents'),'false');
 api=create();assert.equal(api.hideLoggedOut(),false);
 api.setHideLoggedOut(true);assert.equal(api.filterRows(items,{...roster,agents:[]}).length,1);
});
