import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read=n=>fs.readFileSync(new URL('../'+n,import.meta.url),'utf8');

function reportApi(){
  const window={VB_SECURITY:{allowed:true}};
  const document={readyState:'loading',getElementById:()=>null,querySelectorAll:()=>[],addEventListener(){}};
  vm.runInNewContext(read('webex-reports.js'),{window,document,Intl,Date,Number,console});
  return window.VB_WEBEX_REPORTS_TEST;
}

const row=(contactId,ani,dnis,start,end,extra={})=>({
  contactId,ani,dnis,startEpoch:start,endEpoch:end,
  startTimeCentral:'10/06/2026, 10:00:00 AM CDT',
  agentName:'-',...extra
});

test('same ANI and same called number answered later is confirmed helped',()=>{
  const api=reportApi();
  const abandoned=[row('a1','+1 (515) 555-0101','+15153295439',100,200)];
  const answered=[row('x1','5155550101','5153295439',250,300,{agentName:'Matt Saylor | CEG',startTimeCentral:'10/06/2026, 10:05:00 AM CDT'})];
  const result=api.correlateAbandonedFollowups(abandoned,answered)[0];
  assert.equal(result.followupCode,'helped');
  assert.equal(result.followupAgent,'Matt Saylor | CEG');
  assert.equal(result.followupEpoch,250);
  assert.match(result.followupDetail,/Same ANI and called number/);
});

test('same ANI and same destination abandoned again stays unresolved',()=>{
  const api=reportApi();
  const original=row('a1','+15155550102','5153295439',100,200);
  const retry=row('a2','5155550102','+15153295439',300,350);
  const results=api.correlateAbandonedFollowups([original,retry],[]);
  assert.equal(results.find(x=>x.contactId==='a1').followupCode,'returned-unresolved');
  assert.equal(results.find(x=>x.contactId==='a2').followupCode,'needs-followup');
});

test('same ANI with a different called number is review-only and never auto-cleared',()=>{
  const api=reportApi();
  const abandoned=[row('a1','5155550103','5153295439',100,200)];
  const answered=[row('x1','+15155550103','5157770000',250,300,{agentName:'Agent One'})];
  const result=api.correlateAbandonedFollowups(abandoned,answered)[0];
  assert.equal(result.followupCode,'review');
  assert.match(result.followupDetail,/called number differs/);
});

test('an earlier or overlapping answered contact does not count as a return call',()=>{
  const api=reportApi();
  const abandoned=[row('a1','5155550104','5153295439',200,400)];
  const answered=[
    row('x1','5155550104','5153295439',100,190,{agentName:'Earlier'}),
    row('x2','5155550104','5153295439',350,500,{agentName:'Overlapping'})
  ];
  const result=api.correlateAbandonedFollowups(abandoned,answered)[0];
  assert.equal(result.followupCode,'needs-followup');
});

test('a later confirmed answer wins even when the caller abandoned again first',()=>{
  const api=reportApi();
  const original=row('a1','5155550105','5153295439',100,200);
  const second=row('a2','5155550105','5153295439',250,300);
  const answered=[row('x1','5155550105','5153295439',350,450,{agentName:'Agent Two'})];
  const result=api.correlateAbandonedFollowups([original,second],answered);
  assert.equal(result.find(x=>x.contactId==='a1').followupCode,'helped');
  assert.equal(result.find(x=>x.contactId==='a2').followupCode,'helped');
});

test('phone normalization accepts common US formatting without guessing withheld numbers',()=>{
  const api=reportApi();
  assert.equal(api.phoneKey('+1 (515) 555-0106'),'5155550106');
  assert.equal(api.phoneKey('515-555-0106'),'5155550106');
  assert.equal(api.phoneKey('Private'),'');
});

test('abandoned-call UI exposes status/filter/time/agent columns and callback selection excludes confirmed helped',()=>{
  const html=read('webex.html');
  const selection=read('webex-abandoned-selection.js');
  assert.match(html,/id="abandonedFollowupFilter"/);
  assert.match(html,/id="abandonedFollowupSummary"/);
  for(const title of ['Follow-up Status','Return Call Time','Handled By']) assert.ok(html.includes(title));
  assert.match(selection,/row\.followupCode !== 'helped'/);
  assert.match(selection,/tr\.cells\.length !== 11/);
  assert.match(selection,/colspan', '14'/);
  assert.match(selection,/Called back — helped/);
});

test('follow-up styling uses status text plus semantic color instead of color alone',()=>{
  const css=read('webex-reports.css');
  for(const marker of [
    '.vb-followup-status-needs-followup',
    '.vb-followup-status-returned-unresolved',
    '.vb-followup-status-helped',
    '.vb-followup-status-review',
    '.vb-followup-row-helped',
    '.vb-followup-row-needs-followup'
  ]) assert.ok(css.includes(marker),'missing '+marker);
  assert.match(css,/vb-followup-status-helped[\s\S]*#05603a/);
  assert.match(css,/body\.enterprise-dark \.vb-followup-status-helped/);
});

test('report and callback assets are cache-busted for follow-up correlation',()=>{
  const html=read('webex.html');
  assert.match(html,/webex-reports\.css\?v=20261006-followup1/);
  assert.match(html,/webex-reports\.js\?v=20261006-followup1/);
  assert.match(html,/webex-abandoned-selection\.js\?v=20261006-followup1/);
});
