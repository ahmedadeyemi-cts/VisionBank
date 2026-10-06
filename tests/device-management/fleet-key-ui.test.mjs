import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=rel=>fs.readFileSync(new URL('../../'+rel,import.meta.url),'utf8');
const deviceHtml=read('device.html'),deviceJs=read('device.js'),securityHtml=read('security.html'),securityJs=read('security.js');

test('Fleet Keys is an admin-only Device Manager view',()=>{
  assert.ok(deviceHtml.includes('id="deviceFleetTab"'));
  assert.ok(deviceHtml.includes('data-device-tab="fleet" hidden'));
  assert.ok(deviceHtml.includes('data-device-view="fleet" hidden'));
  assert.ok(deviceJs.includes('fleetTab.hidden=!adminAuthorized'));
  assert.ok(deviceJs.includes('if(tab==="fleet")void loadFleetKeys()'));
  assert.ok(deviceJs.includes('/admin-settings/fleet-keys'));
  assert.ok(deviceJs.includes('/admin-settings/fleet-keys/rotate'));
});

test('Security Device Management view includes Fleet Key status and rotation controls',()=>{
  for(const id of ['security-fleet-active-key','security-fleet-template-url','security-fleet-rotate','security-fleet-rows']){
    assert.ok(securityHtml.includes('id="'+id+'"'));
  }
  assert.ok(securityJs.includes('ROLE_RULES[ACTIVE_ROLE]?.deviceAdmin'));
  assert.ok(securityJs.includes('loadSecurityFleetKeys'));
  assert.ok(securityJs.includes('rotateSecurityFleetKey'));
});

test('public UI assets never hardcode the Fleet Key',()=>{
  for(const source of [deviceHtml,deviceJs,securityHtml,securityJs]){
    assert.equal(source.includes('GSYzrRP442bBBMpiAjuD'),false);
  }
});

test('Fleet Key UI assets are cache-busted',()=>{
  assert.ok(deviceHtml.includes('device.css?v=20261005-fleet1'));
  assert.ok(deviceHtml.includes('device.js?v=20261005-fleet1'));
  assert.ok(securityHtml.includes('security.css?v=20261005-license1'));
  assert.ok(securityHtml.includes('security.js?v=20261005-license1'));
});
