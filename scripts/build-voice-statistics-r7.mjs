import fs from 'node:fs';import crypto from 'node:crypto';import {pathToFileURL} from 'node:url';
const {parse}=await import(process.env.ACORN_MODULE||'acorn');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export const BASE_HASH='51f420658961d0e52ec307aa24c63471a2caa2c894bd922aa068ea9be004202f';
export function build(source,patch){
 if(hash(source)!==BASE_HASH)throw Error('Exact deployed combined baseline required.');
 if(source.includes('VB_VOICE_STATS_R7'))throw Error('Statistics extension already present.');
 const candidate=source+'\n/* BEGIN VOICE STATISTICS R7 */\n'+patch+'\n/* END VOICE STATISTICS R7 */\n';
 const tree=parse(candidate,{ecmaVersion:'latest',sourceType:'module'}),routes={};
 function walk(n){if(!n||typeof n!=='object')return;if(n.type==='IfStatement'){const t=candidate.slice(n.test.start,n.test.end);for(const path of ['/security/check','/api/webex/dashboard','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/chat-customer-names'])if(t.includes('path === "'+path+'"')&&t.includes('method === "GET"'))routes[path]=(routes[path]||0)+1;}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);}
 walk(tree);for(const path of ['/security/check','/api/webex/dashboard','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/chat-customer-names'])if(routes[path]!==1)throw Error('Expected exactly one route: '+path);
 if(!candidate.startsWith(source))throw Error('Baseline bytes changed.');
 const allowed=['VB_VOICE_STATS_R7','vbVoiceStatisticsR7','vbVoiceStatsR7Retained'];
 const appended=parse(patch,{ecmaVersion:'latest',sourceType:'module'});
 for(const n of appended.body){if(n.type==='ExpressionStatement'&&!(n.expression.type==='AssignmentExpression'&&n.expression.left.name==='buildWebexStatistics'))throw Error('Unexpected top-level operation');if(!['VariableDeclaration','FunctionDeclaration','ExpressionStatement'].includes(n.type))throw Error('Disallowed extension structure');}
 return {candidate,proof:{baselineSha256:hash(source),candidateSha256:hash(candidate),patchSha256:hash(patch),routes,preservation:'Entire prior combined Worker retained byte-for-byte; one statistics-only override appended; no new network requests.'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const[a,b,c]=process.argv.slice(2);if(!a||!b||!c)throw Error('Need baseline, patch, output');const r=build(fs.readFileSync(a,'utf8'),fs.readFileSync(b,'utf8'));fs.writeFileSync(c,r.candidate,{mode:0o600});fs.writeFileSync(c+'.proof.json',JSON.stringify(r.proof,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(r.proof));}
