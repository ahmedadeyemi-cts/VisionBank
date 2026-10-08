import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';

const EXPECTED_BASE='d09cbec9-2599-4afc-9220-aa763f62e2d5';
const EXPECTED_BINDINGS=39;
const EXPECTED_MODULES=17;
const EXPECTED_MAIN='0d45caa6cf2b857b8329b9bbb08f236e17371204fbef62b8934ff466989915eb';
const EXPECTED_OLD_GATEWAY='1f4a7754c05135604d2bcb12a81b9c8398c27ee3e7284c00a7594c12b1a61c8a';
const EXPECTED_OLD_PHONE='05f639414eeb5635ce8bfeb724dccd6ea677a84c93dc302ec8068138036b3701';
const EXPECTED_WRITE='2f7bcd6d6c6a2fef95353715a2f71ce2edd01f81e97ae3a8ddcb45c5701fa4f8';
const REQUIRED_MAIN_COMMIT='7fdd1dd63d02e50871b56a0c90e55cc42ee55b79';
const RENDER_ORIGIN='https://visionbank-dashboard.onrender.com';

const here=path.dirname(fileURLToPath(import.meta.url));
const repoRoot=path.resolve(here,'..');
const helperRoot=path.join(os.homedir(),'visionbank-abandoned-callback-settings-20260930','private');
const releaseCommonPath=path.join(helperRoot,'release-common.mjs');
const runtimeHelperPath=path.join(os.homedir(),'Downloads','visionbank-chat-integrated-update','upload-chat.mjs');
const gatewayPath=path.join(repoRoot,'device-management','gateway.mjs');
const phonePath=path.join(repoRoot,'device-management','phone-selfservice.mjs');

function need(value,message){if(!value)throw new Error(message);}
const sha=value=>crypto.createHash('sha256').update(value).digest('hex');
const fromB64=value=>Buffer.from(value,'base64');
const hashes=worker=>Object.fromEntries((worker.modules||[]).map(m=>[m.name,sha(fromB64(m.content_base64))]));
const bindingSignature=worker=>(worker.bindings||[]).map(b=>String(b.name)+':'+String(b.type)).sort().join('|');
const active100=dep=>{
  const rows=(dep.versions||[]).filter(v=>Number(v.percentage)===100&&v.version_id);
  need(rows.length===1,'Expected exactly one 100% Production version; found '+rows.length);
  return rows[0].version_id;
};
const shell=(cmd,args,options={})=>execFileSync(cmd,args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:20*1024*1024,...options}).trim();

