import test from 'node:test';
import assert from 'node:assert/strict';
import {sweepExpiredLeases} from '../../device-management/write.mjs';
import {putLease} from '../../device-management/lease.mjs';
import {listIssueRecords} from '../../device-management/audit.mjs';

const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture({line=3,status='restore-sync-pending',model='T54W'}={}){
 const map=new Map();
 const env={DEVICE_WRITE_SCOPE:'organization',LOGS:{
  async put(k,v,o={}){map.set(k,{value:v,metadata:o.metadata,options:o});},
  async get(k){return map.get(k)?.value??null;},
  async list({prefix=''}){return {keys:[...map].filter(([k])=>k.startsWith(prefix)).map(([name,v])=>({name,metadata:v.metadata})),list_complete:true};}
 }};
 const now=Date.now();
 const lease={leaseId:id,status,startsAt:new Date(now-90000000).toISOString(),expiresAt:new Date(now-86400000).toISOString(),lineNumber:line,
  device:{id:'device',name:model,mac:'00:11:22:33:44:55'},location:{id:'location',name:'DUFF'},operator:{name:'Test'},
  temporaryLine2:{memberId:'temp',extension:'1133'},baselineLine2:null,baselineMember:null,
  phonismPhoneId:'phone',phonismCompanyId:'company',phonismTenantId:'tenant',phonismDomainId:'domain',recovery:{}};
 await putLease(env,lease);
 const state={members:[{id:'owner',port:1,extension:'1124',primaryOwner:true},{id:'manual',port:2,extension:'1128'},...(line===4?[{id:'manual3',port:3,extension:'1129'}]:[])],lines:[],syncs:0,reboots:0,puts:0};
 if(status==='active')state.members.push({id:'temp',port:line,extension:'1133'});
 const webexFetch=async(_e,_u,o)=>{if(o.method==='PUT'){state.puts++;state.members=JSON.parse(o.body).members;return new Response(null,{status:204});}return Response.json({members:state.members});};
 const reader={async lines(){return state.lines;},async syncHierarchyIntegration(){state.syncs++;},async tr069Action(){state.reboots++;},async phone(){return {lastProvision:null};}};
 const run=(age=0)=>sweepExpiredLeases({env,webexFetch,orgId:'org',phonismReader:reader,now:now+age});
 const stored=async()=>JSON.parse(await env.LOGS.get('device-lease:'+id));
 return {env,state,reader,run,stored,map,lease,now};
}

