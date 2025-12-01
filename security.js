/* ============================================================
   GLOBAL SECURITY CONFIG
   ============================================================ */
const SECURITY = {
    superAdminId: "superadmin",
    superAdminPin: "ChangeMeNow!",
    pin: "ChangeMeNow!",
    mfaEmails: [
        "ahmed.adeyemi@oneneck.com",
        "ahmed.adeyemi@ussignal.com"
    ]
};

/* ============================================================
   AUDIT LOGGING
   ============================================================ */
function log(event) {
    const logs = JSON.parse(localStorage.getItem("auditLog") || "[]");
    logs.unshift(`${new Date().toLocaleString()} — ${event}`);
    localStorage.setItem("auditLog", JSON.stringify(logs));
}

/* ============================================================
   DARK MODE
   ============================================================ */
document.getElementById("darkToggle").addEventListener("click", () => {
    document.body.classList.toggle("dark-mode");
});

/* ============================================================
   LOGIN VALIDATION
   ============================================================ */
function validateLogin() {
    const user = document.getElementById("adminUser").value.trim();
    const pin = document.getElementById("adminPin").value.trim();
    const error = document.getElementById("login-error");

    if (user === SECURITY.superAdminId && pin === SECURITY.superAdminPin) {
        sendMFA();
    } else {
        error.textContent = "Invalid credentials.";
        log(`FAILED LOGIN attempt for user ${user}`);
    }
}

/* ============================================================
   MFA SYSTEM
   ============================================================ */
let currentMFA = null;

function sendMFA() {
    currentMFA = Math.floor(100000 + Math.random() * 900000).toString();
    log(`MFA sent: ${currentMFA}`);

    SECURITY.mfaEmails.forEach(e => {
        console.log(`MFA code ${currentMFA} sent to ${e}`);
    });

    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("mfa-section").classList.remove("hidden");
}

function verifyMFA() {
    const code = document.getElementById("mfaInput").value.trim();

    if (code === currentMFA) {
        log("MFA SUCCESS — Admin logged in");
        sessionStorage.setItem("vb-admin-auth", "true");

        window.location.href = "security-dashboard.html";
    } else {
        document.getElementById("mfa-error").textContent = "Incorrect authentication code.";
        log("MFA FAILURE");
    }
}

function resendMFA() {
    sendMFA();
}

/* ============================================================
   OVERRIDE SYSTEM
   ============================================================ */
function showOverride() {
    document.getElementById("login-section").classList.add("hidden");
    document.getElementById("override-section").classList.remove("hidden");
}

function validateOverride() {
    const key = document.getElementById("overrideKey").value.trim();

    if (key === SECURITY.pin) {
        log("ADMIN OVERRIDE USED");
        sessionStorage.setItem("vb-admin-auth", "true");
        window.location.href = "security-dashboard.html";
    } else {
        document.getElementById("override-error").textContent = "Invalid override key.";
    }
}
