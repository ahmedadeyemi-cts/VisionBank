import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const hardener=fs.readFileSync(new URL('../scripts/harden-legacy-security-r2.mjs',import.meta.url),'utf8');
const frontends=['fax.js','voicemails.js','agents.js','directory.js'].map(name=>[name,fs.readFileSync(new URL('../'+name,import.meta.url),'utf8')]);

test('R2 converts operational human routes from network-only to authenticated role policies',()=>{
  for(const route of [
    '/api/directory/get','/api/directory/save','/api/fax/cdrsearch','/api/fax/schedule/get',
    '/api/fax/schedule/save','/api/fax/send-daily','/api/voicemails/report',
    '/api/voicemails/schedule/get','/api/voicemails/schedule/save','/api/voicemails/send-daily',
    '/api/agents/settings/get','/api/agents/settings/save','/api/agents/current',
    '/api/agents/logout/settings','/api/agents/logout/settings/save','/api/transcriptions/report'
  ]) assert.ok(hardener.includes(route),'missing '+route);
  assert.match(hardener,/function legacyNetworkOnlyRoute\(path, method\) \{\s*return false;/);
  assert.ok(hardener.includes('path.startsWith("/api/voicecall/details/")'));
});

test('Fax Voicemail Agents and Directory attach bearer session to protected APIs',()=>{
  const portalSession=fs.readFileSync(new URL('../portal-session.js',import.meta.url),'utf8');
  assert.match(portalSession,/Authorization: "Bearer " \+ session/);
  for(const [name,source] of frontends){
    assert.match(source,/function authHeaders\(/,name+' missing authHeaders');
    assert.match(source,/VBPortalSession\?\.authHeaders/,name+' does not use centralized bearer session');
    assert.ok(source.includes('/api/logout'),name+' missing server-side logout');
  }
  const fax=frontends.find(([n])=>n==='fax.js')[1];
  assert.ok(fax.includes('REPORT_API}?range=${encodeURIComponent(range)}`, { headers: authHeaders() }'));
  assert.ok(fax.includes('/api/fax/schedule/get`, { headers: authHeaders() }'));
  const voicemail=frontends.find(([n])=>n==='voicemails.js')[1];
  assert.ok(voicemail.includes('REPORT_API}?range=${encodeURIComponent(range)}`, { headers: authHeaders() }'));
  assert.ok(voicemail.includes('/api/voicecall/details/${encodeURIComponent(callId)}`, { headers: authHeaders() }'));
  const agents=frontends.find(([n])=>n==='agents.js')[1];
  assert.ok(agents.includes('/api/agents/current`, { headers: authHeaders() }'));
  const directory=frontends.find(([n])=>n==='directory.js')[1];
  assert.ok(directory.includes('/api/directory/get`, { headers: authHeaders() }'));
});

test('Login and security-check calls remain available before an authenticated session exists',()=>{
  for(const [name,source] of frontends){
    assert.ok(source.includes('/api/login'),name+' missing login');
    assert.ok(source.includes('/security/check'),name+' missing security check');
  }
});
