import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const source=fs.readFileSync(new URL('../webex-integrated-chat.js',import.meta.url),'utf8');
const block=source.slice(source.indexOf('    const comparisonColumns=['),source.indexOf('    const separateColumns=['));
const context=vm.createContext({window:{}});vm.runInContext(block+'\nglobalThis.columns=comparisonColumns;',context);
const values=row=>context.columns.map(c=>c[1](row));
test('comparison keeps call and chat metrics distinct',()=>{
 const row={agentId:'a',name:'Agent',voice:{inbound:12,missed:2,outbound:3,transferred:1},performanceMissed:4,lastHandlerContactsToday:5,lastHandlerCompletedStartedToday:9};
 assert.deepEqual(Array.from(values(row)).slice(5),[12,2,1,3,5,4]);
});
test('missing totals remain unknown and reported zero stays zero',()=>{
 assert.deepEqual(Array.from(values({voice:{inbound:0},lastHandlerContactsToday:0})).slice(5),[0,'Not reported','Not reported','Not reported',0,'Not reported']);
});
