import fs from 'node:fs';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const {parse}=await import(process.env.ACORN_MODULE||'acorn');
const sha=s=>crypto.createHash('sha256').update(s).digest('hex');
export const BASE_HASH='c9badc1ae00518e60d3584d90ef39e7c7571f9ddc64d8da2f70a6cceceb2ae85';
const anchor='/** WEBEX DASHBOARD PRODUCTION ENDPOINTS **/';
const route='if (path === "/api/webex/abandoned-callback/settings" || path === "/api/webex/abandoned-callback/history" || path === "/api/webex/abandoned-callback/preview" || path === "/api/webex/abandoned-callback/schedule") {\n  return vbCallbackSettingsV1(request, env, cors);\n}\n\n';
const suffix='\n/* BEGIN ABANDONED CALLBACK SETTINGS V1 */\nimport {createCallbackSettingsHandler} from "./callback-settings/gateway.mjs";\nconst vbCallbackSettingsV1=createCallbackSettingsHandler({checkAccess,loadIpRules,getWebexQueueConfiguration,getAbandonedReport:env=>buildWebexDailyReportData(env,false)});\n/* END ABANDONED CALLBACK SETTINGS V1 */\n';
export function build(source) {
  if(sha(source)!==BASE_HASH)throw new Error('Exact verified R7 combined baseline required; do not overwrite a newer release.');
  if(source.split(anchor).length!==2||source.includes('vbCallbackSettingsV1'))throw new Error('Unexpected router structure.');
  const candidate=source.replace(anchor,route+anchor)+suffix;
  if(candidate.replace(route,'').slice(0,-suffix.length)!==source)throw new Error('Existing Worker bytes changed.');
  parse(candidate,{ecmaVersion:'latest',sourceType:'module'});
  const files=['callback-settings/policy.mjs','callback-settings/gateway.mjs','callback-settings/selection.mjs'];
  const modules=Object.fromEntries(files.map(f=>{const data=fs.readFileSync(new URL('../'+f,import.meta.url),'utf8');
    parse(data,{ecmaVersion:'latest',sourceType:'module'});return[f,{sha256:sha(data),content:data}];}));
  return {candidate,modules,proof:{baselineSha256:sha(source),candidateSha256:sha(candidate),
    modules:Object.fromEntries(Object.entries(modules).map(([k,v])=>[k,v.sha256])),
    originalBytesPreserved:true,requiredAdditionalBinding:'ABANDONED_CALLBACK_SETTINGS',
    preservation:'Existing 32 bindings and Worker behavior must be inherited unchanged; add only the verified external Durable Object binding. No callback execution or scheduled-handler changes.'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [sourcePath,out]=process.argv.slice(2);if(!sourcePath||!out)throw new Error('Usage: node builder private-baseline.mjs private-candidate.mjs');
  const result=build(fs.readFileSync(sourcePath,'utf8'));fs.writeFileSync(out,result.candidate,{mode:0o600});
  fs.writeFileSync(out+'.proof.json',JSON.stringify(result.proof,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(result.proof));
}
