// Actual local workerd alarms and SQLite; outbound traffic is completely mocked.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {approval,cid} from './native-fixtures.mjs';
import {mutation,ACTOR,QUEUE} from './fixtures.mjs';import {defaults} from '../../callback-settings/policy.mjs';
import {nextWindow} from '../../callback-settings/selection.mjs';
const {Miniflare,convertV4MiniflareOptions}=await import(process.env.MINIFLARE_MODULE||'miniflare');
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'vb-native-callback-test-')),orgId='33333333-3333-4333-8333-333333333333';
const entry=`
import {AbandonedCallbackSettingsV1} from './callback-settings/store.mjs';
import {createNativeClient} from './callback-settings/native.mjs';
export class TestCallbackStore extends AbandonedCallbackSettingsV1 {
 constructor(ctx,env){super(ctx,env);this.execution.client=createNativeClient({orgId:env.WEBEX_ORG_ID,getToken:async()=>'synthetic-test-token',fetchImpl:async(url,options)=>{
 let realRequest;try{realRequest=new Request(url,options);}catch(error){console.error('REAL_REQUEST_OPTIONS',error.message);throw error;} // Synthetic request, no network.
 const u=new URL(realRequest.url),orgId=env.WEBEX_ORG_ID;
 if(options.method==='POST'&&u.pathname==='/search')return Response.json({data:{taskDetails:{tasks:[],pageInfo:{hasNextPage:false,endCursor:null}}}});
 const ep={id:'22222222-2222-4222-8222-222222222222',name:'Pilot_Callback_EP',active:true,entryPointType:'OUTBOUND',channelType:'TELEPHONY',callbackEnabled:true};
 if(options.method==='GET'&&u.pathname.endsWith('/entry-point'))return Response.json({meta:{orgid:orgId,page:0,totalPages:1,totalRecords:1},data:[ep]});
 if(options.method==='GET'&&u.pathname.endsWith('/organization-setting'))return Response.json([{webCallBackEnabled:true,maximumCallbackAttempts:3}]);
 if(options.method==='GET'&&u.pathname.includes('/contact-service-queue/'))return Response.json({id:u.pathname.split('/').at(-1),active:true,channelType:'TELEPHONY'});
 if(options.method==='GET'&&u.pathname.endsWith('/scheduled-callback')){const rows=await ctx.storage.get('mock:native')||[];return Response.json({meta:{page:0,totalPages:rows.length?1:0},data:rows});}
 if(options.method==='GET'&&u.pathname.includes('/scheduled-callback/')){const r=(await ctx.storage.get('mock:native')||[]).find(r=>u.pathname.endsWith('/'+r.id));return r?Response.json(r):Response.json({error:'not-found'},{status:404});}
 if(options.method==='PUT'&&u.pathname.includes('/scheduled-callback/')){const p=JSON.parse(options.body),rows=await ctx.storage.get('mock:native')||[],i=rows.findIndex(r=>r.id===p.id);if(i<0)return Response.json({error:'not-found'},{status:404});rows[i]={...p,orgId};await ctx.storage.put('mock:native',rows);await ctx.storage.put('mock:puts',(await ctx.storage.get('mock:puts')||0)+1);return Response.json(rows[i]);}
 if(options.method==='DELETE'&&u.pathname.includes('/scheduled-callback/')){const id=u.pathname.split('/').at(-1),rows=await ctx.storage.get('mock:native')||[];await ctx.storage.put('mock:native',rows.filter(r=>r.id!==id));await ctx.storage.put('mock:deletes',(await ctx.storage.get('mock:deletes')||0)+1);return new Response(null,{status:204});}
 if(options.method==='POST'&&u.pathname.endsWith('/scheduled-callback')){const rows=await ctx.storage.get('mock:native')||[],r={...JSON.parse(options.body),id:crypto.randomUUID(),orgId};rows.push(r);await ctx.storage.put('mock:native',rows);await ctx.storage.put('mock:posts',(await ctx.storage.get('mock:posts')||0)+1);return Response.json(r,{status:201});}
 throw Error('Unexpected mocked native request; outbound network is never used.');}});}
 async fetch(request){if(new URL(request.url).pathname==='/test-post-count')return Response.json({posts:await this.storage.get('mock:posts')||0,puts:await this.storage.get('mock:puts')||0,deletes:await this.storage.get('mock:deletes')||0});return super.fetch(request);}
}
export default {fetch(){return new Response('Test only',{status:404});}};
`;
const options={name:'vb-callback-native-local-test',resourcePersistencePath:persist,cf:false,
 modulesRoot:fileURLToPath(new URL('../../',import.meta.url)),modules:[{type:'ESModule',path:fileURLToPath(new URL('../../test-native-runtime-entrypoint.mjs',import.meta.url)),contents:entry},...['store.mjs','policy.mjs','selection.mjs','native.mjs','execution.mjs','reservations.mjs','management.mjs','outcomes.mjs','automation.mjs','work-index.mjs','flow-policy.mjs','plans.mjs','readiness.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../../callback-settings/'+name,import.meta.url)),contents:fs.readFileSync(new URL('../../callback-settings/'+name,import.meta.url),'utf8')}))],
 compatibilityDate:'2026-09-28',durableObjects:{STORE:{className:'TestCallbackStore',useSQLite:true}},durableObjectsPersist:persist,
 bindings:{WEBEX_ORG_ID:orgId,CALLBACK_EXECUTION_CONFIG:JSON.stringify(approval())}};
