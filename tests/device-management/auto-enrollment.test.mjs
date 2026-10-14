import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcilePhoneEnrollments,automaticEnrollmentHealth,AUTO_ENROLLMENT_KEY} from '../../device-management/auto-enrollment.mjs';
import {integrateAutoEnrollment} from '../../scripts/integrate-auto-enrollment.mjs';
const ORG='6f124f56-d8db-4adf-a591-912c02363806',MAC='44:DB:D2:CD:F3:10';
function fixture(){
 const data=new Map([['device-phone-fleet-keys:v1',JSON.stringify({activeKeyId:'key',keys:[{id:'key',status:'active'}]})]]),writes=[];
 const env={WEBEX_ORG_ID:ORG,DEVICE_WRITE_SCOPE:'organization',LOGS:{get:async k=>data.get(k)||null,put:async(k,v)=>{data.set(k,v);writes.push(k);}}};
 const phones=[{id:'1',tenantId:'tenant',mac:MAC,alias:'Phone'}];
 const devices=[{id:'device',callingDeviceId:'calling',orgId:btoa('ciscospark://us/ORGANIZATION/'+ORG),mac:MAC,locationId:'loc',displayName:'Phone',product:'Yealink T54W',type:'phone',managedBy:'PARTNER'}];
 const discovery={domain:{id:'domain'},tenants:[{id:'tenant',webexLocationId:'loc',name:'Location'}],truncated:false};
 const inventory={phones,truncated:false};
 const phonismReader={discover:async()=>discovery,phones:async()=>inventory};
 const webexFetch=async(_,url,options)=>{assert.equal(options.method,'GET');assert.equal(new URL(url).searchParams.get('orgId'),btoa('ciscospark://us/ORGANIZATION/'+ORG));return Response.json({items:devices});};
 return {env,data,writes,phones,devices,discovery,inventory,phonismReader,webexFetch};
}
const key='device-phone-enrollment:'+MAC.replace(/:/g,'');
test('automatically enrolls a new phone and leaves the next run unchanged',async()=>{
 const f=fixture();const a=await reconcilePhoneEnrollments(f);assert.equal(a.created,1);assert.equal(a.status,'healthy');
 const first=f.data.get(key);const b=await reconcilePhoneEnrollments(f);assert.equal(b.created,0);assert.equal(b.existing,1);assert.equal(f.data.get(key),first);
 assert.deepEqual(f.writes.filter(k=>k!==AUTO_ENROLLMENT_KEY),[key]);
});
test('discovers a phone added after an earlier scheduled run',async()=>{
 const f=fixture();await reconcilePhoneEnrollments(f);f.phones.push({...f.phones[0],id:'2',mac:'AA:BB:CC:DD:EE:FF'});f.devices.push({...f.devices[0],id:'d2',callingDeviceId:'c2',mac:'AA:BB:CC:DD:EE:FF'});
 const r=await reconcilePhoneEnrollments(f);assert.equal(r.created,1);assert.equal(r.existing,1);assert.equal(r.enrolled,2);
});
for(const [label,mutate,code] of [
 ['missing mapping',f=>f.devices.splice(0),'webex-device-missing'],
 ['wrong location',f=>f.devices[0].locationId='other','device-location-mismatch'],
 ['wrong organization',f=>f.devices[0].orgId='other','webex-device-missing'],
 ['duplicate Webex MAC',f=>f.devices.push({...f.devices[0],id:'second'}),'duplicate-webex-mac'],
 ['duplicate Phonism MAC',f=>f.phones.push({...f.phones[0],id:'second'}),'duplicate-phonism-mac'],
 ['revoked enrollment',f=>f.data.set(key,JSON.stringify({status:'revoked',authMode:'fleet-template'})),'enrollment-revoked']
])test('does not enroll '+label,async()=>{const f=fixture();mutate(f);const r=await reconcilePhoneEnrollments(f);assert.equal(r.created,0);assert.ok(r.issues.some(i=>i.code===code));assert.equal(f.writes.filter(k=>k!==AUTO_ENROLLMENT_KEY).length,0);});
test('does not write enrollments when inventory is truncated',async()=>{const f=fixture();f.inventory.truncated=true;const r=await reconcilePhoneEnrollments(f);assert.equal(r.status,'error');assert.equal(r.error,'phonism-inventory-incomplete');assert.equal(f.data.has(key),false);});
test('reports Webex-only physical phones but excludes customer-managed integrations',async()=>{const f=fixture();f.devices.push({...f.devices[0],id:'extra',mac:'AABBCCDDEEFF',managedBy:'CISCO'},{...f.devices[0],id:'integration',mac:'000000000001',managedBy:'CUSTOMER'});const r=await reconcilePhoneEnrollments(f);assert.equal(r.enrolled,1);assert.equal(r.issueCount,1);assert.equal(r.issues[0].code,'phonism-phone-missing');});
test('updates verified fleet mapping after a replacement Webex record',async()=>{const f=fixture();await reconcilePhoneEnrollments(f);f.devices[0].callingDeviceId='replacement';const r=await reconcilePhoneEnrollments(f);assert.equal(r.updated,1);assert.equal(JSON.parse(f.data.get(key)).device.id,'replacement');});
test('retains existing individual credentials',async()=>{const f=fixture();f.data.set(key,JSON.stringify({status:'active',authMode:'basic',device:{id:'old'},passwordHash:'test'}));const r=await reconcilePhoneEnrollments(f);assert.equal(r.created,0);assert.equal(JSON.parse(f.data.get(key)).passwordHash,'test');});
test('follows complete inventory pagination but rejects off-host next links before writing',async()=>{
 const f=fixture();let calls=0;f.webexFetch=async()=>++calls===1?Response.json({items:[]},{headers:{Link:'<https://webexapis.com/v1/devices/?cursor=2>; rel="next"'}}):Response.json({items:f.devices});assert.equal((await reconcilePhoneEnrollments(f)).created,1);assert.equal(calls,2);
 const g=fixture();g.webexFetch=async()=>Response.json({items:g.devices},{headers:{Link:'<https://example.com/devices>; rel="next"'}});assert.equal((await reconcilePhoneEnrollments(g)).error,'webex-pagination-invalid');assert.equal(g.data.has(key),false);
});
test('bounded batches enroll remaining phones on the next run',async()=>{
 const f=fixture();f.phones.splice(0);f.devices.splice(0);
 for(let i=0;i<51;i++){const mac=i.toString(16).padStart(12,'0');f.phones.push({id:String(i),tenantId:'tenant',mac});f.devices.push({id:'d'+i,mac,locationId:'loc',orgId:ORG});}
 const a=await reconcilePhoneEnrollments(f);assert.equal(a.created,50);assert.equal(a.pending,1);
 const b=await reconcilePhoneEnrollments(f);assert.equal(b.created,1);assert.equal(b.enrolled,51);
});
test('health check exposes unresolved mappings and latest run',async()=>{const f=fixture();assert.match((await automaticEnrollmentHealth(f.env)).status,/Awaiting/);f.devices=[];f.webexFetch=async()=>Response.json({items:[]});await reconcilePhoneEnrollments(f);const h=await automaticEnrollmentHealth(f.env);assert.equal(h.severity,'warning');assert.match(h.cause,/webex device missing/);assert.match(h.detail,/five minutes/);});
test('scheduler integration preserves existing tasks and refuses duplicate insertion',()=>{const source='  async scheduled(event, env, ctx) {\n ctx.waitUntil(existing());\n}';const s=integrateAutoEnrollment(source);assert.ok(s.includes('ctx.waitUntil(existing())'));assert.ok(s.includes('reconcilePhoneEnrollments({env,webexFetch})'));assert.throws(()=>integrateAutoEnrollment(s));});
