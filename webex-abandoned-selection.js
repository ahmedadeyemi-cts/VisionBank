import {createCallbackWorkspace,renderReadiness} from './callback-settings/workspace.mjs';
import { callbackNumber, centralDate, MAX_SELECTION, nextWindow, schedulingBounds, validateWindow } from './callback-settings/selection.mjs';
const API = 'https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/abandoned-callback/';
let clockReference=null,editingPlan=null,workspace=null,pendingPlanSave=null,recoveryStarted=false;
const planningNow=()=>clockReference?clockReference.server+performance.now()-clockReference.started:Date.now();
const id = x => document.getElementById('vbCallback' + x);
const selected = new Map();
let accessObserver = null;
const accessReady = () => window.VB_SECURITY?.allowed === true && document.body?.classList.contains('security-approved');
const ledger=new Map();let preparedIntent=null,pendingSubmission=null,pollTimer=null,recordsLoading=false,lastRecordsRead=0;
let lastFilter = null, current = null, saved = null, frozenIds = [], scope = 'selected', busy = false;
const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
const key = row => String(row.contactId || '').toLowerCase();
const fingerprint = row => JSON.stringify([key(row), row.ani, row.startEpoch, row.endEpoch]);
const possible = row => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(key(row)) &&
  callbackNumber(row.ani) && Number.isFinite(row.endEpoch) && row.endEpoch > 0 &&
  !row.callbackScheduleId && !(Number(row.callbackAttempts) > 0) && !ledger.has(key(row));
const fresh = s => accessReady() && s?.ready !== false &&
  Number.isFinite(s?.observedAt) && Date.now() - s.observedAt <= 180000 &&
  s.observedAt <= Date.now() + 5000 && centralDate(s.observedAt) === centralDate(Date.now());
