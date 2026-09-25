/* Shared Voice/Chat state presentation and bounded login reminder. No agent actions. */
(function(root){
  'use strict';
  const DEFAULTS=Object.freeze({enabled:true,animate:true,graceSeconds:60,loginReasonName:'Logged In',loginReasonId:''});
  const CATEGORIES=new Set(['available','engaged','wrapup','idle','unknown','offered']);
  const recent=(stamp,now)=>Number.isFinite(stamp)&&now-stamp>=0&&now-stamp<45000;
  const text=v=>typeof v==='string'?v.trim():'';
  function settings(v={}) {
    return {...DEFAULTS,enabled:typeof v.enabled==='boolean'?v.enabled:true,animate:typeof v.animate==='boolean'?v.animate:true,
      graceSeconds:Number.isInteger(v.graceSeconds)&&v.graceSeconds>=15&&v.graceSeconds<=900?v.graceSeconds:60,
      loginReasonName:text(v.loginReasonName).slice(0,80)||DEFAULTS.loginReasonName,loginReasonId:text(v.loginReasonId).slice(0,128)};
  }
  function stateFor(agent,presentation,dashboard,liveReport,now=Date.now()) {
    const x=agent?.stateIndicator;
    const result={category:'unknown',label:'Not reported',login:false,due:false,key:null,since:null};
    if(!agent||!recent(dashboard?.generatedAtEpoch,now)||x?.revision!==4||!recent(x.observedAt,now)||!CATEGORIES.has(x.category))return result;
    const out={...result,category:x.category,label:text(x.label)||'Not reported'};
    // Positive current work wins over an older/contradictory idle snapshot for attention purposes.
    if(presentation?.active>0&&liveReport?.liveObservedAt>x.observedAt)return {...out,category:'engaged',label:'Engaged'};
    if(presentation?.wrapup>0&&liveReport?.liveObservedAt>x.observedAt)return {...out,category:'wrapup',label:'Wrap-up'};
    const cfg=settings(dashboard?.settings?.agentStateIndicators),reason=x.idleReason;
    const matches=cfg.loginReasonId?reason?.id===cfg.loginReasonId:text(reason?.name).toLowerCase()===cfg.loginReasonName.toLowerCase();
    const noChatWork=liveReport?.liveStatus==='ready'&&recent(liveReport.liveObservedAt,now)&&presentation?.active===0&&presentation?.wrapup===0;
    if(x.category!=='idle'||x.idleVerified!==true||!text(reason?.id)||!matches||!noChatWork||!text(agent.sessionId)||
      !Number.isFinite(x.stateStartedAt)||x.stateStartedAt<=0||x.stateStartedAt>now)return out;
    return {...out,login:cfg.enabled,due:cfg.enabled&&now-x.stateStartedAt>=cfg.graceSeconds*1000,since:x.stateStartedAt,
      key:JSON.stringify([agent.agentId,agent.sessionId,reason.id,x.stateStartedAt])};
  }
  function makeCueStore(storage) {
    const key='vb-agent-login-cues-v1';let cache={};
    const read=()=>{try{const raw=storage?.getItem(key);if(raw&&raw.length<500000){const v=JSON.parse(raw);if(v&&typeof v==='object'&&!Array.isArray(v))cache={...cache,...v};}}catch{}};
    return {cue(state,cfg,now,reduced=false){
      if(!state.due||!state.key)return {pulse:false,elapsed:0};read();
      let entry=cache[state.key];
      if(!entry||!Number.isFinite(entry.at)) {
        entry={at:now,quiet:!cfg.animate||reduced};cache[state.key]=entry;
        const keep=Object.entries(cache).filter(([,v])=>v&&Number.isFinite(v.at)).sort((a,b)=>b[1].at-a[1].at).slice(0,2000);
        cache=Object.fromEntries(keep);
        try{if(!storage)throw new Error();storage.setItem(key,JSON.stringify(cache));}catch{entry.quiet=true;}
      }
      const elapsed=now-entry.at;
      return {pulse:cfg.animate&&!reduced&&!entry.quiet&&elapsed>=0&&elapsed<4000,elapsed};
    }};
  }
  const duration=ms=>[Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(x=>String(x).padStart(2,'0')).join(':');
  let cueStore=null;
  function decorate(presentation,dashboard,liveReport) {
    if(!root.document)return;
    const now=Date.now(),cfg=settings(dashboard?.settings?.agentStateIndicators);
    if(!cueStore){let storage;try{storage=root.localStorage;}catch{}cueStore=makeCueStore(storage);}
    const reduced=Boolean(root.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const byId=new Map((presentation?.rows||[]).map(a=>[String(a.agentId),a]));
    const agents=new Map((dashboard?.agents||[]).map(a=>[String(a.agentId),a]));
    for(const tr of root.document.querySelectorAll('#agent-body tr[data-vb-agent-id],#chat-agents-body tr[data-vb-agent-id]')) {
      const id=tr.dataset.vbAgentId,a=agents.get(id),p=byId.get(id);
      const cell=tr.closest('tbody').id==='agent-body'?tr.querySelector('.availability-cell'):tr.children[2];if(!cell)continue;
      const state=stateFor(a,p,dashboard,liveReport,now);
      cell.dataset.vbState=state.category;cell.dataset.state=state.category;cell.dataset.vbIndicator='true';
      cell.classList.remove('vb-login-cue');cell.style.removeProperty('animation-delay');cell.textContent=state.label;
      cell.title=state.category==='unknown'?'Current state was not reported.':'Reported agent state: '+state.label;
      if(state.login) {
        const line=root.document.createElement('small');line.className='vb-login-notice';
        line.textContent=(state.due?'⚠ ':'')+'Not ready · '+duration(Math.max(0,now-state.since));cell.append(line);
        cell.title='Signed in, but still in the configured Logged In Idle reason. This reminder does not change the agent state.';
      }
      const cue=cueStore.cue(state,cfg,now,reduced);
      if(cue.pulse&&!root.document.hidden){cell.classList.add('vb-login-cue');cell.style.animationDelay=`-${cue.elapsed}ms`;}
    }
  }
  const IDS={enabled:'agentLoginReminderEnabled',animate:'agentLoginReminderAnimate',graceSeconds:'agentLoginReminderGrace',loginReasonName:'agentLoginReasonName',loginReasonId:'agentLoginReasonId'};
  function applySettings(value) {
    const cfg=settings(value);
    for(const[k,id]of Object.entries(IDS)){const el=root.document?.getElementById(id);if(!el)continue;if(el.type==='checkbox')el.checked=cfg[k];else el.value=cfg[k];}
  }
  function validForm(){return Object.values(IDS).every(id=>root.document?.getElementById(id)?.reportValidity()!==false);}
  function readSettings(){const v={};for(const[k,id]of Object.entries(IDS)){const e=root.document?.getElementById(id);if(!e)continue;v[k]=e.type==='checkbox'?e.checked:k==='graceSeconds'?Number(e.value):e.value.trim();}return settings(v);}
  root.VB_AGENT_INDICATORS={settings,stateFor,makeCueStore,decorate,applySettings,readSettings,validForm};
  if(root.document)root.document.addEventListener('DOMContentLoaded',()=>{
    applySettings(DEFAULTS);
    for(const id of Object.values(IDS)){const e=root.document.getElementById(id);if(!e)continue;e.addEventListener('change',()=>{if(typeof markDashboardSettingsDirty==='function')markDashboardSettingsDirty();});if(e.tagName==='INPUT'&&e.type!=='checkbox')e.addEventListener('input',()=>{if(typeof markDashboardSettingsDirty==='function')markDashboardSettingsDirty();});}
  },{once:true});
})(typeof window!=='undefined'?window:globalThis);
