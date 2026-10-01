import { AGENT_MESSAGE, normalizeSettings } from './callback-settings/policy.mjs';
const BASE='https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/abandoned-callback/';
const byId=id=>document.getElementById('abandonedCallback'+id);
let state=null,dirty=false,saving=false,loading=false,timer=null,pending=null,nextBefore=null;
const text=(id,value)=>{const el=byId(id);if(el)el.textContent=value;};
const stamp=value=>value ? new Date(value).toLocaleString('en-US',{timeZone:'America/Chicago',timeZoneName:'short'}) : 'Never changed';
const node=(tag,value)=>{const e=document.createElement(tag);e.textContent=value;return e;};
async function api(path,body) {
  if(window.VB_SECURITY?.allowed!==true)throw new Error('Dashboard access is not approved.');
  const controller=new AbortController(),deadline=setTimeout(()=>controller.abort(),20000);
  try {const r=await fetch(BASE+path+(path.includes('?')?'&':'?')+'schema=4',{method:body?'POST':'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal,
    headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const data=await r.json();if(window.VB_SECURITY?.allowed!==true){revoke();throw new Error('Dashboard access is not approved.');}if(!r.ok||data.success!==true){const error=new Error(data.error||'Settings unavailable');error.status=r.status;if(r.status===401||r.status===403)revoke();throw error;}
    return data;
  }finally{clearTimeout(deadline);}
}
function renderAudit(s) {
  const actor=s.lastChangedBy,list=byId('LastChange');list.replaceChildren();
  const fields=[['Source IP',actor?.sourceIp||'No saved change'],['Computer name',actor?.computerName||'Not reported'],
    ['Browser / operating system',actor?`${actor.browser} / ${actor.operatingSystem} (browser reported)`:'Not reported'],
    ['Last changed',stamp(s.updatedAt)],['Configuration version',String(s.version)]];
  for(const [label,value]of fields)list.append(node('dt',label),node('dd',value));
}
function apply(data,force=false) {
  if(window.VB_SECURITY?.allowed!==true){revoke();return;}
  if(!data.state||!Number.isSafeInteger(data.state.version)||typeof data.state.settings?.enabled!=='boolean')throw new Error('Incomplete settings response.');
  if(state&&data.state.version<state.version)return;
  const s=data.state.settings;renderAudit(data.state);
  text('Processing',(s.enabled?(data.processing?.ready?'Enabled. ':'Enabled — processing paused. '):'Disabled. ')+(data.processing?.message||'Execution readiness not reported.'));
  if(dirty&&!force){if(state&&state.version!==data.state.version)text('LoadStatus','Saved settings changed elsewhere. Your unsaved edits have not been overwritten.');return;}
  state=data.state;byId('Enabled').checked=s.enabled;byId('Mode').value=s.mode;
  const select=byId('Queue');select.replaceChildren(new Option('Select one Voice queue',''));
  for(const q of data.queueOptions||[])select.add(new Option(q.name,q.id));
  if(s.queueId&&![...select.options].some(o=>o.value===s.queueId))select.add(new Option('Saved queue — live availability not confirmed',s.queueId));
  select.value=s.queueId;
  const entry=byId('EntryPoint');entry.replaceChildren(new Option('Select the Webex callback entry point',''));
  for(const ep of data.entryPointOptions||[])entry.add(new Option(ep.name+(ep.callbackEnabled?' — Webex callback entry point':''),ep.id));
  if(s.callbackEntryPointId&&![...entry.options].some(o=>o.value===s.callbackEntryPointId))entry.add(new Option('Saved entry point — currently unavailable',s.callbackEntryPointId));
  entry.value=s.callbackEntryPointId||'';
  text('EntryPointStatus',data.entryPointOptionsAvailable?'Names are refreshed from Webex. Renaming the same entry point retains its link.':'Entry-point discovery is unavailable. Your saved selection has not been changed.');

  for(const [id,key]of [['MaxAttempts','maxAttempts'],['Delay','delayMinutes'],['Window','windowMinutes'],['Start','startTime'],['End','endTime']])byId(id).value=s[key];
  document.querySelectorAll('[name="abandonedCallbackDay"]').forEach(e=>e.checked=s.days.includes(Number(e.value)));
  byId('Excluded').value=s.excludedDates.join('\n');byId('Fields').disabled=false;
  dirty=false;text('LoadStatus','Saved configuration loaded. Changes apply only when you select Save settings.');
}
function readForm() {
  return normalizeSettings({enabled:byId('Enabled').checked,mode:byId('Mode').value,queueId:byId('Queue').value,callbackEntryPointId:byId('EntryPoint').value,
    delayMinutes:Number(byId('Delay').value),windowMinutes:Number(byId('Window').value),timezone:'America/Chicago',
    startTime:byId('Start').value,endTime:byId('End').value,
    days:[...document.querySelectorAll('[name="abandonedCallbackDay"]:checked')].map(e=>Number(e.value)),
    excludedDates:byId('Excluded').value.split(/[\n,]/).map(v=>v.trim()).filter(Boolean),
    maxAttempts:Number(byId('MaxAttempts').value),assignment:'any-available-agent',agentMessage:AGENT_MESSAGE});
}
async function load() {
  if(loading||saving||byId('SettingsPanel').hidden)return;loading=true;
  try{apply(await api('settings'));}catch(e){text('LoadStatus','Settings unavailable: '+e.message+'. The saved switch has not been reset.');
    if(!state)byId('Fields').disabled=true;}finally{loading=false;}
}
async function save(event) {
  event.preventDefault();if(saving||!state)return;
  let settings;try{settings=readForm();}catch(e){text('LoadStatus','Check settings: '+e.message);return;}
  const signature=JSON.stringify([state.version,settings]);
  if(!pending||pending.signature!==signature)pending={signature,body:{mutationId:crypto.randomUUID(),expectedVersion:state.version,settings}};
  saving=true;byId('Fields').disabled=true;byId('Save').disabled=true;text('LoadStatus','Saving shared settings and change history…');
  try{const data=await api('settings',pending.body);apply(data,true);pending=null;
    text('LoadStatus',data.changed?'Saved. This setting persists until explicitly changed.':'No configuration change was needed.');
    if(byId('History').open)await history(false);
  }catch(e){
    if(e.status===409){try{apply(await api('settings'),true);pending=null;
      text('LoadStatus','Another dashboard changed the configuration. Latest saved values are shown; review before saving again.');
    }catch{ text('LoadStatus','A conflicting change was detected. Reopen settings to load the latest version.');}}
    else if(e.status&&e.status<500){text('LoadStatus','Save rejected: '+e.message);}
    else{try{const result=await api('settings?mutationId='+pending.body.mutationId);
      if(result.mutationStatus==='accepted'){apply(result,true);pending=null;text('LoadStatus','Saved. The server confirmed the earlier request; no duplicate change was created.');if(byId('History').open)await history(false);}
      else text('LoadStatus','Save result not confirmed. Save again to safely retry the same request.');
    }catch{text('LoadStatus','Save result unknown. Reopen this panel when the connection returns; no success has been assumed.');}}
  }finally{saving=false;byId('Fields').disabled=!state;byId('Save').disabled=false;}
}
async function history(older=false) {
  text('HistoryStatus','Loading history…');
  try{const data=await api('history'+(older&&nextBefore!==null?'?before='+nextBefore:''));
    const body=byId('HistoryRows');if(!older)body.replaceChildren();
    for(const row of data.rows){const tr=document.createElement('tr'),a=row.actor;
      for(const value of [stamp(row.at),row.action+(row.entryPointChange?' · Callback entry point: '+(row.entryPointChange.nameAtChange||row.entryPointChange.nextId||'Cleared'):''),a.sourceIp,`${a.browser} / ${a.operatingSystem}`,a.computerName||'Not reported',String(row.version)])tr.append(node('td',value));
      body.append(tr);}
    nextBefore=data.nextBefore;byId('Older').hidden=nextBefore===null;
    text('HistoryStatus',body.children.length?'Server-recorded changes. Source IP identifies a connection, not a verified person.':'No saved changes.');
  }catch(e){text('HistoryStatus','History unavailable: '+e.message);}
}
function revoke(){state=null;dirty=false;pending=null;byId('Fields').disabled=true;
  byId('LastChange').replaceChildren();byId('HistoryRows').replaceChildren();text('Processing','');text('LoadStatus','Dashboard access is not approved.');}
function init(){
  const button=byId('SettingsToggle'),panel=byId('SettingsPanel');if(!button||!panel)return;
  const close=()=>{panel.hidden=true;button.setAttribute('aria-expanded','false');clearInterval(timer);timer=null;button.focus();};
  button.addEventListener('click',()=>{
    if(!panel.hidden){close();return;}panel.hidden=false;button.setAttribute('aria-expanded','true');
    if(window.VB_SECURITY?.allowed!==true){revoke();return;}void load();
    clearInterval(timer);timer=setInterval(()=>{
      if(window.VB_SECURITY?.allowed!==true){revoke();clearInterval(timer);timer=null;return;}
      if(!document.hidden&&!dirty)void load();
    },30000);
  });
  byId('Close').addEventListener('click',close);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
  byId('Form').addEventListener('input',()=>{dirty=true;text('LoadStatus','Unsaved changes.');});
  byId('Form').addEventListener('change',()=>{dirty=true;text('LoadStatus','Unsaved changes.');});
  byId('Form').addEventListener('submit',save);
  byId('History').addEventListener('toggle',()=>{if(byId('History').open)void history(false);});
  byId('Older').addEventListener('click',()=>void history(true));
  window.addEventListener('pagehide',()=>{clearInterval(timer);timer=null;});
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
