import test from 'node:test';import assert from 'node:assert/strict';
import {planAddressBook,listEntries,syncAddressBook,ADDRESS_BOOK_ID} from '../../directory-sync/address-book.mjs';
import {DirectoryStore} from '../../directory-sync/store.mjs';
const id='11111111-1111-1111-1111-111111111111',org='22222222-2222-2222-2222-222222222222';
const contact={webexDirectoryId:'person-1',name:'Test Person',phone:'15155551234',extension:'1234'};
test('updates unique legacy name even if extension changed; preserves unrelated manual entries',()=>{
 const p=planAddressBook([contact],[{id,name:'Test Person',number:'4321',version:2},{id:'manual',name:'External Vendor',number:'5555'}]);
 assert.equal(p.actions.length,1);assert.equal(p.actions[0].item.id,id);assert.equal(p.actions[0].item.number,'+15155551234');assert.equal(p.preserved,1);
});
test('stable identity supports renames, protects manual edits, and repeats without writes',()=>{
 const managed={'person-1':{id,name:'Old Name',number:'1234'}};
 assert.equal(planAddressBook([contact],[{id,name:'Old Name',number:'1234'}],managed).actions[0].item.name,'Test Person');
 assert.equal(planAddressBook([contact],[{id,name:'Manual Edit',number:'1234'}],managed).conflicts.length,1);
 const e={id,name:contact.name,number:'+15155551234'};
 assert.equal(planAddressBook([contact],[e],{'person-1':e}).actions.length,0);
});
test('duplicate names, invalid numbers and local-only contacts never cause guessed updates',()=>{
 const p=planAddressBook([contact,{...contact,webexDirectoryId:'other'}, {...contact,webexDirectoryId:'bad',name:'Invalid',phone:'123'}, {name:'Manual',phone:'15155551234'}],[]);
 assert.equal(p.actions.length,0);assert.equal(p.conflicts.length,2);assert.equal(p.skipped.length,1);
});
test('extension-only rows keep extension and international numbers keep country code',()=>{
 assert.equal(planAddressBook([{...contact,phone:''}],[]).actions[0].item.number,'1234');
 assert.equal(planAddressBook([{...contact,phone:'442079460000'}],[]).actions[0].item.number,'+442079460000');
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
