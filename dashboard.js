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

// Map status text to availability class
function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();

    if (s.includes("available")) return "status-available";
    if (s.includes("on call") || s.includes("dial") || s.includes("talk")) return "status-oncall";
    if (s.includes("busy") || s.includes("not set") || s.includes("break")) return "status-busy";
    if (s.includes("ring") || s.includes("accept internal") || s.includes("wrap")) return "status-ringing";

    return "";
}

// ===============================
// QUEUE ALERT STATE + CHIME
// ===============================
let hadQueueAlert = false;

function playQueueChime() {
    try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.25);

        osc.onended = () => ctx.close();
    } catch (e) {
        console.warn("Unable to play chime:", e);
    }
}

// ===============================
// LOAD CURRENT QUEUE STATUS (UPDATED)
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");
    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");

        if (!data || !Array.isArray(data.QueueStatus) || data.QueueStatus.length === 0) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            return;
        }

        const q = data.QueueStatus[0];

        const calls = safe(q.TotalCalls, 0);
        const agents = safe(q.TotalLoggedAgents, 0);

        const waiting = safe(q.CallsWaiting ?? q.CallsInQueue ?? 0, 0);
        const hasQueueAlert = (calls > 0 || waiting > 0);

        if (hasQueueAlert && !hadQueueAlert) {
            playQueueChime();
        }
        hadQueueAlert = hasQueueAlert;

        const callsClass = hasQueueAlert ? "numeric queue-alert" : "numeric";

        const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
        const avgWaitSeconds = q.AvgWaitInterval ?? 0;

        const rowHtml = `
            <tr>
                <td>${safe(q.QueueName, "Unknown")}</td>
                <td class="${callsClass}">${calls}</td>
                <td class="numeric">${agents}</td>
                <td class="numeric">${formatTime(maxWaitSeconds)}</td>
                <td class="numeric">${formatTime(avgWaitSeconds)}</td>
            </tr>
        `;

        body.innerHTML = rowHtml;

    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
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
// LOAD AGENT PERFORMANCE
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

// ===============================
// DARK MODE TOGGLE
// ===============================
function initDarkMode() {
    const btn = document.getElementById("darkModeToggle");

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
    refreshAll();
    setInterval(refreshAll, 10000);
});
