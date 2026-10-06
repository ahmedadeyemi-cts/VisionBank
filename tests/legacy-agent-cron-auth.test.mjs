import test from 'node:test';
import assert from 'node:assert/strict';
import {patchLegacyAgentCronAuth,contract} from '../scripts/patch-legacy-agent-cron-auth.mjs';

const source=`
async function fetchHandler(request,env,cors){
  const path="/api/agents/logout/settings", method="GET";
  const legacyPolicy = legacySecurityRoutePolicy(path, method);
  if (legacyPolicy) {
    const authorization = await authorizeLegacySecurityRequest(request, env, legacyPolicy);
    if (!authorization.ok) return json({ error: authorization.error }, cors, authorization.status);
  }
}

function constantTimeStringEqual(a,b) {
  const aa=String(a||""), bb=String(b||"");
  let diff=aa.length ^ bb.length;
  const max=Math.max(aa.length,bb.length);
  for(let i=0;i<max;i++) diff |= (aa.charCodeAt(i%Math.max(aa.length,1))||0) ^ (bb.charCodeAt(i%Math.max(bb.length,1))||0);
  return diff===0;
}
`;

test('patch adds narrowly-scoped machine authorization for legacy logout config GET',()=>{
  const out=patchLegacyAgentCronAuth(source);
  assert.match(out,/path === "\/api\/agents\/logout\/settings"/);
  assert.match(out,/method === "GET"/);
  assert.match(out,/isLegacyAgentLogoutCronAuthorized\(request, env\)/);
  assert.match(out,/X-VB-Agent-Logout-Token/);
});

test('machine token must be at least 32 characters and compared in constant time',()=>{
  const out=patchLegacyAgentCronAuth(source);
  assert.match(out,/expected\.length>=32/);
  assert.match(out,/supplied\.length>=32/);
  assert.match(out,/constantTimeStringEqual\(supplied,expected\)/);
});

test('normal legacy security authorization remains for every non-machine request',()=>{
  const out=patchLegacyAgentCronAuth(source);
  assert.match(out,/if \(legacyPolicy && !legacyAutomationAuthorized\)/);
  assert.match(out,/authorizeLegacySecurityRequest\(request, env, legacyPolicy\)/);
});

test('patch is idempotent and refuses missing anchors',()=>{
  const once=patchLegacyAgentCronAuth(source);
  assert.equal(patchLegacyAgentCronAuth(once),once);
  assert.throws(()=>patchLegacyAgentCronAuth('no anchors'),/route-gate-anchor-count:0/);
});

test('review contract remains specific to existing production anchors',()=>{
  assert.ok(contract.ROUTE_GATE_ANCHOR.includes('legacySecurityRoutePolicy'));
  assert.ok(contract.HELPER_ANCHOR.includes('constantTimeStringEqual'));
});
