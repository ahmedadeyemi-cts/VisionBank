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
      t38FaxCompressionEnabled:Boolean(target.t38FaxCompressionEnabled)
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
    const data=await readJsonMaybe(response);
    const message=String(data?.message||data?.error||'');
    let code='webex-members-write-failed';
    let status=response.status===401||response.status===403?503:502;
    if(/(?:error\s*4495|maximum number of allowed appearances)/i.test(message)){
      code='target-appearance-limit';status=409;
    }else if(/line label can only be configured for mpp device/i.test(message)){
      code='partner-managed-line-label-unsupported';status=409;
    }else if(response.status===409||response.status===410){
      code='webex-members-conflict';status=409;
    }
    const error=new DeviceManagementError(code,status);
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
      locationId:targetMember.locationId||null,locationName:targetMember.locationName||'',
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
  return target?{
    memberId:String(target.id),name:clean(target.name||target.displayName||'',160),extension:clean(target.extension||'',32),
    phoneNumber:clean(target.phoneNumber||'',64),type:clean(target.type||target.memberType||'',40),
    locationId:clean(target.locationId||'',180)||null,locationName:clean(target.locationName||'',120)
  }:null;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function boundedProviderCall(factory,ms=1200){
  let timer;
  try{
    return await Promise.race([
      Promise.resolve().then(factory),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new DeviceManagementError('phonism-read-timeout',503)),ms);})
    ]);
  }finally{clearTimeout(timer);}
}

export function phonismLineMatchesTarget(lines=[],target=null){
  const line2=(Array.isArray(lines)?lines:[]).find(x=>Number(x?.lineNumber)===2)||null;
  if(!target)return !line2;
  if(!line2)return false;
  const targetName=clean(target.name||target.displayName||'',160).toLowerCase();
  const targetExtension=clean(target.extension||'',32).toLowerCase();
  const fields=[line2.alias,line2.username,line2.broadworksUserId].map(x=>String(x||'').trim().toLowerCase());
  // Match complete identities/tokens, never extension 1406 inside 14060.
  const extensionMatches=targetExtension&&fields.some(field=>field.split(/[^a-z0-9]+/).includes(targetExtension));
  const nameMatches=targetName&&fields.some(field=>field===targetName||field.startsWith(targetName+' - ('));
  return Boolean(extensionMatches||nameMatches);
}

async function waitForPhonismLine2({env,phonismReader,phoneId,target}){
  const delays=[0,1000,1500,2500,3500];
  let lastError=null;
  for(let i=0;i<delays.length;i++){
    if(delays[i])await wait(delays[i]);
    try{
      const lines=await boundedProviderCall(()=>phonismReader.lines(env,phoneId),1200);
      if(phonismLineMatchesTarget(lines,target))return {confirmed:true,attempts:i+1,error:null};
    }catch(error){
      lastError=String(error?.code||error?.message||'phonism-line-check-failed').slice(0,160);
    }
  }
  return {confirmed:false,attempts:delays.length,error:lastError};
}

async function queueAutomaticReboot({env,phonismReader,phoneId}){
  const delays=[0,250,750];
  let lastError=null;
  for(let i=0;i<delays.length;i++){
    if(delays[i])await wait(delays[i]);
    try{
      await phonismReader.tr069Action(env,phoneId,'Reboot');
      return {queued:true,attempts:i+1,error:null};
    }catch(error){
      lastError=String(error?.code||error?.message||'reboot-failed').slice(0,160);
    }
  }
  return {queued:false,attempts:delays.length,error:lastError||'reboot-failed'};
}

