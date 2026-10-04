(function () {
  "use strict";

  const WORKER_ORIGIN = "https://visionbank-security.ahmedadeyemi.workers.dev";
  const originalFetch = window.fetch.bind(window);

  function shouldAttach(url) {
    let parsed;
    try { parsed = new URL(url, location.href); } catch { return false; }
    if (parsed.origin !== WORKER_ORIGIN) return false;

    const path = parsed.pathname;
    return (
      path === "/api/session/status" ||
      path.startsWith("/api/realtime/") ||
      path === "/motd" ||
      path === "/api/webex/dashboard" ||
      path.startsWith("/api/webex/dashboard/") ||
      path === "/api/webex/queues" ||
      path === "/api/webex/agents" ||
      path === "/api/webex/statistics" ||
      path === "/api/webex/chat-customer-names" ||
      path === "/api/webex/chat-reports" ||
      path === "/api/webex/daily-reports" ||
      path === "/api/webex/auth/status" ||
      path === "/api/webex/discovery" ||
      path === "/api/webex/schema" ||
      path === "/api/webex/live-test"
    );
  }

  window.fetch = function visionBankAuthenticatedFetch(input, init = {}) {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input?.url || "";
    if (!shouldAttach(url)) return originalFetch(input, init);

    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (!headers.has("Authorization")) {
      const session = window.VBPortalSession?.get() || "";
      if (session) headers.set("Authorization", "Bearer " + session);
    }

    return originalFetch(input, { ...init, headers });
  };

  window.VBPortalOriginalFetch = originalFetch;
})();