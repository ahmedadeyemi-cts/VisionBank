// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Small helper to call API with token
async function fetchApi(path) {
    const res = await fetch(`${API_BASE}${path}`, {
        headers: {
            "Content-Type": "application/json",
            "token": TOKEN
        }
    });

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
    return res.json();
}

// ===============================
// HELPERS
// ===============================
function formatTime(sec) {
    if (sec === undefined || sec === null || isNaN(sec)) return "00:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(utc) {
    if (!utc) return "--";
    // Force UTC and convert to US Central
    return new Date(utc + "Z").toLocaleString("en-US", { timeZone: "America/Chicago" });
}

function safe(value, fallback = "--") {
    return value === undefined || value === null ? fallback : value;
}

// Map status text to availability class
function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();

    // Available → Green
    if (s.includes("available")) return "status-available";

    // On Call / Dialing → Red
    if (s.includes("on call") || s.includes("dial") || s.includes("talk")) {
        return "status-oncall";
    }

    // Busy / Not Set / On Break → Yellow
    if (s.includes("busy") || s.includes("not set") || s.includes("break")) {
        return "status-busy";
    }

    // Ringing / Accept Internal Calls / Wrap-up → Orange
    if (
        s.includes("ring") ||
        s.includes("accept internal") ||
        s.includes("wrap")
    ) {
        return "status-ringing";
    }

    return "";
}

// ===============================
// ALERT ENGINE
// ===============================
const ALERT_STORAGE_KEY = "visionbank-alert-settings-v1";

const defaultAlertSettings = {
    enableQueueAlerts: true,
    enableVoiceAlerts: true,
    enablePopupAlerts: true,
    tone: "soft",
    volume: 0.8,           // 0–1
    cooldownSeconds: 30,   // default 30 seconds
    wallboardMode: false
};

let alertSettings = { ...defaultAlertSettings };
let lastAlertTime = 0;

let audioContext = null;
const voiceAudio = new Audio("assets/ttsAlert.mp3");
voiceAudio.preload = "auto";

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function ensureAudioContext() {
    if (!window.AudioContext && !window.webkitAudioContext) {
        return null;
    }
    if (!audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioContext = new Ctx();
    } else if (audioContext.state === "suspended") {
        audioContext.resume();
    }
    return audioContext;
}

function playTone(toneType, volume, isHighVolume) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const baseVolume = clamp(volume, 0, 1);
    const duration = 0.8;
    const now = ctx.currentTime;

    // Different "flavors" of chime
    let freqs;
    switch (toneType) {
        case "bright":
            freqs = [880, 1320];
            break;
        case "pulse":
            freqs = [600, 900];
            break;
        case "soft":
        default:
            freqs = [520, 780];
            break;
    }

    if (isHighVolume) {
        freqs = freqs.map(f => f * 1.25);
    }

    freqs.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(baseVolume, now + 0.03 + idx * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + idx * 0.05);

        osc.start(now);
        osc.stop(now + duration + 0.1 + idx * 0.05);
    });
}

function triggerAlert(state) {
    const vol = clamp(alertSettings.volume, 0, 1);

    // Voice alert
    if (alertSettings.enableVoiceAlerts) {
        try {
            voiceAudio.pause();
            voiceAudio.currentTime = 0;
            voiceAudio.volume = vol;
            void voiceAudio.play();
        } catch (e) {
            console.warn("Voice alert play failed:", e);
        }
    }

    // Tone alert (uses selected tone, higher pitch when calls are high)
    const isHighVolume = state.totalCalls >= 5;
    playTone(alertSettings.tone, vol, isHighVolume);

    // Notification pop-up
    if (alertSettings.enablePopupAlerts && "Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("Calls waiting", {
                body: `You have ${state.totalCalls} call(s) waiting in queue.`,
                tag: "visionbank-queue-alert"
            });
        }
    }
}

function updateAlertsFromQueues(queues) {
    const panel = document.getElementById("queue-panel");
    if (!panel) return;

    if (!Array.isArray(queues) || queues.length === 0) {
        panel.classList.remove("queue-alert");
        return;
    }

    let totalCalls = 0;
    let maxWaitSeconds = 0;

    queues.forEach(q => {
        const calls = Number(q.TotalCalls ?? 0);
        totalCalls += calls;

        const waitSec = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
        if (waitSec > maxWaitSeconds) {
            maxWaitSeconds = waitSec;
        }
    });

    const hasCalls = totalCalls > 0;

    if (!hasCalls) {
        panel.classList.remove("queue-alert");
        return;
    }

    // Visual highlight on panel when there are calls waiting
    panel.classList.add("queue-alert");

    if (!alertSettings.enableQueueAlerts) return;

    const now = Date.now();
    const cooldownMs = (alertSettings.cooldownSeconds || 30) * 1000;

    if (now - lastAlertTime < cooldownMs) {
        return;
    }

    lastAlertTime = now;
    triggerAlert({ totalCalls, maxWaitSeconds });
}

