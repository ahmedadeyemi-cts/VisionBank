// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Cloudflare Worker base (for IP + business hours)
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

// Small helper to call main CC API with token
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
// SECURITY GATE (IP + Business Hours via Worker)
// ===============================

async function checkSecurityAccess() {
    try {
        const res = await fetch(`${SECURITY_BASE}/security/check`, {
            method: "GET",
            headers: {
                "Content-Type": "application/json"
            }
        });

        if (!res.ok) {
            throw new Error(`Security check HTTP ${res.status}`);
        }

        const data = await res.json();

        if (data.allowed) {
            return true;
        }

        // Denied – show proper reason
        showAccessDenied(data);
        return false;
    } catch (err) {
        console.error("Security check failed:", err);
        // Local fallback: deny with generic message
        showAccessDenied({
            reason: "unreachable"
        });
        return false;
    }
}

function showAccessDenied(info) {
    const overlay = document.getElementById("access-denied-overlay");
    const msgEl = document.getElementById("access-denied-message");

    let text;

    if (info && info.reason === "ip-denied") {
        text =
            "Your access is being denied due to lack of permission. Please contact The IT Team to enable your access.";
    } else if (info && info.reason === "hours-closed") {
        text =
            "Your access is currently unavailable due to being outside of our normal business hours.";
    } else {
        text =
            "Your access is currently unavailable. Please contact The IT Team for assistance.";
    }

    if (msgEl) {
        msgEl.textContent = text;
    }

    if (overlay) {
        overlay.classList.remove("hidden");
    } else {
        // Hard fallback: replace entire body if overlay not found
        document.body.innerHTML = `
            <div style="
                max-width:600px;
                margin:120px auto;
                font-family:Arial, sans-serif;
                text-align:center;
                border-radius:10px;
                padding:30px;
                border:1px solid #ccc;
                background:#ffffffdd;
            ">
                <h1>Access Restricted</h1>
                <p>${text}</p>
                <p>If you believe this is an error, contact the VisionBank IT Team.</p>
            </div>
        `;
    }
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
    if (s.includes("on call") || s.includes("dialing") || s.includes("dial out") || s.includes("dialing out")) {
        return "status-oncall";
    }

    // Busy → Yellow
    if (s.includes("busy")) return "status-busy";

    // Ringing → Orange
    if (s.includes("ringing") || s.includes("ring")) return "status-ringing";

    // Wrap-Up → Orange (same family)
    if (s.includes("wrap")) return "status-wrapup";

    return "";
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
            return;
        }

        const q = data.QueueStatus[0];

        const calls = safe(q.TotalCalls, 0);
        const agents = safe(q.TotalLoggedAgents, 0);

        const maxWaitSeconds = q.MaxWaitingTime ?? q.OldestWaitTime ?? 0;
        const avgWaitSeconds = q.AvgWaitInterval ?? 0;

        const rowHtml = `
            <tr>
                <td>${safe(q.QueueName, "Unknown")}</td>
                <td class="numeric">${calls}</td>
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

        data.AgentStatus.forEach((a) => {
            const inbound = a.TotalCallsReceived ?? 0;
            const missed = a.TotalCallsMissed ?? 0;
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;

            const avgHandleSeconds = inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;

            const availabilityClass = getAvailabilityClass(a.CallTransferStatusDesc);

            // Duration = SecondsInCurrentStatus
            const durationSeconds = a.SecondsInCurrentStatus ?? 0;

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
                <td class="numeric">${formatTime(durationSeconds)}</td>
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
    // 1) Check Cloudflare Worker (IP + Business Hours + KV rules)
    const ok = await checkSecurityAccess();
    if (!ok) {
        // Access denied or worker unreachable; UI is replaced/overlayed already
        return;
    }

    // 2) Only if allowed, bring up the normal dashboard
    initDarkMode();
    refreshAll();
    setInterval(refreshAll, 10000);
});
