const BUILD = "2026.08.27-standalone-v1";
const CENTRAL_TZ = "America/Chicago";

const AUTH_STATE_KEY = "webex-oauth-state";
const REGION_STATE_KEY = "webex-region-state";

const SETTINGS_KEY = "webex-agent-control-settings-v1";
const HISTORY_KEY = "webex-agent-control-history-v1";
const AUTO_DONE_PREFIX = "webex-agent-auto-done-v1";
const AUTO_RETRY_MINUTES = 60;

const ALLOWED_ORIGINS = [
  "https://visionbank-dashboard.onrender.com",
  "https://ahmedadeyemi-cts.github.io"
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin)
        ? origin
        : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Cache-Control": "no-store"
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {
      if (url.pathname === "/health") {
        return json({
          success: true,
          service: "visionbank-webex-agent",
          build: BUILD
        }, cors);
      }

      if (url.pathname === "/api/webex/agent/settings" && request.method === "GET") {
        return handleSettingsGet(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/settings/save" && request.method === "POST") {
        return handleSettingsSave(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/current" && request.method === "GET") {
        return handleCurrent(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/logout" && request.method === "POST") {
        return handleManualLogout(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/auto-logout/run" && request.method === "POST") {
        return handleAutoLogoutRun(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/history" && request.method === "GET") {
        return handleHistory(request, env, cors);
      }

      if (url.pathname === "/api/webex/agent/reminder/test" && request.method === "POST") {
        return json({
          success: false,
          error: "webex-reminder-email-not-enabled",
          message: "Webex automatic signout is active. Email reminders remain on the existing Agent Controls service so the stable VisionBank Worker does not need to be modified."
        }, cors, 501);
      }

      return json({
        success: false,
        error: "not-found",
        service: "visionbank-webex-agent",
        build: BUILD
      }, cors, 404);
    } catch (err) {
      console.error("Webex Agent Worker error:", err?.stack || err);
      return json({
        success: false,
        error: err?.message || String(err),
        build: BUILD
      }, cors, 500);
    }
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runScheduledAutoLogout(env));
  }
};

function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...cors
    }
  });
}

/* ============================================================
   SHARED VISIONBANK SECURITY
   ============================================================ */

function getActorIp(request) {
  return request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "0.0.0.0";
}

function ipToBigInt(ip) {
  if (ip.includes(".")) {
    return ip.split(".")
      .reduce((acc, oct) => (acc << 8n) + BigInt(parseInt(oct, 10)), 0n);
  }

  const parts = ip.split("::");
  const left = parts[0].split(":").filter(Boolean);
  const right = parts.length > 1 ? parts[1].split(":").filter(Boolean) : [];
  const missing = 8 - (left.length + right.length);
  const full = [...left, ...Array(missing).fill("0"), ...right]
    .map(h => BigInt(parseInt(h || "0", 16)));

  return full.reduce((acc, h) => (acc << 16n) + h, 0n);
}

function isIpInCidr(ip, cidr) {
  try {
    const [range, bits] = cidr.split("/");
    const prefix = BigInt(bits);
    const ipNum = ipToBigInt(ip);
    const rangeNum = ipToBigInt(range);
    const totalBits = ip.includes(".") ? 32n : 128n;
    const mask = totalBits === 32n
      ? (~0n << (32n - prefix)) & 0xffffffffn
      : (~0n << (128n - prefix));

    return (ipNum & mask) === (rangeNum & mask);
  } catch {
    return false;
  }
}

function isIpAllowed(ip, rules) {
  for (const rule of rules) {
    if (!rule) continue;
    if (rule.includes("/")) {
      if (isIpInCidr(ip, rule)) return true;
    } else if (ip === rule) {
      return true;
    }
  }
  return false;
}

async function loadIpRules(env) {
  const raw = await env.IP_ALLOWLIST.get("rules");
  return raw ? raw.split("\n").map(x => x.trim()).filter(Boolean) : [];
}

async function loadBusinessHours(env) {
  const raw = await env.BUSINESS.get("hours");
  if (!raw) return { start: "07:00", end: "19:00", days: [1,2,3,4,5,6] };

  try {
    return JSON.parse(raw);
  } catch {
    return { start: "07:00", end: "19:00", days: [1,2,3,4,5,6] };
  }
}

