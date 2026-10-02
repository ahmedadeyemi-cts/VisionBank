import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateOperator,createOperatorSession,readOperatorSession,requireOperatorSession,
  buildAuditRecord,writeAuditRecord,listAuditRecords,automatedActor
} from '../../device-management/audit.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
  async list({prefix='',limit=100}={}){
    const keys=[...this.map.entries()].filter(([k])=>k.startsWith(prefix)).slice(0,limit).map(([name,v])=>({name,metadata:v.metadata}));
    return {keys,list_complete:true};
  }
}

function req({ip='198.51.100.12',ua='Test Browser',sessionId=null}={}){
  const headers=new Headers({'CF-Connecting-IP':ip,'User-Agent':ua});
  if(sessionId)headers.set('X-VB-Operator-Session',sessionId);
  return new Request('https://worker.example/api/webex/device-management/test',{headers});
}

test('operator requires a plausible name and work email',()=>{
  assert.deepEqual(validateOperator({name:'Ahmed Adeyemi',email:'AHMED@example.com'}),{name:'Ahmed Adeyemi',email:'ahmed@example.com'});
  assert.throws(()=>validateOperator({name:'A',email:'a@example.com'}),e=>e.code==='operator-name-required');
  assert.throws(()=>validateOperator({name:'Ahmed Adeyemi',email:'not-an-email'}),e=>e.code==='operator-email-invalid');
});

test('operator session is namespaced, expires and captures start source server-side',async()=>{
  const env={SESSIONS:new MemoryKV()};
  const now=Date.parse('2026-10-02T14:00:00Z');
  const session=await createOperatorSession(env,req(),{name:'Ahmed Adeyemi',email:'ahmed@example.com'},{now});
  assert.equal(session.operator.name,'Ahmed Adeyemi');
  assert.equal(session.startedFrom.ip,'198.51.100.12');
  assert.match(session.id,/^[0-9a-f-]{36}$/i);
  assert.ok(env.SESSIONS.map.has('device-operator:'+session.id));
  assert.equal((await readOperatorSession(env,session.id,{now:now+1000})).operator.email,'ahmed@example.com');
  assert.equal(await readOperatorSession(env,session.id,{now:now+12*60*60*1000+1}),null);
});

test('required operator session rejects missing or unknown session IDs',async()=>{
  const env={SESSIONS:new MemoryKV()};
  await assert.rejects(()=>requireOperatorSession(env,req()),e=>e.code==='operator-session-required');
  await assert.rejects(()=>requireOperatorSession(env,req({sessionId:'11111111-1111-4111-8111-111111111111'})),e=>e.code==='operator-session-required');
});

test('audit record captures operator identity and current request IP',async()=>{
  const env={SESSIONS:new MemoryKV(),LOGS:new MemoryKV()};
  const session=await createOperatorSession(env,req({ip:'198.51.100.10'}),{name:'Ahmed Adeyemi',email:'ahmed@example.com'});
  const record=buildAuditRecord({
    eventType:'temporary-line-change',action:'save-sync',
    request:req({ip:'203.0.113.25',ua:'Safari Test'}),session,
    device:{id:'dev-1',name:'Yealink T57W',mac:'00:11:22:33:44:55'},
    location:{id:'loc-1',name:'CLIVE'},
    change:{beforeLine2:null,afterLine2:{extension:'4102'},durationMinutes:120},
    webexStatus:'saved',phonismStatus:'synced',result:'completed',reason:'Temporary seat move'
  });
  assert.equal(record.actor.name,'Ahmed Adeyemi');
  assert.equal(record.sourceIp,'203.0.113.25');
  assert.equal(record.device.name,'Yealink T57W');
  await writeAuditRecord(env,record);
  const listed=await listAuditRecords(env,{limit:10});
  assert.equal(listed.rows.length,1);
  assert.equal(listed.rows[0].operatorName,'Ahmed Adeyemi');
  assert.equal(listed.rows[0].sourceIp,'203.0.113.25');
  assert.equal(listed.rows[0].result,'completed');
});

test('automated audit actor links back to the original operator',()=>{
  const system=automatedActor({name:'Ahmed Adeyemi',email:'ahmed@example.com'});
  const record=buildAuditRecord({
    eventType:'temporary-line-expiry',action:'auto-restore',
    systemActor:system,device:{id:'dev-1',name:'Yealink T57W'},result:'completed'
  });
  assert.equal(record.actor.type,'system');
  assert.equal(record.actor.name,'VisionBank Device Manager – Automated');
  assert.deepEqual(record.actor.originalOperator,{name:'Ahmed Adeyemi',email:'ahmed@example.com'});
  assert.equal(record.sourceIp,'system');
});
