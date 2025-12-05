// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Cloudflare Worker base
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

const ALERT_SETTINGS_KEY = "visionbankAlertSettingsV1";
const ALERT_HISTORY_KEY = "visionbankAlertHistoryV1";

// ===============================
// CC API WRAPPER
// ===============================
async function fetchApi(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      token: TOKEN
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ===============================
// SECURITY GATE
// (Only executed AFTER index.html’s pre-check approves)
// ===============================
async function checkSecurityAccess() {
  // If index.html already evaluated security, reuse it
  if (window.VB_SECURITY) {
    return window.VB_SECURITY.allowed;
  }

  // Rare fallback — recheck directly
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

function formatDate(isoString) {
  if (!isoString) return "--";
  const d = new Date(isoString);
  if (Number.isNaN(d.getTime())) return "--";
  return d.toLocaleString("en-US", { timeZone: "America/Chicago" });
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = value === undefined || value === null ? "--" : value;
}

// Availability mapping:
// GREEN   - Available
// RED     - On Call, Dial Out, On Break
// ORANGE  - Wrap, Lunch, Accept Internal, Busy, Not Set
// YELLOW  - Any unrecognized
// GRAY    - Idle, Unknown
function getAvailabilityClass(status) {
  if (!status) return "status-yellow";
  const s = status.toLowerCase();

  if (s.includes("available")) return "status-available";

  if (
    s.includes("on call") ||
    s.includes("dial-out") ||
    s.includes("dial out") ||
    s.includes("dialing")
  ) {
    return "status-oncall";
  }

  if (s.includes("break")) return "status-break";

  if (s.includes("wrap")) return "status-wrap";
  if (s.includes("lunch")) return "status-lunch";
  if (s.includes("accept")) return "status-orange";
  if (s.includes("busy")) return "status-orange";
  if (s.includes("not set")) return "status-orange";

  if (s.includes("idle")) return "status-idle";
  if (s.includes("unknown")) return "status-unknown";

  // Anything else -> light yellow
  return "status-yellow";
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
  if (!voiceAudio) {
    // Replace with your existing TTS file
    voiceAudio = new Audio("assets/ttsAlert.mp3");
  }
}

function playTone(tone) {
  if (!alertSettings.enableQueueAlerts) return; // respect toggle always
  ensureAudio();
  if (!audioCtx) return;

  const duration = 0.7;
  const now = audioCtx.currentTime;

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  let freq = 880;
  let type = "sine";

  switch (tone) {
    case "bright":
      freq = 1200;
      type = "square";
      break;
    case "pulse":
      freq = 600;
      type = "sawtooth";
      break;
    case "ping":
      freq = 1500;
      type = "triangle";
      break;
    case "alarm":
      freq = 400;
      type = "square";
      break;
    default:
      freq = 880;
      type = "sine";
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
  if (!alertSettings.enableVoiceAlerts) return; // respect toggle
  ensureAudio();
  if (!voiceAudio) return;

  try {
    voiceAudio.pause();
    voiceAudio.currentTime = 0;
  } catch (e) {}

  voiceAudio.volume = Math.max(0, Math.min(1, alertSettings.volume));
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
  popupTimeoutId = setTimeout(
    () => popup.classList.remove("visible"),
    5000
  );
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
  } catch (e) {
    console.warn("Alert history parse error:", e);
  }
}

function saveAlertHistory() {
  try {
    const payload = alertHistory.map(e => ({
      timestamp: e.timestamp.toISOString(),
      calls: e.calls,
      agents: e.agents,
      tone: e.tone,
      voiceEnabled: e.voiceEnabled,
      escalationLevel: e.escalationLevel
    }));
    localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("Alert history save error:", e);
  }
}

function recordAlertEvent({ calls, agents, tone, voiceEnabled, escalationLevel }) {
  const entry = {
    timestamp: new Date(),
    calls: calls ?? 0,
    agents: agents ?? 0,
    tone: tone || alertSettings.tone || "soft",
    voiceEnabled: !!voiceEnabled,
    escalationLevel: escalationLevel ?? getEscalationLevel(calls ?? 0)
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

  const html = alertHistory
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

  listEl.innerHTML = html;
}

function initAlertHistoryUI() {
  loadAlertHistory();
  renderAlertHistory();

  const clearBtn = document.getElementById("clearAlertHistory");
  if (clearBtn) {
    clearBtn.addEventListener("click", e => {
      e.preventDefault();
      alertHistory.length = 0;
      saveAlertHistory();
      renderAlertHistory();
    });
  }
}

// ===============================
// ALERT SETTINGS UI
// ===============================
function initAlertSettingsUI() {
  loadAlertSettings();

  const enableQueueAlertsEl  = document.getElementById("enableQueueAlerts");
  const enableVoiceAlertsEl  = document.getElementById("enableVoiceAlerts");
  const enablePopupAlertsEl  = document.getElementById("enablePopupAlerts");
  const alertToneSelectEl    = document.getElementById("alertToneSelect");
  const alertVolumeEl        = document.getElementById("alertVolume");
  const alertCooldownEl      = document.getElementById("alertCooldown");
  const wallboardModeEl      = document.getElementById("wallboardMode");
  const testButtonEl         = document.getElementById("alertTestButton");

  const alertSettingsToggle  = document.getElementById("alertSettingsToggle");
  const alertSettingsPanel   = document.getElementById("alertSettingsPanel");
  const alertHistoryToggle   = document.getElementById("alertHistoryToggle");
  const alertHistoryPanel    = document.getElementById("alertHistoryPanel");
  const exitWallboardButton  = document.getElementById("exitWallboardButton");

  // Hydrate toggles
  if (enableQueueAlertsEl) {
    enableQueueAlertsEl.checked = alertSettings.enableQueueAlerts;
    enableQueueAlertsEl.addEventListener("change", () => {
      alertSettings.enableQueueAlerts = enableQueueAlertsEl.checked;
      saveAlertSettings();
    });
  }

  if (enableVoiceAlertsEl) {
    enableVoiceAlertsEl.checked = alertSettings.enableVoiceAlerts;
    enableVoiceAlertsEl.addEventListener("change", () => {
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

  if (alertToneSelectEl) {
    alertToneSelectEl.value = alertSettings.tone;
    alertToneSelectEl.addEventListener("change", () => {
      alertSettings.tone = alertToneSelectEl.value;
      saveAlertSettings();
    });
  }

  if (alertVolumeEl) {
    alertVolumeEl.value = Math.round(alertSettings.volume * 100);
    alertVolumeEl.addEventListener("input", () => {
      alertSettings.volume = Number(alertVolumeEl.value) / 100;
      saveAlertSettings();
    });
  }

  if (alertCooldownEl) {
    alertCooldownEl.value = alertSettings.cooldownSeconds;
    alertCooldownEl.addEventListener("change", () => {
      const v = Number(alertCooldownEl.value) || 30;
      alertSettings.cooldownSeconds = Math.max(10, Math.min(300, v));
      alertCooldownEl.value = alertSettings.cooldownSeconds;
      saveAlertSettings();
    });
  }

  // Wallboard handling
  function applyWallboardMode(on) {
    document.body.classList.toggle("wallboard-mode", !!on);
    if (wallboardModeEl) wallboardModeEl.checked = !!on;
    if (exitWallboardButton) {
      exitWallboardButton.classList.toggle("hidden", !on);
    }
  }

  if (wallboardModeEl) {
    applyWallboardMode(alertSettings.wallboardMode);
    wallboardModeEl.addEventListener("change", () => {
      alertSettings.wallboardMode = wallboardModeEl.checked;
      saveAlertSettings();
      applyWallboardMode(alertSettings.wallboardMode);
    });
  }

  if (exitWallboardButton) {
    exitWallboardButton.addEventListener("click", e => {
      e.preventDefault();
      alertSettings.wallboardMode = false;
      saveAlertSettings();
      applyWallboardMode(false);
    });
  }

  if (testButtonEl) {
    testButtonEl.addEventListener("click", () => {
      // Test alert: uses snapshot, but ALWAYS records,
      // and respects toggles for chime/voice/popup.
      const calls  = lastQueueSnapshot.totalCalls || 3;
      const agents = lastQueueSnapshot.totalAgents || 0;

      triggerQueueAlert({
        totalCalls: calls,
        totalAgents: agents,
        queueNames: ["Test Queue"],
        isTest: true
      });
    });
  }

  // Fixed toggles (open/close panels)
  if (alertSettingsToggle && alertSettingsPanel && alertHistoryPanel) {
    alertSettingsToggle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = !alertSettingsPanel.classList.contains("hidden");
      alertSettingsPanel.classList.add("hidden");
      alertHistoryPanel.classList.add("hidden");
      if (!isOpen) alertSettingsPanel.classList.remove("hidden");
    };
  }

  if (alertHistoryToggle && alertSettingsPanel && alertHistoryPanel) {
    alertHistoryToggle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();

      const isOpen = !alertHistoryPanel.classList.contains("hidden");
      alertSettingsPanel.classList.add("hidden");
      alertHistoryPanel.classList.add("hidden");
      if (!isOpen) alertHistoryPanel.classList.remove("hidden");
    };
  }

  // Close panels when clicking outside
  document.addEventListener("click", (e) => {
    if (!alertSettingsPanel && !alertHistoryPanel) return;
    const target = e.target;
    if (
      alertSettingsPanel &&
      !alertSettingsPanel.contains(target) &&
      !alertSettingsToggle.contains(target)
    ) {
      alertSettingsPanel.classList.add("hidden");
    }
    if (
      alertHistoryPanel &&
      !alertHistoryPanel.contains(target) &&
      !alertHistoryToggle.contains(target)
    ) {
      alertHistoryPanel.classList.add("hidden");
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

    const selectId = `queue-tone-${name.replace(/\s+/g, "-")}`;

    row.innerHTML = `
      <label class="queue-override-label" for="${selectId}">
        ${name}
      </label>
      <select id="${selectId}" class="queue-override-select">
        ${toneOptions}
      </select>
    `;

    container.appendChild(row);

    const selectEl = row.querySelector("select");
    const savedTone = alertSettings.queueTones[name];
    if (savedTone) selectEl.value = savedTone;

    selectEl.addEventListener("change", () => {
      alertSettings.queueTones[name] = selectEl.value;
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

  // For real queue events:
  // - Only alert when totalCalls >= 2
  // - Respect cooldown
  if (!isTest) {
    // If all alert channels are off, do nothing
    if (
      !alertSettings.enableQueueAlerts &&
      !alertSettings.enableVoiceAlerts &&
      !alertSettings.enablePopupAlerts
    ) {
      return;
    }

    if (calls <= 1) return; // 0 or 1 call -> no chime/voice, but queue-panel still flashes
    if (now - lastAlertTimestamp < cooldownMs) return;
  }

  lastAlertTimestamp = now;

  // Tone selection (with per-queue override when single queue)
  let tone = alertSettings.tone || "soft";
  if (queueNames && queueNames.length === 1) {
    const qName = queueNames[0];
    if (alertSettings.queueTones[qName]) {
      tone = alertSettings.queueTones[qName];
    }
  }

  const escalationLevel = getEscalationLevel(calls);

  // Respect toggles even for Test alerts:
  if (alertSettings.enableQueueAlerts) {
    playTone(tone);
  }

  if (alertSettings.enableVoiceAlerts) {
    playVoice();
  }

  if (alertSettings.enablePopupAlerts) {
    showAlertPopup("You have calls waiting");
  }

  // Always record in history (including Test)
  recordAlertEvent({
    calls,
    agents,
    tone,
    voiceEnabled: alertSettings.enableVoiceAlerts,
    escalationLevel
  });
}

// ===============================
// QUEUE STATUS (MULTI-QUEUE)
// ===============================
async function loadQueueStatus() {
  const body = document.getElementById("queue-body");
  const panel = document.getElementById("queue-panel");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status...</td></tr>`;

  try {
    const data = await fetchApi("/status/queues");

    if (!data || !Array.isArray(data.QueueStatus) || data.QueueStatus.length === 0) {
      body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
      if (panel) panel.classList.remove("queue-alert-active");
      return;
    }

    const queues = data.QueueStatus;
    let anyHot = false;
    let totalCalls = 0;
    let totalAgents = 0;
    let activeQueueNames = [];

    const rowsHtml = queues
      .map(q => {
        const calls = Number(q.TotalCalls ?? 0);
        const agents = Number(q.TotalLoggedAgents ?? 0);
        const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
        const avgWaitSeconds = q.AvgWaitInterval ?? 0;

        totalCalls += calls;
        totalAgents += agents;

        const isHot = calls > 0;
        if (isHot) {
          anyHot = true;
          activeQueueNames.push(q.QueueName || "Unknown");
        }

        const rowClass = isHot ? "queue-hot" : "";

        return `
          <tr class="${rowClass}">
            <td>${safe(q.QueueName, "Unknown")}</td>
            <td class="numeric">${calls}</td>
            <td class="numeric">${agents}</td>
            <td class="numeric">${formatTime(maxWaitSeconds)}</td>
            <td class="numeric">${formatTime(avgWaitSeconds)}</td>
          </tr>
        `;
      })
      .join("");

    body.innerHTML = rowsHtml;

    lastQueueSnapshot = { totalCalls, totalAgents };

    if (panel) panel.classList.toggle("queue-alert-active", anyHot);

    // Chime + voice + popup only when totalCalls >= 2
    if (anyHot && totalCalls >= 2) {
      triggerQueueAlert({
        totalCalls,
        totalAgents,
        queueNames: activeQueueNames
      });
    }

    updateQueueToneOverrides(queues);
  } catch (err) {
    console.error("Queue load error:", err);
    body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
    if (panel) panel.classList.remove("queue-alert-active");
  }
}

// ===============================
// GLOBAL STATS
// ===============================
async function loadGlobalStats() {
  const errorDiv = document.getElementById("global-error");
  if (errorDiv) errorDiv.textContent = "";

  try {
    const data = await fetchApi("/statistics/global");

    if (!data || !Array.isArray(data.GlobalStatistics) || data.GlobalStatistics.length === 0) {
      if (errorDiv) errorDiv.textContent = "Unable to load global statistics.";
      return;
    }

    const g = data.GlobalStatistics[0];

    setText("gs-total-queued", g.TotalCallsQueued);
    setText("gs-total-transferred", g.TotalCallsTransferred);
    setText("gs-total-abandoned", g.TotalCallsAbandoned);
    setText("gs-max-wait", formatTime(g.MaxQueueWaitingTime));

    setText(
      "gs-service-level",
      g.ServiceLevel != null ? g.ServiceLevel.toFixed(2) + "%" : "--"
    );
    setText("gs-total-received", g.TotalCallsReceived);

    setText(
      "gs-answer-rate",
      g.AnswerRate != null ? g.AnswerRate.toFixed(2) + "%" : "--"
    );
    setText(
      "gs-abandon-rate",
      g.AbandonRate != null ? g.AbandonRate.toFixed(2) + "%" : "--"
    );

    setText("gs-callbacks-registered", g.CallbacksRegistered);
    setText("gs-callbacks-waiting", g.CallbacksWaiting);
  } catch (err) {
    console.error("Global stats error:", err);
    if (errorDiv) errorDiv.textContent = "Unable to load global statistics.";
  }
}

// ===============================
// AGENT STATUS
// ===============================
async function loadAgentStatus() {
  const body = document.getElementById("agent-body");
  if (!body) return;

  body.innerHTML = `<tr><td colspan="11" class="loading">Loading agent data...</td></tr>`;

  try {
    const data = await fetchApi("/status/agents");

    if (!data || !Array.isArray(data.AgentStatus) || data.AgentStatus.length === 0) {
      body.innerHTML = `<tr><td colspan="11" class="error">Unable to load agent data.</td></tr>`;
      return;
    }

    body.innerHTML = "";

    data.AgentStatus.forEach(a => {
      const inbound = a.TotalCallsReceived ?? 0;
      const missed = a.TotalCallsMissed ?? 0;
      const transferred = a.TotalCallsTransferred ?? a.ThirdPartyTransferCount ?? 0;
      const outbound = a.DialoutCount ?? 0;

      const duration = formatTime(a.SecondsInCurrentStatus ?? 0);
      const avgHandleSeconds =
        inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;

      const availabilityClass = getAvailabilityClass(a.CallTransferStatusDesc);

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${safe(a.FullName)}</td>
        <td>${safe(a.TeamName)}</td>
        <td>${safe(a.PhoneExt)}</td>
        <td class="availability-cell ${availabilityClass}">${safe(a.CallTransferStatusDesc)}</td>
        <td class="numeric">${inbound}</td>
        <td class="numeric">${missed}</td>
        <td class="numeric">${transferred}</td>
        <td class="numeric">${outbound}</td>
        <td class="numeric">${formatTime(avgHandleSeconds)}</td>
        <td class="numeric">${duration}</td>
        <td>${formatDate(a.StartDateUtc)}</td>
      `;
      body.appendChild(tr);
    });
  } catch (err) {
    console.error("Agent load error:", err);
    body.innerHTML = `<tr><td colspan="11" class="error">Unable to load agent data.</td></tr>`;
  }
}

// ===============================
// MAIN REFRESH LOOP
// ===============================
function refreshAll() {
  loadQueueStatus();
  loadAgentStatus();
  loadGlobalStats();
}

// ===============================
// INIT
// ===============================
document.addEventListener("DOMContentLoaded", async () => {
  // Extra safety: only continue if security pre-check passed
  const ok = await checkSecurityAccess();
  if (!ok) return;

  initDarkMode();
  initAlertSettingsUI();
  initAlertHistoryUI();

  // ESC exits wallboard mode
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      alertSettings.wallboardMode = false;
      saveAlertSettings();
      document.body.classList.remove("wallboard-mode");
      const wallboardModeEl = document.getElementById("wallboardMode");
      const exitBtn = document.getElementById("exitWallboardButton");
      if (wallboardModeEl) wallboardModeEl.checked = false;
      if (exitBtn) exitBtn.classList.add("hidden");
    }
  });

  refreshAll();
  setInterval(refreshAll, 10000);
});
