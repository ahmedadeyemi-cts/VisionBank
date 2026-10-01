import {schedulingBounds} from './selection.mjs';
const el=(tag,text='')=>{const node=document.createElement(tag);node.textContent=text;return node;};
export async function openCallbackManagement(record,{api,accessReady,onChanged}){
  if(!accessReady())return;
  document.getElementById('vbCallbackManage')?.remove();
  const dialog=el('dialog');dialog.id='vbCallbackManage';dialog.className='vb-cb-plan';dialog.setAttribute('aria-label','Manage scheduled callback');
  const heading=el('div');heading.className='vb-cb-plan-heading';const close=el('button','Close');close.type='button';close.onclick=()=>dialog.close();heading.append(el('h2','Manage scheduled callback'),close);
  const context=el('p',record.number+' · Webex schedule '+record.scheduleId),status=el('p','Loading saved callback and current settings…');status.id='vbCallbackManageStatus';status.setAttribute('role','status');
  const fields=el('div');fields.className='vb-cb-time-fields';const date=el('input'),time=el('input');date.type='date';time.type='time';date.id='vbCallbackManageDate';time.id='vbCallbackManageTime';
  const dl=el('label','New date — Central'),tl=el('label','Window starts — Central');dl.append(date);tl.append(time);fields.append(dl,tl);
  const buttons=el('div');buttons.className='vb-cb-buttons';const save=el('button','Save new time'),cancel=el('button','Cancel scheduled callback');save.id='vbCallbackManageSave';cancel.id='vbCallbackManageCancel';for(const b of [save,cancel]){b.type='button';b.disabled=true;}buttons.append(save,cancel);
  dialog.append(heading,context,el('p','Changing time updates this same Webex schedule. Canceling a schedule never ends an active call. Both actions are unavailable after its start time.'),fields,status,buttons);
  document.body.append(dialog);dialog.showModal();let state=null,current=record,busy=false;
  const permit=()=>{const future=current.status==='scheduled'&&current.window.startEpoch>Date.now()+30000;cancel.disabled=busy||!accessReady()||!future;save.disabled=cancel.disabled||!state?.processing?.ready;date.disabled=busy;time.disabled=busy;};
  try{
    const [settings,latest]=await Promise.all([api('settings'),api('records?ids='+record.contactId)]);if(!accessReady()||!dialog.open)return;
    state=settings;current=latest.rows[0]||record;date.value=current.window.date;time.value=current.window.startTime;
    const bounds=schedulingBounds(settings.state.settings,settings.serverTimeEpoch||Date.now());date.min=bounds.minimumDate;date.max=bounds.maximumDate;
    status.textContent='Current window: '+current.window.date+' '+current.window.startTime+'–'+current.window.endTime+' Central. '+(settings.processing?.ready?'Choose a new time or cancel this schedule.':'New times are paused by readiness checks. Cancel remains available for a confirmed future schedule.');permit();
  }catch(e){status.textContent='Unable to load callback: '+e.message;return;}
  async function change(action){
    if(busy||!accessReady())return;busy=true;permit();
    const mutationId=crypto.randomUUID(),body={action,contactId:current.contactId,expectedRevision:current.revision,mutationId,...(action==='reschedule'?{expectedVersion:state.state.version,date:date.value,startTime:time.value}:{})};
    let uncertain=false;
    try{await api('manage',body);status.textContent='Change accepted locally. Waiting for Webex confirmation…';}
    catch(e){if(e.status&&e.status<500){status.textContent='No change submitted: '+e.message;busy=false;permit();return;}uncertain=true;status.textContent='Result unknown. Checking this request; it will not be submitted again.';}
    for(let i=0;i<40&&dialog.open&&accessReady();i++){
      try{
        const result=await api('management?id='+mutationId),op=result.operation;
        if(op?.status==='completed'){status.textContent=action==='cancel'?'Canceled in Webex.':'New callback window confirmed by Webex.';await onChanged();return;}
        if(op?.status==='not-applied'){status.textContent='Change not applied: '+op.reason+'. The original schedule has not been replaced.';await onChanged();return;}
        if(op?.status==='unconfirmed'){status.textContent='Webex change is not confirmed. The number remains reserved; use Refresh status. Do not submit a replacement.';await onChanged();return;}
        if(!op&&uncertain&&i>2){status.textContent='No accepted change found yet. Close and refresh the callback record before trying again.';return;}
      }catch{/* The original operation remains authoritative. */}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if(dialog.open&&accessReady())status.textContent='Still checking. Close this panel and use Refresh status; closing does not cancel accepted changes.';
  }
  save.onclick=()=>void change('reschedule');cancel.onclick=()=>void change('cancel');
  dialog.addEventListener('close',()=>dialog.remove(),{once:true});
}