export async function applyWritePreview({env,request,session,webexFetch,orgId,mutationId,phonismReader=createPhonismReader(),saveRequestedAt=null}){
  const preview=await getPreview(env,mutationId);
  if(!preview)throw new DeviceManagementError('preview-expired',409);
  if(preview.sessionId!==session.id)throw new DeviceManagementError('preview-operator-mismatch',403);
  if(!isPilotDevice(env,preview.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  if(!preview.phonismContext?.companyId)throw new DeviceManagementError('phonism-enterprise-sync-company-required',409);

  const current=await readWebexMembers(webexFetch,env,orgId,preview.device.id);
  const freshHash=await membersFingerprint(current.members);
  if(freshHash!==preview.currentHash)throw new DeviceManagementError('device-state-changed-review-again',409);

  const desired=composeMembers(current.members,preview.targetMember);
  let webexSaved=false,phonismQueued=false,rolledBack=false;
  try{
    await writeWebexMembers(webexFetch,env,orgId,preview.device.id,desired);
    webexSaved=true;

    const pc=preview.phonismContext||{};
    await phonismReader.syncHierarchyIntegration(env,pc.companyId,{
      tenantId:pc.tenantId,
      assetTypes:['Device']
    });
    phonismQueued=true;
  }catch(error){
    if(webexSaved&&!phonismQueued){
      try{await writeWebexMembers(webexFetch,env,orgId,preview.device.id,current.members.map(m=>writableMember(m)));rolledBack=true;}catch{}
    }
    const audit=buildAuditRecord({
      eventType:'temporary-line-change',action:'save-sync',request,session,
      device:preview.device,location:preview.location,
      change:{beforeLine2:preview.baselineLine2,afterLine2:targetSummary(preview.targetMember),durationMinutes:preview.durationMinutes,stage:webexSaved?'phonism-sync':'webex-members-write',errorCode:error?.code||'provider-operation-failed',upstreamStatus:error?.upstreamStatus||null,providerFailure:error?.providerFailure||null,providerAttempts:error?.providerAttempts||1},
      reason:preview.reason,webexStatus:webexSaved?(rolledBack?'rolled-back':'saved'):'failed',
      phonismStatus:phonismQueued?'sync-queued':'failed',result:rolledBack?'rolled-back':'failed'
    });
    await writeAuditRecord(env,audit);
    if(error?.code==='target-appearance-limit'){
      error.targetMember=targetSummary(preview.targetMember);
      error.location=preview.location;
      error.device=preview.device;
    }
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
    phonismTenantId:pc.tenantId,phonismCompanyId:pc.companyId
  });
  lease.baselineMember=preview.baselineMember||null;
  lease.timing={saveRequestedAt:saveRequestedAt||lease.startsAt,webexAndSyncSavedAt:lease.startsAt};
  // Persist before waiting: scheduled maintenance can recover a terminated request.
  lease.recovery={syncStrategy:'device-first',syncPending:true,syncPendingSince:new Date().toISOString(),automaticReboot:true,rebootAttempted:false};
  lease.verification.state='sync-pending';
  await putLease(env,lease);

  let rebootQueued=false,rebootError=null;
  if(pc.phoneId){
    const syncConfirmation=await waitForPhonismLine2({
      env,phonismReader,phoneId:pc.phoneId,target:preview.targetMember
    });
    if(!syncConfirmation.confirmed){
      lease.recovery={...lease.recovery,syncConfirmAttempts:syncConfirmation.attempts,syncConfirmError:syncConfirmation.error||'phonism-line-not-ready',initialSyncCheckCompletedAt:new Date().toISOString(),
        // Give the active handset a bounded fast-check window; cron takes over afterwards.
        phonePollUntil:session.actorType==='device'?new Date(Date.now()+300000).toISOString():null};
      lease.verification={...lease.verification,phonism:'pending',state:'sync-pending',lastCheckedAt:new Date().toISOString()};
      await putLease(env,lease);
      await writeAuditRecord(env,buildAuditRecord({
        eventType:'device-sync-attention',action:'wait-for-line-sync',request,session,device:preview.device,location:preview.location,
        change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2,stage:'phonism-line-sync',errorCode:syncConfirmation.error||'phonism-line-not-ready'},
        reason:'Webex saved the assignment, but Phonism has not confirmed the requested Line 2. Reboot deferred; scheduled maintenance will retry.',
        webexStatus:'saved',phonismStatus:'sync-pending',result:'attention',originalAuditId:audit.auditId
      }));
      if(env?.SESSIONS?.delete)await env.SESSIONS.delete(PREVIEW_PREFIX+preview.mutationId);
      return {lease,audit,rebootQueued:false,rebootError:null,syncPending:true};
    }
    lease.recovery.syncPending=false;
    const rebootAt=new Date().toISOString();
    lease.timing={...lease.timing,syncConfirmedAt:rebootAt,restartRequestedAt:rebootAt,saveToRestartRequestMs:Math.max(0,Date.parse(rebootAt)-Date.parse(lease.timing.saveRequestedAt))};
    await putLease(env,lease);
    const reboot=await queueAutomaticReboot({env,phonismReader,phoneId:pc.phoneId});
    rebootQueued=reboot.queued;
    rebootError=reboot.error;
    if(rebootQueued){
      lease.recovery={
        ...(lease.recovery||{}),rebootAttempted:true,rebootAt,automaticReboot:true,
        syncConfirmedBeforeReboot:syncConfirmation.confirmed,
        syncConfirmAttempts:syncConfirmation.attempts,
        syncConfirmError:syncConfirmation.error||null,
        autoRebootAttempts:reboot.attempts
      };
      lease.verification={...(lease.verification||{}),phonism:'reboot-queued',state:'reboot-queued',lastCheckedAt:rebootAt};
      await putLease(env,lease);
      await writeAuditRecord(env,buildAuditRecord({
        eventType:'device-recovery',action:'automatic-reboot-after-save',
        systemActor:automatedActor(session.operator),device:preview.device,location:preview.location,
        change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},
        reason:syncConfirmation.confirmed
          ?'Webex save completed, Phonism Line 2 convergence was confirmed, and automatic TR-069 reboot was queued with no user action required.'
          :'Webex save completed and Phonism Sync was accepted; after bounded Line 2 checks, automatic TR-069 reboot was still queued with no user action required.',
        webexStatus:'saved',phonismStatus:'reboot-queued',result:'pending-verification',
        originalAuditId:audit.auditId
      }));
    }else{
      lease.recovery={
        ...(lease.recovery||{}),rebootAttempted:false,automaticReboot:true,
        syncConfirmedBeforeReboot:syncConfirmation.confirmed,
        syncConfirmAttempts:syncConfirmation.attempts,
        syncConfirmError:syncConfirmation.error||null,
        autoRebootAttempts:reboot.attempts,
        autoRebootFailed:true,autoRebootError:rebootError,autoRebootFailedAt:rebootAt
      };
      lease.verification={...(lease.verification||{}),phonism:'reboot-failed',state:'reboot-failed',lastCheckedAt:rebootAt};
      await putLease(env,lease);
      await writeAuditRecord(env,buildAuditRecord({
        eventType:'device-recovery',action:'automatic-reboot-after-save',
        systemActor:automatedActor(session.operator),device:preview.device,location:preview.location,
        change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2,stage:'automatic-reboot',errorCode:rebootError||'reboot-failed'},
        reason:'Webex save and Phonism Sync succeeded, but automatic TR-069 reboot retries could not be queued.',
        webexStatus:'saved',phonismStatus:'reboot-failed',result:'failed',
        originalAuditId:audit.auditId
      }));
    }
  }

  if(env?.SESSIONS?.delete)await env.SESSIONS.delete(PREVIEW_PREFIX+preview.mutationId);
  return {lease,audit,rebootQueued,rebootError};
}

