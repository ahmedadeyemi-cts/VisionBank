import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
export function integrate(source){
 if(source.includes('VB_FOLLOWUP_V1'))throw Error('Already integrated');
 const route='if (path === \"/api/webex/abandoned-callback/settings\" ||';
 if(source.split(route).length!==2)throw Error('Unexpected callback route baseline');
 source=source.replace(route,'if (path === \"/api/webex/abandoned-callback/followups\" || path === \"/api/webex/abandoned-callback/settings\" ||');
 return source+`
/* VB_FOLLOWUP_V1: preserve all existing reports; reuse the already-fetched outbound tasks. */
import {outboundFollowups as vbOutboundFollowups,decorateFollowups as vbDecorateFollowups} from './callback-settings/followup.mjs';
const vbFollowupPayload=buildWebexDailyReportPayload;
buildWebexDailyReportPayload=function(tasks,legs,cars,now,day){
 const data=vbFollowupPayload(tasks,legs,cars,now,day);
 return {...data,abandonedCalls:vbOutboundFollowups(data.abandonedCalls,tasks,cars,now),outboundFollowupStatus:'ready'};
};
const vbFollowupReport=buildWebexDailyReportData;
buildWebexDailyReportData=async function(env,force=false){
 const data=await vbFollowupReport(env,force);
 try{const store=env.ABANDONED_CALLBACK_SETTINGS.get(env.ABANDONED_CALLBACK_SETTINGS.idFromName(env.WEBEX_ORG_ID+':settings:v1'));return await vbDecorateFollowups(data,store);}
 catch{return {...data,followupStatus:'unavailable'};}
};
`;
}
if(process.argv[1]===fileURLToPath(import.meta.url))fs.writeFileSync(process.argv[3],integrate(fs.readFileSync(process.argv[2],'utf8')),{flag:'wx',mode:0o600});
export function integrateCompanion(source){
 const anchor='      if (u.pathname === "/plans") return this.plans.fetch(request);';
 if(source.split(anchor).length!==2||source.includes('VB_FOLLOWUP_STORE_V1'))throw Error('Unexpected callback storage baseline');
 const exclusion='else if (row.callbackScheduleId || Number(row.callbackAttempts) > 0)';
 if(source.split(exclusion).length!==2)throw Error('Unexpected callback preview baseline');
 return "/* VB_FOLLOWUP_STORE_V1 */\nimport {FollowupStore as VBFollowupStore} from './callback-settings/followup.mjs';\nimport {SettingsError as VBFollowupError} from './callback-settings/policy.mjs';\n"+source.replace(anchor,`      if (u.pathname === "/followups") {
        try { return await new VBFollowupStore(this.storage).fetch(request); }
        catch(error) { return output({success:false,error:error instanceof VBFollowupError?error.code:'followup-storage-unavailable'},error instanceof VBFollowupError?error.status:503); }
      }
`+anchor).replace(exclusion,"else if (row.manualFollowup?.done === true) reason = 'marked-done';\n    else if (report.followupStatus === 'unavailable') reason = 'followup-status-unavailable';\n    "+exclusion);
}

// The live selection module has a retained scheduling-window implementation that
// differs from the repository. Apply only these exclusions to that live module.
export function integrateSelection(source){
 const needle='else if (row.callbackScheduleId || Number(row.callbackAttempts) > 0)';
 if(source.split(needle).length!==2||source.includes("reason = 'marked-done'"))throw Error('Unexpected selection baseline');
 return source.replace(needle,"else if (row.manualFollowup?.done === true) reason = 'marked-done';\n    else if (report.followupStatus === 'unavailable') reason = 'followup-status-unavailable';\n    "+needle);
}
