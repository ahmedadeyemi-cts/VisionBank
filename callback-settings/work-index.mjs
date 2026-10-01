// Tiny work records are paginated; future rows cannot hide an older due record.
import {SettingsError} from './policy.mjs';
export async function earliestWork(storage,prefix,notAfter=Infinity){
 let startAfter,first=null;
 for(let page=0;page<100;page++){
  const rows=await storage.list({prefix,limit:200,...(startAfter?{startAfter}:{})});
  for(const [key,value]of rows){
   if(!Number.isFinite(value?.due))throw new SettingsError('callback-work-index-invalid',503);
   if(value.due<=notAfter&&(!first||value.due<first.value.due))first={key,value};
  }
  if(rows.size<200)return first?.value||null;
  startAfter=[...rows.keys()].at(-1);
 }
 throw new SettingsError('callback-work-index-capacity',503);
}
