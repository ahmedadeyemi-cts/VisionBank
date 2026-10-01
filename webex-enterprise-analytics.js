(() => {
  "use strict";
  const DASHBOARD_ENDPOINT="https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/dashboard";
  const REPORTS_ENDPOINT="https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/daily-reports";
  const CENTRAL="America/Chicago";
  let dashboard=null,reports=null,dashboardAt=0,reportsAt=0,dTimer=null,rTimer=null;
  const $=id=>document.getElementById(id);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));
  const n=v=>Number.isFinite(Number(v))?Number(v):null;
  const count=v=>n(v)!==null?n(v).toLocaleString():"—";
  const pct=v=>n(v)!==null?`${n(v).toFixed(1)}%`:"—";
  const set=(id,v)=>{const el=$(id);if(el)el.textContent=v;};
  const fmtTime=e=>Number.isFinite(Number(e))?new Date(Number(e)).toLocaleString("en-US",{timeZone:CENTRAL,hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"}):"—";
  const dur=v=>{const m=String(v||"").match(/^(\d+):(\d{2}):(\d{2})$/);return m?(+m[1]*3600)+(+m[2]*60)+(+m[3]):null;};
  const fmtDur=s=>Number.isFinite(s)?`${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(Math.round(s%60)).padStart(2,"0")}`:"—";
  function status(msg,kind=""){const el=$("enterpriseAnalyticsStatus");if(el){el.textContent=msg;el.dataset.kind=kind;}}
  async function getJson(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),45000);try{const r=await fetch(url,{cache:"no-store",credentials:"omit",signal:c.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json();}finally{clearTimeout(t);}}
  function validDashboard(d){return d?.success===true&&Number.isFinite(d.generatedAtEpoch)&&Array.isArray(d.queues)&&Array.isArray(d.agents)&&d.statistics;}
  function validReports(d){return Number.isFinite(d?.generatedAtEpoch)&&Array.isArray(d?.answeredCalls)&&Array.isArray(d?.abandonedCalls)&&d.summary;}
  function state(a){const s=String(a?.status||"").toLowerCase();if(/engaged|connected|talk/.test(s))return"Engaged";if(/available|ready/.test(s))return"Available";if(s.includes("wrap"))return"Wrap-up";if(/idle|logged in|lunch|meeting|training/.test(s))return"Idle";return"Other";}
  function renderOverview(){
    if(!dashboard)return;
    const g=dashboard.statistics||{},agents=dashboard.agents||[];
    const states=agents.reduce((a,x)=>{const k=state(x);a[k]=(a[k]||0)+1;return a;},{});
    set("eaAgentsLoggedIn",count(agents.length));set("eaAgentsAvailable",count(states.Available||0));set("eaAgentsEngaged",count(states.Engaged||0));
    set("eaCallsWaiting",count(g.totalCallsQueued));set("eaServiceLevel",pct(g.serviceLevel));set("eaAnswerRate",pct(g.answerRate));set("eaAbandonRate",pct(g.abandonRate));
    set("eaMaxWait",String(g.maxQueueWaitingTime||"00:00:00"));set("eaCallbacksWaiting",count(g.callbacksWaiting));set("eaCallbacksRegistered",count(g.callbacksRegistered));
    const sh=$("eaStateDistribution");if(sh)sh.innerHTML=["Available","Engaged","Wrap-up","Idle","Other"].map(k=>{const v=states[k]||0,w=agents.length?Math.max(v?3:0,(v/agents.length)*100):0;return `<div class="ea-bar-row"><div class="ea-bar-label"><span>${k}</span><strong>${v}</strong></div><div class="ea-track"><span style="width:${w}%"></span></div></div>`;}).join("");
    const queues=(dashboard.queues||[]).slice().sort((a,b)=>Number(b.calls||0)-Number(a.calls||0)),qh=$("eaQueuePressure"),max=Math.max(1,...queues.map(q=>Number(q.calls||0)));
    if(qh)qh.innerHTML=queues.length?queues.slice(0,8).map(q=>{const calls=Number(q.calls||0),agents=Number(q.agents||0),w=Math.max(calls?6:0,(calls/max)*100);return `<div class="ea-queue-card"><div><strong>${esc(q.name||q.displayName||"Queue")}</strong><small>${agents} agent${agents===1?"":"s"} · ${esc(q.maxWait||q.maxWaitingTime||"00:00:00")} max wait</small></div><div class="ea-queue-meter"><span style="width:${w}%"></span></div><b>${calls} waiting</b></div>`;}).join(""):'<p class="ea-empty">No queue rows were returned.</p>';
  }
  function renderLeaderboard(){
    const host=$("eaLeaderboardRows");if(!host||!dashboard)return;
    const rows=(dashboard.agents||[]).map(a=>({...a,inbound:Number(a.inbound||0),outbound:Number(a.outbound||0),missed:Number(a.missed||0),transferred:Number(a.transferred||0)}));
    rows.forEach(a=>a.handled=a.inbound+a.outbound);rows.sort((a,b)=>b.handled-a.handled||b.inbound-a.inbound||a.missed-b.missed);
    host.innerHTML=rows.length?rows.map((a,i)=>`<tr><td>${i+1}</td><td><strong>${esc(a.name||"Unknown")}</strong><small>${esc(a.team||"—")}</small></td><td>${state(a)}</td><td>${a.inbound}</td><td>${a.outbound}</td><td>${a.missed}</td><td>${a.transferred}</td><td>${esc(a.avgHandle||"00:00:00")}</td></tr>`).join(""):'<tr><td colspan="8" class="ea-empty">No current agent-session data returned.</td></tr>';
  }
  function renderHourly(){
    const host=$("eaHourlyChart");if(!host)return;
    if(!reports){host.innerHTML='<p class="ea-empty">Daily report data is loading.</p>';return;}
    const buckets=new Map(Array.from({length:24},(_,h)=>[h,{answered:0,abandoned:0}]));
    const add=(rows,key)=>rows.forEach(r=>{
      if(!Number.isFinite(Number(r.startEpoch)))return;
      const p=new Intl.DateTimeFormat("en-US",{timeZone:CENTRAL,hour:"numeric",hour12:false}).formatToParts(new Date(Number(r.startEpoch)));
      const h=Number(p.find(x=>x.type==="hour")?.value);if(buckets.has(h))buckets.get(h)[key]++;
    });
    add(reports.answeredCalls||[],"answered");add(reports.abandonedCalls||[],"abandoned");
    const seen=[...buckets.entries()].filter(([,v])=>v.answered||v.abandoned);
    const max=Math.max(1,...seen.map(([,v])=>Math.max(v.answered,v.abandoned)));
    host.innerHTML=seen.length?seen.map(([h,v])=>`<div class="ea-hour"><div class="ea-hour-bars"><span class="ea-hour-answered" style="height:${Math.max(v.answered?5:0,(v.answered/max)*100)}%" title="Answered ${v.answered}"></span><span class="ea-hour-abandoned" style="height:${Math.max(v.abandoned?5:0,(v.abandoned/max)*100)}%" title="Abandoned ${v.abandoned}"></span></div><small>${String(h).padStart(2,"0")}:00</small></div>`).join(""):'<p class="ea-empty">No answered or abandoned rows reported for today.</p>';
  }
  function renderDaily(){
    if(!reports)return;const s=reports.summary||{},rows=reports.answeredCalls||[];
    set("eaTodayReceived",count(s.totalCallsReceived));set("eaTodayAnswered",count(s.answeredCalls));
    set("eaTodayAbandoned",count(s.abandonedCalls));set("eaTodayTransferred",count(s.transferredOutCalls));
    const talk=rows.map(r=>dur(r.talkTime)).filter(Number.isFinite),queue=rows.map(r=>dur(r.ivrQueueTime)).filter(Number.isFinite);
    set("eaAvgTalk",fmtDur(talk.length?talk.reduce((a,b)=>a+b,0)/talk.length:null));
    set("eaAvgQueue",fmtDur(queue.length?queue.reduce((a,b)=>a+b,0)/queue.length:null));renderHourly();
  }
  function renderFresh(){
    set("eaRealtimeFreshness",dashboard?`Realtime snapshot: ${fmtTime(dashboard.generatedAtEpoch)}`:"Realtime snapshot unavailable");
    set("eaDailyFreshness",reports?`Daily reporting: ${fmtTime(reports.generatedAtEpoch)}`:"Daily reporting unavailable");
    const fresh=dashboard&&Date.now()-Number(dashboard.generatedAtEpoch)<150000;
    status(fresh?"Enterprise analytics synchronized with the live dashboard.":"Showing the latest available data; live reporting is delayed.",fresh?"ok":"warn");
  }
  function renderAll(){renderOverview();renderLeaderboard();renderDaily();renderFresh();}
  async function refreshDashboard(force=false){
    if(window.VB_SECURITY&&window.VB_SECURITY.allowed!==true)return;
    if(!force&&dashboard&&Date.now()-dashboardAt<10000)return;
    try{
      const d=await getJson(DASHBOARD_ENDPOINT+(force?"?refresh=1":""));
      if(!validDashboard(d))throw new Error("Incomplete dashboard response");
      dashboard=d;dashboardAt=Date.now();renderAll();
    }catch(e){console.debug("Enterprise analytics dashboard refresh deferred:",e?.message||e);renderFresh();}
  }
  async function refreshReports(force=false){
    if(window.VB_SECURITY&&window.VB_SECURITY.allowed!==true)return;
    if(!force&&reports&&Date.now()-reportsAt<30000)return;
    try{
      const d=await getJson(REPORTS_ENDPOINT+(force?"?refresh=1":""));
      if(!validReports(d))throw new Error("Incomplete daily report response");
      reports=d;reportsAt=Date.now();renderAll();
    }catch(e){console.debug("Enterprise analytics daily refresh deferred:",e?.message||e);renderFresh();}
  }
  function bind(){
    document.querySelectorAll("[data-ea-tab]").forEach(btn=>btn.addEventListener("click",()=>{
      const tab=btn.dataset.eaTab;
      document.querySelectorAll("[data-ea-tab]").forEach(b=>b.classList.toggle("active",b===btn));
      document.querySelectorAll("[data-ea-view]").forEach(v=>v.hidden=v.dataset.eaView!==tab);
    }));
    const refresh=$("enterpriseAnalyticsRefresh");
    if(refresh)refresh.addEventListener("click",async()=>{
      refresh.disabled=true;status("Refreshing enterprise analytics…");
      try{await Promise.all([refreshDashboard(true),refreshReports(true)]);}finally{refresh.disabled=false;}
    });
  }
  function init(){
    bind();void refreshDashboard(true);void refreshReports(true);
    dTimer=setInterval(()=>void refreshDashboard(false),30000);
    rTimer=setInterval(()=>void refreshReports(false),60000);
    window.addEventListener("pagehide",()=>{clearInterval(dTimer);clearInterval(rTimer);});
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
