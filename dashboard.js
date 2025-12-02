// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Key for persisting alert settings
const ALERT_SETTINGS_KEY = "visionbankAlertSettingsV1";

// ===============================
// BASIC API HELPER
// ===============================
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
function safe(value, fallback = "--") {
    if (value === undefined || value === null || value === "") {
        return fallback;
    }
    return value;
}

function formatTime(sec) {
    sec = Number(sec) || 0;
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
    return d.toLocaleString();
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value === undefined || value === null ? "--" : value;
}

// ===============================
// DARK MODE TOGGLE
// ===============================
function initDarkMode() {
    const btn = document.getElementById("darkModeToggle");
    if (!btn) return;

    function applyDarkMode(on) {
        document.body.classList.toggle("dark-mode", !!on);
        btn.textContent = on ? "☀️ Light Mode" : "🌙 Dark Mode";
    }

    const stored = localStorage.getItem("dashboard-dark-mode");
    if (stored === null) {
        const prefersDark =
            window.matchMedia &&
            window.matchMedia("(prefers-color-scheme: dark)").matches;
        applyDarkMode(prefersDark);
        localStorage.setItem("dashboard-dark-mode", prefersDark ? "1" : "0");
    } else {
        applyDarkMode(stored === "1");
    }

    btn.addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark-mode");
        btn.textContent = isDark ? "☀️ Light Mode" : "🌙 Dark Mode";
        localStorage.setItem("dashboard-dark-mode", isDark ? "1" : "0");
    });
}

// ===============================
// ALERT SETTINGS / AUDIO / HISTORY
// ===============================
let alertSettings = {
    enableQueueAlerts: true,
    enableVoiceAlerts: true,
    enablePopupAlerts: true,
    tone: "soft",
    volume: 0.8,
    cooldownSeconds: 30,
    wallboardMode: false,
    queueTones: {} // { queueName: "soft"|"bright"|"pulse" }
};

let lastAlertTimestamp = 0;

// Audio
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
        if (Ctor) {
            audioCtx = new Ctor();
        }
    }
    if (!voiceAudio) {
        // TTS MP3 in assets folder
        voiceAudio = new Audio("assets/ttsAlert.mp3");
    }
}

function playTone(tone) {
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
        case "soft":
        default:
            freq = 880;
            type = "sine";
            break;
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
    ensureAudio();
    if (!voiceAudio) return;
    try {
        voiceAudio.pause();
        voiceAudio.currentTime = 0;
    } catch (e) {
        // ignore
    }
    voiceAudio.volume = Math.max(0, Math.min(1, alertSettings.volume));
    voiceAudio.play().catch(() => {
        // autoplay may be blocked; ignore
    });
}

// Popup overlay
let popupTimeoutId = null;
function showAlertPopup(message) {
    if (!alertSettings.enablePopupAlerts) return;

    let popup = document.getElementById("queueAlertPopup");
    if (!popup) {
        popup = document.createElement("div");
        popup.id = "queueAlertPopup";
        popup.className = "queue-alert-popup";
        document.body.appendChild(popup);
    }
    popup.textContent = message || "You have calls waiting";
    popup.classList.add("visible");

    if (popupTimeoutId) {
        clearTimeout(popupTimeoutId);
    }
    popupTimeoutId = setTimeout(() => {
        popup.classList.remove("visible");
    }, 5000);
}

// ===============================
// ALERT HISTORY
// ===============================
const alertHistory = [];
const MAX_ALERT_HISTORY = 100;

function recordAlertEvent({ calls, agents, tone, voiceEnabled }) {
    const now = new Date();
    const entry = {
        timestamp: now,
        calls: calls ?? 0,
        agents: agents ?? 0,
        tone: tone || alertSettings.tone || "soft",
        voiceEnabled: !!voiceEnabled
    };

    // newest at top
    alertHistory.unshift(entry);
    if (alertHistory.length > MAX_ALERT_HISTORY) {
        alertHistory.pop();
    }
    renderAlertHistory();
}

function renderAlertHistory() {
    const listEl = document.getElementById("alertHistoryList");
    if (!listEl) return;

    if (alertHistory.length === 0) {
        listEl.innerHTML = `<div class="history-empty">No alerts yet.</div>`;
        return;
    }

    const itemsHtml = alertHistory
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

    listEl.innerHTML = itemsHtml;
}

function initAlertHistoryUI() {
    const clearBtn = document.getElementById("clearAlertHistory");
    if (clearBtn) {
        clearBtn.addEventListener("click", () => {
            alertHistory.length = 0;
            renderAlertHistory();
        });
    }
    renderAlertHistory();
}

