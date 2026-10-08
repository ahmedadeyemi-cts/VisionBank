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
const TARGET={id:'user-2',displayName:'Temporary User',memberType:'PEOPLE',extension:'4102',phoneNumber:'+15155554102',location:{id:'loc-a',name:'CLIVE'}};

function phoneRequest(url){
  const req=new Request(url,{headers:{'CF-Connecting-IP':'203.0.113.44','User-Agent':'Yealink SIP-T57W'}});
  Object.defineProperty(req,'cf',{value:{colo:'TEST'}});
  return req;
}
async function xml(handler,env,url,executionContext=null){
  const res=await handler(phoneRequest(url),env,{},executionContext);
  return {status:res.status,text:await res.text(),headers:res.headers};
}

test('Button 7 path adds a temporary Line 2 and supports early Sign Out with automatic reboot',async()=>{
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
    baseUrl:'https://worker.example/api/webex/device-management',shortBaseUrl:'https://worker.example/p'
  });

  const launch=enrollment.buttonUrl.replace('$mac','805E0CEC1993').replace('$ip','10.44.8.21');
  const home=await xml(handler,env,launch);
  assert.equal(home.status,200);
  assert.match(home.text,/VisionBank Manage Extensions/);
  assert.match(home.text,/Add Temporary Line/);
  assert.match(home.text,/Refresh/);
  assert.doesNotMatch(home.text,/Line 2:/);

  const token=enrollment.xmlUrl.split('/').at(-1);
  const searchUrl='https://worker.example/p/'+token+'?a=search';
  const searchForm=await xml(handler,env,searchUrl);
  assert.match(searchForm.text,/Extension or phone number/);

  const search=await xml(handler,env,searchUrl+'&q=4102');
  assert.match(search.text,/4102 - Temporary User/);

  const duration=await xml(handler,env,'https://worker.example/p/'+token+'?a=duration&member=user-2&q=4102&locationId=loc-a');
  assert.match(duration.text,/15 minutes/);
  assert.match(duration.text,/12 hours/);

  const confirm=await xml(handler,env,'https://worker.example/p/'+token+'?a=confirm&member=user-2&q=4102&locationId=loc-a&minutes=15');
  assert.match(confirm.text,/4102 - Temporary User/);
  assert.match(confirm.text,/Save - 15 minutes/);
  assert.match(confirm.text,/Change time/);
  const match=confirm.text.match(/intent=([0-9a-f-]{36})/i);
  assert.ok(match);
  let background=null;
  const executionContext={waitUntil(promise){background=promise;}};
  const applied=await xml(handler,env,'https://worker.example/p/'+token+'?a=apply&intent='+match[1],executionContext);
  assert.equal(applied.status,200);
  assert.match(applied.text,/YealinkIPPhoneTextScreen/);
  assert.match(applied.text,/Saving Extension/);
  assert.match(applied.text,/Wait 5 seconds while we reboot your phone\./);
  assert.doesNotMatch(applied.text,/<MenuItem>/);
  assert.doesNotMatch(applied.text,/Return/);
  assert.ok(background,'phone Save should schedule background work');
  assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'space-old','response should return before background apply completes');
  await background;
  assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'user-2');
  assert.equal(phonismCalls.filter(x=>x.type==='sync').length,1);
  assert.equal(phonismCalls.filter(x=>x.type==='reboot').length,1);

  const leases=[...env.LOGS.map.entries()].filter(([k])=>k.startsWith('device-lease:')).map(([,v])=>JSON.parse(v.value));
  assert.equal(leases[0].durationMinutes,15);
  const activeHome=await xml(handler,env,launch);
  assert.match(activeHome.text,/Line 2: 4102 - Temporary User/);
  assert.match(activeHome.text,/Sign Out Temporary Line/);
  assert.match(activeHome.text,/Refresh/);
  const signoutReview=await xml(handler,env,'https://worker.example/p/'+token+'?a=e');
  assert.match(signoutReview.text,/Sign Out 4102 - Temporary User/);
  assert.match(signoutReview.text,/Sign Out Now/);
  assert.match(signoutReview.text,/Keep Line Active/);

  const signedOut=await xml(handler,env,'https://worker.example/p/'+token+'?a=o');
  assert.equal(signedOut.status,200);
  assert.match(signedOut.text,/Signed Out - Phone Restarting/);
  assert.match(signedOut.text,/Restored: 3999 - Original Line/);
  assert.match(signedOut.text,/Rebooting automatically/);
  assert.equal(webex.members.find(x=>Number(x.port)===2)?.id,'space-old');
  assert.equal(phonismCalls.filter(x=>x.type==='sync').length,2);
  assert.equal(phonismCalls.filter(x=>x.type==='reboot').length,2);
});

test('Button 7 token is bound to the enrolled MAC when the Yealink supplies $mac',async()=>{
  const env={WEBEX_ORG_ID:'org-1',DEVICE_WRITE_SCOPE:'organization',LOGS:new MemoryKV(),SESSIONS:new MemoryKV()};
  const enrollment=await createPhoneEnrollment(env,{device:{id:'call-1',displayName:'Pilot',mac:MAC,model:'T57W'},location:{id:'loc-a',name:'CLIVE'},phonismPhoneId:'9001',admin:{},baseUrl:'https://worker.example/api/webex/device-management',shortBaseUrl:'https://worker.example/p'});
  const handler=createDeviceManagementHandler({webexFetch:async()=>json({message:'unused'},404),checkAccess:async()=>({allowed:true}),loadIpRules:async()=>['approved'],phonismReader:{async discover(){throw new Error('should not reach provider');}}});
  const token=enrollment.xmlUrl.split('/').at(-1);
  const response=await xml(handler,env,'https://worker.example/p/'+token+'?m=AABBCCDDEEFF&i=10.0.0.1');
  assert.equal(response.status,403);
  assert.match(response.text,/authorization failed/i);
});
