import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=(await fs.readFile(new URL('./worker.mjs',import.meta.url),'utf8'))
  .replace("import {DurableObject} from 'cloudflare:workers';",
    'class DurableObject { constructor(ctx,env) { this.ctx=ctx; this.env=env; } }');
const {PhonismUSProbe,default:worker}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function object(jurisdiction='us', count=0){
  const values=new Map([['probe-count',count]]);
  return new PhonismUSProbe({id:{jurisdiction},storage:{get:async k=>values.get(k),put:async(k,v)=>values.set(k,v)}},{});
}
test('uses hard US jurisdiction rather than a placement hint',async()=>{
  let selected;
  const ns={idFromName:()=> 'id', get:()=>({fetch:async()=>Response.json({ok:true})})};
  const result=await worker.fetch(new Request('https://internal/probe',{method:'POST'}),
    {US_PROBE:{jurisdiction:value=>{selected=value;return ns;}}});
  assert.equal(selected,'us');assert.equal(result.status,200);
});
test('rejects other routes and methods before accessing a namespace',async()=>{
  for(const request of [new Request('https://internal/probe'),new Request('https://internal/other',{method:'POST'})]){
    assert.equal((await worker.fetch(request,{})).status,404);
  }
});
test('fails closed if actual jurisdiction cannot be confirmed',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('must not fetch');});
  const response=await object('eu').fetch(new Request('https://internal/probe',{method:'POST'}));
  assert.equal(response.status,503);
});
test('caps requests without scheduled background work',async t=>{
  t.mock.method(globalThis,'fetch',()=>{throw Error('must not fetch');});
  const response=await object('us',6).fetch(new Request('https://internal/probe',{method:'POST'}));
  assert.equal(response.status,429);
});
test('only reads fixed phone, never leaks credentials or upstream data',async t=>{
  const calls=[],key='test-only-secret-api-key';
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options});
    return url.endsWith('/trace')?new Response('loc=US\ncolo=LAX\nip=192.0.2.1\n'):
      Response.json({errors:[],data:[{password:'SIP_SECRET_SHOULD_NOT_LEAK'}]});
  });
  const response=await object().fetch(new Request('https://internal/probe',{method:'POST',headers:{'x-api-key':key}}));
  const body=await response.text(),data=JSON.parse(body);
  assert.equal(data.passed,true);assert.equal(data.jurisdiction,'us');assert.equal(data.observedCountry,'US');
  assert.equal(calls[1].url,'https://app.phonism.com/api/v3/phones/313135/lines');
  assert.equal(calls[1].options.method,'GET');assert.equal(calls[1].options.redirect,'manual');
  assert.equal(calls[0].options.headers,undefined);
  assert.ok(!body.includes(key));assert.ok(!body.includes('SIP_SECRET'));assert.ok(!body.includes('192.0.2.1'));
});
test('unauthenticated or blocked response cannot pass',async t=>{
  t.mock.method(globalThis,'fetch',async url=>url.endsWith('/trace')?new Response('loc=US\ncolo=LAX\n'):
    new Response('Forbidden',{status:403,headers:{'content-type':'text/html','cf-ray':'example-AMS'}}));
  const result=await (await object().fetch(new Request('https://internal/probe',{method:'POST'}))).json();
  assert.equal(result.passed,false);assert.equal(result.httpStatus,403);assert.equal(result.ray,'example-AMS');
});
