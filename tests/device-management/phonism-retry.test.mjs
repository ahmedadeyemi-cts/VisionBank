import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhonismReader} from '../../device-management/phonism.mjs';
const env={PHONISM_API_KEY:'test-key-not-a-real-secret'};
test('sync retries temporary HTTP failures without changing scope or payload',async t=>{
 const calls=[];
 t.mock.method(globalThis,'fetch',async(url,options)=>{
   calls.push({url,body:options.body,method:options.method});
   return new Response(JSON.stringify({errors:[]}),{status:calls.length<3?503:202,headers:{'Retry-After':'0'}});
 });
 assert.equal((await createPhonismReader().syncHierarchyIntegration(env,'123',{tenantId:'456'})).accepted,true);
 assert.equal(calls.length,3);assert.deepEqual(calls[0],calls[2]);
 assert.equal(JSON.parse(calls[0].body).tenant_id,456);
});
test('sync failures retain safe status/category and stop after three attempts',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('secret provider details',{status:429,headers:{'Retry-After':'0'}});});
 await assert.rejects(createPhonismReader().syncHierarchyIntegration(env,'123'),e=>e.upstreamStatus===429&&e.providerAttempts===3&&e.providerFailure==='rate-limited'&&!JSON.stringify(e).includes('secret provider'));
 assert.equal(calls,3);
});
for(const [status,body,category,headers] of [
 [403,{errors:['secret key']},'authentication',{}],
 [400,{errors:['bad request']},'request-rejected',{}],
 [200,{errors:['integration rejected']},'provider-rejected',{}],
 [202,{},'invalid-response',{}],
 [503,{errors:[]},'provider-unavailable',{'Retry-After':'60'}]
])test('no blind retry for '+status+' '+category,async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response(JSON.stringify(body),{status,headers});});
 await assert.rejects(createPhonismReader().syncHierarchyIntegration(env,'123'),e=>e.upstreamStatus===status&&e.providerFailure===category);
 assert.equal(calls,1);
});
test('unknown transport outcome is not repeated',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('network');});
 await assert.rejects(createPhonismReader().syncHierarchyIntegration(env,'123'),e=>e.providerFailure==='transport');
 assert.equal(calls,1);
});
test('reboot does not inherit integration retry policy',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('no',{status:503});});
 await assert.rejects(createPhonismReader().tr069Action(env,'123','Reboot'));
 assert.equal(calls,1);
});