const canPrepare=()=>accessReady() && (editingPlan?.status==='draft' || fresh(window.VB_ABANDONED_REPORT?.snapshot()));
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
  if(accessReady())workspace?.firstLoad();
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
    const statusCell=node('td',label),windowCell=node('td',row.callbackScheduledWindow||'—');
    statusCell.dataset.callbackStatus=key(row);windowCell.dataset.callbackWindow=key(row);tr.append(statusCell,windowCell);
  });
  applyLedger();void loadRecords();
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
  if(!accessReady()){ledger.clear();workspace?.clear();if(id('Readiness'))id('Readiness').replaceChildren();}
  if(editingPlan&&accessReady())return;
  if (id('SavePlan')) id('SavePlan').disabled=true;
  if (id('PlanRows')) id('PlanRows').replaceChildren();
  if (id('Preview')) id('Preview').disabled = true;
  if (id('Execute')) id('Execute').disabled = true;
}
async function api(path, body) {
  if (!accessReady()) throw new Error('Dashboard access is not approved.');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(API+path+(path.includes('?')?'&':'?')+'schema=4', {method: body ? 'POST' : 'GET', credentials: 'omit', mode: 'cors',
      cache: 'no-store', signal: controller.signal, headers: {Accept: 'application/json', ...(body ? {'Content-Type':'application/json'} : {})},
      ...(body ? {body: JSON.stringify(body)} : {})});
    const data = await response.json();
    if (!accessReady()) throw new Error('Dashboard access is not approved.');
    if (!response.ok || data.success !== true){const error=new Error(data.error || 'Callback service unavailable');error.status=response.status;throw error;}
    return data;
  } finally { clearTimeout(timer); }
}
function updateWindowBounds() {
  if(!saved)return;
  const s=saved.state.settings,limits=schedulingBounds(s,planningNow());
  id('Date').min=limits.minimumDate;id('Date').max=limits.maximumDate;
  const end=Number(s.endTime.slice(0,2))*60+Number(s.endTime.slice(3))-s.windowMinutes;
  id('Time').min=s.startTime;id('Time').max=String(Math.floor(end/60)).padStart(2,'0')+':'+String(end%60).padStart(2,'0');
  if(id('WindowEnd'))id('WindowEnd').textContent=String(Math.floor((Number(id('Time').value.slice(0,2))*60+Number(id('Time').value.slice(3))+s.windowMinutes)/60)).padStart(2,'0')+':'+String((Number(id('Time').value.slice(0,2))*60+Number(id('Time').value.slice(3))+s.windowMinutes)%60).padStart(2,'0')+' Central';
  id('Date').setCustomValidity('');id('Time').setCustomValidity('');
  try{validateWindow(id('Date').value,id('Time').value,s,planningNow());}
  catch(e){const messages={'outside-scheduling-horizon':'Choose a start at least '+s.delayMinutes+' minutes ahead and a date no later than '+limits.maximumDate+'.','outside-callback-days':'Choose one of the saved callback working days, excluding holidays.','outside-callback-hours':'The entire callback window must fit between '+s.startTime+' and '+s.endTime+' Central.','ambiguous-or-nonexistent-central-time':'This time is ambiguous or unavailable because of daylight saving. Choose another time.'};id('Time').setCustomValidity(messages[e.code]||'Choose a valid callback date and time.');}
}
async function openPlan(all = false,planToOpen = null) {
  current = window.VB_ABANDONED_REPORT?.snapshot();
  if (!accessReady() || !planToOpen&&!fresh(current)) { invalidate('Refresh the abandoned-call report before preparing callbacks.'); return; }
  editingPlan=planToOpen;pendingPlanSave=null;
  frozenIds = editingPlan ? [...editingPlan.contactIds] : all ? current.filtered.filter(possible).map(key) : [...selected.keys()];
  frozenIds = [...new Set(frozenIds)]; scope = editingPlan?.scope || (all ? 'all-matching' : 'selected');
  if (!frozenIds.length || frozenIds.length > MAX_SELECTION) { status(`Select between 1 and ${MAX_SELECTION} calls per batch.`); return; }
  busy = true; syncButtons(); saved = null;preparedIntent=null;
  id('DraftStatus').textContent=editingPlan?'Saved plan '+editingPlan.id+'. Nothing is scheduled until Webex confirms submission.':'Not saved. Save plan keeps this selection without placing calls.';
  id('SavePlan').disabled=true;
  id('PlanRows').replaceChildren(); id('Execute').disabled = true; id('Preview').disabled = true;
  id('PlanTitle').textContent = `Prepare ${frozenIds.length} callback${frozenIds.length === 1 ? '' : 's'}`;
  id('PlanStatus').textContent = 'Loading saved queue and callback hours…'; id('Plan').showModal();
  try {
    saved = await api('settings');
    clockReference=Number.isFinite(saved.serverTimeEpoch)?{server:saved.serverTimeEpoch,started:performance.now()}:null;
    const s = saved.state.settings, q = saved.queueOptions?.find(item => item.id === s.queueId);
    if (!q) throw new Error('Select and save a Voice queue in Abandoned Callback Settings first.');
    const window = editingPlan?.window || nextWindow(s,planningNow()+120000);
    id('Date').value = window.date; id('Time').value = window.startTime;updateWindowBounds();
    id('Queue').textContent = `${q.name} · Any available agent · ${s.windowMinutes}-minute window · ${s.maxAttempts} requested total attempts · America/Chicago`;
    id('Preview').disabled = false;id('SavePlan').disabled=false;
    renderReadiness(id('Readiness'),saved.processing);
    id('PlanStatus').textContent = saved.processing?.readiness?.summary || 'Saved configuration loaded. Preview checks do not place calls.';
  } catch (error) { id('PlanStatus').textContent = error.message; }
  finally { busy = false; syncButtons(); }
}
async function preview(event) {
  event.preventDefault(); if (busy || !saved) return;
  if (!canPrepare()) { invalidate('Reporting is stale; reopen preparation after it refreshes.'); return; }
  updateWindowBounds();if(!id('PlanForm').reportValidity())return;
  busy = true; id('Preview').disabled = true; id('PlanRows').replaceChildren();
  id('PlanStatus').textContent = 'Validating this frozen selection against today’s server-side report…';
  try {
    const intent={scope,contactIds:[...frozenIds],expectedVersion:saved.state.version,date:id('Date').value,startTime:id('Time').value};
    const path=editingPlan?'plan-preview':'preview';
    const input=editingPlan?{planId:editingPlan.id,expectedPlanRevision:editingPlan.revision,expectedVersion:intent.expectedVersion,date:intent.date,startTime:intent.startTime}:intent;
    const plan=await api(path,input);preparedIntent=plan.canSchedule?{path:editingPlan?'plan-schedule':'schedule',body:input}:null;
    renderReadiness(id('Readiness'),plan.processing);
    const reasons = {'invalid-or-withheld-number':'Invalid or withheld number', 'same-number-already-in-batch':'Same number already in this batch',
      'callback-already-recorded':'Callback already recorded', 'not-in-todays-abandoned-report':'No longer in today’s report',
      'call-not-confirmed-ended':'End of call not confirmed', 'no-longer-abandoned':'No longer abandoned','number-has-existing-callback':'This number already has an unresolved callback, including other dates.','native-callback-already-exists':'Webex already has a scheduled or active callback for this number.','callback-already-reserved':'This original call already has a callback record.'};
    for (const row of plan.rows) {
      const tr = document.createElement('tr');
      for (const value of [row.contactId, row.number || 'Not available', row.disposition === 'candidate' ? row.nativeInventory?.status==='clear'?'No duplicate found at check time':'Candidate — check pending' : 'Skipped',
        row.reason ? (reasons[row.reason] || row.reason) : row.nativeInventory?.status==='clear'?'No future schedule or active callback found by the native checks. Rechecked before submission; activation is separate.':row.nativeInventory?.status==='unavailable'?'Webex duplicate lookup unavailable. Scheduling stays blocked.': 'Native duplicate lookup will run before submission.']) tr.append(node('td', value));
      id('PlanRows').append(tr);
    }
    id('PlanStatus').textContent = `${plan.selected} selected · ${plan.candidates} candidates · ${plan.skipped} skipped. ${plan.window.date}, ${plan.window.startTime}–${plan.window.endTime} Central. ${plan.processing?.readiness?.summary||plan.warning}`;
    // Never infer execution permission from an enabled setting or a successful preview.
    id('Execute').disabled = !plan.canSchedule;
    id('Execute').textContent=plan.canSchedule?`Schedule ${plan.candidates} callback${plan.candidates===1?'':'s'}`:'Scheduling paused';
  } catch (error) { id('PlanStatus').textContent = 'Preview failed: ' + error.message + '. No callbacks were scheduled.'; }
  finally { busy = false; id('Preview').disabled = !canPrepare(); syncButtons(); }
}
function observeAccess() {
  if (accessObserver || !document.body) return;
  let approved = accessReady();
  accessObserver = new MutationObserver(() => {
    const next = accessReady();
    if (next === approved) return;
    approved = next;
    if (next){render();recoverPendingJob();} else invalidate('Dashboard access is not approved.');
  });
  accessObserver.observe(document.body, {attributes: true, attributeFilter: ['class']});
}
function init() {
  if (!id('ScheduleSelected')) return;
  window.VB_ABANDONED_SELECTION = Object.freeze({render, invalidate});
  workspace=createCallbackWorkspace({api,accessReady,openPlan:async planId=>{const data=await api('plans?id='+planId);if(data.plan.status!=='draft')throw new Error('Only a saved draft plan can be edited.');await openPlan(false,data.plan);},onRecord:r=>{ledger.set(r.contactId,r);applyLedger();}});
  observeAccess();recoverPendingJob();
  id('SavePlan').addEventListener('click',()=>void savePlan());
  id('Recheck').addEventListener('click',()=>void recheckReadiness());
  id('NextWindow').addEventListener('click',()=>{if(!saved)return;const w=nextWindow(saved.state.settings,planningNow()+120000);id('Date').value=w.date;id('Time').value=w.startTime;preparedIntent=null;id('Execute').disabled=true;updateWindowBounds();});
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
  id('Execute').addEventListener('click',()=>void submitCallbacks());
  id('PlanClose').addEventListener('click', () => id('Plan').close());
  id('OpenSettings')?.addEventListener('click',()=>{id('Plan').close();const p=document.getElementById('abandonedCallbackSettingsPanel');if(p?.hidden)document.getElementById('abandonedCallbackSettingsToggle')?.click();});
  id('Plan').addEventListener('close', () => { frozenIds = []; saved = null; editingPlan=null; preparedIntent=null; id('PlanRows').replaceChildren(); });
  id('PlanForm').addEventListener('input', () => { preparedIntent=null; id('PlanRows').replaceChildren(); id('Execute').disabled = true;updateWindowBounds(); });
  window.addEventListener('pagehide', () => {clearTimeout(pollTimer);accessObserver?.disconnect();accessObserver=null;invalidate('Page closed.');});
  window.addEventListener('pageshow', () => {observeAccess();render();});
  document.addEventListener('visibilitychange', () => { if (!fresh(window.VB_ABANDONED_REPORT?.snapshot())) invalidate('Refresh current reporting before selection.'); });
  render();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true}); else init();

