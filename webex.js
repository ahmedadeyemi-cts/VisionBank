// =======================================================
// Dashboard JS - Created and Maintained by Ahmed Adeyemi
// =======================================================

// ===============================
// CONFIG
// ===============================
// Cloudflare Worker base - all Webex credentials stay server-side.
const WEBEX_DASHBOARD_BUILD = "2026.08.27-v4";
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
const WEBEX_DASHBOARD_API = `${SECURITY_BASE}/api/webex/dashboard`;
const WEBEX_DASHBOARD_SETTINGS_API = `${SECURITY_BASE}/api/webex/dashboard/settings`;
const WEBEX_DASHBOARD_SETTINGS_SAVE_API = `${SECURITY_BASE}/api/webex/dashboard/settings/save`;

console.info(`Webex Dashboard build ${WEBEX_DASHBOARD_BUILD}`);

const ALERT_SETTINGS_KEY = "visionbankWebexAlertSettingsV1";
const ALERT_HISTORY_KEY = "visionbankWebexAlertHistoryV1";

// Agent Start Date display mode: "session" | "reporting"
let startDateMode =
  localStorage.getItem("webexAgentStartDateMode") || "session";

// ===============================
// MOTD (Message of the Day)
// ===============================
const MOTD_API = `${SECURITY_BASE}/motd`;

let motdState = {
  message: "",
  expiresAt: null
};
let motdInterval = null;

// ===============================
// WEBEX DASHBOARD DATA WRAPPER
// ===============================
let webexDashboardCache = null;
let webexDashboardCacheAt = 0;
let webexDashboardPromise = null;
const WEBEX_CACHE_MS = 3000;

async function fetchWebexDashboard(force = false) {
  if (!force && webexDashboardCache && (Date.now() - webexDashboardCacheAt) < WEBEX_CACHE_MS) {
    return webexDashboardCache;
  }

  if (webexDashboardPromise) return webexDashboardPromise;

  webexDashboardPromise = (async () => {
    const res = await fetch(WEBEX_DASHBOARD_API, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { "Accept": "application/json" }
    });

    const text = await res.text();
    let data = {};

    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      throw new Error(`Webex Dashboard returned invalid JSON (HTTP ${res.status}).`);
    }

    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    webexDashboardCache = data;
    webexDashboardCacheAt = Date.now();
    return data;
  })();

  try {
    return await webexDashboardPromise;
  } finally {
    webexDashboardPromise = null;
  }
}

function invalidateWebexDashboardCache() {
  webexDashboardCacheAt = 0;
}

// ===============================
// SECURITY GATE
// (Only executed AFTER index.html’s pre-check approves)
// ===============================
async function checkSecurityAccess() {
  if (window.VB_SECURITY) return window.VB_SECURITY.allowed;

  try {
    const res = await fetch(`${SECURITY_BASE}/security/check`, {
      method: "GET",
      mode: "cors",
      credentials: "omit"
    });
    if (!res.ok) return false;

    const data = await res.json();
    window.VB_SECURITY = data;
    return data.allowed === true;
  } catch (err) {
    console.error("Security check failed:", err);
    return false;
  }
}

// ===============================
// HELPERS
// ===============================
function safe(value, fallback = "--") {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function formatCountdown(ms) {
  if (ms <= 0) return "expired";

  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}
function getTodayStartCST() {
  const now = new Date();
  const cst = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Chicago" })
  );
  cst.setHours(0, 0, 0, 0);
  return cst;
}
function formatReportingStart() {
  const d = getTodayStartCST();
  return d.toLocaleString("en-US", { timeZone: "America/Chicago" });
}


// ===============================
// MOTD (Message of the Day)
// ===============================
async function loadMotd() {
  try {
    const res = await fetch(MOTD_API, {
      method: "GET",
      mode: "cors",
      credentials: "omit"
    });

    if (!res.ok) return;

    const data = await res.json();
    if (!data.message || !data.expiresAt) {
      motdState = { message: "", expiresAt: null };
      renderMotd();
      return;
    }

    motdState = {
      message: data.message,
      expiresAt: Number(data.expiresAt)
    };

    renderMotd();
  } catch (e) {
    console.warn("MOTD fetch failed:", e);
  }
}
async function saveMotd(message, durationMinutes) {
  const expiresAt = Date.now() + durationMinutes * 60 * 1000;

  try {
    const res = await fetch(MOTD_API, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message, expiresAt })
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.success) {
      throw new Error("MOTD not persisted");
    }

    // ✅ Only render after confirmed KV write
    motdState = { message, expiresAt };
    renderMotd();

  } catch (err) {
    console.error("MOTD save failed:", err);
    alert("Failed to save Message of the Day. It was NOT persisted.");
  }
}

async function clearMotd() {
  try {
    await fetch(MOTD_API, {
      method: "POST",
      mode: "cors",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({})
    });
  } catch (e) {
    console.warn("MOTD clear failed:", e);
  }

  motdState = { message: "", expiresAt: null };
  renderMotd();
}