function getChicagoParts(date = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: CENTRAL_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(date)
      .filter(p => p.type !== "literal")
      .map(p => [p.type, p.value])
  );

  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    weekday: parts.weekday,
    day: dayMap[parts.weekday]
  };
}

async function checkAccess(request, env) {
  const ip = getActorIp(request);
  const rules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const now = getChicagoParts();

  const ipOk = rules.length === 0 || isIpAllowed(ip, rules);
  const hoursOk =
    Array.isArray(hours.days) &&
    hours.days.includes(now.day) &&
    String(hours.start || "00:00") <= now.hhmm &&
    now.hhmm <= String(hours.end || "23:59");

  return {
    allowed: ipOk && hoursOk,
    reason: !ipOk ? "ip-denied" : !hoursOk ? "hours-closed" : "ok",
    info: {
      primaryIp: ip,
      ipVersion: ip.includes(":") ? "IPv6" : "IPv4",
      nowCst: now
    }
  };
}

async function getVisionBankSession(request, env) {
  const auth = String(request.headers.get("Authorization") || "");
  if (!auth.toLowerCase().startsWith("bearer ")) return null;

  const sessionId = auth.slice(7).trim();
  if (!sessionId) return null;

  const raw = await env.SESSIONS.get(sessionId);
  if (!raw) return null;

  let session;
  try {
    session = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!session?.expires || Number(session.expires) <= Date.now()) {
    await env.SESSIONS.delete(sessionId);
    return null;
  }

  return {
    id: sessionId,
    username: session.username || "unknown",
    role: session.role || "unknown",
    expires: Number(session.expires)
  };
}

async function authorize(request, env) {
  const access = await checkAccess(request, env);
  if (!access.allowed) {
    return { ok: false, status: 403, error: "access-denied", access };
  }

  const session = await getVisionBankSession(request, env);
  if (!session) {
    return { ok: false, status: 401, error: "session-required", access };
  }

  return { ok: true, status: 200, access, session };
}

/* ============================================================
   WEBEX TOKEN + SEARCH
   ============================================================ */

async function getWebexState(env) {
  const state = await env.WEBEX_AUTH_KV.get(AUTH_STATE_KEY, "json");
  if (!state?.accessToken) {
    throw new Error("No managed Webex access token was found in WEBEX_AUTH_KV.");
  }
  return state;
}

async function getRegion(env) {
  const region = await env.WEBEX_AUTH_KV.get(REGION_STATE_KEY, "json");
  return region?.baseUrl
    ? region
    : {
        code: "US",
        name: "United States",
        baseUrl: "https://api.wxcc-us1.cisco.com"
      };
}

async function webexFetch(env, url, options = {}) {
  const state = await getWebexState(env);
  const headers = new Headers(options.headers || {});
  headers.set("Authorization", `Bearer ${state.accessToken}`);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    throw new Error(
      "Webex rejected the managed access token. The stable visionbank-security Worker must refresh WEBEX_AUTH_KV before this operation can continue."
    );
  }

  return res;
}

