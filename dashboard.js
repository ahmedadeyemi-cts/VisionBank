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
    return new Date(utc + "Z").toLocaleString("en-US", { timeZone: "America/Chicago" });
}

function safe(value, fallback = "--") {
    return value === undefined || value === null ? fallback : value;
}

function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();

    if (s.includes("available")) return "status-available";
    if (s.includes("on call") || s.includes("dial") || s.includes("talk")) return "status-oncall";
    if (s.includes("busy") || s.includes("not set") || s.includes("break")) return "status-busy";
    if (s.includes("ring") || s.includes("accept internal") || s.includes("wrap")) return "status-ringing";

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
    volume: 0.8,
    cooldownSeconds: 30,
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
    if (!window.AudioContext && !window.webkitAudioContext) return null;

    if (!audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        audioContext = new Ctx();
    } else if (audioContext.state === "suspended") {
        audioContext.resume();
    }

    return audioContext;
}

function playTone(type, volume, highVolume) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const v = clamp(volume, 0, 1);
    const now = ctx.currentTime;
    const duration = 0.8;

    let freqs =
        type === "bright"
            ? [880, 1320]
            : type === "pulse"
            ? [600, 900]
            : [520, 780];

    if (highVolume) {
        freqs = freqs.map(f => f * 1.25);
    }

    freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(v, now + 0.03 + i * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration + i * 0.05);

        osc.start(now);
        osc.stop(now + duration + 0.1 + i * 0.05);
    });
}

function triggerAlert(state) {
    const vol = clamp(alertSettings.volume, 0, 1);

    if (alertSettings.enableVoiceAlerts) {
        voiceAudio.pause();
        voiceAudio.currentTime = 0;
        voiceAudio.volume = vol;
        voiceAudio.play().catch(() => {});
    }

    const highVolume = state.totalCalls >= 5;
    playTone(alertSettings.tone, vol, highVolume);

    if (alertSettings.enablePopupAlerts && "Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("Calls Waiting", {
                body: `You have ${state.totalCalls} call(s) waiting.`,
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
    let maxWait = 0;

    queues.forEach(q => {
        totalCalls += Number(q.TotalCalls ?? 0);
        const wait = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
        if (wait > maxWait) maxWait = wait;
    });

    if (totalCalls === 0) {
        panel.classList.remove("queue-alert");
        return;
    }

    panel.classList.add("queue-alert");

    if (!alertSettings.enableQueueAlerts) return;

    const now = Date.now();
    const cooldownMs = (alertSettings.cooldownSeconds || 30) * 1000;

    if (now - lastAlertTime < cooldownMs) return;

    lastAlertTime = now;
    triggerAlert({ totalCalls });
}

// ===============================
// ALERT SETTINGS UI (FIXED)
// ===============================
function loadAlertSettings() {
    try {
        const raw = localStorage.getItem(ALERT_STORAGE_KEY);
        if (!raw) return;

        alertSettings = { ...defaultAlertSettings, ...JSON.parse(raw) };
    } catch {
        alertSettings = { ...defaultAlertSettings };
    }
}

function saveAlertSettings() {
    localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertSettings));
}

function initAlertSettings() {
    loadAlertSettings();

    const toggle = document.getElementById("alertSettingsToggle");
    const panel = document.getElementById("alertSettingsPanel");
    const enableQueue = document.getElementById("enableQueueAlerts");
    const enableVoice = document.getElementById("enableVoiceAlerts");
    const enablePopup = document.getElementById("enablePopupAlerts");
    const tone = document.getElementById("alertToneSelect");
    const vol = document.getElementById("alertVolume");
    const cooldown = document.getElementById("alertCooldown");
    const wallboard = document.getElementById("wallboardMode");

    // APPLY SAVED VALUES
    if (enableQueue) enableQueue.checked = alertSettings.enableQueueAlerts;
    if (enableVoice) enableVoice.checked = alertSettings.enableVoiceAlerts;
    if (enablePopup) enablePopup.checked = alertSettings.enablePopupAlerts;
    if (tone) tone.value = alertSettings.tone;
    if (vol) vol.value = Math.round(alertSettings.volume * 100);
    if (cooldown) cooldown.value = alertSettings.cooldownSeconds;
    if (wallboard) wallboard.checked = alertSettings.wallboardMode;

    // TOGGLE FIX
    if (toggle && panel) {
        toggle.addEventListener("click", () => {
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

            if (enablePopup.checked && Notification.permission === "default") {
                Notification.requestPermission();
            }
        });
    }

    if (tone) {
        tone.addEventListener("change", () => {
            alertSettings.tone = tone.value;
            saveAlertSettings();
        });
    }

    if (vol) {
        vol.addEventListener("input", () => {
            alertSettings.volume = clamp(vol.value / 100, 0, 1);
            saveAlertSettings();
        });
    }

    if (cooldown) {
        cooldown.addEventListener("change", () => {
            let v = Number(cooldown.value);
            if (isNaN(v) || v <= 5) v = 30;
            alertSettings.cooldownSeconds = v;
            saveAlertSettings();
        });
    }

    if (wallboard) {
        wallboard.addEventListener("change", () => {
            alertSettings.wallboardMode = wallboard.checked;
            saveAlertSettings();
        });
    }
}

