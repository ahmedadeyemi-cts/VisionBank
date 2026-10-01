import {CallbackPlans} from './plans.mjs';
import {CallbackExecution} from './execution.mjs';
import { REVISION, SettingsError, initialState, parseMutation, normalizeSettings, processingState } from './policy.mjs';
const output = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control':'no-store' } });
const key = n => 'audit:' + String(n).padStart(16,'0');

const tokenHash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
const tokenValue=()=>{const b=crypto.getRandomValues(new Uint8Array(32));return 'vbcbp_'+Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');};
async function constantHashEqual(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}

function validateState(state) {
  if (state === undefined) return initialState();
  if (!state || !Number.isSafeInteger(state.version) || state.version < 0) throw new Error('invalid-stored-state');
  try {
    const normalized=normalizeSettings(state.settings);
    for (const [k,v] of Object.entries(normalized)) {
      if(k==='callbackEntryPointId'&&!Object.hasOwn(state.settings,k))continue;
      if(JSON.stringify(v)!==JSON.stringify(state.settings[k]))throw new Error();
    }
    state={...state,settings:normalized};
  } catch { throw new Error('invalid-stored-state'); }
  return state;
}
// Accessible only through a Worker binding; the companion has no public routes.
export class AbandonedCallbackSettingsV1 {
  constructor(ctx,env={}) { this.storage = ctx.storage; this.plans=new CallbackPlans(ctx.storage); this.execution=new CallbackExecution(ctx,env); }
  async alarm() {
    try{if(!await this.execution.management.run()){const work=await this.storage.list({prefix:'work:',limit:1});if(work.size)await this.execution.run();else await this.execution.outcomes.run();}}
    finally{await this.execution.nextAlarm();await this.execution.management.ensureAlarm();await this.execution.outcomes.ensureAlarm();}
  }
  async entryPointDiscovery() {
    try{return {entryPointOptions:await this.execution.native().entryPoints(),entryPointOptionsAvailable:true};}
    catch(error){
      const code=typeof error?.code==='string'&&/^[a-z0-9-]{1,100}$/.test(error.code)?error.code:'entry-point-discovery-failed';
      return {entryPointOptions:[],entryPointOptionsAvailable:false,entryPointDiscoveryError:code};
    }
  }
  async fetch(request) {
    try {
      const u = new URL(request.url);
      if(u.pathname==='/plans')return this.plans.fetch(request);
      if(u.pathname==='/flow-token/status'&&request.method==='GET'){
        const meta=await this.storage.get('flow-token:meta');return output({success:true,configured:!!meta,createdAt:meta?.createdAt||null,lastRotatedAt:meta?.lastRotatedAt||null,fingerprint:meta?.fingerprint||null});
      }
      if(u.pathname==='/flow-token/generate'&&request.method==='POST'){
        const input=await request.json(),actor=input?.actor;if(!actor||typeof actor.sourceIp!=='string'||actor.identityVerified!==false)throw new SettingsError('invalid-source');
        const token=tokenValue(),digest=await tokenHash(token),now=new Date().toISOString(),prior=await this.storage.get('flow-token:meta');
        const previous=await this.storage.get('flow-token:sha256'),graceUntil=previous?Date.now()+30*60000:null;
        const meta={createdAt:prior?.createdAt||now,lastRotatedAt:now,fingerprint:digest.slice(0,12),graceUntil,actor};
        await this.storage.transaction(async tx=>{if(previous){await tx.put('flow-token:previous-sha256',previous);await tx.put('flow-token:previous-until',graceUntil);}await tx.put('flow-token:sha256',digest);await tx.put('flow-token:meta',meta);});
        return output({success:true,token,...meta});
      }
      if(u.pathname==='/flow-token/auth'&&request.method==='POST'){
        const input=await request.json(),token=typeof input?.token==='string'?input.token:'';if(token.length<40||token.length>160)return output({success:true,authorized:false});
        const digest=await tokenHash(token),saved=await this.storage.get('flow-token:sha256'),previous=await this.storage.get('flow-token:previous-sha256'),until=await this.storage.get('flow-token:previous-until');
        const current=typeof saved==='string'&&await constantHashEqual(digest,saved),grace=Number(until)>Date.now()&&typeof previous==='string'&&await constantHashEqual(digest,previous);return output({success:true,authorized:current||grace});
      }
      if(['/readiness','/jobs','/records','/schedule','/inspect','/register','/refresh-record','/manage','/management','/automation-status','/automation-tick','/flow-policy'].includes(u.pathname))return this.execution.handle(request);
      if (request.method === 'GET' && u.pathname === '/settings') {
        const state = validateState(await this.storage.get('state'));
        const id = u.searchParams.get('mutationId');
        const mutation = id && /^[\da-f-]{36}$/i.test(id) ? await this.storage.get('mutation:'+id) : null;
        return output({ success:true, revision:REVISION, serverTimeEpoch:Date.now(), state, processing:await this.execution.readiness(state),
          ...(await this.entryPointDiscovery()),mutationStatus: id ? mutation ? 'accepted' : 'not-found' : null });
      }
      if (request.method === 'GET' && u.pathname === '/history') {
        const before = u.searchParams.get('before');
        if (before !== null && (!/^\d{1,16}$/.test(before) || !Number.isSafeInteger(Number(before))))
          throw new SettingsError('invalid-history-cursor');
        const entries = await this.storage.list({ prefix:'audit:', reverse:true, limit:21,
          ...(before !== null ? { end:key(Number(before)) } : {}) });
        const rows = [...entries.values()], more = rows.length > 20; rows.splice(20);
        return output({ success:true, rows, nextBefore:more ? rows.at(-1).version : null });
      }
      if (request.method !== 'POST' || u.pathname !== '/settings') return output({success:false,error:'not-found'},404);
      const input = await request.json(), mutation = parseMutation(input.change), actor = input.actor;
      if (!actor || typeof actor.sourceIp !== 'string' || actor.sourceIp.length > 64 ||
          !/^[0-9a-f:.]+$/i.test(actor.sourceIp) || actor.identityVerified !== false ||
          actor.computerName !== null || actor.internalIp !== null) throw new SettingsError('invalid-source');
      const provided=Object.hasOwn(input.change.settings,'callbackEntryPointId');
      const fingerprint = JSON.stringify([mutation,actor.sourceIp,provided]);
      const legacy={...mutation,settings:{...mutation.settings}};delete legacy.settings.callbackEntryPointId;
      const legacyFingerprint=provided?null:JSON.stringify([legacy,actor.sourceIp]);
      const before=validateState(await this.storage.get('state'));
      let verifiedEntryPoint=null,discovery=null;
      if(provided&&mutation.settings.callbackEntryPointId&&mutation.settings.callbackEntryPointId!==before.settings.callbackEntryPointId){
        discovery=await this.entryPointDiscovery();
        if(!discovery.entryPointOptionsAvailable)throw new SettingsError('entry-point-discovery-unavailable',503);
        verifiedEntryPoint=discovery.entryPointOptions.find(e=>e.id===mutation.settings.callbackEntryPointId);
        if(!verifiedEntryPoint)throw new SettingsError('active-outbound-entry-point-required');
      }
      const result = await this.storage.transaction(async txn => {
        const current = validateState(await txn.get('state'));
        const prior = await txn.get('mutation:'+mutation.mutationId);
        if (prior) {
          if (prior.fingerprint !== fingerprint && prior.fingerprint !== legacyFingerprint) throw new SettingsError('mutation-id-reused',409);
          return {state:current,replayed:true,changed:prior.changed,mutationId:mutation.mutationId};
        }
        if (mutation.expectedVersion !== current.version) throw new SettingsError('settings-changed-reload',409);
        const now = Date.now(), bucket = Math.floor(now/60000), rateKey = 'rate:'+actor.sourceIp;
        const savedRate = await txn.get(rateKey), rate = savedRate?.bucket === bucket ? savedRate : {bucket,count:0};
        if (rate.count >= 12) throw new SettingsError('too-many-settings-changes',429);
        const resolvedSettings=provided?mutation.settings:{...mutation.settings,callbackEntryPointId:current.settings.callbackEntryPointId};
        const automatic=resolvedSettings.enabled&&resolvedSettings.mode==='automatic-new-abandoned';
        const changed = JSON.stringify(current.settings) !== JSON.stringify(resolvedSettings)||(automatic&&!current.automaticSince);
        let state = current;
        if (changed) {
          const version = current.version+1, at = new Date(now).toISOString();
          state = {version,settings:resolvedSettings,updatedAt:at,lastChangedBy:actor,automaticSince:automatic?(current.settings.enabled&&current.settings.mode==='automatic-new-abandoned'&&current.automaticSince||now):null};
          const action = current.settings.enabled !== resolvedSettings.enabled ?
            resolvedSettings.enabled ? 'Enabled' : 'Disabled' : 'Configuration changed';
          await txn.put(key(version), {version,at,action,actor,requestId:input.requestId,
            mutationId:mutation.mutationId,previous:current.settings,next:resolvedSettings,entryPointChange:current.settings.callbackEntryPointId!==resolvedSettings.callbackEntryPointId?{previousId:current.settings.callbackEntryPointId,nextId:resolvedSettings.callbackEntryPointId,nameAtChange:verifiedEntryPoint?.name||null}:null});
          await txn.put('state',state);
        }
        await txn.put(rateKey,{bucket,count:rate.count+1});
        await txn.put('mutation:'+mutation.mutationId,{fingerprint,changed,version:state.version});
        return {state,replayed:false,changed,mutationId:mutation.mutationId};
      });
      return output({success:true,revision:REVISION,...result,...(discovery??await this.entryPointDiscovery()),processing:await this.execution.readiness(result.state)});
    } catch (error) {
      const known = error instanceof SettingsError;
      return output({success:false,error:known ? error.code : 'settings-storage-unavailable'},known ? error.status : 503);
    }
  }
}
// Private entrypoint only. Explicitly accepted jobs use durable alarms; no browser timer.
export default { fetch() { return output({success:false,error:'not-found'},404); } };