async function webexSearch(env, query) {
  const region = await getRegion(env);
  const url =
    `${region.baseUrl}/search?orgId=${encodeURIComponent(env.WEBEX_ORG_ID)}`;

  const res = await webexFetch(env, url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: {} })
  });

  const text = await res.text();
  let payload = {};

  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Webex Search returned invalid JSON. HTTP ${res.status}`);
  }

  if (!res.ok) {
    throw new Error(
      `Webex Search failed HTTP ${res.status}: ` +
      `${payload?.message || payload?.error || text.slice(0,300)}`
    );
  }

  if (Array.isArray(payload.errors) && payload.errors.length) {
    throw new Error(
      `Webex GraphQL error: ${payload.errors.map(e => e.message).join(" | ")}`
    );
  }

  return payload.data || {};
}

function escapeGraphqlString(value) {
  return JSON.stringify(String(value));
}

function paginationArgument(cursor) {
  return cursor
    ? `pagination: { cursor: ${escapeGraphqlString(cursor)} }`
    : "";
}

async function fetchActiveAgentSessions(env) {
  const now = Date.now();
  const from = now - (30 * 24 * 60 * 60 * 1000);

  const all = [];
  let cursor = null;

  for (let page = 0; page < 100; page++) {
    const query = `
      {
        agentSession(
          from: ${from}
          to: ${now}
          filter: { isActive: { equals: true } }
          ${paginationArgument(cursor)}
        ) {
          agentSessions {
            isActive
            agentId
            agentName
            agentSessionId
            userLoginId
            startTime
            endTime
            state
            teamId
            teamName
            siteId
            siteName
            channelInfo {
              channelId
              channelType
              agentPhoneNumber
              currentState
              totalDuration
              lastActivityTime
              connectedCount
              connectedDuration
              notRespondedCount
              ronaCount
              transferCount
              outdialCount
              holdDuration
              wrapupDuration
              idleCodeName
              activities(first: 100) {
                nodes {
                  id
                  startTime
                  endTime
                  duration
                  state
                  taskId
                  isCurrentActivity
                  isLoginActivity
                  isLogoutActivity
                  queue { id name }
                  idleCode { id name }
                }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `;

    const data = await webexSearch(env, query);
    const root = data?.agentSession || {};
    const batch = Array.isArray(root.agentSessions) ? root.agentSessions : [];
    all.push(...batch);

    if (!root?.pageInfo?.hasNextPage || !root?.pageInfo?.endCursor) break;
    cursor = root.pageInfo.endCursor;
  }

  return all;
}

function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function formatCentral(value) {
  const ms = normalizeEpochMs(value);
  if (!ms) return "-";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: CENTRAL_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  }).format(new Date(ms));
}

function formatDuration(ms) {
  ms = Math.max(0, Number(ms || 0));
  const sec = Math.floor(ms / 1000);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return [h,m,s].map(v => String(v).padStart(2, "0")).join(":");
}

function getChannel(session) {
  const channels = Array.isArray(session?.channelInfo) ? session.channelInfo : [];
  return channels.find(c =>
    String(c?.channelType || "").toLowerCase() === "telephony"
  ) || channels[0] || null;
}

function getCurrentActivity(channel) {
  const list = channel?.activities?.nodes || [];
  return list.find(a => a?.isCurrentActivity === true) ||
    [...list]
      .filter(a => a?.startTime)
      .sort((a,b) => Number(b.startTime || 0) - Number(a.startTime || 0))[0] ||
    null;
}

function agentStatus(channel, activity, session) {
  const state = String(
    activity?.state || channel?.currentState || session?.state || "Unknown"
  ).trim();

  const idle = String(
    activity?.idleCode?.name || channel?.idleCodeName || ""
  ).trim();

  return idle && state.toLowerCase().includes("idle") ? idle : state;
}

function activeDuration(channel, activity, now) {
  const start = normalizeEpochMs(activity?.startTime);

  if (start && (activity?.isCurrentActivity === true || !activity?.endTime)) {
    return Math.max(0, now - start);
  }

  if (Number(activity?.duration) > 0) return Number(activity.duration);

  const last = normalizeEpochMs(channel?.lastActivityTime);
  return last ? Math.max(0, now - last) : 0;
}

function avgHandle(channel) {
  const connected = Number(channel?.connectedCount || 0);
  if (connected <= 0) return 0;

  return Math.round(
    (
      Number(channel?.connectedDuration || 0) +
      Number(channel?.holdDuration || 0) +
      Number(channel?.wrapupDuration || 0)
    ) / connected
  );
}

function buildAgentRows(sessions) {
  const now = Date.now();
  const byAgent = new Map();

  for (const session of sessions.filter(s => s?.isActive === true)) {
    const key =
      String(session?.agentId || session?.userLoginId || session?.agentName || "");
    if (!key) continue;

    const existing = byAgent.get(key);
    if (!existing || Number(session.startTime || 0) > Number(existing.startTime || 0)) {
      byAgent.set(key, session);
    }
  }

  return [...byAgent.values()]
    .map(session => {
      const channel = getChannel(session);
      const activity = getCurrentActivity(channel);
      const durationMs = activeDuration(channel, activity, now);
      const loginId = session?.userLoginId || "";
      const handleMs = avgHandle(channel);

      return {
        agentId: session?.agentId || "",
        sessionId: session?.agentSessionId || "",
        name: session?.agentName || loginId || "Unknown Agent",
        loginId,
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(loginId) ? loginId : "",
        teamId: session?.teamId || "",
        team: session?.teamName || "-",
        site: session?.siteName || "-",
        number: channel?.agentPhoneNumber || "-",
        status: agentStatus(channel, activity, session),
        state: activity?.state || channel?.currentState || session?.state || "Unknown",
        durationMs,
        duration: formatDuration(durationMs),
        inbound: Number(channel?.connectedCount || 0),
        missed: Number(channel?.notRespondedCount || channel?.ronaCount || 0),
        transferred: Number(channel?.transferCount || 0),
        outbound: Number(channel?.outdialCount || 0),
        avgHandleMs: handleMs,
        avgHandle: formatDuration(handleMs),
        sessionStartEpoch: normalizeEpochMs(session?.startTime),
        sessionStartCentral: formatCentral(session?.startTime),
        currentTaskId: activity?.taskId || null,
        currentQueueId: activity?.queue?.id || null,
        currentQueueName: activity?.queue?.name || null
      };
    })
    .sort((a,b) => a.name.localeCompare(b.name));
}

/* ============================================================
   SETTINGS + HISTORY
   ============================================================ */

async function loadSettings(env) {
  const saved = await env.AGENT_SETTINGS_KV.get(SETTINGS_KEY, "json");
  if (saved) return saved;

  const legacyReminder =
    await env.AGENT_SETTINGS_KV.get("agent-signout-settings", "json");
  const legacyLogout =
    await env.LOGOUT_CONFIG.get("settings", "json");

  const initial = {
    reminderEnabled: false,
    reminderTime: legacyReminder?.reminderTime || "16:55",
    ccRecipients: Array.isArray(legacyReminder?.ccRecipients)
      ? legacyReminder.ccRecipients
      : [],
    autoLogoutEnabled:
      legacyLogout?.enabled === true ||
      legacyReminder?.autoLogoutEnabled === true,
    weekdayLogoutTime:
      legacyLogout?.weekdayTime ||
      legacyReminder?.weekdayLogoutTime ||
      "17:30",
    saturdayLogoutTime:
      legacyLogout?.saturdayTime ||
      legacyReminder?.saturdayLogoutTime ||
      "12:30",
    targetMode: legacyLogout?.targetMode || "all",
    targetAgentName: legacyLogout?.targetAgentName || "",
    dryRun: true,
    timezone: CENTRAL_TZ,
    logoutReason: "VisionBank scheduled end-of-shift signout",
    retryWindowMinutes: AUTO_RETRY_MINUTES,
    reminderProvider: "legacy-worker",
    updatedAt: null
  };

  await env.AGENT_SETTINGS_KV.put(SETTINGS_KEY, JSON.stringify(initial));
  return initial;
}

async function saveSettings(env, body) {
  const settings = {
    reminderEnabled: false,
    reminderTime: String(body?.reminderTime || "16:55"),
    ccRecipients: Array.isArray(body?.ccRecipients)
      ? body.ccRecipients.map(x => String(x).trim()).filter(Boolean)
      : String(body?.ccRecipients || "")
          .split(",")
          .map(x => x.trim())
          .filter(Boolean),
    autoLogoutEnabled: body?.autoLogoutEnabled === true,
    weekdayLogoutTime: String(body?.weekdayLogoutTime || "17:30"),
    saturdayLogoutTime: String(body?.saturdayLogoutTime || "12:30"),
    targetMode: body?.targetMode === "specific" ? "specific" : "all",
    targetAgentName: body?.targetMode === "specific"
      ? String(body?.targetAgentName || "").trim()
      : "",
    dryRun: body?.dryRun !== false,
    timezone: CENTRAL_TZ,
    logoutReason: String(
      body?.logoutReason || "VisionBank scheduled end-of-shift signout"
    ).trim(),
    retryWindowMinutes: AUTO_RETRY_MINUTES,
    reminderProvider: "legacy-worker",
    updatedAt: new Date().toISOString()
  };

  await env.AGENT_SETTINGS_KV.put(SETTINGS_KEY, JSON.stringify(settings));
  return settings;
}

async function appendHistory(env, entry) {
  let history = await env.AGENT_SETTINGS_KV.get(HISTORY_KEY, "json");
  if (!Array.isArray(history)) history = [];

  history.unshift({
    id: crypto.randomUUID(),
    timeEpoch: Date.now(),
    timeCentral: formatCentral(Date.now()),
    ...entry
  });

  if (history.length > 200) history = history.slice(0, 200);
  await env.AGENT_SETTINGS_KV.put(HISTORY_KEY, JSON.stringify(history));
}

/* ============================================================
   LOGOUT
   ============================================================ */

function normalizeTarget(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function selectTargets(agents, settings) {
  if (settings.targetMode !== "specific") return [...agents];

  const wanted = normalizeTarget(settings.targetAgentName);
  if (!wanted) return [];

  return agents.filter(agent =>
    [agent.name, agent.loginId, agent.email]
      .map(normalizeTarget)
      .some(value => value === wanted)
  );
}

function assignedContactFailure(message) {
  return String(message || "")
    .toUpperCase()
    .includes("AGENT_HAS_ASSIGNED_CONTACTS");
}

async function logoutAgent(env, agent, options = {}) {
  const dryRun = options.dryRun !== false;
  const source = options.source || "manual";
  const initiatedBy = options.initiatedBy || "system";

  if (!agent?.agentId) {
    const result = {
      success: false,
      dryRun,
      status: "invalid-agent",
      agentId: "",
      agentName: agent?.name || "Unknown Agent",
      error: "No Webex agentId was available."
    };

    await appendHistory(env, { source, initiatedBy, ...result });
    return result;
  }

  if (dryRun) {
    const result = {
      success: true,
      dryRun: true,
      status: "would-sign-out",
      agentId: agent.agentId,
      agentName: agent.name,
      loginId: agent.loginId || "",
      team: agent.team || "-",
      state: agent.status || agent.state || "Unknown",
      httpStatus: null,
      error: null
    };

    await appendHistory(env, { source, initiatedBy, ...result });
    return result;
  }

  const region = await getRegion(env);
  const res = await webexFetch(env, `${region.baseUrl}/v1/agents/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      logoutReason:
        options.logoutReason || "VisionBank scheduled end-of-shift signout",
      agentId: agent.agentId
    })
  });

  const text = await res.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { payload = { raw: text }; }

  if (!res.ok) {
    const error = String(
      payload?.reason ||
      payload?.message ||
      payload?.error ||
      payload?.raw ||
      `HTTP ${res.status}`
    ).slice(0,500);

    const result = {
      success: false,
      dryRun: false,
      status: assignedContactFailure(error)
        ? "busy-assigned-contact"
        : "failed",
      agentId: agent.agentId,
      agentName: agent.name,
      loginId: agent.loginId || "",
      team: agent.team || "-",
      state: agent.status || agent.state || "Unknown",
      httpStatus: res.status,
      retryable:
        assignedContactFailure(error) ||
        res.status === 429 ||
        res.status >= 500,
      error
    };

    await appendHistory(env, { source, initiatedBy, ...result });
    return result;
  }

  const result = {
    success: true,
    dryRun: false,
    status: "signout-request-accepted",
    agentId: agent.agentId,
    agentName: agent.name,
    loginId: agent.loginId || "",
    team: agent.team || "-",
    state: agent.status || agent.state || "Unknown",
    httpStatus: res.status,
    error: null
  };

  await appendHistory(env, { source, initiatedBy, ...result });
  return result;
}

