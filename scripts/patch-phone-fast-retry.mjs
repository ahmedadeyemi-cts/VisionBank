// Add phone-only retries between the existing five-minute maintenance runs.
// Preserve the existing scheduled body and every unrelated live Worker module.
export const PHONE_RETRY_CRON='* * * * *';
export function patchPhoneFastRetry(source){
  const marker='// VisionBank phone-only minute retry v1';
  if(source.includes(marker))return source;
  const signature='async scheduled(event, env, ctx) {';
  if(source.split(signature).length!==2)throw new Error('Expected one scheduled handler');
  const sweep='ctx.waitUntil(sweepExpiredLeases({env,webexFetch,orgId:String(env.WEBEX_ORG_ID||"")}).catch(err=>console.error("Device lease maintenance failed:",err?.message||err)));';
  const body=source.slice(source.indexOf(signature),source.indexOf(signature)+1800);
  if(!body.includes(sweep))throw new Error('Existing phone maintenance hook missing');
  return source.replace(signature,signature+`\n  ${marker}\n  if(event.cron === "${PHONE_RETRY_CRON}") {\n    // The original five-minute trigger owns minutes divisible by five.\n    if(Number.isFinite(event.scheduledTime) && new Date(event.scheduledTime).getUTCMinutes()%5!==0) {\n      ${sweep}\n    }\n    return;\n  }`);
}
