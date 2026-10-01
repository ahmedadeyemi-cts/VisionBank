// Atomic number-wide reservations. A missing native future schedule does not release a reservation.
import {SettingsError} from './policy.mjs';
import {callbackNumber} from './selection.mjs';
export const released = r => ['not-submitted','rejected'].includes(r?.status);
export async function numberKey(number) {
  const normalized=callbackNumber(number);
  if(!normalized)throw new SettingsError('invalid-callback-number');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized));
  return 'phone-active:'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function initializeNumberIndex(tx) {
  if(await tx.get('phone-active-index:v1'))return;
  const records=await tx.list({prefix:'callback:',limit:1001});
  if(records.size>1000)throw new SettingsError('callback-reservation-migration-required',503);
  for(const r of records.values()) {
    if(released(r))continue;
    const k=await numberKey(r.payload?.callbackNumber),ids=await tx.get(k)||[];
    if(!ids.includes(r.contactId))await tx.put(k,[...ids,r.contactId]);
  }
  await tx.put('phone-active-index:v1',true);
}
export async function releaseNumber(tx,record) {
  if(!released(record))return;
  const k=await numberKey(record.payload.callbackNumber),ids=(await tx.get(k)||[]).filter(id=>id!==record.contactId);
  if(ids.length)await tx.put(k,ids);else await tx.delete(k);
}