async function executeAutoLogout(env, options = {}) {
  const settings = options.settings || await loadSettings(env);
  const sessions = await fetchActiveAgentSessions(env);
  const agents = buildAgentRows(sessions);
  const targets = selectTargets(agents, settings);
  const results = [];

  for (const agent of targets) {
    const result = await logoutAgent(env, agent, {
      dryRun: settings.dryRun,
      source: options.source || "scheduled",
      initiatedBy: options.initiatedBy || "cloudflare-scheduler",
      logoutReason: settings.logoutReason
    });

    results.push(result);
  }

  return {
    activeAgents: agents,
    targetedAgents: targets,
    results
  };
}

function minutesFromTime(value) {
  const [h,m] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function inForwardWindow(targetTime, currentTime, minutes = AUTO_RETRY_MINUTES) {
  const target = minutesFromTime(targetTime);
  const current = minutesFromTime(currentTime);
  if (target === null || current === null) return false;

  const delta = current - target;
  return delta >= 0 && delta <= Number(minutes || AUTO_RETRY_MINUTES);
}

function todayLogoutTime(settings, now) {
  if (["Mon","Tue","Wed","Thu","Fri"].includes(now.weekday)) {
    return settings.weekdayLogoutTime || "17:30";
  }

  if (now.weekday === "Sat") {
    return settings.saturdayLogoutTime || "12:30";
  }

  return null;
}

async function runScheduledAutoLogout(env) {
  const settings = await loadSettings(env);
  if (!settings.autoLogoutEnabled) return;

  const now = getChicagoParts();
  const targetTime = todayLogoutTime(settings, now);
  if (!targetTime) return;

  if (!inForwardWindow(
    targetTime,
    now.hhmm,
    settings.retryWindowMinutes || AUTO_RETRY_MINUTES
  )) {
    return;
  }

  const execution = await executeAutoLogout(env, {
    settings,
    source: "scheduled",
    initiatedBy: "visionbank-webex-agent-cron"
  });

  console.log(
    `Webex auto-signout ${settings.dryRun ? "DRY RUN" : "LIVE"}: ` +
    `${execution.targetedAgents.length} target(s), ${execution.results.length} result(s).`
  );
}

/* ============================================================
   API HANDLERS
   ============================================================ */

async function handleSettingsGet(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({
      success: false,
      error: auth.error,
      access: auth.access
    }, cors, auth.status);
  }

  const settings = await loadSettings(env);

  return json({
    success: true,
    build: BUILD,
    settings,
    reminderNote:
      "Webex email reminders remain on the existing legacy Agent Controls service. Automatic Webex signout runs from this standalone Worker.",
    session: {
      username: auth.session.username,
      role: auth.session.role,
      expires: auth.session.expires
    }
  }, cors);
}