export async function verifyLease({env,webexFetch,orgId,leaseId,phonismReader=createPhonismReader()}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(lease.status!=='active'||Date.parse(lease.expiresAt)<=Date.now())return {lease,state:lease.status,webexLine2:null,phonismLine2:null};
  const current=await readWebexMembers(webexFetch,env,orgId,lease.device.id);
  const webexLine2=line2SummaryFromMembers(current.members);
  const removingLine2=!lease.temporaryLine2;
  const targetId=String(lease.temporaryLine2?.memberId||'');
  const webexMatches=removingLine2?!webexLine2:String(webexLine2?.memberId||'')===targetId;

  let phonismLine2=null,phonismRead=false,phonismLines=[];
  if(lease.phonismPhoneId){
    try{
      phonismLines=await phonismReader.lines(env,lease.phonismPhoneId);
      phonismRead=true;
      phonismLine2=phonismLines.find(x=>Number(x.lineNumber)===2)||null;
    }catch{}
  }

  const phonismPresent=phonismRead&&phonismLineMatchesTarget(phonismLines,lease.temporaryLine2);
  const phonismRegistration=removingLine2?'removed':(phonismLine2?.registrationStatus||'pending');
  const configConverged=webexMatches&&phonismPresent;

  let state=lease.recovery?.syncPending?'sync-pending':lease.recovery?.syncFailed?'sync-failed':'pending-verification';
  if(configConverged&&lease.recovery?.rebootAttempted===true){
    if(removingLine2||phonismRegistration==='registered')state='applied';
    else if(phonismRegistration==='not-monitored')state='applied-unverified';
    else if(phonismRegistration==='unregistered')state='registration-failed';
  }else if(configConverged&&lease.recovery?.autoRebootFailed===true){
    state='reboot-failed';
  }else if(configConverged&&!lease.recovery?.syncPending&&!lease.recovery?.syncFailed){
    state='reboot-pending';
  }

  lease.verification={
    webex:webexMatches?'confirmed':'pending',
    phonism:phonismPresent?phonismRegistration:'pending',
    state,lastCheckedAt:new Date().toISOString()
  };
  // Read-only status checks must not overwrite the pending job while cron advances it.
  if(!lease.recovery?.syncPending)await putLease(env,lease);
  return {lease,webexLine2,phonismLine2,state};
}

const phoneRestartInFlight=new Set();
export async function runRecoveryAction(args){
  const key=args.leaseId;
  if(args.phoneFallback&&phoneRestartInFlight.has(key))throw new DeviceManagementError('restart-already-requested',409);
  if(args.phoneFallback)phoneRestartInFlight.add(key);
  try{return await performRecoveryAction(args);}finally{if(args.phoneFallback)phoneRestartInFlight.delete(key);}
}
async function performRecoveryAction({env,request,session,leaseId,webexFetch,orgId,phonismReader=createPhonismReader(),phoneFallback=false}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(!isPilotDevice(env,lease.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  if(lease.status!=='active'||Date.parse(lease.expiresAt)<=Date.now())throw new DeviceManagementError('lease-not-active',409);
  if(lease.recovery?.syncPending)throw new DeviceManagementError('phonism-line-not-ready',409);
  if(phoneFallback){
    if(session?.deviceIdentity?.mac!==lease.device.mac)throw new DeviceManagementError('phone-credential-invalid',403);
    const since=Date.parse(lease.recovery?.rebootAt||lease.recovery?.autoRebootFailedAt||'');
    if(!lease.recovery?.syncConfirmedBeforeReboot||!Number.isFinite(since)||Date.now()-since<60000)throw new DeviceManagementError('restart-not-ready',409);
    if(lease.recovery?.manualPhoneRestartAt)throw new DeviceManagementError('restart-already-requested',409);
  }
  const current=await readWebexMembers(webexFetch,env,orgId,lease.device.id);
  const currentLine2=line2SummaryFromMembers(current.members);
  if(lease.temporaryLine2?String(currentLine2?.memberId||'')!==String(lease.temporaryLine2.memberId):Boolean(currentLine2))throw new DeviceManagementError('webex-line-changed',409);
  const lines=await phonismReader.lines(env,lease.phonismPhoneId);
  if(!phonismLineMatchesTarget(lines,lease.temporaryLine2))throw new DeviceManagementError('phonism-line-not-ready',409);
  if(phoneFallback){
    // Persist before sending. An ambiguous provider response must not invite a second restart.
    lease.recovery={...lease.recovery,manualPhoneRestartAt:new Date().toISOString()};
    await putLease(env,lease);
  }
  const result=await phonismReader.tr069Action(env,lease.phonismPhoneId,'Reboot');
  const rebootAt=new Date().toISOString();
  lease.recovery={...(lease.recovery||{}),rebootAttempted:true,rebootAt,automaticReboot:false,syncPending:false,syncFailed:false};
  lease.verification={...(lease.verification||{}),phonism:'Reboot-queued',state:'pending-verification',lastCheckedAt:rebootAt};
  await putLease(env,lease);
  const audit=buildAuditRecord({
    eventType:'device-recovery',action:'reboot-reverify',
    request,session,device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},reason:'Manual Reboot & Reverify requested from Device Manager.',
    webexStatus:lease.verification?.webex||'unknown',phonismStatus:'Reboot-queued',result:'pending-verification',
    originalAuditId:lease.auditId
  });
  await writeAuditRecord(env,audit);
  return {result,audit,lease};
}


async function queueCleanupSync({env,lease,phonismReader,now}){
 const manual=Boolean(lease.manualEndRequestedAt);
 if(manual)lease.recovery={...(lease.recovery||{}),cleanupSyncStrategy:'device-first',cleanupSyncSince:lease.recovery?.cleanupSyncSince||new Date(now).toISOString()};
 await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
   tenantId:lease.phonismTenantId,assetTypes:manual?['Device']:['People','Workspace','Device'],
   ...(manual?{singleAttempt:true,timeoutMs:3000}:{})
 });
}

