import fs from 'node:fs';import vm from 'node:vm';
export const patch=fs.readFileSync(new URL('../../worker-patches/voice-statistics-r7.js',import.meta.url),'utf8');
export const now=Date.parse('2026-09-29T23:00:00Z'),from=Date.parse('2026-09-29T05:00:00Z');
export const task=(id,extra={})=>({id,channelType:'telephony',direction:'inbound',createdTime:now-60000,lastActivityTime:now-1000,isActive:false,isContactOffered:false,isContactHandled:false,isWithInServiceLevel:false,connectedCount:0,connectedDuration:0,queueCount:0,queueDuration:0,abandonedType:null,abandonedSlCount:0,ringingDuration:0,...extra});
export const queue=(extra={})=>({id:'voice-queue',name:'Voice',channelType:'telephony',operationsRevision:3,countStatus:'ready',waiting:0,offered:0,active:0,wrapup:0,...extra});
export function evaluate(tasks,queues=[queue()],at=now,start=from){const c=vm.createContext({buildWebexStatistics:()=>({legacyPreserved:true}),getCentralDayStartEpochMs:()=>start});vm.runInContext(patch,c);return JSON.parse(JSON.stringify(c.vbVoiceStatisticsR7(tasks,queues,start,at)));}
export function example(at=now){let rows=Array.from({length:200},(_,i)=>task('flow-'+i,{createdTime:at-60000,lastActivityTime:at-1000}));
 for(let i=0;i<9;i++)rows.push(task('answer-'+i,{createdTime:at-50000,lastActivityTime:at-1000,isContactOffered:true,isContactHandled:true,connectedCount:i===0?3:1,queueCount:1,queueDuration:i<4?5000:0,ringingDuration:7000,connectedDuration:60000,isWithInServiceLevel:i!==0}));
 rows.push(task('queue-abandon',{createdTime:at-40000,lastActivityTime:at-1000,queueCount:1,queueDuration:10000,abandonedType:'in-queue'}));
 rows.push(task('ivr-abandon',{createdTime:at-30000,lastActivityTime:at-1000,abandonedType:'in-ivr'}));
 rows.push(task('ringing',{createdTime:at-20000,lastActivityTime:at-1000,isActive:true,isContactOffered:true,queueCount:1,ringingDuration:2000}));return rows;
}
