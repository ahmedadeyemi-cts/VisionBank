import test from 'node:test';import assert from 'node:assert/strict';
import {createNativeClient,nativePayload,clientFromEnvironment} from '../../callback-settings/native.mjs';
import {nativeFixture} from './native-fixtures.mjs';
const orgId='33333333-3333-4333-8333-333333333333';
const fixture=async(status=201,edit=x=>x)=>{const f=await nativeFixture(),b=f.batch(),payload=nativePayload(b.preview.rows[0],b.preview.window,b.preview.queue.id),calls=[];
 const client=createNativeClient({orgId,getToken:async()=>'synthetic-token-not-a-credential',fetchImpl:async(url,options)=>{calls.push({url,method:options.method,body:options.body});return Response.json(edit({...payload,id:crypto.randomUUID(),orgId}),{status});}});
 return {payload,client,calls};};
test('native create uses documented queue reason and original interaction; no invented retry property',async()=>{const f=await fixture();await f.client.create(f.payload);assert.equal(f.calls.length,1);assert.equal(f.calls[0].method,'POST');assert.ok(f.calls[0].url.endsWith('/v1/callbacks/organization/'+orgId+'/scheduled-callback'));const body=JSON.parse(f.calls[0].body);assert.equal(body.callbackReason,'Callback for missed call from customer');assert.equal(body.sourceInteraction,f.payload.sourceInteraction);assert.ok(!('maxAttempts' in body));assert.ok(!('assigneeAgent' in body));});
for(const status of [400,401,403,429])test('native rejection '+status+' is never blindly retried',async()=>{const f=await fixture(status);await assert.rejects(()=>f.client.create(f.payload),e=>e.status===status&&!e.uncertain);assert.equal(f.calls.length,1);});
for(const status of [500,503])test('native ambiguous failure '+status+' requires reconciliation',async()=>{const f=await fixture(status);await assert.rejects(()=>f.client.create(f.payload),e=>e.uncertain===true);assert.equal(f.calls.length,1);});
test('a 201 with a mismatched organization is not accepted as scheduled',async()=>{const f=await fixture(201,x=>({...x,orgId:'44444444-4444-4444-8444-444444444444'}));await assert.rejects(()=>f.client.create(f.payload),e=>e.uncertain===true);});
test('missing token expiry cannot be treated as a healthy native credential',async()=>{const c=clientFromEnvironment({WEBEX_ORG_ID:orgId,WEBEX_AUTH_KV:{get:async()=>({accessToken:'synthetic-token'})}});await assert.rejects(()=>c.list('+12025550123'),/native-auth-awaiting-normal-renewal/);});
test('missing native schedule yields null, not a completed call outcome',async()=>{const f=await fixture(404);assert.equal(await f.client.get('55555555-5555-4555-8555-555555555555'),null);});

for(const method of ['GET','POST'])test('native '+method+' rejects redirects without forwarding credentials or repeating creation',async()=>{
 const f=await nativeFixture(),b=f.batch(),payload=nativePayload(b.preview.rows[0],b.preview.window,b.preview.queue.id);let calls=0;
 const c=createNativeClient({orgId,getToken:async()=>'synthetic-token',fetchImpl:async(url,options)=>{
  calls++;assert.equal(options.redirect,'manual');new Request(url,options);
  return new Response(null,{status:302,headers:{Location:'https://other.example.invalid/'}});
 }});
 await assert.rejects(()=>method==='POST'?c.create(payload):c.entryPoints(),e=>e.code==='native-redirect-rejected'&&e.uncertain===(method==='POST'));
 assert.equal(calls,1);
});
