/* ============================================================
   SECURITY.JS — OLD UI + NEW WORKER LOGIC (FULL MERGE)
   VisionBank | Admin Login • MFA • Access Control
   ============================================================ */

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

/* ---------- UI Elements ---------- */
const loginView = document.getElementById("login-view");
const mfaSetupView = document.getElementById("mfa-setup-view");
const adminView = document.getElementById("admin-view");

const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-message");
const overrideToggle = document.getElementById("override-toggle");
const overrideForm = document.getElementById("override-form");
const overrideInput = document.getElementById("override-input");

const loginTotpWrapper = document.getElementById("login-totp-wrapper");
const loginTotp = document.getElementById("login-totp");

const mfaQrImg = document.getElementById("mfa-qr-img");
const mfaAccount = document.getElementById("mfa-account");
const mfaSecret = document.getElementById("mfa-secret");
const mfaCodeInput = document.getElementById("mfa-code");
const mfaConfirmBtn = document.getElementById("mfa-confirm-btn");
const mfaCancelBtn = document.getElementById("mfa-cancel-btn");
const mfaMsg = document.getElementById("mfa-message");

const logoutBtn = document.getElementById("logout-btn");

const hoursForm = document.getElementById("hours-form");
const hoursStart = document.getElementById("hours-start");
const hoursEnd = document.getElementById("hours-end");
const hoursDayChecks = document.querySelectorAll(".hours-day");

const ipForm = document.getElementById("ip-form");
const ipTextarea = document.getElementById("ip-textarea");

const auditLogBox = document.getElementById("audit-log");

/* ---------- State ---------- */
let ACTIVE_SESSION = null;

/* =============================================================
   1.  LOGIN HANDLING
   ============================================================= */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    const username = document.getElementById("login-username").value.trim();
    const pin = document.getElementById("login-pin").value.trim();
    const totp = loginTotpWrapper.classList.contains("hidden") ? "" : loginTotp.value.trim();

    try {
        const res = await fetch(`${WORKER_BASE}/api/login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, pin, totp }),
        });

        const data = await res.json();

        if (!res.ok) {
            loginMsg.textContent = data.error || "Login failed.";
            return;
        }

        /* -- FIRST LOGIN (MFA NOT SET UP) -- */
        if (data.requireMfaSetup) {
            ACTIVE_SESSION = data.session;
            showMfaSetup(data);
            return;
        }

        /* -- MFA REQUIRED FOR THIS LOGIN -- */
        if (data.requireTotp) {
            loginTotpWrapper.classList.remove("hidden");
            loginMsg.textContent = "Enter your 6-digit Google Authenticator code.";
            return;
        }

        /* -- SUCCESSFUL LOGIN -- */
        ACTIVE_SESSION = data.session;
        showAdminView();
    } catch (err) {
        loginMsg.textContent = "Network error connecting to authentication service.";
    }
});

/* =============================================================
   2.  OVERRIDE KEY HANDLING
   ============================================================= */

overrideToggle.addEventListener("click", () => {
    overrideForm.classList.toggle("hidden");
});

overrideForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    const key = overrideInput.value.trim();
    if (!key) return;

    try {
        const res = await fetch(`${WORKER_BASE}/api/override-login`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ key }),
        });

        const data = await res.json();

        if (!res.ok) {
            loginMsg.textContent = data.error || "Override key invalid.";
            return;
        }

        ACTIVE_SESSION = data.session;
        showAdminView();
    } catch (err) {
        loginMsg.textContent = "Error validating override key.";
    }
});

/* =============================================================
   3.  MFA SETUP FLOW
   ============================================================= */

function showMfaSetup(data) {
    loginView.classList.add("hidden");
    adminView.classList.add("hidden");
    mfaSetupView.classList.remove("hidden");

    /* Worker returns { qr, secret, account } */
    mfaQrImg.src = data.qr;
    mfaAccount.value = data.account;
    mfaSecret.value = data.secret;
}

mfaConfirmBtn.addEventListener("click", async () => {
    const code = mfaCodeInput.value.trim();
    if (!code) {
        mfaMsg.textContent = "Enter a 6-digit code.";
        return;
    }

    try {
        const res = await fetch(`${WORKER_BASE}/api/confirm-mfa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session: ACTIVE_SESSION, code }),
        });

        const data = await res.json();
        if (!res.ok) {
            mfaMsg.textContent = data.error || "Invalid MFA code.";
            return;
        }

        /* SUCCESS */
        showAdminView();
    } catch (err) {
        mfaMsg.textContent = "Unable to verify MFA code.";
    }
});

mfaCancelBtn.addEventListener("click", () => {
    mfaSetupView.classList.add("hidden");
    loginView.classList.remove("hidden");
});

/* =============================================================
   4.  SHOW ADMIN VIEW
   ============================================================= */

async function showAdminView() {
    loginView.classList.add("hidden");
    mfaSetupView.classList.add("hidden");
    adminView.classList.remove("hidden");

    await loadBusinessHours();
    await loadIpRules();
    await loadAuditLog();
}

/* =============================================================
   5.  BUSINESS HOURS
   ============================================================= */

async function loadBusinessHours() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-hours`);
        const data = await res.json();

        hoursStart.value = data.start || "";
        hoursEnd.value = data.end || "";

        hoursDayChecks.forEach((cb) => {
            cb.checked = data.days?.includes(Number(cb.value)) || false;
        });
    } catch (err) {
        console.error("Hours load failed:", err);
    }
}

hoursForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const start = hoursStart.value;
    const end = hoursEnd.value;
    const days = [...hoursDayChecks]
        .filter(cb => cb.checked)
        .map(cb => Number(cb.value));

    try {
        await fetch(`${WORKER_BASE}/api/set-hours`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ start, end, days }),
        });
    } catch (err) {
        console.error("Save hours failed:", err);
    }
});

/* =============================================================
   6.  IP ALLOWLIST
   ============================================================= */

async function loadIpRules() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`);
        const data = await res.json();
        ipTextarea.value = data.rules?.join("\n") || "";
    } catch (err) {
        console.error("IP load failed:", err);
    }
}

ipForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const rules = ipTextarea.value
        .split("\n")
        .map(r => r.trim())
        .filter(r => r);

    try {
        await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ rules }),
        });
    } catch (err) {
        console.error("Save IP rules failed:", err);
    }
});

/* =============================================================
   7.  AUDIT LOG
   ============================================================= */

async function loadAuditLog() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/logs`);
        const data = await res.json();

        auditLogBox.textContent = data.logs?.join("\n") || "No logs.";
    } catch (err) {
        auditLogBox.textContent = "Unable to load logs.";
    }
}

/* =============================================================
   8.  LOGOUT
   ============================================================= */

logoutBtn.addEventListener("click", () => {
    ACTIVE_SESSION = null;
    loginTotp.value = "";
    loginTotpWrapper.classList.add("hidden");

    adminView.classList.add("hidden");
    mfaSetupView.classList.add("hidden");
    loginView.classList.remove("hidden");
});
