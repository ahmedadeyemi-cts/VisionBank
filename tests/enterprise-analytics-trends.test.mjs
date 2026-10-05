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

test('hourly activity explicitly separates Chat, inbound Voice, and outbound calls',()=>{
  const html=read('webex.html');
  const js=read('webex-enterprise-analytics.js');
  assert.match(html,/Inbound Calls/);
  assert.match(html,/same received-call cohort as Today's Answered Calls/);
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
  assert.match(html,/webex-enterprise-analytics\.css\?v=20261005-enterprise3/);
  assert.match(html,/webex-enterprise-analytics\.js\?v=20261005-enterprise3/);
});

test('production trends backend contract is versioned and aggregate-only',()=>{
  const manifest=JSON.parse(read('scripts/webex-enterprise-trends-v3.manifest.json'));
  const patch=read('scripts/webex-enterprise-trends-v3.patch');
  assert.equal(manifest.baseWorkerVersion,'8920d623-ec31-4645-aeb4-b7c44f0ee1f8');
  assert.equal(manifest.trendsWorkerVersion,'d4902941-ae61-40a8-bf36-96ecde16837e');
  assert.equal(manifest.trendsMainSha256,'5a162c69795ab09ecc72554333fd7bcca91bf29bda9bf168f06b84cb9f6518cb');
  assert.equal(manifest.bindings,37);
  assert.equal(manifest.modules,15);
  assert.equal(manifest.endpoint,'/api/webex/analytics-trends');
  for(const marker of [
    'return "inboundCeg"',
    'All inbound telephony contacts',
    'inboundDefinition'
  ]) assert.ok(patch.includes(marker),'missing v3 correction marker '+marker);
  for(const forbidden of ['ani:','dnis:','customerName','contactId','agentName','sessionId'])
    assert.ok(!patch.includes(forbidden),'sensitive field leaked into trends patch: '+forbidden);
});
