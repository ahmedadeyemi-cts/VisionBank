// Read-only daily totals rebuilt from Webex historical sessions, never browser state.
export const fields = ['connectedCount','notRespondedCount','ronaCount','transferCount','outdialCount','ringingCount','connectedDuration','holdDuration','wrapupDuration'];
export function sessionQuery(from,to,cursor) {
  return `{agentSession(from:${from} to:${to} ${cursor?`pagination:{cursor:${JSON.stringify(cursor)}}`:''}) {
    agentSessions {agentId agentName userLoginId agentSessionId startTime endTime isActive teamName
      channelInfo {channelId channelType agentPhoneNumber ${fields.join(' ')}}}
    pageInfo {hasNextPage endCursor}}}`;
}
const epoch=v=>{const n=Number(v);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):null;};
const number=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
export function aggregateSessions(sessions,dayStart,now) {
  const unique=new Map();
  for(const s of sessions) {
    if(!s.agentId||!s.agentSessionId)throw Error('daily-session-identity-missing');
    const key=s.agentId+':'+s.agentSessionId;
    if(unique.has(key)&&JSON.stringify(unique.get(key))!==JSON.stringify(s))throw Error('daily-session-conflict');
    unique.set(key,s);
  }
  const agents=new Map();
  for(const s of unique.values()) {
    const start=epoch(s.startTime),end=epoch(s.endTime);
    if(!start||start>now)continue;
    if(s.isActive!==true&&(!end||end<=dayStart))continue;
    let a=agents.get(s.agentId);
    if(!a){a={agentId:s.agentId,name:s.agentName||s.userLoginId||s.agentId,team:s.teamName||'-',number:'-',voice:null,chat:null};agents.set(s.agentId,a);}
    const channels=new Set();
    for(const c of s.channelInfo||[]) {
      const type=String(c.channelType).toLowerCase(),kind=type==='telephony'?'voice':type==='chat'?'chat':null;
      if(!kind)continue;
      const key=c.channelId||kind;if(channels.has(key))throw Error('daily-channel-duplicate');channels.add(key);
      if(!a[kind])a[kind]={sessions:0,status:'ready',reason:null,...Object.fromEntries(fields.map(f=>[f,0]))};
      const totals=a[kind];totals.sessions++;
      if(c.agentPhoneNumber)a.number=c.agentPhoneNumber;
      // Lifetime counters cannot safely be assigned to today's date across midnight.
      // Never leak yesterday's work or silently present a partial total as complete.
      if(start<dayStart){totals.status='unavailable';totals.reason='Session spans midnight; daily counters cannot be isolated from session totals.';}
      for(const f of fields){const n=number(c[f]);totals[f]=totals[f]===null||n===null?null:totals[f]+n;}
    }
  }
  for(const a of agents.values())for(const kind of ['voice','chat']) {
    const t=a[kind];if(!t)continue;
    t.inbound=t.connectedCount;t.missed=t.notRespondedCount??t.ronaCount;t.rona=t.ronaCount;
    t.transferred=t.transferCount;t.outbound=t.outdialCount;t.offered=t.ringingCount;
    t.avgHandleMs=t.connectedCount===0?0:t.connectedCount>0&&[t.connectedDuration,t.holdDuration,t.wrapupDuration].every(v=>v!==null)?Math.round((t.connectedDuration+t.holdDuration+t.wrapupDuration)/t.connectedCount):null;
    if(t.status!=='ready')for(const f of [...fields,'inbound','missed','rona','transferred','outbound','offered','avgHandleMs'])t[f]=null;
  }
  return [...agents.values()].sort((a,b)=>a.name.localeCompare(b.name));
}
export async function loadDaily(search,dayStart,now) {
  const sessions=[],seen=new Set();let cursor=null;
  // Matches the existing live-agent lookback; closed sessions are included.
  for(let page=0;page<100;page++) {
    const data=await search(sessionQuery(now-30*86400000,now,cursor));
    const root=data?.agentSession;
    if(!Array.isArray(root?.agentSessions)||typeof root.pageInfo?.hasNextPage!=='boolean')throw Error('daily-session-contract');
    sessions.push(...root.agentSessions);
    if(!root.pageInfo.hasNextPage)return {success:true,schemaVersion:1,timezone:'America/Chicago',dayStart,observedAt:now,rows:aggregateSessions(sessions,dayStart,now)};
    const next=root.pageInfo.endCursor;if(typeof next!=='string'||!next||seen.has(next))throw Error('daily-session-pagination');seen.add(next);cursor=next;
  }
  throw Error('daily-session-page-limit');
}
