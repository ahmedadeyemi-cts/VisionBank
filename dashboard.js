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
// ALERT SETTINGS & STATE
// ===============================
const ALERT_SETTINGS_KEY = "vb-alert-settings";

let alertSettings = {
    volume: 0.65,              // 0–1
    enableChime: true,
    enableVoice: true,
    enableNotification: true,
    cooldownSeconds: 10,       // seconds between alerts
    highVolumeThreshold: 5     // calls/waiting for "high volume" alert
};

let lastAlertTimestamp = 0;
let voiceAudio = null;

function loadAlertSettings() {
    try {
        const raw = localStorage.getItem(ALERT_SETTINGS_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            alertSettings = { ...alertSettings, ...parsed };
        }
    } catch (e) {
        console.warn("Failed to load alert settings:", e);
    }
}

function saveAlertSettings() {
    try {
        localStorage.setItem(ALERT_SETTINGS_KEY, JSON.stringify(alertSettings));
    } catch (e) {
        console.warn("Failed to save alert settings:", e);
    }
}

function initAlertAudio() {
    try {
        voiceAudio = new Audio("assets/ttsAlert.mp3");
        voiceAudio.volume = alertSettings.volume;
    } catch (e) {
        console.warn("Unable to init voice audio:", e);
    }
}

function setAlertVolume(level) {
    alertSettings.volume = Math.min(1, Math.max(0, level));
    if (voiceAudio) {
        voiceAudio.volume = alertSettings.volume;
    }
    saveAlertSettings();
}

// ===============================
// ALERT AUDIO & NOTIFICATIONS
// ===============================
function playVoiceAlert() {
    if (!alertSettings.enableVoice || !voiceAudio) return;
    try {
        voiceAudio.currentTime = 0;
        voiceAudio.play().catch(() => {});
    } catch (e) {
        console.warn("Voice alert failed:", e);
    }
}

function playQueueChimeNormal() {
    if (!alertSettings.enableChime) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const frequencies = [740, 880, 660]; // normal pattern
        const start = ctx.currentTime;

        frequencies.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = freq;
            gain.gain.value = alertSettings.volume;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start + i * 0.25);
            osc.stop(start + i * 0.25 + 0.22);
        });
    } catch (err) {
        console.warn("Normal chime failed:", err);
    }
}

function playQueueChimeHigh() {
    if (!alertSettings.enableChime) return;
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const frequencies = [660, 1040, 660, 1040]; // more urgent
        const start = ctx.currentTime;

        frequencies.forEach((freq, i) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = "square";
            osc.frequency.value = freq;
            gain.gain.value = alertSettings.volume;
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(start + i * 0.2);
            osc.stop(start + i * 0.2 + 0.18);
        });
    } catch (err) {
        console.warn("High-volume chime failed:", err);
    }
}

function notifyCallsWaiting(isHigh, maxCalls) {
    if (!alertSettings.enableNotification) return;
    if (!("Notification" in window)) return;
    if (Notification.permission !== "granted") return;

    const title = isHigh ? "High call volume!" : "You have calls waiting!";
    const body = isHigh
        ? `There are ${maxCalls} active or waiting calls across your queues.`
        : "Callers are waiting in the queue.";

    try {
        new Notification(title, {
            body,
            icon: "https://cdn-icons-png.flaticon.com/512/1827/1827272.png"
        });
    } catch (e) {
        console.warn("Notification failed:", e);
    }
}

function handleQueueAlerts(anyAlert, highAlert, maxCalls) {
    if (!anyAlert) return;

    const now = Date.now();
    const cooldownMs = (alertSettings.cooldownSeconds || 0) * 1000;
    if (cooldownMs > 0 && now - lastAlertTimestamp < cooldownMs) {
        return;
    }

    lastAlertTimestamp = now;

    if (highAlert) {
        playQueueChimeHigh();
    } else {
        playQueueChimeNormal();
    }

    playVoiceAlert();
    notifyCallsWaiting(highAlert, maxCalls);
}

