import {openCallbackManagement} from './management-ui.mjs';
import {callbackStatusLabel} from './readiness.mjs';
import {centralDate} from './selection.mjs';

const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const when=value=>Number.isFinite(Number(value))?new Date(Number(value)).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'}):'Not reported';
const windowText=w=>w?`${w.date} · ${w.startTime}–${w.endTime} Central`:'Not reported';
const TERMINAL=new Set(['completed','exhausted','expired','canceled','failed-terminal','rejected','not-submitted']);
const EARLY_RECONCILE=new Set(['submission-pending','dispatching','creation-unconfirmed','change-pending','change-unconfirmed']);
export const callbackWorkspaceDay=at=>centralDate(at);
const createdDay=value=>{const at=Date.parse(value||'');return Number.isFinite(at)?callbackWorkspaceDay(at):null;};

export function visibleWorkspacePlan(plan,now=Date.now()){
  const today=callbackWorkspaceDay(now),date=plan?.window?.date;
  return plan?.status==='draft'&&typeof date==='string'&&date>=today;
}
export function visibleWorkspaceRecord(record,now=Date.now()){
  const today=callbackWorkspaceDay(now),date=record?.window?.date;
  if(typeof date!=='string')return createdDay(record?.createdAt)===today;
  if(date<today)return false;
  if(record?.scheduleId)return true;
  return createdDay(record?.createdAt)===today;
}
export function needsWorkspaceReconcile(record,now=Date.now()){
  if(!record?.contactId||TERMINAL.has(record.status))return false;
  if(EARLY_RECONCILE.has(record.status))return true;
  const start=Number(record?.window?.startEpoch);
  return !!record.scheduleId&&Number.isFinite(start)&&start<=now;
}

export function renderReadiness(container,processing){
  if(!container)return;container.replaceChildren();
  const readiness=processing?.readiness;
  if(!readiness){container.append(el('p','Readiness details are not available. Saving a plan does not authorize calling.'));return;}
  container.append(el('p',readiness.summary));
  const grid=el('div','');grid.className='vb-cb-readiness-grid';
  for(const check of readiness.checks){const card=el('div','');card.className='vb-cb-readiness-item';card.dataset.state=check.status;
    card.append(el('strong',check.label),el('span',({'passed':'Checked','off':'Off','not-verified':'Not verified','action-required':'Action needed'})[check.status]||'Not verified'),el('p',check.detail),el('small','Managed in: '+check.owner));grid.append(card);}
  container.append(grid,el('small','Checked '+when(readiness.checkedAt)+'. Readiness is checked again before submission.'));
}

