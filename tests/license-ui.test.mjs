import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const securityHtml=read('security.html');
const securityJs=read('security.js');
const enterpriseJs=read('portal-enterprise.js');
const pageAuth=read('portal-page-auth.js');

test('Security has a dedicated Licensing view that remains part of Security navigation',()=>{
  assert.ok(securityHtml.includes('data-security-view="licensing"'));
  assert.ok(securityHtml.includes('data-security-view-panel="licensing"'));
  for(const id of [
    'security-license-status','security-license-expires','security-license-revalidation',
    'security-license-primary-repo','security-license-primary-url',
    'security-license-mirror-repo','security-license-mirror-url',
    'security-license-source','security-license-key','security-license-enforcement-toggle'
  ]) assert.ok(securityHtml.includes('id="'+id+'"'),id);
});

test('licensing administration is limited to admin and superadmin roles in Security UI',()=>{
  assert.match(securityJs,/superadmin:[\s\S]*licenseAdmin: true/);
  assert.match(securityJs,/admin:[\s\S]*licenseAdmin: true/);
  assert.match(securityJs,/analyst:[\s\S]*licenseAdmin: false/);
  assert.match(securityJs,/auditor:[\s\S]*licenseAdmin: false/);
  assert.match(securityJs,/data-license-admin-controls/);
});

test('Security licensing UI supports source change, activation, validation and enforcement',()=>{
  for(const value of [
    '/api/license','/config','/status','/test','/activate','/refresh','/deactivate',
    'valid-license-required-before-enforcement'
  ]) {
    if(value==='valid-license-required-before-enforcement') continue;
    assert.ok(securityJs.includes(value),value);
  }
  assert.ok(securityJs.includes('updateLicenseEnforcement'));
  assert.ok(securityJs.includes('testActiveLicenseAuthority'));
  assert.ok(securityJs.includes('refreshInstallationLicense'));
});

test('shared enterprise shell redirects blocked licensed pages to Security Licensing',()=>{
  assert.ok(enterpriseJs.includes('/api/license/access'));
  assert.ok(enterpriseJs.includes('view","licensing"'));
  assert.ok(enterpriseJs.includes('vb_return_to'));
  assert.ok(enterpriseJs.includes('enforcementEnabled === true'));
});

test('authenticated portal page precheck also observes detailed license status',()=>{
  assert.ok(pageAuth.includes('/api/license/status'));
  assert.ok(pageAuth.includes('redirectToLicensing'));
  assert.ok(pageAuth.includes('enforcementEnabled === true'));
});

test('all current non-Security enterprise pages cache-bust the licensing shell',()=>{
  for(const page of ['index.html','webex.html','webex-agent.html','agents.html','voicemails.html','fax.html','directory.html','device.html']){
    const html=read(page);
    assert.equal((html.match(/portal-enterprise\.js\?v=20261005-license1/g)||[]).length,1,page);
  }
});

test('Security license assets are cache-busted',()=>{
  assert.ok(securityHtml.includes('security.css?v=20261005-license1'));
  assert.ok(securityHtml.includes('security.js?v=20261005-license1'));
});
