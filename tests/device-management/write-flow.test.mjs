import test from 'node:test';
import assert from 'node:assert/strict';
import {
  phonismLineMatchesTarget,composeMembers,membersFingerprint,writeWebexMembers,createWritePreview,applyWritePreview,verifyLease,runRecoveryAction,sweepExpiredLeases,endTemporaryLease
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

function phonismFixture({lineReadyAfter=0,rebootFailures=0}={}){
  const calls=[],state={lineReads:0,rebootAttempts:0};
  return {
    calls,state,
    reader:{
      async syncHierarchyIntegration(_env,companyId,body){calls.push({type:'sync',companyId,body});return {accepted:true,status:202};},
      async lines(){
        state.lineReads++;
        if(state.lineReads<=lineReadyAfter)return [{lineNumber:2,alias:'Old Line',registrationStatus:'not-monitored'}];
        const current=calls.find(x=>x.type==='target');
        return current?.lines||[{lineNumber:2,alias:'Ryan Dea - (test)',username:'1806',registrationStatus:'not-monitored'}];
      },
      async tr069Action(_env,phoneId,action){
        state.rebootAttempts++;
        calls.push({type:'tr069',phoneId,action,attempt:state.rebootAttempts});
        if(state.rebootAttempts<=rebootFailures){
          const error=new Error('temporary-tr069-failure');error.code='temporary-tr069-failure';throw error;
        }
        return {accepted:true,status:200,action};
      }
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
  assert.deepEqual(ph.calls[0].body.assetTypes,['Device']);
  assert.equal(ph.calls[0].body.tenantId,'123');
  assert.equal(result.lease.recovery.syncStrategy,'device-first');
  assert.equal(ph.calls[1].action,'Reboot');
  assert.equal(ph.state.lineReads,1);
  assert.equal(ph.state.rebootAttempts,1);
  assert.equal(result.rebootQueued,true);
  assert.equal(result.lease.temporaryLine2.memberId,'user-ryan');
  assert.equal(result.lease.status,'active');
  assert.equal(result.lease.recovery.rebootAttempted,true);
  assert.equal(result.lease.recovery.automaticReboot,true);
  assert.equal(result.lease.recovery.syncConfirmedBeforeReboot,true);
  assert.equal(result.lease.recovery.autoRebootAttempts,1);
  assert.ok(await e.LOGS.get('device-lease:'+result.lease.leaseId));
  const auditKeys=(await e.LOGS.list({prefix:'device-audit:'})).keys;
  assert.equal(auditKeys.length,2);
});

test('save waits for Phonism Line 2 convergence and retries automatic reboot without user action',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture({lineReadyAfter:1,rebootFailures:1});
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],
    targetMember:TARGET,durationMinutes:30,reason:'Automatic reboot retry',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const result=await applyWritePreview({
    env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,
    mutationId:preview.mutationId,phonismReader:ph.reader
  });
  assert.equal(result.rebootQueued,true);
  assert.equal(result.rebootError,null);
  assert.equal(ph.state.lineReads,2);
  assert.equal(ph.state.rebootAttempts,2);
  assert.equal(result.lease.recovery.syncConfirmedBeforeReboot,true);
  assert.equal(result.lease.recovery.syncConfirmAttempts,2);
  assert.equal(result.lease.recovery.autoRebootAttempts,2);
  assert.equal(result.lease.recovery.autoRebootFailed,undefined);
  assert.deepEqual(ph.calls.filter(x=>x.type==='tr069').map(x=>x.action),['Reboot','Reboot']);
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
  const reboot=await runRecoveryAction({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,leaseId:applied.lease.leaseId,phonismReader:ph.reader});
  assert.equal(reboot.lease.recovery.rebootAttempted,true);
  assert.equal(reboot.lease.recovery.automaticReboot,false);
  assert.deepEqual(ph.calls.filter(x=>x.type==='tr069').map(x=>x.action),['Reboot','Reboot']);
});

