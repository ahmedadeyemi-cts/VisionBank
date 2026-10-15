import {SettingsError,UUID} from './policy.mjs';
import {callbackNumber,centralDate} from './selection.mjs';
const fail=(ok,code,status=400)=>{if(!ok)throw new SettingsError(code,status);};
export function parseFollowup(body){
 fail(body&&typeof body==='object'&&!Array.isArray(body),'invalid-followup');
 fail(Object.keys(body).every(k=>['mutationId','action','contactIds','agentName','note'].includes(k)),'unknown-followup-field');
 fail(UUID.test(body.mutationId||'')&&['done','reopen'].includes(body.action),'invalid-followup-action');
 fail(Array.isArray(body.contactIds)&&body.contactIds.length>0&&body.contactIds.length<=100&&body.contactIds.every(id=>typeof id==='string'&&UUID.test(id)),'select-1-to-100-calls');
 const ids=body.contactIds.map(id=>id.toLowerCase()).sort();fail(new Set(ids).size===ids.length,'duplicate-selected-id');
 const text=(v,max)=>typeof v==='string'&&v.trim().length<=max&&!/[\x00-\x1f\x7f]/.test(v);
 fail(text(body.agentName,120)&&body.agentName.trim().length>=2&&text(body.note,500),'enter-name-and-valid-note');
 return {...body,contactIds:ids,agentName:body.agentName.trim(),note:body.note.trim()};
}
export class FollowupStore{
 constructor(storage){this.storage=storage;}
 async fetch(request){
  const u=new URL(request.url);
  if(request.method==='GET'){
   const ids=(u.searchParams.get('ids')||'').split(',').filter(Boolean);fail(ids.length<=100&&ids.every(id=>UUID.test(id)),'invalid-followup-ids');
   const rows=await Promise.all(ids.map(id=>this.storage.get('followup:'+id.toLowerCase())));return Response.json({success:true,rows:rows.filter(Boolean)});
  }
  fail(request.method==='POST','method-not-allowed',405);
  const {change,actor,source}=await request.json(),parsed=parseFollowup(change);
  fail(actor?.source==='cloudflare-edge'&&typeof actor.sourceIp==='string'&&actor.identityVerified===false,'invalid-followup-source');
  fail(source?.date===centralDate(Date.now())&&Number.isFinite(source.observedAt)&&Date.now()-source.observedAt<180000&&source.observedAt<=Date.now()+5000,'followup-source-stale',409);
  const signature=JSON.stringify(parsed);
  return this.storage.transaction(async tx=>{
   const old=await tx.get('followup-mutation:'+parsed.mutationId);
   if(old){fail(old.signature===signature,'mutation-id-reused',409);return Response.json({...old.result,replayed:true});}
   const at=Date.now(),rows=[];
   for(const contactId of parsed.contactIds){
    const prior=await tx.get('followup:'+contactId);
    const row={contactId,done:parsed.action==='done',agentName:parsed.agentName,note:parsed.note,at,revision:(prior?.revision||0)+1,identityVerified:false};
    await tx.put('followup:'+contactId,row);
    await tx.put('followup-audit:'+contactId+':'+String(row.revision).padStart(8,'0'),{...row,actor,source,action:parsed.action,mutationId:parsed.mutationId});rows.push(row);
   }
   const result={success:true,rows};await tx.put('followup-mutation:'+parsed.mutationId,{signature,result});return Response.json(result);
  });
 }
}
// Caller/called numbers must match in full; no suffix or extension guessing.
export function outboundFollowups(abandoned,tasks,cars,now){
 const activities=new Map((cars||[]).map(t=>[t.id,t.activities]));
 const outbound=(tasks||[]).filter(t=>String(t.channelType).toLowerCase()==='telephony'&&['outbound','outdial'].includes(String(t.direction).toLowerCase())&&UUID.test(t.id||'')&&Number.isFinite(t.createdTime)&&t.createdTime<=now);
 const bySource=new Map();
 for(const t of outbound){
  const number=callbackNumber(t.destination);if(!number)continue;
  const matches=abandoned.filter(r=>callbackNumber(r.ani)===number&&Number.isFinite(r.endEpoch)&&r.endEpoch>0&&r.endEpoch<t.createdTime&&centralDate(r.startEpoch)===centralDate(t.createdTime)).sort((a,b)=>b.endEpoch-a.endEpoch);
  const source=matches[0];if(!source)continue;
  // One outbound interaction belongs to the latest preceding missed call, not every older call from the number.
  if(matches[1]?.endEpoch===source.endEpoch)continue;
  const events=activities.get(t.id),agents=(events?.nodes||[]).filter(a=>a.agentId&&a.agentName&&Number.isFinite(a.createdTime)&&a.createdTime>=t.createdTime&&a.createdTime<=now).sort((a,b)=>a.createdTime-b.createdTime);
  const first=events?.pageInfo?.hasNextPage===false?agents[0]:null;
  const agentName=first?.agentName||(t.transferCount===0?t.lastAgent?.name:null)||null;
  const old=bySource.get(source.contactId);
  const row={contactId:t.id,at:t.createdTime,agentName,agentEvidence:first?'first-reported-agent':agentName?'reported-agent-no-transfer':'unavailable',status:String(t.status||'Not reported').slice(0,80),isActive:t.isActive===true,connectionReported:t.connectedDuration>0,match:'same-number-later-outbound'};
  if(!old||row.at>old.at)bySource.set(source.contactId,row);
 }
 return abandoned.map(r=>({...r,outboundFollowup:bySource.get(r.contactId)||null}));
}
export async function readFollowups(store,ids){
 const rows=[];
 for(let i=0;i<ids.length;i+=100){const response=await store.fetch(new Request('https://callback-settings.internal/followups?ids='+encodeURIComponent(ids.slice(i,i+100).join(','))));const data=await response.json();if(!response.ok||data.success!==true)throw new SettingsError('followup-storage-unavailable',503);rows.push(...data.rows);}
 return rows;
}
export async function decorateFollowups(report,store){
 const rows=await readFollowups(store,report.abandonedCalls.map(r=>r.contactId));const byId=new Map(rows.map(r=>[r.contactId,r]));
 return {...report,followupStatus:'ready',abandonedCalls:report.abandonedCalls.map(r=>({...r,manualFollowup:byId.get(String(r.contactId).toLowerCase())||null}))};
}
