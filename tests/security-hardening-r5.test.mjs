import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('MFA enrollment never sends the TOTP URI to an external QR service',()=>{
  const hardener=read('scripts/harden-legacy-security-r1.mjs');
  const security=read('security.js');
  const html=read('security.html');

  for(const source of [hardener,security,html]){
    assert.doesNotMatch(source,/api\.qrserver\.com/i);
    assert.doesNotMatch(source,/create-qr-code/i);
  }

  assert.match(hardener,/return json\(\{uri,secret,setupToken:ticket\.id\},cors\)/);
  assert.match(security,/renderLocalMfaQr\(data\.uri\)/);
  assert.match(html,/vendor\/qrcode-generator\.js\?v=1\.4\.4/);
});

test('vendored QR generator is local-only and does not execute dynamic code',()=>{
  const vendor=read('vendor/qrcode-generator.js');
  assert.match(vendor,/Copyright \(c\) 2009 Kazuhiko Arase/);
  assert.match(vendor,/Licensed under the MIT license/);
  assert.doesNotMatch(vendor,/\bfetch\s*\(/);
  assert.doesNotMatch(vendor,/XMLHttpRequest/);
  assert.doesNotMatch(vendor,/WebSocket/);
  assert.doesNotMatch(vendor,/\beval\s*\(/);
  assert.doesNotMatch(vendor,/new Function\s*\(/);
});

test('Security page CSP permits only same-origin local QR script',()=>{
  const html=read('security.html');
  assert.match(html,/script-src 'self'/);
  assert.doesNotMatch(html,/api\.qrserver\.com/i);
  assert.match(html,/vendor\/qrcode-generator\.js/);
});
