import fs from 'node:fs';
import crypto from 'node:crypto';

const ACCOUNT='8e3117e5e935059805f98211f6868c9c';
const WORKER='visionbank-security';
const EXPECTED_BASE='35421361-f07c-4922-b16e-66e7377c6881';
const EXPECTED_BINDINGS=41;
const EXPECTED_MODULES=25;
const EXPECTED_MAIN='586437ccf6ef08547aaccb54299db298cb2c47b43d63de562d4e9cea1c0ab900';
const EXPECTED_GATEWAY='39df292dccd99b500f132328870b4bf4ed740021284621de958c183537833c46';
const EXPECTED_OLD_PHONE='8f017457c79672c404e31175bf4385b4b02bb5945faf0b66b9949891c52360a7';
const EXPECTED_OLD_WRITE='f9588cff4c5c366b1de420066dfd5bbb26a1ac2ba8d7cacfd1846db259ac9029';

const token=process.env.CLOUDFLARE_API_TOKEN||'';
if(!token)throw new Error('CLOUDFLARE_API_TOKEN is not configured in GitHub Actions secrets.');

const apiBase='https://api.cloudflare.com/client/v4/accounts/'+ACCOUNT;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const shaB64=v=>sha(Buffer.from(v,'base64'));
const hashes=w=>Object.fromEntries((w.modules||[]).map(m=>[m.name,shaB64(m.content_base64)]));
const bindingSig=w=>(w.bindings||[]).map(b=>String(b.name)+':'+String(b.type)).sort().join('|');
const need=(v,m)=>{if(!v)throw new Error(m);};