test('early sign out restores baseline immediately, syncs Phonism, and reboots the handset',async()=>{
  const e=env(),wx=webexFixture([PRIMARY,BASELINE]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY,BASELINE],
    targetMember:TARGET,durationMinutes:60,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  ph.reader.lines=async()=>[{lineNumber:2,username:'1999',alias:'Old Line'}];
  const ended=await endTemporaryLease({
    env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,
    leaseId:applied.lease.leaseId,phonismReader:ph.reader,now:Date.now()+1000
  });
  assert.equal(ended.result.status,'restored');
  assert.equal(wx.state.members.find(x=>x.port===2).id,'space-old');
  assert.equal(ph.calls.filter(x=>x.type==='sync').length,2);
  assert.equal(ph.calls.filter(x=>x.type==='tr069'&&x.action==='Reboot').length,2);
  assert.ok(ended.lease.manualEndRequestedAt);
  assert.equal(ended.lease.status,'restored');
  const auditKeys=(await e.LOGS.list({prefix:'device-audit:'})).keys;
  assert.ok(auditKeys.length>=4);
});

test('expiry restores baseline, queues another Phonism sync, and reboots the handset',async()=>{
  const e=env(),wx=webexFixture([PRIMARY,BASELINE]),ph=phonismFixture();
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY,BASELINE],
    targetMember:TARGET,durationMinutes:15,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  ph.reader.lines=async()=>[{lineNumber:2,username:'1999',alias:'Old Line'}];
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
  Object.assign(wx.state.members[1],{firstName:'Control Hub',lastName:'Line',extension:'1888'});
  ph.reader.lines=async()=>[{lineNumber:2,username:'1888',alias:'Control Hub Line'}];
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
  Object.assign(wx.state.members[1],{firstName:'Control Hub',lastName:'Line',extension:'1888'});
  ph.reader.lines=async()=>[{lineNumber:2,username:'1888',alias:'Control Hub Line'}];
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


test('line identity matching rejects extension prefixes and same-name prefixes',()=>{
  assert.equal(phonismLineMatchesTarget([{lineNumber:2,username:'14060',alias:'Other'}],{extension:'1406',name:'Matt'}),false);
  assert.equal(phonismLineMatchesTarget([{lineNumber:2,alias:'Matthew'}],{name:'Matt'}),false);
  assert.equal(phonismLineMatchesTarget([{lineNumber:2,alias:'Matt - (m@example.test)'}],{name:'Matt'}),true);
  assert.equal(phonismLineMatchesTarget([{lineNumber:'2',username:'1406'}],{extension:'1406'}),true);
});

test('unconfirmed save defers reboot; durable retry verifies both providers and reboots once',async()=>{
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture({lineReadyAfter:99});
  const preview=await createWritePreview({
    env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],targetMember:TARGET,durationMinutes:15,reason:'',
    phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}
  });
  const applied=await applyWritePreview({env:e,request:request(),session:{...SESSION,actorType:'device',verified:true,deviceIdentity:{mac:MAC,model:'T54W'}},webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  assert.equal(applied.syncPending,true);assert.equal(applied.rebootQueued,false);assert.equal(ph.state.rebootAttempts,0);
  assert.equal(applied.lease.verification.state,'sync-pending');
  assert.ok(applied.lease.recovery.initialSyncCheckCompletedAt);
  assert.ok(Date.parse(applied.lease.recovery.phonePollUntil)>Date.now()+290000);
  const now=Date.parse(applied.lease.recovery.phonePollUntil)+1;
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now});
  assert.equal(ph.state.rebootAttempts,0,'stale Phonism must not trigger reboot');
  ph.state.lineReads=100;
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:now+1000});
  assert.equal(ph.state.rebootAttempts,1);
  const saved=JSON.parse(await e.LOGS.get('device-lease:'+applied.lease.leaseId));
  assert.equal(saved.recovery.syncConfirmedBeforeReboot,true);assert.equal(saved.recovery.syncPending,false);
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:now+2000});
  assert.equal(ph.state.rebootAttempts,1,'completed retry is not replayed');
});

