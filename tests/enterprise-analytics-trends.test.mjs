import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');

test('enterprise analytics adds hourly, day-over-day and week-over-week views after Demand & Trends',()=>{
  const html=read('webex.html');
  const tabs=[...html.matchAll(/data-ea-tab="([^"]+)"/g)].map(m=>m[1]);
  assert.deepEqual(tabs.slice(0,6),['overview','people','demand','hourly','daycompare','weekcompare']);
  for(const view of ['hourly','daycompare','weekcompare']) assert.match(html,new RegExp('data-ea-view="'+view+'"'));
  assert.match(html,/Activity by Hour/);
  assert.match(html,/Today vs Yesterday/);
  assert.match(html,/This Week vs Last Week/);
});

test('hourly activity explicitly separates Chat, CEG Queue inbound, and outbound calls',()=>{
  const html=read('webex.html');
  const js=read('webex-enterprise-analytics.js');
  assert.match(html,/Inbound — CEG Queue/);
  assert.match(html,/Outbound Calls/);
  assert.match(html,/Activity by hour — today/);
  for(const key of ['chat','inboundCeg','outbound']) assert.ok(js.includes(key),'missing trend key '+key);
  assert.match(html,/Busiest combined hour/);
});

test('comparisons use same elapsed Central-time windows rather than misleading full-period comparisons',()=>{
  const html=read('webex.html');
  assert.match(html,/yesterday through the same time of day/);
  assert.match(html,/same elapsed Central Time period last week/);
  const js=read('webex-enterprise-analytics.js');
  assert.match(js,/periods\.yesterday/);
  assert.match(js,/periods\.lastWeek/);
});

test('historical trend endpoint is lazy-loaded only for the new tabs',()=>{
  const js=read('webex-enterprise-analytics.js');
  assert.match(js,/TREND_TABS = new Set\(\["hourly", "daycompare", "weekcompare"\]\)/);
  assert.match(js,/if \(TREND_TABS\.has\(tab\)\) void refreshTrends\(false\)/);
  assert.doesNotMatch(js,/function init\(\)[\s\S]{0,300}refreshTrends/);
});

test('trend frontend accepts aggregate data only and never renders contact or customer identifiers',()=>{
  const js=read('webex-enterprise-analytics.js');
  assert.match(js,/validTotals/);
  assert.match(js,/hourlyToday/);
  assert.match(js,/weekDays/);
  assert.doesNotMatch(js,/\.contactId|\.ani|\.dnis|customerName/);
});

test('authenticated fetch bridge recognizes the aggregate trends endpoint',()=>{
  assert.match(read('portal-auth-fetch.js'),/\/api\/webex\/analytics-trends/);
});

test('enterprise analytics assets are cache-busted for the trend release',()=>{
  const html=read('webex.html');
  assert.match(html,/webex-enterprise-analytics\.css\?v=20261005-enterprise2/);
  assert.match(html,/webex-enterprise-analytics\.js\?v=20261005-enterprise2/);
});

test('production trends backend contract is versioned and aggregate-only',()=>{
  const manifest=JSON.parse(read('scripts/webex-enterprise-trends-v1.manifest.json'));
  const patch=read('scripts/webex-enterprise-trends-v1.patch');
  assert.equal(manifest.baseWorkerVersion,'2b8151b4-677b-4d93-a0ba-bdf3eead2dbc');
  assert.equal(manifest.trendsWorkerVersion,'8920d623-ec31-4645-aeb4-b7c44f0ee1f8');
  assert.equal(manifest.trendsMainSha256,'a2e682ff99bf8af2ab5c51053773039ea7eaf4c4e402594906e105b8c24e33f8');
  assert.equal(manifest.bindings,37);
  assert.equal(manifest.modules,15);
  assert.equal(manifest.endpoint,'/api/webex/analytics-trends');
  for(const marker of [
    'handleWebexAnalyticsTrends',
    'buildWebexAnalyticsTrends',
    'VB_TRENDS_MAX_PAGES',
    'VB_TRENDS_MAX_ROWS',
    'aggregateOnly:true',
    'firstQueueName',
    'CEG Queue'
  ]) assert.ok(patch.includes(marker),'missing backend marker '+marker);
  for(const forbidden of ['ani:','dnis:','customerName','contactId','agentName','sessionId'])
    assert.ok(!patch.includes(forbidden),'sensitive field leaked into trends patch: '+forbidden);
});