function verifyRepoCommit(){
  shell('git',['-C',repoRoot,'merge-base','--is-ancestor',REQUIRED_MAIN_COMMIT,'HEAD']);
}
async function loadHelpers(){
  need(fs.existsSync(releaseCommonPath),'Missing local release helper: '+releaseCommonPath);
  need(fs.existsSync(runtimeHelperPath),'Missing runtime settings helper: '+runtimeHelperPath);
  const common=await import(pathToFileURL(releaseCommonPath).href);
  const runtime=await import(pathToFileURL(runtimeHelperPath).href);
  need(typeof common.client==='function'&&typeof common.deployment==='function'&&typeof common.version==='function','release-common exports are incomplete');
  need(typeof runtime.runtimeSettings==='function','runtimeSettings export is missing');
  return {...common,runtimeSettings:runtime.runtimeSettings};
}
async function promote(cf,MAIN,versionId,message){
  await cf('/workers/scripts/'+MAIN+'/deployments','POST',{
    strategy:'percentage',
    versions:[{version_id:versionId,percentage:100}],
    annotations:{'workers/message':message}
  });
}
function kvGet(namespaceId,key){
  return shell('npx',['wrangler','kv','key','get','--namespace-id='+namespaceId,key,'--text','--remote']);
}
function kvList(namespaceId,prefix){
  return JSON.parse(shell('npx',['wrangler','kv','key','list','--namespace-id='+namespaceId,'--prefix='+prefix,'--remote']));
}
function compactMac(value){
  return String(value||'').replace(/[^0-9a-f]/gi,'').toLowerCase();
}
function decodeXml(value=''){
  return String(value).replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'");
}
function menuItems(xml=''){
  const out=[];
  const re=/<MenuItem>[\s\S]*?<Prompt>([\s\S]*?)<\/Prompt>[\s\S]*?<URI>([\s\S]*?)<\/URI>[\s\S]*?<\/MenuItem>/gi;
  for(const match of xml.matchAll(re))out.push({prompt:decodeXml(match[1]).trim(),uri:decodeXml(match[2]).trim()});
  return out;
}
async function getXml(url,ua){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(url,{redirect:'follow',signal:controller.signal,headers:{'User-Agent':ua,'Accept':'application/xml,text/xml,*/*'}});
    return {status:response.status,text:await response.text(),url:response.url};
  }finally{clearTimeout(timer);}
}
async function syntheticFleetCheck(worker){
  const logs=(worker.bindings||[]).find(b=>b.name==='LOGS');
  const namespaceId=logs?.namespace_id||logs?.namespaceId||logs?.id;
  need(namespaceId,'LOGS KV namespace ID was not returned');

  const fleet=JSON.parse(kvGet(namespaceId,'device-phone-fleet-keys:v1'));
  const active=(fleet.keys||[]).find(row=>row.id===fleet.activeKeyId&&row.status==='active'&&row.secret);
  need(active?.secret,'No active Fleet Key found');

  const enrollmentKeys=kvList(namespaceId,'device-phone-enrollment:');
  const enrollments=[];
  for(const key of enrollmentKeys){
    try{
      const row=JSON.parse(kvGet(namespaceId,key.name));
      if(row?.status==='active'&&row?.authMode==='fleet-template'&&row?.device?.mac)enrollments.push(row);
    }catch{}
  }
  need(enrollments.length>0,'No active fleet-template phones were found');

  const branches=[
    {name:'T54W/Render-sticky',ua:'Yealink SIP-T54W'},
    {name:'T57W-T53/direct-Worker',ua:'Yealink SIP-T57W'}
  ];

  for(const enrollment of enrollments){
    const mac=compactMac(enrollment.device.mac);
    need(mac,'Enrollment contains no valid MAC');
    const entry=RENDER_ORIGIN+'/x/'+active.secret+'/'+mac;
    for(const branch of branches){
      const home=await getXml(entry,branch.ua);
      need(home.status===200,'Synthetic '+branch.name+' Button 7 failed HTTP '+home.status+' for MAC *'+mac.slice(-4));
      need(/VisionBank Manage Extensions/i.test(home.text),'Synthetic '+branch.name+' Button 7 returned unexpected XML for MAC *'+mac.slice(-4));
      const items=menuItems(home.text);
      const refresh=items.find(row=>/^Refresh$/i.test(row.prompt));
      need(refresh?.uri,'Synthetic '+branch.name+' Refresh URI missing for MAC *'+mac.slice(-4));
      const refreshed=await getXml(refresh.uri,branch.ua);
      need(refreshed.status===200&&/VisionBank Manage Extensions/i.test(refreshed.text),'Synthetic '+branch.name+' Refresh failed for MAC *'+mac.slice(-4));
      const add=items.find(row=>/Add Temporary Extension/i.test(row.prompt));
      if(add?.uri){
        const input=await getXml(add.uri,branch.ua);
        need(input.status===200&&/Add Temporary Extension/i.test(input.text),'Synthetic '+branch.name+' Add Temporary Extension title failed for MAC *'+mac.slice(-4));
        need(/Extension or phone number/i.test(input.text),'Synthetic '+branch.name+' extension input failed for MAC *'+mac.slice(-4));
      }else{
        need(items.some(row=>/Sign Out Temporary Line/i.test(row.prompt)),'Synthetic '+branch.name+' menu has neither Add nor active lease for MAC *'+mac.slice(-4));
      }
    }
  }
  return {phones:enrollments.length,branches:branches.length};
}