async function confirmCleanupSync({env,lease,phonismReader,webexFetch,orgId,now,target,cleanupDeadline=null}){
  let error=null;
  try{
    const current=line2SummaryFromMembers((await readWebexMembers(webexFetch,env,orgId,lease.device.id)).members);
    if((current?.memberId||null)!==(target?.memberId||null))error='webex-line-changed';
    else if(!phonismLineMatchesTarget(await boundedProviderCall(()=>phonismReader.lines(env,lease.phonismPhoneId),2000),target))error='phonism-line-not-ready';
  }catch(e){error=e?.code||'line-sync-check-failed';}
  if(cleanupDeadline&&Date.now()>=cleanupDeadline)return false;
  if(!error){
    lease.recovery={...(lease.recovery||{}),cleanupSyncPending:false,cleanupSyncConfirmed:true,cleanupSyncError:null};
    return true;
  }
  const since=lease.recovery?.cleanupSyncSince||new Date(now).toISOString();
  if(error==='phonism-line-not-ready'&&lease.recovery?.cleanupSyncStrategy==='device-first'&&
     !lease.recovery.cleanupFullSyncAttemptedAt&&now-Date.parse(since)>=15000&&now-Date.parse(since)<10*60000&&
     (!cleanupDeadline||cleanupDeadline-Date.now()>5000)){
    lease.recovery={...(lease.recovery||{}),cleanupFullSyncAttemptedAt:new Date().toISOString()};
    await putLease(env,lease);
    try{
      await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{tenantId:lease.phonismTenantId,assetTypes:['People','Workspace','Device'],singleAttempt:true,timeoutMs:3000});
      lease.recovery.cleanupFullSyncAcceptedAt=new Date().toISOString();
    }catch(e){lease.recovery.cleanupFullSyncError=e?.code||'sync-failed';}
  }
  const overdue=now-Date.parse(since)>=10*60000;
  const log=!lease.recovery?.cleanupSyncPending||(overdue&&!lease.recovery?.cleanupSyncFailureLogged);
  lease.recovery={...(lease.recovery||{}),cleanupSyncPending:true,cleanupSyncSince:since,cleanupSyncError:error,cleanupSyncFailureLogged:overdue||lease.recovery?.cleanupSyncFailureLogged||false};
  if(log)await writeAuditRecord(env,buildAuditRecord({
    eventType:'device-sync-failure',action:'expiry-wait-for-line-sync',systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,restoredLine2:target,stage:'expiry-phonism-line-sync',errorCode:error},
    reason:'Expiry configuration is not yet confirmed in Webex and Phonism. Restart withheld; maintenance will retry.',
    webexStatus:'restore-requested',phonismStatus:'not-confirmed',result:overdue?'failed':'attention',originalAuditId:lease.auditId,now
  }));
  return false;
}

async function queueRestoreReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline=null}){
  if(!lease.phonismPhoneId)return {queued:false,error:'phonism-phone-required'};
  if(!await confirmCleanupSync({env,lease,phonismReader,webexFetch,orgId,now,target:lease.baselineLine2||null,cleanupDeadline}))return {queued:false,error:lease.recovery.cleanupSyncError};
  try{
    await phonismReader.tr069Action(env,lease.phonismPhoneId,'Reboot');
    lease.recovery={...(lease.recovery||{}),restoreRebootAttempted:true,restoreRebootAt:new Date(now).toISOString(),restoreAutomaticReboot:true};
    return {queued:true};
  }catch(error){
    const message=String(error?.code||error?.message||'reboot-failed').slice(0,160);
    lease.recovery={...(lease.recovery||{}),restoreRebootAttempted:true,restoreRebootFailed:true,restoreRebootError:message,restoreRebootFailedAt:new Date(now).toISOString()};
    return {queued:false,error:message};
  }
}

