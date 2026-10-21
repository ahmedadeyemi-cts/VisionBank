import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const source=fs.readFileSync('webex-integrated-chat.js','utf8');
function harness(){
 let now=100000,ticks=0,message='',listener;
 const nodes=new Map(['queue-body','chat-agents-body','vb-queue-note','chat-agents-meta','chat-agents-export','queue-panel'].map(id=>[id,{textContent:'previous rows',attrs:{},setAttribute(k,v){this.attrs[k]=v;},classList:{remove(){}},querySelectorAll(){return [];}}]));
 const c=vm.createContext({Date:class extends Date{static now(){return now;}},document:{hidden:false,addEventListener(name,fn){listener=fn;}},$:id=>nodes.get(id),approved:()=>c.allowed,time:String,showWebexReportingStatus:s=>message=s,tick:()=>ticks++,fresh:(s,age)=>Number.isFinite(s)&&now-s>=-5000&&now-s<age});
 c.allowed=true;vm.runInContext('let base={success:true,generatedAtEpoch:100000};',c);
 vm.runInContext(source.slice(source.indexOf('  let resumeUntil='),source.indexOf('  const tables=new Map();')),c);
 return {c,nodes,run:s=>vm.runInContext(s,c),at:n=>now=n,visible(hidden){c.document.hidden=hidden;listener();},get ticks(){return ticks;},get message(){return message;}};
}
test('return after three minutes immediately refreshes and keeps clearly labelled previous rows for at most 30 seconds',()=>{
 const h=harness();h.run('hadVisibleSnapshot=true');h.visible(true);h.at(280000);
 assert.equal(h.run('holdResumeSnapshot()'),true);
 h.visible(false);assert.equal(h.ticks,1);assert.equal(h.run('holdResumeSnapshot()'),true);
 assert.match(h.message,/previous snapshot.*not live/);assert.equal(h.nodes.get('queue-body').textContent,'previous rows');
 assert.equal(h.nodes.get('chat-agents-export').disabled,true);
 h.at(310001);assert.equal(h.run('holdResumeSnapshot()'),false);
});
test('a current snapshot ends the hold immediately',()=>{
 const h=harness();h.run('hadVisibleSnapshot=true');h.visible(true);h.at(280000);h.visible(false);
 assert.equal(h.run('holdResumeSnapshot()'),true);h.run('base.generatedAtEpoch=280000');
 assert.equal(h.run('holdResumeSnapshot()'),false);assert.equal(h.nodes.get('queue-body').attrs['aria-busy'],'false');
});
test('no hold for first load, revoked access, missing data, or snapshots over five minutes old',()=>{
 const h=harness();h.at(280000);h.visible(false);assert.equal(h.run('holdResumeSnapshot()'),false);
 h.run('hadVisibleSnapshot=true');h.c.allowed=false;assert.equal(h.run('holdResumeSnapshot()'),false);
 h.c.allowed=true;h.at(500000);h.visible(false);assert.equal(h.run('holdResumeSnapshot()'),false);
 h.run('base=null');assert.equal(h.run('holdResumeSnapshot()'),false);
});
