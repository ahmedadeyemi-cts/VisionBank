// Optional local workerd/SQLite integration test. No Cloudflare account or network calls.
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';import {mutation,ACTOR,QUEUE} from './fixtures.mjs';
const {Miniflare,convertV4MiniflareOptions}=await import(process.env.MINIFLARE_MODULE||'miniflare');
const persist=fs.mkdtempSync(path.join(os.tmpdir(),'vb-callback-store-test-'));
const options={name:'vb-callback-settings-local-test',resourcePersistencePath:persist,cf:false,modulesRoot:fileURLToPath(new URL('../../',import.meta.url)),modules:['store.mjs','policy.mjs','execution.mjs','native.mjs','selection.mjs'].map(name=>({type:'ESModule',path:fileURLToPath(new URL('../../callback-settings/'+name,import.meta.url)),contents:fs.readFileSync(new URL('../../callback-settings/'+name,import.meta.url),'utf8')})),
  compatibilityDate:'2026-09-28',durableObjects:{STORE:{className:'AbandonedCallbackSettingsV1',useSQLite:true}},durableObjectsPersist:persist};
let mf;
try{
  mf=new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);let ns=await mf.getDurableObjectNamespace('STORE'),stub=ns.get(ns.idFromName('persistence-test'));
  const send=async change=>{const r=await stub.fetch('https://store/settings',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({change,actor:ACTOR,requestId:crypto.randomUUID()})});return {http:r.status,data:await r.json()};};
  const m=mutation({enabled:true,queueId:QUEUE});assert.equal((await send(m)).http,200);
  await mf.dispose();mf=new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(options) : options);ns=await mf.getDurableObjectNamespace('STORE');stub=ns.get(ns.idFromName('persistence-test'));
  const after=await(await stub.fetch('https://store/settings')).json();assert.equal(after.state.settings.enabled,true);assert.equal(after.state.version,1);
  assert.equal(after.state.lastChangedBy.sourceIp,ACTOR.sourceIp);assert.equal(after.processing.ready,false);
  const concurrent=await Promise.all([send(mutation({enabled:true,queueId:QUEUE,delayMinutes:45},1)),send(mutation({enabled:true,queueId:QUEUE,delayMinutes:60},1))]);
  assert.deepEqual(concurrent.map(r=>r.http).sort(),[200,409]);
  assert.equal((await send(mutation({},2))).http,200);
  const history=await(await stub.fetch('https://store/history')).json();assert.equal(history.rows.length,3);assert.equal(history.rows[0].action,'Disabled');
  const disabled=await(await stub.fetch('https://store/settings')).json();assert.equal(disabled.state.settings.enabled,false);
  console.log(JSON.stringify({passed:true,runtime:'local workerd with SQLite Durable Object',checks:['enabled survives runtime restart','source audit survives restart','concurrent edit conflict','settings and three audit records','explicit disable persists','execution stays unconnected'],liveCalls:0}));
}finally{if(mf)await mf.dispose();fs.rmSync(persist,{recursive:true,force:true});}
