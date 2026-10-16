import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { build } from '../scripts/build-dashboard-settings-access.mjs';
const baseline = process.env.VB_PRIVATE_BASELINE;
test('patch fails closed on missing or duplicated route', () => {
  assert.throws(() => build('export default {}'));
  const rule='if (path === "/api/webex/dashboard/settings/save" && method === "POST") return { roles: operators };';
  assert.throws(() => build(rule+rule));
});
test('deployed access policy retains network and hours checks and other session gates', {skip:!baseline}, async () => {
  const source=fs.readFileSync(baseline,'utf8'),candidate=build(source);
  const start=candidate.indexOf('function legacySecurityRoutePolicy('),end=candidate.indexOf('\nfunction bytesToBase64',start);
  assert(start>0 && end>start);
  const c=vm.createContext({LEGACY_SECURITY_ROLES:['superadmin','admin','analyst'],checkAccess:async()=>({allowed:true}),getVisionBankSessionFromRequest:async()=>null});
  vm.runInContext(candidate.slice(start,end)+'\nglobalThis.api={legacySecurityRoutePolicy,authorizeLegacySecurityRequest};',c);
  const policy=c.api.legacySecurityRoutePolicy('/api/webex/dashboard/settings/save','POST');
  assert.equal(policy.session,false);
  assert.equal((await c.api.authorizeLegacySecurityRequest({}, {}, policy)).ok,true);
  for(const reason of ['ip-denied','hours-closed']) {
    c.checkAccess=async()=>({allowed:false,reason});
    assert.equal((await c.api.authorizeLegacySecurityRequest({}, {}, policy)).status,403);
  }
  c.checkAccess=async()=>({allowed:true});
  const protectedPolicy=c.api.legacySecurityRoutePolicy('/motd','POST');
  assert.equal((await c.api.authorizeLegacySecurityRequest({}, {}, protectedPolicy)).status,401);
  assert.equal(c.api.legacySecurityRoutePolicy('/api/webex/dashboard/settings','GET').session,false);
  assert.equal(candidate.replace('roles: operators, session: false','roles: operators'),source);
});
