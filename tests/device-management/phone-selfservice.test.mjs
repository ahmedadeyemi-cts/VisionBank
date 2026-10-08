import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPhoneEnrollment,authenticatePhoneAccess,handlePhoneCheckin,phoneTelemetryIndex,
  createPhoneIntent,readPhoneIntent,phoneDurationOptions,phoneDurationLabel,
  textMenu,textScreen,inputScreen,attachPhoneSelfService
} from '../../device-management/phone-selfservice.mjs';
import {buildAuditRecord} from '../../device-management/audit.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=1000}={}){return {keys:[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
}
const MAC='80:5E:0C:EC:19:93';
const device={id:'call-1',displayName:'Pilot T57W',mac:MAC,model:'Yealink T57W'};
const location={id:'loc-a',name:'CLIVE'};
const admin={email:'admin@visionbank.com',username:'admin'};
const enroll=env=>createPhoneEnrollment(env,{
  device,location,phonismPhoneId:'9001',admin,
  baseUrl:'https://worker.example/api/webex/device-management',
  shortBaseUrl:'https://worker.example/p'
});

test('phone enrollment creates a short device-bound Button 7 URL with no XML username or password',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()},result=await enroll(env);
  assert.equal(result.lineKey,7);
  assert.match(result.xmlUrl,/^https:\/\/worker\.example\/p\/[A-Za-z0-9]{22}$/);
  assert.equal(result.buttonUrl,result.xmlUrl+'?m=$mac&i=$ip');
  assert.ok(result.buttonUrl.length<=99);
  assert.match(result.provisioning,/linekey\.7\.type = 27/);
  assert.match(result.provisioning,/linekey\.7\.label = Manage Ext/);
  assert.doesNotMatch(result.provisioning,/features\.xml_browser\.(user_name|pwd)/);
  assert.equal(Object.hasOwn(result,'credential'),false);
  const saved=[...env.LOGS.map.entries()].find(([k])=>k.startsWith('device-phone-enrollment:'))[1].value;
  assert.equal(saved.includes(result.xmlUrl.split('/').at(-1)),false);
  assert.equal(saved.includes('"accessHash"'),true);
});

test('device-link authentication is phone-specific and invalid links fail closed',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()},result=await enroll(env);
  const token=result.xmlUrl.split('/').at(-1);
  const enrolled=await authenticatePhoneAccess(env,token);
  assert.equal(enrolled.device.mac,MAC);
  await assert.rejects(()=>authenticatePhoneAccess(env,'A'.repeat(22)),e=>e.code==='phone-credential-invalid'&&e.status===403);
});

test('check-in records handset IP, model and firmware independently of the button credential',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()},result=await enroll(env);
  const url=result.checkinUrls.registered
    .replace('$mac','805E0CEC1993').replace('$ip','10.44.8.21').replace('$model','T57W').replace('$firmware','96.86.0.70');
  const request=new Request(url,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  await handlePhoneCheckin(env,request);
  const telemetry=(await phoneTelemetryIndex(env)).byMac.get(MAC);
  assert.equal(telemetry.phoneIp,'10.44.8.21');
  assert.equal(telemetry.sourceIp,'203.0.113.44');
  assert.equal(telemetry.model,'T57W');
  assert.equal(telemetry.firmware,'96.86.0.70');
});

test('phone duration menu runs from 15 minutes through 12 hours',()=>{
  assert.deepEqual(phoneDurationOptions(),[15,30,60,120,240,480,720]);
  assert.equal(phoneDurationLabel(15),'15 minutes');
  assert.equal(phoneDurationLabel(60),'1 hour');
  assert.equal(phoneDurationLabel(720),'12 hours');
});

test('XML input asks for extension or phone number and safely escapes values',()=>{
  const menu=textMenu('VisionBank <Test>',[{prompt:'4000 & Test',uri:'https://example.test/x?a=1&b=2'}]);
  const input=inputScreen('Add Temporary Line','Extension or phone number','https://example.test/search','q');
  assert.match(menu,/VisionBank &lt;Test&gt;/);
  assert.match(menu,/4000 &amp; Test/);
  assert.match(menu,/a=1&amp;b=2/);
  assert.match(input,/Extension or phone number/);
  assert.match(input,/<Parameter>q<\/Parameter>/);
});

test('one-time confirmation intent stays scoped to the enrolled phone and duration',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()},result=await enroll(env);
  const enrollment=await authenticatePhoneAccess(env,result.xmlUrl.split('/').at(-1));
  const intent=await createPhoneIntent(env,enrollment,{memberId:'user-2',memberQuery:'4102',memberLocationId:'loc-a',durationMinutes:15});
  const read=await readPhoneIntent(env,intent.intentId,enrollment);
  assert.equal(read.memberId,'user-2');assert.equal(read.durationMinutes,15);
  await assert.rejects(()=>readPhoneIntent(env,intent.intentId,{...enrollment,enrollmentId:crypto.randomUUID()}),e=>e.code==='preview-expired');
});

test('inventory exposes status and telemetry but never the device-link credential',()=>{
  const enrollments={byMac:new Map([[MAC,{status:'active',authMode:'device-link',enrollmentId:'e-1',device:{mac:MAC}}]])};
  const telemetry={byMac:new Map([[MAC,{mac:MAC,phoneIp:'10.44.8.21',sourceIp:'203.0.113.44',model:'T57W',firmware:'96.86.0.70',lastSeenAt:'2026-10-05T16:00:00Z',event:'registered'}]])};
  const row=attachPhoneSelfService({id:'call-1',mac:MAC,model:'Yealink T57W'},enrollments,telemetry);
  assert.equal(row.phoneSelfService.enrolled,true);
  assert.equal(row.phoneSelfService.authMode,'device-link');
  assert.equal(row.phoneSelfService.phoneIp,'10.44.8.21');
  assert.equal(JSON.stringify(row).includes('accessHash'),false);
});

test('phone-originated changes audit as a verified device',()=>{
  const request=new Request('https://worker.example/apply',{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  const session={id:'phone:e-1',actorType:'device',verified:true,verificationMethod:'device-token',verifiedAt:'2026-10-05T16:00:00Z',
    operator:{name:'Yealink T57W '+MAC,email:''},deviceIdentity:{mac:MAC,model:'T57W',enrollmentId:'e-1'}};
  const record=buildAuditRecord({eventType:'temporary-line-change',action:'save-sync',request,session,device,location});
  assert.equal(record.actor.type,'device');assert.equal(record.actor.deviceIdentity.mac,MAC);assert.equal(record.sourceIp,'203.0.113.44');
});


test('TextScreen renders a locked message with no menu items',()=>{
  const xml=textScreen('Saving Extension','Wait 5 seconds while we reboot your phone.',{timeout:0,lockIn:true,beep:false});
  assert.match(xml,/YealinkIPPhoneTextScreen/);
  assert.match(xml,/Timeout="0"/);
  assert.match(xml,/LockIn="yes"/);
  assert.match(xml,/Saving Extension/);
  assert.match(xml,/Wait 5 seconds while we reboot your phone\./);
  assert.doesNotMatch(xml,/<MenuItem>/);
});
