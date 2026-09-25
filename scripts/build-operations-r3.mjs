import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const BASE='98cda4bf-1414-4d65-b3b3-b09c922d88a1';
export const BASE_HASH='c5ad308a9dbbb8e9549dd9c4d3ca03b8e7e7568cbac98a6fc92b7d8668750c73';
export const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export function build(source,extension){
  if(sha(source)!==BASE_HASH)throw new Error('Source is not the verified production Chat release. Reconcile first.');
  const start=source.indexOf('async function buildWebexDashboardData(env) {');
  const end=source.indexOf('async function handleWebexDashboard(',start);
  if(start<0||end<=start)throw new Error('Missing dashboard builder boundaries.');
  const old=source.slice(start,end);let edited=old;
  const guarded=edited.replace(/return \[\];/g,'return Object.assign([], {vbOpsUnavailable:true});');
  if((edited.match(/return \[\];/g)||[]).length!==3)throw new Error('Unexpected dashboard query failure handling.');
  edited=guarded;
  const result=source.slice(0,start)+edited+source.slice(end)+'\n'+extension+'\n';
  if(result.slice(0,-extension.length-2).replaceAll('return Object.assign([], {vbOpsUnavailable:true});','return [];')!==source)throw new Error('Preservation assertion failed.');
  return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const [input,output]=process.argv.slice(2);if(!input||!output||fs.existsSync(output))throw new Error('Supply baseline source and NEW candidate output.');
  const source=fs.readFileSync(input,'utf8'),ext=fs.readFileSync(path.join(ROOT,'worker-patches/agent-queue-state-r3.js'),'utf8');
  const result=build(source,ext);fs.writeFileSync(output,result,{flag:'wx',mode:0o600});
  fs.writeFileSync(output+'.proof.json',JSON.stringify({baseVersion:BASE,baseSha256:BASE_HASH,candidateSha256:sha(result),extensionSha256:sha(ext),originalPreservedExceptThreeDashboardErrorMarkers:true,productionChanged:false},null,2),{flag:'wx',mode:0o600});
  console.log('PASS: candidate built from exact running release; routes, authentication and scheduled handler retained.');
}