verifyRepoCommit();
const {client,deployment,version,MAIN,runtimeSettings}=await loadHelpers();
const cf=await client();

console.log('');
console.log('=== YEALINK POST-SAVE WAIT SCREEN GUARDED RELEASE ===');
const beforeDep=await deployment(cf);
const base=active100(beforeDep);
need(base===EXPECTED_BASE,'STOP: Production drifted. Expected '+EXPECTED_BASE+', found '+base);

const live=await version(cf,base);
need(live.bindings?.length===EXPECTED_BINDINGS,'STOP: Expected '+EXPECTED_BINDINGS+' bindings, found '+live.bindings?.length);
need(live.modules?.length===EXPECTED_MODULES,'STOP: Expected '+EXPECTED_MODULES+' modules, found '+live.modules?.length);

const liveHashes=hashes(live);
need(liveHashes[live.main_module]===EXPECTED_MAIN,'STOP: Production main module changed unexpectedly');
need(liveHashes['device-management/gateway.mjs']===EXPECTED_OLD_GATEWAY,'STOP: Production gateway changed unexpectedly');
need(liveHashes['device-management/phone-selfservice.mjs']===EXPECTED_OLD_PHONE,'STOP: Production phone-selfservice changed unexpectedly');
need(liveHashes['device-management/write.mjs']===EXPECTED_WRITE,'STOP: Production write/reboot module changed unexpectedly');

const gateway=fs.readFileSync(gatewayPath);
const phone=fs.readFileSync(phonePath);
const gatewayText=gateway.toString('utf8');
const phoneText=phone.toString('utf8');

need(gatewayText.includes('Wait 5 seconds while we reboot your phone.'),'STOP: expected reboot wait message missing from gateway');
need(gatewayText.includes("prompt:'Add Temporary Extension'"),'STOP: Add Temporary Extension wording missing');
need(phoneText.includes('YealinkIPPhoneTextScreen'),'STOP: Yealink TextScreen renderer missing');
need(phoneText.includes('LockIn=\\\"'),'STOP: TextScreen LockIn support missing');

const expectedNew={
  'device-management/gateway.mjs':sha(gateway),
  'device-management/phone-selfservice.mjs':sha(phone)
};

console.log('Base Production:',base);
console.log('Main preserved:',EXPECTED_MAIN);
console.log('New gateway:',expectedNew['device-management/gateway.mjs']);
console.log('New phone:',expectedNew['device-management/phone-selfservice.mjs']);
console.log('Write preserved:',EXPECTED_WRITE);

const modules=live.modules.map(module=>{
  if(module.name==='device-management/gateway.mjs')return {...module,content_base64:gateway.toString('base64')};
  if(module.name==='device-management/phone-selfservice.mjs')return {...module,content_base64:phone.toString('base64')};
  return module;
});

console.log('');
console.log('Creating zero-traffic candidate...');
const created=await cf('/workers/workers/'+MAIN+'/versions?deploy=false','POST',{
  ...runtimeSettings(live),
  compatibility_flags:live.compatibility_flags,
  main_module:live.main_module,
  modules,
  bindings:live.bindings.map(binding=>({name:binding.name,type:'inherit',version_id:base})),
  annotations:{
    'workers/tag':'yealink-save-wait-screen',
    'workers/message':'Yealink Save wait screen and Add Temporary Extension wording'
  }
});
need(created?.id,'Cloudflare returned no candidate version ID');
const candidateId=created.id;
console.log('Candidate:',candidateId,'(0% traffic)');

