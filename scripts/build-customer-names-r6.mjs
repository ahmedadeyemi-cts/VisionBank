import fs from 'node:fs';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const {parse}=await import(process.env.ACORN_MODULE||'acorn');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
export const BASE_HASH='0b1e57afd038404eae075acee0cf53737f2ff0096ce31b39ac90f40c8c1d7152';
export function build(source,extension){
 if(hash(source)!==BASE_HASH)throw new Error('Exact deployed R5 source required; no partial Worker permitted.');
 const anchor='if (path === "/api/webex/chat-reports" && method === "GET") {';
 if(source.split(anchor).length!==2)throw new Error('Chat route anchor is not unique.');
 const insert='if (path === "/api/webex/chat-customer-names" && method === "GET") {\n  return handleWebexCustomerNames(request, env, cors);\n}\n\n';
 const retained=source.replace(anchor,insert+anchor);
 if(retained.replace(insert,'')!==source)throw new Error('Unexpected baseline modification.');
 const candidate=retained+'\n/* BEGIN OPTIONAL CUSTOMER NAMES R6 */\n'+extension+'\n/* END OPTIONAL CUSTOMER NAMES R6 */\n';
 const ast=parse(candidate,{ecmaVersion:'latest',sourceType:'module'}),routes={};
 const names=['/security/check','/api/webex/dashboard','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/chat-customer-names'];
 const walk=n=>{if(!n||typeof n!=='object')return;if(n.type==='IfStatement'){const t=candidate.slice(n.test.start,n.test.end);for(const r of names)if(t.includes(`path === "${r}"`)&&t.includes('method === "GET"'))routes[r]=(routes[r]||0)+1;}for(const v of Object.values(n))if(Array.isArray(v))v.forEach(walk);else if(v&&typeof v==='object')walk(v);};walk(ast);
 for(const r of names)if(routes[r]!==1)throw new Error('Expected exactly one executable route '+r);
 return {candidate,proof:{baselineSha256:hash(source),candidateSha256:hash(candidate),extensionSha256:hash(extension),routes,originalBytesPreserved:true,onlyInsertion:'independent customer names GET route and implementation'}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const [base,ext,out]=process.argv.slice(2);const result=build(fs.readFileSync(base,'utf8'),fs.readFileSync(ext,'utf8'));fs.writeFileSync(out,result.candidate,{mode:0o600});fs.writeFileSync(out+'.proof.json',JSON.stringify(result.proof,null,2),{mode:0o600});console.log(JSON.stringify(result.proof));}