function renderMotd() {
  const banner = document.getElementById("motdBanner");
  if (!banner) return;

  // Clear any existing countdown timer
  if (motdInterval) {
    clearInterval(motdInterval);
    motdInterval = null;
  }

  if (!motdState.message || !motdState.expiresAt) {
    banner.classList.add("hidden");
    banner.textContent = "";
    return;
  }

  const update = () => {
    const remaining = motdState.expiresAt - Date.now();

    if (remaining <= 0) {
      clearMotd();
      return;
    }

    banner.textContent =
      `${motdState.message} (expires in ${formatCountdown(remaining)})`;

    banner.classList.remove("hidden");
  };

  // Run immediately
  update();

  // Update countdown every second
  motdInterval = setInterval(update, 1000);
}

function formatTime(sec) {
  sec = Number(sec);
  if (!Number.isFinite(sec)) return "00:00:00";

  const sign = sec < 0 ? "-" : "";
  sec = Math.abs(sec);

  const hours = Math.floor(sec / 3600);
  const minutes = Math.floor((sec % 3600) / 60);
  const seconds = Math.floor(sec % 60);

  return (
    sign +
    String(hours).padStart(2, "0") + ":" +
    String(minutes).padStart(2, "0") + ":" +
    String(seconds).padStart(2, "0")
  );
}

function formatDate(value) {
  if (value === undefined || value === null || value === "" || value === -1) return "--";

  let d;
  const numeric = Number(value);

  if (Number.isFinite(numeric) && String(value).trim() !== "") {
    const epochMs = numeric < 1e12 ? numeric * 1000 : numeric;
    d = new Date(epochMs);
  } else {
    d = new Date(value);
  }

  if (Number.isNaN(d.getTime())) return "--";

  return d.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
    timeZoneName: "short"
  });
}

function formatDurationMs(ms) {
  ms = Number(ms || 0);
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  return formatTime(Math.floor(ms / 1000));
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value === undefined || value === null ? "--" : value;
}

// ===============================
// AVAILABILITY MAPPING
// ===============================
function getAvailabilityClass(status) {
  if (!status) return "status-unknown";
  const s = String(status).toLowerCase();

  if (s.includes("available")) return "status-available";

  if (
    s.includes("connected") ||
    s.includes("on call") ||
    s.includes("ringing") ||
    s.includes("dial-out") ||
    s.includes("dial out") ||
    s.includes("dialing")
  ) {
    return "status-oncall";
  }

  if (s.includes("break")) return "status-break";
  if (s.includes("lunch")) return "status-lunch";

  if (
    s.includes("wrap") ||
    s.includes("consult") ||
    s.includes("conference") ||
    s.includes("hold") ||
    s.includes("not-respond") ||
    s.includes("not respond") ||
    s.includes("busy")
  ) {
    return "status-orange";
  }

  if (s.includes("idle")) return "status-idle";
  if (s.includes("unknown")) return "status-unknown";

  return "status-idle";
}

// ===============================
// DARK MODE
// ===============================
function initDarkMode() {
  const btn = document.getElementById("darkModeToggle");
  if (!btn) return;

  function applyDark(on) {
    document.body.classList.toggle("dark-mode", !!on);
    btn.textContent = on ? "☀️ Light Mode" : "🌙 Dark mode";
  }

  const stored = localStorage.getItem("dashboard-dark-mode");
  if (stored === null) {
    const prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    applyDark(prefersDark);
    localStorage.setItem("dashboard-dark-mode", prefersDark ? "1" : "0");
  } else {
    applyDark(stored === "1");
  }

  btn.addEventListener("click", () => {
    const isDark = document.body.classList.toggle("dark-mode");
    btn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark mode";
    localStorage.setItem("dashboard-dark-mode", isDark ? "1" : "0");
  });
}

// ===============================
// GLOBAL WEBEX DASHBOARD SETTINGS
// ===============================
let dashboardSettingsDirty = false;
let lastDashboardSettingsUpdatedAt = null;

let currentDashboardQueueOptions = [];

function markDashboardSettingsDirty(message = "Unsaved changes.") {
  dashboardSettingsDirty = true;
  const status = document.getElementById("dashboardSettingsStatus");
  if (status) status.textContent = message;
}

function renderDashboardQueueSummary(queueOptions = []) {
  const container = document.getElementById("dashboardQueueSummary");
  if (!container) return;

  currentDashboardQueueOptions = Array.isArray(queueOptions) ? queueOptions : [];

  if (!currentDashboardQueueOptions.length) {
    container.textContent = "No Webex queues detected.";
    return;
  }

  container.innerHTML = currentDashboardQueueOptions.map(queue => `
    <label class="dashboard-queue-summary-row dashboard-queue-toggle-row">
      <span class="dashboard-queue-toggle-main">
        <input
          type="checkbox"
          class="dashboard-queue-visibility-checkbox"
          data-queue-id="${escapeHtml(queue.id || "")}"
          data-queue-category="${escapeHtml(queue.category || "telephony")}"
          ${queue.visible ? "checked" : ""}
        />
        <span class="dashboard-queue-toggle-name">
          <strong>${escapeHtml(queue.displayName || queue.sourceName || "Unknown Queue")}</strong>
          ${queue.displayName && queue.sourceName && queue.displayName !== queue.sourceName
            ? `<small>Webex: ${escapeHtml(queue.sourceName)}</small>`
            : ""}
        </span>
      </span>
      <span class="dashboard-queue-category">${escapeHtml(queue.category || "telephony")}</span>
    </label>
  `).join("");

  container.querySelectorAll(".dashboard-queue-visibility-checkbox").forEach(input => {
    input.addEventListener("change", () => markDashboardSettingsDirty());
  });
}

