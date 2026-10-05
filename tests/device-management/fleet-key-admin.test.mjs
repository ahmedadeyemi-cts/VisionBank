import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initializeFleetKeyConfig,getFleetKeySettings,rotateFleetKey,authenticatePhoneFleetKey,recordFleetKeyUse
} from '../../device-management/phone-selfservice.mjs';

class MemoryKV{
  constructor(){this.map=new Map();}
  async put(key,value,options={}){this.map.set(key,{value,metadata:options.metadata||null});}
  async get(key){return this.map.get(key)?.value??null;}
  async delete(key){this.map.delete(key);}
}
const INITIAL='GSYzrRP442bBBMpiAjuD';
const START=Date.parse('2026-10-05T20:00:00.000Z');

test('fleet admin status exposes the active key, generated time, last use and template URL',async()=>{
  const env={LOGS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:INITIAL,actor:'admin@visionbank.com',generatedAt:new Date(START).toISOString()});
  let status=await getFleetKeySettings(env,{origin:'https://worker.example',now:START});
  assert.equal(status.active.key,INITIAL);
  assert.equal(status.active.generatedAt,'2026-10-05T20:00:00.000Z');
  assert.equal(status.active.generatedBy,'admin@visionbank.com');
  assert.equal(status.active.lastUsedAt,null);
  assert.equal(status.templateUrl,'https://worker.example/x/'+INITIAL+'/{{mac_address}}');

  await authenticatePhoneFleetKey(env,INITIAL,{now:START+60_000});
  await recordFleetKeyUse(env,INITIAL,{now:START+60_000});
  status=await getFleetKeySettings(env,{origin:'https://worker.example',now:START+60_000});
  assert.equal(status.active.lastUsedAt,'2026-10-05T20:01:00.000Z');
  assert.equal(status.active.useCount,1);
});

test('rotation creates a new active key and keeps the previous key valid for 24 hours',async()=>{
  const env={LOGS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:INITIAL,actor:'admin@visionbank.com',generatedAt:new Date(START).toISOString()});
  const before=await getFleetKeySettings(env,{origin:'https://worker.example',now:START});
  await rotateFleetKey(env,{expectedActiveKeyId:before.activeKeyId,actor:'security-admin@visionbank.com',now:START+120_000});
  const after=await getFleetKeySettings(env,{origin:'https://worker.example',now:START+120_000});
  assert.notEqual(after.active.key,INITIAL);
  assert.match(after.active.key,/^[A-Za-z0-9]{20}$/);
  assert.equal(after.active.generatedBy,'security-admin@visionbank.com');
  const old=after.keys.find(row=>row.key===INITIAL);
  assert.equal(old.status,'retiring');
  assert.equal(Date.parse(old.validUntil),START+120_000+24*60*60*1000);
  await authenticatePhoneFleetKey(env,INITIAL,{now:START+3*60_000});
  await assert.rejects(()=>authenticatePhoneFleetKey(env,INITIAL,{now:START+120_000+24*60*60*1000+1}),e=>e.code==='phone-fleet-key-invalid');
});

test('rotation uses optimistic active-key protection',async()=>{
  const env={LOGS:new MemoryKV()};
  await initializeFleetKeyConfig(env,{key:INITIAL,actor:'admin',generatedAt:new Date(START).toISOString()});
  await assert.rejects(()=>rotateFleetKey(env,{expectedActiveKeyId:crypto.randomUUID(),actor:'admin',now:START+1000}),e=>e.code==='phone-fleet-key-changed'&&e.status===409);
});
