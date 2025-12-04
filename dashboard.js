// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Cloudflare Worker base
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

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

    if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
    }
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
// SECURITY FOOTER BANNER
// ===============================
(function showSecurityBanner() {
    const el = document.getElementById("securityStatus");
    if (!el || !window.VB_SECURITY || !window.VB_SECURITY.info) return;

    const ip = window.VB_SECURITY.info.ip || "Unknown";
    const timestamp = window.VB_SECURITY.info.now || "Unknown Time";

    el.textContent =
        "Access approved from IP " + ip + " at " + timestamp + " (CST)";
})();

// ===============================
// HELPERS
// ===============================
function formatTime(sec) {
    if (sec == null || isNaN(sec)) return "00:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

function formatDate(utc) {
    if (!utc) return "--";
    return new Date(utc + "Z").toLocaleString("en-US", {
        timeZone: "America/Chicago"
    });
}

function safe(value, fallback = "--") {
    return value === undefined || value === null ? fallback : value;
}

function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();

    if (s.includes("available")) return "status-available";
    if (s.includes("on call") || s.includes("dialing") || s.includes("dial out"))
        return "status-oncall";
    if (s.includes("busy")) return "status-busy";
    if (s.includes("ring")) return "status-ringing";
    if (s.includes("wrap")) return "status-wrapup";

    return "";
}

// ===============================
// LOAD QUEUE STATUS
// ===============================
async function loadQueueStatus() {
    const body = document.getElementById("queue-body");

    body.innerHTML = `<tr><td colspan="5" class="loading">Loading queue status…</td></tr>`;

    try {
        const data = await fetchApi("/status/queues");
        const q = data?.QueueStatus?.[0];

        if (!q) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue data.</td></tr>`;
            return;
        }

        const row = `
            <tr>
                <td>${safe(q.QueueName)}</td>
                <td class="numeric">${safe(q.TotalCalls,0)}</td>
                <td class="numeric">${safe(q.TotalLoggedAgents,0)}</td>
                <td class="numeric">${formatTime(q.MaxWaitingTime ?? q.OldestWaitTime)}</td>
                <td class="numeric">${formatTime(q.AvgWaitInterval)}</td>
            </tr>
        `;

        body.innerHTML = row;

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
    errorDiv.textContent = "";

    try {
        const data = await fetchApi("/statistics/global");
        const g = data?.GlobalStatistics?.[0];

        if (!g) {
            errorDiv.textContent = "Unable to load global statistics.";
            return;
        }

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.textContent = val ?? "--";
        };

        set("gs-total-queued", g.TotalCallsQueued);
        set("gs-total-transferred", g.TotalCallsTransferred);
        set("gs-total-abandoned", g.TotalCallsAbandoned);
        set("gs-max-wait", formatTime(g.MaxQueueWaitingTime));

        set("gs-service-level", g.ServiceLevel != null ? g.ServiceLevel.toFixed(2) + "%" : "--");
        set("gs-total-received", g.TotalCallsReceived);

        set("gs-answer-rate", g.AnswerRate != null ? g.AnswerRate.toFixed(2) + "%" : "--");
        set("gs-abandon-rate", g.AbandonRate != null ? g.AbandonRate.toFixed(2) + "%" : "--");

        set("gs-callbacks-registered", g.CallbacksRegistered);
        set("gs-callbacks-waiting", g.CallbacksWaiting);

    } catch (err) {
        console.error("Global stats error:", err);
        errorDiv.textContent = "Unable to load global statistics.";
    }
}

// ===============================
// LOAD AGENT STATUS
// ===============================
async function loadAgentStatus() {
    const body = document.getElementById("agent-body");

    body.innerHTML = `<tr><td colspan="11" class="loading">Loading agent data…</td></tr>`;

    try {
        const data = await fetchApi("/status/agents");
        const list = data?.AgentStatus;

        if (!Array.isArray(list) || list.length === 0) {
            body.innerHTML = `<tr><td colspan="11" class="error">No agent data found.</td></tr>`;
            return;
        }

        body.innerHTML = "";

        list.forEach(a => {
            const inbound = a.TotalCallsReceived ?? 0;
            const avgHandleSeconds = inbound > 0
                ? Math.round((a.TotalSecondsOnCall || 0) / inbound)
                : 0;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${safe(a.FullName)}</td>
                <td>${safe(a.TeamName)}</td>
                <td>${safe(a.PhoneExt)}</td>
                <td class="availability-cell ${getAvailabilityClass(a.CallTransferStatusDesc)}">
                    ${safe(a.CallTransferStatusDesc)}
                </td>
                <td class="numeric">${inbound}</td>
                <td class="numeric">${safe(a.TotalCallsMissed,0)}</td>
                <td class="numeric">${safe(a.ThirdPartyTransferCount,0)}</td>
                <td class="numeric">${safe(a.DialoutCount,0)}</td>
                <td class="numeric">${formatTime(avgHandleSeconds)}</td>
                <td class="numeric">${formatTime(a.SecondsInCurrentStatus)}</td>
                <td>${formatDate(a.StartDateUtc)}</td>
            `;

            body.appendChild(row);
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

    const stored = localStorage.getItem("dashboard-dark-mode");
    if (stored === "on") {
        document.body.classList.add("dark-mode");
        btn.textContent = "Light mode";
    }

    btn.addEventListener("click", () => {
        const isDark = document.body.classList.toggle("dark-mode");
        btn.textContent = isDark ? "Light mode" : "Dark mode";
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

document.addEventListener("DOMContentLoaded", async () => {
    // Only continue if index.html security pre-check passed
    const ok = await checkSecurityAccess();
    if (!ok) return;

    initDarkMode();
    refreshAll();
    setInterval(refreshAll, 10000);
});
