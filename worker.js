// worker.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Simple CORS for your GitHub Pages origin
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://ahmedadeyemi-cts.github.io",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    // ---- Access check used by index.html ----
    if (url.pathname === "/security/check") {
      const result = await checkAccess(request, env);
      await logEvent(env, request, result); // always log
      return json(result, corsHeaders);
    }

    // ---- State summary (debug / admin) ----
    if (url.pathname === "/security/state" && request.method === "GET") {
      const state = await getState(env, request);
      return json(state, corsHeaders);
    }

    // ---- IP rules: GET returns current, POST updates ----
    if (url.pathname === "/security/ip") {
      if (request.method === "GET") {
        const rulesText = await env.IP_ALLOWLIST.get("rules");
        const rules = normalizeRules(rulesText || "");
        return json({ rulesText: rulesText || "", rules }, corsHeaders);
      }

      if (request.method === "POST") {
        const body = await request.json();
        const rulesText = String(body.rules || "");
        await env.IP_ALLOWLIST.put("rules", rulesText);
        const state = await getState(env, request);
        await logEvent(env, request, {
          allowed: true,
          reason: "ip-rules-updated",
        });
        return json({ ok: true, state }, corsHeaders);
      }
    }

    // ---- Business hours: GET returns, POST updates ----
    if (url.pathname === "/security/hours") {
      if (request.method === "GET") {
        const hours = await loadBusinessHours(env);
        return json({ hours }, corsHeaders);
      }

      if (request.method === "POST") {
        const body = await request.json();
        const hours = sanitizeHours(body);
        await env.BUSINESS.put("hours", JSON.stringify(hours));
        const state = await getState(env, request);
        await logEvent(env, request, {
          allowed: true,
          reason: "business-hours-updated",
        });
        return json({ ok: true, state }, corsHeaders);
      }
    }

    // ---- Logs viewer ----
    if (url.pathname === "/security/logs" && request.method === "GET") {
      const limit = Math.max(
        1,
        Math.min(500, parseInt(url.searchParams.get("limit") || "100", 10))
      );

      const existingRaw = (await env.LOGS.get("events")) || "[]";
      let list;
      try {
        list = JSON.parse(existingRaw);
        if (!Array.isArray(list)) list = [];
      } catch {
        list = [];
      }

      const events = list.slice(0, limit);
      return json({ events }, corsHeaders);
    }

    // Fallback – nothing else is served by this Worker
    return new Response("VisionBank Security Worker", {
      status: 404,
      headers: corsHeaders,
    });
  },
};

/* ---------- Helpers ---------- */

function json(obj, extraHeaders = {}) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...extraHeaders,
    },
  });
}

function getClientIp(request) {
  return (
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for") ||
    "0.0.0.0"
  );
}

/**
 * Normalize text from KV "rules" into a clean array of rules.
 * - One entry per line
 * - Blank lines and lines starting with "#" are ignored
 */
function normalizeRules(text) {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
}

async function loadIpRules(env) {
  let text = await env.IP_ALLOWLIST.get("rules");

  // If nothing configured, seed with your IP as a safety default
  if (!text || !text.trim()) {
    text = "45.51.4.217\n";
    await env.IP_ALLOWLIST.put("rules", text);
  }

  return normalizeRules(text);
}

/* GitHub Pages outbound IPs (must be allowed or dashboard blocks) */
const GITHUB_IP_RANGES = [
  "185.199.108.0/22",
  "140.82.112.0/20",
  "143.55.64.0/20",
];

async function loadBusinessHours(env) {
  const stored = await env.BUSINESS.get("hours");
  if (stored) {
    try {
      const parsed = JSON.parse(stored);
      return sanitizeHours(parsed);
    } catch (_) {
      // ignore, fall through
    }
  }

  // Default: Mon–Sat, 07:00–19:00 CST
  return {
    start: "07:00",
    end: "19:00",
    days: [1, 2, 3, 4, 5, 6],
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
  if (!rule.includes("/")) {
    return ip === rule;
  }

  const [range, bitsStr] = rule.split("/");
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt == null || rangeInt == null) return false;

  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function getNowCst() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );
  const weekday = parts.weekday;
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    day: dayMap[weekday] ?? 0,
    label: `${weekday} ${parts.hour}:${parts.minute} CST`,
  };
}

function isBusinessOpen(hours, nowCst) {
  return (
    hours.days.includes(nowCst.day) &&
    nowCst.hhmm >= hours.start &&
    nowCst.hhmm <= hours.end
  );
}

async function checkAccess(request, env) {
  const clientIp = getClientIp(request);
  const ipRules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const nowCst = getNowCst();

  // Allow GitHub Pages IP ranges automatically
  const isGithubIp = GITHUB_IP_RANGES.some((range) => ipMatches(clientIp, range));

  // Otherwise require match with your allowlist
  const ipAllowed =
    isGithubIp || ipRules.some((rule) => ipMatches(clientIp, rule));

  if (!ipAllowed) {
    return {
      allowed: false,
      reason: "ip-denied",
      clientIp,
      ipRules,
      hours,
      nowCst,
    };
  }

  const open = isBusinessOpen(hours, nowCst);
  if (!open) {
    return {
      allowed: false,
      reason: "hours-closed",
      clientIp,
      ipRules,
      hours,
      nowCst,
    };
  }

  return {
    allowed: true,
    reason: "ok",
    clientIp,
    ipRules,
    hours,
    nowCst,
  };
}

async function getState(env, request) {
  const clientIp = getClientIp(request);
  const ipRules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const nowCst = getNowCst();

  return {
    clientIp,
    ipRules,
    hours,
    nowCst,
  };
}

/**
 * Optional alert hook: send an email / webhook for denied access.
 * Configure env.ALERT_WEBHOOK as an HTTPS endpoint that sends an email
 * (for example, a small API you host, or a SendGrid/Mailgun webhook).
 */
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
        entry,
      }),
    });
  } catch (e) {
    // Alerts must never break main flow
  }
}

async function logEvent(env, request, result) {
  try {
    const now = new Date().toISOString();
    const clientIp = getClientIp(request);
    const ua = request.headers.get("user-agent") || "unknown";
    const entry = {
      time: now,
      ip: clientIp,
      ua,
      path: new URL(request.url).pathname,
      allowed: !!result.allowed,
      reason: result.reason || "unknown",
    };

    const existingRaw = (await env.LOGS.get("events")) || "[]";
    let list;
    try {
      list = JSON.parse(existingRaw);
      if (!Array.isArray(list)) list = [];
    } catch {
      list = [];
    }

    list.unshift(entry);
    if (list.length > 500) list = list.slice(0, 500);

    await env.LOGS.put("events", JSON.stringify(list));

    // Fire alert on deny
    if (!entry.allowed && (entry.reason === "ip-denied" || entry.reason === "hours-closed")) {
      await sendAlert(env, entry);
    }
  } catch (e) {
    // logging failures must not break the request
  }
}
