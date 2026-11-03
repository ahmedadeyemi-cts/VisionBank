import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../portal-security-precheck.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../wxcc.html',import.meta.url),'utf8');
class Element{
 constructor(){this.children=[];this.attributes={};this.dataset={};this.textContent='';this.classes=new Set();this.classList={add:x=>this.classes.add(x),remove:x=>this.classes.delete(x)};}
 appendChild(n){this.children.push(n);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attributes[k]=v;}hasAttribute(k){return k in this.attributes;}querySelector(){return this.heading;}addEventListener(){}
}
async function run(result){const overlay=new Element(),message=new Element(),body=new Element();overlay.setAttribute('data-security-state','checking');overlay.heading=new Element();overlay.heading.textContent='Syncing Dashboard...';overlay.setAttribute('aria-busy','true');let handler,signal;const win={addEventListener:(n,h)=>{handler=h;}};win.top=win.self=win;
 const document={body,documentElement:{style:{}},createElement:()=>new Element(),createTextNode:t=>({textContent:t}),getElementById:id=>id==='access-denied-overlay'?overlay:id==='access-denied-message'?message:null};
 vm.runInNewContext(source,{window:win,document,navigator:{},AbortController,console:{error(){}},setTimeout,clearTimeout,fetch:async(u,o)=>{signal=o.signal;return typeof result==='function'?result(o):result;}});const pending=handler();assert.equal(overlay.heading.textContent,'Syncing Dashboard...');assert.equal(body.classes.has('security-approved'),false);await pending;return {overlay,body,message,signal};}
test('initial dashboard shows branded pending state while content remains gated',()=>{assert.match(html,/data-security-state="checking"/);assert.match(html,/Syncing Dashboard\.\.\./);assert.match(html,/dashboard-syncing-logo/);assert.match(html,/aria-busy="true"/);});
test('approved access removes the blocker only after checking completes',async()=>{const r=await run({ok:true,json:async()=>({allowed:true})});assert.ok(r.overlay.classes.has('hidden'));assert.ok(r.body.classes.has('security-approved'));assert.equal(r.overlay.attributes['aria-busy'],'false');assert.ok(r.signal);});
test('denial changes pending into a real restriction, retaining diagnostics',async()=>{const r=await run({ok:true,json:async()=>({allowed:false,info:{primaryIp:'192.0.2.7'}})});assert.equal(r.overlay.dataset.securityState,'denied');assert.equal(r.overlay.heading.textContent,'Access Restricted');assert.equal(r.body.classes.has('security-approved'),false);assert.equal(r.overlay.classes.has('hidden'),false);assert.ok(r.message.children.length>1);});
for(const [name,result] of [['HTTP error',{ok:false,status:503}],['invalid response',{ok:true,json:async()=>{throw Error('json');}}],['network error',()=>{throw Error('network');}],['timeout',()=>{const e=Error();e.name='AbortError';throw e;}]])test(name+' remains blocked with an error instead of an endless spinner',async()=>{const r=await run(result);assert.equal(r.overlay.heading.textContent,'Access Restricted');assert.equal(r.overlay.attributes['aria-busy'],'false');assert.equal(r.body.classes.has('security-approved'),false);});
