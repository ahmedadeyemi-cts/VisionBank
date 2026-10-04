import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hardener=fs.readFileSync(new URL('../scripts/harden-legacy-security-r3.mjs',import.meta.url),'utf8');
const dashboard=fs.readFileSync(new URL('../dashboard.js',import.meta.url),'utf8');
const security=fs.readFileSync(new URL('../security.js',import.meta.url),'utf8');
const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const webex=fs.readFileSync(new URL('../webex.html',import.meta.url),'utf8');
const pageAuth=fs.readFileSync(new URL('../portal-page-auth.js',import.meta.url),'utf8');
const authFetch=fs.readFileSync(new URL('../portal-auth-fetch.js',import.meta.url),'utf8');

test('main Dashboard no longer exposes the Contact Center API token or calls realtime API directly',()=>{
  assert.doesNotMatch(dashboard,/VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=/);
  assert.doesNotMatch(dashboard,/pop1-apps\.mycontactcenter\.net\/api\/v3\/realtime/);
  assert.match(dashboard,/\/api\/realtime/);
  assert.match(dashboard,/VBPortalSession\?\.authHeaders/);
});

test('R3 Worker hardener adds server-side realtime proxy using only CC_API_TOKEN secret',()=>{
  for(const route of ['/api/realtime/status/queues','/api/realtime/statistics/global','/api/realtime/status/agents'])
    assert.ok(hardener.includes(route),'missing '+route);
  assert.match(hardener,/env\.CC_API_TOKEN/);
  assert.match(hardener,/handlePortalRealtimeProxy/);
});

test('main Dashboard and Webex Dashboard require a validated portal session before use',()=>{
  for(const html of [index,webex]){
    assert.match(html,/portal-session\.js/);
    assert.match(html,/portal-auth-fetch\.js/);
    assert.match(html,/portal-page-auth\.js/);
  }
  assert.match(pageAuth,/\/api\/session\/status/);
  assert.match(pageAuth,/VBPortalSession\?\.clear/);
  assert.match(pageAuth,/vb_return_to/);
  assert.match(security,/consumePortalReturnTarget/);
});

test('authenticated fetch shim targets core dashboard/report APIs but leaves callback automation auth untouched',()=>{
  assert.match(authFetch,/\/api\/webex\/dashboard/);
  assert.match(authFetch,/\/api\/webex\/daily-reports/);
  assert.match(authFetch,/\/api\/realtime\//);
  assert.doesNotMatch(authFetch,/abandoned-callback/);
});

test('R3 session-status and Webex dashboard policies revalidate corporate identity server-side',()=>{
  assert.match(hardener,/\/api\/session\/status/);
  assert.match(hardener,/isApprovedPortalEmail\(user\.email\)/);
  for(const route of ['/api/webex/dashboard','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/dashboard/settings'])
    assert.ok(hardener.includes(route),'missing '+route);
});


test('browser assets do not contain hard-coded credential literals',()=>{
  const root=new URL('../',import.meta.url);
  const names=fs.readdirSync(root).filter(name=>/\.(?:js|html)$/.test(name));
  for(const name of names){
    const source=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/(?:const|let|var)\s+[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY)[A-Z0-9_]*\s*=\s*["'][^"']{12,}["']/i,'credential-like literal in '+name);
    assert.doesNotMatch(source,/Authorization\s*:\s*["'](?:Bearer|Basic)\s+[A-Za-z0-9+/=_-]{12,}/i,'literal Authorization credential in '+name);
  }
});
