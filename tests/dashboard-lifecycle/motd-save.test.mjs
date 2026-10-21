import vm from 'node:vm';import fs from 'node:fs';import assert from 'node:assert/strict';import test from 'node:test';
const source=fs.readFileSync('webex.js','utf8');
function harness(){
 const nodes=Object.fromEntries(['motdStatus','motdSignIn','motdSaveButton','motdClearButton','motdBanner'].map(id=>[id,{hidden:true,textContent:'',disabled:false,classList:{add(){},remove(){}}}]));
 let signedIn=true,response={status:200,body:{success:true}},calls=[],tick;
 const context=vm.createContext({window:{VBPortalSession:{get:()=>signedIn?'test-session':'',authHeaders:x=>({...x,Authorization:'Bearer test-session'})}},document:{getElementById:id=>nodes[id]},sessionStorage:{removeItem(){}},Date,Number,String,JSON,AbortSignal,console,setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{tick=null;},fetch:async(url,init)=>{calls.push(init);return {ok:response.status>=200&&response.status<300,status:response.status,json:async()=>response.body};},formatCountdown:()=> '01:00'});
 vm.runInContext("const MOTD_API='https://example.test/motd';let motdState={message:'existing',expiresAt:Date.now()+60000};let motdInterval=null;"+source.slice(source.indexOf('let motdWritePending ='),source.indexOf('function formatTime(')),context);
 return {context,nodes,calls,run:s=>vm.runInContext(s,context),signIn:v=>signedIn=v,reply:(status,body)=>response={status,body},tick:()=>tick?.()};
}
test('missing session offers sign-in without a write or lost message',async()=>{
 const h=harness();h.signIn(false);assert.equal(await h.run("saveMotd('new',60)"),false);assert.equal(h.calls.length,0);assert.equal(h.nodes.motdSignIn.hidden,false);assert.match(h.nodes.motdStatus.textContent,/Sign in/);assert.equal(h.run('motdState.message'),'existing');
});
test('authorized save awaits confirmation and includes session',async()=>{
 const h=harness();assert.equal(await h.run("saveMotd('new',60)"),true);assert.equal(h.calls[0].headers.Authorization,'Bearer test-session');assert.equal(h.run('motdState.message'),'new');assert.equal(h.nodes.motdStatus.textContent,'Message saved.');assert.equal(h.nodes.motdSaveButton.disabled,false);
});
test('401, denied role, denied network and server errors preserve last confirmed message',async()=>{
 for(const [status,error,pattern] of [[401,'session-required',/Sign in/],[403,'role-denied',/account cannot/],[403,'access-denied',/network/],[503,'unavailable',/HTTP 503/]]){
  const h=harness();h.reply(status,{error});assert.equal(await h.run("saveMotd('new',60)"),false);assert.match(h.nodes.motdStatus.textContent,pattern);assert.equal(h.run('motdState.message'),'existing');assert.equal(h.nodes.motdSaveButton.disabled,false);
 }
});
test('clear requires explicit server confirmation; rejects unsuccessful HTTP 200',async()=>{
 const h=harness();h.reply(403,{error:'role-denied'});assert.equal(await h.run('clearMotd()'),false);assert.equal(h.run('motdState.message'),'existing');h.reply(200,{});assert.equal(await h.run('clearMotd()'),false);assert.equal(h.run('motdState.message'),'existing');h.reply(200,{cleared:true});assert.equal(await h.run('clearMotd()'),true);assert.equal(h.run('motdState.message'),'');
});
test('expired display never sends a clear request',()=>{
 const h=harness();h.run('motdState.expiresAt=Date.now()-1;renderMotd()');h.tick();assert.equal(h.calls.length,0);assert.equal(h.nodes.motdBanner.textContent,'');
});
test('in-flight background read cannot overwrite a confirmed save',async()=>{
 const h=harness();let finish;
 h.context.fetch=async(_url,init)=>init.method==='GET'?{ok:true,json:()=>new Promise(r=>{finish=r;})}:{ok:true,status:200,json:async()=>({success:true})};
 const reading=h.run('loadMotd()');await Promise.resolve();await h.run("saveMotd('new',60)");finish({message:'old',expiresAt:Date.now()+60000});await reading;assert.equal(h.run('motdState.message'),'new');
});
test('network uncertainty preserves confirmed state and prevents duplicate writes',async()=>{
 const h=harness();let reject;h.context.fetch=()=>new Promise((_resolve,r)=>{reject=r;});const first=h.run("saveMotd('new',60)");assert.equal(await h.run("saveMotd('duplicate',60)"),false);reject(new Error('offline'));assert.equal(await first,false);assert.equal(h.run('motdState.message'),'existing');assert.match(h.nodes.motdStatus.textContent,/did not confirm/);assert.equal(h.nodes.motdClearButton.disabled,false);
});
test('invalid durations cannot be persisted',async()=>{const h=harness();for(const duration of ['NaN','Infinity',0,1441])assert.equal(await h.run('saveMotd("new",'+duration+')'),false);assert.equal(h.calls.length,0);});

test('sign-in round trip restores draft and return URL without submitting',()=>{
 const h=harness(),storage=new Map();let click,opened=false;
 h.nodes.motdSignIn.addEventListener=(_type,fn)=>{click=fn;};
 h.nodes.alertSettingsPanel={classList:{remove(){opened=true;}}};
 Object.assign(h.context,{motdTextEl:{value:'Team message <plain text>'},motdDurationEl:{value:'90'},location:{pathname:'/wxcc.html',search:'',hash:'#vbHandledChats'},sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k),removeItem:k=>storage.delete(k)}});
 const ui=source.slice(source.indexOf("  const motdSignIn ="),source.indexOf('  // Toggle panels'));
 h.run('(function(){'+ui+'})()');click();assert.equal(storage.get('vb_return_to'),'/wxcc.html#vbHandledChats');
 h.context.motdTextEl.value='';h.context.motdDurationEl.value='60';
 h.run('(function(){'+ui+'})()');assert.equal(h.context.motdTextEl.value,'Team message <plain text>');assert.equal(h.context.motdDurationEl.value,'90');assert(opened);assert.equal(h.calls.length,0);
});
