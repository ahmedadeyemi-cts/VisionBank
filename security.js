/* ============================================================
   VisionBank Security Admin Portal Logic
   ============================================================ */

const ADMIN_PASSWORD = "VISIONBANK-ADMIN";   // change to something strong
const ADMIN_SESSION_KEY = "vb-admin-session";

/* ---------- Admin Session Helpers ---------- */
function isAdminSessionActive() {
    const raw = localStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return false;
    try {
        const sess = JSON.parse(raw);
        if (!sess.expiresAt) return false;
        return Date.now() < sess.expiresAt;
    } catch {
        return false;
    }
}

function startAdminSession() {
    const expiresAt = Date.now() + 30 * 60 * 1000; // 30 min
    localStorage.setItem(
        ADMIN_SESSION_KEY,
        JSON.stringify({ issuedAt: Date.now(), expiresAt })
    );
}

function clearAdminSession() {
    localStorage.removeItem(ADMIN_SESSION_KEY);
}

/* ---------- MFA Helpers ---------- */
function generateMfaCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

/* ---------- UI Helpers ---------- */
function showAuthSection() {
    document.getElementById("auth-section").style.display = "block";
    document.getElementById("admin-section").style.display = "none";
}

function showAdminSection() {
    document.getElementById("auth-section").style.display = "none";
    document.getElementById("admin-section").style.display = "block";

    const status = document.getElementById("adminStatus");
    status.textContent = "Admin session active (expires in 30 min)";
}

/* ---------- Load Logs ---------- */
function loadLogs() {
    const logs = JSON.parse(localStorage.getItem("vb-security-logs") || "[]");
    const tbody = document.getElementById("logTableBody");
    tbody.innerHTML = "";

    if (!logs.length) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="4" style="text-align:center;">No blocked attempts logged.</td>`;
        tbody.appendChild(tr);
        return;
    }

    logs.slice().reverse().forEach(log => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${log.ip}</td>
            <td>${log.reason}</td>
            <td>${log.time}</td>
            <td>${log.fingerprint}</td>
        `;
        tbody.appendChild(tr);
    });
}

/* ---------- IP Rules Form ---------- */
function loadIpRulesForm() {
    const cfg = window.vbGetSecurityConfig ? window.vbGetSecurityConfig() : null;
    if (!cfg) return;

    const lines = (cfg.allowedIps || []).map(rule => {
        if (rule.type === "single") return `single:${rule.ip}`;
        if (rule.type === "range") return `range:${rule.cidr}`;
        return "";
    }).filter(Boolean);

    document.getElementById("ipRules").value = lines.join("\n");
}

function saveIpRules() {
    const text = document.getElementById("ipRules").value || "";
    const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

    const rules = [];
    for (let line of lines) {
        const [type, value] = line.split(":").map(v => v.trim());
        if (type === "single" && value) {
            rules.push({ type: "single", ip: value });
        } else if (type === "range" && value) {
            rules.push({ type: "range", cidr: value });
        }
    }

    const cfg = window.vbGetSecurityConfig();
    cfg.allowedIps = rules;
    window.vbSaveSecurityConfig(cfg);

    alert("IP rules updated.");
}

/* ---------- Business Hours Form ---------- */
function loadBusinessHoursForm() {
    const cfg = window.vbGetSecurityConfig ? window.vbGetSecurityConfig() : null;
    if (!cfg) return;
    const bh = cfg.businessHours || {};

    // times
    const startHour = bh.startHour ?? 7;
    const endHour = bh.endHour ?? 19;

    document.getElementById("bhStart").value =
        String(startHour).padStart(2, "0") + ":00";
    document.getElementById("bhEnd").value =
        String(endHour).padStart(2, "0") + ":00";

    // days
    const days = bh.days || [1, 2, 3, 4, 5, 6];
    document
        .querySelectorAll(".bh-days input[type=checkbox]")
        .forEach(cb => {
            cb.checked = days.includes(parseInt(cb.value, 10));
        });
}

function saveBusinessHours() {
    const cfg = window.vbGetSecurityConfig();
    const bh = cfg.businessHours || {};

    // parse times (HH:MM)
    const startStr = document.getElementById("bhStart").value || "07:00";
    const endStr = document.getElementById("bhEnd").value || "19:00";

    const startHour = parseInt(startStr.split(":")[0], 10) || 7;
    const endHour = parseInt(endStr.split(":")[0], 10) || 19;

    const days = [];
    document
        .querySelectorAll(".bh-days input[type=checkbox]")
        .forEach(cb => {
            if (cb.checked) days.push(parseInt(cb.value, 10));
        });

    bh.startHour = startHour;
    bh.endHour = endHour;
    bh.days = days.length ? days : [1, 2, 3, 4, 5, 6];

    cfg.businessHours = bh;
    window.vbSaveSecurityConfig(cfg);

    alert("Business hours updated.");
}

/* ---------- INIT AUTH UI ---------- */
function initAuth() {
    const authSection = document.getElementById("auth-section");
    const adminSection = document.getElementById("admin-section");
    if (!authSection || !adminSection) return;

    if (isAdminSessionActive()) {
        showAdminSection();
        loadLogs();
        loadIpRulesForm();
        loadBusinessHoursForm();
    } else {
        showAuthSection();
    }

    // Step 1: password
    const startBtn = document.getElementById("startMfaBtn");
    startBtn.addEventListener("click", () => {
        const pwd = document.getElementById("adminPassword").value || "";
        if (pwd !== ADMIN_PASSWORD) {
            alert("Incorrect password.");
            return;
        }

        // Generate MFA code
        const code = generateMfaCode();
        sessionStorage.setItem("vb-admin-mfa-code", code);

        // Show QR + code
        const mfaPanel = document.getElementById("auth-step-mfa");
        const pwdPanel = document.getElementById("auth-step-password");
        pwdPanel.style.display = "none";
        mfaPanel.style.display = "block";

        const codePlain = document.getElementById("mfaCodePlain");
        const qrImg = document.getElementById("mfaQr");

        codePlain.textContent = code;

        const qrData = `VB-ADMIN|${code}`;
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(qrData)}`;
    });

    // Step 2: verify MFA
    const mfaBtn = document.getElementById("mfaSubmitBtn");
    mfaBtn.addEventListener("click", () => {
        const expected = sessionStorage.getItem("vb-admin-mfa-code");
        const entered = (document.getElementById("mfaInput").value || "").trim();

        if (!expected) {
            alert("MFA session expired. Please reload and try again.");
            return;
        }

        if (entered !== expected) {
            alert("Incorrect MFA code.");
            return;
        }

        // success
        sessionStorage.removeItem("vb-admin-mfa-code");
        startAdminSession();
        showAdminSection();
        loadLogs();
        loadIpRulesForm();
        loadBusinessHoursForm();
    });

    // Logout
    const logoutBtn = document.getElementById("logoutBtn");
    logoutBtn.addEventListener("click", () => {
        clearAdminSession();
        location.reload();
    });

    // Save IP rules
    document.getElementById("saveIpRulesBtn")
        .addEventListener("click", saveIpRules);

    // Save business hours
    document.getElementById("saveBhBtn")
        .addEventListener("click", saveBusinessHours);
}

/* ---------- DOM READY ---------- */
document.addEventListener("DOMContentLoaded", () => {
    initAuth();
});
