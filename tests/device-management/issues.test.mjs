import test from 'node:test';
import assert from 'node:assert/strict';
import {listIssueRecords} from '../../device-management/audit.mjs';
import {createDeviceManagementHandler} from '../../device-management/gateway.mjs';
const metadata={auditId:'failure',at:'2026-10-14T21:50:46Z',deviceName:'Matthew',action:'save',result:'failed',webexStatus:'not-confirmed',phonismStatus:'not-confirmed'};
function fixture(){
 const calls=[];
 const record={device:{name:'Matthew',mac:'44:DB:D2:CD:F3:10'},location:{name:'DUFF'},change:{requestedExtension:'1404',stage:'resolve-write-context'},reason:'resolve-write-context: webex-device-not-found',actor:{sessionId:'SECRET'},accessToken:'SECRET'};
 return {calls,env:{LOGS:{list:async opts=>{calls.push(opts);return {keys:[{name:'bad',metadata},{name:'good',metadata:{result:'completed'}},{name:'gone',metadata:{...metadata,auditId:'missing'}}],list_complete:false,cursor:'page2'};},get:async key=>key==='bad'?JSON.stringify(record):null}}};
}
test('issue feed exposes failure evidence, retains missing summaries, excludes successful events and credentials',async()=>{
 const {env,calls}=fixture();const result=await listIssueRecords(env,{cursor:'page1'});
 assert.equal(result.rows.length,2);assert.equal(result.cursor,'page2');assert.equal(calls[0].cursor,'page1');
 const row=result.rows.find(r=>r.auditId==='failure');assert.equal(row.errorCode,'webex-device-not-found');assert.equal(row.extension,'1404');assert.equal(row.stage,'resolve-write-context');
 assert.equal(result.rows.find(r=>r.auditId==='missing').detailAvailable,false);assert.ok(!JSON.stringify(result).includes('SECRET'));
 await assert.rejects(()=>listIssueRecords(env,{cursor:'x'.repeat(2049)}),{code:'invalid-issues-cursor'});
});
test('issues route enforces origin and approved network and is GET-only',async()=>{
 const {env}=fixture();let allowed=true;
 const handler=createDeviceManagementHandler({checkAccess:async()=>({allowed}),loadIpRules:async()=>['198.51.100.12'],webexFetch:async()=>{throw Error('Must not contact Webex');}});
 const req=(method='GET',origin='https://visionbank-dashboard.onrender.com')=>{const r=new Request('https://worker.example/api/webex/device-management/issues',{method,headers:{Origin:origin,'CF-Connecting-IP':'198.51.100.12'}});Object.defineProperty(r,'cf',{value:{colo:'TEST'}});return r;};
 assert.equal((await handler(req(),env)).status,200);
 assert.equal((await handler(req('GET','https://unapproved.example'),env)).status,403);
 assert.equal((await handler(req('POST'),env)).status,405);
 allowed=false;assert.equal((await handler(req(),env)).status,403);
});
