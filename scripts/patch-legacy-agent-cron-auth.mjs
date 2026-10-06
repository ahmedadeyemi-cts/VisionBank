const ROUTE_GATE_ANCHOR=`  const legacyPolicy = legacySecurityRoutePolicy(path, method);
  if (legacyPolicy) {
    const authorization = await authorizeLegacySecurityRequest(request, env, legacyPolicy);
    if (!authorization.ok) return json({ error: authorization.error }, cors, authorization.status);
  }`;

const ROUTE_GATE_REPLACEMENT=`  const legacyPolicy = legacySecurityRoutePolicy(path, method);
  const legacyAutomationAuthorized =
    path === "/api/agents/logout/settings" &&
    method === "GET" &&
    isLegacyAgentLogoutCronAuthorized(request, env);
  if (legacyPolicy && !legacyAutomationAuthorized) {
    const authorization = await authorizeLegacySecurityRequest(request, env, legacyPolicy);
    if (!authorization.ok) return json({ error: authorization.error }, cors, authorization.status);
  }`;

const HELPER_ANCHOR=`function constantTimeStringEqual(a,b) {
  const aa=String(a||""), bb=String(b||"");
  let diff=aa.length ^ bb.length;
  const max=Math.max(aa.length,bb.length);
  for(let i=0;i<max;i++) diff |= (aa.charCodeAt(i%Math.max(aa.length,1))||0) ^ (bb.charCodeAt(i%Math.max(bb.length,1))||0);
  return diff===0;
}`;

const HELPER_REPLACEMENT=`${HELPER_ANCHOR}

function isLegacyAgentLogoutCronAuthorized(request, env) {
  const expected=String(env?.AGENT_LOGOUT_CRON_TOKEN||"");
  const supplied=String(request.headers.get("X-VB-Agent-Logout-Token")||"");
  return expected.length>=32 &&
    supplied.length>=32 &&
    constantTimeStringEqual(supplied,expected);
}`;

function replaceExactlyOnce(source,needle,replacement,label){
  const count=String(source).split(needle).length-1;
  if(count!==1)throw new Error(label+'-anchor-count:'+count);
  return String(source).replace(needle,replacement);
}

export function patchLegacyAgentCronAuth(source){
  let text=String(source??'');
  const already=text.includes('function isLegacyAgentLogoutCronAuthorized(request, env)');
  if(already){
    if(!text.includes('path === "/api/agents/logout/settings"')||!text.includes('X-VB-Agent-Logout-Token'))
      throw new Error('unexpected-existing-agent-cron-auth');
    return text;
  }
  text=replaceExactlyOnce(text,ROUTE_GATE_ANCHOR,ROUTE_GATE_REPLACEMENT,'route-gate');
  text=replaceExactlyOnce(text,HELPER_ANCHOR,HELPER_REPLACEMENT,'helper');
  return text;
}

export const contract={
  ROUTE_GATE_ANCHOR,ROUTE_GATE_REPLACEMENT,HELPER_ANCHOR,HELPER_REPLACEMENT
};