// ===============================
// ALERT SETTINGS UI INIT
// ===============================
function initAlertSettingsUI() {
    loadAlertSettings();

    const enableQueueAlertsEl = document.getElementById("enableQueueAlerts");
    const enableVoiceAlertsEl = document.getElementById("enableVoiceAlerts");
    const enablePopupAlertsEl = document.getElementById("enablePopupAlerts");
    const alertToneSelectEl = document.getElementById("alertToneSelect");
    const alertVolumeEl = document.getElementById("alertVolume");
    const alertCooldownEl = document.getElementById("alertCooldown");
    const wallboardModeEl = document.getElementById("wallboardMode");
    const testButtonEl = document.getElementById("alertTestButton");
    const alertSettingsToggle = document.getElementById("alertSettingsToggle");
    const alertSettingsPanel = document.getElementById("alertSettingsPanel");
    const alertHistoryToggle = document.getElementById("alertHistoryToggle");
    const alertHistoryPanel = document.getElementById("alertHistoryPanel");

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

    if (wallboardModeEl) {
        wallboardModeEl.checked = alertSettings.wallboardMode;
        wallboardModeEl.addEventListener("change", () => {
            alertSettings.wallboardMode = wallboardModeEl.checked;
            document.body.classList.toggle("wallboard-mode", wallboardModeEl.checked);
            saveAlertSettings();
        });
        document.body.classList.toggle("wallboard-mode", wallboardModeEl.checked);
    }

    if (testButtonEl) {
        testButtonEl.addEventListener("click", () => {
            triggerQueueAlert({
                totalCalls: 3,
                totalAgents: 3,
                queueNames: ["Test Queue"],
                isTest: true
            });
        });
    }

    if (alertSettingsToggle && alertSettingsPanel) {
        alertSettingsToggle.addEventListener("click", () => {
            alertSettingsPanel.classList.toggle("hidden");
            alertHistoryPanel && alertHistoryPanel.classList.add("hidden");
        });
    }

    if (alertHistoryToggle && alertHistoryPanel) {
        alertHistoryToggle.addEventListener("click", () => {
            alertHistoryPanel.classList.toggle("hidden");
            alertSettingsPanel && alertSettingsPanel.classList.add("hidden");
        });
    }
}

// Build tone override controls once queues are known
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
        if (savedTone) {
            selectEl.value = savedTone;
        }

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
    if (!alertSettings.enableQueueAlerts && !isTest) {
        return;
    }

    const now = Date.now();
    const cooldownMs = (alertSettings.cooldownSeconds || 30) * 1000;

    if (!isTest && now - lastAlertTimestamp < cooldownMs) {
        return;
    }
    lastAlertTimestamp = now;

    // Determine tone (use queue override if exactly one active queue)
    let tone = alertSettings.tone || "soft";
    if (queueNames && queueNames.length === 1) {
        const qName = queueNames[0];
        if (alertSettings.queueTones[qName]) {
            tone = alertSettings.queueTones[qName];
        }
    }

    // Playback
    playTone(tone);
    if (alertSettings.enableVoiceAlerts) {
        playVoice();
    }

    // Popup
    if (!isTest) {
        showAlertPopup("You have calls waiting");
    }

    // History entry
    recordAlertEvent({
        calls: totalCalls,
        agents: totalAgents,
        tone,
        voiceEnabled: alertSettings.enableVoiceAlerts
    });
}

// ===============================
// LOAD CURRENT QUEUE STATUS
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    const panel = document.getElementById("queue-panel");
    if (!body) return;

    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        if (!data || !Array.isArray(data.QueueStatus) || data.QueueStatus.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            panel && panel.classList.remove("queue-alert-active");
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

        // Panel border state
        if (panel) {
            panel.classList.toggle("queue-alert-active", anyHot);
        }

        // Alert logic
        if (anyHot) {
            triggerQueueAlert({
                totalCalls,
                totalAgents,
                queueNames: activeQueueNames
            });
        }

        // Build tone overrides once queues are known
        updateQueueToneOverrides(queues);

    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
        panel && panel.classList.remove("queue-alert-active");
    }
}

// ===============================
// LOAD REALTIME GLOBAL STATISTICS
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

        setText("gs-service-level", g.ServiceLevel != null ? g.ServiceLevel.toFixed(2) + "%" : "--");
        setText("gs-total-received", g.TotalCallsReceived);

        setText("gs-answer-rate", g.AnswerRate != null ? g.AnswerRate.toFixed(2) + "%" : "--");
        setText("gs-abandon-rate", g.AbandonRate != null ? g.AbandonRate.toFixed(2) + "%" : "--");

        setText("gs-callbacks-registered", g.CallbacksRegistered);
        setText("gs-callbacks-waiting", g.CallbacksWaiting);
    } catch (err) {
        console.error("Global stats error:", err);
        if (errorDiv) errorDiv.textContent = "Unable to load global statistics.";
    }
}

// ===============================
// LOAD AGENT PERFORMANCE
// ===============================
async function loadAgentStatus() {
    const body = document.getElementById("agent-body");
    if (!body) return;

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
            const transferred = a.TotalCallsTransferred ?? 0;
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
                <td class="numeric">${duration}</td>
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

// Simple mapping from status text to color class
function getAvailabilityClass(status) {
    if (!status) return "";
    const lower = status.toLowerCase();

    if (lower.includes("on call")) return "status-oncall";
    if (lower.includes("wrap")) return "status-wrap";
    if (lower.includes("break")) return "status-break";
    if (lower.includes("lunch")) return "status-lunch";
    if (lower.includes("not set") || lower.includes("idle")) return "status-idle";

    return "";
}

// ===============================
// MAIN REFRESH LOOP
// ===============================
function refreshAll() {
    loadQueueStatus();
    loadAgentStatus();
    loadGlobalStats();
}

document.addEventListener("DOMContentLoaded", () => {
    initDarkMode();
    initAlertSettingsUI();
    initAlertHistoryUI();
    refreshAll();

    // Refresh every 10 seconds
    setInterval(refreshAll, 10000);
});
