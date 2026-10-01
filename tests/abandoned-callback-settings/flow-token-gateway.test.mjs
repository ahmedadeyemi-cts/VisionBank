import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixtures.mjs';

test('dashboard-generated token authenticates through the public flow-policy path without scheduling',async()=>{
  const f=fixture();
  const generated=await f.request('flow-token-generate',{});
  assert.equal(generated.http,200);
  assert.match(generated.data.token,/^vbcbp_[0-9a-f]{64}$/);
  const probe=await f.request('flow-token-policy-test',{token:generated.data.token});
  assert.equal(probe.http,200);
  assert.equal(probe.data.authorized,true);
  assert.equal(probe.data.scheduled,false);
  assert.notEqual(probe.data.policyRouteStatus,401);
});

test('policy-path test rejects an invalid token and does not schedule',async()=>{
  const f=fixture();
  const probe=await f.request('flow-token-policy-test',{token:'vbcbp_'+'0'.repeat(64)});
  assert.equal(probe.http,200);
  assert.equal(probe.data.authorized,false);
  assert.equal(probe.data.scheduled,false);
  assert.equal(probe.data.policyRouteStatus,401);
});

test('token status distinguishes a separate legacy environment credential',async()=>{
  const f=fixture();
  f.env.CALLBACK_FLOW_POLICY_TOKEN='L'.repeat(48);
  const status=await f.request('flow-token-status');
  assert.equal(status.http,200);
  assert.equal(status.data.configured,false);
  assert.equal(status.data.legacyConfigured,true);
});

test('token POST routes enforce bounded JSON bodies before parsing',async()=>{
  const f=fixture();
  const oversized=await f.request('flow-token-policy-test',{token:'x'.repeat(700)});
  assert.equal(oversized.http,413);
  assert.equal(oversized.data.error,'body-too-large');
});
