import {DeviceManagementError,validateTemporaryDuration} from './contracts.mjs';
import {createLease,putLease,getLease,listLeases,decideExpiry,isPilotDevice} from './lease.mjs';
import {buildAuditRecord,writeAuditRecord,automatedActor} from './audit.mjs';
import {createPhonismReader} from './phonism.mjs';

const PREVIEW_PREFIX='device-preview:';
const PREVIEW_TTL=10*60;
const WEBEX='https://webexapis.com/v1';

const clean=(value,max=200)=>String(value??'').trim().slice(0,max);
const numberOr=(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback;

function writableMember(raw,portOverride=null){
  if(!raw?.id)throw new DeviceManagementError('invalid-webex-member');
  const member={
    port:Number.isSafeInteger(portOverride)?portOverride:numberOr(raw.port,1),
    id:String(raw.id),
    primaryOwner:Boolean(raw.primaryOwner),
    lineType:String(raw.lineType||'SHARED_CALL_APPEARANCE'),
    lineWeight:numberOr(raw.lineWeight,1),
    hotlineEnabled:Boolean(raw.hotlineEnabled),
    allowCallDeclineEnabled:raw.allowCallDeclineEnabled!==false,
    t38FaxCompressionEnabled:Boolean(raw.t38FaxCompressionEnabled)
  };
  if(raw.hotlineDestination)member.hotlineDestination=String(raw.hotlineDestination);
  if(raw.lineLabel)member.lineLabel=clean(raw.lineLabel,80);
  return member;
}

export function line2SummaryFromMembers(members=[]){
  const row=members.find(m=>Number(m?.port)===2);
  return row?{memberId:String(row.id),name:clean(row.displayName||[row.firstName,row.lastName].filter(Boolean).join(' ')||row.lineLabel||'',160),extension:clean(row.extension||'',32),phoneNumber:clean(row.phoneNumber||'',64),type:clean(row.memberType||'',40)}:null;
}

export function composeMembers(currentMembers=[],target=null){
  const keep=currentMembers.filter(m=>Number(m?.port)!==2).map(m=>writableMember(m));
  if(target){
    keep.push({
      port:2,id:String(target.id),primaryOwner:false,
      lineType:'SHARED_CALL_APPEARANCE',
      lineWeight:numberOr(target.lineWeight,1),
      hotlineEnabled:false,
      allowCallDeclineEnabled:target.allowCallDeclineEnabled!==false,
      t38FaxCompressionEnabled:Boolean(target.t38FaxCompressionEnabled),
      lineLabel:clean(target.displayName||target.name||target.extension||'Temporary line',80)
    });
  }
  return keep.sort((a,b)=>a.port-b.port);
}

export async function membersFingerprint(members=[]){
  const normalized=members.map(m=>({
    port:Number(m?.port)||0,id:String(m?.id||''),primaryOwner:Boolean(m?.primaryOwner),
    lineType:String(m?.lineType||''),lineWeight:Number(m?.lineWeight)||0,
    hotlineEnabled:Boolean(m?.hotlineEnabled),hotlineDestination:String(m?.hotlineDestination||''),
    allowCallDeclineEnabled:m?.allowCallDeclineEnabled!==false,
    t38FaxCompressionEnabled:Boolean(m?.t38FaxCompressionEnabled),lineLabel:String(m?.lineLabel||'')
  })).sort((a,b)=>a.port-b.port||a.id.localeCompare(b.id));
  const bytes=new TextEncoder().encode(JSON.stringify(normalized));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
}

async function readJsonMaybe(response){
  try{return await response.clone().json();}catch{return {};}
}

export async function readWebexMembers(webexFetch,env,orgId,deviceId){
  const response=await webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(deviceId)+'/members?orgId='+encodeURIComponent(orgId),{method:'GET'});
  const data=await readJsonMaybe(response);
  if(!response.ok||!Array.isArray(data?.members))throw new DeviceManagementError('webex-members-read-failed',response.status===401||response.status===403?503:502);
  return data;
}

export async function writeWebexMembers(webexFetch,env,orgId,deviceId,members){
  const response=await webexFetch(env,WEBEX+'/telephony/config/devices/'+encodeURIComponent(deviceId)+'/members?orgId='+encodeURIComponent(orgId),{
    method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({members})
  });
  if(response.status!==204){
    const error=new DeviceManagementError('webex-members-write-failed',response.status===401||response.status===403?503:502);
    error.upstreamStatus=response.status;throw error;
  }
  return true;
}

