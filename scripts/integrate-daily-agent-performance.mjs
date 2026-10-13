import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export function integrate(source) {
 const anchor='if (path === "/api/webex/dashboard" && method === "GET") {';
 if(source.split(anchor).length!==2||source.includes('/api/webex/agent-performance'))throw Error('Unexpected Worker baseline');
 const route=`if (path === "/api/webex/agent-performance" && method === "GET") {
   const headers={...cors,'Cache-Control':'no-store'};
   const access=await checkAccess(request,env);
   if(access?.allowed!==true)return json({success:false,error:'access-denied'},headers,403);
   try {
     const data=await vbRepCached(env,'daily-agent-performance',30000,()=>{
       const now=Date.now(),deadline=now+35000;
       return vbDailyPerformanceLoad(query=>vbRepSearch(env,query,deadline),getCentralDayStartEpochMs(now),now);
     });
     return json(data,headers);
   }catch{return json({success:false,error:'daily-agent-performance-unavailable'},{...headers,'Retry-After':'30'},503);}
 }
 `;
 return `import {loadDaily as vbDailyPerformanceLoad} from './daily-agent-performance.mjs';\n`+source.replace(anchor,route+anchor);
}
if(process.argv[1]===fileURLToPath(import.meta.url))fs.writeFileSync(process.argv[3],integrate(fs.readFileSync(process.argv[2],'utf8')),{flag:'wx',mode:0o600});