// ===============================
// ALERT SETTINGS UI
// ===============================
function loadAlertSettings() {
    try {
        const stored = localStorage.getItem(ALERT_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            alertSettings = { ...defaultAlertSettings, ...parsed };
        } else {
            alertSettings = { ...defaultAlertSettings };
        }
    } catch (e) {
        console.warn("Failed to load alert settings:", e);
        alertSettings = { ...defaultAlertSettings };
    }
}

function saveAlertSettings() {
    try {
        localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertSettings));
    } catch (e) {
        console.warn("Failed to save alert settings:", e);
    }
}

function initAlertSettings() {
    loadAlertSettings();

    const toggleBtn = document.getElementById("alertSettingsToggle");
    const panel = document.getElementById("alertSettingsPanel");
    const enableQueue = document.getElementById("enableQueueAlerts");
    const enableVoice = document.getElementById("enableVoiceAlerts");
    const enablePopup = document.getElementById("enablePopupAlerts");
    const toneSelect = document.getElementById("alertToneSelect");
    const volumeSlider = document.getElementById("alertVolume");
    const cooldownInput = document.getElementById("alertCooldown");
    const wallboardCheckbox = document.getElementById("wallboardMode");

    // Apply stored settings to UI
    if (enableQueue) enableQueue.checked = alertSettings.enableQueueAlerts;
    if (enableVoice) enableVoice.checked = alertSettings.enableVoiceAlerts;
    if (enablePopup) enablePopup.checked = alertSettings.enablePopupAlerts;
    if (toneSelect) toneSelect.value = alertSettings.tone;
    if (volumeSlider) volumeSlider.value = Math.round(alertSettings.volume * 100);
    if (cooldownInput) cooldownInput.value = alertSettings.cooldownSeconds;
    if (wallboardCheckbox) wallboardCheckbox.checked = alertSettings.wallboardMode;

    if (alertSettings.wallboardMode) {
        document.body.classList.add("wallboard-mode");
    }

    // Open/close panel
    if (toggleBtn && panel) {
        toggleBtn.addEventListener("click", () => {
            panel.classList.toggle("hidden");
        });
    }

    if (enableQueue) {
        enableQueue.addEventListener("change", () => {
            alertSettings.enableQueueAlerts = enableQueue.checked;
            saveAlertSettings();
        });
    }

    if (enableVoice) {
        enableVoice.addEventListener("change", () => {
            alertSettings.enableVoiceAlerts = enableVoice.checked;
            saveAlertSettings();
        });
    }

    if (enablePopup) {
        enablePopup.addEventListener("change", () => {
            alertSettings.enablePopupAlerts = enablePopup.checked;
            saveAlertSettings();

            if (enablePopup.checked && "Notification" in window && Notification.permission === "default") {
                Notification.requestPermission().catch(() => {});
            }
        });
    }

    if (toneSelect) {
        toneSelect.addEventListener("change", () => {
            alertSettings.tone = toneSelect.value || "soft";
            saveAlertSettings();
        });
    }

    if (volumeSlider) {
        volumeSlider.addEventListener("input", () => {
            const value = Number(volumeSlider.value || 80);
            alertSettings.volume = clamp(value / 100, 0, 1);
            saveAlertSettings();
        });
    }

    if (cooldownInput) {
        cooldownInput.addEventListener("change", () => {
            let value = Number(cooldownInput.value || 30);
            if (isNaN(value) || value <= 0) value = 30;
            alertSettings.cooldownSeconds = value;
            saveAlertSettings();
        });
    }

    if (wallboardCheckbox) {
        wallboardCheckbox.addEventListener("change", () => {
            alertSettings.wallboardMode = wallboardCheckbox.checked;
            saveAlertSettings();
            // Style intentionally minimal per your preference
            document.body.classList.toggle("wallboard-mode", wallboardCheckbox.checked);
        });
    }

    // If popup alerts enabled and permission not yet decided, ask once on load
    if (alertSettings.enablePopupAlerts && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
}

// ===============================
// LOAD CURRENT QUEUE STATUS
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        if (!data || !Array.isArray(data.QueueStatus) || data.QueueStatus.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            updateAlertsFromQueues([]);
            return;
        }

        const queues = data.QueueStatus;
        let rowsHtml = "";

        queues.forEach(q => {
            const calls = safe(q.TotalCalls, 0);
            const agents = safe(q.TotalLoggedAgents, 0);

            const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
            const avgWaitSeconds = q.AvgWaitInterval ?? 0;

            const callsClass = (Number(calls) || 0) > 0 ? "queue-alert-value" : "";
            const maxWaitClass = (Number(maxWaitSeconds) || 0) > 0 ? "queue-alert-value" : "";

            rowsHtml += `
                <tr>
                    <td>${safe(q.QueueName, "Unknown")}</td>
                    <td class="numeric ${callsClass}">${calls}</td>
                    <td class="numeric">${agents}</td>
                    <td class="numeric ${maxWaitClass}">${formatTime(maxWaitSeconds)}</td>
                    <td class="numeric">${formatTime(avgWaitSeconds)}</td>
                </tr>
            `;
        });

        body.innerHTML = rowsHtml;
        updateAlertsFromQueues(queues);

    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
        updateAlertsFromQueues([]);
    }
}