function applyLedger(){
  const labels={'submission-pending':'Preparing callback',dispatching:'Submitting to Webex',
    'creation-unconfirmed':'Unconfirmed — review required',scheduled:'Scheduled',
    'due-outcome-unconfirmed':'Due — outcome not yet confirmed',rejected:'Not scheduled — rejected','not-submitted':'Not submitted'};
  for(const row of ledger.values()){
    const state=row.status==='scheduled'&&row.window.startEpoch<=Date.now()?'due-outcome-unconfirmed':row.status;
    const cell=document.querySelector('[data-callback-status="'+row.contactId+'"]');
    if(cell){cell.textContent=labels[state]||'Not confirmed';cell.title=row.reason||'';}
    const time=document.querySelector('[data-callback-window="'+row.contactId+'"]');
    if(time)time.textContent=new Date(row.window.startEpoch).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})+' – '+
      new Date(row.window.endEpoch).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit'});
    const box=document.querySelector('[data-callback-select="'+row.contactId+'"]');if(box){box.disabled=true;box.checked=false;}
    selected.delete(row.contactId);
  }
}
async function loadRecords(force=false){
  if(recordsLoading||!fresh(current)||!current.pageRows.length||!force&&Date.now()-lastRecordsRead<10000)return;
  const ids=current.pageRows.map(key);recordsLoading=true;lastRecordsRead=Date.now();
  try{const result=await api('records?ids='+encodeURIComponent(ids.join(',')));
    for(const row of result.rows)ledger.set(row.contactId,row);applyLedger();syncButtons();
  }catch{/* Reporting remains independent; never replace an unknown callback state with zero or success. */}
  finally{recordsLoading=false;}
}
function rememberJob(value){
  try{if(value)sessionStorage.setItem('vbCallbackPendingJobV1',JSON.stringify(value));else sessionStorage.removeItem('vbCallbackPendingJobV1');}catch{}
}
async function checkJob(jobId,attempt=0){
  if(!accessReady())return;
  try{const result=await api('jobs?id='+jobId),job=result.job;
    for(const row of job.records)ledger.set(row.contactId,row);applyLedger();syncButtons();
    const scheduled=job.records.filter(r=>!!r.scheduleId).length;
    const pending=job.records.some(r=>['submission-pending','dispatching','creation-unconfirmed'].includes(r.status));
    if(id('Plan').open)id('PlanStatus').textContent=`${scheduled} confirmed scheduled · ${job.skipped.length} skipped. `+
      (pending?'Remaining requests are being checked. Closing the dashboard does not cancel accepted work.':'See each abandoned-call row for its saved outcome.');
    if(!pending){rememberJob(null);pendingSubmission=null;void workspace?.refresh();}
    else if(attempt<15&&window.VB_SECURITY?.allowed)pollTimer=setTimeout(()=>void checkJob(jobId,attempt+1),2000);
  }catch{
    if(id('Plan').open)id('PlanStatus').textContent='Scheduling result is not confirmed. Do not create a replacement batch; the saved job will be checked again.';
    if(attempt<3&&window.VB_SECURITY?.allowed)pollTimer=setTimeout(()=>void checkJob(jobId,attempt+1),3000);
  }
}
async function submitCallbacks(){
  if(busy||!preparedIntent||!accessReady())return;
  const intent=structuredClone(preparedIntent.body),path=preparedIntent.path,signature=JSON.stringify([path,intent]);
  if(pendingSubmission && pendingSubmission.signature!==signature){id('PlanStatus').textContent='An earlier submission still needs confirmation. Refresh its status in Callback Workspace before submitting another batch.';void checkJob(pendingSubmission.mutationId);return;}
  if(!pendingSubmission||pendingSubmission.signature!==signature)pendingSubmission={signature,mutationId:crypto.randomUUID()};
  const mutationId=pendingSubmission.mutationId;rememberJob({id:mutationId,signature});
  busy=true;id('Execute').disabled=true;id('Preview').disabled=true;syncButtons();
  id('PlanStatus').textContent='Submitting the selected callback batch. Waiting for server confirmation…';
  try{const result=await api(path,{...intent,mutationId});
    preparedIntent=null;for(const row of result.job.records)ledger.set(row.contactId,row);applyLedger();
    id('Execute').textContent='Submitted';void checkJob(mutationId);void workspace?.refresh();
  }catch(e){if(e.status&&e.status<500){rememberJob(null);pendingSubmission=null;id('PlanStatus').textContent='Not submitted: '+e.message;}
    else{id('PlanStatus').textContent='Result unknown. Checking the original request; no automatic resubmission.';void checkJob(mutationId);}}
  finally{busy=false;id('Preview').disabled=false;syncButtons();}
}

