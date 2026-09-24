/* VisionBank integrated Chat views. Read-only, independently refreshed.
 * Load AFTER webex.js. Does not alter Voice reports or the Cisco chat widget.
 */
(() => {
  'use strict';
  const BUILD='2026.09.24-chat-integrated-2';
  const ownScript=document.currentScript;
  const origin=ownScript?.dataset.chatApi||'https://visionbank-security.ahmedadeyemi.workers.dev';
  if(!/^https:\/\/(?:[a-f0-9]{8}-)?visionbank-security\.ahmedadeyemi\.workers\.dev$/.test(origin)) return;
  const endpoint=origin+'/api/webex/chat-reports';
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const approved=()=>window.VB_SECURITY?.allowed===true;
  const time=v=>Number.isFinite(v)&&v>0?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(new Date(v)):'Unavailable';
  const duration=v=>Number.isFinite(v)&&v>=0?[Math.floor(v/3600000),Math.floor(v/60000)%60,Math.floor(v/1000)%60].map(n=>String(n).padStart(2,'0')).join(':'):'Unavailable';
  const value=m=>m?.status==='ready'&&Number.isFinite(m.value)?m.value:'Unavailable';
  const fresh=(stamp,age)=>Number.isFinite(stamp)&&Date.now()-stamp>=-5000&&Date.now()-stamp<age;
  let live=null,daily=null,base=null,started=false,lastLiveAttempt=0,lastDailyAttempt=0,inLive=null,inDaily=null;
  const tables=new Map();
  function appendPanel(id,title,anchor,inside=false) {
    if($(id))return $(id);
    if(!anchor)return null;
    const el=document.createElement('section');el.id=id;el.className='vb-ops'+(inside?' vb-ops-inner':' panel');
    const h=document.createElement('h2');h.textContent=title;el.append(h);
    if(inside)anchor.append(el);else anchor.insertAdjacentElement('afterend',el);
    return el;
  }
  function table(panel,id,columns,choices=[]) {
    if(!panel)return;
    const container=document.createElement('div');container.className='vb-ops-table-block';
    container.innerHTML=`<p class="vb-ops-meta" id="${id}-meta" role="status">Unavailable until the Chat candidate is deployed.</p>
      <div class="vb-ops-tools"><label>Search <input type="search" id="${id}-search" aria-label="Search ${esc(panel.querySelector('h2').textContent)}" autocomplete="off"></label>
      ${choices.length?`<label>View <select id="${id}-filter">${choices.map(c=>`<option value="${esc(c[0])}">${esc(c[1])}</option>`).join('')}</select></label>`:''}
      <button type="button" id="${id}-export" disabled>Export CSV</button></div>
      <div class="vb-ops-scroll"><table><thead><tr>${columns.map((c,i)=>`<th scope="col"><button type="button" data-col="${i}">${esc(c[0])}</button></th>`).join('')}</tr></thead><tbody id="${id}-body"></tbody></table></div>
      <div class="vb-ops-tools vb-ops-paging"><button type="button" id="${id}-prev">Previous</button><span id="${id}-page">Unavailable</span><button type="button" id="${id}-next">Next</button></div>`;
    panel.append(container);
    const state={id,columns,rows:[],ready:false,page:1,sort:0,desc:false,filter:'all',filtered:[]};tables.set(id,state);
    $(id+'-search').addEventListener('input',()=>{state.page=1;renderTable(state);});
    $(id+'-filter')?.addEventListener('change',()=>{state.filter=$(id+'-filter').value;state.page=1;render();});
    $(id+'-prev').addEventListener('click',()=>{state.page=Math.max(1,state.page-1);renderTable(state);});
    $(id+'-next').addEventListener('click',()=>{state.page++;renderTable(state);});
    container.querySelectorAll('th button').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.col);state.desc=state.sort===i?!state.desc:false;state.sort=i;renderTable(state);}));
    $(id+'-export').addEventListener('click',()=>{
      if(!approved()||!state.ready)return;
      const cell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]|^[\t\r]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
      const lines=[columns.map(c=>cell(c[0])).join(','),...state.filtered.map(r=>columns.map(c=>cell(c[1](r))).join(','))];
      const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.join('\r\n')],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download=`VisionBank_${id}_${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });
    renderTable(state);
  }
  function renderTable(s) {
    const ready=s.ready&&approved(), term=$(s.id+'-search')?.value.trim().toLowerCase()||'';
    const rows=ready?s.rows.filter(r=>s.columns.some(c=>String(c[1](r)??'').toLowerCase().includes(term))):[];
    const getter=s.columns[s.sort][2]||s.columns[s.sort][1];
    rows.sort((a,b)=>{let x=getter(a),y=getter(b);const v=typeof x==='number'&&typeof y==='number'?x-y:String(x??'').localeCompare(String(y??''),undefined,{numeric:true});return s.desc?-v:v;});
    s.filtered=rows;const pages=Math.max(1,Math.ceil(rows.length/25));s.page=Math.max(1,Math.min(s.page,pages));
    $(s.id+'-body').innerHTML=rows.length?rows.slice((s.page-1)*25,s.page*25).map(r=>'<tr>'+s.columns.map(c=>`<td>${esc(c[1](r)??'Unavailable')}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${s.columns.length}" class="vb-ops-empty">${ready?'No matching records in the stated reporting scope.':'Unavailable — no zero totals have been substituted.'}</td></tr>`;
    $(s.id+'-page').textContent=ready?`${rows.length} records · Page ${s.page} of ${pages}`:'Unavailable';
    $(s.id+'-prev').disabled=!ready||s.page<=1;$(s.id+'-next').disabled=!ready||s.page>=pages;
    $(s.id+'-export').disabled=!ready||!rows.length;
    $(s.id+'-body').closest('table').querySelectorAll('th').forEach((th,i)=>th.setAttribute('aria-sort',i===s.sort?(s.desc?'descending':'ascending'):'none'));
  }
  function fill(id,rows,ready,meta) {
    const t=tables.get(id);if(!t)return;t.rows=rows;t.ready=ready;$(id+'-meta').textContent=meta;renderTable(t);
  }
  function bootstrap() {
    if(started)return;started=true;
    const agentPanel=$('agent-body')?.closest('.panel'), globalPanel=$('global-error')?.closest('.panel');
    if(globalPanel?.querySelector('h2'))globalPanel.querySelector('h2').textContent='Voice Statistics';
    const agent=appendPanel('vbChatAgents','Chat Agent Performance',agentPanel,true);
    table(agent,'chat-agents',[
      ['Agent',r=>r.name||r.agentId],['Chat routing state',r=>r.routingState||'Unavailable'],
      ['Active chats',r=>r.active],['Wrap-up',r=>r.wrapup],['Last-handler contacts started today',r=>r.lastHandlerContactsToday],
      ['Completed (started today)',r=>r.lastHandlerCompletedStartedToday],['Free capacity',()=> 'Not verified']
    ]);
    const stats=appendPanel('vbChatStats','Chat Statistics',globalPanel,true);
    if(stats)stats.insertAdjacentHTML('beforeend',`<p class="vb-ops-meta" id="chat-freshness" role="status"></p><div class="vb-ops-cards" id="chat-cards"></div><p class="vb-ops-meta" id="chat-mean-note"></p>`);
    const fields=[['Contact ID',r=>r.contactId],['Queue',r=>r.queue||'Unavailable'],['Agent (reported)',r=>r.agent||'Unavailable'],
      ['Started (CST/CDT)',r=>time(r.startedAt),r=>r.startedAt||0],['First accepted (CST/CDT)',r=>time(r.connectedAt),r=>r.connectedAt||0],
      ['Ended (CST/CDT)',r=>time(r.endedAt),r=>r.endedAt||0],['Recorded queue duration',r=>duration(r.queueWaitMs),r=>r.queueWaitMs??-1],['Status',r=>r.status]];
    table(appendPanel('vbHandledChats',"Today's Handled Chats",$('answeredCallsPanel')),'chat-handled',fields,[['all','Handled contacts started today'],['active','Active now (30-day snapshot)'],['completed','Completed today (including earlier starts)']]);
    table(appendPanel('vbAbandonedChats',"Today's Abandoned Chats",$('abandonedCallsPanel')),'chat-abandoned',fields.concat([['Reported reason',r=>r.abandonmentType||'Not supplied']]));
    const callbackPanel=appendPanel('vbCallbacks','Callback Register — History', $('vbAbandonedChats')||$('abandonedCallsPanel'));
    if(callbackPanel)callbackPanel.insertAdjacentHTML('beforeend','<p class="vb-ops-warning">Scheduled callback inventory is not connected. Upcoming, pending, overdue, canceled and assigned-due totals are unavailable. This history is not a list of all callback requests.</p>');
    table(callbackPanel,'callback-history',[
      ['Callback contact / attempt ID',r=>r.contactId],['Origin',r=>r.origin||'Unavailable'],['Type',r=>r.type||'Unavailable'],
      ['Requested',r=>time(r.requestedAt),r=>r.requestedAt||0],['Connected',r=>time(r.connectedAt),r=>r.connectedAt||0],
      ['Queue',r=>r.queue||'Unavailable'],['Agent',r=>r.agent||'Unavailable'],['Reported outcome',r=>r.status||'Not reported'],
      ['Reported retries',r=>r.reportedRetryCount??'Unavailable'],['Source interaction link',()=> 'Not available in history response']
    ]);
    render();tick();setInterval(tick,1000);
  }
  function renderQueues() {
    const body=$('queue-body');if(!body||!Array.isArray(base?.queues))return;
    const valid=approved()&&live?.liveStatus==='ready'&&fresh(live.liveObservedAt,45000)&&live.queueSnapshot?.unassigned===0;
    const map=new Map((live?.queueSnapshot?.rows||[]).map(q=>[String(q.id),q]));
    const table=body.closest('table');if(!table)return;
    table.classList.add('vb-ops-queue');
    table.querySelector('thead tr').innerHTML=['Queue','Channel','Waiting','Offered','Active','Wrap-up','Agents (legacy count)','Max wait','Avg wait'].map(x=>`<th>${esc(x)}</th>`).join('');
    body.innerHTML=base.queues.map(q=>{
      const chat=String(q.channelType||'').toLowerCase()==='chat', a=map.get(String(q.id)), ready=valid&&(!a||!a.unknown);
      const n=k=>ready?(a?.[k]||0):'Unavailable';
      const waiting=chat?n('waiting'):(q.calls??'Unavailable');
      const max=chat?(waiting===0?'00:00:00':'Unavailable'):(q.maxWait||'Unavailable');
      const avg=chat?(waiting===0?'00:00:00':'Unavailable'):(q.avgWait||'Unavailable');
      return `<tr><td>${esc(q.name)}</td><td>${chat?'Chat':esc(q.channelType||'Voice')}</td><td>${esc(waiting)}</td><td>${chat?esc(n('offered')):'—'}</td><td>${chat?esc(n('active')):'—'}</td><td>${chat?esc(n('wrapup')):'—'}</td><td>${esc(q.agents??'Unavailable')}</td><td>${esc(max)}</td><td>${esc(avg)}</td></tr>`;
    }).join('');
    let note=$('vb-queue-note');if(!note){note=document.createElement('p');note.id='vb-queue-note';note.className='vb-ops-meta';table.insertAdjacentElement('afterend',note);}
    note.textContent=valid?`Chat snapshot: ${time(live.liveObservedAt)}. Connected chats are Active, not Waiting. Current wait timing is unavailable without a verified queue-entry event. Agent count is not free capacity.`:'Chat live state unavailable or stale. Voice values retain their existing source.';
    if(valid){const hot=base.queues.some(q=>String(q.channelType||'').toLowerCase()==='chat'?(map.get(String(q.id))?.waiting||0)>0:Number(q.calls||0)>0);$('queue-panel')?.classList.toggle('queue-alert-active',hot);}
  }
  function render() {
    if(!started)return;
    const liveOK=approved()&&live?.liveStatus==='ready'&&fresh(live.liveObservedAt,45000);
    const dailyOK=approved()&&daily?.dailyStatus==='ready'&&fresh(daily.dailyObservedAt,150000);
    const completedOK=approved()&&daily?.completedStatus==='ready'&&fresh(daily.completedObservedAt,150000);
    const l=liveOK?live.summary:{},d=dailyOK?daily.summary:{};
    const cards=[['Chats offered — started today',value(d.offered)],['Chats handled — started today',value(d.handled)],['Chats abandoned — started today',value(d.abandoned)],
      ['Chats waiting now',value(l.waiting)],['Offers awaiting acceptance',value(l.offeredNow)],['Active chats now',value(l.active)],['Chats in wrap-up',value(l.wrapup)],
      ['Handled chats completed today',completedOK?value(daily.summary.completedToday):'Unavailable'],['Average recorded queue duration — completed',duration(d.averageQueueWaitMs?.status==='ready'?d.averageQueueWaitMs.value:null)]];
    if($('chat-cards'))$('chat-cards').innerHTML=cards.map(([label,v])=>`<div class="vb-ops-card"><strong>${esc(v)}</strong><span>${esc(label)}</span></div>`).join('');
    if($('chat-freshness'))$('chat-freshness').textContent=`Live: ${liveOK?time(live.liveObservedAt):'Unavailable / stale'} · Daily: ${dailyOK?time(daily.dailyObservedAt):'Unavailable / stale'}. Search data can lag. Live window: 30 days.`;
    const m=d.averageQueueWaitMs;
    if($('chat-mean-note'))$('chat-mean-note').textContent=dailyOK?`Queue-duration mean: ${m?.sampleCount??'unknown'} ended, handled contacts started today; ${m?.activeContactsExcluded??'unknown'} active handled contact(s) excluded. Recorded zero is not an estimated wait to acceptance.`:'Historical queue-duration samples unavailable.';
    const agents=new Map();
    const assignmentsKnown=liveOK&&(live.liveRows||[]).filter(r=>['Active','Wrap-up'].includes(r.status)).every(r=>r.agentId);
    for(const a of base?.agents||[])agents.set(String(a.agentId),{agentId:String(a.agentId),name:a.name,routingState:fresh(base?.generatedAtEpoch,45000)?(a.chatChannel?.routingState||null):null,active:assignmentsKnown?0:'Unavailable',wrapup:assignmentsKnown?0:'Unavailable',lastHandlerContactsToday:dailyOK?0:'Unavailable',lastHandlerCompletedStartedToday:dailyOK?0:'Unavailable'});
    const agent=r=>{if(!r.agentId)return null;let a=agents.get(String(r.agentId));if(!a){a={agentId:r.agentId,name:r.agent,routingState:null,active:assignmentsKnown?0:'Unavailable',wrapup:assignmentsKnown?0:'Unavailable',lastHandlerContactsToday:dailyOK?0:'Unavailable',lastHandlerCompletedStartedToday:dailyOK?0:'Unavailable'};agents.set(String(r.agentId),a);}return a;};
    if(dailyOK)for(const r of daily.rows||[])if(r.handled===true){const a=agent(r);if(a){a.lastHandlerContactsToday++;if(r.isActive===false)a.lastHandlerCompletedStartedToday++;}}
    if(assignmentsKnown)for(const r of live.liveRows||[])if(['Active','Wrap-up'].includes(r.status)){const a=agent(r);if(a){if(r.status==='Active')a.active++;else a.wrapup++;}}
    fill('chat-agents',[...agents.values()],liveOK||dailyOK,'Live workload uses current connected/wrap-up records. Historical counts use the last handling agent, not every transfer participant. Channel state is separate from free capacity.');
    const filter=tables.get('chat-handled')?.filter||'all';let handled=[],handledOK=false,note='';
    if(filter==='active'){handled=(live?.liveRows?.filter(r=>r.status==='Active')||[]).map(r=>({...r,connectedAt:daily?.rows?.find(d=>d.contactId===r.contactId)?.connectedAt??null}));handledOK=liveOK;note=`Currently connected contacts from the 30-day snapshot · ${time(live?.liveObservedAt)}`;}
    else if(filter==='completed'){handled=daily?.completedRows?.filter(r=>r.handled===true)||[];handledOK=completedOK;note=`Handled contacts ending today, including starts in prior 30 days · ${time(daily?.completedObservedAt)}`;}
    else{handled=daily?.rows?.filter(r=>r.handled===true)||[];handledOK=dailyOK;note=`Handled contacts STARTED today, including ongoing conversations · ${time(daily?.dailyObservedAt)}`;}
    fill('chat-handled',handled,handledOK,note);
    fill('chat-abandoned',daily?.completedRows?.filter(r=>r.status==='Abandoned')||[],completedOK,`Provider-marked abandonment before handling, contacts ENDING today · ${time(daily?.completedObservedAt)}. No browser-close inference.`);
    const cb=daily?.callbacks;fill('callback-history',cb?.rows||[],approved()&&cb?.status==='ready'&&fresh(cb.observedAt,150000),cb?.coverage||'Callback history unavailable; scheduled request inventory is not connected.');
    renderQueues();
  }
  async function request(view) {
    if(!approved()||document.hidden)return;
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),25000);
    try {
      const res=await fetch(endpoint+(view==='live'?'?view=live':''),{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
      if(!res.ok||!/^application\/(?:[a-z0-9.-]+\+)?json(?:;|$)/i.test(res.headers.get('content-type')||''))throw new Error('unavailable');
      const x=await res.json();if(!approved())return;
      if(x?.schemaVersion!==2||x.build!==BUILD||x.success!==true||x.channel!=='chat'||x.timezone!=='America/Chicago')throw new Error('wrong-contract');
      if(view==='live'){if(!Array.isArray(x.liveRows)||!x.queueSnapshot)throw new Error('invalid-live');live=x;}
      else{if(!Array.isArray(x.rows)||!Array.isArray(x.completedRows)||!x.summary)throw new Error('invalid-daily');daily=x;}
    }catch{if(view==='live')live=null;else daily=null;}finally{clearTimeout(timeout);render();}
  }
  function tick() {
    if(!approved()){live=null;daily=null;render();return;}
    if(document.hidden)return;
    const now=Date.now();
    if(!inLive&&now-lastLiveAttempt>=15000){lastLiveAttempt=now;inLive=request('live').finally(()=>{inLive=null;});}
    if(!inDaily&&now-lastDailyAttempt>=60000){lastDailyAttempt=now;inDaily=request('daily').finally(()=>{inDaily=null;});}
    // Clear stale metrics even when a refresh is slow or failed.
    render();
  }
  if(typeof fetchWebexDashboard==='function') {
    const retained=fetchWebexDashboard;
    fetchWebexDashboard=async function(...args){const data=await retained(...args);if(approved()){base=data;if(started)render();}return data;};
  }
  if(typeof loadQueueStatus==='function') {
    const retained=loadQueueStatus;
    loadQueueStatus=async function(...args){const result=await retained(...args);if(started)renderQueues();return result;};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap,{once:true});else bootstrap();
})();
