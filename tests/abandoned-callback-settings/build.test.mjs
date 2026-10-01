import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {build} from '../../scripts/build-abandoned-callback-settings-v1.mjs';
test('callback builder rejects arbitrary or newer Worker source',()=>assert.throws(()=>build('export default {};')));
test('exact existing Worker restored by removing only callback route/import additions',{skip:!process.env.VB_CALLBACK_BASELINE},()=>{
  const source=fs.readFileSync(process.env.VB_CALLBACK_BASELINE,'utf8'),result=build(source);
  assert.equal(result.proof.originalBytesPreserved,true);assert.equal(Object.keys(result.modules).length,6);
  assert.ok(result.candidate.includes('return vbCallbackSettingsV1(request, env, cors);'));
  assert.ok(!result.candidate.includes('export class AbandonedCallbackSettingsV1'));
  assert.equal(result.proof.requiredAdditionalBinding,'ABANDONED_CALLBACK_SETTINGS');
  for(const route of ['plans','plan-preview','plan-schedule','register','refresh-record'])assert.ok(result.candidate.includes('/api/webex/abandoned-callback/'+route+'"'));
  assert.ok(result.modules['callback-settings/plans.mjs']);assert.ok(result.modules['callback-settings/planning-gateway.mjs']);
});