function applyDashboardSettingsToForm(settings = {}, queueOptions = []) {
  if (dashboardSettingsDirty) return;

  const telephony = document.getElementById("showTelephonyQueues");
  const email = document.getElementById("showEmailQueues");
  const outbound = document.getElementById("showOutboundQueue");
  const chat = document.getElementById("showChatQueues");
  const outboundName = document.getElementById("outboundQueueDisplayName");

  if (telephony) telephony.checked = settings.showTelephonyQueues !== false;
  if (email) email.checked = settings.showEmailQueues === true;
  if (outbound) outbound.checked = settings.showOutboundQueue === true;
  if (chat) chat.checked = settings.showChatQueues === true;
  if (outboundName) outboundName.value = settings.outboundQueueDisplayName || "Outbound Calling Queue";

  lastDashboardSettingsUpdatedAt = settings.updatedAt || null;
  renderDashboardQueueSummary(queueOptions);
}

async function loadDashboardSettings(force = false) {
  try {
    if (!force) {
      const dashboard = await fetchWebexDashboard();
      if (dashboard?.settings) {
        applyDashboardSettingsToForm(dashboard.settings, dashboard.queueOptions || []);
        return dashboard.settings;
      }
    }

    const res = await fetch(WEBEX_DASHBOARD_SETTINGS_API, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      headers: { "Accept": "application/json" }
    });

    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    applyDashboardSettingsToForm(data.settings || {}, data.queueOptions || []);
    return data.settings || {};
  } catch (err) {
    console.error("Dashboard settings load error:", err);
    const status = document.getElementById("dashboardSettingsStatus");
    if (status) status.textContent = "Unable to load shared settings.";
    return null;
  }
}

async function saveDashboardSettings() {
  const status = document.getElementById("dashboardSettingsStatus");
  const saveBtn = document.getElementById("saveDashboardSettingsBtn");

  const queueVisibility = {};
  document.querySelectorAll(".dashboard-queue-visibility-checkbox").forEach(input => {
    const id = String(input.dataset.queueId || "");
    if (id) queueVisibility[id] = input.checked === true;
  });

  const payload = {
    showTelephonyQueues: document.getElementById("showTelephonyQueues")?.checked !== false,
    showEmailQueues: document.getElementById("showEmailQueues")?.checked === true,
    showOutboundQueue: document.getElementById("showOutboundQueue")?.checked === true,
    showChatQueues: document.getElementById("showChatQueues")?.checked === true,
    outboundQueueDisplayName:
      document.getElementById("outboundQueueDisplayName")?.value?.trim() ||
      "Outbound Calling Queue",
    queueVisibility
  };

  try {
    if (saveBtn) saveBtn.disabled = true;
    if (status) status.textContent = "Saving shared settings...";

    const res = await fetch(WEBEX_DASHBOARD_SETTINGS_SAVE_API, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok || data.success === false) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    dashboardSettingsDirty = false;
    lastDashboardSettingsUpdatedAt = data.settings?.updatedAt || null;
    if (status) status.textContent = "Saved. All open dashboards will update within about 10 seconds.";

    invalidateWebexDashboardCache();
    await refreshAll();
  } catch (err) {
    console.error("Dashboard settings save error:", err);
    if (status) status.textContent = `Save failed: ${err.message}`;
  } finally {
    if (saveBtn) saveBtn.disabled = false;
  }
}

