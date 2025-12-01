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

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

// ===============================
// ALERT ENGINE
// ===============================
const ALERT_STORAGE_KEY = "visionbank-alert-settings-v1";
const ALERT_TONE_OVERRIDES_KEY = "visionbank-alert-tone-overrides-v1";
const ALERT_HISTORY_KEY = "visionbank-alert-history-v1";

const defaultAlertSettings = {
    enableQueueAlerts: true,
    enableVoiceAlerts: true,
    enablePopupAlerts: true,
    tone: "soft",       // default tone
    volume: 0.8,        // 0–1
    cooldownSeconds: 30,
    wallboardMode: false
};

let alertSettings = { ...defaultAlertSettings };
let alertToneOverrides = {};
let alertHistory = [];
let lastAlertTime = 0;
let lastQueues = [];

let audioContext = null;
const voiceAudio = new Audio("assets/ttsAlert.mp3");
voiceAudio.preload = "auto";

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

function playTone(toneType, volume, isHighVolume) {
    const ctx = ensureAudioContext();
    if (!ctx) return;

    const v = clamp(volume, 0, 1);
    const now = ctx.currentTime;
    const baseDur = 0.8;

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

    freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;

        osc.connect(gain);
        gain.connect(ctx.destination);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(v, now + 0.03 + i * 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + baseDur + i * 0.05);

        osc.start(now);
        osc.stop(now + baseDur + 0.1 + i * 0.05);
    });
}

// ---------- HISTORY ----------
function loadAlertHistory() {
    try {
        const raw = localStorage.getItem(ALERT_HISTORY_KEY);
        alertHistory = raw ? JSON.parse(raw) : [];
    } catch {
        alertHistory = [];
    }
}

function saveAlertHistory() {
    try {
        localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(alertHistory));
    } catch {}
}

function recordAlertHistory(entry) {
    loadAlertHistory();
    alertHistory.unshift(entry);
    if (alertHistory.length > 20) {
        alertHistory = alertHistory.slice(0, 20);
    }
    saveAlertHistory();

    const panel = document.getElementById("alertHistoryPanel");
    if (panel && !panel.classList.contains("hidden")) {
        renderAlertHistory();
    }
}

function renderAlertHistory() {
    const panel = document.getElementById("alertHistoryPanel");
    const list = document.getElementById("alertHistoryList");
    if (!panel || !list) return;

    loadAlertHistory();
    list.innerHTML = "";

    if (!alertHistory.length) {
        list.innerHTML = `<div class="history-empty">No alerts yet.</div>`;
        return;
    }

    alertHistory.forEach(entry => {
        const dt = new Date(entry.ts);
        const when = dt.toLocaleString();
        const queues = (entry.queues && entry.queues.length)
            ? entry.queues.join(", ")
            : "All queues";
        const maxWait = typeof entry.maxWaitSeconds === "number"
            ? formatTime(entry.maxWaitSeconds)
            : "--";

        const div = document.createElement("div");
        div.className = "history-item";
        div.innerHTML = `
            <div class="history-line"><strong>${when}</strong></div>
            <div class="history-line">Calls: ${entry.totalCalls}</div>
            <div class="history-line">Queues: ${queues}</div>
            <div class="history-line">Max Wait: ${maxWait}</div>
            <div class="history-line">Tone: ${entry.tone || "default"}</div>
            <div class="history-line">Voice: ${entry.voice ? "Yes" : "No"}</div>
        `;
        list.appendChild(div);
    });
}

// ---------- TONE OVERRIDES ----------
function loadAlertToneOverrides() {
    try {
        const raw = localStorage.getItem(ALERT_TONE_OVERRIDES_KEY);
        alertToneOverrides = raw ? JSON.parse(raw) : {};
    } catch {
        alertToneOverrides = {};
    }
}

function saveAlertToneOverrides() {
    try {
        localStorage.setItem(ALERT_TONE_OVERRIDES_KEY, JSON.stringify(alertToneOverrides));
    } catch {}
}

