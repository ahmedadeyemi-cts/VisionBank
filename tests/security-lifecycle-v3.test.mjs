import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Security identity view supports disable/enable and login activity without exposing session tokens',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.match(js,/\/api\/users\/status/);
  assert.match(js,/lastSuccessfulLoginAt/);
  assert.match(js,/lastFailedLoginAt/);
  assert.match(js,/Disable Account/);
  assert.match(js,/Enable Account/);
  assert.match(html,/id="security-active-sessions-panel"/);
  assert.match(html,/non-secret session fingerprint/);
  assert.doesNotMatch(html,/id="security-session-token"/i);
  assert.doesNotMatch(html,/name="sessionToken"/i);
  assert.doesNotMatch(js,/session\.sessionId|item\.sessionId/);
  assert.doesNotMatch(js,/ChangeMeNow!/);
});

test('Security supports active-session review and revocation using fingerprints',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.match(html,/id="security-sessions-body"/);
  assert.match(js,/\/api\/security\/sessions"/);
  assert.match(js,/\/api\/security\/sessions\/revoke/);
  assert.match(js,/fingerprint/);
  assert.match(js,/Current session/);
});

test('Security audit view includes configuration change history',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.match(html,/Configuration Change History/);
  assert.match(html,/id="security-config-history-body"/);
  assert.match(js,/\/api\/security\/config-history/);
  assert.match(js,/renderSecurityConfigHistory/);
});

test('User deletion is presented as secondary to disable and is not reversible with a shared temporary password',()=>{
  const js=read('security.js');
  assert.match(js,/Delete Permanently/);
  assert.match(js,/Disabling the account is preferred/);
  assert.doesNotMatch(js,/Undo Delete/);
  assert.doesNotMatch(js,/ChangeMeNow!/);
});

test('Lifecycle UI continues to use the narrowed Security CSP',()=>{
  const html=read('security.html');
  assert.match(html,/script-src 'self';/);
  assert.match(html,/connect-src 'self' https:\/\/visionbank-security\.ahmedadeyemi\.workers\.dev;/);
  assert.match(html,/frame-src 'none';/);
});

test('R8 backend release contract is versioned with exact production hashes and lifecycle routes',()=>{
  const manifest=JSON.parse(read('scripts/security-admin-lifecycle-r8.manifest.json'));
  const patch=read('scripts/security-admin-lifecycle-r8.patch');
  assert.equal(manifest.baseWorkerVersion,'377658f7-1498-434d-b205-6fdb53695b1b');
  assert.equal(manifest.baseMainSha256,'7374f191d254ccb2c5d738ec41a462035d9c441f6eaa257d139665f164b1e034');
  assert.equal(manifest.r8WorkerVersion,'2b8151b4-677b-4d93-a0ba-bdf3eead2dbc');
  assert.equal(manifest.r8MainSha256,'93dae62ff04efc0f10c79840df680c962ddd15a26ef21c1232a24538978294fb');
  assert.equal(manifest.bindings,37);
  assert.equal(manifest.modules,15);
  for(const marker of [
    '/api/users/status',
    '/api/security/config-history',
    '/api/security/sessions',
    '/api/security/sessions/revoke',
    'sessionInvalidBefore',
    'lastSuccessfulLoginAt',
    'lastFailedLoginAt',
    'SECURITY_SESSION_INDEX_PREFIX'
  ]) assert.ok(patch.includes(marker),'missing R8 backend marker '+marker);
  assert.doesNotMatch(patch,/ChangeMeNow!/);
});