function initDashboardSettingsUI() {
  const toggle = document.getElementById("dashboardSettingsToggle");
  const panel = document.getElementById("dashboardSettingsPanel");
  const saveBtn = document.getElementById("saveDashboardSettingsBtn");
  const alertPanel = document.getElementById("alertSettingsPanel");
  const historyPanel = document.getElementById("alertHistoryPanel");

  const inputs = [
    document.getElementById("showTelephonyQueues"),
    document.getElementById("showEmailQueues"),
    document.getElementById("showOutboundQueue"),
    document.getElementById("showChatQueues"),
    document.getElementById("outboundQueueDisplayName")
  ].filter(Boolean);

  inputs.forEach(input => {
    input.addEventListener("change", () => markDashboardSettingsDirty());

    if (input.tagName === "INPUT" && input.type === "text") {
      input.addEventListener("input", () => markDashboardSettingsDirty());
    }
  });

  // Category switches are convenient bulk controls. Individual queue checkboxes
  // remain authoritative when the settings are saved.
  const categoryBindings = [
    ["showTelephonyQueues", "telephony"],
    ["showEmailQueues", "email"],
    ["showOutboundQueue", "outbound"],
    ["showChatQueues", "chat"]
  ];

  for (const [controlId, category] of categoryBindings) {
    const control = document.getElementById(controlId);
    if (!control) continue;

    control.addEventListener("change", () => {
      document.querySelectorAll(
        `.dashboard-queue-visibility-checkbox[data-queue-category="${category}"]`
      ).forEach(queueInput => {
        queueInput.checked = control.checked;
      });
      markDashboardSettingsDirty();
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", saveDashboardSettings);
  }

  if (toggle && panel) {
    toggle.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const opening = panel.classList.contains("hidden");
      panel.classList.toggle("hidden");

      if (alertPanel) alertPanel.classList.add("hidden");
      if (historyPanel) historyPanel.classList.add("hidden");

      if (opening) {
        dashboardSettingsDirty = false;
        await loadDashboardSettings(true);
      }
    });
  }

  document.addEventListener("click", (e) => {
    if (
      panel &&
      !panel.classList.contains("hidden") &&
      !panel.contains(e.target) &&
      e.target !== toggle
    ) {
      panel.classList.add("hidden");
      dashboardSettingsDirty = false;
    }
  });
}

// ===============================
// ALERT SETTINGS / AUDIO
// ===============================
let alertSettings = {
  enableQueueAlerts: true,
  enableVoiceAlerts: true,
  enablePopupAlerts: true,
  tone: "soft",
  volume: 0.8,
  cooldownSeconds: 30,
  wallboardMode: false,
  queueTones: {}
};

let lastAlertTimestamp = 0;
let lastQueueSnapshot = { totalCalls: 0, totalAgents: 0 };

let audioCtx = null;
let voiceAudio = null;
function unlockAudio() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;

  if (!audioCtx) {
    audioCtx = new Ctor();
  }

  if (audioCtx.state !== "running") {
    audioCtx.resume().catch(err => {
      console.warn("Audio resume failed:", err);
    });
  }

  if (!voiceAudio) {
    voiceAudio = new Audio("assets/ttsAlert.mp3");
  }
}

function loadAlertSettings() {
  try {
    const raw = localStorage.getItem(ALERT_SETTINGS_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    alertSettings = {
      ...alertSettings,
      ...parsed,
      queueTones: parsed.queueTones || {}
    };
  } catch (e) {
    console.warn("Alert settings parse error:", e);
  }
}

function saveAlertSettings() {
  try {
    localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(alertSettings));
  } catch (e) {
    console.warn("Alert settings save error:", e);
  }
}

function ensureAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (Ctor) audioCtx = new Ctor();
  }
  if (!voiceAudio) voiceAudio = new Audio("assets/ttsAlert.mp3");
}

