(function () {
  "use strict";
  const KEY = "vb_session";
  const SECURITY_ORIGIN = "https://visionbank-security.ahmedadeyemi.workers.dev";

  if (window.top !== window.self) {
    document.documentElement.style.display = "none";
    try { window.top.location = window.self.location.href; } catch {}
  }

  function migrateLegacy() {
    let current = "";
    try { current = sessionStorage.getItem(KEY) || ""; } catch {}
    if (current) return current;

    let legacy = "";
    try { legacy = localStorage.getItem(KEY) || ""; } catch {}
    if (!legacy) return "";

    try { sessionStorage.setItem(KEY, legacy); } catch {}
    try { localStorage.removeItem(KEY); } catch {}
    return legacy;
  }

  function get() {
    try {
      return sessionStorage.getItem(KEY) || migrateLegacy() || "";
    } catch {
      return migrateLegacy() || "";
    }
  }

  function set(value) {
    const token = String(value || "").trim();
    try { localStorage.removeItem(KEY); } catch {}
    if (!token) {
      try { sessionStorage.removeItem(KEY); } catch {}
      return;
    }
    try { sessionStorage.setItem(KEY, token); } catch {}
  }

  function clear() {
    try { sessionStorage.removeItem(KEY); } catch {}
    try { localStorage.removeItem(KEY); } catch {}
  }

  function authHeaders(extra = {}) {
    const session = get();
    return { ...extra, ...(session ? { Authorization: "Bearer " + session } : {}) };
  }

  migrateLegacy();
  window.VBPortalSession = Object.freeze({ get, set, clear, authHeaders, workerOrigin: SECURITY_ORIGIN });
})();