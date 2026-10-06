import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLicenseGate,licenseGateContract} from '../scripts/patch-license-gate-r1.mjs';

const source=`
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const cors = {};
    try {
  const path = url.pathname;

  const legacyPolicy = legacySecurityRoutePolicy(path, method);
  return new Response("ok");
    } catch (err) {
      return new Response(err.message,{status:500});
    }
  },

  async scheduled(event, env, ctx) {
  ctx.waitUntil(runAllScheduledTasks(env));
  ctx.waitUntil(vbCallbackMaintenance(env));
  ctx.waitUntil(sweepExpiredLeases({env,webexFetch,orgId:String(env.WEBEX_ORG_ID||"")}).catch(err=>console.error("Device lease maintenance failed:",err?.message||err)));
}
};
`;

test('Worker patch inserts license API route, server-side gate and scheduled heartbeat exactly once',()=>{
  const result=patchLicenseGate(source);
  assert.equal((result.match(/path\.startsWith\("\/api\/license\/"\)/g)||[]).length,1);
  assert.equal((result.match(/requireLicensedAccess\(env\)/g)||[]).length,1);
  assert.equal((result.match(/scheduledLicenseCheck\(env\)/g)||[]).length,1);
  assert.equal((result.match(/createLicenseControlHandler\(\)/g)||[]).length,1);
  assert.ok(result.includes('./license-control.mjs'));
});

test('license gate executes before legacy operational routing',()=>{
  const result=patchLicenseGate(source);
  assert.ok(result.indexOf('path.startsWith("/api/license/")')<result.indexOf('legacySecurityRoutePolicy(path, method)'));
  assert.ok(result.indexOf('requireLicensedAccess(env)')<result.indexOf('legacySecurityRoutePolicy(path, method)'));
});

test('patch is idempotent only for reviewed fully-patched form',()=>{
  const once=patchLicenseGate(source);
  assert.equal(patchLicenseGate(once),once);
  assert.throws(()=>patchLicenseGate('const vbLicenseControl=createLicenseControlHandler();'),/unexpected-existing-license-gate/);
});

test('patch refuses missing or duplicated production anchors',()=>{
  assert.throws(()=>patchLicenseGate('no anchors'),/license-fetch-anchor-count:0/);
  assert.throws(()=>patchLicenseGate(source.replace(licenseGateContract.FETCH_ANCHOR,licenseGateContract.FETCH_ANCHOR+'\n'+licenseGateContract.FETCH_ANCHOR)),/license-fetch-anchor-count:2/);
});
