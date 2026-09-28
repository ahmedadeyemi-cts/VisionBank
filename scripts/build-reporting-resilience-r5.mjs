import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {parse}=await import(process.env.ACORN_MODULE || 'acorn');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export const BASE_HASH='23e48e129e366270fc3d8f2fc843f84ed2ef283a32caa4766e2fd3cb2af6bc10';
export const parseCode=s=>parse(s,{ecmaVersion:'latest',sourceType:'module'});
export function build(source,extension){
  if(hash(source)!==BASE_HASH)throw new Error('Exact deployed combined baseline required.');
  const ast=parseCode(source),defs=new Map(ast.body.filter(x=>x.type==='FunctionDeclaration').map(x=>[x.id.name,x]));
  const sourceOf=name=>{const f=defs.get(name);if(!f)throw new Error('Missing function '+name);return source.slice(f.start,f.end);};
  const derived=[];
  for(const [old,next] of [['fetchWebexTasks','vbRepFetchTasks'],['fetchWebexTaskLegs','vbRepFetchLegs'],['fetchWebexAgentSessions','vbRepFetchAgents']]){
    let code=sourceOf(old).replace('function '+old+'(','function '+next+'(').replace('return webexSearchPaged(','return vbRepPaged(');
    if(old==='fetchWebexAgentSessions'){
      const mark='${paginationArgument(cursor)}';
      if(!code.includes(mark))throw new Error('Agent query anchor missing.');
      code=code.replace(mark,'filter: { isActive: { equals: true } }\n          '+mark);
    }
    derived.push(code);
  }
  let main=sourceOf('buildWebexDashboardData');
  const start=main.indexOf('const now = Date.now();'),end=main.indexOf('\n  })();');
  if(start<0||end<start)throw new Error('Dashboard build structure changed.');
  main=main.slice(start,end);
  const edits=[
    ['fetchWebexTasks','vbRepFetchTasks'],['fetchWebexTaskLegs','vbRepFetchLegs'],['fetchWebexAgentSessions','vbRepFetchAgents']
  ];
  for(const[old,next]of edits){
    const re=new RegExp(old+'\\(env, ([^)]+)\\)\\.catch\\(err => \\{[\\s\\S]*?return Object.assign\\(\\[\\], \\{vbOpsUnavailable:true\\}\\);\\n      \\}\\)');
    if(!re.test(main))throw new Error('Required query catch anchor changed: '+old);
    main=main.replace(re,next+'(env, $1)');
  }
  main=main.replace('getWebexQueueConfiguration(env);','vbRepBound(getWebexQueueConfiguration(env), Date.now()+35000);')
    .replace('getWebexDashboardSettings(env);','vbRepBound(getWebexDashboardSettings(env), Date.now()+35000);')
    .replace('build: WEBEX_DASHBOARD_BUILD,','build: WEBEX_DASHBOARD_BUILD,\n      reportingRevision: VB_REPORTING_R5,\n      reportingDiagnostics: {elapsedMs:Date.now()-requestStarted,activeAgentSessionsOnly:true,queryBudgetMs:35000},');
  derived.push('async function vbRepBuildUncached(env) {\nconst requestStarted=Date.now();\n'+main+'\n}');
  derived.push("buildWebexDashboardData=env=>vbRepCached(env,'dashboard',5000,()=>vbRepBuildUncached(env));");
  let retained=source;
  const needle='ttlMs: 15000, budgetMs: 20000, maxPages: 40, maxRows: 10000,';
  if(retained.split(needle).length!==2)throw new Error('Chat budget anchor changed.');
  retained=retained.replace(needle,needle.replace('20000','35000'));
  const outer="setTimeout(()=>reject(new Error('chat-timeout')),21000)";
  if(retained.split(outer).length!==3)throw new Error('Chat response timers changed.');
  retained=retained.replaceAll(outer,outer.replace('21000','40000'));
  const candidate=retained+'\n/* BEGIN REPORTING RESILIENCE R5 */\n'+extension+'\n'+derived.join('\n\n')+'\n/* END REPORTING RESILIENCE R5 */\n';
  const nextAst=parseCode(candidate);
  const counts={};
  const walk=n=>{if(!n||typeof n!=='object')return;
    if(n.type==='IfStatement'){
      const t=candidate.slice(n.test.start,n.test.end);
      for(const route of ['/security/check','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/dashboard']){
        if(t.includes('path === "'+route+'"')&&t.includes('method === "GET"'))counts[route]=(counts[route]||0)+1;
      }
    }
    for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);
  };walk(nextAst);
  for(const route of ['/security/check','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/dashboard'])if(counts[route]!==1)throw new Error('Expected exactly one executable route: '+route);
  // Only the three reporting deadline literals may differ in the retained source.
  const restored=retained.replace('ttlMs: 15000, budgetMs: 35000, maxPages: 40, maxRows: 10000,',needle)
    .replaceAll(outer.replace('21000','40000'),outer);
  if(restored!==source)throw new Error('Unexpected change to retained Worker.');
  return {candidate,proof:{baselineSha256:hash(source),candidateSha256:hash(candidate),extensionSha256:hash(extension),
    retainedChanges:['Chat query budget 20s to 35s','Two Chat response deadlines 21s to 40s'],
    securityRoutes:counts,preservation:'All retained bytes unchanged except named reporting deadline literals; append-only reporting overrides.'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [sourceFile,extensionFile,out]=process.argv.slice(2);
  if(!sourceFile||!extensionFile||!out)throw new Error('Usage: node builder.mjs private-baseline.mjs extension.js private-candidate.mjs');
  const result=build(fs.readFileSync(sourceFile,'utf8'),fs.readFileSync(extensionFile,'utf8'));
  fs.writeFileSync(out,result.candidate,{mode:0o600});fs.writeFileSync(out+'.proof.json',JSON.stringify(result.proof,null,2)+'\n',{mode:0o600});
  console.log(JSON.stringify(result.proof,null,2));
}