let mf;const start=async()=>{mf=new Miniflare(convertV4MiniflareOptions?convertV4MiniflareOptions(options):options);
 const ns=await mf.getDurableObjectNamespace('STORE');return ns.get(ns.idFromName('test-native'));};
const send=async(stub,route,body)=>{const r=await stub.fetch('https://callback-settings.internal/'+route,{method:body?'POST':'GET',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});return {status:r.status,data:await r.json()};};
try{
 let stub=await start();let result=await send(stub,'settings',{change:mutation({enabled:true,queueId:QUEUE,callbackEntryPointId:approval().callbackEntryPointId}),actor:ACTOR,requestId:crypto.randomUUID()});assert.equal(result.status,200);assert.equal(result.data.processing.ready,true);
 const window=nextWindow({...defaults(),enabled:true,queueId:QUEUE},Date.now()+120000),batch={mutationId:crypto.randomUUID(),expectedVersion:1,preview:{scope:'selected',queue:{id:QUEUE},window,rows:[{contactId:cid(1),number:'+12025550123',disposition:'candidate'}]},actor:ACTOR,requestId:crypto.randomUUID()};
 result=await send(stub,'schedule',batch);assert.equal(result.status,202,JSON.stringify(result.data));
 for(let i=0;i<50;i++){result=await send(stub,'records?ids='+cid(1));if(result.data.rows[0]?.status==='scheduled')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.data.rows[0].status,'scheduled',JSON.stringify(result.data));assert.equal((await send(stub,'test-post-count')).data.posts,1);assert.equal(result.data.rows[0].policy.totalAttempts,3);
 const scheduleId=result.data.rows[0].scheduleId;await mf.dispose();mf=null;stub=await start();result=await send(stub,'schedule',batch);
 assert.equal(result.status,202);assert.equal(result.data.job.records[0].scheduleId,scheduleId);assert.equal((await send(stub,'test-post-count')).data.posts,1);
 const managementId=crypto.randomUUID(),record=result.data.job.records[0],window2=nextWindow({...defaults(),enabled:true,queueId:QUEUE},window.startEpoch+3600000);
 result=await send(stub,'manage',{change:{action:'reschedule',contactId:cid(1),expectedRevision:record.revision,mutationId:managementId,expectedVersion:1,date:window2.date,startTime:window2.startTime},actor:ACTOR,requestId:crypto.randomUUID()});assert.equal(result.status,202,JSON.stringify(result.data));
 for(let i=0;i<80;i++){result=await send(stub,'management?id='+managementId);if(result.data.operation?.status==='completed')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.data.operation.status,'completed',JSON.stringify(result.data));result=await send(stub,'records?ids='+cid(1));assert.equal(result.data.rows[0].scheduleId,scheduleId);assert.equal(result.data.rows[0].window.startTime,window2.startTime);
 const changed=result.data.rows[0];await send(stub,'settings',{change:mutation({enabled:false,queueId:QUEUE,callbackEntryPointId:approval().callbackEntryPointId},1),actor:ACTOR,requestId:crypto.randomUUID()});
 const cancelId=crypto.randomUUID();result=await send(stub,'manage',{change:{action:'cancel',contactId:cid(1),expectedRevision:changed.revision,mutationId:cancelId},actor:ACTOR,requestId:crypto.randomUUID()});assert.equal(result.status,202);
 for(let i=0;i<80;i++){result=await send(stub,'management?id='+cancelId);if(result.data.operation?.status==='completed')break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(result.data.operation.status,'completed',JSON.stringify(result.data));assert.deepEqual((await send(stub,'test-post-count')).data,{posts:1,puts:1,deletes:1});
 await mf.dispose();mf=null;stub=await start();result=await send(stub,'records?ids='+cid(1));assert.equal(result.data.rows[0].status,'canceled');
 console.log(JSON.stringify({passed:true,runtime:'local workerd + SQLite + automatic durable alarm',checks:['native readiness in isolated runtime','atomic job and alarm commit','alarm submits exactly one native schedule','requested three-attempt policy retained','confirmed schedule survives runtime restart','replayed submission does not duplicate native schedule','reschedule uses same ID in real Worker runtime','durable alarm confirms update exactly once','cancellation works with master Off','empty 204 deletion response supported by runtime','canceled result survives process restart'],mockNativePosts:(await send(stub,'test-post-count')).data.posts,liveCalls:0}));
}finally{if(mf)await mf.dispose();fs.rmSync(persist,{recursive:true,force:true});}
