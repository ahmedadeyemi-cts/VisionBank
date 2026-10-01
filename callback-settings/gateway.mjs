import {handleFlowPolicy} from './flow-policy.mjs';
import {handlePlanRequest} from './planning-gateway.mjs';
import { SettingsError, UUID, browserDetails, parseMutation } from './policy.mjs';
import { buildPreview, parseSelection } from './selection.mjs';
const ORIGINS = new Set(['https://visionbank-dashboard.onrender.com','https://ahmedadeyemi-cts.github.io']);
const PREFIX = '/api/webex/abandoned-callback/';
async function bounded(operation, ms = 10000) {
  let timer; try { return await Promise.race([operation,new Promise((_,reject)=>{
    timer=setTimeout(()=>reject(new SettingsError('settings-service-timeout',503)),ms);
  })]); } finally { clearTimeout(timer); }
}
function validIp(ip) {
  if (typeof ip !== 'string' || ip.length > 45 || !/^[\da-f:.]+$/i.test(ip)) return false;
  if (ip.includes(':')) { try { return new URL('http://['+ip+']/').hostname.length > 2; } catch { return false; } }
  const parts=ip.split('.'); return parts.length===4 && parts.every(p=>/^\d{1,3}$/.test(p) && Number(p)<=255);
}
export function createCallbackSettingsHandler({checkAccess,loadIpRules,getWebexQueueConfiguration,getAbandonedReport}) {
  return async function handler(request,env,cors={}) {
    if(new URL(request.url).pathname===PREFIX+'flow-policy')return handleFlowPolicy(request,env);
    const headers={...cors,'Cache-Control':'no-store','Content-Type':'application/json','Vary':'Origin'};
    // Negotiate limits explicitly; old tabs must not misread an expanded saved window.
    const requestedSchema=new URL(request.url).searchParams.get('schema');
    const schema=requestedSchema==='4'?4:requestedSchema==='3'?3:2;
    const send=(value,status=200)=>{
      if(value?.state?.settings){
        if(schema<4 && value.state.settings.windowMinutes>240) return new Response(JSON.stringify({success:false,error:'callback-client-update-required',minimumClientSchema:4}),{status:409,headers});
        const settings={...value.state.settings};
        if(schema===2)delete settings.callbackEntryPointId;
        value={...value,state:{...value.state,settings},settingsSchemaVersion:schema};
      }
      return new Response(JSON.stringify(value),{status,headers});
    };
    try {
      const u=new URL(request.url),part=u.pathname.slice(PREFIX.length),origin=request.headers.get('Origin');
      if (!ORIGINS.has(origin)) throw new SettingsError('origin-denied',403);
      if (!['settings','history','preview','schedule','readiness','jobs','records','plans','plan-preview','plan-schedule','register','refresh-record','manage','management','automation-status','flow-token-status','flow-token-generate','flow-token-test'].includes(part) || !['GET','POST'].includes(request.method) ||
          (['history','readiness','jobs','records','register','management','automation-status','flow-token-status'].includes(part) && request.method!=='GET') || (['preview','schedule','plan-preview','plan-schedule','refresh-record','manage','flow-token-generate','flow-token-test'].includes(part) && request.method!=='POST')) throw new SettingsError('method-or-route-not-allowed',405);
      const sourceIp=request.headers.get('CF-Connecting-IPv6') || request.headers.get('CF-Connecting-IP');
      if (!request.cf || request.headers.has('CF-Worker') || !validIp(sourceIp)) throw new SettingsError('source-not-verifiable',403);
      // Reuse normal access policy; no separate login, but an empty IP allowlist is NOT a write grant.
      const access=await bounded(checkAccess(request,env));
      if (access?.allowed!==true) throw new SettingsError('access-denied',403);
      const rules=await bounded(loadIpRules(env));
      if (!Array.isArray(rules) || !rules.some(v=>typeof v==='string' && v.trim())) throw new SettingsError('approved-network-required',403);
      const org=String(env.WEBEX_ORG_ID||'');
      if (!org || !env.ABANDONED_CALLBACK_SETTINGS?.idFromName) throw new SettingsError('callback-storage-not-configured',503);
      const store=env.ABANDONED_CALLBACK_SETTINGS.get(env.ABANDONED_CALLBACK_SETTINGS.idFromName(org+':settings:v1'));
      if(part==='flow-token-status'){
        const r=await bounded(store.fetch(new Request('https://callback-settings.internal/flow-token/status')),8000);return send(await r.json(),r.status);
      }
      if(part==='flow-token-generate'){
        const actor={sourceIp,source:'cloudflare-edge',identityVerified:false,...browserDetails(request.headers.get('User-Agent'))};
        const r=await bounded(store.fetch(new Request('https://callback-settings.internal/flow-token/generate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor})})),8000);return send(await r.json(),r.status);
      }
      if(part==='flow-token-test'){
        let body;try{body=await request.json();}catch{throw new SettingsError('invalid-json');}
        if(!body||Object.keys(body).some(k=>k!=='token')||typeof body.token!=='string'||body.token.length>160)throw new SettingsError('invalid-token-test');
        const r=await bounded(store.fetch(new Request('https://callback-settings.internal/flow-token/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token:body.token})})),8000),result=await r.json();
        return send({success:true,authorized:result.authorized===true});
      }
      const storeUrl=new URL('https://callback-settings.internal/'+part);
      for (const name of ['before','mutationId','id','ids']) if (u.searchParams.has(name)) storeUrl.searchParams.set(name,u.searchParams.get(name));
      const queueOptions=async()=>{
        const rows=await bounded(getWebexQueueConfiguration(env),5000);
        if (!Array.isArray(rows)) throw new SettingsError('queue-configuration-unavailable',503);
        return rows.filter(q=>['telephony','voice'].includes(String(q?.channelType||'').toLowerCase()) &&
          q.active!==false && q.isActive!==false && String(q.status||'').toLowerCase()!=='inactive')
          .map(q=>({id:String(q.id),name:String(q.name||'Voice queue').slice(0,120)}));
      };
      let options=[],optionsAvailable=true,init={method:'GET'};
      if (request.method==='POST') {
        if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
          throw new SettingsError('json-required',415);
        let size=0,text=''; const reader=request.body?.getReader(), decoder=new TextDecoder('utf-8',{fatal:true});
        if (!reader) throw new SettingsError('missing-body');
        try { while (true) { const {value,done}=await reader.read(); if(done)break;
          size+=value.byteLength; if(size>(['preview','schedule','plans','plan-preview','plan-schedule'].includes(part)?65536:8192)){await reader.cancel();throw new SettingsError('body-too-large',413);}
          text+=decoder.decode(value,{stream:true}); } text+=decoder.decode();
        } finally { reader.releaseLock(); }
        let body; try { body=JSON.parse(text); } catch { throw new SettingsError('invalid-json'); }
        if(['plans','plan-preview','plan-schedule'].includes(part))return send(await handlePlanRequest({part,body,store,queueOptions,
          getReport:()=>bounded(getAbandonedReport(env),12000),bounded,
          actor:{sourceIp,source:'cloudflare-edge',identityVerified:false,...browserDetails(request.headers.get('User-Agent'))},requestId:crypto.randomUUID()}),part==='plan-schedule'?202:200);
        if(part==='manage'){
          const r=await bounded(store.fetch(new Request('https://callback-settings.internal/manage',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({change:body,actor:{sourceIp,source:'cloudflare-edge',identityVerified:false,...browserDetails(request.headers.get('User-Agent'))},requestId:crypto.randomUUID()})})),12000);return send(await r.json(),r.status);
        }
        if(part==='refresh-record'){
          if(!body||Object.keys(body).some(k=>k!=='contactId')||!UUID.test(body.contactId||''))throw new SettingsError('invalid-record-id');
          const r=await bounded(store.fetch(new Request('https://callback-settings.internal/refresh-record',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})),20000);
          return send(await r.json(),r.status);
        }
        if (['preview','schedule'].includes(part)) {
          const {mutationId,...selectionBody}=body;
          if(part==='schedule'&&!UUID.test(mutationId||''))throw new SettingsError('invalid-mutation-id');
          if(part==='preview'&&mutationId!==undefined)throw new SettingsError('unknown-selection-field');
          const selection=parseSelection(selectionBody);
          if(part==='schedule'){
            const found=await bounded(store.fetch(new Request('https://callback-settings.internal/jobs?id='+mutationId)));
            if(found.ok){const prior=await found.json();const intent={contactIds:[...selection.contactIds].sort(),scope:selection.scope,expectedVersion:selection.expectedVersion,date:selection.date,startTime:selection.startTime};
              if(JSON.stringify(prior.job.intent)!==JSON.stringify(intent))throw new SettingsError('mutation-id-reused',409);
              return send({success:true,job:prior.job,replayed:true},202);
            }
            if(found.status!==404)throw new SettingsError('callback-ledger-unavailable',503);
          }
          const saved=await bounded(store.fetch(new Request('https://callback-settings.internal/settings')));
          const value=await saved.json();
          if (!saved.ok || value.success!==true) throw new SettingsError('callback-storage-unavailable',503);
          if (value.state.version!==selection.expectedVersion) throw new SettingsError('settings-changed-reload',409);
          options=await queueOptions();
          if (typeof getAbandonedReport!=='function') throw new SettingsError('abandoned-report-unavailable',503);
          const report=await bounded(getAbandonedReport(env),12000);
          const preview=buildPreview(selection,value.state,report,options);
          const ids=preview.rows.map(r=>r.contactId).join(',');
          const ledgerResponse=await bounded(store.fetch(new Request('https://callback-settings.internal/records?ids='+encodeURIComponent(ids))));
          const ledger=await ledgerResponse.json();
          if(!ledgerResponse.ok||ledger.success!==true)throw new SettingsError('callback-ledger-unavailable',503);
          const previous=new Map(ledger.rows.map(r=>[r.contactId,r]));
          for(const row of preview.rows){const old=previous.get(row.contactId);if(old){row.disposition='skipped';row.reason='callback-already-reserved';row.callbackStatus=old.status;row.scheduleId=old.scheduleId;}}
          if(part==='preview'){
            const candidates=preview.rows.filter(r=>r.disposition==='candidate');
            if(candidates.length){
              const inspectionResponse=await bounded(store.fetch(new Request('https://callback-settings.internal/inspect',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rows:candidates.map(({contactId,number})=>({contactId,number}))})})),12000);
              const inspection=await inspectionResponse.json();
              if(!inspectionResponse.ok||inspection.success!==true)throw new SettingsError('native-inspection-unavailable',503);
              const byId=new Map(inspection.rows.map(r=>[r.contactId,r]));
              for(const row of candidates){row.nativeInventory=byId.get(row.contactId)||{status:'unavailable'};
                if(['reserved','duplicate'].includes(row.nativeInventory.status)){row.disposition='skipped';row.reason=row.nativeInventory.reason;}}
            }
          }
          preview.candidates=preview.rows.filter(r=>r.disposition==='candidate').length;preview.skipped=preview.selected-preview.candidates;
          preview.processing=value.processing;preview.canSchedule=value.processing?.ready===true&&preview.candidates>0&&preview.candidates<=value.processing.maxBatch&&preview.rows.filter(r=>r.disposition==='candidate').every(r=>part==='schedule'||['clear','not-checked'].includes(r.nativeInventory?.status));
          preview.warning=preview.canSchedule?'Preview only. Select Schedule to submit these callbacks. Native duplicate checks run again before creation.':value.processing?.message||'Native callback scheduling is paused.';
          if(part==='preview')return send(preview);
          const actor={sourceIp,source:'cloudflare-edge',identityVerified:false,...browserDetails(request.headers.get('User-Agent'))};
          const response=await bounded(store.fetch(new Request('https://callback-settings.internal/schedule',{method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({mutationId,expectedVersion:selection.expectedVersion,preview,actor,requestId:crypto.randomUUID()})})),20000);
          return send(await response.json(),response.status);
        }
        const change=parseMutation(body);
        if (change.settings.enabled) {
          options=await queueOptions();
          if (!options.some(q=>q.id===change.settings.queueId)) throw new SettingsError('voice-queue-not-configured');
        }
        const actor={sourceIp,source:'cloudflare-edge',identityVerified:false,
          ...browserDetails(request.headers.get('User-Agent'))};
        init={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({change:{...change,settings:body.settings},actor,requestId:crypto.randomUUID()})};
      } else if (part==='settings') {
        if (u.searchParams.has('mutationId') && !UUID.test(u.searchParams.get('mutationId')))
          throw new SettingsError('invalid-mutation-id');
        try { options=await queueOptions(); } catch { optionsAvailable=false; }
      }
      const response=await bounded(store.fetch(new Request(storeUrl,init)));
      const data=await response.json();
      return send({...data,...(part==='settings'?{queueOptions:options,queueOptionsAvailable:optionsAvailable}: {})},response.status);
    } catch(error) {
      return send({success:false,error:error instanceof SettingsError ? error.code : 'settings-temporarily-unavailable'},
        error instanceof SettingsError ? error.status : 503);
    }
  };
}
