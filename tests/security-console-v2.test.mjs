import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Security console is organized as an enterprise application with dedicated views',()=>{
  const html=read('security.html');
  for(const view of ['overview','identity','network','policy','audit','tools','device']){
    assert.match(html,new RegExp('data-security-view="'+view+'"'));
    assert.match(html,new RegExp('data-security-view-panel="'+view+'"'));
  }
  assert.match(html,/security-kpi-grid/);
  assert.match(html,/security-session-chip/);
  assert.doesNotMatch(html,/id="expand-all-btn"/);
  assert.doesNotMatch(html,/id="collapse-all-btn"/);
});

test('Security overview exposes posture, connection, policy, audit and Device Manager status',()=>{
  const html=read('security.html');
  for(const id of [
    'security-overview-posture','security-current-ip','security-overview-network',
    'security-overview-denied','security-overview-hours','security-overview-device'
  ]) assert.match(html,new RegExp('id="'+id+'"'));
});

test('Security console mirrors Device Manager admin controls through the existing backend',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.match(html,/id="security-device-verification-toggle"/);
  assert.match(html,/id="security-device-default-hours"/);
  assert.match(html,/id="security-device-duration-list"/);
  assert.match(html,/id="security-device-admin-list"/);
  for(const path of [
    '/admin-settings',
    '/admin-settings/verification',
    '/admin-settings/default-hours',
    '/admin-settings/durations/set',
    '/admin-settings/durations/remove',
    '/admin-settings/admins/add',
    '/admin-settings/admins/remove'
  ]) assert.ok(js.includes(path),'missing Device Manager path '+path);
  assert.match(js,/Authorization/);
});

test('Device Manager security controls remain restricted to Security admin roles',()=>{
  const js=read('security.js');
  assert.match(js,/superadmin:[\s\S]*deviceAdmin:\s*true/);
  assert.match(js,/admin:[\s\S]*deviceAdmin:\s*true/);
  assert.match(js,/analyst:[\s\S]*deviceAdmin:\s*false/);
  assert.match(js,/auditor:[\s\S]*deviceAdmin:\s*false/);
  assert.match(js,/view:[\s\S]*deviceAdmin:\s*false/);
});

test('Security audit interface supports local filtering without widening CSP',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.match(html,/id="audit-filter-query"/);
  assert.match(html,/id="audit-filter-outcome"/);
  assert.match(js,/function renderAuditLog\(\)/);
  assert.match(html,/script-src 'self';/);
  assert.match(html,/connect-src 'self' https:\/\/visionbank-security\.ahmedadeyemi\.workers\.dev;/);
});