function playTone(tone) {
  unlockAudio();
  if (!alertSettings.enableQueueAlerts) return;
  ensureAudio();
  if (!audioCtx) return;

  const duration = 0.7;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  let freq = 880;
  let type = "sine";

  switch (tone) {
    case "bright": freq = 1200; type = "square"; break;
    case "pulse": freq = 600; type = "sawtooth"; break;
    case "ping": freq = 1500; type = "triangle"; break;
    case "alarm": freq = 400; type = "square"; break;
  }

  osc.type = type;
  osc.frequency.value = freq;

  const vol = Math.max(0, Math.min(1, alertSettings.volume));
  gain.gain.setValueAtTime(vol, now);
  gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

  osc.connect(gain).connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function playVoice() {
  unlockAudio();
  if (!alertSettings.enableVoiceAlerts) return;
  ensureAudio();
  if (!voiceAudio) return;

  voiceAudio.pause();
  voiceAudio.currentTime = 0;
  voiceAudio.volume = alertSettings.volume;
  voiceAudio.play().catch(() => {});
}

// ===============================
// POPUP ALERT
// ===============================
let popupTimeoutId = null;
function showAlertPopup(message) {
  if (!alertSettings.enablePopupAlerts) return;

  const popup = document.getElementById("queueAlertPopup");
  if (!popup) return;

  popup.textContent = message || "You have calls waiting";
  popup.classList.add("visible");

  if (popupTimeoutId) clearTimeout(popupTimeoutId);
  popupTimeoutId = setTimeout(() => {
    popup.classList.remove("visible");
  }, 5000);
}

// ===============================
// ESCALATION LEVELS
// ===============================
function getEscalationLevel(totalCalls) {
  if (totalCalls <= 1) return 0;
  if (totalCalls <= 3) return 1;
  if (totalCalls <= 6) return 2;
  return 3;
}

// ===============================
// ALERT HISTORY
// ===============================

const alertHistory = [];
const MAX_ALERT_HISTORY = 100;

function loadAlertHistory() {
  try {
    const raw = localStorage.getItem(ALERT_HISTORY_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;

    alertHistory.length = 0;
    parsed.forEach(e => {
      if (!e.timestamp) return;
      alertHistory.push({
        timestamp: new Date(e.timestamp),
        calls: e.calls ?? 0,
        agents: e.agents ?? 0,
        tone: e.tone || "soft",
        voiceEnabled: !!e.voiceEnabled,
        escalationLevel: e.escalationLevel ?? 0
      });
    });
  } catch {}
}

function saveAlertHistory() {
  const payload = alertHistory.map(e => ({
    timestamp: e.timestamp.toISOString(),
    calls: e.calls,
    agents: e.agents,
    tone: e.tone,
    voiceEnabled: e.voiceEnabled,
    escalationLevel: e.escalationLevel
  }));
  localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(payload));
}

function recordAlertEvent({ calls, agents, tone, voiceEnabled, escalationLevel }) {
  const entry = {
    timestamp: new Date(),
    calls,
    agents,
    tone,
    voiceEnabled,
    escalationLevel
  };

  alertHistory.unshift(entry);
  if (alertHistory.length > MAX_ALERT_HISTORY) alertHistory.pop();

  saveAlertHistory();
  renderAlertHistory();
}

function renderAlertHistory() {
  const listEl = document.getElementById("alertHistoryList");
  if (!listEl) return;

  if (alertHistory.length === 0) {
    listEl.innerHTML = `<div class="history-empty">No alerts yet.</div>`;
    return;
  }

  listEl.innerHTML = alertHistory
    .map(entry => {
      const timeStr = entry.timestamp.toLocaleString("en-US", {
        month: "numeric",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
      });

      return `
        <div class="history-item">
          <div class="history-time">${timeStr}</div>
          <div>Calls: ${entry.calls}</div>
          <div>Agents: ${entry.agents}</div>
          <div>Tone: ${entry.tone}</div>
          <div>Voice: ${entry.voiceEnabled ? "Yes" : "No"}</div>
        </div>
      `;
    })
    .join("");
}
// ===============================
// CLEAR ALERT HISTORY
// ===============================
function clearAlertHistory() {
  // Clear in-memory array
  alertHistory.length = 0;

  // Remove stored history
  localStorage.removeItem(ALERT_HISTORY_KEY);

  // Update UI
  renderAlertHistory();
}

// ===============================
// ALERT SETTINGS UI
// ===============================

function initAlertSettingsUI() {
  loadAlertSettings();
  loadAlertHistory();
  renderAlertHistory();

  const enableQueueAlertsEl = document.getElementById("enableQueueAlerts");
  const enableVoiceAlertsEl = document.getElementById("enableVoiceAlerts");
  const enablePopupAlertsEl = document.getElementById("enablePopupAlerts");
  const toneSelectEl       = document.getElementById("alertToneSelect");
  const volumeEl           = document.getElementById("alertVolume");
  const cooldownEl         = document.getElementById("alertCooldown");
  const wallboardModeEl    = document.getElementById("wallboardMode");
  const testBtn            = document.getElementById("alertTestButton");
  const clearHistoryBtn = document.getElementById("clearAlertHistory");
  const settingsToggle     = document.getElementById("alertSettingsToggle");
  const settingsPanel      = document.getElementById("alertSettingsPanel");
  const historyToggle      = document.getElementById("alertHistoryToggle");
  const historyPanel       = document.getElementById("alertHistoryPanel");
  const exitWallboardBtn   = document.getElementById("exitWallboardButton");
  const motdTextEl     = document.getElementById("motdText");
  const motdDurationEl = document.getElementById("motdDuration");
  const motdSaveBtn    = document.getElementById("motdSaveButton");
  const motdClearBtn   = document.getElementById("motdClearButton");


  if (enableQueueAlertsEl) {
enableQueueAlertsEl.addEventListener("change", () => {
  unlockAudio();
  alertSettings.enableQueueAlerts = enableQueueAlertsEl.checked;
  saveAlertSettings();
});

  }

  if (enableVoiceAlertsEl) {
    enableVoiceAlertsEl.checked = alertSettings.enableVoiceAlerts;
    enableVoiceAlertsEl.addEventListener("change", () => {
  unlockAudio();
  alertSettings.enableVoiceAlerts = enableVoiceAlertsEl.checked;
  saveAlertSettings();
});

  }

  if (enablePopupAlertsEl) {
    enablePopupAlertsEl.checked = alertSettings.enablePopupAlerts;
    enablePopupAlertsEl.addEventListener("change", () => {
      alertSettings.enablePopupAlerts = enablePopupAlertsEl.checked;
      saveAlertSettings();
    });
  }

  if (toneSelectEl) {
    toneSelectEl.value = alertSettings.tone;
    toneSelectEl.addEventListener("change", () => {
      alertSettings.tone = toneSelectEl.value;
      saveAlertSettings();
    });
  }

  if (volumeEl) {
    volumeEl.value = Math.round(alertSettings.volume * 100);
    volumeEl.addEventListener("input", () => {
      alertSettings.volume = Number(volumeEl.value) / 100;
      saveAlertSettings();
    });
  }

  if (cooldownEl) {
    cooldownEl.value = alertSettings.cooldownSeconds;
    cooldownEl.addEventListener("change", () => {
      let v = Number(cooldownEl.value) || 30;
      alertSettings.cooldownSeconds = Math.max(10, Math.min(v, 300));
      cooldownEl.value = alertSettings.cooldownSeconds;
      saveAlertSettings();
    });
  }

  // Wallboard mode
  function applyWallboard(on) {
    document.body.classList.toggle("wallboard-mode", !!on);
    if (exitWallboardBtn) exitWallboardBtn.classList.toggle("hidden", !on);
  }

  if (wallboardModeEl) {
    wallboardModeEl.checked = alertSettings.wallboardMode;
    applyWallboard(alertSettings.wallboardMode);

    wallboardModeEl.addEventListener("change", () => {
      alertSettings.wallboardMode = wallboardModeEl.checked;
      saveAlertSettings();
      applyWallboard(alertSettings.wallboardMode);
    });
  }

  if (exitWallboardBtn) {
    exitWallboardBtn.addEventListener("click", () => {
      alertSettings.wallboardMode = false;
      saveAlertSettings();
      applyWallboard(false);
      if (wallboardModeEl) wallboardModeEl.checked = false;
    });
  }

if (testBtn) {
  testBtn.addEventListener("click", () => {
    unlockAudio();
    triggerQueueAlert({
      totalCalls: lastQueueSnapshot.totalCalls ?? 0,
      totalAgents: lastQueueSnapshot.totalAgents ?? 0,
      queueNames: ["Test Queue"],
      isTest: true
    });
  });
}
if (clearHistoryBtn) {
  clearHistoryBtn.addEventListener("click", () => {
    clearAlertHistory();
  });
}
// ===============================
// MOTD UI HANDLERS
// ===============================
if (motdSaveBtn && motdTextEl && motdDurationEl) {
  motdSaveBtn.addEventListener("click", () => {
    const msg = motdTextEl.value.trim();
    const mins = Number(motdDurationEl.value) || 60;

    if (!msg) return;

    saveMotd(msg, Math.max(1, mins));
  });
}

if (motdClearBtn) {
  motdClearBtn.addEventListener("click", () => {
    clearMotd();
    if (motdTextEl) motdTextEl.value = "";
  });
}
  // Toggle panels
  if (settingsToggle && settingsPanel) {
    settingsToggle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      settingsPanel.classList.toggle("hidden");
      if (!historyPanel.classList.contains("hidden"))
        historyPanel.classList.add("hidden");
    };
  }

  if (historyToggle && historyPanel) {
    historyToggle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      historyPanel.classList.toggle("hidden");
      if (!settingsPanel.classList.contains("hidden"))
        settingsPanel.classList.add("hidden");
    };
  }

  // Close panels on outside click
  document.addEventListener("click", (e) => {
    if (settingsPanel && !settingsPanel.contains(e.target) && e.target !== settingsToggle) {
      settingsPanel.classList.add("hidden");
    }
    if (historyPanel && !historyPanel.contains(e.target) && e.target !== historyToggle) {
      historyPanel.classList.add("hidden");
    }
  });
}