const candidate=await version(cf,candidateId);
const candidateHashes=hashes(candidate);
need(candidate.bindings?.length===EXPECTED_BINDINGS,'Candidate binding count changed');
need(candidate.modules?.length===EXPECTED_MODULES,'Candidate module count changed');
need(bindingSignature(candidate)===bindingSignature(live),'Candidate binding signature changed');
need(candidate.compatibility_date===live.compatibility_date,'Candidate compatibility date changed');
need(JSON.stringify([...(candidate.compatibility_flags||[])].sort())===JSON.stringify([...(live.compatibility_flags||[])].sort()),'Candidate compatibility flags changed');
need(candidate.main_module===live.main_module,'Candidate main module name changed');

for(const [name,hash] of Object.entries(liveHashes)){
  const expected=expectedNew[name]||hash;
  need(candidateHashes[name]===expected,'Unexpected candidate module difference: '+name);
}
need(candidateHashes[live.main_module]===EXPECTED_MAIN,'Candidate changed main Worker');
need(candidateHashes['device-management/write.mjs']===EXPECTED_WRITE,'Candidate changed write/reboot module');

const stillBase=active100(await deployment(cf));
need(stillBase===base,'Production changed while candidate was being validated');
console.log('Candidate validation passed; Production still unchanged.');

const cronBefore=await cf('/workers/scripts/'+MAIN+'/schedules');
console.log('');
console.log('Promoting candidate to 100%...');
await promote(cf,MAIN,candidateId,'Deploy Yealink post-Save wait screen');

const promotedId=active100(await deployment(cf));
if(promotedId!==candidateId){
  await promote(cf,MAIN,base,'Automatic rollback after Yealink wait-screen promotion verification failure');
  need(active100(await deployment(cf))===base,'CRITICAL: rollback failed after promotion mismatch');
  throw new Error('Promotion verification failed; rolled back to '+base);
}

try{
  const after=await version(cf,candidateId);
  const afterHashes=hashes(after);
  need(after.bindings?.length===EXPECTED_BINDINGS,'Post-deploy binding count changed');
  need(after.modules?.length===EXPECTED_MODULES,'Post-deploy module count changed');
  need(bindingSignature(after)===bindingSignature(live),'Post-deploy binding signature changed');
  for(const [name,hash] of Object.entries(candidateHashes))need(afterHashes[name]===hash,'Post-deploy module mismatch: '+name);
  need(afterHashes[after.main_module]===EXPECTED_MAIN,'Post-deploy main Worker changed');
  need(afterHashes['device-management/write.mjs']===EXPECTED_WRITE,'Post-deploy write/reboot module changed');
  const cronAfter=await cf('/workers/scripts/'+MAIN+'/schedules');
  need(JSON.stringify(cronBefore)===JSON.stringify(cronAfter),'Cron schedule changed');

  console.log('Running live read-only Button 7 checks...');
  const synthetic=await syntheticFleetCheck(after);
  console.log('Synthetic checks passed:',synthetic.phones,'enrolled phones x',synthetic.branches,'routing branches.');
}catch(error){
  console.error('Post-deploy validation failed:',error.message);
  console.error('Rolling back to',base);
  await promote(cf,MAIN,base,'Automatic rollback after Yealink wait-screen post-deploy validation failure');
  need(active100(await deployment(cf))===base,'CRITICAL: rollback verification failed');
  throw new Error('Wait-screen validation failed and Production was rolled back: '+error.message);
}

console.log('');
console.log('==============================================');
console.log('YEALINK POST-SAVE WAIT SCREEN VERIFIED');
console.log('==============================================');
console.log('Previous:',base);
console.log('Current: ',candidateId);
console.log('Traffic: 100%');
console.log('Bindings:',EXPECTED_BINDINGS);
console.log('Modules:',EXPECTED_MODULES);
console.log('Main: preserved');
console.log('Write/reboot module: preserved');
console.log('Cron: preserved');
console.log('Button 7 read paths: verified');
console.log('Step 2 label: Add Temporary Extension');
console.log('Post-Save display: Wait 5 seconds while we reboot your phone.');
console.log('Post-Save menu items: none');
