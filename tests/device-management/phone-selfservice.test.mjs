import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPhoneEnrollment,authenticatePhone,handlePhoneCheckin,phoneTelemetryIndex,
  createPhoneIntent,readPhoneIntent,phoneDurationOptions,phoneDurationLabel,
  textMenu,inputScreen,attachPhoneSelfService
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

const basic=(u,p)=>'Basic '+Buffer.from(u+':'+p).toString('base64');

test('phone enrollment returns one-time XML credentials while durable storage keeps only hashes',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const result=await createPhoneEnrollment(env,{device,location,phonismPhoneId:'9001',admin,baseUrl:'https://worker.example/api/webex/device-management'});
  assert.match(result.credential.username,/^[A-Za-z0-9]{12}$/);
  assert.match(result.credential.password,/^[A-Za-z0-9]{15}$/);
  assert.equal(result.xmlUrl,'https://worker.example/api/webex/device-management/phone/xml');
  assert.match(result.provisioning,/features\.xml_browser\.user_name/);
  assert.match(result.provisioning,/features\.xml_browser\.pwd/);
  assert.match(result.provisioning,/linekey\.X\.type = 27/);
  assert.match(result.provisioning,/action_url\.registered/);
  const saved=[...env.LOGS.map.entries()].find(([k])=>k.startsWith('device-phone-enrollment:'))[1].value;
  assert.equal(saved.includes(result.credential.password),false);
  assert.equal(saved.includes('"passwordHash"'),true);
});

test('XML browser authentication is device-specific and invalid credentials fail closed',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const result=await createPhoneEnrollment(env,{device,location,phonismPhoneId:'9001',admin,baseUrl:'https://worker.example/api/webex/device-management'});
  const good=new Request(result.xmlUrl,{headers:{Authorization:basic(result.credential.username,result.credential.password)}});
  const enrolled=await authenticatePhone(env,good);
  assert.equal(enrolled.device.mac,MAC);
  const bad=new Request(result.xmlUrl,{headers:{Authorization:basic(result.credential.username,'WrongPassword1')}});
  await assert.rejects(()=>authenticatePhone(env,bad),e=>e.code==='phone-credential-invalid'&&e.status===401);
});

test('check-in token records handset IP, model and firmware without becoming a write credential',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const result=await createPhoneEnrollment(env,{device,location,phonismPhoneId:'9001',admin,baseUrl:'https://worker.example/api/webex/device-management'});
  const url=result.checkinUrls.registered
    .replace('$mac','805E0CEC1993').replace('$ip','10.44.8.21').replace('$model','T57W').replace('$firmware','96.86.0.70');
  const request=new Request(url,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  await handlePhoneCheckin(env,request);
  const telemetry=(await phoneTelemetryIndex(env)).byMac.get(MAC);
  assert.equal(telemetry.phoneIp,'10.44.8.21');
  assert.equal(telemetry.sourceIp,'203.0.113.44');
  assert.equal(telemetry.model,'T57W');
  assert.equal(telemetry.firmware,'96.86.0.70');
  await assert.rejects(()=>authenticatePhone(env,request),e=>e.code==='phone-credential-required');
});

test('phone duration menu matches the existing Device Manager temporary lease choices',()=>{
  assert.deepEqual(phoneDurationOptions(),[30,60,120,240,480,720]);
  assert.equal(phoneDurationLabel(30),'30 minutes');
  assert.equal(phoneDurationLabel(60),'1 hour');
  assert.equal(phoneDurationLabel(720),'12 hours');
});

test('XML menus escape untrusted text and remain small enough for handset XML Browser use',()=>{
  const menu=textMenu('VisionBank <Test>',[{prompt:'4000 & Test',uri:'https://example.test/x?a=1&b=2'}]);
  const input=inputScreen('Add Extension','Name & extension','https://example.test/search','q');
  assert.match(menu,/VisionBank &lt;Test&gt;/);
  assert.match(menu,/4000 &amp; Test/);
  assert.match(menu,/a=1&amp;b=2/);
  assert.match(input,/YealinkIPPhoneInputScreen/);
  assert.match(input,/<Parameter>q<\/Parameter>/);
  assert.ok(Buffer.byteLength(menu)<10*1024);
  assert.ok(Buffer.byteLength(input)<10*1024);
});

test('one-time confirmation intent is scoped to the enrolled phone and requested duration',async()=>{
  const env={LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const a=(await createPhoneEnrollment(env,{device,location,phonismPhoneId:'9001',admin,baseUrl:'https://worker.example/api/webex/device-management'})).enrollment;
  const enrollment={...a,device,location,phonismPhoneId:'9001'};
  const intent=await createPhoneIntent(env,enrollment,{memberId:'user-2',memberQuery:'4102',memberLocationId:'loc-a',durationMinutes:120});
  const read=await readPhoneIntent(env,intent.intentId,enrollment);
  assert.equal(read.memberId,'user-2');
  assert.equal(read.durationMinutes,120);
  await assert.rejects(()=>readPhoneIntent(env,intent.intentId,{...enrollment,enrollmentId:crypto.randomUUID()}),e=>e.code==='preview-expired');
});

test('inventory attachment exposes only phone status and telemetry, never phone credentials',()=>{
  const enrollments={byMac:new Map([[MAC,{status:'active',enrollmentId:'e-1',device:{mac:MAC}}]])};
  const telemetry={byMac:new Map([[MAC,{mac:MAC,phoneIp:'10.44.8.21',sourceIp:'203.0.113.44',model:'T57W',firmware:'96.86.0.70',lastSeenAt:'2026-10-05T16:00:00Z',event:'registered'}]])};
  const row=attachPhoneSelfService({id:'call-1',mac:MAC,model:'Yealink T57W'},enrollments,telemetry);
  assert.equal(row.phoneSelfService.enrolled,true);
  assert.equal(row.phoneSelfService.phoneIp,'10.44.8.21');
  assert.equal(JSON.stringify(row).includes('password'),false);
  assert.equal(JSON.stringify(row).includes('checkin'),false);
});

test('phone-originated changes are audited as a verified device rather than a fake human operator',()=>{
  const request=new Request('https://worker.example/apply',{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  const session={id:'phone:e-1',actorType:'device',verified:true,verificationMethod:'device-token',verifiedAt:'2026-10-05T16:00:00Z',
    operator:{name:'Yealink T57W '+MAC,email:''},deviceIdentity:{mac:MAC,model:'T57W',enrollmentId:'e-1'}};
  const record=buildAuditRecord({eventType:'temporary-line-change',action:'save-sync',request,session,device,location});
  assert.equal(record.actor.type,'device');
  assert.equal(record.actor.email,'');
  assert.equal(record.actor.deviceIdentity.mac,MAC);
  assert.equal(record.sourceIp,'203.0.113.44');
});
