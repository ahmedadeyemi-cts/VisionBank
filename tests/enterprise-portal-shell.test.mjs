import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const portalPages=['index.html','webex.html','webex-agent.html','agents.html','voicemails.html','fax.html','directory.html','device.html'];

test('all non-Security portal pages load the shared enterprise shell exactly once',()=>{
  for(const page of portalPages){
    const html=read(page);
    assert.equal((html.match(/portal-enterprise\.css\?v=20261004-shell1/g)||[]).length,1,page+' shared CSS');
    assert.equal((html.match(/portal-enterprise\.js\?v=20261004-shell1/g)||[]).length,1,page+' shared JS');
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

test('Device Manager gains a theme control without changing its device workflow script',()=>{
  const html=read('device.html');
  assert.match(html,/id="deviceThemeToggle"[^>]*data-enterprise-theme-toggle/);
  assert.match(html,/device\.js\?v=20261003-v21/);
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
