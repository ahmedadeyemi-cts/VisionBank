import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceManagementError,
  normalizeMac,
  assertAssignableMember,
  validatePostSaveAction,
  buildChangePlan,
  validateApplyRequest
} from '../../device-management/contracts.mjs';

const DEVICE={id:'dev-1',displayName:'Lobby Phone',locationId:'loc-a',locationName:'Dallas',mac:'001122334455'};
const USER={id:'user-1',name:'Alex User',type:'PEOPLE',locationId:'loc-a',extension:'4101'};
const WORKSPACE={id:'space-1',name:'Open Desk 12',type:'PLACE',locationId:'loc-a',extension:'4190'};
const MID='11111111-1111-4111-8111-111111111111';

test('MAC normalization is stable across common formats',()=>{
  assert.equal(normalizeMac('00-11-22-33-44-55'),'00:11:22:33:44:55');
  assert.equal(normalizeMac('0011.2233.4455'),'00:11:22:33:44:55');
});

test('same-location user and workspace are assignable',()=>{
  assert.equal(assertAssignableMember(USER,DEVICE).id,'user-1');
  assert.equal(assertAssignableMember(WORKSPACE,DEVICE).id,'space-1');
});

test('cross-location assignment is denied by the backend contract',()=>{
  assert.throws(
    ()=>assertAssignableMember({...USER,locationId:'loc-b'},DEVICE),
    error=>error instanceof DeviceManagementError&&error.code==='cross-location-assignment-denied'
  );
});

test('destructive Phonism reset actions are never accepted as post-save automation',()=>{
  assert.throws(
    ()=>validatePostSaveAction({id:'factory-reset',label:'Factory Reset',verifiedNonDestructive:true}),
    error=>error.code==='destructive-phonism-action-denied'
  );
  assert.throws(
    ()=>validatePostSaveAction({id:'reset-config',label:'Reset Config',verifiedNonDestructive:true}),
    error=>error.code==='destructive-phonism-action-denied'
  );
});

test('preview remains non-executable until both integrations and a safe action are ready',()=>{
  const plan=buildChangePlan({device:DEVICE,targetMember:USER,mutationId:MID,capabilities:{webexWrite:true,phonismWrite:false}});
  assert.equal(plan.executable,false);
  assert.equal(plan.after.line2.extension,'4101');
  assert.equal(Object.hasOwn(plan.after,'line1'),false);
});

test('preview becomes executable only with both write paths and a verified non-destructive action',()=>{
  const plan=buildChangePlan({
    device:DEVICE,targetMember:WORKSPACE,version:7,mutationId:MID,
    capabilities:{webexWrite:true,phonismWrite:true},
    postSaveAction:{id:'reprovision',label:'Reprovision phone',verifiedNonDestructive:true}
  });
  assert.equal(plan.executable,true);
  assert.equal(plan.expectedVersion,7);
  assert.equal(plan.phonismActionLabel,'Reprovision phone');
});

test('apply request accepts only mutation ID and optimistic version',()=>{
  assert.deepEqual(validateApplyRequest({mutationId:MID,expectedVersion:3}),{mutationId:MID,expectedVersion:3});
  assert.throws(
    ()=>validateApplyRequest({mutationId:MID,expectedVersion:3,deviceId:'dev-1'}),
    error=>error.code==='unknown-apply-field'
  );
});
