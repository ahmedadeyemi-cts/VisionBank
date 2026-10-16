import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../webex-integrated-chat.js',import.meta.url),'utf8');
const fn=source.slice(source.indexOf('  function wxccChatSummary('),source.indexOf('  function bootstrap()'));
function summary(totals,row){const ctx=vm.createContext({window:{VB_AGENT_PERFORMANCE:{rows:()=>totals}},duration:ms=>String(ms)});vm.runInContext(fn,ctx);return ctx.wxccChatSummary(row);}
test('WXCC summary uses exact agent metrics and never equates completed chats with callbacks',()=>{
 const text=summary([{agentId:'b',chat:{avgHandleMs:999}},{agentId:'a',chat:{avgHandleMs:120000}}],{agentId:'a',performanceOffered:4,performanceMissed:1,performanceMissedDisplay:'1 (RONA 1)',lastHandlerContactsToday:3,lastHandlerCompletedStartedToday:2,wrapup:0});
 assert.equal(text,'Offered: 4\nMissed: 1\nHandled: 3\nCallback: Not reported\nWrap-Up: 0\nAvg handle: 120000');
});
test('unknown metrics stay unknown while reported zero stays zero',()=>{
 const text=summary([],{agentId:'a',performanceOffered:0});assert.match(text,/Offered: 0\nMissed: Not reported/);assert.match(text,/Avg handle: Not reported/);
});
test('new presentation is scoped to WXCC and old dashboard keeps its labels',()=>{
 assert.ok(source.includes("const wxcc = document.body.classList.contains('wxcc-layout')"));
 assert.ok(source.includes("r=>wxcc ? wxccChatSummary(r) : `Offered:"));
 assert.ok(source.includes('Completed today*:'));
 assert.ok(fs.readFileSync(new URL('../wxcc-layout.css',import.meta.url),'utf8').includes('[data-vb-chat-summary]{font-weight:400}'));
});
