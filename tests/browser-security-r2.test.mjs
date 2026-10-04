import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const htmlFiles=['agents.html','device.html','directory.html','fax.html','index.html','security.html','voicemails.html','webex-agent.html','webex.html'];
const sessionFiles=['agents.js','device.js','directory.js','fax.js','security.js','voicemails.js','webex-agent.js'];

test('all portal HTML entry points use a strict script CSP and referrer policy',()=>{
  for(const name of htmlFiles){
    const source=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.match(source,/Content-Security-Policy/,'missing CSP in '+name);
    assert.match(source,/script-src 'self'/,'script-src should be same-origin in '+name);
    assert.match(source,/object-src 'none'/,'object-src should be none in '+name);
    assert.match(source,/base-uri 'self'/,'base-uri should be self in '+name);
    assert.match(source,/name="referrer" content="strict-origin-when-cross-origin"/,'missing referrer policy in '+name);
    assert.doesNotMatch(source,/<script>\s*/,'inline script block found in '+name);
    assert.doesNotMatch(source,/\son(?:click|load|error|change|submit|input|keydown|keyup|focus|blur)=/i,'inline event handler found in '+name);
  }
});

test('Security bearer session is centralized in portal-session and no longer written directly to localStorage',()=>{
  const helper=fs.readFileSync(new URL('../portal-session.js',import.meta.url),'utf8');
  assert.match(helper,/sessionStorage\.setItem\(KEY/);
  assert.match(helper,/localStorage\.removeItem\(KEY/);
  assert.match(helper,/migrateLegacy/);
  for(const name of sessionFiles){
    const source=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.doesNotMatch(source,/localStorage\.(?:getItem|setItem|removeItem)\(VB_SESSION_KEY/,'direct persistent session access in '+name);
    assert.doesNotMatch(source,/localStorage\.getItem\("vb_session"/,'direct persistent session access in '+name);
  }
});

test('dashboard security precheck is externalized and avoids innerHTML construction',()=>{
  const source=fs.readFileSync(new URL('../portal-security-precheck.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/\.innerHTML\s*=/);
  assert.match(source,/textContent/);
  for(const name of ['index.html','webex.html']){
    const html=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
    assert.match(html,/portal-security-precheck\.js/);
  }
});
