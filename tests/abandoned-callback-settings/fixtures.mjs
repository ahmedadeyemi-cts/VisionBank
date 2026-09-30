import {AbandonedCallbackSettingsV1} from '../../callback-settings/store.mjs';
import {createCallbackSettingsHandler} from '../../callback-settings/gateway.mjs';
import {defaults,browserDetails} from '../../callback-settings/policy.mjs';
export class MemoryStorage {
  constructor(){this.data=new Map();this.tail=Promise.resolve();this.failAudit=false;}
  async get(k){return structuredClone(this.data.get(k));}
  async put(k,v){if(this.failAudit&&k.startsWith('audit:'))throw Error('injected storage failure');this.data.set(k,structuredClone(v));}
  async list({prefix='',reverse=false,limit=100,end}={}){let entries=[...this.data].filter(([k])=>k.startsWith(prefix)&&(!end||k<end)).sort(([a],[b])=>a.localeCompare(b));if(reverse)entries.reverse();return new Map(entries.slice(0,limit));}
  async transaction(fn){const previous=this.tail;let release;this.tail=new Promise(r=>release=r);await previous;
    const tx=new MemoryStorage();tx.data=structuredClone(this.data);tx.failAudit=this.failAudit;
    try{const result=await fn(tx);this.data=tx.data;return result;}finally{release();}}
}
export const QUEUE='11111111-1111-4111-8111-111111111111';
export const ACTOR={sourceIp:'198.51.100.12',source:'cloudflare-edge',identityVerified:false,...browserDetails('Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Edg/126.0')};
export const mutation=(settings={},version=0,id=crypto.randomUUID())=>({mutationId:id,expectedVersion:version,settings:{...defaults(),...settings}});
export function fixture({allowed=true,rules=['198.51.100.0/24'],queues=[{id:QUEUE,name:'CEG Voice',channelType:'TELEPHONY'}]}={}){
  const stores=new Map();let reads=0;
  const namespace={idFromName:x=>x,get(name){if(!stores.has(name))stores.set(name,new MemoryStorage());return new AbandonedCallbackSettingsV1({storage:stores.get(name)});}};
  const env={WEBEX_ORG_ID:'test-org',ABANDONED_CALLBACK_SETTINGS:namespace};
  const handler=createCallbackSettingsHandler({checkAccess:async()=>({allowed}),loadIpRules:async()=>rules,getWebexQueueConfiguration:async()=>{reads++;return queues;}});
  const request=async(path='settings',body,extraHeaders={},cf=true)=>{const r=new Request('https://worker.example/api/webex/abandoned-callback/'+path,
    {method:body===undefined?'GET':'POST',headers:{Origin:'https://visionbank-dashboard.onrender.com','CF-Connecting-IP':ACTOR.sourceIp,
      'User-Agent':'Mozilla/5.0 (Windows NT 10.0) Chrome/126.0 Edg/126.0',...(body===undefined?{}:{'Content-Type':'application/json'}),...extraHeaders},...(body===undefined?{}:{body:JSON.stringify(body)})});
    if(cf)Object.defineProperty(r,'cf',{value:{colo:'TEST'}});const response=await handler(r,env,{'Access-Control-Allow-Origin':'https://visionbank-dashboard.onrender.com'});return {http:response.status,data:await response.json(),headers:response.headers};};
  return {namespace,stores,env,handler,request,queueReads:()=>reads};
}
