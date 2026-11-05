import test from 'node:test';import assert from 'node:assert/strict';
import {planAddressBook,listEntries,syncAddressBook,ADDRESS_BOOK_ID} from '../../directory-sync/address-book.mjs';
import {DirectoryStore} from '../../directory-sync/store.mjs';
const id='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-2222-222222222222';
const contact={webexDirectoryId:'person-1',name:'Test Person',phone:'15155551234',extension:'1234'};
test('updates unique legacy name even if extension changed; preserves unrelated manual entries',()=>{
 const p=planAddressBook([contact],[{id,name:'Test Person',number:'4321',version:2},{id:'manual',name:'External Vendor',number:'5555'}]);
 assert.equal(p.actions.length,1);assert.equal(p.actions[0].item.id,id);assert.equal(p.actions[0].item.number,'1234');assert.equal(p.preserved,1);
});
test('stable identity supports renames, protects manual edits, and repeats without writes',()=>{
 const managed={'person-1':{id,name:'Old Name',number:'1234'}};
 assert.equal(planAddressBook([contact],[{id,name:'Old Name',number:'1234'}],managed).actions[0].item.name,'Test Person');
 assert.equal(planAddressBook([contact],[{id,name:'Manual Edit',number:'1234'}],managed).conflicts.length,1);
 const e={id,name:contact.name,number:'1234'};
 assert.equal(planAddressBook([contact],[e],{'person-1':e}).actions.length,0);
});
test('duplicate names, invalid numbers and local-only contacts never cause guessed updates',()=>{
 const p=planAddressBook([contact,{...contact,webexDirectoryId:'other'}, {...contact,webexDirectoryId:'bad',name:'Invalid',phone:'123',extension:'123'}, {name:'Manual',phone:'15155551234'}],[]);
 assert.equal(p.actions.length,0);assert.equal(p.conflicts.length,2);assert.equal(p.skipped.length,1);
});
test('CEG Address Book always uses exactly four-digit internal extensions',()=>{
 assert.equal(planAddressBook([{...contact,phone:''}],[]).actions[0].item.number,'1234');
 assert.equal(planAddressBook([{...contact,phone:'442079460000'}],[]).actions[0].item.number,'1234');
 assert.equal(planAddressBook([{...contact,extension:'0042',phone:'15155551234'}],[]).actions[0].item.number,'0042');
 for(const extension of ['','100','12345','+1234','12-34','abcd']){
   const result=planAddressBook([{...contact,extension}],[]);
   assert.equal(result.actions.length,0,extension);
   assert.equal(result.skipped.length,1,extension);
 }
});
test('pagination requires complete stable pages and distinct IDs',async()=>{
 const page=(data,p,total=2)=>({data,meta:{page:p,totalPages:2,totalRecords:total}});
 let i=0;assert.equal((await listEntries(async()=>page([{id:String(i),name:'N',number:'1'}],i++),'base')).length,2);
 await assert.rejects(listEntries(async()=>page([{id:'same',name:'N',number:'1'}],i++%2),'base'));
 await assert.rejects(listEntries(async()=>({data:[],meta:{page:0,totalPages:1,totalRecords:2}}),'base'));
});
function harness(){
 const data=new Map([['legacy-cleanup-20261015',{}],['directory-state',{contacts:[contact],revision:1,sync:{state:'ready'}}]]);
 const store=new DirectoryStore({storage:{get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))},blockConcurrencyWhile:fn=>fn()},{DIRECTORY_KV:{put:async()=>{}}});
 const call=async(path,body={})=>{const r=await store.fetch(new Request('https://internal/directory/'+path,{method:'POST',body:JSON.stringify(body)}));const p=await r.json();if(!r.ok)throw Error(p.error);return p;};
 return {data,call};
}
test('lease prevents overlap, fences stale writers and retains successful status across saves',async()=>{
 const h=harness(),a=await h.call('address-book/begin');assert.equal(a.acquired,true);
 assert.equal((await h.call('address-book/begin')).acquired,false);
 await assert.rejects(h.call('address-book/finish',{token:'wrong',status:{state:'ready'},managed:{}}));
 await h.call('address-book/finish',{token:a.token,status:{state:'ready',completedAt:100},managed:{}});
 await h.call('save',{contacts:[{...contact,notes:'edit'}],revision:1});
 assert.equal(h.data.get('directory-state').addressBookSync.completedAt,100);
});
test('bulk partial failures are recorded independently of directory success and successes checkpointed',async()=>{
 const h=harness();
 const fetch=async(env,url,options={})=>{
  if(url.includes('/v3/'))return Response.json({id:ADDRESS_BOOK_ID,name:'CEG Address Book'});
  if(url.includes('/v2/'))return Response.json({data:[],meta:{page:0,totalPages:0,totalRecords:0}});
  return Response.json({items:[{itemIdentifier:0,status:403}]},{status:207});
 };
 const result=await syncAddressBook({WEBEX_ORG_ID:org,WEBEX_AUTH_KV:{get:async()=>null}},fetch,h.call);
 assert.equal(result.state,'error');assert.equal(h.data.get('directory-state').sync.state,'ready');
 assert.equal(h.data.get('address-book-control').token,null);
});
test('successful create is read back and repeat sync has no bulk writes',async()=>{
 const h=harness();let entries=[],writes=0;
 const fetch=async(env,url,options={})=>{
  if(url.includes('/v3/'))return Response.json({id:ADDRESS_BOOK_ID,name:'CEG Address Book'});
  if(url.includes('/v2/'))return Response.json({data:entries,meta:{page:0,totalPages:entries.length?1:0,totalRecords:entries.length}});
  writes++;const item=JSON.parse(options.body).items[0].item;assert.equal(item.organizationId,org);
  entries=[{...item,id}];return Response.json({items:[{itemIdentifier:0,status:201,href:'/entry/'+id}]},{status:207});
 };
 const env={WEBEX_ORG_ID:org,WEBEX_AUTH_KV:{get:async()=>null}};
 assert.equal((await syncAddressBook(env,fetch,h.call)).state,'ready');
 assert.equal((await syncAddressBook(env,fetch,h.call)).state,'ready');assert.equal(writes,1);
});

