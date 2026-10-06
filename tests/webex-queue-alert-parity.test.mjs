import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('Webex integrated queue renderer mirrors index waiting severity thresholds',()=>{
  const source=read('webex-integrated-chat.js');
  assert.match(source,/waiting===0\?'queue-calls-green':waiting===1\?'queue-calls-yellow':'queue-calls-red'/);
  assert.match(source,/waiting!==null&&waiting>0\?'queue-hot'/);
  assert.match(source,/waiting!==null&&waiting>=2\?' queue-critical'/);
  assert.match(source,/class="numeric vb-queue-waiting"/);
  assert.match(source,/queue-calls-badge \$\{waitingClass\}/);
});

test('Webex waiting badges use the same 0 green, 1 yellow, 2+ red visual contract in both themes',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/\.queue-calls-green[\s\S]*background:\s*#16a34a !important/);
  assert.match(css,/\.queue-calls-yellow[\s\S]*background:\s*#facc15 !important/);
  assert.match(css,/\.queue-calls-red[\s\S]*background:\s*#dc2626 !important/);
  assert.match(css,/\.queue-calls-yellow[\s\S]*color:\s*#332800 !important/);
  assert.match(css,/#queue-panel\.queue-alert-active[\s\S]*outline:\s*2px solid #f97316 !important/);
  assert.match(css,/tr\.queue-critical td\.vb-queue-waiting[\s\S]*#dc2626/);
});

test('Webex queue alert renderer is cache-busted for the parity fix',()=>{
  const html=read('webex.html');
  assert.match(html,/webex-integrated-chat\.js\?v=20261006-queue-alert1/);
  assert.match(html,/portal-enterprise\.css\?v=20261006-shell6/);
});
