import test from 'node:test';
import assert from 'node:assert/strict';
import {
  composeMembers,membersFingerprint,writeWebexMembers,createWritePreview,applyWritePreview,verifyLease,runRecoveryAction,sweepExpiredLeases
} from '../../device-management/write.mjs';
import {deviceWriteScope,isPilotDevice} from '../../device-management/lease.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=1000}={}){
    const keys=[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata}));
    return {keys,list_complete:true};
  }
}

const ORG='org-1';
const MAC='80:5E:0C:EC:19:93';
const DEVICE={id:'call-1',displayName:'Ahmed Adeyemi',mac:MAC};
const LOCATION={id:'loc-a',name:'CLIVE'};
const SESSION={id:'11111111-1111-4111-8111-111111111111',operator:{name:'Ahmed Adeyemi',email:'webexaccounttest@visionbank.com'}};
const PRIMARY={
  id:'user-primary',port:1,primaryOwner:true,lineType:'PRIMARY',lineWeight:1,
  hotlineEnabled:false,allowCallDeclineEnabled:true,t38FaxCompressionEnabled:false,
  firstName:'Ahmed',lastName:'Adeyemi',extension:'3223',memberType:'PEOPLE'
};
const BASELINE={
  id:'space-old',port:2,primaryOwner:false,lineType:'SHARED_CALL_APPEARANCE',lineWeight:1,
  hotlineEnabled:false,allowCallDeclineEnabled:true,t38FaxCompressionEnabled:false,
  firstName:'Old',lastName:'Line',extension:'1999',memberType:'PLACE',lineLabel:'Old Line'
};
const TARGET={id:'user-ryan',name:'Ryan Dea',displayName:'Ryan Dea',extension:'1806',type:'PEOPLE',locationId:'loc-b',locationName:'DUFF'};

function request(){
  return new Request('https://worker.example/api/webex/device-management/apply',{headers:{'CF-Connecting-IP':'198.51.100.12','User-Agent':'Test Browser'}});
}
function env(){
  return {SESSIONS:new MemoryKV(),LOGS:new MemoryKV(),DEVICE_WRITE_PILOT_MACS:MAC};
}

function webexFixture(initial=[PRIMARY]){
  const state={members:structuredClone(initial),puts:[]};
  const fetch=async(_env,url,options={})=>{
    const u=new URL(url);
    if(u.pathname==='/v1/telephony/config/devices/call-1/members'){
      if((options.method||'GET')==='GET')return Response.json({members:structuredClone(state.members),maxLineCount:4});
      if(options.method==='PUT'){
        const body=JSON.parse(options.body);state.puts.push(body);state.members=structuredClone(body.members);
        return new Response(null,{status:204});
      }
    }
    return Response.json({message:'not found'},{status:404});
  };
  return {state,fetch};
}

function phonismFixture(){
  const calls=[];
  return {
    calls,
    reader:{
      async syncHierarchyIntegration(_env,companyId,body){calls.push({type:'sync',companyId,body});return {accepted:true,status:202};},
      async lines(){const current=calls.find(x=>x.type==='target');return current?.lines||[{lineNumber:2,alias:'Ryan Dea - (test)',registrationStatus:'not-monitored'}];},
      async tr069Action(_env,phoneId,action){calls.push({type:'tr069',phoneId,action});return {accepted:true,status:200,action};}
    }
  };
}

test('member composition preserves primary line and changes only port 2',()=>{
  const members=composeMembers([PRIMARY,BASELINE],TARGET);
  assert.equal(members.length,2);
  assert.equal(members[0].id,'user-primary');
  assert.equal(members[0].port,1);
  assert.equal(members[0].primaryOwner,true);
  assert.equal(members[1].id,'user-ryan');
  assert.equal(members[1].port,2);
  assert.equal(members[1].lineType,'SHARED_CALL_APPEARANCE');
  assert.equal(Object.prototype.hasOwnProperty.call(members[1],'lineLabel'),false);
});

test('Webex appearance-limit response becomes a user-actionable conflict',async()=>{
  const fetch=async()=>Response.json({message:'[Error 4495] Exceeded maximum number of allowed appearances.'},{status:400});
  await assert.rejects(
    ()=>writeWebexMembers(fetch,{},ORG,'call-1',[PRIMARY]),
    error=>error.code==='target-appearance-limit'&&error.status===409&&error.upstreamStatus===400
  );
});

