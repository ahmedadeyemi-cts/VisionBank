import {callbackStatusLabel} from './readiness.mjs';
const el=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const when=value=>Number.isFinite(Number(value))?new Date(Number(value)).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'}):'Not reported';
const windowText=w=>w?`${w.date} · ${w.startTime}–${w.endTime} Central`:'Not reported';
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
  const get=n=>document.getElementById('vbCallback'+n);let loading=false,loaded=false,planCursor=null,recordCursor=null,generation=0;
  const action=(title,fn)=>{const b=el('button',title);b.type='button';b.addEventListener('click',async()=>{if(!accessReady())return;b.disabled=true;try{await fn();}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{b.disabled=!accessReady();}});return b;};
  function plans(rows,append=false){if(!append)get('SavedPlans').replaceChildren();
    for(const p of rows){const tr=el('tr','');tr.dataset.planId=p.id;
      for(const v of [p.count??p.contactIds?.length??0,windowText(p.window),p.requestedTotalAttempts,callbackStatusLabel(p.status),new Date(p.updatedAt).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'})])tr.append(el('td',String(v)));
      const buttons=el('td','');if(p.status==='draft'){
        buttons.append(action('Open plan',()=>openPlan(p.id)),action('Archive plan',async()=>{await api('plans',{action:'archive',mutationId:crypto.randomUUID(),planId:p.id,expectedPlanRevision:p.revision});await refresh();}));
      } else buttons.append(el('span',p.status==='submitted'?'See callback requests below':'No call scheduled'));
      tr.append(buttons);get('SavedPlans').append(tr);
    }
    if(!rows.length&&!append){const tr=el('tr',''),td=el('td','No saved callback plans.');td.colSpan=6;tr.append(td);get('SavedPlans').append(tr);}
  }
  function records(rows,append=false){if(!append)get('Register').replaceChildren();
    for(const r of rows){onRecord(r);const tr=el('tr','');tr.dataset.callbackRecord=r.contactId;
      for(const v of [r.number,windowText(r.window),callbackStatusLabel(r.status),`${r.attemptsMade??'Not reported'} / ${r.policy?.totalAttempts??'Not saved'} requested`])tr.append(el('td',v));
      const details=el('td','');details.append(el('div',r.scheduleId?'Webex ID: '+r.scheduleId:'No confirmed Webex schedule ID'),el('small',r.nativeObservation?.message||r.reason||'Native call outcome has not been confirmed.'));
      tr.append(details);const buttons=el('td','');buttons.append(action('Refresh status',async()=>{const result=await api('refresh-record',{contactId:r.contactId});onRecord(result.record);await refresh();}));tr.append(buttons);get('Register').append(tr);
    }
    if(!rows.length&&!append){const tr=el('tr',''),td=el('td','No callback requests have been submitted from this dashboard.');td.colSpan=6;tr.append(td);get('Register').append(tr);}
  }
  async function refresh(){
    if(loading||!accessReady())return;loading=true;const run=++generation;get('WorkspaceStatus').textContent='Loading saved plans and callback records…';
    try{const [p,r]=await Promise.all([api('plans'),api('register')]);if(run!==generation||!accessReady())return;
      plans(p.plans);records(r.rows);planCursor=p.nextBefore;recordCursor=r.nextBefore;get('MorePlans').disabled=!planCursor;get('MoreRecords').disabled=!recordCursor;
      get('WorkspaceStatus').textContent='Saved plans and submitted callbacks across all dates. A saved plan will never run automatically.';loaded=true;
    }catch(e){if(run===generation&&accessReady())get('WorkspaceStatus').textContent='Workspace unavailable: '+e.message+'. Reporting remains independent.';}
    finally{loading=false;}
  }
  function clear(){generation++;loaded=false;get('SavedPlans')?.replaceChildren();get('Register')?.replaceChildren();if(get('WorkspaceStatus'))get('WorkspaceStatus').textContent='Dashboard access is not approved.';for(const b of get('Workspace')?.querySelectorAll('button')||[])b.disabled=true;}
  get('RefreshWorkspace')?.addEventListener('click',()=>void refresh());
  get('MorePlans')?.addEventListener('click',async()=>{if(!planCursor||!accessReady()||loading)return;loading=true;const run=generation;try{const p=await api('plans?before='+encodeURIComponent(planCursor));if(run!==generation||!accessReady())return;plans(p.plans,true);planCursor=p.nextBefore;get('MorePlans').disabled=!planCursor;}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{loading=false;}});
  get('MoreRecords')?.addEventListener('click',async()=>{if(!recordCursor||!accessReady()||loading)return;loading=true;const run=generation;try{const r=await api('register?before='+encodeURIComponent(recordCursor));if(run!==generation||!accessReady())return;records(r.rows,true);recordCursor=r.nextBefore;get('MoreRecords').disabled=!recordCursor;}catch(e){get('WorkspaceStatus').textContent=e.message;}finally{loading=false;}});
  return {refresh,clear,firstLoad(){if(accessReady()){get('RefreshWorkspace').disabled=false;if(!loaded)void refresh();}}};
}
