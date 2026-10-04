import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Security login and MFA are rewritten to IP-only access',()=>{
  const script=read('scripts/harden-legacy-security-r6.mjs');
  assert.ok(script.includes("'login-ip-only'"));
  assert.ok(script.includes("'mfa-setup-ip-only'"));
  assert.ok(script.includes("'mfa-confirm-ip-only'"));
  assert.ok(script.includes('checkIpOnly(request,env)'));
});

test('Security admin routes use authenticated IP-only policy so admins can repair business hours',()=>{
  const script=read('scripts/harden-legacy-security-r6.mjs');
  for(const path of ['/api/session/status','/api/users/list','/api/get-hours','/api/get-ip-rules','/api/set-hours','/api/set-ip-rules','/api/logs','/api/validate-ip'])
    assert.ok(script.includes(path),path+' missing from R6 hardener');
  assert.match(script,/policy\?\.access === "ip-only"/);
  assert.match(script,/policy\?\.session === false/);
});

test('IP-only access remains fail closed when no allowlist exists',()=>{
  const script=read('scripts/harden-legacy-security-r6.mjs');
  assert.ok(script.includes('rules.length > 0 &&'));
  assert.ok(script.includes("'ip-only-fail-closed'"));
});

test('Webex page returns to approved-connection precheck without forced Security-login redirect',()=>{
  const html=read('webex.html');
  assert.match(html,/portal-security-precheck\.js/);
  assert.match(html,/portal-session\.js/);
  assert.match(html,/portal-auth-fetch\.js/);
  assert.doesNotMatch(html,/portal-page-auth\.js/);
});

test('Webex read APIs can use approved network/business-hours access without a portal session',()=>{
  const script=read('scripts/harden-legacy-security-r6.mjs');
  assert.ok(script.includes('session: false'));
  assert.ok(script.includes('/api/realtime/status/queues'));
  assert.ok(script.includes('/api/webex/dashboard'));
  assert.ok(script.includes("'webex-realtime-network-read'"));
  assert.ok(script.includes("'webex-dashboard-network-read'"));
});
