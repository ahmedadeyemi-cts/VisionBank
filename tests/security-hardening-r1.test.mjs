import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const security=fs.readFileSync(new URL('../security.js',import.meta.url),'utf8');
const identity=fs.readFileSync(new URL('../device-management/identity.mjs',import.meta.url),'utf8');
const hardener=fs.readFileSync(new URL('../scripts/harden-legacy-security-r1.mjs',import.meta.url),'utf8');

test('Security Console sends authenticated sessions to protected admin APIs',()=>{
  for(const route of ['/api/get-hours','/api/set-hours','/api/get-ip-rules','/api/set-ip-rules','/api/logs','/api/users/list','/api/users/save','/api/users/delete','/api/users/reset-mfa']){
    const i=security.indexOf(route);
    assert.ok(i>=0,'missing '+route);
    const nearby=security.slice(Math.max(0,i-180),i+360);
    assert.match(nearby,/authHeaders|Authorization/,'missing auth header near '+route);
  }
});

test('Security Console user and IP renderers avoid stored-value innerHTML interpolation',()=>{
  assert.doesNotMatch(security,/\$\{u\.username\}/);
  assert.doesNotMatch(security,/\$\{u\.email/);
  assert.doesNotMatch(security,/\$\{rule\}\s*<\/div>/);
  assert.match(security,/td\.textContent = String\(value\)/);
  assert.match(security,/document\.createTextNode\(" " \+ rule\)/);
});

test('Device Manager operator policy is corporate-domain restricted with a hidden backend exception',()=>{
  assert.match(identity,/domain==='visionbank\.com'\|\|domain==='ussignal\.com'/);
  assert.match(identity,/PRIVATE_PORTAL_EMAIL_SHA256='[0-9a-f]{64}'/);
  assert.doesNotMatch(identity,/@gmail\.com/i);
  assert.match(identity,/operator-email-not-authorized/);
});

test('legacy Worker hardener gates admin APIs, hashes passwords and fails closed on an empty allowlist',()=>{
  assert.match(hardener,/legacySecurityRoutePolicy/);
  assert.match(hardener,/PASSWORD_SCHEME = "pbkdf2-sha256-v1"/);
  assert.match(hardener,/PASSWORD_ITERATIONS = 210000/);
  assert.match(hardener,/rules\.length > 0 && isIpAllowedWithCidrs/);
  assert.match(hardener,/mfa-setup-ticket-required/);
  assert.match(hardener,/safeUserForClient/);
  assert.match(hardener,/At least one approved network rule is required/);
});