// ===============================
// QUEUE TONE OVERRIDES
// ===============================
function updateQueueToneOverrides(queues) {
  const container = document.getElementById("queueToneOverrides");
  if (!container) return;

  if (!queues || queues.length === 0) {
    container.innerHTML = `<div class="queue-override-empty">No queues loaded yet.</div>`;
    return;
  }

  const toneOptions = `
    <option value="soft">Soft chime</option>
    <option value="bright">Bright bell</option>
    <option value="pulse">Pulse beep</option>
    <option value="ping">Ping tone</option>
    <option value="alarm">Alarm tone</option>
  `;

  container.innerHTML = "";
  queues.forEach(q => {
    const name = q.QueueName || "Unknown Queue";
    const row = document.createElement("div");
    row.className = "queue-override-row";

    const id = `queue-tone-${name.replace(/\s+/g, "-")}`;

    row.innerHTML = `
      <label class="queue-override-label" for="${id}">${name}</label>
      <select id="${id}" class="queue-override-select">${toneOptions}</select>
    `;

    container.appendChild(row);

    const select = row.querySelector("select");
    const savedTone = alertSettings.queueTones[name];
    if (savedTone) select.value = savedTone;

    select.addEventListener("change", () => {
      alertSettings.queueTones[name] = select.value;
      saveAlertSettings();
    });
  });
}

