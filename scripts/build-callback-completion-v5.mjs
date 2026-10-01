import fs from 'node:fs';
import crypto from 'node:crypto';
const {parse}=await import(process.env.ACORN_MODULE||'acorn');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export const BASE_HASH='a437ee2a790962266bd54a295ed18c195f114b675426ea605712bb0aec294481';
const suffix='\n/* BEGIN CALLBACK MANAGEMENT AND MAINTENANCE V5 */\nimport {createCallbackMaintenance} from "./callback-settings/maintenance.mjs";\nconst vbCallbackMaintenance=createCallbackMaintenance({getAbandonedReport:env=>buildWebexDailyReportData(env,false)});\n/* END CALLBACK MANAGEMENT AND MAINTENANCE V5 */\n';
export function build(source){
 if(hash(source)!==BASE_HASH||source.includes('vbCallbackMaintenance'))throw Error('Exact deployed callback workspace + R8 baseline is required.');
 const pattern=/if \(path === "\/api\/webex\/abandoned-callback\/settings"[^\n]+\) \{\n  return vbCallbackSettingsV1\(request, env, cors\);\n\}\n\n/g;
 const routes=[...source.matchAll(pattern)];if(routes.length!==1)throw Error('Expected one existing callback route block.');
 const oldRoute=routes[0][0],newRoute=oldRoute.replace(') {',' || path === "/api/webex/abandoned-callback/manage" || path === "/api/webex/abandoned-callback/management" || path === "/api/webex/abandoned-callback/automation-status" || path === "/api/webex/abandoned-callback/flow-policy") {');
 const oldHook='ctx.waitUntil(runAllScheduledTasks(env));',newHook=oldHook+'\n  ctx.waitUntil(vbCallbackMaintenance(env));';
 if(source.split(oldHook).length!==2)throw Error('Expected one existing scheduled-task invocation.');
 const candidate=source.replace(oldRoute,newRoute).replace(oldHook,newHook)+suffix;
 if(candidate.slice(0,-suffix.length).replace(newRoute,oldRoute).replace(newHook,oldHook)!==source)throw Error('Unrelated original Worker bytes changed.');
 parse(candidate,{ecmaVersion:'latest',sourceType:'module'});
 const files=['policy','gateway','selection','plans','planning-gateway','maintenance','flow-policy'];
 const modules=Object.fromEntries(files.map(n=>{const name='callback-settings/'+n+'.mjs',content=fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');parse(content,{ecmaVersion:'latest',sourceType:'module'});return [name,{content,sha256:hash(content)}];}));
 for(const [name,m]of Object.entries(modules))for(const node of parse(m.content,{ecmaVersion:'latest',sourceType:'module'}).body){if(node.type!=='ImportDeclaration')continue;const path=new URL(node.source.value,new URL('https://module.local/'+name)).pathname.slice(1);if(!modules[path])throw Error('Missing module: '+path);}
 return {candidate,modules,proof:{baselineSha256:hash(source),candidateSha256:hash(candidate),originalBytesRecoverable:true,existingScheduledTasksRetained:true,newAutomaticScanUsesExistingCron:true,moduleCount:Object.keys(modules).length,callingActivationUnchanged:true}};
}
