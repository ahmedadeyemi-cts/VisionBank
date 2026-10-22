import test from 'node:test';
import assert from 'node:assert/strict';
import {putLease,getLease,listLeases} from '../../device-management/lease.mjs';
const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
test('durable completion wins over a stale retry even when the mutable record regresses',async()=>{
 const records=new Map();const env={LOGS:{
  async put(k,v,o={}){records.set(k,{value:v,metadata:o.metadata});},
  async get(k){return records.get(k)?.value??null;},
  async list({prefix}){return{keys:[...records].filter(([k])=>k.startsWith(prefix)).map(([name,r])=>({name,metadata:r.metadata})),list_complete:true};}
 }};
 const pending={leaseId:id,status:'restore-sync-pending',expiresAt:new Date().toISOString(),device:{},location:{}};
 await putLease(env,pending);
 const done={...pending,status:'restored',closedAt:new Date().toISOString()};
 await putLease(env,done);
 // Simulate an already-running writer using an older KV view.
 records.set('device-lease:'+id,{value:JSON.stringify(pending),metadata:{status:pending.status}});
 assert.equal((await getLease(env,id)).status,'restored');
 assert.equal((await listLeases(env))[0].status,'restored');
 await putLease(env,pending);
 assert.equal(JSON.parse(records.get('device-lease:'+id).value).status,'restored');
 assert.ok(records.has('device-lease-closed:'+id));
});
