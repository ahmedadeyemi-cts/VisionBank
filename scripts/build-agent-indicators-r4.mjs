import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import{fileURLToPath}from'node:url';
export const BASE='c665176e-95c2-46af-a656-042479d12c2a';
export const BASE_HASH='7c9b7cd81544d0a2a15390cd068914746e3a6234463dff80c083151db77b624c';
export const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export function build(source,extension){
 if(sha(source)!==BASE_HASH)throw new Error('Source must match the current combined operations release.');
 if(!extension.startsWith('/* Agent indicator metadata only.')||source.includes('function vbIndicatorMetadata'))throw new Error('Wrong or duplicate indicator extension.');
 const start=source.indexOf('async function handleWebexDashboardSettingsSave('),end=source.indexOf('\n}',start)+2;
 if(start<0||end<=start)throw new Error('Settings handler boundaries missing.');
 const original=source.slice(start,end);
 const a='    const body = await request.json();',b='      queueVisibility,\n      updatedAt:';
 const x=a+'\n    if (!vbIndicatorValidSettings(body.agentStateIndicators)) return json({success:false,error:"invalid-agent-state-indicators"},cors,400);';
 const y='      queueVisibility,\n      agentStateIndicators: vbIndicatorSettings(body.agentStateIndicators, current.agentStateIndicators),\n      updatedAt:';
 if(original.split(a).length!==2||original.split(b).length!==2)throw new Error('Unexpected settings handler.');
 const modified=original.replace(a,x).replace(b,y);
 const result=source.slice(0,start)+modified+source.slice(end)+'\n'+extension+'\n';
 const restored=result.slice(0,-extension.length-2).replace(x,a).replace(y,b);
 if(restored!==source)throw new Error('Source preservation failed.');
 for(const p of ['/security/check','/api/webex/daily-reports','/api/webex/chat-reports'])if(source.split('path === "'+p+'"').length!==result.split('path === "'+p+'"').length)throw new Error('Existing route changed.');
 return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const[input,output]=process.argv.slice(2),root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 if(!input||!output||fs.existsSync(output))throw new Error('Supply retained source and a NEW output file.');
 const source=fs.readFileSync(input,'utf8'),ext=fs.readFileSync(path.join(root,'worker-patches/agent-indicators-r4.js'),'utf8');
 const candidate=build(source,ext);fs.writeFileSync(output,candidate,{mode:0o600,flag:'wx'});
 fs.writeFileSync(output+'.proof.json',JSON.stringify({baseVersion:BASE,baseSha256:BASE_HASH,candidateSha256:sha(candidate),extensionSha256:sha(ext),sourcePreservedExceptIndicatorSettings:true},null,2),{mode:0o600,flag:'wx'});
 console.log('PASS: current combined source retained; only indicator metadata and settings added.');
}
