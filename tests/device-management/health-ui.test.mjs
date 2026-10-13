import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const js=fs.readFileSync('device.js','utf8');
const css=fs.readFileSync('device.css','utf8');

test('Integration Health renders cause and recommended action details',()=>{
  assert.match(js,/device-health-check-detail/);
  assert.match(js,/Cause:<\/b>/);
  assert.match(js,/Recommended action:<\/b>/);
  assert.match(js,/item\?\.severity/);
});

test('Device Manager dark mode explicitly styles Integration Health surfaces and controls',()=>{
  assert.match(css,/body\.enterprise-dark \.device-health-grid article/);
  assert.match(css,/body\.enterprise-dark \.device-health-check/);
  assert.match(css,/body\.enterprise-dark \.device-filter-grid input/);
  assert.match(css,/body\.enterprise-dark \.device-table th/);
  assert.match(css,/--vb-text:#e9f2ee/);
});