test('organization write scope enables VisionBank devices while preserving the pilot fallback',()=>{
  assert.equal(deviceWriteScope({DEVICE_WRITE_PILOT_MACS:MAC}),'pilot');
  assert.equal(isPilotDevice({DEVICE_WRITE_PILOT_MACS:MAC},MAC),true);
  assert.equal(isPilotDevice({DEVICE_WRITE_PILOT_MACS:MAC},'AA:BB:CC:DD:EE:FF'),false);
  assert.equal(deviceWriteScope({DEVICE_WRITE_SCOPE:'organization',DEVICE_WRITE_PILOT_MACS:MAC}),'organization');
  assert.equal(isPilotDevice({DEVICE_WRITE_SCOPE:'organization',DEVICE_WRITE_PILOT_MACS:MAC},'AA:BB:CC:DD:EE:FF'),true);
  assert.equal(deviceWriteScope({}),'disabled');
});

test('preview is restricted to configured write scope and records the baseline',async()=>{
  const e=env();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY,BASELINE],
    targetMember:TARGET,durationMinutes:60,reason:'Testing',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  assert.equal(preview.baselineLine2.memberId,'space-old');
  assert.equal(preview.targetMember.id,'user-ryan');
  assert.equal(preview.targetMember.locationId,'loc-b');
  assert.equal(preview.targetMember.locationName,'DUFF');
  assert.equal(preview.location.id,'loc-a');
  assert.equal(preview.phonismContext.tenantId,'123');
  assert.ok(await e.SESSIONS.get('device-preview:'+preview.mutationId));
  await assert.rejects(()=>createWritePreview({
    env:{...e,DEVICE_WRITE_PILOT_MACS:'00:00:00:00:00:00'},session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',phonismContext:{}
  }),err=>err.code==='device-write-not-enabled');
});

test('apply writes Webex, queues Phonism sync, then automatically queues reboot',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'Temporary seating',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const result=await applyWritePreview({
    env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,
    mutationId:preview.mutationId,phonismReader:ph.reader
  });
  assert.equal(wx.state.puts.length,1);
  assert.equal(wx.state.puts[0].members.find(x=>x.port===2).id,'user-ryan');
  assert.deepEqual(ph.calls.map(x=>x.type),['sync','tr069']);
  assert.equal(ph.calls[1].action,'Reboot');
  assert.equal(result.rebootQueued,true);
  assert.equal(result.lease.temporaryLine2.memberId,'user-ryan');
  assert.equal(result.lease.status,'active');
  assert.equal(result.lease.recovery.rebootAttempted,true);
  assert.equal(result.lease.recovery.automaticReboot,true);
  assert.ok(await e.LOGS.get('device-lease:'+result.lease.leaseId));
  const auditKeys=(await e.LOGS.list({prefix:'device-audit:'})).keys;
  assert.equal(auditKeys.length,2);
});

test('appearance-limit failure carries the reviewed target and device context',async()=>{
  const e=env(),ph=phonismFixture();
  const fetch=async(_env,url,options={})=>{
    const u=new URL(url);
    if(u.pathname==='/v1/telephony/config/devices/call-1/members'){
      if((options.method||'GET')==='GET')return Response.json({members:[PRIMARY],maxLineCount:20});
      if(options.method==='PUT')return Response.json({message:'[Error 4495] Exceeded maximum number of allowed appearances.'},{status:400});
    }
    return Response.json({message:'not found'},{status:404});
  };
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'90126',companyId:'84712'}
  });
  await assert.rejects(
    ()=>applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader}),
    error=>error.code==='target-appearance-limit'&&error.targetMember?.memberId==='user-ryan'&&
      error.targetMember?.locationId==='loc-b'&&error.location?.id==='loc-a'&&error.device?.id==='call-1'
  );
});

test('apply rejects stale Webex state before any write',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  wx.state.members=[PRIMARY,BASELINE];
  await assert.rejects(()=>applyWritePreview({
    env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,
    mutationId:preview.mutationId,phonismReader:ph.reader
  }),err=>err.code==='device-state-changed-review-again');
  assert.equal(wx.state.puts.length,0);
  assert.equal(ph.calls.length,0);
});

