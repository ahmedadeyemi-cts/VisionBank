import fs from 'node:fs';

const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node scripts/harden-legacy-security-r6.mjs <r5-worker> <output>');
let s=fs.readFileSync(input,'utf8');

function replaceOnce(oldText,newText,label){
  const count=s.split(oldText).length-1;
  if(count!==1)throw new Error(label+' expected exactly one anchor, found '+count);
  s=s.replace(oldText,newText);
}

replaceOnce(
`  const ipOk =
    rules.length === 0 ||
    isIpAllowedWithCidrs(ip, rules);`,
`  const ipOk =
    rules.length > 0 &&
    isIpAllowedWithCidrs(ip, rules);`,
'ip-only-fail-closed'
);

replaceOnce(
`async function authorizeLegacySecurityRequest(request, env, policy) {
  const access = await checkAccess(request, env);
  if (!access.allowed) return { ok:false, status:403, error:"access-denied" };
  const session = await getVisionBankSessionFromRequest(request, env);
  if (!session) return { ok:false, status:401, error:"session-required" };
  const role = String(session.role || "").toLowerCase();
  if (!policy.roles.includes(role)) return { ok:false, status:403, error:"role-denied" };
  return { ok:true, session, access };
}`,
`async function authorizeLegacySecurityRequest(request, env, policy) {
  const access = policy?.access === "ip-only"
    ? await checkIpOnly(request, env)
    : await checkAccess(request, env);
  if (!access.allowed) return { ok:false, status:403, error:"access-denied" };
  if (policy?.session === false) return { ok:true, session:null, access };
  const session = await getVisionBankSessionFromRequest(request, env);
  if (!session) return { ok:false, status:401, error:"session-required" };
  const role = String(session.role || "").toLowerCase();
  if (!policy.roles.includes(role)) return { ok:false, status:403, error:"role-denied" };
  return { ok:true, session, access };
}`,
'authorization-access-mode'
);

for(const [oldText,newText,label] of [
  ['if (path === "/api/session/status" && method === "GET") return { roles: all };','if (path === "/api/session/status" && method === "GET") return { roles: all, access: "ip-only" };','session-status-ip-only'],
  ['if (path === "/api/users/list" && method === "GET") return { roles: ["superadmin"] };','if (path === "/api/users/list" && method === "GET") return { roles: ["superadmin"], access: "ip-only" };','user-list-ip-only'],
  ['if (["/api/users/save","/api/users/delete","/api/users/reset-mfa"].includes(path) && method === "POST") return { roles: ["superadmin"] };','if (["/api/users/save","/api/users/delete","/api/users/reset-mfa"].includes(path) && method === "POST") return { roles: ["superadmin"], access: "ip-only" };','user-mutations-ip-only'],
  ['if (["/api/get-hours","/api/get-ip-rules"].includes(path) && method === "GET") return { roles: all };','if (["/api/get-hours","/api/get-ip-rules"].includes(path) && method === "GET") return { roles: all, access: "ip-only" };','security-reads-ip-only'],
  ['if (["/api/set-hours","/api/set-ip-rules"].includes(path) && method === "POST") return { roles: operators };','if (["/api/set-hours","/api/set-ip-rules"].includes(path) && method === "POST") return { roles: operators, access: "ip-only" };','security-writes-ip-only'],
  ['if (path === "/api/logs" && method === "GET") return { roles: ["superadmin","admin","auditor"] };','if (path === "/api/logs" && method === "GET") return { roles: ["superadmin","admin","auditor"], access: "ip-only" };','logs-ip-only'],
  ['if (path === "/api/validate-ip" && method === "POST") return { roles: ["superadmin","admin","analyst","auditor"] };','if (path === "/api/validate-ip" && method === "POST") return { roles: ["superadmin","admin","analyst","auditor"], access: "ip-only" };','validate-ip-ip-only']
]){
  replaceOnce(oldText,newText,label);
}

replaceOnce(
`  if (["/api/realtime/status/queues","/api/realtime/statistics/global","/api/realtime/status/agents"].includes(path) && method === "GET") return { roles: all };`,
`  if (["/api/realtime/status/queues","/api/realtime/statistics/global","/api/realtime/status/agents"].includes(path) && method === "GET") return { roles: all, session: false };`,
'webex-realtime-network-read'
);

replaceOnce(
`       "/api/webex/dashboard/settings"].includes(path) && method === "GET") return { roles: all };`,
`       "/api/webex/dashboard/settings"].includes(path) && method === "GET") return { roles: all, session: false };`,
'webex-dashboard-network-read'
);

for(const [oldText,newText,label] of [
  ['async function handleLogin(request, env, cors) {\n  const access=await checkAccess(request,env);','async function handleLogin(request, env, cors) {\n  const access=await checkIpOnly(request,env);','login-ip-only'],
  ['async function handleMfaSetup(request, env, cors) {\n  const access=await checkAccess(request,env);','async function handleMfaSetup(request, env, cors) {\n  const access=await checkIpOnly(request,env);','mfa-setup-ip-only'],
  ['async function handleMfaConfirm(request, env, cors) {\n  const access=await checkAccess(request,env);','async function handleMfaConfirm(request, env, cors) {\n  const access=await checkIpOnly(request,env);','mfa-confirm-ip-only']
]){
  replaceOnce(oldText,newText,label);
}

for(const required of [
  'policy?.access === "ip-only"',
  'policy?.session === false',
  'access: "ip-only"',
  'session: false',
  'const access=await checkIpOnly(request,env);',
  'rules.length > 0 &&'
]) if(!s.includes(required))throw new Error('r6 preservation missing '+required);

fs.writeFileSync(output,s,'utf8');
console.log(JSON.stringify({input,output,status:'r6-login-admin-hours-webex-regression-fix'},null,2));
