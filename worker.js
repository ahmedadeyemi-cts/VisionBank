// =============================================================
// VisionBank Cloudflare Security Worker (FINAL VERSION)
// Always returns CORS headers, even on errors.
// =============================================================

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // --------------------------
    // ALWAYS add CORS headers
    // --------------------------
    const cors = {
      "Access-Control-Allow-Origin": "https://ahmedadeyemi-cts.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    try {

      // ================================
      // SECURITY CHECK (index.html)
      // ================================
      if (url.pathname === "/security/check") {
        const result = await checkAccess(request, env);
        await logEvent(env, request, result);
        return json(result, cors);
      }

      // ================================
      // STATE DEBUG
      // ================================
      if (url.pathname === "/security/state") {
        const state = await getState(env, request);
        return json(state, cors);
      }

      // ================================
      // IP RULES GET / POST
      // ================================
      if (url.pathname === "/security/ip") {
        if (request.method === "GET") {
          const rulesText = await env.IP_ALLOWLIST.get("rules");
          const rules = normalizeRules(rulesText || "");
          return json({ rulesText: rulesText || "", rules }, cors);
        }

        if (request.method === "POST") {
          const body = await request.json();
          const rulesText = String(body.rules || "");
          await env.IP_ALLOWLIST.put("rules", rulesText);

          await logEvent(env, request, { allowed: true, reason: "ip-rules-updated" });
          return json({ ok: true }, cors);
        }
      }

      // ================================
      // BUSINESS HOURS GET / POST
      // ================================
      if (url.pathname === "/security/hours") {
        if (request.method === "GET") {
          const hours = await loadBusinessHours(env);
          return json({ hours }, cors);
        }

        if (request.method === "POST") {
          const body = await request.json();
          const hours = sanitizeHours(body);
          await env.BUSINESS.put("hours", JSON.stringify(hours));

          await logEvent(env, request, { allowed: true, reason: "hours-updated" });
          return json({ ok: true }, cors);
        }
      }

      // ================================
      // LOGS VIEWER
      // ================================
      if (url.pathname === "/security/logs") {
        const raw = (await env.LOGS.get("events")) || "[]";
        let list = [];

        try { list = JSON.parse(raw) } catch {}

        return json({ events: list.slice(0, 200) }, cors);
      }

      // ================================
      // FALLBACK
      // ================================
      return new Response("Unknown path", { status: 404, headers: cors });

    } catch (err) {
      return json({ error: true, message: err.message }, cors, 500);
    }
  }
};

// =================================================================
// Utility helpers
// =================================================================
function json(obj, cors, status = 200) {
  return new Response(JSON.stringify(obj, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

// extract client IP
function getIp(req) {
  return req.headers.get("cf-connecting-ip") ||
         req.headers.get("x-forwarded-for") ||
         "0.0.0.0";
}

// normalize allowlist
function normalizeRules(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith("#"));
}

// load IP allowlist
async function loadIpRules(env) {
  let text = await env.IP_ALLOWLIST.get("rules");
  if (!text) {
    text = "45.51.4.217\n"; // seed with your IP
    await env.IP_ALLOWLIST.put("rules", text);
  }
  return normalizeRules(text);
}

// --- GitHub Pages IP ranges ---
const GITHUB_PAGES = [
  "185.199.108.0/22",
  "140.82.112.0/20",
  "143.55.64.0/20"
];

// IP match helper
function ipToInt(ip) {
  const p = ip.split(".");
  if (p.length !== 4) return null;
  return p.reduce((acc, n) => (acc << 8) + parseInt(n, 10), 0) >>> 0;
}
function matchIp(ip, cidr) {
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bits] = cidr.split("/");
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

// business hours
async function loadBusinessHours(env) {
  const raw = await env.BUSINESS.get("hours");
  if (!raw) return { start: "07:00", end: "19:00", days: [1,2,3,4,5,6] };
  try { return sanitizeHours(JSON.parse(raw)); }
  catch { return { start: "07:00", end: "19:00", days: [1,2,3,4,5,6] }; }
}

function sanitizeHours(h) {
  return {
    start: h.start || "07:00",
    end: h.end || "19:00",
    days: Array.isArray(h.days) ? h.days : [1,2,3,4,5,6]
  };
}

function getNowCST() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false
  });

  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };

  return {
    hhmm: `${parts.hour}:${parts.minute}`,
    day: dayMap[parts.weekday],
    label: `${parts.weekday} ${parts.hour}:${parts.minute} CST`
  };
}

// MAIN SECURITY LOGIC
async function checkAccess(req, env) {
  const ip = getIp(req);
  const rules = await loadIpRules(env);
  const hours = await loadBusinessHours(env);
  const now = getNowCST();

  const github = GITHUB_PAGES.some(r => matchIp(ip, r));
  const ipOk = github || rules.some(r => matchIp(ip, r));
  if (!ipOk) return { allowed:false, reason:"ip-denied", ip, now };

  const open = hours.days.includes(now.day) && now.hhmm >= hours.start && now.hhmm <= hours.end;
  if (!open) return { allowed:false, reason:"hours-closed", ip, now };

  return { allowed:true, reason:"ok", ip, now };
}

// save event logs
async function logEvent(env, req, res) {
  const entry = {
    time: new Date().toISOString(),
    ip: getIp(req),
    path: new URL(req.url).pathname,
    allowed: res.allowed,
    reason: res.reason
  };

  let raw = await env.LOGS.get("events") || "[]";
  let list = [];
  try { list = JSON.parse(raw) } catch {}
  list.unshift(entry);
  list = list.slice(0, 500);

  await env.LOGS.put("events", JSON.stringify(list));
}

async function getState(env, req) {
  return {
    ip: getIp(req),
    rules: await loadIpRules(env),
    hours: await loadBusinessHours(env),
    now: getNowCST()
  };
}