test('E.164 book entry is migrated to internal extension without touching unrelated entries',()=>{
 const existing={id,name:contact.name,number:'+15155551234',version:7};
 const other={id:'manual-entry',name:'Unmanaged Contact',number:'+15155559000'};
 const managed={'person-1':{id,name:contact.name,number:'+15155551234'}};
 const p=planAddressBook([contact],[existing,other],managed);
 assert.equal(p.actions.length,1);
 assert.equal(p.actions[0].kind,'updated');
 assert.equal(p.actions[0].item.id,id);
 assert.equal(p.actions[0].item.version,7);
 assert.equal(p.actions[0].item.number,'1234');
 assert.equal(p.preserved,1);
 assert.equal(planAddressBook([contact],[{...existing,number:'1234'},other],{'person-1':{id,name:contact.name,number:'1234'}}).actions.length,0);
});
test('missing extension does not erase existing book number or guess from E164',()=>{
 const p=planAddressBook([{...contact,extension:''}],[{id,name:contact.name,number:'+15155551234'}],{'person-1':{id,name:contact.name,number:'+15155551234'}});
 assert.equal(p.actions.length,0);
 assert.deepEqual(p.skipped,['person-1']);
});

test('source-specific CEG aliases resolve the four approved duplicate identities',()=>{
 const sources=[
  ['Y2lzY29zcGFyazovL3VzL1BFT1BMRS8wNDExZjE2NS1lNDMzLTQ2NmUtOWRkNy1hNzQzZjhkZGZkNmM','Ames Duff Drive Up','1141','Ames Duff Drive Up - User'],
  ['Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1BMQUNFLzE3Y2RiYWJkLTE2MjQtNDk1YS1hNTMxLWQyMjg0YjAyOWRhYQ==','Ames Duff Drive Up','4014','Ames Duff Drive Up - Workspace'],
  ['Y2lzY29zcGFyazovL3VzL1BFT1BMRS9jNmYzNTk0Ny00YjAzLTQ2OTItOGMxMC1mZmE5ZDQyOTJjNTc','Kelsey Gribbins','1703','Kelsey Gribbins - User'],
  ['service:VIRTUAL_LINE:Y2lzY29zcGFyazovL3VzL1ZJUlRVQUxfTElORS8xMTg1ZWRiMS1iOWZmLTQxODUtOTBiOC0wZDRiMjQxMGI0OWU:15155006243','Kelsey Gribbins','6243','Kelsey Gribbins - Virtual Line']
 ];
 const contacts=sources.map(([webexDirectoryId,name,extension])=>({webexDirectoryId,name,extension,phone:'+15155559999'}));
 const existing={id,version:2,name:'Kelsey Gribbins',number:'6243'};
 const manual={id:'manual',name:'Unrelated Manual Contact',number:'1111'};
 const plan=planAddressBook(contacts,[existing,manual],{});
 assert.equal(plan.conflicts.length,0);
 assert.equal(plan.skipped.length,0);
 assert.equal(plan.actions.length,4);
 for(const [sourceId,,ext,alias] of sources)assert.deepEqual(plan.actions.find(x=>x.sourceId===sourceId)?.item?.number,ext);
 assert.deepEqual(new Set(plan.actions.map(x=>x.item.name)),new Set(sources.map(x=>x[3])));
 const adopted=plan.actions.find(x=>x.sourceId===sources[3][0]);
 assert.equal(adopted.kind,'updated');
 assert.equal(adopted.item.id,id);
 assert.equal(adopted.item.version,2);
 assert.equal(plan.preserved,1);
 const after=plan.actions.map((a,i)=>({...a.item,id:a.item.id||'generated-'+i,version:3}));
 const managed=Object.fromEntries(plan.actions.map((a,i)=>[a.sourceId,{id:after[i].id,name:a.item.name,number:a.item.number}]));
 assert.equal(planAddressBook(contacts,[...after,manual],managed).actions.length,0);
});
test('two no-extension virtual lines are excluded without using their E164 numbers',()=>{
 const excludedIds=[
  'service:VIRTUAL_LINE:Y2lzY29zcGFyazovL3VzL1ZJUlRVQUxfTElORS9iNWRjMDlhOC0zNWI5LTQzYTUtOTAyNC02NTUwYzdhNWRjNDA:15159564220',
  'service:VIRTUAL_LINE:Y2lzY29zcGFyazovL3VzL1ZJUlRVQUxfTElORS85Y2UyMzg3YS0zMDhhLTQyZGYtOTRlNC1iYjM2MjQ4MjZiMjA:15159670500'
 ];
 const contacts=excludedIds.map((webexDirectoryId,i)=>({webexDirectoryId,name:i?'Teller Bank':'Operations Account Verify2',phone:'15155550000',extension:''}));
 const p=planAddressBook(contacts,[{id,name:'Manual Contact',number:'5555'}],{});
 assert.equal(p.actions.length,0);
 assert.equal(p.conflicts.length,0);
 assert.equal(p.skipped.length,0);
 assert.deepEqual(p.excluded,excludedIds);
 assert.equal(p.preserved,1);
});
test('legacy Kelsey name with a different number is not adopted',()=>{
 const who='service:VIRTUAL_LINE:Y2lzY29zcGFyazovL3VzL1ZJUlRVQUxfTElORS8xMTg1ZWRiMS1iOWZmLTQxODUtOTBiOC0wZDRiMjQxMGI0OWU:15155006243';
 const p=planAddressBook([{webexDirectoryId:who,name:'Kelsey Gribbins',extension:'6243'}],[{id,name:'Kelsey Gribbins',number:'9999'}],{});
 assert.equal(p.actions.length,1);
 assert.equal(p.actions[0].kind,'added');
 assert.equal(p.actions[0].item.id,undefined);
 assert.equal(p.preserved,1);
});