function rebuildQueueToneOverridesUI() {
    const container = document.getElementById("queueToneOverrides");
    if (!container) return;

    container.innerHTML = "";

    if (!Array.isArray(lastQueues) || lastQueues.length === 0) {
        container.innerHTML = `<div class="queue-override-empty">No queues loaded yet.</div>`;
        return;
    }

    lastQueues.forEach(q => {
        const name = q.QueueName || "Unknown";
        const currentTone = alertToneOverrides[name] || "";

        const row = document.createElement("div");
        row.className = "queue-override-row";
        row.innerHTML = `
            <span class="queue-override-name">${name}</span>
            <select class="queue-override-select" data-queue-name="${name}">
                <option value="">Default</option>
                <option value="soft"${currentTone === "soft" ? " selected" : ""}>Soft</option>
                <option value="bright"${currentTone === "bright" ? " selected" : ""}>Bright</option>
                <option value="pulse"${currentTone === "pulse" ? " selected" : ""}>Pulse</option>
            </select>
        `;
        container.appendChild(row);
    });

    if (!container.dataset.bound) {
        container.addEventListener("change", e => {
            const select = e.target;
            if (!select.classList.contains("queue-override-select")) return;
            const qName = select.getAttribute("data-queue-name");
            const val = select.value;
            if (!qName) return;

            if (!val) {
                delete alertToneOverrides[qName];
            } else {
                alertToneOverrides[qName] = val;
            }
            saveAlertToneOverrides();
        });
        container.dataset.bound = "1";
    }
}

// ---------- ALERT SETTINGS LOAD/SAVE ----------
function loadAlertSettings() {
    try {
        const raw = localStorage.getItem(ALERT_STORAGE_KEY);
        if (!raw) {
            alertSettings = { ...defaultAlertSettings };
            return;
        }
        alertSettings = { ...defaultAlertSettings, ...JSON.parse(raw) };
    } catch {
        alertSettings = { ...defaultAlertSettings };
    }
}

function saveAlertSettings() {
    try {
        localStorage.setItem(ALERT_STORAGE_KEY, JSON.stringify(alertSettings));
    } catch {}
}

// ---------- CORE ALERT TRIGGER ----------
function triggerAlert(context) {
    const vol = clamp(alertSettings.volume, 0, 1);
    const toneName = context.tone || alertSettings.tone || "soft";
    const isHigh = (context.totalCalls || 0) >= 5;

    if (alertSettings.enableVoiceAlerts) {
        try {
            voiceAudio.pause();
            voiceAudio.currentTime = 0;
            voiceAudio.volume = vol;
            voiceAudio.play().catch(() => {});
        } catch (e) {
            console.warn("Voice alert failed:", e);
        }
    }

    playTone(toneName, vol, isHigh);

    if (alertSettings.enablePopupAlerts && "Notification" in window) {
        if (Notification.permission === "granted") {
            new Notification("Calls Waiting", {
                body: `You have ${context.totalCalls} call(s) waiting.`,
                tag: "visionbank-queue-alert"
            });
        }
    }

    recordAlertHistory({
        ts: Date.now(),
        totalCalls: context.totalCalls || 0,
        maxWaitSeconds: context.maxWaitSeconds || 0,
        queues: context.queues || [],
        tone: toneName,
        voice: !!alertSettings.enableVoiceAlerts
    });
}

// ---------- QUEUE ALERT DECISION ----------
function updateAlertsFromQueues(queues) {
    const panel = document.getElementById("queue-panel");
    if (!panel) return;

    if (!Array.isArray(queues) || queues.length === 0) {
        panel.classList.remove("queue-alert");
        return;
    }

    let totalCalls = 0;
    let maxWaitSeconds = 0;
    const activeQueues = [];

    queues.forEach(q => {
        const calls = Number(q.TotalCalls ?? 0);
        const wait = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;

        if (calls > 0 || wait > 0) {
            activeQueues.push(q);
        }

        totalCalls += calls;
        if (wait > maxWaitSeconds) {
            maxWaitSeconds = wait;
        }
    });

    if (!activeQueues.length) {
        panel.classList.remove("queue-alert");
        return;
    }

    panel.classList.add("queue-alert");

    if (!alertSettings.enableQueueAlerts) return;

    const now = Date.now();
    const cooldownMs = (alertSettings.cooldownSeconds || 30) * 1000;
    if (now - lastAlertTime < cooldownMs) return;

    lastAlertTime = now;

    // Determine tone using per-queue overrides (queue with most calls wins)
    let toneToUse = alertSettings.tone || "soft";
    if (activeQueues.length) {
        let bestQueue = activeQueues[0];
        let bestCalls = Number(bestQueue.TotalCalls ?? 0);

        activeQueues.forEach(q => {
            const c = Number(q.TotalCalls ?? 0);
            if (c > bestCalls) {
                bestCalls = c;
                bestQueue = q;
            }
        });

        const overrideTone = alertToneOverrides[bestQueue.QueueName];
        if (overrideTone) {
            toneToUse = overrideTone;
        }
    }

    triggerAlert({
        totalCalls,
        maxWaitSeconds,
        queues: activeQueues.map(q => q.QueueName || "Unknown"),
        tone: toneToUse
    });
}