export function createCallbackWorkspace({api,openPlan,onRecord,accessReady}) {
  const get=n=>document.getElementById('vbCallback'+n);
  let loading=false,loaded=false,planCursor=null,recordCursor=null,generation=0,lastRefresh=0,pollTimer=null,stopped=false,reconcileCursor=0;
  const action=(title,fn)=>{const b=el('button',title);b.type='button';b.addEventListener('click',async()=>{if(!accessReady())return;b.disabled=true;try{await fn();}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{b.disabled=!accessReady();}});return b;};
  const actionCell=()=>{const cell=el('td','');cell.className='vb-cb-actions';return cell;};

  function plans(rows,append=false){
    if(!append)get('SavedPlans').replaceChildren();
    const visible=rows.filter(p=>visibleWorkspacePlan(p));
    for(const p of visible){const tr=el('tr','');tr.dataset.planId=p.id;
      for(const v of [p.count??p.contactIds?.length??0,windowText(p.window),p.requestedTotalAttempts,callbackStatusLabel(p.status),new Date(p.updatedAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})])tr.append(el('td',String(v)));
      const buttons=actionCell();buttons.append(action('Open plan',()=>openPlan(p.id)),action('Archive plan',async()=>{await api('plans',{action:'archive',mutationId:crypto.randomUUID(),planId:p.id,expectedPlanRevision:p.revision});await refresh(true);}));
      tr.append(buttons);get('SavedPlans').append(tr);
    }
    if(!visible.length&&!append){const tr=el('tr',''),td=el('td','No active saved callback plans for today or a future date.');td.colSpan=6;tr.append(td);get('SavedPlans').append(tr);}
  }

  function records(rows,append=false){
    if(!append)get('Register').replaceChildren();
    const visible=rows.filter(r=>visibleWorkspaceRecord(r));
    for(const r of visible){onRecord(r);const tr=el('tr','');tr.dataset.callbackRecord=r.contactId;
      for(const v of [r.number,windowText(r.window),callbackStatusLabel(r.status),`${r.attemptsMade??'Not reported'} / ${r.policy?.totalAttempts??'Not saved'} requested`])tr.append(el('td',v));
      const details=el('td','');details.append(el('div',r.scheduleId?'Webex ID: '+r.scheduleId:'No confirmed Webex schedule ID'),el('small',r.outcomeObservation?.message||r.nativeObservation?.message||r.reason||'Native call outcome has not been confirmed.'));
      const observed=r.outcomeObservation?.checkedAt||r.nativeObservation?.checkedAt;if(Number.isFinite(observed))details.append(el('div','Last checked: '+when(observed)));
      if(r.outcomeObservation?.agent)details.append(el('div','Handling agent: '+r.outcomeObservation.agent));
      if(r.outcomeObservation?.policyExceeded)details.append(el('strong','Reported attempts exceed the requested limit — review the flow.'));
      if(r.lastManagement)details.append(el('small','Last change: '+r.lastManagement.action+' · '+r.lastManagement.status));
      tr.append(details);const buttons=actionCell();
      if(r.status==='scheduled'&&r.window.startEpoch>Date.now()+30000)buttons.append(action('Manage schedule',()=>openCallbackManagement(r,{api,accessReady,onChanged:()=>refresh(true)})));
      buttons.append(action('Refresh status',async()=>{const result=await api('refresh-record',{contactId:r.contactId});onRecord(result.record);await refresh(false);}));
      tr.append(buttons);get('Register').append(tr);
    }
    if(!visible.length&&!append){const tr=el('tr',''),td=el('td','No callback requests for today or confirmed future dates.');td.colSpan=6;tr.append(td);get('Register').append(tr);}
  }

  async function reconcileOne(rows,run){
    const candidates=rows.filter(r=>visibleWorkspaceRecord(r)&&needsWorkspaceReconcile(r));
    if(!candidates.length)return rows;
    const candidate=candidates[reconcileCursor%candidates.length];reconcileCursor++;
    try{const result=await api('refresh-record',{contactId:candidate.contactId});if(run!==generation||!accessReady())return rows;
      if(result?.record){onRecord(result.record);return rows.map(r=>r.contactId===candidate.contactId?result.record:r);}}
    catch{/* Keep the saved status visible; a reconciliation failure must not imply success or completion. */}
    return rows;
  }

  async function refresh(reconcile=true){
    if(loading||!accessReady())return;loading=true;const run=++generation;get('WorkspaceStatus').textContent='Loading today’s callback workspace…';
    try{
      const [p,r,a]=await Promise.all([api('plans'),api('register'),api('automation-status').catch(()=>null)]);if(run!==generation||!accessReady())return;
      const rows=reconcile?await reconcileOne(r.rows,run):r.rows;if(run!==generation||!accessReady())return;
      plans(p.plans);records(rows);planCursor=p.nextBefore;recordCursor=r.nextBefore;get('MorePlans').disabled=!planCursor;get('MoreRecords').disabled=!recordCursor;
      get('WorkspaceStatus').textContent='Showing active saved plans and callback requests for today plus confirmed future callbacks. Previous-day incomplete requests are hidden; audit history remains retained.'+
        (a?' '+a.message+(a.lastScanAt?' Last automatic check: '+new Date(a.lastScanAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})+'.':''):'');
      loaded=true;lastRefresh=Date.now();
    }catch(e){if(run===generation&&accessReady())get('WorkspaceStatus').textContent='Workspace unavailable: '+e.message+'. Reporting remains independent.';}
    finally{loading=false;}
  }

  function schedulePoll(delay=20000){
    clearTimeout(pollTimer);if(stopped)return;
    pollTimer=setTimeout(async()=>{if(!stopped&&accessReady()&&document.visibilityState!=='hidden')await refresh(true);schedulePoll();},delay);
  }
  function resume(){stopped=false;if(accessReady()){get('RefreshWorkspace').disabled=false;void refresh(true);schedulePoll();}}
  function stop(){stopped=true;clearTimeout(pollTimer);pollTimer=null;}
  function clear(){stop();document.getElementById('vbCallbackManage')?.close();generation++;loaded=false;get('SavedPlans')?.replaceChildren();get('Register')?.replaceChildren();if(get('WorkspaceStatus'))get('WorkspaceStatus').textContent='Dashboard access is not approved.';for(const b of get('Workspace')?.querySelectorAll('button')||[])b.disabled=true;}

  get('RefreshWorkspace')?.addEventListener('click',()=>void refresh(true));
  get('MorePlans')?.addEventListener('click',async()=>{if(!planCursor||!accessReady()||loading)return;loading=true;const run=generation;try{const p=await api('plans?before='+encodeURIComponent(planCursor));if(run!==generation||!accessReady())return;plans(p.plans,true);planCursor=p.nextBefore;get('MorePlans').disabled=!planCursor;}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{loading=false;}});
  get('MoreRecords')?.addEventListener('click',async()=>{if(!recordCursor||!accessReady()||loading)return;loading=true;const run=generation;try{const r=await api('register?before='+encodeURIComponent(recordCursor));if(run!==generation||!accessReady())return;records(r.rows,true);recordCursor=r.nextBefore;get('MoreRecords').disabled=!recordCursor;}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{loading=false;}});
  return {refresh,clear,stop,resume,firstLoad(){if(accessReady()){stopped=false;get('RefreshWorkspace').disabled=false;if(!loaded||Date.now()-lastRefresh>20000)void refresh(true);schedulePoll();}}};
}
