import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export function integrateAutoEnrollment(source){
 const anchor='  async scheduled(event, env, ctx) {';
 if(source.split(anchor).length!==2||source.includes('reconcilePhoneEnrollments'))throw Error('Unexpected automatic enrollment baseline');
 return "import {reconcilePhoneEnrollments} from './device-management/auto-enrollment.mjs';\n"+source.replace(anchor,anchor+'\n  ctx.waitUntil(reconcilePhoneEnrollments({env,webexFetch}).catch(err=>console.error("Automatic phone enrollment failed:",err?.message||err)));');
}
if(process.argv[1]===fileURLToPath(import.meta.url))fs.writeFileSync(process.argv[3],integrateAutoEnrollment(fs.readFileSync(process.argv[2],'utf8')),{flag:'wx',mode:0o600});
