/* Agent indicator metadata only. Does not change routing, task states or queue counts. */
function vbIndicatorSettings(value={}, fallback={}) {
  const d={enabled:true,animate:true,graceSeconds:60,loginReasonName:'Logged In',loginReasonId:''};
  const result={...d,...fallback};
  if(!value||typeof value!=='object'||Array.isArray(value))value={};
  for(const k of ['enabled','animate'])if(typeof value[k]==='boolean')result[k]=value[k];
  if(Number.isInteger(value.graceSeconds)&&value.graceSeconds>=15&&value.graceSeconds<=900)result.graceSeconds=value.graceSeconds;
  for(const [k,max]of [['loginReasonName',80],['loginReasonId',128]])if(typeof value[k]==='string'&&value[k].trim().length<=max&&(k==='loginReasonId'||value[k].trim()))result[k]=value[k].trim();
  return Object.fromEntries(Object.keys(d).map(k=>[k,result[k]]));
}
function vbIndicatorValidSettings(v) {
  if(v===undefined)return true;
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const keys=['enabled','animate','graceSeconds','loginReasonName','loginReasonId'];
  if(Object.keys(v).some(k=>!keys.includes(k)))return false;
  return Object.entries(v).every(([k,x])=>k==='enabled'||k==='animate'?typeof x==='boolean':k==='graceSeconds'?Number.isInteger(x)&&x>=15&&x<=900:typeof x==='string'&&!/[\x00-\x1f]/.test(x)&&x.trim().length<=(k==='loginReasonId'?128:80)&&(k==='loginReasonId'||x.trim().length>0));
}
function vbIndicatorMetadata(session,row,now) {
  const unknown={revision:4,category:'unknown',label:'Not reported',observedAt:now,idleVerified:false,idleReason:null,stateStartedAt:null};
  if(!session||session.isActive!==true)return unknown;
  const byId=new Map();let conflict=false;
  for(const c of session.channelInfo||[]) {
    if(!['telephony','chat'].includes(vbOpsKey(c.channelType)))continue;
    const id=vbOpsText(c.channelId);if(!id){conflict=true;continue;}
    const before=byId.get(id),at=vbOpsEpoch(c.lastActivityTime)||0;
    if(!before||at>(vbOpsEpoch(before.lastActivityTime)||0))byId.set(id,c);
    else if(at===(vbOpsEpoch(before.lastActivityTime)||0)&&vbOpsKey(before.currentState)!==vbOpsKey(c.currentState))conflict=true;
  }
  const slots=[...byId.values()];if(conflict||!slots.length)return unknown;
  const states=slots.map(c=>vbOpsKey(c.currentState));
  const busy=states.some(s=>vbOpsBucket(s)==='active'||['engagedother','engaged-other'].includes(s));
  if(busy)return {...unknown,category:'engaged',label:'Engaged'};
  if(states.some(s=>vbOpsBucket(s)==='wrapup'))return {...unknown,category:'wrapup',label:'Wrap-up'};
  if(states.some(s=>vbOpsBucket(s)==='offered'))return {...unknown,category:'offered',label:'Offered'};
  const idle=s=>['idle','not-ready','unavailable','logged-in'].includes(s);
  if(states.some(s=>s!=='available'&&!idle(s)))return unknown;
  if(states.includes('available'))return {...unknown,category:'available',label:'Available'};
  if(!states.every(idle))return unknown;
  const evidence=slots.map(c=>{
    const activity=vbOpsCurrentActivity(c,now);
    const current=activity&&idle(vbOpsKey(activity.state));
    const id=current?vbOpsText(activity.idleCode?.id):'';
    const name=current?vbOpsText(activity.idleCode?.name):'';
    return {id,name:name||vbOpsText(c.idleCodeName),at:current?vbOpsEpoch(activity.startTime):null,canonical:Boolean(id&&name)};
  });
  const names=[...new Set(evidence.map(e=>e.name).filter(Boolean))];
  const exact=evidence.every(e=>e.canonical&&e.at)&&new Set(evidence.map(e=>e.id)).size===1&&names.length===1;
  return {...unknown,category:'idle',label:names.length===1?names[0]:names.length?'Idle — multiple reasons':'Idle',
    idleVerified:true,idleReason:exact?{id:evidence[0].id,name:names[0]}:null,
    stateStartedAt:exact?Math.max(...evidence.map(e=>e.at)):null,
    reasonEvidence:exact?'current-activity-id-and-name':'reason-name-only-or-incomplete'};
}
const vbIndicatorRetainedAgents=buildWebexAgentRows;
buildWebexAgentRows=function(sessions,now,dayStart) {
  const rows=vbIndicatorRetainedAgents(sessions,now,dayStart);
  if(rows.vbOpsUnavailable===true)return rows;
  return rows.map(row=>({...row,stateIndicator:vbIndicatorMetadata((sessions||[]).find(s=>s.isActive===true&&s.agentSessionId===row.sessionId),row,now)}));
};
const vbIndicatorRetainedSettings=getWebexDashboardSettings;
getWebexDashboardSettings=async function(env){const s=await vbIndicatorRetainedSettings(env);return {...s,agentStateIndicators:vbIndicatorSettings(s.agentStateIndicators)};};
/* END VISIONBANK AGENT INDICATORS R4 */