async function pendingFixture(){
  const e=env(),wx=webexFixture([PRIMARY]),ph=phonismFixture();
  const preview=await createWritePreview({env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],targetMember:TARGET,durationMinutes:15,reason:'',phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}});
  const applied=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  const lease=applied.lease;
  lease.recovery={syncPending:true,syncPendingSince:lease.startsAt,rebootAttempted:false};
  lease.verification.state='sync-pending';
  await e.LOGS.put('device-lease:'+lease.leaseId,JSON.stringify(lease));
  ph.state.rebootAttempts=0;
  return {e,wx,ph,lease};
}

test('pending retry respects external changes and reports failure instead of rebooting stale target',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  wx.state.members=composeMembers([PRIMARY],{...TARGET,id:'someone-else'});
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+300000});
  assert.equal(ph.state.rebootAttempts,0);
  const saved=JSON.parse(await e.LOGS.get('device-lease:'+lease.leaseId));
  assert.equal(saved.verification.state,'sync-failed');assert.equal(saved.recovery.syncConfirmError,'webex-line-changed');
});

test('failed sync is bounded, audited, and still expires without applying the temporary target',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  ph.reader.lines=async()=>{throw Object.assign(new Error('unavailable'),{code:'phonism-unavailable'});};
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+600000});
  assert.equal(ph.state.rebootAttempts,0);
  const saved=JSON.parse(await e.LOGS.get('device-lease:'+lease.leaseId));
  assert.equal(saved.verification.state,'sync-failed');assert.equal(saved.recovery.syncPending,false);
  const audits=await e.LOGS.list({prefix:'device-audit:'});
  assert.ok(audits.keys.some(k=>k.metadata.eventType==='device-sync-failure'));
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.expiresAt)+1});
  assert.equal(wx.state.members.some(m=>Number(m.port)===2),false);
});

test('manual recovery cannot bypass the sync check',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  ph.reader.lines=async()=>[{lineNumber:2,alias:'Wrong line'}];
  await assert.rejects(()=>runRecoveryAction({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader}),e=>e.code==='phonism-line-not-ready');
  assert.equal(ph.state.rebootAttempts,0);
});

test('unknown Phonism read is not proof that a removed line is absent',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  lease.temporaryLine2=null;lease.recovery={rebootAttempted:true};
  await e.LOGS.put('device-lease:'+lease.leaseId,JSON.stringify(lease));
  wx.state.members=[PRIMARY];ph.reader.lines=async()=>{throw new Error('timeout');};
  const result=await verifyLease({env:e,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader});
  assert.equal(result.state,'pending-verification');
});


test('expiry waits for removal, retries safely, and does not reboot again once complete',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  const due=Date.parse(lease.expiresAt)+1;
  ph.reader.lines=async()=>[{lineNumber:2,username:'1806',alias:'Ryan Dea'}];
  let results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due});
  assert.equal(results[0].status,'restore-reboot-pending');
  assert.equal(ph.state.rebootAttempts,0);
  assert.equal(wx.state.members.some(m=>m.port===2),false);
  const old=JSON.parse(await e.LOGS.get('device-lease:'+lease.leaseId));
  assert.equal(old.recovery.cleanupSyncPending,true);
  await verifyLease({env:e,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader});
  assert.equal(JSON.parse(await e.LOGS.get('device-lease:'+lease.leaseId)).status,'restore-reboot-pending');
  ph.reader.lines=async()=>{throw new Error('unavailable');};
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due+300000});
  assert.equal(ph.state.rebootAttempts,0);
  ph.reader.lines=async()=>[];
  results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due+600000});
  assert.equal(results[0].status,'restored');
  assert.equal(ph.state.rebootAttempts,1);
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due+900000});
  assert.equal(ph.state.rebootAttempts,1);
});

