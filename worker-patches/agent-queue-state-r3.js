/* VisionBank operations correction r3. Read-only mapping; no auth or trigger changes. */
function vbOpsText(v) { return typeof v === 'string' ? v.trim() : ''; }
function vbOpsEpoch(v) { const n=Number(v); return Number.isFinite(n)&&n>0?n:null; }
function vbOpsKey(v) { return vbOpsText(v).toLowerCase().replace(/[ _]/g,'-'); }
function vbOpsBucket(v) {
  const s=vbOpsKey(v);
  if (['parked','queued','queue','in-queue','waiting'].includes(s)) return 'waiting';
  if (['ringing','reserved','offered','presented'].includes(s)) return 'offered';
  if (['connected','engaged','hold','held','on-hold','consulting','conferencing'].includes(s)) return 'active';
  if (['wrapup','wrap-up','wrapup-assist'].includes(s)) return 'wrapup';
  if (['ended','disconnected','wrapup-completed','wrapup-done','wrap-up-completed','completed','transferred-to-dn','transferred-to-ep'].includes(s)) return 'ended';
  if (['created','new','treatment','ivr-connected','ivr','routing','available','idle','logged-in'].includes(s)) return 'other';
  return 'unknown';
}
function vbOpsCurrentActivity(c, now) {
  const nodes=Array.isArray(c?.activities?.nodes)?c.activities.nodes:[];
  const current=nodes.filter(a=>a?.isCurrentActivity===true&&vbOpsEpoch(a.startTime)&&
    Number(a.startTime)<=now+5000&&!vbOpsEpoch(a.endTime));
  current.sort((a,b)=>Number(b.startTime)-Number(a.startTime));
  if (!current.length) return null;
  if (current[1]&&Number(current[1].startTime)===Number(current[0].startTime)&&
      (current[1].taskId!==current[0].taskId||current[1].state!==current[0].state)) return null;
  return current[0];
}
function vbOpsChannelSummary(session,type,now) {
  const source=(session?.channelInfo||[]).filter(c=>vbOpsKey(c.channelType)===type);
  const byId=new Map(); let bad=false;
  for (const c of source) {
    const id=vbOpsText(c.channelId); if(!id){bad=true;continue;}
    const old=byId.get(id), at=vbOpsEpoch(c.lastActivityTime)||0, before=vbOpsEpoch(old?.lastActivityTime)||0;
    if(!old||at>before)byId.set(id,c);
    else if(at===before&&vbOpsKey(old.currentState)!==vbOpsKey(c.currentState))bad=true;
  }
  const slots=[...byId.values()];
  const known=slots.length>0&&!bad&&slots.every(c=>vbOpsText(c.currentState));
  const states=slots.map(c=>vbOpsKey(c.currentState));
  const count=b=>states.filter(s=>vbOpsBucket(s)===b).length;
  const active=count('active'),wrapup=count('wrapup'),offered=count('offered');
  const available=states.filter(s=>s==='available').length;
  const idle=slots.map(c=>vbOpsText(c.idleCodeName)).filter(Boolean);
  const unrecognized=states.some(s=>vbOpsBucket(s)==='unknown'&&!['unavailable','not-ready','engagedother','engaged-other'].includes(s));
  let state=null;
  if(!known||unrecognized)state=null; else if(active>0)state='engaged';
  else if(wrapup>0)state='wrapup'; else if(offered>0)state='reserved';
  else if(available>0)state='available';
  else if(states.every(s=>s===states[0]))state=states[0]; else state='idle';
  const interactions=[]; let unmappedWork=0;
  for(const c of slots) {
    const bucket=vbOpsBucket(c.currentState); if(!['active','wrapup','offered'].includes(bucket))continue;
    const a=vbOpsCurrentActivity(c,now);
    if(!a||vbOpsBucket(a.state)!==bucket||!vbOpsText(a.taskId)){unmappedWork++;continue;}
    interactions.push({taskId:vbOpsText(a.taskId),queueId:vbOpsText(a.queue?.id),
      channel:type,bucket,at:vbOpsEpoch(a.startTime),agentId:vbOpsText(session.agentId)});
  }
  return {routingState:state,reportedSlotCount:known?slots.length:null,capacity:known?slots.length:null,
    capacitySource:'reported-channel-slots',availableSlots:known?available:null,activeSlots:known?active:null,
    wrapupSlots:known?wrapup:null,offeredSlots:known?offered:null,source:'agentSession.channelInfo',
    reason:known?'':bad?'invalid-or-conflicting-channel-slots':'channel-not-returned',
    idleReason:state==='idle'&&new Set(idle).size===1?idle[0]:null,
    observedAt:now,interactions,unmappedWork};
}
function vbOpsAgentStatus(voice,chat,now) {
  const channels=[voice,chat].filter(c=>c.reportedSlotCount!==null);
  const states=channels.map(c=>c.routingState);
  let state=states.includes('engaged')?'Engaged':states.includes('wrapup')?'Wrap-up':
    states.includes('reserved')?'Reserved':states.includes('available')?'Available':
    states.length&&states.every(Boolean)?'Idle':'Not reported';
  if(state==='Idle') {
    const reasons=channels.map(c=>c.idleReason||c.routingState);
    if(new Set(reasons).size===1&&reasons[0])state=reasons[0];
  }
  return {state,tone:state==='Engaged'?'engaged':state==='Wrap-up'||state==='Reserved'?'wrapup':
    state==='Available'?'available':state==='Not reported'?'unknown':'idle',
    observedAt:now,source:'current reported Voice and Chat slots',
    description:'Overall activity summary; channel-specific routing rules still apply.'};
}
function vbOpsCurrentQueueRows(queues,legs,tasks,agents,now) {
  const inputsKnown=[legs,tasks,agents].every(x=>Array.isArray(x)&&x.vbOpsUnavailable!==true);
  const candidates=new Map();
  const add=r=>{
    if(!r.id||!r.at||r.at>now+5000)return;
    if(!candidates.has(r.id))candidates.set(r.id,[]);candidates.get(r.id).push(r);
  };
  for(const t of tasks||[]) {
    const at=vbOpsEpoch(t.lastActivityTime)||vbOpsEpoch(t.endedTime)||vbOpsEpoch(t.createdTime);
    add({id:vbOpsText(t.id),channel:vbOpsKey(t.channelType),qid:vbOpsText(t.lastQueue?.id),
      bucket:t.isActive===false?'ended':t.isActive===true?vbOpsBucket(t.status):'unknown',at,rank:2,task:t});
  }
  for(const l of legs||[]) {
    const at=vbOpsEpoch(l.lastActivityTime)||vbOpsEpoch(l.endedTime)||vbOpsEpoch(l.createdTime);
    add({id:vbOpsText(l.taskId),channel:vbOpsKey(l.channelType),qid:vbOpsText(l.queue?.id),
      bucket:l.isActive===false?'ended':l.isActive===true?vbOpsBucket(l.contactState||l.status):'unknown',at,rank:1,
      wrapDone:['wrapup-completed','wrapup-done','wrap-up-completed'].includes(vbOpsKey(l.contactState))});
  }
  for(const a of agents||[])for(const x of a.currentInteractions||[]) {
    add({id:x.taskId,channel:x.channel,qid:x.queueId,bucket:x.bucket,at:x.at,rank:3});
  }
  const perQueue=new Map(), unassigned=new Set();
  const get=id=>{if(!perQueue.has(id))perQueue.set(id,{waiting:0,offered:0,active:0,wrapup:0,unknown:0,waits:[]});return perQueue.get(id);};
  const taskById=new Map((tasks||[]).map(t=>[vbOpsText(t.id),t]));
  for(const rows of candidates.values()) {
    rows.sort((a,b)=>b.at-a.at||b.rank-a.rank);
    let r=rows[0];
    const wrap=rows.find(x=>x.rank===3&&x.bucket==='wrapup');
    if(wrap&&r.bucket==='ended'&&!rows.some(x=>x.wrapDone&&x.at>=wrap.at))r=wrap;
    if(!['telephony','chat'].includes(r.channel))continue;
    if(['ended','other'].includes(r.bucket))continue;
    const tied=rows.filter(x=>x.at===r.at&&x.rank===r.rank);
    const conflict=tied.some(x=>x.bucket!==r.bucket||x.qid!==r.qid);
    if(!r.qid){const task=taskById.get(r.id);const direct=task&&task.queueCount===0&&!task.lastQueue?.id&&!(task.activities?.nodes||[]).some(a=>a.queueId);if(!direct)unassigned.add(r.channel);continue;}
    const q=get(r.qid);
    if(conflict||r.bucket==='unknown'){q.unknown++;continue;}
    q[r.bucket]++;
    if(r.bucket==='waiting') {
      const t=taskById.get(r.id);
      const parked=(t?.activities?.nodes||[]).filter(a=>a.isActive===true&&
        vbOpsText(a.queueId)===r.qid&&vbOpsBucket(a.nextState||a.eventName)==='waiting'&&
        vbOpsEpoch(a.createdTime)&&!vbOpsEpoch(a.endedTime)&&Number(a.createdTime)<=now);
      parked.sort((a,b)=>Number(b.createdTime)-Number(a.createdTime));
      q.waits.push(parked[0]?Math.max(0,now-Number(parked[0].createdTime)):null);
    }
  }
  // Missing assignment pointers must not manufacture a zero queue workload.
  for(const a of agents||[])for(const [channel,c]of [['telephony',a.voiceChannel],['chat',a.chatChannel]]) {
    if(c?.unmappedWork>0) {
      const matching=(tasks||[]).filter(t=>t.isActive===true&&vbOpsKey(t.channelType)===channel&&vbOpsText(t.lastAgent?.id)===vbOpsText(a.agentId));
      const reported=(c.activeSlots||0)+(c.wrapupSlots||0)+(c.offeredSlots||0);
      if(matching.filter(t=>['active','wrapup','offered'].includes(vbOpsBucket(t.status))).length<reported)unassigned.add(channel);
    }
  }
  return queues.map(row=>{
    const channel=vbOpsKey(row.channelType);if(!['telephony','chat'].includes(channel))return row;
    const actual=perQueue.get(vbOpsText(row.id))||{waiting:0,offered:0,active:0,wrapup:0,unknown:0,waits:[]};
    const known=inputsKnown&&!unassigned.has(channel)&&actual.unknown===0;
    const n=k=>known?actual[k]:null;
    const timed=known&&actual.waits.every(Number.isFinite);
    const max=timed?Math.max(0,...actual.waits):null;
    const avg=timed?(actual.waits.length?Math.round(actual.waits.reduce((s,v)=>s+v,0)/actual.waits.length):0):null;
    const format=n=>n===null?'Unavailable':formatWebexDurationMs(n);
    return {...row,operationsRevision:3,countStatus:known?'ready':'unavailable',
      calls:n('waiting'),waiting:n('waiting'),offered:n('offered'),active:n('active'),wrapup:n('wrapup'),
      maxWaitMs:max,avgWaitMs:avg,maxWait:format(max),avgWait:format(avg),observedAt:now,
      countReason:known?'':inputsKnown?'current-state-or-assignment-incomplete':'upstream-input-unavailable',
      waitReason:timed?'':'No verified current queue-entry event.',
      coverage:'Current contact/leg/agent activities within retained dashboard query windows; no historical-active fallback.'};
  });
}
const vbOpsRetainedAgentBuilderR3=buildWebexAgentRows;
buildWebexAgentRows=function(sessions,now,dayStart){
  const result=vbOpsRetainedAgentBuilderR3(sessions,now,dayStart);
  if(sessions?.vbOpsUnavailable===true){result.vbOpsUnavailable=true;return result;}
  return result.map(row=>{
    const s=(sessions||[]).find(s=>s.isActive===true&&s.agentSessionId===row.sessionId);
    const voice=vbOpsChannelSummary(s,'telephony',now),chat=vbOpsChannelSummary(s,'chat',now);
    return {...row,voiceChannel:voice,chatChannel:chat,agentStatus:vbOpsAgentStatus(voice,chat,now),
      currentInteractions:[...voice.interactions,...chat.interactions],operationsRevision:3};
  });
};
const vbOpsRetainedQueueBuilderR3=buildWebexQueueRows;
buildWebexQueueRows=function(configured,legs,tasks,agents,now,settings){
  const rows=vbOpsRetainedQueueBuilderR3(configured,legs,tasks,agents,now,settings);
  return vbOpsCurrentQueueRows(rows,legs,tasks,agents,now);
};
/* END VISIONBANK OPERATIONS CORRECTION R3 */
