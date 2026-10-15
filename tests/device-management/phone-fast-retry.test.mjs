import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {patchPhoneFastRetry,PHONE_RETRY_CRON} from '../../scripts/patch-phone-fast-retry.mjs';
const original=`const worker={async scheduled(event, env, ctx) {
 ctx.waitUntil(reconcilePhoneEnrollments());
 ctx.waitUntil(runAllScheduledTasks());
 ctx.waitUntil(vbCallbackMaintenance());
 ctx.waitUntil(sweepExpiredLeases({env,webexFetch,orgId:String(env.WEBEX_ORG_ID||"")}).catch(err=>console.error("Device lease maintenance failed:",err?.message||err)));
 ctx.waitUntil(scheduledLicenseCheck());
}};globalThis.worker=worker;`;
async function run(cron,minute){
 const calls=[],promises=[];const ctx={waitUntil:p=>promises.push(p)};
 const scope=vm.createContext({console,webexFetch(){},sweepExpiredLeases:async()=>calls.push('phone'),reconcilePhoneEnrollments:async()=>calls.push('enroll'),runAllScheduledTasks:async()=>calls.push('other'),vbCallbackMaintenance:async()=>calls.push('callback'),scheduledLicenseCheck:async()=>calls.push('license')});
 vm.runInContext(patchPhoneFastRetry(original),scope);
 await scope.worker.scheduled({cron,scheduledTime:Date.UTC(2026,9,15,16,minute)},{},ctx);await Promise.all(promises);return calls;
}
test('phone-only trigger runs between the existing maintenance ticks',async()=>{
 for(const minute of [1,2,3,4,29,31,59])assert.deepEqual(await run(PHONE_RETRY_CRON,minute),['phone']);
});
test('minute trigger does not duplicate phone writes on the five-minute boundary',async()=>{
 for(const minute of [0,5,30,55])assert.deepEqual(await run(PHONE_RETRY_CRON,minute),[]);
});
test('original five-minute schedule keeps all existing jobs including phone fallback',async()=>{
 assert.deepEqual(await run('*/5 * * * *',30),['enroll','other','callback','phone','license']);
});
test('patch is idempotent and rejects unexpected worker handlers',()=>{
 const once=patchPhoneFastRetry(original);assert.equal(patchPhoneFastRetry(once),once);assert.throws(()=>patchPhoneFastRetry('export default {}'));
});
test('all three phone wait responses use the exact customer wording',()=>{
 const source=fs.readFileSync('device-management/gateway.mjs','utf8');
 const message='Please Wait!! Do not use your phone until it restarts. Your phone will restart within the next 40 seconds';
 assert.equal(source.split("'"+message+"'").length-1,3);assert.ok(!source.includes('If delayed, reopen Add Extension'));
});
