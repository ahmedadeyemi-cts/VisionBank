import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {callbackWorkspaceDay,visibleWorkspacePlan,visibleWorkspaceRecord,needsWorkspaceReconcile} from '../../callback-settings/workspace.mjs';

const chicago=(iso)=>Date.parse(iso);
const today=chicago('2026-10-03T18:00:00Z');
const yesterday='2026-10-02',current='2026-10-03',tomorrow='2026-10-04';
const base={contactId:'10000000-0000-4000-8000-000000000001',createdAt:'2026-10-03T16:00:00.000Z',window:{date:current,startEpoch:today-60000,endEpoch:today+60000},status:'submission-pending',scheduleId:null};

test('workspace day uses America/Chicago calendar boundaries',()=>{
  assert.equal(callbackWorkspaceDay(Date.parse('2026-10-04T04:59:59Z')),'2026-10-03');
  assert.equal(callbackWorkspaceDay(Date.parse('2026-10-04T05:00:00Z')),'2026-10-04');
});

test('same-day incomplete callback is visible but does not carry into the next day',()=>{
  assert.equal(visibleWorkspaceRecord(base,today),true);
  assert.equal(visibleWorkspaceRecord(base,Date.parse('2026-10-04T18:00:00Z')),false);
});

test('confirmed callback scheduled for tomorrow remains visible on both days',()=>{
  const r={...base,status:'scheduled',scheduleId:'20000000-0000-4000-8000-000000000001',window:{...base.window,date:tomorrow,startEpoch:Date.parse('2026-10-04T16:00:00Z')}};
  assert.equal(visibleWorkspaceRecord(r,today),true);
  assert.equal(visibleWorkspaceRecord(r,Date.parse('2026-10-04T18:00:00Z')),true);
});

test('previous-day callback rows are removed from the active daily view without deleting history',()=>{
  const r={...base,status:'completed',scheduleId:'20000000-0000-4000-8000-000000000001',window:{...base.window,date:yesterday}};
  assert.equal(visibleWorkspaceRecord(r,today),false);
});

test('expired saved drafts are hidden while current and future drafts remain active',()=>{
  assert.equal(visibleWorkspacePlan({status:'draft',window:{date:yesterday}},today),false);
  assert.equal(visibleWorkspacePlan({status:'draft',window:{date:current}},today),true);
  assert.equal(visibleWorkspacePlan({status:'draft',window:{date:tomorrow}},today),true);
  assert.equal(visibleWorkspacePlan({status:'submitted',window:{date:tomorrow}},today),false);
});

test('only pending or due nonterminal records are automatically reconciled',()=>{
  assert.equal(needsWorkspaceReconcile(base,today),true);
  const scheduled={...base,status:'scheduled',scheduleId:'20000000-0000-4000-8000-000000000001'};
  assert.equal(needsWorkspaceReconcile(scheduled,today),true);
  assert.equal(needsWorkspaceReconcile({...scheduled,window:{...scheduled.window,startEpoch:today+600000}},today),false);
  assert.equal(needsWorkspaceReconcile({...scheduled,status:'completed'},today),false);
});


test('workspace pagination controls stay hidden until another page is available',()=>{
  const html=fs.readFileSync(new URL('../../webex.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../../webex-abandoned-selection.css',import.meta.url),'utf8');
  const workspace=fs.readFileSync(new URL('../../callback-settings/workspace.mjs',import.meta.url),'utf8');
  assert.match(html,/id="vbCallbackMorePlans"[^>]*hidden/);
  assert.match(html,/id="vbCallbackMoreRecords"[^>]*hidden/);
  assert.match(css,/\.vb-cb-workspace \.vb-cb-more\[hidden\]/);
  assert.match(workspace,/moreState\('MorePlans',planCursor\)/);
  assert.match(workspace,/moreState\('MoreRecords',recordCursor\)/);
});