test('verification reports applied-unverified when line is present after reboot but Phonism is not monitored',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  const verified=await verifyLease({env:e,webexFetch:wx.fetch,orgId:ORG,leaseId:applied.lease.leaseId,phonismReader:ph.reader});
  assert.equal(verified.state,'applied-unverified');
  assert.equal(verified.lease.verification.webex,'confirmed');
  assert.equal(verified.lease.verification.phonism,'not-monitored');
  assert.equal(verified.lease.recovery.rebootAttempted,true);
});

test('manual recovery can queue another reboot after the automatic reboot',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  assert.equal(applied.lease.recovery.automaticReboot,true);
  const reboot=await runRecoveryAction({env:e,request:request(),session:SESSION,leaseId:applied.lease.leaseId,phonismReader:ph.reader});
  assert.equal(reboot.lease.recovery.rebootAttempted,true);
  assert.equal(reboot.lease.recovery.automaticReboot,false);
  assert.deepEqual(ph.calls.filter(x=>x.type==='tr069').map(x=>x.action),['Reboot','Reboot']);
});

test('expiry restores baseline, queues another Phonism sync, and reboots the handset',async()=>{
  const e=env(),wx=webexFixture([PRIMARY,BASELINE]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY,BASELINE],
    targetMember:TARGET,durationMinutes:15,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  const due=Date.parse(applied.lease.expiresAt)+1;
  const results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due});
  assert.equal(results[0].status,'restored');
  assert.equal(wx.state.members.find(x=>x.port===2).id,'space-old');
  assert.equal(ph.calls.filter(x=>x.type==='sync').length,2);
  assert.equal(ph.calls.filter(x=>x.type==='tr069'&&x.action==='Reboot').length,2);
});

test('expiry preserves a newer external Webex change and reconciles Phonism without overwriting Webex',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:15,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  wx.state.members=composeMembers([PRIMARY],{id:'control-hub-line',displayName:'Control Hub Line',extension:'1888'});
  const results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(applied.lease.expiresAt)+1});
  assert.equal(results[0].status,'external-change-reconciled');
  assert.equal(wx.state.members.find(x=>x.port===2).id,'control-hub-line');
  assert.equal(wx.state.puts.length,1);
  assert.equal(ph.calls.filter(x=>x.type==='sync').length,2);
  assert.equal(ph.calls.filter(x=>x.type==='tr069'&&x.action==='Reboot').length,2);
  const stored=JSON.parse(await e.LOGS.get('device-lease:'+applied.lease.leaseId));
  assert.equal(stored.status,'external-change-reconciled');
  assert.equal(stored.externalCurrentLine2.memberId,'control-hub-line');
});

test('external-change reconciliation retries Phonism Sync without overwriting Webex',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:15,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  wx.state.members=composeMembers([PRIMARY],{id:'control-hub-line',displayName:'Control Hub Line',extension:'1888'});
  const failingReader={...ph.reader,async syncHierarchyIntegration(){const error=new Error('sync-failed');error.code='sync-failed';throw error;}};
  const due=Date.parse(applied.lease.expiresAt)+1;
  const first=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:failingReader,now:due});
  assert.equal(first[0].status,'external-change-sync-pending');
  assert.equal(wx.state.members.find(x=>x.port===2).id,'control-hub-line');
  assert.equal(wx.state.puts.length,1);
  const second=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due+300000});
  assert.equal(second[0].status,'external-change-reconciled');
  assert.equal(wx.state.members.find(x=>x.port===2).id,'control-hub-line');
  assert.equal(wx.state.puts.length,1);
});

test('apply fails before Webex write when Enterprise Phonism sync owner is missing',async()=>{
  const e=env();
  const wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'90126',companyId:null}
  });
  await assert.rejects(()=>applyWritePreview({
    env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,
    mutationId:preview.mutationId,phonismReader:ph.reader
  }),err=>err.code==='phonism-enterprise-sync-company-required');
  assert.equal(wx.state.puts.length,0);
  assert.equal(ph.calls.length,0);
});
