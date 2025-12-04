// ===============================
// CONFIG
// ===============================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Cloudflare Worker base (for IP + business hours)
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

// Helper to call CC API
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
// SECURITY CHECK
// ===============================
async function checkSecurityAccess() {
    try {
        const res = await fetch(`${SECURITY_BASE}/security/check`, {
            method: "GET",
            headers: { "Content-Type": "application/json" }
        });

        if (!res.ok) throw new Error(`Security HTTP ${res.status}`);

        const data = await res.json();
        window.VB_SECURITY = data; // store globally

        if (data.allowed) {
            console.log("Security Approved:", data);
            showSecurityBanner(data.info);
            return true;
        }

        console.warn("Security Denied:", data);
        showAccessDenied(data);
        return false;

    } catch (err) {
        console.error("Security check failed:", err);
        showAccessDenied({ reason: "unreachable" });
        return false;
    }
}

// ===============================
// SECURITY BANNER (bottom-right)
// ===============================
function showSecurityBanner(info) {
    const banner = document.createElement("div");
    banner.style.position = "fixed";
    banner.style.bottom = "12px";
    banner.style.right = "12px";
    banner.style.background = "rgba(0,0,0,0.75)";
    banner.style.color = "#fff";
    banner.style.padding = "8px 14px";
    banner.style.borderRadius = "6px";
    banner.style.fontSize = "12px";
    banner.style.zIndex = "9999";

    const ip = info.ip || "Unknown";
    const now = info.nowCst || info.now || "Unknown Time";

    banner.textContent = `Access Approved — IP: ${ip} • CST: ${now}`;
    document.body.appendChild(banner);
}

// ===============================
// ACCESS DENIED UI
// ===============================
function showAccessDenied(info) {
    const overlay = document.getElementById("access-denied-overlay");
    const msgEl = document.getElementById("access-denied-message");

    let text = "Your access is currently unavailable.";

    if (info && info.reason === "ip-denied") {
        text = "Your access is being denied due to lack of permission. Please contact The IT Team.";
    } else if (info && info.reason === "hours-closed") {
        text = "Access is unavailable because it is outside of business hours.";
    } else if (info && info.reason === "unreachable") {
        text = "Security validation is unreachable. Contact The IT Team.";
    }

    if (msgEl) msgEl.textContent = text;
    if (overlay) overlay.classList.remove("hidden");
}

// ===============================
// HELPERS
// ===============================
function formatTime(sec) {
    if (!sec && sec !== 0) return "00:00:00";
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatDate(utc) {
    if (!utc) return "--";
    return new Date(utc + "Z").toLocaleString("en-US", {
        timeZone: "America/Chicago"
    });
}

function safe(v, fallback = "--") {
    return v === undefined || v === null ? fallback : v;
}

function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();
    if (s.includes("available")) return "status-available";
    if (s.includes("on call") || s.includes("dial")) return "status-oncall";
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
        if (!data?.QueueStatus?.length) {
            body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
            return;
        }

        const q = data.QueueStatus[0];
        const row = `
            <tr>
                <td>${safe(q.QueueName)}</td>
                <td class="numeric">${safe(q.TotalCalls, 0)}</td>
                <td class="numeric">${safe(q.TotalLoggedAgents, 0)}</td>
                <td class="numeric">${formatTime(q.MaxWaitingTime || q.OldestWaitTime || 0)}</td>
                <td class="numeric">${formatTime(q.AvgWaitInterval || 0)}</td>
            </tr>`;
        body.innerHTML = row;

    } catch (err) {
        console.error("Queue error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
    }
}

// ===============================
// LOAD GLOBAL STATISTICS
// ===============================
async function loadGlobalStats() {
    const errorDiv = document.getElementById("global-error");
    errorDiv.textContent = "";

    try {
        const data = await fetchApi("/statistics/global");
        if (!data?.GlobalStatistics?.length) {
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

function setText(id, val) {
    const el = document.getElementById(id);
    if (el) el.textContent = val ?? "--";
}

// ===============================
// LOAD AGENT STATUS
// ===============================
async function loadAgentStatus() {
    const body = document.getElementById("agent-body");
    body.innerHTML = `<tr><td colspan="11" class="loading">Loading agent data…</td></tr>`;

    try {
        const data = await fetchApi("/status/agents");
        if (!data?.AgentStatus?.length) {
            body.innerHTML = `<tr><td colspan="11" class="error">Unable to load agent data.</td></tr>`;
            return;
        }

        body.innerHTML = "";

        data.AgentStatus.forEach(a => {
            const inbound = a.TotalCallsReceived ?? 0;
            const avgSecs = inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${safe(a.FullName)}</td>
                <td>${safe(a.TeamName)}</td>
                <td>${safe(a.PhoneExt)}</td>
                <td class="availability-cell ${getAvailabilityClass(a.CallTransferStatusDesc)}">
                    ${safe(a.CallTransferStatusDesc)}
                </td>
                <td class="numeric">${inbound}</td>
                <td class="numeric">${a.TotalCallsMissed ?? 0}</td>
                <td class="numeric">${a.ThirdPartyTransferCount ?? 0}</td>
                <td class="numeric">${a.DialoutCount ?? 0}</td>
                <td class="numeric">${formatTime(avgSecs)}</td>
                <td class="numeric">${formatTime(a.SecondsInCurrentStatus || 0)}</td>
                <td>${formatDate(a.StartDateUtc)}</td>
            `;
            body.appendChild(row);
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

    const stored = localStorage.getItem("dashboard-dark-mode");
    if (stored === "on") {
        document.body.classList.add("dark-mode");
        btn.textContent = "Light mode";
    }

    btn.addEventListener("click", () => {
        const dark = document.body.classList.toggle("dark-mode");
        btn.textContent = dark ? "Light mode" : "Dark mode";
        localStorage.setItem("dashboard-dark-mode", dark ? "on" : "off");
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
    const ok = await checkSecurityAccess();
    if (!ok) return; // overlay already displayed

    initDarkMode();
    refreshAll();
    setInterval(refreshAll, 10000);
});