test('a newer assignment supersedes delayed cleanup without an old restart or write',async()=>{
  const {e,wx,ph,lease}=await pendingFixture();
  const due=Date.parse(lease.expiresAt)+1;
  ph.reader.lines=async()=>[{lineNumber:2,username:'1806'}];
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due});
  wx.state.members=composeMembers([PRIMARY],{...TARGET,id:'new-1128',extension:'1128'});
  const writes=wx.state.puts.length;
  const results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due+300000});
  assert.equal(results[0].status,'superseded');
  assert.equal(wx.state.members[1].id,'new-1128');
  assert.equal(wx.state.puts.length,writes);assert.equal(ph.state.rebootAttempts,0);
});

test('365 day assignment retains exact expiry and restores at that time',async()=>{
  const e=env(),wx=webexFixture(),ph=phonismFixture();
  const preview=await createWritePreview({env:e,session:SESSION,device:DEVICE,location:LOCATION,currentMembers:[PRIMARY],targetMember:TARGET,durationMinutes:525600,reason:'',phonismContext:{phoneId:'313135',tenantId:'123',companyId:'40'}});
  const {lease}=await applyWritePreview({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,mutationId:preview.mutationId,phonismReader:ph.reader});
  const due=Date.parse(lease.expiresAt);
  assert.equal(due-Date.parse(lease.startsAt),365*86400000);
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due-1});
  assert.equal(wx.state.members[1].id,TARGET.id);
  ph.reader.lines=async()=>[];
  const results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:due});
  assert.equal(results[0].status,'restored');assert.equal(wx.state.members.length,1);
});

test('scheduler respects active handset ownership then takes over after its deadline',async()=>{
 const {e,wx,ph,lease}=await pendingFixture();const now=Date.parse(lease.startsAt)+15000;
 lease.recovery.initialSyncCheckCompletedAt=new Date(now).toISOString();lease.recovery.phonePollUntil=new Date(now+90000).toISOString();
 await e.LOGS.put('device-lease:'+lease.leaseId,JSON.stringify(lease));
 await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now});assert.equal(ph.state.rebootAttempts,0);
 await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:now+90001});assert.equal(ph.state.rebootAttempts,1);
});
test('completed initial check avoids the old thirty-second scheduler skip',async()=>{
 const {e,wx,ph,lease}=await pendingFixture();lease.recovery.initialSyncCheckCompletedAt=new Date().toISOString();
 await e.LOGS.put('device-lease:'+lease.leaseId,JSON.stringify(lease));
 await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+15000});assert.equal(ph.state.rebootAttempts,1);
});

async function deviceFirstPending(){
 const f=await pendingFixture();
 f.lease.recovery.syncStrategy='device-first';
 f.lease.recovery.initialSyncCheckCompletedAt=f.lease.startsAt;
 await f.e.LOGS.put('device-lease:'+f.lease.leaseId,JSON.stringify(f.lease));
 f.ph.calls.length=0;f.ph.reader.lines=async()=>[];
 return f;
}
test('device-first queues broader sync once after fifteen seconds and still verifies before reboot',async()=>{
 const {e,wx,ph,lease}=await deviceFirstPending(),start=Date.parse(lease.startsAt);
 const run=now=>sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now});
 await run(start+14000);assert.equal(ph.calls.length,0);
 await run(start+15000);
 assert.equal(ph.calls.length,1);assert.deepEqual(ph.calls[0].body.assetTypes,['People','Workspace','Device']);
 assert.equal(ph.calls[0].body.tenantId,lease.phonismTenantId);
 assert.equal(ph.calls[0].body.singleAttempt,true);assert.equal(ph.calls[0].body.timeoutMs,3000);
 assert.equal(ph.state.rebootAttempts,0);
 await run(start+55000);assert.equal(ph.calls.length,1);
 ph.reader.lines=async()=>[{lineNumber:2,username:'1806'}];
 await run(start+60000);assert.equal(ph.state.rebootAttempts,1);
});
test('ambiguous broader sync failure stays claimed and is not resubmitted every refresh',async()=>{
 const {e,wx,ph,lease}=await deviceFirstPending();let calls=0;
 ph.reader.syncHierarchyIntegration=async()=>{calls++;throw Object.assign(new Error('timeout'),{code:'phonism-write-failed',providerFailure:'timeout'});};
 for(const age of [15000,50000,60000])await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+age});
 assert.equal(calls,1);assert.equal(ph.state.rebootAttempts,0);
 const saved=JSON.parse(await e.LOGS.get('device-lease:'+lease.leaseId));
 assert.ok(saved.recovery.fullSyncFallbackAttemptedAt);assert.equal(saved.recovery.syncPending,true);
 assert.equal(saved.recovery.fullSyncFallbackError,'phonism-write-failed');
});
test('changed assignment and unreadable providers never dispatch broader sync',async()=>{
 for(const failure of ['changed','unreadable']){
  const {e,wx,ph,lease}=await deviceFirstPending();
  if(failure==='changed')wx.state.members=composeMembers([PRIMARY],{...TARGET,id:'new-owner'});
  else ph.reader.lines=async()=>{throw Error('network');};
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+60000});
  assert.equal(ph.calls.length,0);assert.equal(ph.state.rebootAttempts,0);
 }
});
test('legacy pending jobs and timed-out device-first jobs do not enqueue a new full sync',async()=>{
 for(const legacy of [true,false]){
  const {e,wx,ph,lease}=await deviceFirstPending();
  if(legacy){delete lease.recovery.syncStrategy;await e.LOGS.put('device-lease:'+lease.leaseId,JSON.stringify(lease));}
  await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:Date.parse(lease.startsAt)+(legacy?60000:600000)});
  assert.equal(ph.calls.length,0);assert.equal(ph.state.rebootAttempts,0);
 }
});


