import { REVISION, SettingsError, initialState, parseMutation, normalizeSettings, processingState } from './policy.mjs';
const output = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control':'no-store' } });
const key = n => 'audit:' + String(n).padStart(16,'0');
function validateState(state) {
  if (state === undefined) return initialState();
  if (!state || !Number.isSafeInteger(state.version) || state.version < 0) throw new Error('invalid-stored-state');
  try {
    const normalized=normalizeSettings(state.settings);
    if (JSON.stringify(normalized)!==JSON.stringify(state.settings)) throw new Error();
  } catch { throw new Error('invalid-stored-state'); }
  return state;
}
// Accessible only through a Worker binding; the companion has no public routes.
export class AbandonedCallbackSettingsV1 {
  constructor(ctx) { this.storage = ctx.storage; }
  async fetch(request) {
    try {
      const u = new URL(request.url);
      if (request.method === 'GET' && u.pathname === '/settings') {
        const state = validateState(await this.storage.get('state'));
        const id = u.searchParams.get('mutationId');
        const mutation = id && /^[\da-f-]{36}$/i.test(id) ? await this.storage.get('mutation:'+id) : null;
        return output({ success:true, revision:REVISION, state, processing:processingState(state),
          mutationStatus: id ? mutation ? 'accepted' : 'not-found' : null });
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
      const fingerprint = JSON.stringify([mutation,actor.sourceIp]);
      const result = await this.storage.transaction(async txn => {
        const current = validateState(await txn.get('state'));
        const prior = await txn.get('mutation:'+mutation.mutationId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new SettingsError('mutation-id-reused',409);
          return {state:current,replayed:true,changed:prior.changed,mutationId:mutation.mutationId};
        }
        if (mutation.expectedVersion !== current.version) throw new SettingsError('settings-changed-reload',409);
        const now = Date.now(), bucket = Math.floor(now/60000), rateKey = 'rate:'+actor.sourceIp;
        const savedRate = await txn.get(rateKey), rate = savedRate?.bucket === bucket ? savedRate : {bucket,count:0};
        if (rate.count >= 12) throw new SettingsError('too-many-settings-changes',429);
        const changed = JSON.stringify(current.settings) !== JSON.stringify(mutation.settings);
        let state = current;
        if (changed) {
          const version = current.version+1, at = new Date(now).toISOString();
          state = {version,settings:mutation.settings,updatedAt:at,lastChangedBy:actor};
          const action = current.settings.enabled !== mutation.settings.enabled ?
            mutation.settings.enabled ? 'Enabled' : 'Disabled' : 'Configuration changed';
          await txn.put(key(version), {version,at,action,actor,requestId:input.requestId,
            mutationId:mutation.mutationId,previous:current.settings,next:mutation.settings});
          await txn.put('state',state);
        }
        await txn.put(rateKey,{bucket,count:rate.count+1});
        await txn.put('mutation:'+mutation.mutationId,{fingerprint,changed,version:state.version});
        return {state,replayed:false,changed,mutationId:mutation.mutationId};
      });
      return output({success:true,revision:REVISION,...result,processing:processingState(result.state)});
    } catch (error) {
      const known = error instanceof SettingsError;
      return output({success:false,error:known ? error.code : 'settings-storage-unavailable'},known ? error.status : 503);
    }
  }
}
// The durable store has NO HTTP entrypoint, scheduler, alarms or Webex credentials.
export default { fetch() { return output({success:false,error:'not-found'},404); } };
