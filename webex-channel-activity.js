/* VisionBank channel activity: display only. No network calls, timers, credentials or agent actions. */
(function (root) {
  'use strict';
  const BUILD = '2026.09.29-channel-activity-1';
  const text = v => typeof v === 'string' ? v.trim() : '';
  const key = v => text(v).toLowerCase().replace(/[ _]/g, '-');
  const count = n => Number.isInteger(n) && n >= 0;
  const recent = (at, now) => Number.isFinite(at) && now - at >= -5000 && now - at < 45000;
  const categories = new Set(['available', 'engaged', 'wrapup', 'idle', 'offered']);
  const channelStates = new Set(['available', 'idle', 'engaged', 'connected', 'hold', 'held', 'on-hold',
    'consulting', 'conferencing', 'wrapup', 'wrap-up', 'reserved', 'offered', 'unavailable', 'not-ready',
    'engagedother', 'engaged-other']);
  function sessionValid(agent, dashboard, now) {
    return !!agent && dashboard?.success === true && Array.isArray(dashboard.agents) &&
      dashboard.agents.includes(agent) && recent(dashboard.generatedAtEpoch, now);
  }
  function overall(agent, dashboard, now) {
    const s = agent?.stateIndicator;
    return sessionValid(agent, dashboard, now) && s?.revision === 4 && recent(s.observedAt, now) && categories.has(s.category)
      ? {category:s.category, label:text(s.label), at:s.observedAt} : {category:'unknown', label:'Not reported', at:0};
  }
  function snapshot(channel, validSession, now) {
    const unknown = {known:false, active:null, wrapup:null, offered:null, limit:null, at:0, routing:''};
    if (!validSession || !channel || !recent(channel.observedAt, now) ||
        channel.source !== 'agentSession.channelInfo' || text(channel.reason) ||
        !count(channel.reportedSlotCount) || channel.reportedSlotCount < 1 ||
        !channelStates.has(key(channel.routingState))) return unknown;
    const active=channel.activeSlots, wrapup=channel.wrapupSlots, offered=channel.offeredSlots, limit=channel.reportedSlotCount;
    if (![active,wrapup,offered,channel.availableSlots].every(count) ||
        active+wrapup+offered+channel.availableSlots > limit) return unknown;
    return {known:true, active, wrapup, offered, limit, at:channel.observedAt, routing:key(channel.routingState), source:channel.source};
  }
  // A newer, complete current-contact snapshot may establish positive Chat work. It never establishes Voice state.
  // Zero Chat work is taken from the per-agent channel snapshot, not from absent historical records.
  function liveChat(agentId, report, now) {
    if (!text(agentId) || report?.liveStatus !== 'ready' || !recent(report.liveObservedAt, now) || !Array.isArray(report.liveRows)) return null;
    const buckets={Active:'active', 'Wrap-up':'wrapup', Offered:'offeredNow'};
    const totals={active:0,wrapup:0,offeredNow:0}, own={active:0,wrapup:0,offered:0}, ids=new Set();
    for (const row of report.liveRows) {
      const b=buckets[row.status]; if (!b) continue;
      if (!text(row.contactId) || ids.has(row.contactId) || !text(row.agentId)) return null;
      ids.add(row.contactId); totals[b]++;
      if (row.agentId === agentId) own[b==='offeredNow'?'offered':b]++;
    }
    if (!Object.keys(totals).every(b => report.summary?.[b]?.status === 'ready' && count(report.summary[b].value) && report.summary[b].value===totals[b])) return null;
    return {...own, at:report.liveObservedAt};
  }
  function channelView(type, data, state) {
    const name=type==='phone'?'Phone':'Chat';
    let tone='unknown', label='Not reported';
    if (data.known) {
      if (data.active>0) {tone='engaged'; label=type==='phone'?'On call':`${data.active} active`;}
      else if (data.wrapup>0) {tone='wrapup'; label=type==='phone'?'Wrap-up':`${data.wrapup} in wrap-up`;}
      else if (data.offered>0) {tone='engaged'; label=type==='phone'?'Offered':`${data.offered} offered`;}
      else if (state.category==='idle') {tone='idle';label='Not available';}
      else if (state.category!=='unknown') {tone='available';label=type==='phone'?'No call':'No active chats';}
    }
    const slots=type==='chat' && data.known && count(data.active)
      ? `${data.active} / ${count(data.limit)&&data.limit>0?data.limit:'—'}` : '';
    const details=data.known?`${data.active} active, ${data.wrapup} in wrap-up, ${data.offered} offered`:'Current channel information is unavailable or stale';
    const tooltip=`${name}: ${label}. ${details}. `+(slots?`Active chats / reported slots: ${slots}. `:'')+
      (tone==='idle'?`Agent state: ${state.label || 'Idle'}. `:'')+
      'Activity is separate from the shared agent state. No work does not guarantee routing eligibility.';
    return {type,name,tone,label,slots,active:data.known?data.active:null,wrapup:data.known?data.wrapup:null,
      offered:data.known?data.offered:null,limit:data.known?data.limit:null,tooltip};
  }
  function model(agent, dashboard, report, agentId, now=Date.now()) {
    const valid=sessionValid(agent,dashboard,now), state=overall(agent,dashboard,now);
    const voice=snapshot(agent?.voiceChannel,valid,now);
    let chat=snapshot(agent?.chatChannel,valid,now);
    const live=liveChat(text(agent?.agentId)||text(agentId),report,now);
    if (live && live.active+live.wrapup+live.offered>0 && (!chat.known || live.at>chat.at)) {
      const total=live.active+live.wrapup+live.offered;
      chat={...chat,...live,known:true,limit:chat.known&&total<=chat.limit?chat.limit:null,source:'current Chat contacts'};
    }
    return {phone:channelView('phone',voice,state),chat:channelView('chat',chat,state)};
  }
  function summary(m) {
    return m ? `Phone: ${m.phone.label}; Chat: ${m.chat.label}${m.chat.slots?' ('+m.chat.slots+' active / slots)':''}` : 'Phone: Not reported; Chat: Not reported';
  }
  const svgPaths={
    phone:'M6.6 2.7 9.2 6.6 7.5 8.3c1.5 3 3.2 4.7 6.2 6.2l1.7-1.7 3.9 2.6c.6.4.8 1 .5 1.7-.8 2-2.1 3-4 2.3C8.2 17 3 11.8.6 4.2c-.6-1.9.4-3.2 2.4-4 .6-.3 1.3-.1 1.7.5Z',
    chat:'M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-9l-6 4v-4H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z'
  };
  function icon(doc,type) {
    const ns='http://www.w3.org/2000/svg',svg=doc.createElementNS(ns,'svg'),path=doc.createElementNS(ns,'path');
    svg.setAttribute('viewBox',type==='phone'?'-1 -1 24 24':'0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');
    path.setAttribute('d',svgPaths[type]);path.setAttribute('fill','currentColor');svg.append(path);
    if(type==='chat')for(const x of [7,12,17]){const circle=doc.createElementNS(ns,'circle');circle.setAttribute('cx',String(x));circle.setAttribute('cy','10');circle.setAttribute('r','1.2');circle.setAttribute('class','vb-channel-dot');svg.append(circle);}
    return svg;
  }
  function render(cell, data) {
    if(!cell || !root.document)return;
    data ||= model(null,null,null,'');
    cell.classList.add('vb-channel-cell');cell.removeAttribute('data-state');
    const signature=JSON.stringify(data);if(cell.dataset.vbChannelRender===signature)return;
    cell.dataset.vbChannelRender=signature;cell.title='Reported channel activity; no routing or agent-state changes.';
    const doc=cell.ownerDocument,group=doc.createElement('div');group.className='vb-channel-activity';group.setAttribute('role','group');group.setAttribute('aria-label','Phone and Chat activity');
    for(const v of [data.phone,data.chat]) {
      const item=doc.createElement('span');item.className='vb-channel';item.dataset.channel=v.type;item.dataset.tone=v.tone;item.title=v.tooltip;
      item.setAttribute('aria-label',`${v.name}: ${v.label}${v.slots?', '+v.slots+' active chats / slots':''}`);
      const badge=doc.createElement('span');badge.className='vb-channel-icon';badge.append(icon(doc,v.type));
      const copy=doc.createElement('span');copy.className='vb-channel-copy';
      const title=doc.createElement('span');title.className='vb-channel-name';title.textContent=v.name;
      const status=doc.createElement('span');status.className='vb-channel-label';status.textContent=v.label;
      copy.append(title,status);
      if(v.slots){const n=doc.createElement('small');n.className='vb-channel-slots';n.textContent=v.slots;copy.append(n);}
      item.append(badge,copy);group.append(item);
    }
    cell.replaceChildren(group);
  }
  function legend(anchor) {
    if(!anchor || anchor.querySelector('.vb-channel-legend'))return;
    const doc=anchor.ownerDocument,el=doc.createElement('div');el.className='vb-channel-legend';el.setAttribute('aria-label','Channel activity color key');
    for(const [tone,label]of [['available','No work reported'],['engaged','In use / offered'],['idle','Agent Idle'],['wrapup','Wrap-up'],['unknown','Not reported']]){
      const item=doc.createElement('span'),swatch=doc.createElement('span');item.className='vb-channel-legend-item';item.dataset.tone=tone;swatch.className='vb-channel-swatch';swatch.setAttribute('aria-hidden','true');item.append(swatch,doc.createTextNode(label));el.append(item);
    }
    const note=doc.createElement('small');note.textContent='Phone and Chat are independent activity indicators. Chat counts are active / reported slots, not guaranteed free capacity.';el.append(note);anchor.append(el);
  }
  root.VB_CHANNEL_ACTIVITY={BUILD,model,summary,render,legend};
})(typeof window!=='undefined'?window:globalThis);