async function queueExternalReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline=null}){
  if(!lease.phonismPhoneId)return {queued:false,error:'phonism-phone-required'};
  if(!await confirmCleanupSync({env,lease,phonismReader,webexFetch,orgId,now,target:lease.externalCurrentLine2||null,cleanupDeadline}))return {queued:false,error:lease.recovery.cleanupSyncError};
  try{
    await phonismReader.tr069Action(env,lease.phonismPhoneId,'Reboot');
    lease.recovery={...(lease.recovery||{}),externalRebootAttempted:true,externalRebootAt:new Date(now).toISOString(),externalAutomaticReboot:true};
    return {queued:true};
  }catch(error){
    const message=String(error?.code||error?.message||'reboot-failed').slice(0,160);
    lease.recovery={...(lease.recovery||{}),externalRebootAttempted:true,externalRebootFailed:true,externalRebootError:message,externalRebootFailedAt:new Date(now).toISOString()};
    return {queued:false,error:message};
  }
}

async function finishExternalReconcile({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline=null}){
  const reboot=await queueExternalReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline});
  if(!reboot.queued){
    lease.status='external-change-reboot-pending';
    lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-queued-reboot-failed',state:'external-change-reboot-pending',lastCheckedAt:new Date(now).toISOString()};
    await putLease(env,lease);
    return {leaseId:lease.leaseId,status:'external-change-reboot-pending',error:reboot.error};
  }
  lease.status='external-change-reconciled';
  lease.closedAt=new Date(now).toISOString();
  lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-queued-reboot-queued',state:'external-change-reconciled',lastCheckedAt:new Date(now).toISOString()};
  await putLease(env,lease);
  await writeAuditRecord(env,buildAuditRecord({
    eventType:'temporary-line-expiry',action:'preserve-external-change-sync-reboot',
    systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,expectedTemporaryLine2:lease.temporaryLine2,currentLine2:lease.externalCurrentLine2||null},
    reason:'Webex changed outside Device Manager before lease expiry; current Webex state was preserved, then Phonism Sync and automatic reboot were queued to reconcile the handset.',
    webexStatus:'external-change-preserved',phonismStatus:'sync-queued-reboot-queued',result:'external-change-reconciled',
    originalAuditId:lease.auditId,now
  }));
  return {leaseId:lease.leaseId,status:'external-change-reconciled'};
}

