(() => {
  "use strict";

  const body = document.body;
  if (!body) return;

  function normalizePath(value) {
    let path = String(value || "").split("?")[0].split("#")[0];
    path = path.replace(/^https?:\/\/[^/]+/i, "");
    path = path.split("/").pop() || "index";
    path = path.replace(/\.html$/i, "");
    if (!path) path = "index";
    return path.toLowerCase();
  }

  const page = normalizePath(location.pathname);
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
      if (profile.bodyClass !== "enterprise-dark") body.classList.toggle(profile.bodyClass, dark);
      localStorage.setItem(profile.key, dark ? profile.darkValue : profile.lightValue);
    }
    body.classList.toggle("enterprise-dark", dark);
    if (persist) localStorage.setItem(commonKey, dark ? "dark" : "light");

    const deviceToggle = document.querySelector("[data-enterprise-theme-toggle]");
    if (deviceToggle) {
      deviceToggle.textContent = dark ? "Light mode" : "Dark mode";
      deviceToggle.setAttribute("aria-pressed", String(dark));
    }
  }

  function detectDark() {
    if (profile?.bodyClass && body.classList.contains(profile.bodyClass)) return true;
    return body.classList.contains("theme-dark") ||
      body.classList.contains("dark-mode") ||
      body.classList.contains("dark") ||
      body.classList.contains("enterprise-dark");
  }

  function syncThemeFromPage() {
    applyTheme(detectDark(), true);
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
    applyTheme(detectDark(), false);
  }

  let syncing = false;
  const observer = new MutationObserver(() => {
    if (syncing) return;
    syncing = true;
    try {
      const dark = detectDark();
      body.classList.toggle("enterprise-dark", dark);
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