// ===============================
// QUEUE ALERT LOGIC
// ===============================
function triggerQueueAlert({ totalCalls, totalAgents, queueNames, isTest = false }) {
  const calls = totalCalls ?? 0;
  const agents = totalAgents ?? 0;
  const now = Date.now();
  const cooldownMs = (alertSettings.cooldownSeconds || 30) * 1000;

if (!isTest) {
  if (
    !alertSettings.enableQueueAlerts &&
    !alertSettings.enableVoiceAlerts &&
    !alertSettings.enablePopupAlerts
  ) return;

  if (calls <= 1) return;
  if (now - lastAlertTimestamp < cooldownMs) return;
} else {
  // ✅ Test alerts always bypass suppression
  lastAlertTimestamp = 0;
}

  lastAlertTimestamp = now;

  let tone = alertSettings.tone;
  if (queueNames && queueNames.length === 1) {
    const qn = queueNames[0];
    if (alertSettings.queueTones[qn]) {
      tone = alertSettings.queueTones[qn];
    }
  }

  const escalationLevel = getEscalationLevel(calls);

  if (alertSettings.enableQueueAlerts) playTone(tone);
  if (alertSettings.enableVoiceAlerts) playVoice();
  if (alertSettings.enablePopupAlerts) showAlertPopup("You have calls waiting");

  recordAlertEvent({
    calls,
    agents,
    tone,
    voiceEnabled: alertSettings.enableVoiceAlerts,
    escalationLevel
  });
}

