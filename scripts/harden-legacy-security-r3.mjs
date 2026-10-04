import fs from 'node:fs';

const input=process.argv[2],output=process.argv[3];
if(!input||!output)throw new Error('usage: node scripts/harden-legacy-security-r3.mjs <r2-worker> <output>');
let s=fs.readFileSync(input,'utf8');

function replaceOnce(oldText,newText,label){
  const count=s.split(oldText).length-1;
  if(count!==1)throw new Error(label+' expected exactly one anchor, found '+count);
  s=s.replace(oldText,newText);
}

const oldPolicy=`function legacySecurityRoutePolicy(path, method) {
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

const newPolicy=`function legacySecurityRoutePolicy(path, method) {
  const all=[...LEGACY_SECURITY_ROLES];
  const operators=["superadmin","admin","analyst"];

  if (path === "/api/session/status" && method === "GET") return { roles: all };
  if (path === "/motd" && method === "POST") return { roles: operators };

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

  if (["/api/realtime/status/queues","/api/realtime/statistics/global","/api/realtime/status/agents"].includes(path) && method === "GET") return { roles: all };

  if (["/api/webex/auth/status","/api/webex/discovery","/api/webex/schema","/api/webex/live-test",
       "/api/webex/dashboard","/api/webex/queues","/api/webex/agents","/api/webex/statistics",
       "/api/webex/chat-customer-names","/api/webex/chat-reports","/api/webex/daily-reports",
       "/api/webex/dashboard/settings"].includes(path) && method === "GET") return { roles: all };
  if (path === "/api/webex/dashboard/settings/save" && method === "POST") return { roles: operators };

  return null;
}`;

replaceOnce(oldPolicy,newPolicy,'r3-route-policy');

const logoutAnchor=`      if (path === "/api/logout" && method === "POST") {
        const auth = String(request.headers.get("Authorization") || "");
        if (auth.toLowerCase().startsWith("bearer ")) {
          const sessionId = auth.slice(7).trim();
          if (sessionId) await env.SESSIONS.delete(sessionId);
        }
        return json({ success: true }, cors);
      }`;

const sessionRoute=`${logoutAnchor}

      if (path === "/api/session/status" && method === "GET") {
        const session = await getVisionBankSessionFromRequest(request, env);
        if (!session) return json({ error: "session-required" }, cors, 401);
        const user = await getUser(env, session.username);
        if (!user || !(await isApprovedPortalEmail(user.email))) {
          const auth = String(request.headers.get("Authorization") || "");
          const sessionId = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
          if (sessionId) await env.SESSIONS.delete(sessionId);
          return json({ error: "identity-not-authorized" }, cors, 403);
        }
        return json({
          success: true,
          user: {
            username: session.username,
            email: String(user.email || "").trim().toLowerCase(),
            role: String(session.role || user.role || "view").toLowerCase()
          }
        }, cors);
      }`;
replaceOnce(logoutAnchor,sessionRoute,'session-status-route');

const realtimeRouteAnchor=`      if (url.pathname === "/api/fax/cdrsearch" && request.method === "GET") {
  return handleFaxCdrSearch(request, env, cors);
}`;

const realtimeRoutes=`${realtimeRouteAnchor}

if (path === "/api/realtime/status/queues" && method === "GET") {
  return handlePortalRealtimeProxy(env, cors, "/realtime/status/queues");
}
if (path === "/api/realtime/statistics/global" && method === "GET") {
  return handlePortalRealtimeProxy(env, cors, "/realtime/statistics/global");
}
if (path === "/api/realtime/status/agents" && method === "GET") {
  return handlePortalRealtimeProxy(env, cors, "/realtime/status/agents");
}`;
replaceOnce(realtimeRouteAnchor,realtimeRoutes,'realtime-routes');

const ccAnchor='const CC_API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3";';
const proxyHelper=`${ccAnchor}

async function handlePortalRealtimeProxy(env, cors, upstreamPath) {
  const allowed = new Set(["/realtime/status/queues","/realtime/statistics/global","/realtime/status/agents"]);
  if (!allowed.has(upstreamPath)) return json({ error: "realtime-route-denied" }, cors, 404);
  if (!env.CC_API_TOKEN) return json({ error: "contact-center-token-unavailable" }, cors, 503);

  const response = await fetch(CC_API_BASE + upstreamPath, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      token: env.CC_API_TOKEN
    },
    signal: AbortSignal.timeout(30000)
  });

  const text = await response.text();
  if (!response.ok) {
    return json({ error: "contact-center-upstream-failed", status: response.status }, cors, 502);
  }

  try {
    return json(JSON.parse(text), cors);
  } catch {
    return json({ error: "contact-center-invalid-response" }, cors, 502);
  }
}`;
replaceOnce(ccAnchor,proxyHelper,'server-realtime-proxy');

for(const required of [
  '/api/session/status','/api/realtime/status/queues','/api/realtime/statistics/global','/api/realtime/status/agents',
  '/api/webex/dashboard','/api/webex/daily-reports','/api/webex/chat-reports','/api/webex/dashboard/settings/save',
  'env.CC_API_TOKEN','handlePortalRealtimeProxy'
]){
  if(!s.includes(required))throw new Error('r3 preservation missing '+required);
}

fs.writeFileSync(output,s,'utf8');
console.log(JSON.stringify({input,output,status:'r3-portal-identity-and-token-proxy'},null,2));
