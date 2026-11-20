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

test('lease scan follows all pages beyond 1000 records, including empty pages',async()=>{
 const records=Array.from({length:1001},(_,i)=>({leaseId:`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12,'0')}`,status:'active',expiresAt:'2030-01-01T00:00:00Z'}));
 const pages=[];
 const env={LOGS:{
  async get(key){return records.find(x=>key==='device-lease:'+x.leaseId)??null;},
  async list({cursor,limit}){
   pages.push(cursor);assert.equal(limit,1000);
   if(!cursor)return {keys:records.slice(0,1000).map(x=>({name:'device-lease:'+x.leaseId})),list_complete:false,cursor:'empty'};
   if(cursor==='empty')return {keys:[],list_complete:false,cursor:'last'};
   return {keys:[{name:'device-lease:'+records[1000].leaseId}],list_complete:true};
  }
 }};
 assert.equal((await listLeases(env,{limit:1000})).length,1001);
 assert.deepEqual(pages,[undefined,'empty','last']);
});

test('incomplete lease pagination fails closed',async()=>{
 for(const cursor of [undefined,'same']){
  const env={LOGS:{async list(){return {keys:[],list_complete:false,cursor};}}};
  await assert.rejects(()=>listLeases(env),error=>error.code==='device-lease-list-incomplete');
 }
});
