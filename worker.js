// worker.js — VisionBank Security Worker (Full Corrected Version)

/* ============================================
   GLOBAL CORS POLICY (fixes your CORS problem)
=============================================== */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "https://ahmedadeyemi-cts.github.io",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // ======================================================
    // PRE-FLIGHT REQUEST HANDLING
    // ======================================================
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // ======================================================
    // SECURITY CHECK ENDPOINT
    // ======================================================
    if (url.pathname === "/security/check") {
      const result = await checkAccess(request, env);
      await logEvent(env, request, result);
      return json(result);
    }

    // ======================================================
    // STATE SUMMARY ENDPOINT
    // ======================================================
    if (url.pathname === "/security/state" && request.method === "GET") {
      const state = await getState(env, request);
      return json(state);
    }

    // ======================================================
    // IP ALLOWLIST ENDPOINTS
    // ======================================================
    if (url.pathname === "/security/ip") {
      if (request.method === "GET") {
        const rulesText = await env.IP_ALLOWLIST.get("rules");
        const rules = normalizeRules(rulesText || "");
        return json({ rulesText: rulesText || "", rules });
      }

      if (request.method === "POST") {
        const body = await request.json();
        const rulesText = String(body.rules || "");
        await env.IP_ALLOWLIST.put("rules", rulesText);

        const state = await getState(env, request);
        await logEvent(env, request, { allowed: true, reason: "ip-rules-updated" });

        return json({ ok: true, state });
      }
    }

    // ======================================================
    // BUSINESS HOURS ENDPOINTS
    // ======================================================
    if (url.pathname === "/security/hours") {
      if (request.method === "GET") {
        const hours = await loadBusinessHours(env);
        return json({ hours });
      }

      if (request.method === "POST") {
        const body = await request.json();
        const hours = sanitizeHours(body);

        await env.BUSINESS.put("hours", JSON.stringify(hours));
        const state = await getState(env, request);

        await logEvent(env, request, { allowed: true, reason: "business-hours-updated" });

        return json({ ok: true, state });
      }
    }

    // ======================================================
    // LOG VIEWER ENDPOINT
    // ======================================================
    if (url.pathname === "/security/logs" && request.method === "GET") {
      const limit = Math.max(
        1,
        Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10))
      );

      const raw = (await env.LOGS.get("events")) || "[]";
      let list = [];
      try {
        list = JSON.parse(raw);
        if (!Array.isArray(list)) list = [];
      } catch (_) {}

      return json({ events: list.slice(0, limit) });
    }

    // ======================================================
    // FALLBACK
    // ======================================================
    return new Response("VisionBank Security Worker", {
      status: 404,
      headers: CORS_HEADERS
    });
  }
};

/* ======================================================
   JSON RESPONSE HELPER — ALWAYS RETURNS CORS HEADERS
========================================================= */
function json(obj) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS
    }
  });
}

/* ======================================================
   CLIENT IP EXTRACTION
========================================================= */
function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "0.0.0.0"
  );
}

/* ======================================================
   IP RULE NORMALIZATION
========================================================= */
function normalizeRules(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function loadIpRules(env) {
  let text = await env.IP_ALLOWLIST.get("rules");

  if (!text || !text.trim()) {
    text = "45.51.4.217\n"; // safety seed
    await env.IP_ALLOWLIST.put("rules", text);
  }

  return normalizeRules(text);
}

/* ======================================================
   GITHUB PAGES IP RANGES — AUTO-ALLOW
========================================================= */
const GITHUB_IP_RANGES = [
  "185.199.108.0/22",
  "140.82.112.0/20",
  "143.55.64.0/20"
];

/* ======================================================
   BUSINESS HOURS MANAGEMENT
========================================================= */
async function loadBusinessHours(env) {
  const stored = await env.BUSINESS.get("hours");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return sanitizeHours(parsed);
    } catch (_) {}
  }

  return {
    start: "07:00",
    end: "19:00",
    days: [1, 2, 3, 4, 5, 6]
  };
}

