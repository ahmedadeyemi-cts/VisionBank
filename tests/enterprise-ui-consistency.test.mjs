import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Security and Directory use the Device Manager enterprise visual tokens',()=>{
  const device=read('device.css');
  const security=read('security.css');
  const directory=read('directory.css');
  for(const css of [device,security,directory]){
    assert.match(css,/--vb-green\s*:\s*#185342/i);
    assert.match(css,/--vb-green-2\s*:\s*#0f3f32/i);
  }
  assert.match(security,/VisionBank enterprise alignment/);
  assert.match(directory,/VisionBank enterprise alignment/);
});

test('Security and Directory keep administrative CSP scope narrow',()=>{
  for(const name of ['security.html','directory.html']){
    const html=read(name);
    assert.match(html,/script-src 'self';/);
    assert.match(html,/connect-src 'self' https:\/\/visionbank-security\.ahmedadeyemi\.workers\.dev;/);
    assert.match(html,/frame-src 'none';/);
    assert.match(html,/media-src 'none';/);
    assert.doesNotMatch(html,/script-src[^;]*chat-widget/i);
  }
});

test('enterprise pages expose an active navigation state without changing routes',()=>{
  assert.match(read('security.html'),/<a href="security" aria-current="page">Security<\/a>/);
  assert.match(read('directory.html'),/<a href="directory\.html" aria-current="page">Directory<\/a>/);
});

test('Directory delete action uses delegated script handling instead of inline JavaScript',()=>{
  const source=read('directory.js');
  assert.doesNotMatch(source,/onclick\s*=/i);
  assert.match(source,/data-directory-delete/);
  assert.match(source,/directoryTableBody\?\.addEventListener\("click"/);
});
