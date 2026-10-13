import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('handled Chat customer names distinguish loading, not-reported and transient failure states',()=>{
  const js=read('webex-integrated-chat.js');
  assert.match(js,/if\(!entry\)return 'Loading…'/);
  assert.match(js,/entry\.status==='not-reported'\)return 'Not reported'/);
  assert.match(js,/entry\.status==='error'\)return 'Temporarily unavailable'/);
  assert.match(js,/retryAfterMs\(res\.headers\.get\('Retry-After'\)\)/);
  assert.doesNotMatch(js,/nextNameAttempt=Date\.now\(\)\+60000/);
  assert.match(js,/Math\.min\(30000,Math\.max\(3000,retryMs\)\)/);
});

test('Chat Agent Performance exposes active-session offered and missed/RONA counters without inventing zeros',()=>{
  const js=read('webex-integrated-chat.js');
  assert.match(js,/row\.offeredSession = sessionFresh && Number\.isSafeInteger\(a\.chatChannel\?\.offeredCount\)/);
  assert.match(js,/row\.missedSession = sessionFresh && Number\.isSafeInteger\(a\.chatChannel\?\.missedCount\)/);
  assert.match(js,/row\.ronaSession = sessionFresh && Number\.isSafeInteger\(a\.chatChannel\?\.ronaCount\)/);
  assert.match(js,/\['Offered \(today\)'/);
  assert.match(js,/\['Missed \/ RONA \(today\)'/);
  assert.match(js,/Not reported/);
  assert.match(js,/Today includes all reported sessions/);
});

test('missed Chat cells use semantic text plus a visible alert treatment in both themes',()=>{
  const js=read('webex-integrated-chat.js');
  const css=read('webex-integrated-chat.css');
  assert.match(js,/data-vb-chat-missed=/);
  assert.match(css,/#chat-agents-body td\[data-vb-chat-missed="true"\]/);
  assert.match(css,/background: #fee4e2 !important/);
  assert.match(css,/body\.enterprise-dark #chat-agents-body td\[data-vb-chat-missed="true"\]/);
  assert.match(css,/background: #4a1d1a !important/);
});

test('month comparison markup and frontend rendering are complete',()=>{
  const html=read('webex.html');
  const js=read('webex-enterprise-analytics.js');
  assert.match(html,/data-ea-tab="monthcompare">This Month vs Last Month/);
  assert.match(html,/data-ea-view="monthcompare"/);
  assert.match(html,/id="eaMonthCompareCards"/);
  assert.match(html,/id="eaMonthCompareRows"/);
  assert.match(js,/validTotals\(d\.periods\?\.thisMonth\?\.totals\)/);
  assert.match(js,/validTotals\(d\.periods\?\.lastMonth\?\.totals\)/);
  assert.match(js,/function renderMonthComparison\(\)/);
  assert.match(js,/renderCompareCards\("eaMonthCompareCards"/);
  assert.match(js,/renderCompareRows\("eaMonthCompareRows"/);
});

test('production Worker release manifest preserves runtime shape and keeps analytics aggregate-only',()=>{
  const manifest=JSON.parse(read('scripts/webex-chat-monthly-metrics-v1.manifest.json'));
  const patch=read('scripts/webex-chat-monthly-metrics-v1.patch');
  assert.equal(manifest.baseWorkerVersion,'34136d00-d8fa-4707-915b-b8a49ba03f4b');
  assert.equal(manifest.workerVersion,'db5b4d8d-1469-4cf8-b1e7-2ed25a1bfd01');
  assert.equal(manifest.mainSha256,'c5ec914c34667bcb9a9fc9b51be14c980c9c8fcfc9eb3010858feb6feaaf84b4');
  assert.equal(manifest.bindings,39);
  assert.equal(manifest.modules,17);
  for(const marker of ['thisMonth','lastMonth','customer-names-r7','offeredCount:ringingCount','missedCount'])
    assert.ok(patch.includes(marker),'missing release marker '+marker);
  const trends=patch.slice(patch.indexOf('vbTrendMonthStart'),patch.indexOf('async function handleWebexDailyReports'));
  for(const forbidden of ['ani:','dnis:','customerName','agentName'])
    assert.ok(!trends.includes(forbidden),'historical analytics leaked '+forbidden);
});

test('asset versions force browsers to load the customer-name, Chat metrics and month release',()=>{
  const html=read('webex.html');
  assert.match(html,/webex-integrated-chat\.css\?v=20261013-chatmetrics1/);
  assert.match(html,/webex-integrated-chat\.js\?v=20261013-chatperiod1/);
  assert.match(html,/webex-enterprise-analytics\.css\?v=20261013-enterprise4/);
  assert.match(html,/webex-enterprise-analytics\.js\?v=20261013-enterprise4/);
});
