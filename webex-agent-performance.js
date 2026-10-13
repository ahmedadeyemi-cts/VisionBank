/* Daily performance is independent of live status. Webex history is authoritative. */
(() => {
 'use strict';
 let snapshot=null,mode='today',pending=false,next=0;
 const day=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(stamp);
 const ready=()=>window.VB_SECURITY?.allowed===true&&snapshot?.success===true&&Date.now()-snapshot.observedAt<150000&&Date.now()-snapshot.observedAt>=-5000&&day(snapshot.dayStart)===day(Date.now());
 const rows=()=>ready()?snapshot.rows:[];
 const notify=()=>{window.dispatchEvent(new Event('vb-performance-change'));};
 const duration=n=>Number.isFinite(n)&&n>=0?[Math.floor(n/3600000),Math.floor(n/60000)%60,Math.floor(n/1000)%60].map(v=>String(v).padStart(2,'0')).join(':'):'Not reported';
 const metrics=(id,kind)=>rows().find(a=>String(a.agentId)===String(id))?.[kind];
 window.VB_AGENT_PERFORMANCE={
  mode:()=>mode,ready,rows,
  voice(agents){
   if(mode==='session')return agents;
   const merged=new Map(agents.map(a=>[String(a.agentId),a]));
   for(const a of rows())if(a.voice&&!merged.has(String(a.agentId)))merged.set(String(a.agentId),{...a,status:'History only',duration:'—',sessionStartCentral:'—'});
   return [...merged.values()].map(a=>{
    const t=metrics(a.agentId,'voice');
    return {...a,inbound:t?.inbound??null,missed:t?.missed??null,transferred:t?.transferred??null,outbound:t?.outbound??null,avgHandle:duration(t?.avgHandleMs),performanceReason:t?.reason||null};
   });
  },
  chat(presentation){
   const byId=new Map(presentation.rows.map(a=>[String(a.agentId),a]));
   if(mode==='today')for(const a of rows())if(a.chat&&!byId.has(String(a.agentId)))byId.set(String(a.agentId),{agentId:a.agentId,name:a.name,history:true,dataSource:'History only',routingState:'Not reported'});
   for(const a of byId.values()){
    const t=mode==='today'?metrics(a.agentId,'chat'):null;
    a.performanceOffered=mode==='today'?t?.offered??null:a.offeredSession;
    a.performanceMissed=mode==='today'?t?.missed??null:a.missedSession;
    const rona=mode==='today'?t?.rona:a.ronaSession;
    a.performanceMissedDisplay=a.performanceMissed==null?'Not reported':rona>0?`${a.performanceMissed} (RONA ${rona})`:String(a.performanceMissed);
   }
   presentation.rows=[...byId.values()];return presentation;
  }
 };
 function note(){const el=document.getElementById('agent-performance-note');if(el)el.textContent=mode==='session'?'Voice totals and Chat offered/missed show the current login session. Chat handled/completed remain daily.':ready()?`Today (Central): totals across all reported login sessions. Updated ${new Date(snapshot.observedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago'})}. Live status and state duration remain current. Sessions spanning midnight show Not reported where today cannot be isolated.`:'Today (Central): daily totals are loading or temporarily unavailable. Live status remains independent; unavailable totals are not zero.';}
 async function tick(){
  note();
  if(window.VB_SECURITY?.allowed!==true){if(snapshot){snapshot=null;notify();}return;}
  if(document.hidden||pending||Date.now()<next)return;
  pending=true;const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),40000);
  try{
   const res=await fetch('https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/agent-performance',{credentials:'omit',cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
   if([401,403].includes(res.status))snapshot=null;
   if(!res.ok){const retry=Number(res.headers.get('Retry-After'));next=Date.now()+Math.max(30000,Number.isFinite(retry)?retry*1000:0);throw Error('daily-performance-unavailable');}
   const data=await res.json();
   if(data.success!==true||data.schemaVersion!==1||data.timezone!=='America/Chicago'||!Array.isArray(data.rows)||!Number.isFinite(data.observedAt)||!Number.isFinite(data.dayStart))throw Error('daily-performance-contract');
   if(window.VB_SECURITY?.allowed===true)snapshot=data;
   next=Date.now()+30000;
  }catch{next=Math.max(next,Date.now()+30000);}
  finally{clearTimeout(timer);pending=false;note();notify();}
 }
 document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('agent-performance-period')?.addEventListener('change',e=>{mode=e.target.value==='session'?'session':'today';note();notify();});
  void tick();setInterval(tick,5000);
 });
 document.addEventListener('visibilitychange',()=>{if(!document.hidden){next=0;void tick();notify();}});
})();
