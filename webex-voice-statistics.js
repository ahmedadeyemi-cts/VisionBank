/* Presentation only. Uses existing dashboard refresh; no requests or agent actions. */
(()=>{'use strict';
 const REVISION='2026.09.29-voice-stats-r7';
 const groups=[
  ['Today’s inbound calls',[
   ['received','Calls received','All unique inbound Voice contacts started today, including IVR and flow-routed calls.'],
   ['offered','Offered to agents','Unique contacts explicitly marked isContactOffered by Webex. Multiple offers of one contact count once.'],
   ['waited','Queued — actually waited','Unique contacts with recorded queueDuration greater than 0 milliseconds. Merely entering a queue, IVR time, ringing and talk time do not count. Active waits can lag until recorded.'],
   ['answered','Answered by agents','Unique contacts marked handled or with a positive agent connection count. Includes calls still in progress.'],
   ['abandoned','Abandoned before answer','Ended, unhandled contacts with reported abandonment evidence. Includes pre-queue abandonment; not every unanswered or transferred call is an abandonment.'],
   ['notOffered','Not offered to agents','Unique contacts explicitly not flagged offered. May include IVR/flow-routed traffic and calls still waiting; not a count of missed agent calls.']
  ]],
  ['Answering and wait times',[
   ['answerRateOffered','Answer rate · offered','Answered offered contacts / all offered contacts. Unrelated entry-point and IVR traffic is not the denominator. Open offers can still become answered.'],
   ['queueAbandonRate','Abandon rate · queue entrants','Contacts that entered a queue and abandoned before answer / contacts that entered a queue. Includes active entrants in the denominator; excludes pre-queue abandons.'],
   ['averageQueueWaitAnswered','Average wait · answered','Mean Webex queueDuration for completed answered contacts, including zero waits. Excludes active contacts, IVR and agent ringing; this is not total arrival-to-answer time.'],
   ['longestRecordedQueueWait','Longest wait · completed','Maximum recorded queueDuration among completed queue entrants started today. Excludes prior-day contacts and unfinished waits.'],
   ['averageTalkTime','Average talk · completed','Mean connectedDuration for completed answered contacts. Does not add hold or wrap-up, so it is not Average Handle Time.'],
   ['answeredWithinTarget','Answered within Webex target','Share of completed answered contacts marked isWithInServiceLevel by Webex. Uses the reported flag, not an invented threshold. This answered-only measure is not contractual Service Level and excludes abandoned callers.']
  ]],
  ['Voice workload now · displayed queues',[
   ['nowWaiting','Waiting now','Only contacts currently waiting in the displayed Voice queues. Calls already offered, connected or in wrap-up are separate.'],
   ['nowOffered','Offered now','Contacts currently offered and awaiting acceptance in displayed Voice queues. Not a count of offers today.'],
   ['nowActive','Active calls now','Current active Voice contacts in displayed queues. Chat activity is excluded.'],
   ['nowWrapup','Voice wrap-up now','Current Voice contacts in wrap-up in displayed queues. Separate from waiting and active calls.']
  ]]
 ];
 let root=null,cells=new Map(),meta=null,notice=null,context=null,oldGrid=null;
 const date=v=>new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',timeZoneName:'short'}).format(v);
 const day=v=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
 const text=(el,v)=>{if(el&&el.textContent!==v)el.textContent=v;};
 function mount(){
  if(root?.isConnected)return true;
  const panel=document.getElementById('global-error')?.closest('.panel');if(!panel)return false;
  oldGrid=panel.querySelector('.stat-grid');if(!oldGrid)return false;
  root=document.createElement('div');root.id='vbVoiceStatistics';root.className='vb-voice-stats';
  meta=document.createElement('p');meta.className='vb-voice-meta';meta.setAttribute('role','status');root.append(meta);
  notice=document.createElement('p');notice.className='vb-voice-notice';notice.hidden=true;root.append(notice);
  cells=new Map();
  for(const[title,items]of groups){const section=document.createElement('section'),h=document.createElement('h3'),grid=document.createElement('div');h.textContent=title;grid.className='vb-voice-grid';section.append(h,grid);root.append(section);
   for(const[key,label,definition]of items){const card=document.createElement('div'),value=document.createElement('div'),name=document.createElement('div'),sample=document.createElement('div');card.className='stat-card';card.dataset.voiceMetric=key;card.title=definition;value.className='stat-value';value.textContent='—';name.className='stat-label';name.textContent=label;sample.className='vb-voice-sample';card.append(value,name,sample);grid.append(card);cells.set(key,{card,value,sample});}}
  const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Metric definitions and reporting scope';details.append(summary);
  const scope=document.createElement('p');scope.textContent='Daily cards count unique inbound Voice contacts STARTED today in America/Chicago. Categories overlap and must not be added together. Live cards cover displayed Voice queues and can include older contacts. An equal Queued and Answered count is possible; they are calculated independently. A dash means no eligible sample or unavailable evidence, never a substituted zero.';details.append(scope);
  for(const[,items]of groups)for(const[,label,definition]of items){const p=document.createElement('p'),strong=document.createElement('strong');strong.textContent=label+': ';p.append(strong,document.createTextNode(definition));details.append(p);}root.append(details);
  const ctitle=document.createElement('h3');ctitle.textContent='Entry-point traffic · today';context=document.createElement('div');context.className='vb-voice-context';root.append(ctitle,context);
  const callbackNote=document.createElement('p');callbackNote.className='vb-voice-meta';callbackNote.textContent='Use Callback Workspace for dashboard-created callback plans, schedule confirmations, and outcomes. Webex Callback Call History also includes callbacks created elsewhere. Future schedules are not calls currently waiting.';root.append(callbackNote);
  oldGrid.hidden=true;oldGrid.dataset.vbReplacedVoiceStats='true';oldGrid.insertAdjacentElement('afterend',root);return true;
 }
 function format(m){if(m?.status!=='ready'||typeof m.value!=='number'||!Number.isFinite(m.value)||m.value<0)return '—';
  if(m.unit==='percent')return m.value<=100?m.value.toFixed(2)+'%':'—';
  if(m.unit==='ms'){if(m.value>0&&m.value<1000)return '< 1 sec';const s=Math.floor(m.value/1000);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(v=>String(v).padStart(2,'0')).join(':');}
  return Number.isSafeInteger(m.value)?m.value.toLocaleString('en-US'):'—';}
 function render(performance,dashboard){
  try{if(!mount())return;
   const allowed=window.VB_SECURITY?.allowed===true,at=performance?.observedAt;
   const current=allowed&&dashboard?.success===true&&performance?.revision===REVISION&&Number.isFinite(at)&&Date.now()-at>=-5000&&Date.now()-at<45000&&day(at)===day(Date.now());
   root.dataset.status=current?'ready':'unavailable';
   text(meta,current?'Today · America/Chicago · Updated '+date(at)+' · Inbound Voice only. Live cards have a separate queue scope.':!allowed?'Reporting access is not approved.':performance?.revision!==REVISION?'Updated Voice metrics are not available from the reporting service yet.':'Voice statistics are stale or unavailable. Refreshes automatically; no zero totals are substituted.');
   for(const[key,{card,value,sample}]of cells){const m=current?performance.metrics?.[key]:null,v=format(m);text(value,v);card.dataset.status=m?.status||'unavailable';text(sample,!current?'Not reported':m?.status==='unavailable'?'Incomplete source':m?.status==='no-sample'?'No eligible sample':m?.unit==='ms'||m?.unit==='percent'?String(m.sampleCount??0)+' contacts':'');}
   const warnings=current&&Array.isArray(performance.warnings)?performance.warnings.filter(v=>typeof v==='string'):[];notice.hidden=!warnings.length;text(notice,warnings.join(' '));
   context.replaceChildren();if(current&&Array.isArray(dashboard.statistics?.entryPoints)){for(const ep of dashboard.statistics.entryPoints){if(!Number.isSafeInteger(ep.calls)||ep.calls<0)continue;const el=document.createElement('div'),name=document.createElement('span'),value=document.createElement('strong');name.textContent=String(ep.name||'Not reported');value.textContent=String(ep.calls);el.append(name,value);context.append(el);}}else context.textContent='Not reported';
  }catch{if(root){root.dataset.status='unavailable';for(const {value,sample}of cells.values()){text(value,'—');text(sample,'Not reported');}text(meta,'Voice metric display unavailable. Other reports remain independent.');}}
 }
 window.VB_VOICE_STATS=Object.freeze({revision:REVISION,render,mount});
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>render(null,null),{once:true});else render(null,null);
})();
