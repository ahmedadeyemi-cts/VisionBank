/* ============================================================
   VisionBank Security Core Authentication
   ============================================================ */

console.log("security.js loaded");

emailjs.init("Z_4fEOdBy8J__XmyP");

/* ============================================================
   CONFIGURATION
   ============================================================ */

const VB_ADMIN = {
    username: "superadmin",
    pin: "ChangeMeNow!",
    overrideKey: "VB-OVERRIDE-911",
    mfaEmails: [
        "ahmed.adeyemi@ussignal.com",
        "ahmed.adeyemi@oneneck.com",
        "ahmedadeyemi@gmail.com"
    ],
    emailService: "service_ftbnopr",
    emailTemplate: "template_v8t8bzj"  // <-- replace with your EmailJS template ID
};

/* ============================================================
   STATE
   ============================================================ */

let currentMFA = null;
let authenticatedUser = null;

/* ============================================================
   RENDER LOGIN
   ============================================================ */

function renderLogin() {
    const root = document.getElementById("vb-root");

    root.innerHTML = `
    <div class="vb-shell">
        <div class="vb-login-card">
            <div class="vb-login-header">
                <h2>Secure Administrator Login</h2>
                <p>Authorized VisionBank personnel only</p>
            </div>

            <div class="vb-field">
                <label>Admin Username</label>
                <input id="vb-username" class="vb-input" placeholder="Username">
            </div>

            <div class="vb-field">
                <label>PIN</label>
                <input id="vb-pin" type="password" class="vb-input" placeholder="PIN">
            </div>

            <button id="vb-login-btn" class="vb-btn-primary">Login</button>

            <div class="vb-btn-inline-row">
                <button id="vb-override-btn" class="vb-btn-secondary">Use Override Key</button>
            </div>

            <div id="vb-login-msg"></div>
        </div>
    </div>
    `;

    document.getElementById("vb-login-btn").onclick = handleLogin;
    document.getElementById("vb-override-btn").onclick = renderOverridePrompt;
}

/* ============================================================
   LOGIN HANDLER
   ============================================================ */

function handleLogin() {
    const user = document.getElementById("vb-username").value.trim();
    const pin = document.getElementById("vb-pin").value.trim();
    const msgBox = document.getElementById("vb-login-msg");

    if (user !== VB_ADMIN.username || pin !== VB_ADMIN.pin) {
        msgBox.innerHTML = `<div class="vb-alert vb-alert-error">Invalid username or PIN.</div>`;
        return;
    }

    // Generate MFA code
    currentMFA = Math.floor(100000 + Math.random() * 900000).toString();

    msgBox.innerHTML = `<div class="vb-alert vb-alert-info">Sending MFA code…</div>`;

    // Send MFA email(s)
    VB_ADMIN.mfaEmails.forEach(email => {
        emailjs.send(VB_ADMIN.emailService, VB_ADMIN.emailTemplate, {
            to_email: email,
            code: currentMFA,
            admin: VB_ADMIN.username
        }).catch(err => {
            console.error("EmailJS error:", err);
        });
    });

    setTimeout(() => {
        renderMFAPrompt();
    }, 600);
}

/* ============================================================
   RENDER MFA PROMPT
   ============================================================ */

function renderMFAPrompt() {
    const root = document.getElementById("vb-root");

    root.innerHTML = `
    <div class="vb-shell">
        <div class="vb-login-card">
            <div class="vb-login-header">
                <h2>MFA Verification</h2>
                <p>A 6-digit verification code was emailed to all admin addresses.</p>
            </div>

            <div class="vb-field">
                <label>Enter Code</label>
                <input id="vb-mfa-code" class="vb-input" placeholder="123456">
            </div>

            <button id="vb-mfa-btn" class="vb-btn-primary">Verify</button>

            <div id="vb-mfa-msg"></div>
        </div>
    </div>
    `;

    document.getElementById("vb-mfa-btn").onclick = handleMFACheck;
}

/* ============================================================
   MFA CHECK
   ============================================================ */

function handleMFACheck() {
    const code = document.getElementById("vb-mfa-code").value.trim();
    const msgBox = document.getElementById("vb-mfa-msg");

    if (code !== currentMFA) {
        msgBox.innerHTML = `<div class="vb-alert vb-alert-error">Incorrect code.</div>`;
        return;
    }

    authenticatedUser = VB_ADMIN.username;
    localStorage.setItem("vb-auth", "true");

    renderDashboard();
}

/* ============================================================
   OVERRIDE KEY
   ============================================================ */

function renderOverridePrompt() {
    const root = document.getElementById("vb-root");

    root.innerHTML = `
    <div class="vb-shell">
        <div class="vb-login-card">

            <div class="vb-login-header">
                <h2>Override Access</h2>
                <p>Enter emergency override key</p>
            </div>

            <div class="vb-field">
                <label>Override Key</label>
                <input id="vb-override-input" class="vb-input" placeholder="Override key">
            </div>

            <button id="vb-override-go" class="vb-btn-primary">Unlock</button>

            <div id="vb-override-msg"></div>
        </div>
    </div>
    `;

    document.getElementById("vb-override-go").onclick = handleOverrideCheck;
}

function handleOverrideCheck() {
    const key = document.getElementById("vb-override-input").value.trim();
    const msg = document.getElementById("vb-override-msg");

    if (key !== VB_ADMIN.overrideKey) {
        msg.innerHTML = `<div class="vb-alert vb-alert-error">Invalid override key.</div>`;
        return;
    }

    authenticatedUser = "Override";
    localStorage.setItem("vb-auth", "true");

    renderDashboard();
}

/* ============================================================
   DASHBOARD LOADER
   ============================================================ */

function renderDashboard() {
    console.log("Loading dashboard…");
    if (typeof window.renderSecurityDashboard === "function") {
        window.renderSecurityDashboard(authenticatedUser);
    } else {
        console.error("security-dashboard.js missing.");
    }
}

/* ============================================================
   INITIALIZE PAGE
   ============================================================ */

window.addEventListener("DOMContentLoaded", () => {
    if (localStorage.getItem("vb-auth") === "true") {
        renderDashboard();
    } else {
        renderLogin();
    }
});
