import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveVerifiedWriteDevice} from '../../device-management/device-resolution.mjs';
const device={id:'webex-1',callingDeviceId:'call-1',mac:'44DBD2CDF310',locationId:'loc-1',orgId:'org-1'};
const args={env:{},phone:{mac:'44:DB:D2:CD:F3:10',webexDeviceIds:['stale-id']},deviceId:'call-1',locationId:'loc-1',org:'org-1'};
test('uses enrolled device ID despite missing or stale inventory metadata',async()=>{
 for(const phone of [{mac:args.phone.mac},args.phone]){
  const calls=[];const found=await resolveVerifiedWriteDevice({...args,phone,webexFetch:async(_,url)=>{calls.push(url);return Response.json(device);}});
  assert.equal(found.matchedId,'call-1');assert.equal(calls.length,1);assert.match(calls[0],/\/devices\/call-1$/);
 }
});
test('falls back to inventory alias when enrolled Calling ID is not accepted by lookup',async()=>{
 let calls=0;const found=await resolveVerifiedWriteDevice({...args,webexFetch:async()=>++calls===1?new Response(null,{status:404}):Response.json(device)});
 assert.equal(found.matchedId,'stale-id');assert.equal(calls,2);
});
for(const [field,value,code] of [['mac','AABBCCDDEEFF','device-mac-mismatch'],['locationId','other','device-location-mismatch'],['callingDeviceId','other','device-identity-mismatch'],['orgId','other','device-organization-mismatch'],['mac',null,'device-mac-mismatch'],['locationId',null,'device-location-mismatch']]){
 test('rejects unverified '+field+' '+value,async()=>{
  await assert.rejects(resolveVerifiedWriteDevice({...args,webexFetch:async()=>Response.json({...device,[field]:value})}),{code});
 });
}
test('retries a transient GET once and succeeds',async()=>{
 let calls=0;await resolveVerifiedWriteDevice({...args,webexFetch:async()=>++calls===1?new Response(null,{status:503}):Response.json(device)});assert.equal(calls,2);
});
for(const [status,code] of [[401,'webex-device-authentication-failed'],[403,'webex-device-authentication-failed'],[429,'webex-device-rate-limited'],[503,'webex-device-lookup-unavailable'],[404,'webex-device-not-found']]){
 test('preserves upstream failure '+status,async()=>{
  await assert.rejects(resolveVerifiedWriteDevice({...args,phone:{mac:args.phone.mac},webexFetch:async()=>new Response(null,{status})}),{code});
 });
}
test('bounds both network and response body waits',async()=>{
 for(const webexFetch of [async()=>new Promise(()=>{}),async()=>({ok:true,status:200,json:()=>new Promise(()=>{})})]){
  await assert.rejects(resolveVerifiedWriteDevice({...args,phone:{mac:args.phone.mac},timeoutMs:5,webexFetch}),{code:'webex-device-lookup-timeout'});
 }
});
test('preserves a transient failure when a later alias returns 404',async()=>{
 let calls=0;await assert.rejects(resolveVerifiedWriteDevice({...args,webexFetch:async()=>new Response(null,{status:++calls<=2?503:404})}),{code:'webex-device-lookup-unavailable'});
});

test('compares UUID and encoded Webex organization IDs without relaxing tenant checks',async()=>{
 const uuid='6f124f56-d8db-4adf-a591-912c02363806';
 const encoded=btoa('ciscospark://us/ORGANIZATION/'+uuid).replace(/=+$/,'');
 await resolveVerifiedWriteDevice({...args,org:uuid,webexFetch:async()=>Response.json({...device,orgId:encoded})});
 await assert.rejects(resolveVerifiedWriteDevice({...args,org:'00000000-d8db-4adf-a591-912c02363806',webexFetch:async()=>Response.json({...device,orgId:encoded})}),{code:'device-organization-mismatch'});
});