// ===============================
// LOAD REALTIME GLOBAL STATISTICS
// ===============================
async function loadGlobalStats() {
    const errorDiv = document.getElementById("global-error");
    errorDiv.textContent = "";

    try {
        const data = await fetchApi("/statistics/global");

        if (!data || !Array.isArray(data.GlobalStatistics) || data.GlobalStatistics.length === 0) {
            errorDiv.textContent = "Unable to load global statistics.";
            return;
        }

        const g = data.GlobalStatistics[0];

        setText("gs-total-queued", g.TotalCallsQueued);
        setText("gs-total-transferred", g.TotalCallsTransferred);
        setText("gs-total-abandoned", g.TotalCallsAbandoned);
        setText("gs-max-wait", formatTime(g.MaxQueueWaitingTime));

        setText("gs-service-level", g.ServiceLevel != null ? g.ServiceLevel.toFixed(2) + "%" : "--");
        setText("gs-total-received", g.TotalCallsReceived);

        setText("gs-answer-rate", g.AnswerRate != null ? g.AnswerRate.toFixed(2) + "%" : "--");
        setText("gs-abandon-rate", g.AbandonRate != null ? g.AbandonRate.toFixed(2) + "%" : "--");

        setText("gs-callbacks-registered", g.CallbacksRegistered);
        setText("gs-callbacks-waiting", g.CallbacksWaiting);

    } catch (err) {
        console.error("Global stats error:", err);
        errorDiv.textContent = "Unable to load global statistics.";
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value === undefined || value === null ? "--" : value;
}

// ===============================
// LOAD AGENT PERFORMANCE (UPDATED: DURATION ADDED)
// ===============================
async function loadAgentStatus() {
    const body = document.getElementById("agent-body");
    body.innerHTML = `<tr><td colspan="11" class="loading">Loading agent data…</td></tr>`;

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
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;

            // Calculate Duration → SecondsInCurrentStatus
            const duration = formatTime(a.SecondsInCurrentStatus ?? 0);

            // Avg Handle Time
            const avgHandleSeconds =
                inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;

            // Availability color map
            const availabilityClass = getAvailabilityClass(a.CallTransferStatusDesc);

            const tr = document.createElement("tr");

            tr.innerHTML = `
                <td>${safe(a.FullName)}</td>
                <td>${safe(a.TeamName)}</td>
                <td>${safe(a.PhoneExt)}</td>
                <td class="availability-cell ${availabilityClass}">${safe(a.CallTransferStatusDesc)}</td>
                
                <!-- DURATION (NEW COLUMN) -->
                <td class="numeric">${duration}</td>

                <!-- Existing columns -->
                <td class="numeric">${inbound}</td>
                <td class="numeric">${missed}</td>
                <td class="numeric">${transferred}</td>
                <td class="numeric">${outbound}</td>
                <td class="numeric">${formatTime(avgHandleSeconds)}</td>
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
// DARK MODE TOGGLE
// ===============================
function initDarkMode() {
    const btn = document.getElementById("darkModeToggle");

    if (!btn) return;

    // Detect system preference ON FIRST VISIT
    if (!localStorage.getItem("dashboard-dark-mode")) {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
            document.body.classList.add("dark-mode");
            btn.textContent = "☀️ Light Mode";
        }
    } else {
        // Load stored preference
        const stored = localStorage.getItem("dashboard-dark-mode");
        if (stored === "on") {
            document.body.classList.add("dark-mode");
            btn.textContent = "☀️ Light Mode";
        }
    }

    // Toggle on click
    btn.addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark-mode");
        btn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
        localStorage.setItem("dashboard-dark-mode", isDark ? "on" : "off");
    });
}

// ===============================
// INIT
// ===============================
function refreshAll() {
    loadQueueStatus();
    loadAgentStatus();
    loadGlobalStats();
}

document.addEventListener("DOMContentLoaded", () => {
    initDarkMode();
    initAlertSettings();
    refreshAll();

    // Refresh every 10 seconds
    setInterval(refreshAll, 10000);
});
