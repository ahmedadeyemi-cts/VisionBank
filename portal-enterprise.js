(() => {
  "use strict";

  const body = document.body;
  if (!body) return;

  const LICENSE_WORKER = window.VBPortalSession?.workerOrigin || "";
  const LICENSE_RETURN_KEY = "vb_return_to";

  // The root dashboard is a view-only page. A licensing failure must not
  // misdirect ordinary viewers into the administrator authentication screen.
  // Keep enforcement fail-closed; do not display operational data on denial.
  const isRootDashboard = location.pathname === "/" || location.pathname === "/index.html";
  function showDashboardLicenseNotice(reason) {
    if (!isRootDashboard) return false;
    if (document.getElementById("vb-dashboard-license-notice")) return true;
    const notice = document.createElement("section");
    notice.id = "vb-dashboard-license-notice";
    notice.setAttribute("role", "alert");
    notice.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:#f3f7f5;color:#173b30;display:flex;align-items:center;justify-content:center;padding:24px;font:16px system-ui,sans-serif;";
    const panel = document.createElement("div");
    panel.style.cssText = "max-width:560px;width:100%;background:white;border:1px solid #cfded7;border-radius:14px;padding:30px;box-shadow:0 12px 36px #142e2426;";
    const title = document.createElement("h2");
    title.textContent = "VisionBank Dashboard temporarily unavailable";
    title.style.cssText = "margin:0 0 12px;font-size:23px;";
    const detail = document.createElement("p");
    detail.textContent = "The dashboard access service could not approve this request (" + reason + "). No administrator login is required for viewing the dashboard. Please contact your IT team if this continues.";
    detail.style.cssText = "line-height:1.55;margin:0;";
    panel.append(title, detail);
    notice.append(panel);
    document.body.append(notice);
    return true;
  }
  async function validatePortalLicense() {
    try {
      if (!LICENSE_WORKER) return;
      const response = await fetch(LICENSE_WORKER + "/api/license/access", {
        method:"GET", cache:"no-store", credentials:"omit"
      });
      if (response.status === 404) return;
      if (!response.ok) throw new Error("license-status-unavailable");
      const data = await response.json();
      window.VB_LICENSE = data;
      if (data?.enforcementEnabled === true && data?.allowed !== true) {
        try {
          const returnPath = location.pathname + location.search + location.hash;
          if (returnPath.startsWith("/") && !returnPath.startsWith("//")) {
            sessionStorage.setItem(LICENSE_RETURN_KEY, returnPath);
          }
        } catch {}
        if (showDashboardLicenseNotice(data.reason || data.status || "license_required")) return;
        const target = new URL("security.html", location.href);
        target.searchParams.set("view","licensing");
        target.searchParams.set("reason",data.reason || data.status || "license_required");
        location.replace(target.href);
      }
    } catch (error) {
      console.error("VisionBank license check failed:", error);
      if (showDashboardLicenseNotice("license_status_unavailable")) return;
      const target = new URL("security.html", location.href);
      target.searchParams.set("view","licensing");
      target.searchParams.set("reason","license_status_unavailable");
      location.replace(target.href);
    }
  }
  void validatePortalLicense();

  function normalizePath(value) {
    let path = String(value || "").split("?")[0].split("#")[0];
    path = path.replace(/^https?:\/\/[^/]+/i, "");
    path = path.split("/").pop() || "index";
    path = path.replace(/\.html$/i, "");
    if (!path) path = "index";
    return path.toLowerCase();
  }

  const page = normalizePath(location.pathname) === "wxcc" ? "webex" : normalizePath(location.pathname);
  const themeProfiles = {
    index:       { bodyClass: "dark-mode", key: "dashboard-dark-mode", darkValue: "1", lightValue: "0" },
    dashboard:   { bodyClass: "dark-mode", key: "dashboard-dark-mode", darkValue: "1", lightValue: "0" },
    webex:       { bodyClass: "dark-mode", key: "dashboard-dark-mode", darkValue: "1", lightValue: "0" },
    "webex-agent": { bodyClass: "theme-dark", key: "vb_webex_agents_theme", darkValue: "dark", lightValue: "light" },
    agents:      { bodyClass: "theme-dark", key: "vb_agents_theme", darkValue: "dark", lightValue: "light" },
    voicemails:  { bodyClass: "theme-dark", key: "vb_voicemail_theme", darkValue: "dark", lightValue: "light" },
    fax:         { bodyClass: "theme-dark", key: "vb_fax_theme", darkValue: "dark", lightValue: "light" },
    directory:   { bodyClass: "dark", key: "vb_theme", darkValue: "dark", lightValue: "light" },
    device:      { bodyClass: "enterprise-dark", key: "vb_device_theme", darkValue: "dark", lightValue: "light" }
  };
  const profile = themeProfiles[page] || null;
  const commonKey = "vb_portal_theme";

  function profileDarkFromStorage() {
    if (!profile) return null;
    const value = localStorage.getItem(profile.key);
    if (value == null) return null;
    return value === profile.darkValue;
  }

  function applyTheme(dark, persist = true) {
    if (profile) {
      body.classList.toggle(profile.bodyClass, dark);
      localStorage.setItem(profile.key, dark ? profile.darkValue : profile.lightValue);
    }
    body.classList.toggle("enterprise-dark", dark);
    body.classList.toggle("enterprise-light", !dark);
    if (persist) localStorage.setItem(commonKey, dark ? "dark" : "light");

    const deviceToggle = document.querySelector("[data-enterprise-theme-toggle]");
    if (deviceToggle) {
      deviceToggle.textContent = dark ? "Light mode" : "Dark mode";
      deviceToggle.setAttribute("aria-pressed", String(dark));
    }
  }

  function detectPageDark() {
    if (!profile) return body.classList.contains("enterprise-dark");
    return body.classList.contains(profile.bodyClass);
  }

  function syncThemeFromPage() {
    applyTheme(detectPageDark(), true);
  }

  function markActiveNavigation() {
    const current = normalizePath(location.pathname);
    document.querySelectorAll(".portal-nav a[href]").forEach(link => {
      const target = normalizePath(link.getAttribute("href"));
      const active = target === current ||
        (current === "index" && target === "dashboard") ||
        (current === "dashboard" && target === "index");
      link.classList.toggle("active", active);
      if (active) link.setAttribute("aria-current", "page");
      else if (link.getAttribute("aria-current") === "page") link.removeAttribute("aria-current");
    });
  }

  const commonSaved = localStorage.getItem(commonKey);
  const localSaved = profileDarkFromStorage();
  if (commonSaved === "dark" || commonSaved === "light") {
    applyTheme(commonSaved === "dark", false);
  } else if (localSaved !== null) {
    applyTheme(localSaved, true);
  } else {
    applyTheme(detectPageDark(), false);
  }

  let syncing = false;
  const observer = new MutationObserver(() => {
    if (syncing) return;
    syncing = true;
    try {
      const dark = detectPageDark();
      body.classList.toggle("enterprise-dark", dark);
      body.classList.toggle("enterprise-light", !dark);
      localStorage.setItem(commonKey, dark ? "dark" : "light");
    } finally {
      syncing = false;
    }
  });
  observer.observe(body, { attributes: true, attributeFilter: ["class"] });

  const deviceToggle = document.querySelector("[data-enterprise-theme-toggle]");
  if (deviceToggle) {
    deviceToggle.addEventListener("click", () => {
      applyTheme(!body.classList.contains("enterprise-dark"), true);
    });
  }

  document.querySelectorAll("#themeToggle, #darkModeToggle").forEach(toggle => {
    toggle.addEventListener("click", () => queueMicrotask(syncThemeFromPage));
  });

  markActiveNavigation();
})();