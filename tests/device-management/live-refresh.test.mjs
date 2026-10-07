import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../../device.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('../../device.html',import.meta.url),'utf8');

test('Device Manager live refresh is visibility-aware and bounded',()=>{
  assert.match(source,/locationMs:30_000/);
  assert.match(source,/summaryMs:60_000/);
  assert.match(source,/minResumeAgeMs:15_000/);
  assert.match(source,/document\.visibilityState==="hidden"/);
  assert.match(source,/anyDeviceDialogOpen\(\)/);
  assert.match(source,/loadInventory\(true\)/);
  assert.doesNotMatch(source,/setInterval\(/);
});

test('Device Manager stops polling while hidden and resumes when visible',()=>{
  assert.match(source,/pagehide",stopInventoryLiveRefresh/);
  assert.match(source,/pageshow",resumeInventoryLiveRefresh/);
  assert.match(source,/visibilitychange/);
  assert.match(source,/stopInventoryLiveRefresh\(\)/);
  assert.match(source,/resumeInventoryLiveRefresh\(\)/);
});

test('live refresh asset is cache-busted',()=>{
  assert.match(html,/device\.js\?v=20261007-t54w1/);
  assert.equal((html.match(/device\.js\?v=20261007-t54w1/g)||[]).length,1);
});


test('Line 2 lookup retries transient failures and remains retryable',()=>{
  assert.match(source,/memberLookupWithRetry/);
  assert.match(source,/attempts:initial\?3:2/);
  assert.match(source,/Retry Line 2 lookup/);
  assert.match(source,/not an admin permission issue/);
});
