import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const portalPages=['index.html','webex.html','webex-agent.html','agents.html','voicemails.html','fax.html','directory.html','device.html'];

test('all non-Security portal pages load the shared enterprise shell exactly once',()=>{
  for(const page of portalPages){
    const html=read(page);
    assert.equal((html.match(/portal-enterprise\.css\?v=20261005-shell4/g)||[]).length,1,page+' shared CSS');
    assert.equal((html.match(/portal-enterprise\.js\?v=20261005-shell4/g)||[]).length,1,page+' shared JS');
  }
});

test('shared shell covers every portal header family and every dark-mode convention',()=>{
  const css=read('portal-enterprise.css');
  for(const selector of ['.header','.vb-header','.page-header','.device-header','.portal-nav','.login-card','.footer','.device-footer']){
    assert.ok(css.includes(selector),'missing shell selector '+selector);
  }
  for(const mode of ['body.theme-dark','body.dark-mode','body.dark','body.enterprise-dark']){
    assert.ok(css.includes(mode),'missing dark selector '+mode);
  }
  assert.match(css,/--vb-shell-green:\s*#185342/);
  assert.match(css,/--vb-shell-green-2:\s*#0f3f32/);
});

test('shared theme bridge synchronizes portal theme while preserving page-specific storage',()=>{
  const js=read('portal-enterprise.js');
  assert.match(js,/vb_portal_theme/);
  for(const key of [
    'dashboard-dark-mode','vb_webex_agents_theme','vb_agents_theme',
    'vb_voicemail_theme','vb_fax_theme','vb_theme','vb_device_theme'
  ]) assert.ok(js.includes(key),'missing legacy theme key '+key);
  assert.match(js,/MutationObserver/);
  assert.match(js,/markActiveNavigation/);
});

test('Security participates in the common portal theme without loading the shared shell stylesheet',()=>{
  const html=read('security.html');
  const js=read('security.js');
  assert.doesNotMatch(html,/portal-enterprise\.css/);
  assert.match(js,/vb_portal_theme/);
  assert.match(html,/security\.js\?v=20261004-console4/);
});

test('Dashboard and Webex Dashboard do not expose cross-portal navigation tabs',()=>{
  for(const page of ['index.html','webex.html']){
    const html=read(page);
    assert.doesNotMatch(html,/<nav class="portal-nav"/,page+' must not show portal navigation');
    assert.match(html,/class="header-right dashboard-header-actions"/,page+' keeps dashboard-only actions');
  }
});

test('dashboard theme controls are in enterprise headers and remain unique',()=>{
  for(const page of ['index.html','webex.html']){
    const html=read(page);
    assert.equal((html.match(/id="darkModeToggle"/g)||[]).length,1,page+' unique dark toggle');
    const headerEnd=html.indexOf('</header>');
    const buttonPos=html.indexOf('id="darkModeToggle"');
    const footerPos=html.indexOf('<footer');
    assert.ok(buttonPos>0&&buttonPos<headerEnd,page+' toggle in header');
    assert.ok(footerPos>headerEnd,page+' footer after header');
  }
});

test('Device Manager keeps its enterprise theme control and version-pins the current device workflow script',()=>{
  const html=read('device.html');
  assert.match(html,/id="deviceThemeToggle"[^>]*data-enterprise-theme-toggle/);
  assert.match(html,/device\.js\?v=20261005-yealink3/);
});

test('enterprise shell adds no new remote script or stylesheet dependency',()=>{
  const css=read('portal-enterprise.css');
  const js=read('portal-enterprise.js');
  assert.doesNotMatch(css,/https?:\/\//i);
  assert.doesNotMatch(js,/https?:\/\//i);
});

test('portal CSPs continue to allow same-origin shell assets without adding unsafe script execution',()=>{
  for(const page of portalPages){
    const html=read(page);
    const csp=html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1]||'';
    assert.match(csp,/script-src 'self'/,page+' same-origin script CSP');
    assert.doesNotMatch(csp,/script-src[^;]*'unsafe-inline'/,page+' no unsafe-inline script');
  }
});

test('dashboard action buttons override legacy fixed positioning so controls cannot overlap',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/\.dashboard-header-actions[\s\S]*enterprise-header-tools > button[\s\S]*position:\s*static !important/);
  assert.match(css,/gap:\s*12px !important/);
  assert.match(css,/white-space:\s*nowrap !important/);
  assert.match(css,/min-width:\s*max-content !important/);
});

test('theme bridge derives state from the page-specific dark class so light mode clears the enterprise dark shell',()=>{
  const js=read('portal-enterprise.js');
  assert.match(js,/function detectPageDark\(\)/);
  assert.match(js,/return body\.classList\.contains\(profile\.bodyClass\)/);
  assert.match(js,/body\.classList\.toggle\("enterprise-light", !dark\)/);
  assert.doesNotMatch(js,/return body\.classList\.contains\("theme-dark"\) \|\|/);
});

test('shared shell explicitly restores high-contrast table colors in both light and dark themes',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/body\.enterprise-light \.data-table tbody td:not\(\.availability-cell\)/);
  assert.match(css,/background:\s*#ffffff !important/);
  assert.match(css,/color:\s*#15231e !important/);
  assert.match(css,/body\.enterprise-dark \.data-table tbody td:not\(\.availability-cell\)/);
  assert.match(css,/background:\s*#0d1b16 !important/);
  assert.match(css,/color:\s*#e8f0ed !important/);
});

test('shared shell removes remaining legacy blue Webex surfaces in dark mode',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/body\.enterprise-dark \.vb-ops[\s\S]*--vo-card:\s*#0b1713 !important/);
  assert.match(css,/body\.enterprise-dark \.daily-report-table tbody td[\s\S]*background:\s*#0b1713 !important/);
  assert.match(css,/:is\(#agent-body,#chat-agents-body\) td\.vb-channel-cell[\s\S]*background:\s*#0b1713 !important/);
  assert.match(css,/body\.enterprise-dark #dailyOperatingModeNotice[\s\S]*background:\s*#10231c !important/);
});

test('VisionBank green primary actions always use white text for accessibility',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/\.ea-tab\.active[\s\S]*background:\s*#185342 !important[\s\S]*color:\s*#ffffff !important/);
  assert.match(css,/\.daily-report-button:not\(\.secondary\)[\s\S]*color:\s*#ffffff !important/);
  assert.match(css,/\.vb-callback-settings-btn[\s\S]*color:\s*#ffffff !important/);
});

test('operational agent-state colors remain visible in both light and dark themes',()=>{
  const css=read('portal-enterprise.css');
  for(const marker of [
    '--vb-status-available: #15803d',
    '--vb-status-engaged: #d92d20',
    '--vb-status-idle: #facc15',
    '--vb-status-wrap: #c2410c',
    'status-available',
    'status-oncall',
    'status-break',
    'status-lunch',
    'status-wrap',
    '[data-vb-state="available"]',
    '[data-vb-state="engaged"]',
    '[data-vb-state="idle"]',
    '[data-vb-state="wrapup"]'
  ]) assert.ok(css.includes(marker),'missing state palette marker '+marker);
  assert.match(css,/status-available[\s\S]*color:\s*#ffffff !important/);
  assert.match(css,/status-oncall[\s\S]*color:\s*#ffffff !important/);
  assert.match(css,/status-break[\s\S]*color:\s*#332800 !important/);
  assert.match(css,/status-wrap[\s\S]*color:\s*#ffffff !important/);
});

test('generic enterprise dark table rules explicitly exclude availability cells',()=>{
  const css=read('portal-enterprise.css');
  assert.match(css,/body\.enterprise-dark \.data-table tbody td:not\(\.availability-cell\)/);
  assert.match(css,/#agent-body td:not\(\.availability-cell\):not\(\[data-state\]\):not\(\[data-vb-state\]\)/);
});
