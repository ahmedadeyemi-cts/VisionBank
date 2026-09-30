import { callbackNumber, centralDate, MAX_SELECTION, nextWindow } from './callback-settings/selection.mjs';
const API = 'https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/abandoned-callback/';
const id = x => document.getElementById('vbCallback' + x);
const selected = new Map();
let lastFilter = null, current = null, saved = null, frozenIds = [], scope = 'selected', busy = false;
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
const key = row => String(row.contactId || '').toLowerCase();
const fingerprint = row => JSON.stringify([key(row), row.ani, row.startEpoch, row.endEpoch]);
const possible = row => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key(row)) &&
  callbackNumber(row.ani) && Number.isFinite(row.endEpoch) && row.endEpoch > 0 &&
  !row.callbackScheduleId && !(Number(row.callbackAttempts) > 0);
const fresh = s => window.VB_SECURITY?.allowed === true && s?.ready !== false &&
  Number.isFinite(s?.observedAt) && Date.now() - s.observedAt <= 180000 &&
  s.observedAt <= Date.now() + 5000 && centralDate(s.observedAt) === centralDate(Date.now());
function status(message) { if (id('SelectionStatus')) id('SelectionStatus').textContent = message; }
function syncButtons() {
  const available = fresh(current), matching = current?.filtered.filter(possible) || [];
  id('ScheduleSelected').disabled = !available || selected.size === 0 || busy;
  id('ScheduleSelected').textContent = `Schedule selected (${selected.size})`;
  id('ScheduleAll').disabled = !available || matching.length === 0 || busy;
  id('ScheduleAll').textContent = current?.filter ? `Schedule all matching (${matching.length})` : `Schedule all eligible today (${matching.length})`;
  id('SelectMatching').disabled = !available || !matching.length;
  id('SelectMatching').textContent = `Select all matching across pages (${matching.length})`;
  id('ClearSelection').disabled = selected.size === 0;
  status(`${selected.size} selected. ${matching.length} records have usable numbers; native duplicate checks remain pending. New arrivals are not automatically selected.`);
  for (const box of document.querySelectorAll('input[data-callback-select]')) box.checked = selected.has(box.dataset.callbackSelect);
}
function setSelected(row, checked) {
  if (!fresh(current)) return invalidate("Current reporting is unavailable.");
  if (checked && !selected.has(key(row)) && selected.size >= MAX_SELECTION) return status(`Maximum ${MAX_SELECTION} calls per batch.`);
  if (checked) selected.set(key(row), fingerprint(row)); else selected.delete(key(row));
  syncButtons();
}
function render() {
  if (!id('ScheduleSelected')) return;
  current = window.VB_ABANDONED_REPORT?.snapshot();
  if (!fresh(current)) { invalidate('Current abandoned-call reporting is unavailable.'); return; }
  if (lastFilter !== null && lastFilter !== current.filter) selected.clear();
  lastFilter = current.filter;
  const records = new Map(current.filtered.map(row => [key(row), row]));
  for (const [contactId, signature] of selected) {
    const row = records.get(contactId);
    if (!row || !possible(row) || fingerprint(row) !== signature) selected.delete(contactId);
  }
  const header = document.querySelector('#abandonedCallsTable thead tr');
  if (!header.querySelector('[data-callback-heading]')) {
    const th = node('th', ''), box = document.createElement('input'); box.type = 'checkbox';
    box.id = 'vbCallbackSelectPage'; box.setAttribute('aria-label', 'Select eligible calls on this page');
    box.addEventListener('change', () => { for (const row of current.pageRows.filter(possible)) setSelected(row, box.checked); });
    th.dataset.callbackHeading = 'selection'; th.append(box); header.prepend(th);
    for (const title of ['Callback status', 'Scheduled window — CST/CDT']) {
      const cell = node('th', title); cell.dataset.callbackHeading = title; header.append(cell);
    }
  }
  const body = document.getElementById('abandonedCallsBody');
  if (!current.pageRows.length) { body.querySelector('td')?.setAttribute('colspan', '11'); syncButtons(); return; }
  [...body.rows].forEach((tr, index) => {
    if (tr.querySelector('[data-callback-cell]')) return;
    const row = current.pageRows[index]; if (!row || tr.cells.length !== 8) return;
    const td = node('td', ''), box = document.createElement('input'); box.type = 'checkbox';
    td.dataset.callbackCell = 'selection'; box.dataset.callbackSelect = key(row); box.disabled = !possible(row);
    box.setAttribute('aria-label', 'Select abandoned call from ' + String(row.ani || 'unknown number'));
    box.addEventListener('change', () => setSelected(row, box.checked)); td.append(box); tr.prepend(td);
    const label = row.callbackScheduleId ? 'Already scheduled' : possible(row) ? 'Native status not verified' : 'Not eligible / already attempted';
    tr.append(node('td', label));
    tr.append(node('td', row.callbackScheduledWindow || '—'));
  });
  syncButtons();
  const eligiblePage = current.pageRows.filter(possible), checked = eligiblePage.filter(row => selected.has(key(row))).length;
  const page = id('SelectPage'); page.disabled = !eligiblePage.length;
  page.checked = checked > 0 && checked === eligiblePage.length; page.indeterminate = checked > 0 && checked < eligiblePage.length;
}
function invalidate(message) {
  selected.clear(); current = null;
  if (id('ScheduleSelected')) { syncButtons(); status(message); }
  for (const box of document.querySelectorAll('input[data-callback-select]')) box.disabled = true;
  if (id('SelectPage')) id('SelectPage').disabled = true;
  if (id('PlanRows')) id('PlanRows').replaceChildren();
  if (id('Preview')) id('Preview').disabled = true;
  if (id('Execute')) id('Execute').disabled = true;
}
async function api(path, body) {
  if (window.VB_SECURITY?.allowed !== true) throw new Error('Dashboard access is not approved.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API + path, {method: body ? 'POST' : 'GET', credentials: 'omit', mode: 'cors',
      cache: 'no-store', signal: controller.signal, headers: {Accept: 'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json();
    if (window.VB_SECURITY?.allowed !== true) throw new Error('Dashboard access is not approved.');
    if (!response.ok || data.success !== true) throw new Error(data.error || 'Callback preparation unavailable');
    return data;
  } finally { clearTimeout(timer); }
}
async function openPlan(all = false) {
  current = window.VB_ABANDONED_REPORT?.snapshot();
  if (!fresh(current)) { invalidate('Refresh the abandoned-call report before preparing callbacks.'); return; }
  frozenIds = all ? current.filtered.filter(possible).map(key) : [...selected.keys()];
  frozenIds = [...new Set(frozenIds)]; scope = all ? 'all-matching' : 'selected';
  if (!frozenIds.length || frozenIds.length > MAX_SELECTION) { status(`Select between 1 and ${MAX_SELECTION} calls per batch.`); return; }
  busy = true; syncButtons(); saved = null;
  id('PlanRows').replaceChildren(); id('Execute').disabled = true; id('Preview').disabled = true;
  id('PlanTitle').textContent = `Prepare ${frozenIds.length} callback${frozenIds.length === 1 ? '' : 's'}`;
  id('PlanStatus').textContent = 'Loading saved queue and callback hours…'; id('Plan').showModal();
  try {
    saved = await api('settings');
    const s = saved.state.settings, q = saved.queueOptions?.find(item => item.id === s.queueId);
    if (!q) throw new Error('Select and save a Voice queue in Abandoned Callback Settings first.');
    const window = nextWindow(s);
    id('Date').value = window.date; id('Time').value = window.startTime;
    id('Queue').textContent = `${q.name} · Any available agent · ${s.windowMinutes}-minute window · America/Chicago`;
    id('Preview').disabled = false;
    id('PlanStatus').textContent = `${s.enabled ? 'Enabled — processing paused.' : 'Master setting is Disabled.'} Preview only is available. Native scheduling is not connected; no calls will be placed.`;
  } catch (error) { id('PlanStatus').textContent = error.message; }
  finally { busy = false; syncButtons(); }
}
async function preview(event) {
  event.preventDefault(); if (busy || !saved) return;
  if (!fresh(window.VB_ABANDONED_REPORT?.snapshot())) { invalidate('Reporting is stale; reopen preparation after it refreshes.'); return; }
  busy = true; id('Preview').disabled = true; id('PlanRows').replaceChildren();
  id('PlanStatus').textContent = 'Validating this frozen selection against today’s server-side report…';
  try {
    const plan = await api('preview', {scope, contactIds: frozenIds, expectedVersion: saved.state.version,
      date: id('Date').value, startTime: id('Time').value});
    const reasons = {'invalid-or-withheld-number':'Invalid or withheld number', 'same-number-already-in-batch':'Same number already in this batch',
      'callback-already-recorded':'Callback already recorded', 'not-in-todays-abandoned-report':'No longer in today’s report',
      'call-not-confirmed-ended':'End of call not confirmed', 'no-longer-abandoned':'No longer abandoned'};
    for (const row of plan.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.contactId, row.number || 'Not available', row.disposition === 'candidate' ? 'Candidate — native checks pending' : 'Skipped',
        row.reason ? (reasons[row.reason] || row.reason) : 'Duplicate inventory and routing still need verification']) tr.append(node('td', value));
      id('PlanRows').append(tr);
    }
    id('PlanStatus').textContent = `${plan.selected} selected · ${plan.candidates} candidates · ${plan.skipped} skipped. ${plan.window.date}, ${plan.window.startTime}–${plan.window.endTime} Central. ${plan.warning}`;
    // Never infer execution permission from an enabled setting or a successful preview.
    id('Execute').disabled = true;
  } catch (error) { id('PlanStatus').textContent = 'Preview failed: ' + error.message + '. No callbacks were scheduled.'; }
  finally { busy = false; id('Preview').disabled = !fresh(window.VB_ABANDONED_REPORT?.snapshot()); syncButtons(); }
}
function init() {
  if (!id('ScheduleSelected')) return;
  window.VB_ABANDONED_SELECTION = Object.freeze({render, invalidate});
  id('ScheduleSelected').addEventListener('click', () => void openPlan(false));
  id('ScheduleAll').addEventListener('click', () => void openPlan(true));
  id('SelectMatching').addEventListener('click', () => {
    current = window.VB_ABANDONED_REPORT?.snapshot(); if (!fresh(current)) return invalidate('Report unavailable.');
    const rows = current.filtered.filter(possible);
    if (rows.length > MAX_SELECTION) return status(`This batch exceeds ${MAX_SELECTION} calls. Narrow the search before selecting.`);
    selected.clear(); for (const row of rows) selected.set(key(row), fingerprint(row)); render();
  });
  id('ClearSelection').addEventListener('click', () => { selected.clear(); render(); });
  id('PlanForm').addEventListener('submit', preview);
  id('PlanClose').addEventListener('click', () => id('Plan').close());
  id('Plan').addEventListener('close', () => { frozenIds = []; saved = null; id('PlanRows').replaceChildren(); });
  id('PlanForm').addEventListener('input', () => { id('PlanRows').replaceChildren(); id('Execute').disabled = true; });
  window.addEventListener('pagehide', () => invalidate('Page closed.'));
  document.addEventListener('visibilitychange', () => { if (!fresh(window.VB_ABANDONED_REPORT?.snapshot())) invalidate('Refresh current reporting before selection.'); });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();
