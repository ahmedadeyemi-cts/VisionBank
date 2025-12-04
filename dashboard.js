// ===========================================================
// CONFIG
// ===========================================================
const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3/realtime";
const TOKEN = "VWGKXWSqGA4FwlRXb2cIx5H1dS3cYpplXa5iI3bE4Xg=";

// Cloudflare Worker (Security Gate)
const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

// Global object to store security info for optional UI banner/footer
window.VB_SECURITY = null;

// ===========================================================
// API WRAPPER (with retry)
// ===========================================================
async function fetchApi(path, retries = 2) {
    try {
        const res = await fetch(`${API_BASE}${path}`, {
            headers: {
                "Content-Type": "application/json",
                "token": TOKEN
            }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
    } catch (err) {
        if (retries > 0) {
            console.warn(`Retrying ${path} (${retries} left)…`);
            await new Promise(r => setTimeout(r, 400));
            return fetchApi(path, retries - 1);
        }
        throw err;
    }
}

// ===========================================================
// SECURITY GATE: Cloudflare Worker
// ===========================================================
async function checkSecurityAccess() {
    const url = `${SECURITY_BASE}/security/check`;

    try {
        const res = await fetch(url, {
            method: "GET",
            headers: {
                "Accept": "application/json",
                "Content-Type": "application/json"
            },
            mode: "cors",
            credentials: "omit"
        });

        if (!res.ok) {
            throw new Error(`Security check HTTP ${res.status}`);
        }

        const data = await res.json();
        window.VB_SECURITY = data;

        if (data.allowed) {
            return true;
        }

        showAccessDenied(data);
        return false;

    } catch (err) {
        console.error("Security check failed:", err);

        // Worker unreachable = DANGEROUS → hide data
        showAccessDenied({ reason: "unreachable" });
        return false;
    }
}

// ===========================================================
// ACCESS DENIED OVERLAY
// ===========================================================
function showAccessDenied(info) {
    const overlay = document.getElementById("access-denied-overlay");
    const msgEl = document.getElementById("access-denied-message");

    let text;

    switch (info.reason) {
        case "ip-denied":
            text = "Your access is being denied due to lack of permission. Please contact the IT Team.";
            break;

        case "hours-closed":
            text = "Access is unavailable because it is outside of business hours.";
            break;

        case "unreachable":
            text = "Security verification service is unavailable. Please contact IT.";
            break;

        default:
            text = "Your access is currently unavailable. Please contact the IT Team.";
            break;
    }

    if (msgEl) msgEl.textContent = text;
    if (overlay) {
        overlay.classList.remove("hidden");
    } else {
        // Hard fallback
        document.body.innerHTML = `
            <div style="
                max-width:600px;
                margin:120px auto;
                font-family:Arial, sans-serif;
                text-align:center;
                border-radius:10px;
                padding:30px;
                border:1px solid #ccc;
                background:#ffffffdd;">
                <h1>Access Restricted</h1>
                <p>${text}</p>
                <p>If you believe this is an error, contact the VisionBank IT Team.</p>
            </div>
        `;
    }
}

// ===========================================================
// HELPERS
// ===========================================================
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

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value ?? "--";
}

function getAvailabilityClass(desc) {
    const s = (desc || "").toLowerCase();

    if (s.includes("available")) return "status-available";
    if (s.includes("on call") || s.includes("dial") || s.includes("dialing")) return "status-oncall";
    if (s.includes("busy")) return "status-busy";
    if (s.includes("ring")) return "status-ringing";
    if (s.includes("wrap")) return "status-wrapup";

    return "";
}

// ===========================================================
// QUEUE STATUS
// ===========================================================
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
        body.innerHTML = `
            <tr>
                <td>${safe(q.QueueName, "Unknown")}</td>
                <td class="numeric">${safe(q.TotalCalls, 0)}</td>
                <td class="numeric">${safe(q.TotalLoggedAgents, 0)}</td>
                <td class="numeric">${formatTime(q.MaxWaitingTime ?? q.OldestWaitTime ?? 0)}</td>
                <td class="numeric">${formatTime(q.AvgWaitInterval ?? 0)}</td>
            </tr>
        `;
    } catch (err) {
        console.error("Queue load error:", err);
        body.innerHTML = `<tr><td colspan="5" class="error">Unable to load queue status.</td></tr>`;
    }
}

// ===========================================================
// GLOBAL STATS
// ===========================================================
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
        setText("gs-service-level", g.ServiceLevel?.toFixed(2) + "%" ?? "--");
        setText("gs-total-received", g.TotalCallsReceived);
        setText("gs-answer-rate", g.AnswerRate?.toFixed(2) + "%" ?? "--");
        setText("gs-abandon-rate", g.AbandonRate?.toFixed(2) + "%" ?? "--");
        setText("gs-callbacks-registered", g.CallbacksRegistered);
        setText("gs-callbacks-waiting", g.CallbacksWaiting);

    } catch (err) {
        console.error("Global stats error:", err);
        errorDiv.textContent = "Unable to load global statistics.";
    }
}

// ===========================================================
// AGENT STATUS
// ===========================================================
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

        data.AgentStatus.forEach((a) => {
            const inbound = a.TotalCallsReceived ?? 0;
            const missed = a.TotalCallsMissed ?? 0;
            const transferred = a.ThirdPartyTransferCount ?? 0;
            const outbound = a.DialoutCount ?? 0;
            const avgHandleSeconds = inbound > 0 ? Math.round((a.TotalSecondsOnCall || 0) / inbound) : 0;
            const durationSeconds = a.SecondsInCurrentStatus ?? 0;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${safe(a.FullName)}</td>
                <td>${safe(a.TeamName)}</td>
                <td>${safe(a.PhoneExt)}</td>
                <td class="availability-cell ${getAvailabilityClass(a.CallTransferStatusDesc)}">${safe(a.CallTransferStatusDesc)}</td>
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

// ===========================================================
// DARK MODE
// ===========================================================
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

// ===========================================================
// INIT
// ===========================================================
function refreshAll() {
    loadQueueStatus();
    loadAgentStatus();
    loadGlobalStats();
}

document.addEventListener("DOMContentLoaded", async () => {
    // 1) Cloudflare Security Check
    const ok = await checkSecurityAccess();
    if (!ok) return;

    // 2) Proceed with dashboard
    initDarkMode();
    refreshAll();
    setInterval(refreshAll, 10000);

    // 3) (Optional) update footer with security state
    if (window.VB_SECURITY?.allowed) {
        console.log("Security Approved:", window.VB_SECURITY);
    }
});