export async function endTemporaryLease({env,request,session,webexFetch,orgId,leaseId,phonismReader=createPhonismReader(),now=Date.now(),deferWork=false}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(!isPilotDevice(env,lease.device?.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  if(lease.manualEndRequestedAt&&deferWork)return {lease,result:{status:lease.status}};
  if(lease.status!=='active')throw new DeviceManagementError('lease-not-active',409);
  lease.manualEndRequestedAt=new Date(now).toISOString();
  lease.manualEndRequestedBy={
    type:session?.actorType==='device'?'device':'human',
    name:clean(session?.operator?.name||'',100),
    email:clean(session?.operator?.email||'',254)
  };
  lease.expiresAt=new Date(Math.min(now,Date.parse(lease.expiresAt))).toISOString();
  if(deferWork)lease.recovery={...(lease.recovery||{}),phoneCleanupUntil:new Date(now+300000).toISOString()};
  await putLease(env,lease);
  await writeAuditRecord(env,buildAuditRecord({
    eventType:'temporary-line-signout',action:'signout-requested',request,session,
    device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},
    reason:'Phone user requested early sign out of the temporary Line 2 assignment.',
    webexStatus:'pending-restore',phonismStatus:'pending-sync',result:'pending',originalAuditId:lease.auditId,now
  }));
  if(deferWork)return {lease,result:{status:'signout-requested'}};
  const results=await sweepExpiredLeases({env,webexFetch,orgId,phonismReader,now,onlyLeaseId:lease.leaseId});
  const result=results.find(row=>String(row.leaseId)===String(lease.leaseId));
  if(!result)throw new DeviceManagementError('temporary-line-signout-not-completed',503);
  return {result,lease:await getLease(env,lease.leaseId)};
}


async function resumePendingLineSync({env,lease,webexFetch,orgId,phonismReader,now,phoneDeadline=null}){
  // Do not overlap the initial request's bounded work.
  if(lease.status!=='active'||Date.parse(lease.expiresAt)<=now)return;
  if(!lease.recovery.initialSyncCheckCompletedAt&&now-Date.parse(lease.recovery.syncPendingSince||lease.startsAt)<30000)return;
  const checkStartedAt=Date.now();
  let error=null,confirmed=false;
  try{
    // Both reads are independent; do not add their network latencies together.
    // Settle both so a failed Phonism read cannot conceal a changed Webex assignment.
    const [webex,phonism]=await Promise.allSettled([
      boundedProviderCall(()=>readWebexMembers(webexFetch,env,orgId,lease.device.id),4000),
      boundedProviderCall(()=>phonismReader.lines(env,lease.phonismPhoneId),3000)
    ]);
    if(webex.status==='rejected')throw webex.reason;
    const line2=line2SummaryFromMembers(webex.value.members);
    const same=lease.temporaryLine2?String(line2?.memberId||'')===String(lease.temporaryLine2.memberId):!line2;
    if(!same)error='webex-line-changed';
    else if(phonism.status==='rejected')throw phonism.reason;
    else confirmed=phonismLineMatchesTarget(phonism.value,lease.temporaryLine2);
  }catch(e){error=e?.code||'line-sync-check-failed';}
  // Never cross the fixed ownership boundary or restart after expiry.
  if(phoneDeadline&&Date.now()>=phoneDeadline)return;
  const checkedAt=phoneDeadline?Date.now():now;
  if(Date.parse(lease.expiresAt)<=checkedAt)return;
  lease.recovery={...lease.recovery,syncRetryChecks:Number(lease.recovery.syncRetryChecks||0)+1,lastSyncCheckAt:new Date(checkedAt).toISOString(),lastSyncCheckMs:Date.now()-checkStartedAt,lastSyncCheckSource:phoneDeadline?'phone-progress':'scheduled'};
  if(!confirmed){
    // An accepted Device sync is asynchronous. Observed readiness takes 35–100s;
    // a 15s fallback can overlap that work; logs show second updates during reboot.
    // Keep checking immediately, but reserve broad inventory sync for recovery.
    // Persist its one-shot claim before dispatch; never enqueue on every refresh.
    const fallbackDue=lease.recovery.syncStrategy==='device-first'&&
      !lease.recovery.fullSyncFallbackAttemptedAt&&lease.phonismCompanyId&&lease.phonismTenantId&&
      !error&&now-Date.parse(lease.recovery.syncPendingSince||lease.startsAt)>=120000&&
      now-Date.parse(lease.recovery.syncPendingSince||lease.startsAt)<10*60000&&
      (!phoneDeadline||phoneDeadline-Date.now()>8000)&&Date.parse(lease.expiresAt)>Math.max(now,Date.now())+5000;
    if(fallbackDue){
      const fallbackAt=new Date().toISOString();
      lease.recovery={...lease.recovery,fullSyncFallbackAttemptedAt:fallbackAt};
      await putLease(env,lease);
      let fallbackError=null;
      try{
        await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
          tenantId:lease.phonismTenantId,assetTypes:['People','Workspace','Device'],singleAttempt:true,timeoutMs:3000
        });
        lease.recovery.fullSyncFallbackAcceptedAt=new Date().toISOString();
      }catch(e){fallbackError=e;lease.recovery.fullSyncFallbackError=e?.code||'sync-failed';}
      await writeAuditRecord(env,buildAuditRecord({
        eventType:'device-sync-recovery',action:'device-sync-broader-fallback',
        systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
        change:{leaseId:lease.leaseId,stage:'phonism-sync',syncStrategy:'device-first',
          assetTypes:['People','Workspace','Device'],errorCode:fallbackError?.code||null,
          upstreamStatus:fallbackError?.upstreamStatus||null,providerFailure:fallbackError?.providerFailure||null},
        reason:'Device-only sync has not confirmed the requested line after 120 seconds; one broader recovery synchronization attempt issued.',
        webexStatus:'confirmed',phonismStatus:fallbackError?'fallback-not-confirmed':'fallback-queued',
        result:'pending-verification',originalAuditId:lease.auditId
      }));
    }
    const failed=error==='webex-line-changed'||now-Date.parse(lease.recovery.syncPendingSince||lease.startsAt)>=10*60000;
    lease.recovery={...lease.recovery,syncPending:!failed,syncFailed:failed,syncConfirmError:error||'phonism-line-not-ready'};
    lease.verification={...lease.verification,state:failed?'sync-failed':'sync-pending',lastCheckedAt:new Date(now).toISOString()};
    await putLease(env,lease);
    if(failed)await writeAuditRecord(env,buildAuditRecord({
      eventType:'device-sync-failure',action:'line-sync-timeout',systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
      change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2,stage:'phonism-line-sync',errorCode:error||'phonism-line-not-ready'},
      reason:'Requested Line 2 could not be confirmed. No reboot sent. Check provisioning; assignment still expires automatically.',
      webexStatus:'not-confirmed',phonismStatus:'sync-failed',result:'failed',originalAuditId:lease.auditId,now
    }));
    return;
  }
  // Persist completion of the synchronization stage before sending the reboot.
  lease.recovery={...lease.recovery,syncPending:false,syncFailed:false,syncConfirmedBeforeReboot:true};
  const restartRequestedAt=new Date().toISOString();
  lease.timing={...(lease.timing||{}),syncConfirmedAt:restartRequestedAt,restartRequestedAt,saveToRestartRequestMs:Math.max(0,Date.parse(restartRequestedAt)-Date.parse(lease.timing?.saveRequestedAt||lease.startsAt))};
  await putLease(env,lease);
  const reboot=await queueAutomaticReboot({env,phonismReader,phoneId:lease.phonismPhoneId});
  lease.recovery={...lease.recovery,rebootAttempted:reboot.queued,rebootAt:restartRequestedAt,autoRebootFailed:!reboot.queued,autoRebootError:reboot.error,autoRebootAttempts:reboot.attempts};
  lease.verification={...lease.verification,state:reboot.queued?'reboot-queued':'reboot-failed',lastCheckedAt:new Date(now).toISOString()};
  await putLease(env,lease);
  await writeAuditRecord(env,buildAuditRecord({
    eventType:'device-recovery',action:'automatic-reboot-after-sync',systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2,stage:'automatic-reboot',errorCode:reboot.error||null,timing:lease.timing,syncRetryChecks:lease.recovery.syncRetryChecks,source:lease.recovery.lastSyncCheckSource},
    reason:reboot.queued?'Requested Line 2 confirmed in Webex and Phonism; automatic reboot queued.':'Line 2 confirmed, but reboot request failed.',
    webexStatus:'confirmed',phonismStatus:reboot.queued?'reboot-queued':'reboot-failed',result:reboot.queued?'pending-verification':'failed',originalAuditId:lease.auditId,now
  }));
}

