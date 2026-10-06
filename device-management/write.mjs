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

function phonismLineMatchesTarget(lines=[],target=null){
  const line2=(Array.isArray(lines)?lines:[]).find(x=>Number(x?.lineNumber)===2)||null;
  if(!target)return !line2;
  if(!line2)return false;
  const targetName=clean(target.name||target.displayName||'',160).toLowerCase();
  const targetExtension=clean(target.extension||'',32).toLowerCase();
  const searchable=[line2.alias,line2.username,line2.broadworksUserId].map(x=>String(x||'').toLowerCase()).join(' ');
  return Boolean((targetName&&searchable.includes(targetName))||(targetExtension&&searchable.includes(targetExtension)));
}

async function waitForPhonismLine2({env,phonismReader,phoneId,target}){
  const delays=[0,350,800];
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

export async function applyWritePreview({env,request,session,webexFetch,orgId,mutationId,phonismReader=createPhonismReader()}){
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
  await putLease(env,lease);

  let rebootQueued=false,rebootError=null;
  if(pc.phoneId){
    const syncConfirmation=await waitForPhonismLine2({
      env,phonismReader,phoneId:pc.phoneId,target:preview.targetMember
    });
    const rebootAt=new Date().toISOString();
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
        change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},
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
  const current=await readWebexMembers(webexFetch,env,orgId,lease.device.id);
  const webexLine2=line2SummaryFromMembers(current.members);
  const removingLine2=!lease.temporaryLine2;
  const targetId=String(lease.temporaryLine2?.memberId||'');
  const webexMatches=removingLine2?!webexLine2:String(webexLine2?.memberId||'')===targetId;

  let phonismLine2=null;
  if(lease.phonismPhoneId){
    try{
      const lines=await phonismReader.lines(env,lease.phonismPhoneId);
      phonismLine2=lines.find(x=>x.lineNumber===2)||null;
    }catch{}
  }

  const targetName=clean(lease.temporaryLine2?.name||'',160).toLowerCase();
  const phonismPresent=removingLine2?!phonismLine2:(Boolean(phonismLine2)&&(!targetName||String(phonismLine2.alias||'').toLowerCase().includes(targetName)));
  const phonismRegistration=removingLine2?'removed':(phonismLine2?.registrationStatus||'pending');
  const configConverged=webexMatches&&phonismPresent;

  let state='pending-verification';
  if(configConverged&&lease.recovery?.rebootAttempted===true){
    if(removingLine2||phonismRegistration==='registered')state='applied';
    else if(phonismRegistration==='not-monitored')state='applied-unverified';
    else if(phonismRegistration==='unregistered')state='registration-failed';
  }else if(configConverged&&lease.recovery?.autoRebootFailed===true){
    state='reboot-failed';
  }else if(configConverged){
    state='reboot-pending';
  }

  lease.verification={
    webex:webexMatches?'confirmed':'pending',
    phonism:phonismPresent?phonismRegistration:'pending',
    state,lastCheckedAt:new Date().toISOString()
  };
  if(configConverged)lease.status='active';
  await putLease(env,lease);
  return {lease,webexLine2,phonismLine2,state};
}

export async function runRecoveryAction({env,request,session,leaseId,phonismReader=createPhonismReader()}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(!isPilotDevice(env,lease.device.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  const result=await phonismReader.tr069Action(env,lease.phonismPhoneId,'Reboot');
  const rebootAt=new Date().toISOString();
  lease.recovery={...(lease.recovery||{}),rebootAttempted:true,rebootAt,automaticReboot:false};
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

async function queueRestoreReboot({env,lease,phonismReader,now}){
  if(!lease.phonismPhoneId)return {queued:false,error:'phonism-phone-required'};
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

async function queueExternalReboot({env,lease,phonismReader,now}){
  if(!lease.phonismPhoneId)return {queued:false,error:'phonism-phone-required'};
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

async function finishExternalReconcile({env,lease,phonismReader,now}){
  const reboot=await queueExternalReboot({env,lease,phonismReader,now});
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

export async function endTemporaryLease({env,request,session,webexFetch,orgId,leaseId,phonismReader=createPhonismReader(),now=Date.now()}){
  const lease=await getLease(env,leaseId);
  if(!lease)throw new DeviceManagementError('lease-not-found',404);
  if(lease.status!=='active')throw new DeviceManagementError('lease-not-active',409);
  if(!isPilotDevice(env,lease.device?.mac))throw new DeviceManagementError('device-write-not-enabled',403);
  lease.manualEndRequestedAt=new Date(now).toISOString();
  lease.manualEndRequestedBy={
    type:session?.actorType==='device'?'device':'human',
    name:clean(session?.operator?.name||'',100),
    email:clean(session?.operator?.email||'',254)
  };
  lease.expiresAt=new Date(now).toISOString();
  await putLease(env,lease);
  await writeAuditRecord(env,buildAuditRecord({
    eventType:'temporary-line-signout',action:'signout-requested',request,session,
    device:lease.device,location:lease.location,
    change:{leaseId:lease.leaseId,temporaryLine2:lease.temporaryLine2},
    reason:'Phone user requested early sign out of the temporary Line 2 assignment.',
    webexStatus:'pending-restore',phonismStatus:'pending-sync',result:'pending',originalAuditId:lease.auditId,now
  }));
  const results=await sweepExpiredLeases({env,webexFetch,orgId,phonismReader,now,onlyLeaseId:lease.leaseId});
  const result=results.find(row=>String(row.leaseId)===String(lease.leaseId));
  if(!result)throw new DeviceManagementError('temporary-line-signout-not-completed',503);
  return {result,lease:await getLease(env,lease.leaseId)};
}

export async function sweepExpiredLeases({env,webexFetch,orgId,phonismReader=createPhonismReader(),now=Date.now(),onlyLeaseId=null}){
  const leases=await listLeases(env,{limit:1000});
  const results=[];
  for(const lease of leases){
    if(onlyLeaseId&&String(lease.leaseId)!==String(onlyLeaseId))continue;
    const expires=Date.parse(lease.expiresAt||'');
    if(!Number.isFinite(expires)||expires>now)continue;

    if(lease.status==='external-change-reboot-pending'){
      results.push(await finishExternalReconcile({env,lease,phonismReader,now}));
      continue;
    }

    if(lease.status==='external-change-sync-pending'){
      try{
        await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
          tenantId:lease.phonismTenantId,
          assetTypes:['People','Workspace','Device']
        });
        results.push(await finishExternalReconcile({env,lease,phonismReader,now}));
      }catch(error){
        lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-failed',state:'external-change-sync-pending',lastCheckedAt:new Date(now).toISOString()};
        await putLease(env,lease);
        results.push({leaseId:lease.leaseId,status:'external-change-sync-pending',error:error.code||'sync-failed'});
      }
      continue;
    }

    if(lease.status==='restore-reboot-pending'){
      const reboot=await queueRestoreReboot({env,lease,phonismReader,now});
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
        await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
          tenantId:lease.phonismTenantId,
          assetTypes:['People','Workspace','Device']
        });
        const reboot=await queueRestoreReboot({env,lease,phonismReader,now});
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
          await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
            tenantId:lease.phonismTenantId,
            assetTypes:['People','Workspace','Device']
          });
          results.push(await finishExternalReconcile({env,lease,phonismReader,now}));
        }catch(error){
          lease.status='external-change-sync-pending';
          lease.verification={...(lease.verification||{}),webex:'external-change-preserved',phonism:'sync-failed',state:'external-change-sync-pending',lastCheckedAt:new Date(now).toISOString()};
          await putLease(env,lease);
          results.push({leaseId:lease.leaseId,status:'external-change-sync-pending',error:error.code||'sync-failed'});
        }
        continue;
      }

      const restored=restoreMembers(current.members,lease.baselineMember||null);
      await writeWebexMembers(webexFetch,env,orgId,lease.device.id,restored);
      try{
        await phonismReader.syncHierarchyIntegration(env,lease.phonismCompanyId,{
          tenantId:lease.phonismTenantId,
          assetTypes:['People','Workspace','Device']
        });
        const reboot=await queueRestoreReboot({env,lease,phonismReader,now});
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