// ===============================
// QUEUE STATUS (WEBEX)
// ===============================
async function loadQueueStatus() {
  const body = document.getElementById("queue-body");
  const panel = document.getElementById("queue-panel");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status...</td></tr>`;

  try {
    const data = await fetchWebexDashboard();
    if (data?.settings && !dashboardSettingsDirty) {
      applyDashboardSettingsToForm(data.settings, data.queueOptions || []);
    }
    const queues = Array.isArray(data?.queues) ? data.queues : [];

    if (!queues.length) {
      body.innerHTML = `<tr><td colspan="5" class="error">No Webex queues were returned.</td></tr>`;
      if (panel) panel.classList.remove("queue-alert-active");
      return;
    }

    let anyHot = false;
    let totalCalls = 0;
    let totalAgents = 0;
    const activeQueues = [];

    body.innerHTML = queues.map(q => {
      const calls = Number(q.calls || 0);
      const agents = Number(q.agents || 0);
      totalCalls += calls;
      totalAgents += agents;

      if (calls > 0) {
        anyHot = true;
        activeQueues.push(q.name);
      }

      let callsClass = "queue-calls-green";
      if (calls === 1) callsClass = "queue-calls-yellow";
      else if (calls >= 2) callsClass = "queue-calls-red";

      return `
        <tr class="${calls > 0 ? "queue-hot" : ""}">
          <td>${safe(q.name, "Unknown")}</td>
          <td class="numeric"><span class="queue-calls-badge ${callsClass}">${calls}</span></td>
          <td class="numeric">${agents}</td>
          <td class="numeric">${safe(q.maxWait, "00:00:00")}</td>
          <td class="numeric">${safe(q.avgWait, "00:00:00")}</td>
        </tr>`;
    }).join("");

    lastQueueSnapshot = { totalCalls, totalAgents };
    if (panel) panel.classList.toggle("queue-alert-active", anyHot);

    if (anyHot && totalCalls >= 2) {
      triggerQueueAlert({ totalCalls, totalAgents, queueNames: activeQueues });
    }

    // Existing tone override UI only needs a QueueName-like value.
    updateQueueToneOverrides(queues.map(q => ({ QueueName: q.name })));
  } catch (err) {
    console.error("Webex queue load error:", err);
    body.innerHTML = `<tr><td colspan="5" class="error">Unable to load Webex queue status.</td></tr>`;
  }
}
function renderEntryPointStats(entryPoints) {
  const value1 = document.getElementById("gs-entry-point-1");
  const value2 = document.getElementById("gs-entry-point-2");
  const label1 = document.getElementById("gs-entry-point-label-1");
  const label2 = document.getElementById("gs-entry-point-label-2");

  if (!value1 || !value2 || !label1 || !label2) return;

  const entries = Array.isArray(entryPoints)
    ? entryPoints.filter(e => e && e.name)
    : [];

  value1.classList.remove("entry-point-stat-list");
  value2.classList.remove("entry-point-stat-list");

  if (entries.length === 0) {
    value1.textContent = "0";
    value2.textContent = "0";
    label1.textContent = "Calls by Entry Point - No data";
    label2.textContent = "Calls by Entry Point - No data";
    return;
  }

  if (entries.length <= 2) {
    const first = entries[0];
    value1.textContent = Number(first.calls || 0);
    label1.textContent = `Entry Point: ${first.name}`;

    if (entries[1]) {
      value2.textContent = Number(entries[1].calls || 0);
      label2.textContent = `Entry Point: ${entries[1].name}`;
    } else {
      value2.textContent = "0";
      label2.textContent = "Additional Entry Points";
    }
    return;
  }

  const splitAt = Math.ceil(entries.length / 2);
  const groups = [entries.slice(0, splitAt), entries.slice(splitAt)];

  const renderList = group => group.map(entry => `
    <div class="entry-point-stat-row" title="${escapeHtml(entry.name)}">
      <span class="entry-point-stat-name">${escapeHtml(entry.name)}</span>
      <span class="entry-point-stat-count">${Number(entry.calls || 0)}</span>
    </div>
  `).join("");

  value1.classList.add("entry-point-stat-list");
  value2.classList.add("entry-point-stat-list");
  value1.innerHTML = renderList(groups[0]);
  value2.innerHTML = renderList(groups[1]);
  label1.textContent = "Calls by Entry Point";
  label2.textContent = "Calls by Entry Point (cont.)";
}

// ===============================
// GLOBAL STATS (WEBEX)
// ===============================
async function loadGlobalStats() {
  const errorDiv = document.getElementById("global-error");
  if (errorDiv) errorDiv.textContent = "";

  try {
    const data = await fetchWebexDashboard();
    const g = data?.statistics;

    if (!g) {
      if (errorDiv) errorDiv.textContent = "Unable to load Webex global statistics.";
      return;
    }

    setText("gs-total-queued", g.totalCallsQueued);
    setText("gs-total-transferred", g.totalCallsAnswered);
    setText("gs-total-abandoned", g.totalCallsAbandoned);
    setText("gs-max-wait", g.maxQueueWaitingTime || "00:00:00");
    setText("gs-service-level", Number(g.serviceLevel || 0).toFixed(2) + "%");
    setText("gs-total-received", g.totalCallsReceived);
    setText("gs-answer-rate", Number(g.answerRate || 0).toFixed(2) + "%");
    setText("gs-abandon-rate", Number(g.abandonRate || 0).toFixed(2) + "%");
    setText("gs-callbacks-registered", g.callbacksRegistered);
    setText("gs-callbacks-waiting", g.callbacksWaiting);
    renderEntryPointStats(g.entryPoints || []);
  } catch (err) {
    console.error("Webex global stats error:", err);
    if (errorDiv) errorDiv.textContent = "Unable to load Webex global statistics.";
  }
}

// ===============================
// AGENT STATUS (WEBEX)
// ===============================
async function loadAgentStatus() {
  const body = document.getElementById("agent-body");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="11" class="loading">Loading Webex agent data...</td></tr>`;

  try {
    const data = await fetchWebexDashboard();
    const agents = Array.isArray(data?.agents) ? data.agents : [];

    if (!agents.length) {
      body.innerHTML = `<tr><td colspan="11" class="loading">No Webex agents are currently logged in.</td></tr>`;
      return;
    }

    body.innerHTML = "";

    agents.forEach(a => {
      const availabilityClass = getAvailabilityClass(a.status);

      const startDateDisplay =
        startDateMode === "reporting" && a.sessionRolledOver
          ? safe(a.reportingStartCentral, "--")
          : safe(a.sessionStartCentral, "--");

      const showWarning = startDateMode === "session" && a.sessionRolledOver;

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${safe(a.name)}</td>
        <td>${safe(a.team)}</td>
        <td>${safe(a.number)}</td>
        <td class="availability-cell ${availabilityClass}">${safe(a.status)}</td>
        <td class="numeric">${safe(a.duration, "00:00:00")}</td>
        <td class="numeric">${Number(a.inbound || 0)}</td>
        <td class="numeric">${Number(a.missed || 0)}</td>
        <td class="numeric">${Number(a.transferred || 0)}</td>
        <td class="numeric">${Number(a.outbound || 0)}</td>
        <td class="numeric">${safe(a.avgHandle, "00:00:00")}</td>
        <td>
          ${startDateDisplay}
          ${showWarning ? `
            <span
              class="startdate-warning"
              title="This Webex agent session began on a previous Central reporting day. Please verify that the agent intended to remain logged in."
            >⚠️</span>` : ""}
        </td>`;

      body.appendChild(tr);
    });
  } catch (err) {
    console.error("Webex agent load error:", err);
    body.innerHTML = `<tr><td colspan="11" class="error">Unable to load Webex agent data.</td></tr>`;
  }
}

// ===============================
// MAIN REFRESH LOOP
// ===============================
async function refreshAll() {
  invalidateWebexDashboardCache();
  await Promise.all([
    loadQueueStatus(),
    loadAgentStatus(),
    loadGlobalStats()
  ]);
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  const ok = await checkSecurityAccess();
  if (!ok) return;

  initDarkMode();
  initAlertSettingsUI();
  initDashboardSettingsUI();
  loadMotd();                 // loads + renders
  setInterval(loadMotd, 60000);

// ===============================
// Agent Start Date Toggle
// ===============================
document
  .querySelectorAll('input[name="startDateMode"]')
  .forEach(radio => {
    radio.checked = radio.value === startDateMode;

    radio.addEventListener("change", () => {
      startDateMode = radio.value;
      localStorage.setItem("webexAgentStartDateMode", startDateMode);
      loadAgentStatus(); // re-render agent table only
    });
  });


  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      alertSettings.wallboardMode = false;
      saveAlertSettings();
      document.body.classList.remove("wallboard-mode");
      const exitBtn = document.getElementById("exitWallboardButton");
      const wallboardModeEl = document.getElementById("wallboardMode");
      if (exitBtn) exitBtn.classList.add("hidden");
      if (wallboardModeEl) wallboardModeEl.checked = false;
    }
  });

  refreshAll();
  setInterval(refreshAll, 10000);
});