test('deferred sign-out touches only its lease, preserves expiry and hands off automatically',async()=>{
 const {e,wx,ph,lease}=await pendingFixture();
 const now=Date.now(),expiry=Date.parse(lease.expiresAt);
 e.LOGS.list=async()=>{throw Error('must not scan fleet');};
 const first=await endTemporaryLease({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader,now,deferWork:true});
 assert.equal(first.result.status,'signout-requested');assert.equal(ph.state.rebootAttempts,0);assert.equal(Date.parse(first.lease.expiresAt),Math.min(now,expiry));
 ph.reader.lines=async()=>[];
 const results=await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,onlyLeaseId:lease.leaseId,now:now+1});
 assert.equal(results[0].status,'restored');assert.equal(ph.state.rebootAttempts,1);
 assert.deepEqual(ph.calls.findLast(c=>c.type==='sync').body.assetTypes,['Device']);
});


test('sign-out waits for confirmed removal and uses one broader fallback after fifteen seconds',async()=>{
 const {e,wx,ph,lease}=await pendingFixture(),now=Date.now();ph.calls.length=0;
 await endTemporaryLease({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader,now,deferWork:true});
 const run=age=>sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,onlyLeaseId:lease.leaseId,now:now+age});
 await run(1);assert.equal(ph.state.rebootAttempts,0);
 await run(14000);assert.equal(ph.calls.filter(c=>c.type==='sync').length,1);
 await run(15001);assert.equal(ph.calls.filter(c=>c.type==='sync').length,2);
 await run(20000);assert.equal(ph.calls.filter(c=>c.type==='sync').length,2);assert.equal(ph.state.rebootAttempts,0);
 ph.reader.lines=async()=>[];await run(25000);assert.equal(ph.state.rebootAttempts,1);
 await run(30000);assert.equal(ph.state.rebootAttempts,1);assert.equal(wx.state.puts.length,2);
});
test('scheduled cleanup yields to phone checks then resumes automatically after handoff',async()=>{
 const {e,wx,ph,lease}=await pendingFixture(),now=Date.now();
 await endTemporaryLease({env:e,request:request(),session:SESSION,webexFetch:wx.fetch,orgId:ORG,leaseId:lease.leaseId,phonismReader:ph.reader,now,deferWork:true});
 ph.reader.lines=async()=>[];
 await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:now+10000});assert.equal(ph.state.rebootAttempts,0);
 await sweepExpiredLeases({env:e,webexFetch:wx.fetch,orgId:ORG,phonismReader:ph.reader,now:now+300001});assert.equal(ph.state.rebootAttempts,1);
});
