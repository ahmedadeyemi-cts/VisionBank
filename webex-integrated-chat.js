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
    $(s.id+'-body').innerHTML=rows.length?rows.slice((s.page-1)*25,s.page*25).map(r=>'<tr>'+s.columns.map(c=>{const tone=typeof c[3]==='function'?c[3](r):null;const attr=['available','engaged','wrapup','idle','unknown'].includes(tone)?` class="vb-agent-state" data-state="${tone}"`:'';return `<td${attr}>${esc(c[1](r)??'Unavailable')}</td>`;}).join('')+'</tr>').join(''):`<tr><td colspan="${s.columns.length}" class="vb-ops-empty">${ready?'No matching records in the stated reporting scope.':'Unavailable — no zero totals have been substituted.'}</td></tr>`;
    $(s.id+'-page').textContent=ready?`${rows.length} records · Page ${s.page} of ${pages}`:'Unavailable';
    $(s.id+'-prev').disabled=!ready||s.page<=1;$(s.id+'-next').disabled=!ready||s.page>=pages;
    $(s.id+'-export').disabled=!ready||!rows.length;
    $(s.id+'-body').closest('table').querySelectorAll('th').forEach((th,i)=>th.setAttribute('aria-sort',i===s.sort?(s.desc?'descending':'ascending'):'none'));
  }
  function fill(id,rows,ready,meta) {
    const t=tables.get(id);if(!t)return;t.rows=rows;t.ready=ready;$(id+'-meta').textContent=meta;renderTable(t);
  }
  // Presentation only: missing reporting fields never assert an agent is unavailable.
  function buildChatAgentPresentation(dashboard, liveReport, dailyReport, now = Date.now()) {
    const recent = (stamp, limit) => Number.isFinite(stamp) && now - stamp >= -5000 && now - stamp < limit;
    const text = v => typeof v === 'string' ? v.trim() : '';
    const sessionFresh = dashboard?.success === true && Array.isArray(dashboard.agents) && recent(dashboard.generatedAtEpoch, 45000);
    const liveFresh = liveReport?.liveStatus === 'ready' && Array.isArray(liveReport.liveRows) && recent(liveReport.liveObservedAt, 45000);
    const dailyFresh = dailyReport?.dailyStatus === 'ready' && Array.isArray(dailyReport.rows) && recent(dailyReport.dailyObservedAt, 150000);
    const activeRows = liveFresh ? liveReport.liveRows.filter(r => ['Active', 'Wrap-up'].includes(r.status)) : [];
    const ownershipKnown = liveFresh && activeRows.every(r => text(r.agentId)) &&
      ['active', 'wrapup'].every(k => liveReport.summary?.[k]?.status === 'ready' && Number.isInteger(liveReport.summary[k].value) && liveReport.summary[k].value >= 0) &&
      liveReport.summary.active.value === activeRows.filter(r => r.status === 'Active').length &&
      liveReport.summary.wrapup.value === activeRows.filter(r => r.status === 'Wrap-up').length;
    const agents = new Map();
    const get = (id, name) => {
      id = text(id); if (!id) return null;
      if (!agents.has(id)) agents.set(id, {agentId:id, name:text(name)||id, sessionReported:false,
        staleSession:false, liveRecord:false, history:false, rawRouting:'', activeCount:0, wrapupCount:0,
        lastHandlerContactsToday:dailyFresh?0:null, lastHandlerCompletedStartedToday:dailyFresh?0:null});
      return agents.get(id);
    };
    for (const a of Array.isArray(dashboard?.agents) ? dashboard.agents : []) {
      const row = get(a.agentId, a.name); if (!row) continue;
      row.sessionReported = sessionFresh; row.staleSession = !sessionFresh;
      row.rawRouting = sessionFresh ? text(a.chatChannel?.routingState) : '';
      row.overall = sessionFresh && recent(a.agentStatus?.observedAt,45000) ? text(a.agentStatus.state) : '';
      row.overallTone = sessionFresh && ['available','engaged','wrapup','idle','unknown'].includes(a.agentStatus?.tone) ? a.agentStatus.tone : 'unknown';
      row.slotLimit = sessionFresh && Number.isInteger(a.chatChannel?.reportedSlotCount) ? a.chatChannel.reportedSlotCount : null;
      row.slotActive = sessionFresh && Number.isInteger(a.chatChannel?.activeSlots) ? a.chatChannel.activeSlots : null;
      row.slotWrapup = sessionFresh && Number.isInteger(a.chatChannel?.wrapupSlots) ? a.chatChannel.wrapupSlots : null;
      row.slotNewer = sessionFresh && recent(a.chatChannel?.observedAt,45000) && a.chatChannel.observedAt >= (liveReport?.liveObservedAt || 0);
    }
    if (dailyFresh) for (const r of dailyReport.rows) {
      if (r.handled !== true) continue;
      const row = get(r.agentId, r.agent); if (!row) continue;
      row.history = true; row.lastHandlerContactsToday++;
      if (r.isActive === false) row.lastHandlerCompletedStartedToday++;
    }
    for (const r of activeRows) {
      const row = get(r.agentId, r.agent); if (!row) continue;
      row.liveRecord = true;
      if (ownershipKnown) { if (r.status === 'Active') row.activeCount++; else row.wrapupCount++; }
    }
    const reportedNames = {available:'Available', idle:'Idle', engaged:'Engaged', busy:'Busy',
      unavailable:'Unavailable', wrapup:'Wrap-up', 'wrap-up':'Wrap-up', 'engagedother':'Engaged other'};
    const rows = [...agents.values()].map(row => {
      const current = row.sessionReported || row.liveRecord;
      const active = ownershipKnown && current ? row.activeCount : row.slotNewer && row.slotActive > 0 ? row.slotActive : null;
      const wrapup = ownershipKnown && current ? row.wrapupCount : row.slotNewer && row.slotWrapup > 0 ? row.slotWrapup : null;
      const raw = row.rawRouting, key = raw.toLowerCase();
      const routingState = raw ? (reportedNames[key] || raw) : (row.staleSession && !row.liveRecord ? 'Stale data' : 'Not reported');
      const routingTone = !raw ? 'unknown' : key === 'available' ? 'available' :
        ['engaged','busy','engagedother'].includes(key) ? 'engaged' : ['wrapup','wrap-up'].includes(key) ? 'wrapup' : 'idle';
      const activity = active > 0 ? 'Engaged — Chat' : wrapup > 0 ? 'Wrap-up — Chat' :
        ownershipKnown && current ? 'No active chat reported' : row.history && !current ? 'History only' : 'Not reported';
      return {...row, active, wrapup, routingState, routingTone, activity,
        activityTone:active>0?'engaged':wrapup>0?'wrapup':'unknown',
        dataSource:row.sessionReported?'Live session':row.liveRecord?'Live Chat record':row.history?'History only':'Stale session data'};
    });
    return {rows, sessionFresh, liveFresh, dailyFresh};
  }
  function renderAgentActivity(presentation) {
    const body = $('agent-body'), table = body?.closest('table'); if (!table) return;
    const header = table.querySelector('thead tr'); if (!header) return;
    const availability = header.children[3];
    if (availability) {
      availability.textContent = 'Agent state';
      availability.title = 'Overall agent activity from reported Voice and Chat slots, shared by both agent views. Specific Chat workload is separate.';
    }
    if (!header.querySelector('[data-vb-chat-activity]') && availability) {
      const th = document.createElement('th'); th.dataset.vbChatActivity = 'true';
      th.textContent = 'Current Chat activity'; th.scope = 'col'; availability.insertAdjacentElement('afterend', th);
    }
    table.classList.add('vb-agent-table');
    if (!table.parentElement.classList.contains('vb-agent-scroll')) {
      const wrap = document.createElement('div'); wrap.className = 'vb-agent-scroll';
      table.before(wrap); wrap.append(table);
    }
    const byId = new Map(presentation.rows.map(a => [a.agentId, a]));
    for (const tr of body.querySelectorAll('tr')) {
      const routing = tr.querySelector('.availability-cell');
      if (!routing) { const cell = tr.querySelector('td[colspan]'); if (cell) cell.colSpan = header.children.length; continue; }
      let cell = tr.querySelector('[data-vb-chat-activity]');
      if (!cell) { cell = document.createElement('td'); cell.dataset.vbChatActivity = 'true'; cell.className = 'vb-agent-activity'; routing.after(cell); }
      const a = byId.get(tr.dataset.vbAgentId);
      const provider = base?.agents?.find(x=>String(x.agentId)===tr.dataset.vbAgentId);
      const raw = fresh(base?.generatedAtEpoch,45000) ? String(provider?.status||'').trim() : '';
      const key = raw.toLowerCase();
      const busy = ['connected','engaged','hold','held','on-hold','consulting','conferencing'].includes(key);
      const wrapup = ['wrapup','wrap-up'].includes(key);
      routing.textContent = busy ? 'Engaged' : wrapup ? 'Wrap-up' : key==='available' ? 'Available' : raw||'Not reported';
      routing.dataset.vbState = busy?'engaged':wrapup?'wrapup':key==='available'?'available':raw?'idle':'unknown';
      routing.title = raw ? 'Reported Voice state: '+raw : 'Current Voice state was not reported.';
      if(a?.overall){routing.textContent=a.overall;routing.dataset.vbState=a.overallTone;}
      cell.textContent = a?.activity || 'Not reported'; cell.dataset.state = a?.activityTone || 'unknown';
      cell.title = 'Activity is derived from reported current Chat assignments; it does not change routing availability or prove free capacity.';
    }
  }
  function bootstrap() {
    if(started)return;started=true;
    const agentPanel=$('agent-body')?.closest('.panel'), globalPanel=$('global-error')?.closest('.panel');
    if(globalPanel?.querySelector('h2'))globalPanel.querySelector('h2').textContent='Voice Statistics';
    const agent=appendPanel('vbChatAgents','Chat Agent Performance',agentPanel,true);
    table(agent,'chat-agents',[
      ['Agent',r=>r.name||r.agentId],['Current activity',r=>r.activity,null,r=>r.activityTone],
      ['Agent state',r=>r.overall||'Not reported',null,r=>r.overallTone||'unknown'],
      ['Active chats / slots',r=>r.slotLimit ? `${r.active??'—'} / ${r.slotLimit}` : r.active??'—'],['Wrap-up',r=>r.wrapup??'—'],
      ['Handled today (last agent)',r=>r.lastHandlerContactsToday??'Not reported'],
      ['Completed (started today)',r=>r.lastHandlerCompletedStartedToday??'Not reported'],['Data source',r=>r.dataSource],['Chat slot state (reported)',r=>r.routingState]
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
    const table=body.closest('table');if(!table)return;
    const current=approved()&&fresh(base.generatedAtEpoch,45000);
    table.classList.add('vb-ops-queue');
    table.querySelector('thead tr').innerHTML=['Queue','Channel','Waiting','Offered','Active','Wrap-up','Agents (legacy count)','Max wait','Avg wait'].map(x=>`<th>${esc(x)}</th>`).join('');
    body.innerHTML=base.queues.map(q=>{
      const known=current&&q.operationsRevision===3&&q.countStatus==='ready';
      const n=k=>known&&Number.isInteger(q[k])&&q[k]>=0?q[k]:'Not reported';
      const label=String(q.channelType).toLowerCase()==='chat'?'Chat':'Voice';
      return `<tr><td>${esc(q.name)}</td><td>${label}</td><td>${esc(n('waiting'))}</td><td>${esc(n('offered'))}</td><td>${esc(n('active'))}</td><td>${esc(n('wrapup'))}</td><td>${esc(q.agents??'Not reported')}</td><td>${esc(known?q.maxWait:'Not reported')}</td><td>${esc(known?q.avgWait:'Not reported')}</td></tr>`;
    }).join('');
    let note=$('vb-queue-note');if(!note){note=document.createElement('p');note.id='vb-queue-note';note.className='vb-ops-meta';table.insertAdjacentElement('afterend',note);}
    note.textContent=current?`Voice and Chat snapshot: ${time(base.generatedAtEpoch)}. Only Waiting contacts trigger queue alerts. Offered, Active and Wrap-up are separate. Timers require a current queue-entry event.`:'Current queue snapshot is stale or unavailable; no zero counts are inferred.';
    $('queue-panel')?.classList.toggle('queue-alert-active',current&&base.queues.some(q=>q.operationsRevision===3&&q.countStatus==='ready'&&q.waiting>0));
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
    const presentation = buildChatAgentPresentation(base, live, daily);
    fill('chat-agents', presentation.rows, approved() && (presentation.liveFresh || presentation.dailyFresh || presentation.sessionFresh),
      `Reported sessions: ${presentation.sessionFresh?time(base.generatedAtEpoch):'Not reported / stale'} · Chat workload: ${liveOK?time(live.liveObservedAt):'Not reported / stale'}. “Not reported” is missing data, not an unavailable agent. History-only rows show past work, not current sign-in. Agent state is shared across both views. Chat slot state and occupied slots are separate; a remaining slot does not guarantee routing eligibility.`);
    renderAgentActivity(presentation);
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
  if(typeof loadAgentStatus==='function') {
    const retained=loadAgentStatus;
    loadAgentStatus=async function(...args){const result=await retained(...args);if(started)renderAgentActivity(buildChatAgentPresentation(base,live,daily));return result;};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',bootstrap,{once:true});else bootstrap();
})();
