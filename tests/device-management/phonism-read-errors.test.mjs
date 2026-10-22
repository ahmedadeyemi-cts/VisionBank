import test from 'node:test';
import assert from 'node:assert/strict';
import {createPhonismReader} from '../../device-management/phonism.mjs';
for(const [status,body,failure] of [
 [401,{errors:[]},'authentication'],[403,{errors:[]},'authentication'],
 [404,{errors:['not found']},'not-found'],[429,{errors:[]},'rate-limited'],
 [503,{errors:[]},'provider-unavailable'],[200,{data:[]},'invalid-response'],
 [200,{errors:['provider message containing secret'],data:null},'provider-rejected']
])test('read diagnostics safely classify '+status+' '+failure,async()=>{
 const reader=createPhonismReader({fetcher:async()=>Response.json(body,{status})});
 await assert.rejects(()=>reader.lines({},'123'),error=>{
  assert.equal(error.upstreamStatus,status);assert.equal(error.providerFailure,failure);
  assert.ok(!JSON.stringify(error).includes('secret'));return true;
 });
});
test('malformed response cannot confirm an empty line',async()=>{
 const reader=createPhonismReader({fetcher:async()=>new Response('<html>secret</html>')});
 await assert.rejects(()=>reader.lines({},'123'),error=>error.providerFailure==='invalid-response');
});
test('403 diagnostics distinguish an HTML security response without retaining its body',async()=>{
 const reader=createPhonismReader({fetcher:async()=>new Response('<html>Cloudflare request blocked secret</html>',{status:403,headers:{'content-type':'text/html; charset=utf-8'}})});
 await assert.rejects(()=>reader.lines({},'123'),error=>{
  assert.equal(error.providerFailure,'upstream-access-denied');assert.equal(error.providerResponseType,'text/html');assert.equal(error.providerDenial,'security-filter');
  assert.ok(!JSON.stringify(error).includes('secret'));return true;
 });
});