function sanitizeHours(raw) {
  const start = typeof raw.start === "string" ? raw.start : "07:00";
  const end = typeof raw.end === "string" ? raw.end : "19:00";

  let days = raw.days;
  if (!Array.isArray(days)) days = [1, 2, 3, 4, 5, 6];

  days = days
    .map((d) => parseInt(d, 10))
    .filter((d) => d >= 0 && d <= 6);

  if (!days.length) days = [1, 2, 3, 4, 5, 6];

  return { start, end, days };
}

/* ======================================================
   IP RANGE MATH
========================================================= */
function ipToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;

  let res = 0;
  for (const part of parts) {
    const n = parseInt(part, 10);
    if (Number.isNaN(n) || n < 0 || n > 255) return null;
    res = (res << 8) + n;
  }
  return res >>> 0;
}

function ipMatches(ip, rule) {
  if (!rule.includes("/")) return ip === rule;

  const [range, bitsStr] = rule.split("/");
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt == null || rangeInt == null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

/* ======================================================
   CST CLOCK
========================================================= */
function getNowCst() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });

  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );

  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    day: dayMap[parts.weekday] ?? 0,
    label: `${parts.weekday} ${parts.hour}:${parts.minute} CST`
  };
}

/* ======================================================
   BUSINESS HOURS CHECK
========================================================= */
function isBusinessOpen(hours, nowCst) {
  return (
    hours.days.includes(nowCst.day) &&
    nowCst.hhmm >= hours.start &&
    nowCst.hhmm <= hours.end
  );
}

/* ======================================================
   MAIN ACCESS CHECK
========================================================= */
async function checkAccess(request, env) {
  const clientIp = getClientIp(request);
  const ipRules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const nowCst = getNowCst();

  const isGithubIp = GITHUB_IP_RANGES.some((range) => ipMatches(clientIp, range));
  const ipAllowed = isGithubIp || ipRules.some((r) => ipMatches(clientIp, r));

  if (!ipAllowed) {
    return { allowed: false, reason: "ip-denied", clientIp, ipRules, hours, nowCst };
  }

  if (!isBusinessOpen(hours, nowCst)) {
    return { allowed: false, reason: "hours-closed", clientIp, ipRules, hours, nowCst };
  }

  return { allowed: true, reason: "ok", clientIp, ipRules, hours, nowCst };
}

/* ======================================================
   STATE SUMMARY
========================================================= */
async function getState(env, request) {
  const clientIp = getClientIp(request);
  const ipRules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const nowCst = getNowCst();

  return { clientIp, ipRules, hours, nowCst };
}

/* ======================================================
   ALERT WEBHOOK (optional)
========================================================= */
async function sendAlert(env, entry) {
  const url = env.ALERT_WEBHOOK;
  if (!url) return;

  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "visionbank-security-alert",
        summary: `Denied access from ${entry.ip} (${entry.reason}) at ${entry.time}`,
        entry
      })
    });
  } catch (_) {}
}

/* ======================================================
   LOGGING SYSTEM
========================================================= */
async function logEvent(env, request, result) {
  try {
    const now = new Date().toISOString();
    const ip = getClientIp(request);
    const ua = request.headers.get("user-agent") || "unknown";

    const entry = {
      time: now,
      ip,
      ua,
      path: new URL(request.url).pathname,
      allowed: !!result.allowed,
      reason: result.reason || "unknown"
    };

    const raw = (await env.LOGS.get("events")) || "[]";
    let list = [];

    try {
      list = JSON.parse(raw);
      if (!Array.isArray(list)) list = [];
    } catch (_) {}

    list.unshift(entry);
    if (list.length > 500) list = list.slice(0, 500);

    await env.LOGS.put("events", JSON.stringify(list));

    if (!entry.allowed && ["ip-denied", "hours-closed"].includes(entry.reason)) {
      await sendAlert(env, entry);
    }
  } catch (_) {
    // Never break flow
  }
}
