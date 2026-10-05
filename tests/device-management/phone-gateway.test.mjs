import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
import {createPhoneEnrollment} from '../../device-management/phone-selfservice.mjs';
import {sweepExpiredLeases} from '../../device-management/write.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=1000}={}){return {keys:[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
}
const json=(body,status=200)=>Response.json(body,{status});
const MAC='80:5E:0C:EC:19:93';
const PRIMARY={id:'user-1',displayName:'Primary User',memberType:'PEOPLE',extension:'3223',location:{id:'loc-a',name:'CLIVE'},lineType:'PRIMARY',port:1};
const BASELINE={id:'space-old',displayName:'Original Line',memberType:'PLACE',extension:'3999',location:{id:'loc-a',name:'CLIVE'},lineType:'SHARED_CALL_APPEARANCE',port:2};
const TARGET={id:'user-2',displayName:'Temporary User',memberType:'PEOPLE',extension:'4102',location:{id:'loc-a',name:'CLIVE'}};

function basic(username,password){return 'Basic '+Buffer.from(username+':'+password).toString('base64');}
function phoneRequest(path,credential){
  const headers={'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'};
  if(credential)headers.Authorization=basic(credential.username,credential.password);
  const req=new Request('https://worker.example/api/webex/device-management/'+path,{headers});
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  return req;
}
async function xml(handler,env,path,credential){
  const res=await handler(phoneRequest(path,credential),env,{});
  return {status:res.status,text:await res.text(),headers:res.headers};
}

test('Yealink phone path uses the existing write lease and auto-restores Line 2 after the chosen duration',async()=>{
  const env={WEBEX_ORG_ID:'org-1',PHONISM_API_KEY:'x'.repeat(32),DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const webex={members:[structuredClone(PRIMARY),structuredClone(BASELINE)],puts:[]};
  const webexFetch=async(_env,url,options={})=>{
    const u=new URL(url),method=options.method||'GET';
    if(u.pathname==='/v1/devices/webex-1')return json({id:'webex-1',callingDeviceId:'call-1',displayName:'Pilot T57W',product:'Yealink T57W',mac:'805E0CEC1993',connectionStatus:'connected',personId:'user-1',locationId:'loc-a',managedBy:'PARTNER',type:'phone'});
    if(u.pathname==='/v1/telephony/config/devices/call-1/members'){
      if(method==='GET')return json({members:structuredClone(webex.members),maxLineCount:4});
      if(method==='PUT'){const body=JSON.parse(options.body);webex.puts.push(body);webex.members=structuredClone(body.members);return new Response(null,{status:204});}
    }
    if(u.pathname==='/v1/telephony/config/devices/call-1/availableMembers')return json({members:[TARGET]});
    if(u.pathname==='/v1/telephony/config/numbers')return json({phoneNumbers:[]});
    return json({message:'not found'},404);
  };
  const phonismCalls=[];
  const phonismReader={
    async discover(){return {domain:{id:'40',name:'VisionBank Iowa'},tenants:[{id:'101',name:'CLIVE',webexLocationId:'loc-a'}],syncCompany:{id:'500',name:'VisionBank',type:'Enterprise'},webexIntegration:{id:'501'},truncated:false};},
    async tenantPhones(){return {phones:[{id:'9001',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,lastProvision:'2026-10-05 10:00:00',webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink T57W'}],truncated:false};},
    async phone(){return {id:'9001',tenantId:'101',tenantName:'CLIVE',mac:MAC,state:'1',serviceState:['tr069'],tr069:true,lastProvision:'2026-10-05 10:00:00',webexDeviceIds:['webex-1'],webexDeviceId:'webex-1',webexDeviceType:'Yealink T57W'};},
    async lines(){return [{lineNumber:1,username:'3223',alias:'Primary User',registrationStatus:'registered'},{lineNumber:2,username:webex.members.find(x=>Number(x.port)===2)?.extension||'',alias:'Line 2',registrationStatus:'not-monitored'}];},
    async syncHierarchyIntegration(_env,companyId,body){phonismCalls.push({type:'sync',companyId,body});return {accepted:true,status:202};},
    async tr069Action(_env,phoneId,action){phonismCalls.push({type:'reboot',phoneId,action});return {accepted:true,status:200};}
  };
  const handler=createDeviceManagementHandler({webexFetch,checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader});
  const enrollment=await createPhoneEnrollment(env,{
    device:{id:'call-1',displayName:'Pilot T57W',mac:MAC,model:'Yealink T57W'},
    location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'9001',admin:{email:'admin@visionbank.com',username:'admin'},
    baseUrl:'https://worker.example/api/webex/device-management'
  });
  const credential=enrollment.credential;

  const unauth=await xml(handler,env,'phone/xml',null);
  assert.equal(unauth.status,401);
  assert.match(unauth.headers.get('WWW-Authenticate'),/^Basic /);

  const home=await xml(handler,env,'phone/xml',credential);
  assert.equal(home.status,200);
  assert.match(home.text,/VisionBank Manage Extensions/);
  assert.match(home.text,/Add temporary extension/);

  const searchForm=await xml(handler,env,'phone/search',credential);
  assert.match(searchForm.text,/YealinkIPPhoneInputScreen/);
  assert.match(searchForm.text,/Name or extension/);

  const search=await xml(handler,env,'phone/search?q=4102',credential);
  assert.match(search.text,/4102 · Temporary User/);

  const duration=await xml(handler,env,'phone/duration?member=user-2&q=4102&locationId=loc-a',credential);
  assert.match(duration.text,/30 minutes/);
  assert.match(duration.text,/1 hour/);
  assert.match(duration.text,/12 hours/);

  const confirm=await xml(handler,env,'phone/confirm?member=user-2&q=4102&locationId=loc-a&minutes=30',credential);
  assert.match(confirm.text,/Confirm Temporary Extension/);
  const match=confirm.text.match(/intent=([0-9a-f-]{36})/i);
  assert.ok(match,'confirmation should contain a one-time apply URI');
  const applied=await xml(handler,env,'phone/apply?intent='+match[1],credential);
  assert.equal(applied.status,200);
  assert.match(applied.text,/Extension Added/);
  assert.match(applied.text,/30 minutes/);
  assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'user-2');
  assert.equal(webex.puts.length,1);
  assert.equal(phonismCalls.filter(x=>x.type==='sync').length,1);
  assert.equal(phonismCalls.filter(x=>x.type==='reboot').length,1);

  const leases=[...env.LOGS.map.entries()].filter(([k])=>k.startsWith('device-lease:')).map(([,v])=>JSON.parse(v.value));
  assert.equal(leases.length,1);
  assert.equal(leases[0].durationMinutes,30);
  assert.equal(leases[0].temporaryLine2.memberId,'user-2');
  assert.equal(leases[0].baselineLine2.memberId,'space-old');

  const blocked=await xml(handler,env,'phone/search?q=4102',credential);
  assert.equal(blocked.status,409);
  assert.match(blocked.text,/temporary Line 2 is already active/i);

  const due=Date.parse(leases[0].expiresAt)+1;
  const sweep=await sweepExpiredLeases({env,webexFetch,orgId:'org-1',phonismReader,now:due});
  assert.equal(sweep[0].status,'restored');
  assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'space-old');
  assert.equal(webex.puts.length,2);
  assert.equal(phonismCalls.filter(x=>x.type==='sync').length,2);
  assert.equal(phonismCalls.filter(x=>x.type==='reboot').length,2);
});