function recoverPendingJob(){
  if(recoveryStarted||!accessReady())return;recoveryStarted=true;
  try{const old=JSON.parse(sessionStorage.getItem('vbCallbackPendingJobV1')||'null');
    if(old&&/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(old.id)){
      pendingSubmission={mutationId:old.id,signature:old.signature||'recovered-pending'};void checkJob(old.id);
    }
  }catch{/* A malformed browser hint never submits or changes a callback. */}
}
async function recheckReadiness(){
  if(busy||!accessReady())return;const button=id('Recheck');button.disabled=true;preparedIntent=null;id('Execute').disabled=true;
  try{const result=await api('settings');if(!id('Plan').open)return;
    saved=result;clockReference=Number.isFinite(saved.serverTimeEpoch)?{server:saved.serverTimeEpoch,started:performance.now()}:null;
    renderReadiness(id('Readiness'),saved.processing);updateWindowBounds();id('PlanStatus').textContent=saved.processing?.readiness?.summary||'Readiness checked. Preview again before scheduling.';
  }catch(e){id('PlanStatus').textContent='Could not recheck readiness: '+e.message;}finally{button.disabled=!accessReady();}
}
async function savePlan(){
  if(busy||!saved||!canPrepare())return;updateWindowBounds();if(!id('PlanForm').reportValidity())return;
  const base={action:'save',planId:editingPlan?.id||null,expectedPlanRevision:editingPlan?.revision||0,
    selection:{scope,contactIds:[...frozenIds],expectedVersion:saved.state.version,date:id('Date').value,startTime:id('Time').value}};
  const signature=JSON.stringify(base);
  if(!pendingPlanSave||pendingPlanSave.signature!==signature)pendingPlanSave={signature,mutationId:crypto.randomUUID()};
  const mutationId=pendingPlanSave.mutationId;busy=true;id('SavePlan').disabled=true;id('Execute').disabled=true;id('Preview').disabled=true;preparedIntent=null;
  id('DraftStatus').textContent='Saving callback plan. No native schedule will be created…';
  const accept=plan=>{editingPlan=plan;frozenIds=[...plan.contactIds];scope=plan.scope;pendingPlanSave=null;
    id('PlanTitle').textContent='Prepare '+frozenIds.length+' callback'+(frozenIds.length===1?'':'s');
    id('DraftStatus').textContent='Saved plan '+plan.id+' (revision '+plan.revision+'). Not scheduled; it will not run automatically.';void workspace?.refresh();};
  try{const result=await api('plans',{...base,mutationId});accept(result.plan);}
  catch(e){if(e.status&&e.status<500)id('DraftStatus').textContent='Plan not saved: '+e.message;
    else{try{const result=await api('plans?mutationId='+mutationId);if(result.mutation&&result.plan)accept(result.plan);else id('DraftStatus').textContent='Save result not confirmed. Check Saved callback plans before creating another plan.';}
      catch{id('DraftStatus').textContent='Save result not confirmed. No Webex scheduling was requested.';}}}
  finally{busy=false;id('SavePlan').disabled=!accessReady();id('Preview').disabled=!canPrepare();syncButtons();}
}
