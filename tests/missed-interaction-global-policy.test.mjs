import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Dashboard Settings exposes an organization default while explicitly preserving agent override precedence',()=>{
  const html=read('webex.html');
  assert.match(html,/id="missedInteractionRecoverySettings"/);
  assert.match(html,/Missed Interaction Recovery — Organization Default/);
  assert.match(html,/id="missedInteractionRecoveryMode"/);
  assert.match(html,/id="missedInteractionRecoverySeconds"/);
  assert.match(html,/An agent's explicit Auto-ready override on that browser takes precedence/);
  assert.match(html,/Use organization default.*removes the local override/);
});

test('dashboard settings load and save missed-interaction organization policy',()=>{
  const js=read('webex.js');
  assert.match(js,/settings\.missedInteractionRecovery/);
  assert.match(js,/missedInteractionRecovery:\s*\{/);
  assert.match(js,/mode:\s*recoveryMode/);
  assert.match(js,/seconds:\s*recoverySeconds/);
  assert.match(js,/allowAgentOverride:\s*true/);
  assert.match(js,/recoverySeconds\.disabled = recoveryMode\?\.value === "webex-default"/);
  assert.match(js,/Existing agent overrides remain in effect/);
});

test('organization policy worker endpoint is read-only, minimal, and defaults to one-minute auto return',()=>{
  const patch=read('scripts/webex-global-missed-recovery-policy-v1.patch');
  const manifest=JSON.parse(read('scripts/webex-global-missed-recovery-policy-v1.manifest.json'));
  assert.equal(manifest.workerVersion,'2dfd7ce6-922d-4239-bb7b-b8b72ff5b74d');
  assert.equal(manifest.defaultMode,'auto-after-60');
  assert.equal(manifest.defaultSeconds,60);
  assert.equal(manifest.agentOverrideAllowed,true);
  assert.deepEqual(manifest.precedence,['agent browser override','organization dashboard default','desktop layout fallback']);
  assert.match(patch,/function vbMissedRecoverySettings/);
  assert.match(patch,/missedInteractionRecovery: vbMissedRecoverySettings\(\)/);
  assert.match(patch,/\/api\/webex\/agent-policy/);
  assert.match(patch,/"Access-Control-Allow-Origin": "\*"/);
  assert.match(patch,/Cache-Control": "no-store"/);
});

test('public Agent Desktop policy response does not expose private dashboard or identity data',()=>{
  const patch=read('scripts/webex-global-missed-recovery-policy-v1.patch');
  const start=patch.indexOf('async function handleWebexAgentPolicyGet');
  const end=patch.indexOf('async function handleWebexDashboardSettingsGet');
  const block=patch.slice(start,end);
  assert.ok(start>=0&&end>start);
  for(const forbidden of ['queueVisibility','agentId','username','email','token','secret'])
    assert.ok(!block.includes(forbidden),'policy response leaks '+forbidden);
});

test('dashboard asset version is bumped for the shared policy controls',()=>{
  const html=read('webex.html');
  assert.match(html,/webex\.css\?v=20261013-loginfilter1/);
  assert.match(html,/webex\.js\?v=20261013-loginfilter1/);
});
