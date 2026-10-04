import fs from 'node:fs';

const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node scripts/harden-legacy-security-r2.mjs <r1-worker> <output>');
let s=fs.readFileSync(input,'utf8');

function replaceOnce(oldText,newText,label){
  const count=s.split(oldText).length-1;
  if(count!==1)throw new Error(label+' expected exactly one anchor, found '+count);
  s=s.replace(oldText,newText);
}

const oldPolicy=`function legacySecurityRoutePolicy(path, method) {
  if (path === "/api/users/list" && method === "GET") return { roles: ["superadmin"] };
  if (["/api/users/save","/api/users/delete","/api/users/reset-mfa"].includes(path) && method === "POST") return { roles: ["superadmin"] };
  if (["/api/get-hours","/api/get-ip-rules"].includes(path) && method === "GET") return { roles: [...LEGACY_SECURITY_ROLES] };
  if (["/api/set-hours","/api/set-ip-rules"].includes(path) && method === "POST") return { roles: ["superadmin","admin","analyst"] };
  if (path === "/api/logs" && method === "GET") return { roles: ["superadmin","admin","auditor"] };
  if (path === "/api/validate-ip" && method === "POST") return { roles: ["superadmin","admin","analyst","auditor"] };
  return null;
}`;

const newPolicy=`function legacySecurityRoutePolicy(path, method) {
  const all=[...LEGACY_SECURITY_ROLES];
  const operators=["superadmin","admin","analyst"];

  if (path === "/api/users/list" && method === "GET") return { roles: ["superadmin"] };
  if (["/api/users/save","/api/users/delete","/api/users/reset-mfa"].includes(path) && method === "POST") return { roles: ["superadmin"] };
  if (["/api/get-hours","/api/get-ip-rules"].includes(path) && method === "GET") return { roles: all };
  if (["/api/set-hours","/api/set-ip-rules"].includes(path) && method === "POST") return { roles: operators };
  if (path === "/api/logs" && method === "GET") return { roles: ["superadmin","admin","auditor"] };
  if (path === "/api/validate-ip" && method === "POST") return { roles: ["superadmin","admin","analyst","auditor"] };

  if (path === "/api/directory/get" && method === "GET") return { roles: all };
  if (path === "/api/directory/save" && method === "POST") return { roles: operators };

  if (path === "/api/fax/cdrsearch" && method === "GET") return { roles: all };
  if (path === "/api/fax/schedule/get" && method === "GET") return { roles: all };
  if (["/api/fax/schedule/save","/api/fax/schedule/delete","/api/fax/send-daily"].includes(path) && method === "POST") return { roles: operators };

  if (path === "/api/voicemails/report" && method === "GET") return { roles: all };
  if (path === "/api/voicemails/schedule/get" && method === "GET") return { roles: all };
  if (["/api/voicemails/schedule/save","/api/voicemails/schedule/delete","/api/voicemails/send-daily"].includes(path) && method === "POST") return { roles: operators };
  if (path.startsWith("/api/voicecall/details/") && method === "GET") return { roles: all };
  if (path === "/api/transcriptions/report" && method === "GET") return { roles: all };

  if (["/api/agents/settings/get","/api/agents/logout/settings","/api/agents/current"].includes(path) && method === "GET") return { roles: all };
  if (["/api/agents/settings/save","/api/agents/logout/settings/save","/api/agents/reminder/test"].includes(path) && method === "POST") return { roles: operators };

  return null;
}`;

replaceOnce(oldPolicy,newPolicy,'legacy-route-policy-r2');

const oldNetwork=`function legacyNetworkOnlyRoute(path, method) {
  const key=method+" "+path;
  return new Set([
    "GET /api/fax/schedule/get","POST /api/fax/schedule/save","POST /api/fax/schedule/delete",
    "GET /api/voicemails/schedule/get","POST /api/voicemails/schedule/save","POST /api/voicemails/schedule/delete",
    "GET /api/agents/settings/get","POST /api/agents/settings/save",
    "GET /api/agents/logout/settings","POST /api/agents/logout/settings/save",
    "POST /api/directory/save"
  ]).has(key);
}`;
const newNetwork=`function legacyNetworkOnlyRoute(path, method) {
  return false;
}`;
replaceOnce(oldNetwork,newNetwork,'remove-network-only-human-routes');

for(const required of [
  '/api/fax/cdrsearch','/api/voicemails/report','/api/agents/current','/api/directory/get',
  'path.startsWith("/api/voicecall/details/")','/api/transcriptions/report'
]){
  if(!s.includes(required))throw new Error('r2 preservation missing '+required);
}
fs.writeFileSync(output,s,'utf8');
console.log(JSON.stringify({input,output,status:'r2-authenticated-operational-routes'},null,2));
