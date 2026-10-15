const replace=(s,from,to)=>{if(!s.includes(from)||s.indexOf(from)!==s.lastIndexOf(from))throw Error('Directory integration marker missing or duplicated: '+from.slice(0,65));return s.replace(from,to);};
function functionReplace(s,name,replacement){const start=s.indexOf('async function '+name+'(');if(start<0)throw Error('Missing '+name);const next=s.indexOf('\n}',start);if(next<0)throw Error('Missing function end '+name);return s.slice(0,start)+replacement+s.slice(next+2);}
export function integrate(source){
 if(source.includes('VB_DIRECTORY_SYNC_V1'))throw Error('Already integrated');
 let s=source;
 s=replace(s,'  async scheduled(event, env, ctx) {','  async scheduled(event, env, ctx) {\n    if(event.cron === VB_DIRECTORY_CRON){ctx.waitUntil(vbRunDirectorySync(env,webexFetch).catch(e=>console.error("Directory sync failed",e.message)));return;}');
 s=replace(s,'if (path === "/api/directory/save" && method === "POST") {','if (path === "/api/directory/sync" && method === "POST") {\n  const access=await checkAccess(request,env);if(!access.allowed)return json({error:"access-denied"},cors,403);\n  try{return json(await vbRunDirectorySync(env,webexFetch),cors);}catch(e){return json({error:e.message},cors,e.status||503);}\n}\nif (path === "/api/directory/save" && method === "POST") {');
 s=replace(s,'if (path === "/api/directory/save" && method === "POST") return { roles: operators };','if (["/api/directory/save","/api/directory/sync"].includes(path) && method === "POST") return { roles: operators };');
 s=replace(s,'  ctx.waitUntil(reconcilePhoneEnrollments({env,webexFetch})','  ctx.waitUntil(vbInitializeDirectorySync(env,webexFetch).catch(e=>console.error("Initial directory sync failed",e.message)));\n  ctx.waitUntil(reconcilePhoneEnrollments({env,webexFetch})');
 s=functionReplace(s,'loadDirectoryContacts',`async function loadDirectoryContacts(env) {return (await vbDirectoryStoreRequest(env,'get')).contacts;}`);
 s=functionReplace(s,'handleGetDirectory',`async function handleGetDirectory(request,env,cors){const access=await checkAccess(request,env);if(!access.allowed)return json({error:'access-denied'},cors,403);return json(await vbDirectoryStoreRequest(env,'get'),cors);}`);
 // Retain the existing sanitization and access check on manual saves.
 s=replace(s,'          firstName,\n          lastName,','          webexDirectoryId:typeof c.webexDirectoryId === "string" ? c.webexDirectoryId.slice(0,300) : undefined,\n          firstName,\n          lastName,');
 s=replace(s,'  await env.DIRECTORY_KV.put(\n    DIRECTORY_KEY,\n    JSON.stringify(contacts)\n  );\n\n  return json({\n    success: true,\n    count: contacts.length,\n    contacts\n  }, cors);',`  try{return json(await vbDirectoryStoreRequest(env,'save',{contacts,revision:body.revision}),cors);}catch(e){return json({error:e.message},cors,e.status||503);}`);
 return s+`\n// VB_DIRECTORY_SYNC_V1\nimport {CRON as VB_DIRECTORY_CRON,runDirectorySync as vbRunDirectorySync,initializeDirectorySync as vbInitializeDirectorySync,storeRequest as vbDirectoryStoreRequest} from './directory-sync/sync.mjs';\n`;
}
export function integrateCompanion(s){
 if(s.includes('VBDirectoryStore'))throw Error('Already integrated');
 s=replace(s,'    this.storage = ctx.storage;\n    this.plans = new CallbackPlans(ctx.storage);','    this.storage = ctx.storage;\n    this.directory = new VBDirectoryStore(ctx,env);\n    this.plans = new CallbackPlans(ctx.storage);');
 s=replace(s,'      if (u.pathname === "/followups") {','      if (u.pathname.startsWith("/directory/")) return this.directory.fetch(request);\n      if (u.pathname === "/followups") {');
 return s+"\nimport {DirectoryStore as VBDirectoryStore} from './directory-sync/store.mjs';\n";
}