// ===============================
// ALERT SETTINGS UI
// ===============================
function initAlertSettingsUI() {
    const panel = document.getElementById("alertSettingsPanel");
    const openBtn = document.getElementById("alertSettingsButton");
    const closeBtn = document.getElementById("alertSettingsClose");

    if (!panel || !openBtn) return; // safe if HTML not wired yet

    const volumeSlider = document.getElementById("alertVolumeSlider");
    const chimeChk = document.getElementById("alertEnableChime");
    const voiceChk = document.getElementById("alertEnableVoice");
    const notifChk = document.getElementById("alertEnableNotification");
    const cooldownSel = document.getElementById("alertCooldownSelect");
    const highVolSel = document.getElementById("alertHighVolumeSelect");
    const testBtn = document.getElementById("alertTestButton");

    // Initialize control values from settings
    if (volumeSlider) volumeSlider.value = Math.round(alertSettings.volume * 100);
    if (chimeChk) chimeChk.checked = alertSettings.enableChime;
    if (voiceChk) voiceChk.checked = alertSettings.enableVoice;
    if (notifChk) notifChk.checked = alertSettings.enableNotification;
    if (cooldownSel) cooldownSel.value = String(alertSettings.cooldownSeconds);
    if (highVolSel) highVolSel.value = String(alertSettings.highVolumeThreshold);

    openBtn.addEventListener("click", () => {
        panel.classList.add("open");
    });

    if (closeBtn) {
        closeBtn.addEventListener("click", () => {
            panel.classList.remove("open");
        });
    }

    panel.addEventListener("click", (e) => {
        if (e.target === panel) {
            panel.classList.remove("open");
        }
    });

    if (volumeSlider) {
        volumeSlider.addEventListener("input", () => {
            const level = volumeSlider.valueAsNumber / 100;
            setAlertVolume(level);
        });
    }

    if (chimeChk) {
        chimeChk.addEventListener("change", () => {
            alertSettings.enableChime = chimeChk.checked;
            saveAlertSettings();
        });
    }

    if (voiceChk) {
        voiceChk.addEventListener("change", () => {
            alertSettings.enableVoice = voiceChk.checked;
            saveAlertSettings();
        });
    }

    if (notifChk) {
        notifChk.addEventListener("change", () => {
            alertSettings.enableNotification = notifChk.checked;
            saveAlertSettings();
        });
    }

    if (cooldownSel) {
        cooldownSel.addEventListener("change", () => {
            alertSettings.cooldownSeconds = parseInt(cooldownSel.value, 10) || 0;
            saveAlertSettings();
        });
    }

    if (highVolSel) {
        highVolSel.addEventListener("change", () => {
            alertSettings.highVolumeThreshold = parseInt(highVolSel.value, 10) || 1;
            saveAlertSettings();
        });
    }

    if (testBtn) {
        testBtn.addEventListener("click", () => {
            handleQueueAlerts(true, true, alertSettings.highVolumeThreshold + 1);
        });
    }
}

// ===============================
// LOAD CURRENT QUEUE STATUS (MULTI-QUEUE)
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    if (!body) return;
    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        const queues = data && Array.isArray(data.QueueStatus) ? data.QueueStatus : [];
        if (queues.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            return;
        }

        let anyAlert = false;
        let highAlert = false;
        let maxCalls = 0;
        let html = "";

        queues.forEach(q => {
            const calls = Number(q.TotalCalls || 0);
            const agents = safe(q.TotalLoggedAgents, 0);
            const waiting = Number(q.CallsWaiting ?? q.CallsInQueue ?? 0);

            const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
            const avgWaitSeconds = q.AvgWaitInterval ?? 0;

            const hasAlert = (calls > 0 || waiting > 0);
            if (hasAlert) anyAlert = true;

            maxCalls = Math.max(maxCalls, calls, waiting);

            if (calls >= alertSettings.highVolumeThreshold ||
                waiting >= alertSettings.highVolumeThreshold) {
                highAlert = true;
            }

            const callsClass = hasAlert ? "numeric queue-alert" : "numeric";

            html += `
                <tr>
                    <td>${safe(q.QueueName, "Unknown")}</td>
                    <td class="${callsClass}">${calls}</td>
                    <td class="numeric">${agents}</td>
                    <td class="numeric">${formatTime(maxWaitSeconds)}</td>
                    <td class="numeric">${formatTime(avgWaitSeconds)}</td>
                </tr>
            `;
        });

        body.innerHTML = html;

        // Panel border + alerts are in their own safe wrapper so they never break the table
        try {
            const panel = document.getElementById("queue-panel");
            if (panel) {
                if (anyAlert) {
                    panel.classList.add("queue-panel-alert");
                } else {
                    panel.classList.remove("queue-panel-alert");
                }
            }
            handleQueueAlerts(anyAlert, highAlert, maxCalls);
        } catch (e) {
            console.warn("Alert handling error:", e);
        }

    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
    }
}

// ===============================
// LOAD GLOBAL STATS
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

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value === undefined || value === null ? "--" : value;
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
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;

            const duration = formatTime(a.SecondsInCurrentStatus ?? 0);
            const avgHandleSeconds = inbound > 0
                ? Math.round((a.TotalSecondsOnCall || 0) / inbound)
                : 0;

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

// ===============================
// DARK MODE TOGGLE
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
    loadAlertSettings();
    initAlertAudio();
    initAlertSettingsUI();
    initDarkMode();

    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().catch(() => {});
    }

    refreshAll();
    setInterval(refreshAll, 10000);
});
