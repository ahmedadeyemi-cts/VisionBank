/* Append-only Voice reporting metrics. No new queries, credentials, routes, or timers.
 * Definition references: WebexSamples CSR data dictionary (queueDuration,
 * queueCount, isContactOffered, isContactHandled, connectedDuration, service flag).
 * Counts are UNIQUE inbound contacts STARTED in the America/Chicago business day.
 */
const VB_VOICE_STATS_R7='2026.09.29-voice-stats-r7';
function vbVoiceStatisticsR7(tasks,queues,from,now){
  const num=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
  const integer=v=>Number.isSafeInteger(v)&&v>=0?v:null;
  const metric=(value,unit='count',sampleCount=null,missingCount=0,reason='')=>({
    status:missingCount?'unavailable':value===null?'no-sample':'ready',
    value:missingCount?null:value,unit,sampleCount,missingCount,reason});
  const unavailable=reason=>metric(null,'count',null,1,reason);
  const metrics={};let invalid=0,duplicates=0;const unique=new Map();
  const valid=Array.isArray(tasks)&&tasks.vbOpsUnavailable!==true;
  for(const t of valid?tasks:[]){
    if(!t||typeof t.channelType!=='string'||typeof t.direction!=='string'){invalid++;continue;}
    if(t.channelType.toLowerCase()!=='telephony'||t.direction.toLowerCase()!=='inbound')continue;
    if(typeof t.id!=='string'||!t.id.trim()||num(t.createdTime)===null){invalid++;continue;}
    if(t.createdTime<from||t.createdTime>now)continue;
    const previous=unique.get(t.id);
    if(previous){duplicates++;if(JSON.stringify(previous)!==JSON.stringify(t)){
      const a=num(previous.lastActivityTime),b=num(t.lastActivityTime);
      if(a===null||b===null||a===b){invalid++;continue;}
      if(b<a)continue;
    }}
    unique.set(t.id,t);
  }
  const sourceOK=valid&&invalid===0,rows=[...unique.values()];
  const handled=t=>t.isContactHandled===true||num(t.connectedCount)>0?true:
    t.isContactHandled===false||t.connectedCount===0?false:null;
  const offered=t=>typeof t.isContactOffered==='boolean'?t.isContactOffered:null;
  const waited=t=>num(t.queueDuration)===null?null:t.queueDuration>0;
  const entered=t=>integer(t.queueCount)!==null?t.queueCount>0:num(t.queueDuration)>0?true:null;
  const ended=t=>typeof t.isActive==='boolean'?!t.isActive:null;
  const abandoned=t=>{
    if(t.isActive===true||handled(t)===true)return false;
    if(t.isActive!==false)return null;
    const v=t.abandonedType;
    if(typeof v==='string'&&v.trim()&&!['none','null','false','not_applicable','not applicable'].includes(v.trim().toLowerCase()))return true;
    if(num(t.abandonedSlCount)>0)return true;
    return (v===null||v===''||typeof v==='string')&&t.abandonedSlCount===0?false:null;
  };
  function count(name,predicate,subset=rows){
    const values=subset.map(predicate),missing=values.filter(v=>typeof v!=='boolean').length;
    return metrics[name]=sourceOK?metric(values.filter(v=>v===true).length,'count',subset.length,missing,missing?'Some contacts lack required source fields.':''):unavailable('Inbound contact data incomplete.');
  }
  metrics.received=sourceOK?metric(rows.length,'count',rows.length):unavailable('Inbound contact data incomplete.');
  count('offered',offered);count('waited',waited);count('answered',handled);count('abandoned',abandoned);
  count('enteredQueue',entered);count('notOffered',t=>offered(t)===null?null:!offered(t));
  // Ratios use explicitly named cohorts. Do not divide agent answers by all IVR/entry-point traffic.
  function ratio(name,eligible,event){
    const flags=rows.map(eligible),cohort=rows.filter((_,i)=>flags[i]===true),values=cohort.map(event);
    const missing=flags.filter(v=>v===null).length+values.filter(v=>v===null).length;
    metrics[name]=sourceOK?metric(cohort.length?values.filter(v=>v===true).length/cohort.length*100:null,'percent',cohort.length,missing,cohort.length?'':'No eligible contacts.'):unavailable('Inbound contact data incomplete.');
  }
  ratio('answerRateOffered',offered,handled);
  ratio('queueAbandonRate',entered,abandoned);
  // This is deliberately NOT called contractual Service Level: no tenant SLA denominator is assumed.
  const completedAnswered=t=>ended(t)===false||handled(t)===false?false:ended(t)===true&&handled(t)===true?true:null;
  ratio('answeredWithinTarget',completedAnswered,t=>typeof t.isWithInServiceLevel==='boolean'?t.isWithInServiceLevel:null);
  function measure(name,eligible,field,operation){
    const flags=rows.map(eligible),cohort=rows.filter((_,i)=>flags[i]===true),values=cohort.map(t=>num(t[field]));
    const missing=flags.filter(v=>v===null).length+values.filter(v=>v===null).length;
    metrics[name]=sourceOK?metric(values.length&&!missing?operation(values):null,'ms',values.length,missing,values.length?'':'No completed sample.'):unavailable('Inbound contact data incomplete.');
  }
  const avg=a=>a.reduce((x,y)=>x+y,0)/a.length;
  measure('averageQueueWaitAnswered',completedAnswered,'queueDuration',avg);
  measure('averageTalkTime',completedAnswered,'connectedDuration',avg);
  measure('longestRecordedQueueWait',t=>ended(t)===false||entered(t)===false?false:ended(t)===true&&entered(t)===true?true:null,'queueDuration',a=>Math.max(...a));
  // The live section has its OWN scope: only displayed Voice queues. Never mix Chat counts or 24h legs into today's totals.
  const qs=Array.isArray(queues)?queues.filter(q=>String(q.channelType||'').toLowerCase()==='telephony'):[];
  const queueOK=Array.isArray(queues)&&queues.every(q=>q&&typeof q.channelType==='string')&&qs.every(q=>q.operationsRevision===3&&q.countStatus==='ready');
  for(const key of ['waiting','offered','active','wrapup']){
    const values=qs.map(q=>integer(q[key])),missing=values.filter(v=>v===null).length;
    metrics['now'+key[0].toUpperCase()+key.slice(1)]=queueOK?metric(values.reduce((a,b)=>a+(b||0),0),'count',qs.length,missing):unavailable('Live Voice queue data incomplete.');
  }
  // Diagnostics expose counts only, never customer/agent identifiers or contact content.
  const unofferedAnswers=rows.filter(t=>offered(t)===false&&handled(t)===true).length;
  const warnings=[];
  if(unofferedAnswers)warnings.push('Some answered contacts are not flagged offered; the offered answer rate uses the offered cohort only.');
  if(!sourceOK)warnings.push('Inbound source data is incomplete; daily values are unavailable, not zero.');
  if(Object.values(metrics).some(m=>m.status==='unavailable'))warnings.push('Some measures lack complete source evidence.');
  return {revision:VB_VOICE_STATS_R7,timezone:'America/Chicago',from,observedAt:now,
    scope:'Unique inbound Voice contacts started today; active contacts may have incomplete historical durations.',
    liveScope:'Displayed Voice queues; live counts may include contacts started before today.',
    metrics,warnings,diagnostics:{uniqueInbound:rows.length,duplicateRows:duplicates,invalidRows:invalid,unofferedAnswers,
      visibleVoiceQueues:qs.length,noExtraQueries:true,waitThresholdMs:0,serviceLevelFormulaInferred:false}};
}
const vbVoiceStatsR7Retained=buildWebexStatistics;
buildWebexStatistics=function(tasks,taskLegs,queues,now){
  const retained=vbVoiceStatsR7Retained(tasks,taskLegs,queues,now);
  const voicePerformance=vbVoiceStatisticsR7(tasks,queues,getCentralDayStartEpochMs(now),now);
  // Existing endpoints/fields are retained for clients that have not refreshed yet.
  return {...retained,voicePerformance};
};
