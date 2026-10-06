const FETCH_ANCHOR=`try {
  const path = url.pathname;

  const legacyPolicy = legacySecurityRoutePolicy(path, method);`;

const FETCH_REPLACEMENT=`try {
  const path = url.pathname;

  if (path.startsWith("/api/license/")) {
    return vbLicenseControl(request, env, cors);
  }

  if (!licenseExemptPath(path)) {
    const license = await requireLicensedAccess(env);
    if (license.enforcementEnabled === true && license.allowed !== true) {
      return json({
        error: "license-required",
        license: {
          status: license.status || "required",
          reason: license.reason || "license-required"
        }
      }, cors, 403);
    }
  }

  const legacyPolicy = legacySecurityRoutePolicy(path, method);`;

const SCHEDULE_ANCHOR=`  ctx.waitUntil(sweepExpiredLeases({env,webexFetch,orgId:String(env.WEBEX_ORG_ID||"")}).catch(err=>console.error("Device lease maintenance failed:",err?.message||err)));
}`;

const SCHEDULE_REPLACEMENT=`  ctx.waitUntil(sweepExpiredLeases({env,webexFetch,orgId:String(env.WEBEX_ORG_ID||"")}).catch(err=>console.error("Device lease maintenance failed:",err?.message||err)));
  ctx.waitUntil(scheduledLicenseCheck(env).catch(err=>console.error("License heartbeat maintenance failed:",err?.message||err)));
}`;

const LICENSE_IMPORT=`

import {createLicenseControlHandler,licenseExemptPath,requireLicensedAccess,scheduledLicenseCheck} from "./license-control.mjs";
const vbLicenseControl=createLicenseControlHandler();
`;

function once(source,needle,replacement,label){
  const count=source.split(needle).length-1;
  if(count!==1)throw new Error(label+'-anchor-count:'+count);
  return source.replace(needle,replacement);
}

export function patchLicenseGate(source){
  let text=String(source??'');
  if(text.includes('const vbLicenseControl=createLicenseControlHandler();')){
    if(!text.includes('path.startsWith("/api/license/")')||!text.includes('scheduledLicenseCheck(env)'))
      throw new Error('unexpected-existing-license-gate');
    return text;
  }
  text=once(text,FETCH_ANCHOR,FETCH_REPLACEMENT,'license-fetch');
  text=once(text,SCHEDULE_ANCHOR,SCHEDULE_REPLACEMENT,'license-schedule');
  text+=LICENSE_IMPORT;
  return text;
}

export const licenseGateContract={
  FETCH_ANCHOR,FETCH_REPLACEMENT,SCHEDULE_ANCHOR,SCHEDULE_REPLACEMENT,LICENSE_IMPORT
};
