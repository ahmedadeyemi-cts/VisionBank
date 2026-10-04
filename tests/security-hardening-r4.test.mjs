import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root=new URL('../',import.meta.url);
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('all primary portal pages carry CSP and no-referrer metadata',()=>{
  for(const name of ['agents.html','device.html','directory.html','fax.html','index.html','security.html','voicemails.html','webex-agent.html','webex.html']){
    const html=read(name);
    assert.match(html,/http-equiv="Content-Security-Policy"/,name+' missing CSP');
    assert.match(html,/object-src 'none'/,name+' CSP missing object-src none');
    assert.match(html,/base-uri 'self'/,name+' CSP missing base-uri');
    assert.match(html,/name="referrer" content="no-referrer"/,name+' missing no-referrer metadata');
  }
});

test('Render Blueprint defines response-layer security headers',()=>{
  const yaml=read('render.yaml');
  assert.match(yaml,/name: X-Frame-Options\s+value: DENY/);
  assert.match(yaml,/name: Referrer-Policy\s+value: no-referrer/);
  assert.match(yaml,/name: Permissions-Policy/);
  assert.match(yaml,/name: Content-Security-Policy/);
  assert.match(yaml,/frame-ancestors 'none'/);
  assert.match(yaml,/name: X-Content-Type-Options\s+value: nosniff/);
});

test('portal bearer session is kept in sessionStorage instead of persisted in localStorage',()=>{
  const source=read('portal-session.js');
  assert.match(source,/sessionStorage\.setItem\(KEY, token\)/);
  assert.doesNotMatch(source,/localStorage\.setItem\(KEY/);
  assert.match(source,/localStorage\.removeItem\(KEY\)/);
});

test('older operational tables escape API-provided values before innerHTML rendering',()=>{
  const agents=read('agents.js');
  const fax=read('fax.js');
  const voicemail=read('voicemails.js');

  for(const [name,source] of [['agents.js',agents],['fax.js',fax],['voicemails.js',voicemail]])
    assert.match(source,/function escapeHtml\(value\)/,name+' missing escapeHtml');

  assert.match(agents,/escapeHtml\(agent\.name/);
  assert.match(agents,/escapeHtml\(agent\.email|escapeHtml\(emailText/);
  assert.doesNotMatch(agents,/<td>\$\{agent\.name \|\|/);

  assert.match(fax,/escapeHtml\(row\.id/);
  assert.match(fax,/escapeHtml\(getCallerNumber\(row\)\)/);
  assert.match(fax,/escapeHtml\(s\.name/);
  assert.doesNotMatch(fax,/<td>\$\{row\.id \|\|/);

  assert.match(voicemail,/escapeHtml\(vm\.CallerName/);
  assert.match(voicemail,/escapeHtml\(disposition\.Notes/);
  assert.match(voicemail,/data-call-details=/);
  assert.doesNotMatch(voicemail,/onclick="showCallDetails/);
});

test('legacy and Webex queue tone controls render queue names with textContent',()=>{
  for(const name of ['dashboard.js','webex.js']){
    const source=read(name);
    assert.match(source,/label\.textContent = String\(name\)/,name+' does not render queue name safely');
    assert.match(source,/function safe\(value, fallback = "--"\)[\s\S]{0,180}escapeHtml/,name+' safe helper is not HTML-encoding');
  }
});