// ===============================
// QUEUE STATUS
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        if (!data || !Array.isArray(data.QueueStatus)) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            updateAlertsFromQueues([]);
            return;
        }

        const queues = data.QueueStatus;
        let html = "";

        queues.forEach(q => {
            const calls = Number(q.TotalCalls || 0);
            const wait = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
            const avg = q.AvgWaitInterval ?? 0;

            const callsClass = calls > 0 ? "queue-alert-value" : "";
            const waitClass = wait > 0 ? "queue-alert-value" : "";

            html += `
                <tr>
                    <td>${safe(q.QueueName)}</td>
                    <td class="${callsClass}">${calls}</td>
                    <td>${safe(q.TotalLoggedAgents)}</td>
                    <td class="${waitClass}">${formatTime(wait)}</td>
                    <td>${formatTime(avg)}</td>
                </tr>
            `;
        });

        body.innerHTML = html;
        updateAlertsFromQueues(queues);

    } catch (err) {
        console.error("Queue error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
        updateAlertsFromQueues([]);
    }
}

// ===============================
// GLOBAL STATS
// ===============================
async function loadGlobalStats() {
    const err = document.getElementById("global-error");
    err.textContent = "";

    try {
        const data = await fetchApi("/statistics/global");
        if (!data || !Array.isArray(data.GlobalStatistics)) {
            err.textContent = "Unable to load global statistics.";
            return;
        }

        const s = data.GlobalStatistics[0];

        setText("gs-total-queued", s.TotalCallsQueued);
        setText("gs-total-transferred", s.TotalCallsTransferred);
        setText("gs-total-abandoned", s.TotalCallsAbandoned);
        setText("gs-max-wait", formatTime(s.MaxQueueWaitingTime));
        setText("gs-service-level", s.ServiceLevel != null ? s.ServiceLevel.toFixed(2) + "%" : "--");
        setText("gs-total-received", s.TotalCallsReceived);
        setText("gs-answer-rate", s.AnswerRate != null ? s.AnswerRate.toFixed(2) + "%" : "--");
        setText("gs-abandon-rate", s.AbandonRate != null ? s.AbandonRate.toFixed(2) + "%" : "--");
        setText("gs-callbacks-registered", s.CallbacksRegistered);
        setText("gs-callbacks-waiting", s.CallbacksWaiting);

    } catch (error) {
        console.error("Global stats error:", error);
        err.textContent = "Unable to load global statistics.";
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (value === undefined || value === null) ? "--" : value;
}

// ===============================
// AGENT STATUS
// ===============================
async function loadAgentStatus() {
    const body = document.getElementById("agent-body");
    body.innerHTML = `<tr><td colspan="11" class="loading">Loading agent data…</td></tr>`;

    try {
        const data = await fetchApi("/status/agents");

        if (!data || !Array.isArray(data.AgentStatus)) {
            body.innerHTML = `<tr><td colspan="11" class="error">Unable to load agent data.</td></tr>`;
            return;
        }

        body.innerHTML = "";
        data.AgentStatus.forEach(a => {
            const inbound = a.TotalCallsReceived ?? 0;
            const missed = a.TotalCallsMissed ?? 0;
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;
            const duration = formatTime(a.SecondsInCurrentStatus ?? 0);
            const avgHandle = inbound > 0 ? formatTime(Math.round((a.TotalSecondsOnCall || 0) / inbound)) : "00:00:00";
            const statusClass = getAvailabilityClass(a.CallTransferStatusDesc);

            const row = `
                <tr>
                    <td>${safe(a.FullName)}</td>
                    <td>${safe(a.TeamName)}</td>
                    <td>${safe(a.PhoneExt)}</td>
                    <td class="availability-cell ${statusClass}">${safe(a.CallTransferStatusDesc)}</td>
                    <td class="numeric">${duration}</td>
                    <td class="numeric">${inbound}</td>
                    <td class="numeric">${missed}</td>
                    <td class="numeric">${transferred}</td>
                    <td class="numeric">${outbound}</td>
                    <td class="numeric">${avgHandle}</td>
                    <td>${formatDate(a.StartDateUtc)}</td>
                </tr>
            `;
            body.insertAdjacentHTML("beforeend", row);
        });

    } catch (err) {
        console.error("Agent error:", err);
        body.innerHTML = `<tr><td colspan="11" class="error">Unable to load agent data.</td></tr>`;
    }
}

// ===============================
// DARK MODE
// ===============================
function initDarkMode() {
    const btn = document.getElementById("darkModeToggle");
    if (!btn) return;

    if (!localStorage.getItem("dashboard-dark-mode")) {
        const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        if (prefersDark) {
            document.body.classList.add("dark-mode");
            btn.textContent = "☀️ Light Mode";
        }
    } else {
        const stored = localStorage.getItem("dashboard-dark-mode");
        if (stored === "on") {
            document.body.classList.add("dark-mode");
            btn.textContent = "☀️ Light Mode";
        }
    }

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

    setInterval(refreshAll, 10000);
});