async function putPreview(env,preview){
  if(!env?.SESSIONS?.put)throw new DeviceManagementError('preview-store-unavailable',503);
  await env.SESSIONS.put(PREVIEW_PREFIX+preview.mutationId,JSON.stringify(preview),{expirationTtl:PREVIEW_TTL});
}

async function getPreview(env,mutationId){
  if(!env?.SESSIONS?.get)return null;
  const raw=await env.SESSIONS.get(PREVIEW_PREFIX+String(mutationId||''));
  if(!raw)return null;
  try{return typeof raw==='string'?JSON.parse(raw):raw;}catch{return null;}
}

export async function createWritePreview({env,session,device,location,currentMembers,targetMember,durationMinutes,reason,phonismContext}){
  if(!isPilotDevice(env,device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  const minutes=validateTemporaryDuration(durationMinutes);
  const mutationId=crypto.randomUUID(),currentHash=await membersFingerprint(currentMembers);
  const preview={
    mutationId,sessionId:session.id,createdAt:new Date().toISOString(),
    device:{id:device.id,displayName:device.displayName||device.name||'',mac:device.mac||''},
    location:{id:location.id,name:location.name||''},
    currentHash,baselineLine2:line2SummaryFromMembers(currentMembers),
    baselineMember:(()=>{const row=currentMembers.find(m=>Number(m?.port)===2);return row?writableMember(row):null;})(),
    targetMember:targetMember?{
      id:targetMember.id,name:targetMember.name||targetMember.displayName||'',displayName:targetMember.name||targetMember.displayName||'',
      extension:targetMember.extension||'',phoneNumber:targetMember.phoneNumber||'',type:targetMember.type||targetMember.memberType||'',
      lineWeight:targetMember.lineWeight,allowCallDeclineEnabled:targetMember.allowCallDeclineEnabled,
      t38FaxCompressionEnabled:targetMember.t38FaxCompressionEnabled
    }:null,
    durationMinutes:minutes,reason:clean(reason,500),
    phonismContext
  };
  await putPreview(env,preview);
  return preview;
}

function restoreMembers(currentMembers,baselineMember){
  const keep=currentMembers.filter(m=>Number(m?.port)!==2).map(m=>writableMember(m));
  if(baselineMember)keep.push({...baselineMember,port:2});
  return keep.sort((a,b)=>a.port-b.port);
}

function targetSummary(target){
  return target?{memberId:String(target.id),name:clean(target.name||target.displayName||'',160),extension:clean(target.extension||'',32),phoneNumber:clean(target.phoneNumber||'',64),type:clean(target.type||target.memberType||'',40)}:null;
}

export async function applyWritePreview({env,request,session,webexFetch,orgId,mutationId,phonismReader=createPhonismReader()}){
  const preview=await getPreview(env,mutationId);
  if(!preview)throw new DeviceManagementError('preview-expired',409);
  if(preview.sessionId!==session.id)throw new DeviceManagementError('preview-operator-mismatch',403);
  if(!isPilotDevice(env,preview.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);

  const current=await readWebexMembers(webexFetch,env,orgId,preview.device.id);
  const freshHash=await membersFingerprint(current.members);
  if(freshHash!==preview.currentHash)throw new DeviceManagementError('device-state-changed-review-again',409);

  const desired=composeMembers(current.members,preview.targetMember);
  let webexSaved=false,phonismQueued=false,rolledBack=false;
  try{
    await writeWebexMembers(webexFetch,env,orgId,preview.device.id,desired);
    webexSaved=true;

    const pc=preview.phonismContext||{};
    await phonismReader.syncIntegration(env,pc.integrationId,{
      companyId:pc.companyId,tenantId:pc.tenantId,
      assetTypes:['People','Workspace','Device']
    });
    phonismQueued=true;
  }catch(error){
    if(webexSaved&&!phonismQueued){
      try{await writeWebexMembers(webexFetch,env,orgId,preview.device.id,current.members.map(m=>writableMember(m)));rolledBack=true;}catch{}
    }
    const audit=buildAuditRecord({
      eventType:'temporary-line-change',action:'save-sync',request,session,
      device:preview.device,location:preview.location,
      change:{beforeLine2:preview.baselineLine2,afterLine2:targetSummary(preview.targetMember),durationMinutes:preview.durationMinutes},
      reason:preview.reason,webexStatus:webexSaved?(rolledBack?'rolled-back':'saved'):'failed',
      phonismStatus:phonismQueued?'sync-queued':'failed',result:rolledBack?'rolled-back':'failed'
    });
    await writeAuditRecord(env,audit);
    throw error;
  }

  const audit=buildAuditRecord({
    eventType:'temporary-line-change',action:'save-sync',request,session,
    device:preview.device,location:preview.location,
    change:{beforeLine2:preview.baselineLine2,afterLine2:targetSummary(preview.targetMember),durationMinutes:preview.durationMinutes},
    reason:preview.reason,webexStatus:'saved',phonismStatus:'sync-queued',result:'pending-verification'
  });
  await writeAuditRecord(env,audit);

  const pc=preview.phonismContext||{};
  const lease=createLease({
    device:preview.device,location:preview.location,baselineLine2:preview.baselineLine2,
    temporaryLine2:targetSummary(preview.targetMember),durationMinutes:preview.durationMinutes,
    operator:session.operator,auditId:audit.auditId,phonismPhoneId:pc.phoneId,
    phonismTenantId:pc.tenantId,phonismIntegrationId:pc.integrationId
  });
  lease.baselineMember=preview.baselineMember||null;
  lease.phonismCompanyId=pc.companyId||null;
  await putLease(env,lease);
  if(env?.SESSIONS?.delete)await env.SESSIONS.delete(PREVIEW_PREFIX+preview.mutationId);

  return {lease,audit};
}

export async function verifyLease({env,webexFetch,orgId,leaseId,phonismReader=createPhonismReader()}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  const current=await readWebexMembers(webexFetch,env,orgId,lease.device.id);
  const webexLine2=line2SummaryFromMembers(current.members);
  const targetId=String(lease.temporaryLine2?.memberId||'');
  const webexMatches=String(webexLine2?.memberId||'')===targetId;
  let phonismLine2=null;
  if(lease.phonismPhoneId){
    try{
      const lines=await phonismReader.lines(env,lease.phonismPhoneId);
      phonismLine2=lines.find(x=>x.lineNumber===2)||null;
    }catch{}
  }
  const targetName=clean(lease.temporaryLine2?.name||'',160).toLowerCase();
  const removingLine2=!lease.temporaryLine2;
  const phonismPresent=removingLine2?!phonismLine2:(Boolean(phonismLine2)&&(!targetName||String(phonismLine2.alias||'').toLowerCase().includes(targetName)));
  const phonismRegistration=removingLine2?'removed':(phonismLine2?.registrationStatus||'pending');
  const state=webexMatches&&phonismPresent?'applied':'pending-verification';
  lease.verification={webex:webexMatches?'confirmed':'pending',phonism:phonismPresent?phonismRegistration:'pending',state,lastCheckedAt:new Date().toISOString()};
  if(state==='applied')lease.status='active';
  await putLease(env,lease);
  return {lease,webexLine2,phonismLine2,state};
}

export async function runRecoveryAction({env,request,session,leaseId,action,explicitConfirmation=false,phonismReader=createPhonismReader()}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(!isPilotDevice(env,lease.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  if(!['Reboot','FactoryReset'].includes(action))throw new DeviceManagementError('recovery-action-denied');
  if(action==='FactoryReset'){
    if(lease.recovery?.rebootAttempted!==true)throw new DeviceManagementError('reboot-required-before-factory-reset',409);
    if(explicitConfirmation!==true)throw new DeviceManagementError('factory-reset-confirmation-required',409);
  }
  const result=await phonismReader.tr069Action(env,lease.phonismPhoneId,action);
  lease.recovery={...(lease.recovery||{}),
    ...(action==='Reboot'?{rebootAttempted:true,rebootAt:new Date().toISOString()}:{factoryResetAttempted:true,factoryResetAt:new Date().toISOString()})
  };
  lease.verification={...(lease.verification||{}),phonism:action+'-queued',state:'pending-verification',lastCheckedAt:new Date().toISOString()};
  await putLease(env,lease);
  const audit=buildAuditRecord({
    eventType:'device-recovery',action:action==='Reboot'?'reboot-reverify':'factory-reset-recover',
    request,session,device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},reason:'Recovery action requested from Device Manager',
    webexStatus:lease.verification?.webex||'unknown',phonismStatus:action+'-queued',result:'pending-verification',
    originalAuditId:lease.auditId
  });
  await writeAuditRecord(env,audit);
  return {result,audit,lease};
}

export async function sweepExpiredLeases({env,webexFetch,orgId,phonismReader=createPhonismReader(),now=Date.now()}){
  const leases=await listLeases(env,{limit:1000});
  const results=[];
  for(const lease of leases){
    const expires=Date.parse(lease.expiresAt||'');
    if(!Number.isFinite(expires)||expires>now)continue;

    if(lease.status==='restore-sync-pending'){
      try{
        await phonismReader.syncIntegration(env,lease.phonismIntegrationId,{
          companyId:lease.phonismCompanyId,tenantId:lease.phonismTenantId,
          assetTypes:['People','Workspace','Device']
        });
        lease.status='restored';
        lease.restoredAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),phonism:'sync-queued-after-restore',state:'restored',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        const audit=buildAuditRecord({
          eventType:'temporary-line-expiry',action:'auto-restore-sync',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,restoredLine2:lease.baselineLine2},
          reason:'Temporary assignment expired; Phonism sync queued after Webex restore.',
          webexStatus:'restored',phonismStatus:'sync-queued',result:'completed',originalAuditId:lease.auditId,now
        });
        await writeAuditRecord(env,audit);
        results.push({leaseId:lease.leaseId,status:'restored'});
      }catch(error){
        results.push({leaseId:lease.leaseId,status:'restore-sync-pending',error:error.code||'sync-failed'});
      }
      continue;
    }

    if(lease.status!=='active')continue;
    try{
      const current=await readWebexMembers(webexFetch,env,orgId,lease.device.id);
      const currentLine2=line2SummaryFromMembers(current.members);
      const decision=decideExpiry(lease,currentLine2);

      if(decision.action==='preserve-current'){
        lease.status='external-change-detected';
        lease.closedAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),state:'external-change-detected',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        const audit=buildAuditRecord({
          eventType:'temporary-line-expiry',action:'preserve-external-change',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,expectedTemporaryLine2:lease.temporaryLine2,currentLine2},
          reason:'Webex changed outside Device Manager before lease expiry; current Webex state preserved.',
          webexStatus:'external-change-preserved',phonismStatus:'not-run',result:'external-change-detected',
          originalAuditId:lease.auditId,now
        });
        await writeAuditRecord(env,audit);
        results.push({leaseId:lease.leaseId,status:'external-change-detected'});
        continue;
      }

      const restored=restoreMembers(current.members,lease.baselineMember||null);
      await writeWebexMembers(webexFetch,env,orgId,lease.device.id,restored);
      try{
        await phonismReader.syncIntegration(env,lease.phonismIntegrationId,{
          companyId:lease.phonismCompanyId,tenantId:lease.phonismTenantId,
          assetTypes:['People','Workspace','Device']
        });
        lease.status='restored';
        lease.restoredAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),webex:'restored',phonism:'sync-queued',state:'restored',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        const audit=buildAuditRecord({
          eventType:'temporary-line-expiry',action:'auto-restore',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,restoredLine2:lease.baselineLine2},
          reason:'Temporary assignment expired; permanent Webex baseline restored and Phonism sync queued.',
          webexStatus:'restored',phonismStatus:'sync-queued',result:'completed',originalAuditId:lease.auditId,now
        });
        await writeAuditRecord(env,audit);
        results.push({leaseId:lease.leaseId,status:'restored'});
      }catch(error){
        lease.status='restore-sync-pending';
        lease.verification={...(lease.verification||{}),webex:'restored',phonism:'sync-failed',state:'restore-sync-pending',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        results.push({leaseId:lease.leaseId,status:'restore-sync-pending',error:error.code||'sync-failed'});
      }
    }catch(error){
      lease.expiryAttempts=Number(lease.expiryAttempts||0)+1;
      lease.lastExpiryError=String(error?.code||error?.message||'expiry-failed').slice(0,160);
      lease.lastExpiryAttemptAt=new Date(now).toISOString();
      await putLease(env,lease);
      results.push({leaseId:lease.leaseId,status:'retry-pending',attempts:lease.expiryAttempts});
    }
  }
  return results;
}
