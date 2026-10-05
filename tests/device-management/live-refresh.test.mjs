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
  assert.match(html,/device\.js\?v=20261005-fleet1/);
  assert.equal((html.match(/device\.js\?v=20261005-fleet1/g)||[]).length,1);
});
