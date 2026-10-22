import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {PhonismUS, allowedRoute} from '../../phonism-us/worker.mjs';
import {defaultPhonismFetch, createPhonismReader} from '../../device-management/phonism.mjs';
const key = 'test-key-not-a-real-credential';
const env = {PHONISM_API_KEY:key,PHONISM_TRANSPORT:'cloudflare-us'};
const request = (path, method='GET', body) => new Request('https://phonism.internal'+path,
  {method,headers:{'x-api-key':key},...(body ? {body:JSON.stringify(body)} : {})});
const object = jurisdiction => new PhonismUS({id:{jurisdiction}}, {});
const upstream = () => Response.json({errors:[],data:[]},{headers:{'cf-ray':'test-DEN','server':'cloudflare'}});
function binding(fetcher){
  return {jurisdiction(value){assert.equal(value,'us');return {
    idFromName(name){assert.equal(name,'visionbank');return 'id';},
    get(id){assert.equal(id,'id');return {fetch:fetcher};}
  };}};
}
test('only internal allowed routes and methods are accepted',()=>{
  for(const path of ['/hierarchy/?limit=100','/hierarchy/1?children=false','/hierarchy/1/tenants/?limit=100',
    '/hierarchy/1/integrations','/hierarchy/1/phones','/tenants/1/phones','/phones/1','/phones/1/lines?start_after_id=2'])
    assert.equal(allowedRoute('GET',path),true,path);
  for(const path of ['//evil.com','/phones/1/../2','/phones/%31','/phones/1?url=https://evil.com','/phones/1#x'])
    assert.equal(allowedRoute('GET',path),false,path);
  assert.equal(allowedRoute('DELETE','/phones/1'),false);
  assert.equal(allowedRoute('PUT','/phones/1/lines'),false);
  assert.equal(worker.fetch().status,404);
});
test('wrong jurisdiction cannot reach upstream',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return upstream();});
  assert.equal((await object('eu').fetch(request('/phones/1'))).status,503);
  assert.equal(calls,0);
});
test('US object fixes upstream host, preserves diagnostics, never follows redirects',async t=>{
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.equal(url,'https://app.phonism.com/api/v3/phones/1/lines');
    assert.equal(options.headers['x-api-key'],key);
    assert.equal(options.headers['Cache-Control'],'no-cache');
    assert.equal(options.redirect,'manual');return upstream();
  });
  const result=await object('us').fetch(request('/phones/1/lines'));
  assert.equal(result.status,200);assert.equal(result.headers.get('cf-ray'),'test-DEN');
  assert.ok(result.headers.get('x-phonism-us-request-id'));
  assert.equal(result.headers.get('cache-control'),'no-store');
});
test('factory reset and unrelated sync fields are blocked before dispatch',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return upstream();});
  const obj=object('us');
  for(const [path,body] of [['/phones/1/tr069',{queue:['FactoryReset']}],
    ['/hierarchy/1/integrations/sync',{asset_type:['Device'],unexpected:true}],
    ['/hierarchy/1/integrations/sync',{asset_type:['Unknown']}]])
    assert.equal((await obj.fetch(request(path,'PUT',body))).status,400);
  assert.equal(calls,0);
});
test('sync and reboot use the same US transport',async t=>{
  const sent=[];t.mock.method(globalThis,'fetch',async(url,options)=>{sent.push({url,body:JSON.parse(new TextDecoder().decode(options.body))});return upstream();});
  const obj=object('us'), e={...env,PHONISM_US:binding(r=>obj.fetch(r))},reader=createPhonismReader();
  await reader.syncHierarchyIntegration(e,'1',{tenantId:'2',targetCompanyId:'3',singleAttempt:true});
  await reader.tr069Action(e,'1','Reboot');
  assert.equal(sent.length,2);
  assert.deepEqual(sent[0].body,{asset_type:['People','Workspace','Device'],company_id:3,tenant_id:2});
  assert.deepEqual(sent[1].body,{queue:['Reboot']});
});
test('US mode fails closed without binding and never calls global fetch',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return upstream();});
  await assert.rejects(defaultPhonismFetch(env,'/phones/1'));
  await assert.rejects(defaultPhonismFetch({...env,PHONISM_TRANSPORT:'typo'},'/phones/1'));
  assert.equal(calls,0);
});
test('transport failures and missing provenance never retry a potentially accepted sync',async()=>{
  for(const response of [()=>Response.json({error:'outcome-unknown'},{status:502,headers:{'x-phonism-us-error':'outcome-unknown'}}),
    ()=>new Response('platform error',{status:502}),()=>{throw new Error('lost response');}]){
    let calls=0;
    await assert.rejects(createPhonismReader().syncHierarchyIntegration({...env,PHONISM_US:binding(async()=>{calls++;return response();})},'1'));
    assert.equal(calls,1);
  }
});
test('upstream exception is returned as unknown outcome without exposing error details',async t=>{
  t.mock.method(globalThis,'fetch',async()=>{throw Error(key);});
  const result=await object('us').fetch(request('/phones/1/tr069','PUT',{queue:['Reboot']}));
  assert.equal(result.status,502);assert.equal(result.headers.get('x-phonism-us-error'),'outcome-unknown');
  assert.equal((await result.text()).includes(key),false);
});
test('oversized provider body cannot masquerade as an explicit retryable upstream rejection',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response(new Uint8Array(4194305),{status:503}));
  const result=await object('us').fetch(request('/phones/1'));
  assert.equal(result.headers.get('x-phonism-us-error'),'outcome-unknown');
  assert.equal(result.headers.has('x-phonism-us-request-id'),false);
});