async function cf(path,method='GET',body=null){
  const res=await fetch(apiBase+path,{
    method,
    headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    body:body===null?undefined:JSON.stringify(body)
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data?.success===false){
    const errors=Array.isArray(data?.errors)?data.errors.map(e=>e.message||e.code).join(' | '):'';
    throw new Error('Cloudflare '+method+' '+path+' failed HTTP '+res.status+(errors?': '+errors:''));
  }
  return data?.result??data;
}

async function deployment(){
  return cf('/workers/scripts/'+WORKER+'/deployments');
}
function deploymentVersions(dep){
  if(Array.isArray(dep?.versions))return dep.versions;
  if(Array.isArray(dep?.deployments)&&dep.deployments[0]?.versions)return dep.deployments[0].versions;
  return [];
}
async function active(){
  const dep=await deployment();
  const rows=deploymentVersions(dep).filter(v=>Number(v.percentage)===100&&v.version_id);
  need(rows.length===1,'Expected exactly one 100% Worker version; found '+rows.length);
  return rows[0].version_id;
}
async function getVersion(id){
  return cf('/workers/workers/'+WORKER+'/versions/'+id+'?include=modules');
}
async function deploy(id,message){
  return cf('/workers/scripts/'+WORKER+'/deployments','POST',{
    strategy:'percentage',
    versions:[{version_id:id,percentage:100}],
    annotations:{'workers/message':message}
  });
}
function runtimeSettings(live){
  const out={};
  for(const key of ['compatibility_date','compatibility_flags','usage_model','placement','limits','tail_consumers','observability']){
    if(live?.[key]!==undefined&&live?.[key]!==null)out[key]=live[key];
  }
  return out;
}

console.log('=== GITHUB ACTIONS TEMPORARY HANDOFF RELEASE ===');
const baseId=await active();
need(baseId===EXPECTED_BASE,'STOP: Production drifted. Expected '+EXPECTED_BASE+', found '+baseId);

const live=await getVersion(baseId);
need(Array.isArray(live.modules),'Active version did not return modules.');
need(Array.isArray(live.bindings),'Active version did not return bindings.');
need(live.modules.length===EXPECTED_MODULES,'Expected '+EXPECTED_MODULES+' modules, found '+live.modules.length);
need(live.bindings.length===EXPECTED_BINDINGS,'Expected '+EXPECTED_BINDINGS+' bindings, found '+live.bindings.length);

const old=hashes(live);
need(old[live.main_module]===EXPECTED_MAIN,'Main Worker hash changed.');
need(old['device-management/gateway.mjs']===EXPECTED_GATEWAY,'Gateway hash changed.');
need(old['device-management/phone-selfservice.mjs']===EXPECTED_OLD_PHONE,'Phone module base hash changed.');
need(old['device-management/write.mjs']===EXPECTED_OLD_WRITE,'Write module base hash changed.');

const phone=fs.readFileSync('device-management/phone-selfservice.mjs');
const write=fs.readFileSync('device-management/write.mjs');
const phoneText=phone.toString('utf8'),writeText=write.toString('utf8');
need(phoneText.includes('const DURATIONS=[540,10080,43200];'),'15-minute removal contract missing.');
need(writeText.includes("syncAssetTypes=handoffs.length?['People','Workspace','Device']:['Device']"),'Handoff full-sync contract missing.');
need(writeText.includes("syncStrategy:handoffs.length?'handoff-full':'device-first'"),'Handoff recovery strategy missing.');

const newPhone=sha(phone),newWrite=sha(write);
console.log('Base:',baseId);
console.log('New phone:',newPhone);
console.log('New write:',newWrite);

const modules=live.modules.map(m=>{
  if(m.name==='device-management/phone-selfservice.mjs')return {...m,content_base64:phone.toString('base64')};
  if(m.name==='device-management/write.mjs')return {...m,content_base64:write.toString('base64')};
  return m;
});
const schedulesBefore=await cf('/workers/scripts/'+WORKER+'/schedules');

const body={
  ...runtimeSettings(live),
  main_module:live.main_module,
  modules,
  bindings:live.bindings.map(b=>({name:b.name,type:'inherit',version_id:baseId})),
  annotations:{
    'workers/tag':'handoff-destination-provisioning',
    'workers/message':'Full destination provisioning for temporary handoff; remove 15-minute option'
  }
};
console.log('Creating zero-traffic candidate...');
const candidate=await cf('/workers/workers/'+WORKER+'/versions?deploy=false','POST',body);
need(candidate?.id,'Cloudflare returned no candidate version ID.');
const candidateId=candidate.id;
console.log('Candidate:',candidateId,'(0% traffic)');

const cand=await getVersion(candidateId);
need(cand.modules.length===EXPECTED_MODULES,'Candidate module count changed.');
need(cand.bindings.length===EXPECTED_BINDINGS,'Candidate binding count changed.');
need(bindingSig(cand)===bindingSig(live),'Candidate binding signature changed.');
need(cand.main_module===live.main_module,'Candidate main module changed.');
const ch=hashes(cand);
for(const [name,hash] of Object.entries(old)){
  let expected=hash;
  if(name==='device-management/phone-selfservice.mjs')expected=newPhone;
  if(name==='device-management/write.mjs')expected=newWrite;
  need(ch[name]===expected,'Unexpected candidate module difference: '+name);
}
need(await active()===baseId,'Production changed during candidate validation.');
console.log('Candidate validation passed; Production unchanged.');

console.log('Promoting candidate...');
await deploy(candidateId,'Deploy full destination provisioning for temporary handoff');
await wait(10000);

try{
  need(await active()===candidateId,'Candidate did not become the sole 100% version.');
  const after=await getVersion(candidateId);
  const ah=hashes(after);
  need(after.modules.length===EXPECTED_MODULES,'Post-deploy module count changed.');
  need(after.bindings.length===EXPECTED_BINDINGS,'Post-deploy binding count changed.');
  need(bindingSig(after)===bindingSig(live),'Post-deploy binding signature changed.');
  need(ah[after.main_module]===EXPECTED_MAIN,'Main Worker changed.');
  need(ah['device-management/gateway.mjs']===EXPECTED_GATEWAY,'Gateway changed.');
  need(ah['device-management/phone-selfservice.mjs']===newPhone,'Phone module mismatch.');
  need(ah['device-management/write.mjs']===newWrite,'Write module mismatch.');
  for(const [name,hash] of Object.entries(old)){
    if(['device-management/phone-selfservice.mjs','device-management/write.mjs'].includes(name))continue;
    need(ah[name]===hash,'Unrelated module changed: '+name);
  }
  const schedulesAfter=await cf('/workers/scripts/'+WORKER+'/schedules');
  need(JSON.stringify(schedulesBefore)===JSON.stringify(schedulesAfter),'Cron schedules changed.');

  console.log('==============================================');
  console.log('HANDOFF DESTINATION PROVISIONING VERIFIED');
  console.log('==============================================');
  console.log('Previous:',baseId);
  console.log('Current: ',candidateId);
  console.log('Traffic: 100%');
  console.log('Bindings:',EXPECTED_BINDINGS);
  console.log('Modules:',EXPECTED_MODULES);
  console.log('Main/Gateway/Cron: preserved');
  console.log('15-minute option: removed');
  console.log('Temporary handoff destination sync: People + Workspace + Device');
}catch(error){
  console.error('Post-deploy validation failed:',error.message);
  console.error('Rolling back to',baseId);
  await deploy(baseId,'Automatic rollback after handoff destination provisioning validation failure');
  await wait(10000);
  need(await active()===baseId,'CRITICAL: rollback verification failed.');
  throw error;
}
