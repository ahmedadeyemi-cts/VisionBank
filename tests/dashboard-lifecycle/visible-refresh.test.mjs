import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const source=fs.readFileSync('webex.js','utf8');
test('visible refresh shares requests, pauses while hidden, and backs off failures',async()=>{
 let now=100000,calls=0,status=200;
 const context=vm.createContext({
  window:{VB_SECURITY:{allowed:true}},document:{hidden:false,getElementById:()=>null},
  Date:class extends Date{static now(){return now;}},console,AbortController,setTimeout,clearTimeout,
  WEBEX_DASHBOARD_API:'https://example.test/dashboard',
  fetch:async()=>{calls++;return {status,ok:status===200,headers:{get:()=>null},text:async()=>JSON.stringify(status===200?{success:true,generatedAtEpoch:now,queues:[],agents:[],statistics:{}}:{success:false})};}
 });
 vm.runInContext(source.slice(source.indexOf('let webexDashboardCache ='),source.indexOf('// SECURITY GATE')),context);
 vm.runInContext('async function loadQueueStatus(){try{await fetchWebexDashboard();}catch{}};const loadAgentStatus=loadQueueStatus,loadGlobalStats=loadQueueStatus;',context);
 vm.runInContext(source.slice(source.indexOf('let webexRefreshPromise ='),source.indexOf('// INIT',source.indexOf('let webexRefreshPromise ='))),context);
 await Promise.all([vm.runInContext('refreshAll()',context),vm.runInContext('refreshAll()',context)]);
 assert.equal(calls,1);
 now+=5000;context.document.hidden=true;await vm.runInContext('refreshAll()',context);assert.equal(calls,1);
 context.document.hidden=false;await vm.runInContext('refreshAll()',context);assert.equal(calls,2);
 now+=5000;status=503;await vm.runInContext('refreshAll()',context);assert.equal(calls,3);
 now+=1000;await vm.runInContext('refreshAll()',context);assert.equal(calls,3);
 now+=4000;await vm.runInContext('refreshAll()',context);assert.equal(calls,4);
 now+=5000;await vm.runInContext('refreshAll()',context);assert.equal(calls,4);
 now+=5000;status=200;await vm.runInContext('refreshAll()',context);assert.equal(calls,5);
 context.window.VB_SECURITY.allowed=false;now+=5000;await vm.runInContext('refreshAll()',context);assert.equal(calls,5);
});
