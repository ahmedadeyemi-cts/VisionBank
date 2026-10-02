import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DeviceManagementError,
  normalizeMac,
  normalizeRegistration,
  assertAssignableMember,
  validatePostSaveAction,
  validateTemporaryDuration,
  leaseExpiryDecision,
  registrationConvergence,
  validateFactoryResetRecovery,
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

test('Webex connection states normalize to registration health',()=>{
  assert.equal(normalizeRegistration('connected'),'registered');
  assert.equal(normalizeRegistration('disconnected'),'unregistered');
  assert.equal(normalizeRegistration('connecting'),'pending');
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
    postSaveAction:{id:'sync',label:'Phonism Sync',verifiedNonDestructive:true}
  });
  assert.equal(plan.executable,true);
  assert.equal(plan.expectedVersion,7);
  assert.equal(plan.phonismActionLabel,'Phonism Sync');
  assert.match(plan.summary,/Phonism Sync/);
});

test('apply request requires a temporary duration and caps it at 12 hours',()=>{
  assert.deepEqual(
    validateApplyRequest({mutationId:MID,expectedVersion:3,durationMinutes:720}),
    {mutationId:MID,expectedVersion:3,durationMinutes:720}
  );
  assert.equal(validateTemporaryDuration(15),15);
  assert.equal(validateTemporaryDuration(720),720);
  assert.throws(()=>validateTemporaryDuration(721),error=>error.code==='invalid-temporary-duration');
  assert.throws(()=>validateTemporaryDuration(0),error=>error.code==='invalid-temporary-duration');
  assert.throws(
    ()=>validateApplyRequest({mutationId:MID,expectedVersion:3,durationMinutes:60,deviceId:'dev-1'}),
    error=>error.code==='unknown-apply-field'
  );
});

test('registration convergence requires both Webex and Phonism to be registered',()=>{
  assert.deepEqual(
    registrationConvergence({webex:'registered',phonism:'registered'}),
    {webexStatus:'registered',phonismStatus:'registered',state:'completed',healthy:true}
  );
  const mismatch=registrationConvergence({webex:'registered',phonism:'unregistered'});
  assert.equal(mismatch.state,'mismatch');
  assert.equal(mismatch.healthy,false);
});

test('factory reset recovery requires an earlier sync and failed verification',()=>{
  assert.throws(
    ()=>validateFactoryResetRecovery({
      recoveryId:MID,expectedVersion:2,syncAttempted:false,
      verificationState:'mismatch',endpointVerified:true,explicitConfirmation:true
    }),
    error=>error.code==='sync-required-before-factory-reset'
  );
  assert.throws(
    ()=>validateFactoryResetRecovery({
      recoveryId:MID,expectedVersion:2,syncAttempted:true,
      verificationState:'completed',endpointVerified:true,explicitConfirmation:true
    }),
    error=>error.code==='factory-reset-not-eligible'
  );
});

test('factory reset recovery needs verified endpoint and explicit confirmation',()=>{
  assert.throws(
    ()=>validateFactoryResetRecovery({
      recoveryId:MID,expectedVersion:2,syncAttempted:true,
      verificationState:'mismatch',endpointVerified:false,explicitConfirmation:true
    }),
    error=>error.code==='factory-reset-endpoint-not-verified'
  );
  assert.throws(
    ()=>validateFactoryResetRecovery({
      recoveryId:MID,expectedVersion:2,syncAttempted:true,
      verificationState:'mismatch',endpointVerified:true,explicitConfirmation:false
    }),
    error=>error.code==='factory-reset-confirmation-required'
  );
  assert.deepEqual(
    validateFactoryResetRecovery({
      recoveryId:MID,expectedVersion:2,syncAttempted:true,
      verificationState:'mismatch',endpointVerified:true,explicitConfirmation:true
    }),
    {recoveryId:MID,expectedVersion:2}
  );
});

test('temporary plan stores baseline and exact expiration',()=>{
  const now=Date.parse('2026-10-02T12:00:00Z');
  const baseline={memberId:'permanent-1',name:'Permanent Shared Line',extension:'4200'};
  const plan=buildChangePlan({
    device:DEVICE,targetMember:USER,currentLine2:baseline,mutationId:MID,
    durationMinutes:720,now,capabilities:{webexWrite:false,phonismWrite:false}
  });
  assert.equal(plan.lease.temporary,true);
  assert.equal(plan.lease.durationMinutes,720);
  assert.equal(plan.lease.startsAt,'2026-10-02T12:00:00.000Z');
  assert.equal(plan.lease.expiresAt,'2026-10-03T00:00:00.000Z');
  assert.deepEqual(plan.lease.baselineLine2,baseline);
});

test('lease expiry restores baseline only while the platform temporary line is still present',()=>{
  const lease={
    status:'active',
    temporaryLine2:{memberId:'temp-1',extension:'4101'},
    baselineLine2:{memberId:'permanent-1',extension:'4200'}
  };
  assert.deepEqual(
    leaseExpiryDecision({lease,currentLine2:{memberId:'temp-1',extension:'4101'}}),
    {action:'restore-baseline',baselineLine2:lease.baselineLine2,reason:'temporary-lease-expired'}
  );
});

test('lease expiry preserves a newer Control Hub change instead of overwriting it',()=>{
  const lease={
    status:'active',
    temporaryLine2:{memberId:'temp-1',extension:'4101'},
    baselineLine2:null
  };
  assert.deepEqual(
    leaseExpiryDecision({lease,currentLine2:{memberId:'controlhub-2',extension:'4300'}}),
    {action:'preserve-current',reason:'external-change-detected'}
  );
});