// ===============================
// ALERT SETTINGS UI
// ===============================
function initAlertSettings() {
    loadAlertSettings();
    loadAlertToneOverrides();
    loadAlertHistory();

    const toggle = document.getElementById("alertSettingsToggle");
    const panel = document.getElementById("alertSettingsPanel");
    const enableQueue = document.getElementById("enableQueueAlerts");
    const enableVoice = document.getElementById("enableVoiceAlerts");
    const enablePopup = document.getElementById("enablePopupAlerts");
    const tone = document.getElementById("alertToneSelect");
    const vol = document.getElementById("alertVolume");
    const cooldown = document.getElementById("alertCooldown");
    const wallboard = document.getElementById("wallboardMode");
    const testBtn = document.getElementById("alertTestButton");

    const historyToggle = document.getElementById("alertHistoryToggle");
    const historyPanel = document.getElementById("alertHistoryPanel");

    // Set UI from settings
    if (enableQueue) enableQueue.checked = alertSettings.enableQueueAlerts;
    if (enableVoice) enableVoice.checked = alertSettings.enableVoiceAlerts;
    if (enablePopup) enablePopup.checked = alertSettings.enablePopupAlerts;
    if (tone) tone.value = alertSettings.tone;
    if (vol) vol.value = Math.round(alertSettings.volume * 100);
    if (cooldown) cooldown.value = alertSettings.cooldownSeconds;
    if (wallboard) wallboard.checked = alertSettings.wallboardMode;

    // Toggle panel
    if (toggle && panel) {
        toggle.addEventListener("click", () => {
            panel.classList.toggle("hidden");
        });
    }

    // Toggle history panel
    if (historyToggle && historyPanel) {
        historyToggle.addEventListener("click", () => {
            const nowHidden = historyPanel.classList.toggle("hidden");
            if (!nowHidden) {
                renderAlertHistory();
            }
        });
    }

    // Settings handlers
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

    if (tone) {
        tone.addEventListener("change", () => {
            alertSettings.tone = tone.value || "soft";
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
            if (isNaN(v) || v < 5) v = 30;
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

    // Test Alert button
    if (testBtn) {
        testBtn.addEventListener("click", () => {
            triggerAlert({
                totalCalls: 3,
                maxWaitSeconds: 60,
                queues: ["Test Queue"],
                tone: alertSettings.tone || "soft"
            });
        });
    }

    // If popup enabled and permission not set, request once
    if (alertSettings.enablePopupAlerts && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }
}

// ===============================
// QUEUE STATUS
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status...</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        if (!data || !Array.isArray(data.QueueStatus) || data.QueueStatus.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            updateAlertsFromQueues([]);
            lastQueues = [];
            rebuildQueueToneOverridesUI();
            return;
        }

        const queues = data.QueueStatus;
        lastQueues = queues.slice();

        let html = "";
        queues.forEach(q => {
            const calls = Number(q.TotalCalls || 0);
            const agents = safe(q.TotalLoggedAgents, 0);
            const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
            const avgWaitSeconds = q.AvgWaitInterval ?? 0;

            const callsClass = calls > 0 ? "queue-alert-value" : "";
            const waitClass = maxWaitSeconds > 0 ? "queue-alert-value" : "";

            html += `
                <tr>
                    <td>${safe(q.QueueName, "Unknown")}</td>
                    <td class="${callsClass}">${calls}</td>
                    <td>${agents}</td>
                    <td class="${waitClass}">${formatTime(maxWaitSeconds)}</td>
                    <td>${formatTime(avgWaitSeconds)}</td>
                </tr>
            `;
        });

        body.innerHTML = html;
        updateAlertsFromQueues(queues);
        rebuildQueueToneOverridesUI();

    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
        updateAlertsFromQueues([]);
        lastQueues = [];
        rebuildQueueToneOverridesUI();
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

        if (!data || !Array.isArray(data.GlobalStatistics) || data.GlobalStatistics.length === 0) {
            err.textContent = "Unable to load global statistics.";
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
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;

            const duration = formatTime(a.SecondsInCurrentStatus ?? 0);
            const avgHandleSeconds =
                inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;

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
                    <td class="numeric">${formatTime(avgHandleSeconds)}</td>
                    <td>${formatDate(a.StartDateUtc)}</td>
                </tr>
            `;
            body.insertAdjacentHTML("beforeend", row);
        });

    } catch (err) {
        console.error("Agent load error:", err);
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