for(const model of ['T53','T54W','T57W'])for(const line of [3,4])test(`${model}: expiry preserves occupied earlier lines and cleans only line ${line}`,async()=>{
 const f=await fixture({model,line,status:'active'});const before=structuredClone(f.state.members.filter(m=>m.port!==line));
 assert.equal((await f.run())[0].status,'restored');
 assert.deepEqual(f.state.members.map(m=>[m.port,m.id]),before.map(m=>[m.port,m.id]));
 assert.equal(f.state.puts,1);assert.equal(f.state.syncs,0);assert.equal(f.state.reboots,1);
 await f.run(60000);assert.equal(f.state.reboots,1);
});
test('stale cleanup completes even when sync endpoint is unavailable, if configuration already matches',async()=>{
 const f=await fixture();f.reader.syncHierarchyIntegration=async()=>{throw Error('must not call');};
 assert.equal((await f.run())[0].status,'restored');assert.equal(f.state.puts,0);
});
test('failed sync records actionable issue then recovers when provider catches up',async()=>{
 const f=await fixture();f.state.lines=[{lineNumber:3,username:'1133'}];
 f.reader.syncHierarchyIntegration=async()=>{f.state.syncs++;throw Object.assign(Error('failed'),{code:'phonism-write-failed',upstreamStatus:503,providerFailure:'provider-unavailable'});};
 assert.equal((await f.run())[0].status,'restore-sync-pending');
 const issues=await listIssueRecords(f.env);assert.equal(issues.rows[0].errorCode,'phonism-write-failed');assert.equal(issues.rows[0].lineNumber,3);assert.equal(issues.rows[0].upstreamStatus,503);assert.ok(issues.rows[0].lastRetryAt);
 assert.equal(f.state.reboots,0);f.state.lines=[];
 assert.equal((await f.run(60000))[0].status,'restored');assert.equal(f.state.syncs,1);assert.equal(f.state.reboots,1);
});
test('unavailable line reads never imply successful removal or trigger a reboot',async()=>{
 const f=await fixture();f.reader.lines=async()=>{throw Object.assign(Error('offline'),{code:'phonism-read-unavailable'});};
 await f.run();assert.equal((await f.stored()).status,'restore-sync-pending');assert.equal(f.state.reboots,0);assert.equal(f.state.syncs,0);
 assert.equal((await listIssueRecords(f.env)).rows[0].errorCode,'phonism-read-unavailable');
});
test('unknown restart outcome is not resent and completes after later provisioning evidence',async()=>{
 const f=await fixture();f.reader.tr069Action=async()=>{f.state.reboots++;throw Object.assign(Error('timeout'),{code:'phonism-write-failed',providerFailure:'timeout'});};
 await f.run();await f.run(60000);assert.equal(f.state.reboots,1);assert.equal((await f.stored()).status,'restore-reboot-pending');
 f.reader.phone=async()=>({lastProvision:new Date(f.now+120000).toISOString()});
 assert.equal((await f.run(120001))[0].status,'restored');assert.equal(f.state.reboots,1);
});
test('newer assignment supersedes old cleanup without any write or restart',async()=>{
 const f=await fixture();f.state.members.push({id:'new',port:3,extension:'1234'});
 assert.equal((await f.run())[0].status,'superseded');assert.equal(f.state.reboots,0);assert.equal(f.state.syncs,0);assert.equal(f.state.puts,0);
});
test('unfinished cleanup survives retention window; terminal records retain bounded TTL',async()=>{
 const f=await fixture();assert.equal(f.map.get('device-lease:'+id).options.expirationTtl,undefined);
 await f.run();assert.ok(f.map.get('device-lease:'+id).options.expirationTtl>=3600);
});
test('accepted but stalled cleanup is checked frequently and resynced with backoff',async()=>{
 const f=await fixture();f.state.lines=[{lineNumber:3,username:'1133'}];
 await f.run();assert.equal(f.state.syncs,1);
 await f.run(5000);await f.run(30000);assert.equal(f.state.syncs,1);assert.equal(f.state.reboots,0);
 await f.run(120000);assert.equal(f.state.syncs,2); // One broader fallback.
 await f.run(300001);assert.equal(f.state.syncs,3); // Bounded recovery continues.
 f.state.lines=[];assert.equal((await f.run(360000))[0].status,'restored');
 assert.equal(f.state.syncs,3);assert.equal(f.state.reboots,1);
});
test('explicitly rejected restart retries automatically without rewriting assignments',async()=>{
 const f=await fixture();f.reader.tr069Action=async()=>{f.state.reboots++;if(f.state.reboots===1)throw Object.assign(Error('unavailable'),{code:'phonism-write-failed',providerFailure:'provider-unavailable',upstreamStatus:503});};
 await f.run();await f.run(5000);assert.equal(f.state.reboots,1);
 assert.equal((await f.run(60001))[0].status,'restored');assert.equal(f.state.reboots,2);assert.equal(f.state.puts,0);
});
test('same cleanup read failure remains one issue while changed failures are recorded',async()=>{
 const f=await fixture();let status=404;
 f.reader.lines=async()=>{throw Object.assign(Error('offline'),{code:'phonism-read-unavailable',upstreamStatus:status,providerFailure:status===404?'not-found':'provider-unavailable'});};
 await f.run();await f.run(300001);await f.run(600002);
 assert.equal((await listIssueRecords(f.env)).rows.length,1);
 assert.equal((await f.stored()).recovery.cleanupLastCheckedAt,new Date(f.now+600002).toISOString());
 status=503;await f.run(660000);
 assert.equal((await listIssueRecords(f.env)).rows.length,2);assert.equal(f.state.reboots,0);
});