export async function sweepExpiredLeases({env,webexFetch,orgId,phonismReader=createPhonismReader(),now=Date.now(),onlyLeaseId=null,cleanupDeadline=null}){
  const leases=onlyLeaseId?[await getLease(env,onlyLeaseId)].filter(Boolean):await listLeases(env,{limit:1000});
  const results=[];
  for(const lease of leases){
    if(onlyLeaseId&&String(lease.leaseId)!==String(onlyLeaseId))continue;
    if(!onlyLeaseId&&Date.parse(lease.recovery?.phoneCleanupUntil||'')>now)continue;
    if(cleanupDeadline&&Date.now()>=cleanupDeadline)continue;
    const expires=Date.parse(lease.expiresAt||'');
    if(!Number.isFinite(expires))continue;
    if(expires>now){
      if(lease.status==='active'&&lease.recovery?.syncPending&&!(Date.parse(lease.recovery.phonePollUntil||'')>now)){
        try{await resumePendingLineSync({env,lease,webexFetch,orgId,phonismReader,now});}
        catch(error){results.push({leaseId:lease.leaseId,status:'sync-retry-pending',error:error?.code||'sync-check-failed'});}
      }
      continue;
    }

    if(['restore-sync-pending','restore-reboot-pending','external-change-sync-pending','external-change-reboot-pending'].includes(lease.status)){
      try{
        const target=lease.status.startsWith('restore-')?lease.baselineLine2:lease.externalCurrentLine2;
        const current=line2SummaryFromMembers((await readWebexMembers(webexFetch,env,orgId,lease.device.id)).members);
        if((current?.memberId||null)!==(target?.memberId||null)){
          lease.status='superseded';lease.closedAt=new Date(now).toISOString();
          lease.recovery={...(lease.recovery||{}),cleanupSyncPending:false};
          await putLease(env,lease);
          await writeAuditRecord(env,buildAuditRecord({eventType:'temporary-line-expiry',action:'skip-obsolete-cleanup',systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,change:{leaseId:lease.leaseId,currentLine2:current},reason:'A newer Webex assignment superseded this cleanup; no write or restart sent.',webexStatus:'external-change-preserved',phonismStatus:'not-requested',result:'completed',originalAuditId:lease.auditId,now}));
          results.push({leaseId:lease.leaseId,status:'superseded'});continue;
        }
      }catch(error){results.push({leaseId:lease.leaseId,status:lease.status,error:error?.code||'webex-read-failed'});continue;}
    }

    if(lease.status==='external-change-reboot-pending'){
      results.push(await finishExternalReconcile({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline}));
      continue;
    }

    if(lease.status==='external-change-sync-pending'){
      try{
        await queueCleanupSync({env,lease,phonismReader,now});
        results.push(await finishExternalReconcile({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline}));
      }catch(error){
        lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-failed',state:'external-change-sync-pending',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        results.push({leaseId:lease.leaseId,status:'external-change-sync-pending',error:error.code||'sync-failed'});
      }
      continue;
    }

    if(lease.status==='restore-reboot-pending'){
      const reboot=await queueRestoreReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline});
      if(reboot.queued){
        lease.status='restored';
        lease.restoredAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),phonism:'sync-queued-reboot-queued',state:'restored',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        await writeAuditRecord(env,buildAuditRecord({
          eventType:'temporary-line-expiry',action:'auto-restore-reboot',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,restoredLine2:lease.baselineLine2},
          reason:'Permanent Webex baseline was already restored and Phonism Sync was queued; automatic reboot was retried and queued.',
          webexStatus:'restored',phonismStatus:'sync-queued-reboot-queued',result:'completed',originalAuditId:lease.auditId,now
        }));
        results.push({leaseId:lease.leaseId,status:'restored'});
      }else{
        await putLease(env,lease);
        results.push({leaseId:lease.leaseId,status:'restore-reboot-pending',error:reboot.error});
      }
      continue;
    }

    if(lease.status==='restore-sync-pending'){
      try{
        await queueCleanupSync({env,lease,phonismReader,now});
        const reboot=await queueRestoreReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline});
        if(!reboot.queued){
          lease.status='restore-reboot-pending';
          lease.verification={...(lease.verification||{}),phonism:'sync-queued-reboot-failed',state:'restore-reboot-pending',lastCheckedAt:new Date(now).toISOString()};
          await putLease(env,lease);
          results.push({leaseId:lease.leaseId,status:'restore-reboot-pending',error:reboot.error});
          continue;
        }
        lease.status='restored';
        lease.restoredAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),phonism:'sync-queued-reboot-queued',state:'restored',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        await writeAuditRecord(env,buildAuditRecord({
          eventType:'temporary-line-expiry',action:'auto-restore-sync-reboot',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,restoredLine2:lease.baselineLine2},
          reason:'Temporary assignment expired; Phonism Sync and automatic reboot were queued after Webex restore.',
          webexStatus:'restored',phonismStatus:'sync-queued-reboot-queued',result:'completed',originalAuditId:lease.auditId,now
        }));
        results.push({leaseId:lease.leaseId,status:'restored'});
      }catch(error){
        await putLease(env,lease);
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
        lease.externalCurrentLine2=currentLine2||null;
        try{
          await queueCleanupSync({env,lease,phonismReader,now});
          results.push(await finishExternalReconcile({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline}));
        }catch(error){
          lease.status='external-change-sync-pending';
          lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-failed',state:'external-change-sync-pending',lastCheckedAt:new Date(now).toISOString()};
          await putLease(env,lease);
          results.push({leaseId:lease.leaseId,status:'external-change-sync-pending',error:error.code||'sync-failed'});
        }
        continue;
      }

      if(cleanupDeadline&&Date.now()>=cleanupDeadline)continue;
      const restored=restoreMembers(current.members,lease.baselineMember||null);
      await writeWebexMembers(webexFetch,env,orgId,lease.device.id,restored);
      try{
        await queueCleanupSync({env,lease,phonismReader,now});
        const reboot=await queueRestoreReboot({env,lease,phonismReader,webexFetch,orgId,now,cleanupDeadline});
        if(!reboot.queued){
          lease.status='restore-reboot-pending';
          lease.verification={...(lease.verification||{}),webex:'restored',phonism:'sync-queued-reboot-failed',state:'restore-reboot-pending',lastCheckedAt:new Date(now).toISOString()};
          await putLease(env,lease);
          results.push({leaseId:lease.leaseId,status:'restore-reboot-pending',error:reboot.error});
          continue;
        }
        lease.status='restored';
        lease.restoredAt=new Date(now).toISOString();
        lease.verification={...(lease.verification||{}),webex:'restored',phonism:'sync-queued-reboot-queued',state:'restored',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        await writeAuditRecord(env,buildAuditRecord({
          eventType:'temporary-line-expiry',action:'auto-restore',
          systemActor:automatedActor(lease.operator),device:lease.device,location:lease.location,
          change:{leaseId:lease.leaseId,restoredLine2:lease.baselineLine2},
          reason:'Temporary assignment expired; permanent Webex baseline restored, Phonism Sync queued, and automatic reboot queued.',
          webexStatus:'restored',phonismStatus:'sync-queued-reboot-queued',result:'completed',originalAuditId:lease.auditId,now
        }));
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

// Handset requests are serial; coalesce overlapping requests within a Worker isolate.
// Cron never owns a lease during this fixed window. Leave ten seconds for handoff.
const phoneSyncInFlight=new Map();
export async function advancePhoneLineSync({env,enrollment,leaseId,webexFetch,orgId,phonismReader=createPhonismReader()}){
  if(phoneSyncInFlight.has(leaseId))return phoneSyncInFlight.get(leaseId);
  const work=(async()=>{
    const lease=await getLease(env,leaseId);
    if(!lease||lease.device?.mac!==enrollment.device.mac||String(lease.phonismPhoneId)!==String(enrollment.phonismPhoneId))throw new DeviceManagementError('phone-credential-invalid',403);
    if(!isPilotDevice(env,lease.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
    const now=Date.now(),until=Date.parse(lease.recovery?.phonePollUntil||'');
    if(lease.status!=='active'||Date.parse(lease.expiresAt)<=now||!lease.recovery?.syncPending||!lease.recovery.initialSyncCheckCompletedAt||!Number.isFinite(until)||now>=until-10000)return;
    await resumePendingLineSync({env,lease,webexFetch,orgId,phonismReader,now,phoneDeadline:until-10000});
  })();
  phoneSyncInFlight.set(leaseId,work);
  try{return await work;}finally{phoneSyncInFlight.delete(leaseId);}
}


const phoneCleanupInFlight=new Map();
export async function advancePhoneSignout({env,enrollment,leaseId,webexFetch,orgId,phonismReader=createPhonismReader()}){
 if(phoneCleanupInFlight.has(leaseId))return phoneCleanupInFlight.get(leaseId);
 const work=(async()=>{
   const lease=await getLease(env,leaseId);
   if(!lease||lease.device?.mac!==enrollment.device.mac||String(lease.phonismPhoneId)!==String(enrollment.phonismPhoneId))throw new DeviceManagementError('phone-credential-invalid',403);
   if(!isPilotDevice(env,lease.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
   const until=Date.parse(lease.recovery?.phoneCleanupUntil||'');
   if(!lease.manualEndRequestedAt||!Number.isFinite(until)||Date.now()>=until-30000||
      !['active','restore-sync-pending','restore-reboot-pending','external-change-sync-pending','external-change-reboot-pending'].includes(lease.status))return;
   return sweepExpiredLeases({env,webexFetch,orgId,phonismReader,onlyLeaseId:leaseId,cleanupDeadline:until-10000});
 })();
 phoneCleanupInFlight.set(leaseId,work);
 try{return await work;}finally{phoneCleanupInFlight.delete(leaseId);}
}