async function handleSettingsSave(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, cors, auth.status);
  }

  const body = await request.json();
  const settings = await saveSettings(env, body || {});

  await appendHistory(env, {
    source: "settings",
    initiatedBy: auth.session.username,
    success: true,
    dryRun: settings.dryRun,
    status: "settings-updated",
    agentId: "",
    agentName: "",
    httpStatus: null,
    error: null
  });

  return json({ success: true, build: BUILD, settings }, cors);
}

async function handleCurrent(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, cors, auth.status);
  }

  const sessions = await fetchActiveAgentSessions(env);
  const agents = buildAgentRows(sessions);

  return json({
    success: true,
    build: BUILD,
    count: agents.length,
    generatedAtEpoch: Date.now(),
    generatedAtCentral: formatCentral(Date.now()),
    agents
  }, cors);
}

async function handleManualLogout(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, cors, auth.status);
  }

  const body = await request.json();
  const agentId = String(body?.agentId || "").trim();

  if (!agentId) {
    return json({ success: false, error: "agentId is required." }, cors, 400);
  }

  const settings = await loadSettings(env);
  const agents = buildAgentRows(await fetchActiveAgentSessions(env));
  const agent = agents.find(a => String(a.agentId) === agentId);

  if (!agent) {
    return json({
      success: false,
      error: "The selected Webex agent is no longer active. Refresh and try again."
    }, cors, 409);
  }

  const result = await logoutAgent(env, agent, {
    dryRun: settings.dryRun,
    source: "manual",
    initiatedBy: auth.session.username,
    logoutReason: settings.logoutReason
  });

  return json({
    success: result.success,
    build: BUILD,
    result
  }, cors, result.success ? 200 : 409);
}

async function handleAutoLogoutRun(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, cors, auth.status);
  }

  const settings = await loadSettings(env);
  const execution = await executeAutoLogout(env, {
    settings,
    source: "manual-auto-run",
    initiatedBy: auth.session.username
  });

  return json({
    success: true,
    build: BUILD,
    dryRun: settings.dryRun,
    targetMode: settings.targetMode,
    targetAgentName: settings.targetAgentName,
    activeAgentCount: execution.activeAgents.length,
    targetCount: execution.targetedAgents.length,
    results: execution.results
  }, cors);
}

async function handleHistory(request, env, cors) {
  const auth = await authorize(request, env);
  if (!auth.ok) {
    return json({ success: false, error: auth.error }, cors, auth.status);
  }

  const history = await env.AGENT_SETTINGS_KV.get(HISTORY_KEY, "json");

  return json({
    success: true,
    build: BUILD,
    history: Array.isArray(history) ? history.slice(0,50) : []
  }, cors);
}
