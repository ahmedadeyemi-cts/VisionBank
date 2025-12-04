// worker.js

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // -------------------------------
    // GLOBAL CORS HEADERS
    // -------------------------------
    const corsHeaders = {
      "Access-Control-Allow-Origin": "https://ahmedadeyemi-cts.github.io",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // OPTIONS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    try {
      // ==========================================
      // SECURITY CHECK
      // ==========================================
      if (url.pathname === "/security/check") {
        const result = await checkAccess(request, env);
        await logEvent(env, request, result);
        return json(result, corsHeaders);
      }

      // ==========================================
      // GET STATE (DEBUG)
      // ==========================================
      if (url.pathname === "/security/state" && request.method === "GET") {
        const state = await getState(env, request);
        return json(state, corsHeaders);
      }

      // ==========================================
      // IP RULES
      // ==========================================
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
          await logEvent(env, request, { allowed: true, reason: "ip-rules-updated" });
          return json({ ok: true, state }, corsHeaders);
        }
      }

      // ==========================================
      // BUSINESS HOURS
      // ==========================================
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
          await logEvent(env, request, { allowed: true, reason: "business-hours-updated" });
          return json({ ok: true, state }, corsHeaders);
        }
      }

      // ==========================================
      // LOG VIEWER
      // ==========================================
      if (url.pathname === "/security/logs" && request.method === "GET") {
        const limit = Math.min(500, Math.max(1, parseInt(url.searchParams.get("limit") || "100")));
        const existingRaw = (await env.LOGS.get("events")) || "[]";
        let list;

        try {
          list = JSON.parse(existingRaw);
          if (!Array.isArray(list)) list = [];
        } catch {
          list = [];
        }

        return json({ events: list.slice(0, limit) }, corsHeaders);
      }

      // ==========================================
      // FALLBACK
      // ==========================================
      return new Response("VisionBank Security Worker — Unknown Path", {
        status: 404,
        headers: corsHeaders,
      });
    }

    // =======================================================
    // GLOBAL ERROR HANDLER — STILL RETURNS CORS HEADERS
    // =======================================================
    catch (err) {
      return new Response(
        JSON.stringify({ error: true, message: err.message }),
        { status: 500, headers: corsHeaders }
      );
    }
  },
};

// =================================================================
// JSON HELPER (always includes CORS headers)
// =================================================================
function json(obj, corsHeaders) {
  return new Response(JSON.stringify(obj, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
  });
}
