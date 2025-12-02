/* =========================================
   VisionBank Security – Login & MFA
   ========================================= */

const SECURITY = {
    superAdminUser: "superadmin",
    superAdminPin: "ChangeMeNow!",
    overrideKey: "VisionBankOverride2024",
    mfaExpiryMinutes: 10,
    sessionMinutes: 30,
    email: {
        serviceId: "service_ftbnopr",
        templateId: "template_v8t8bzj",
        publicKey: "Z_4fEOdBy8J__XmyP"
    },
    adminEmails: [
        "ahmed.adeyemi@ussignal.com",
        "ahmed.adeyemi@oneneck.com",
        "ahmedadeyemi@gmail.com"
    ],
    lsKeys: {
        admin: "vb-admin",
        pinHash: "vb-admin-pin-hash",
        audit: "vb-auditLog",
        session: "vb-auth",
        mfa: "vb-mfa",
        reset: "vb-reset-token"
    }
};

/* ===== Local helpers ===== */
function getAudit() {
    try {
        return JSON.parse(localStorage.getItem(SECURITY.lsKeys.audit) || "[]");
    } catch {
        return [];
    }
}

function pushAudit(message) {
    const audit = getAudit();
    const ts = new Date().toLocaleString();
    audit.unshift(`${ts} — ${message}`);
    localStorage.setItem(SECURITY.lsKeys.audit, JSON.stringify(audit));
}

/* Hash PIN using WebCrypto */
async function hashPin(pin) {
    const data = new TextEncoder().encode(pin);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

/* Load / init admin config */
async function ensureAdminConfig() {
    let admin;
    try {
        admin = JSON.parse(localStorage.getItem(SECURITY.lsKeys.admin) || "null");
    } catch {
        admin = null;
    }

    if (!admin) {
        admin = {
            username: SECURITY.superAdminUser,
            emails: SECURITY.adminEmails
        };
        localStorage.setItem(SECURITY.lsKeys.admin, JSON.stringify(admin));

        // store hash for default PIN
        const h = await hashPin(SECURITY.superAdminPin);
        localStorage.setItem(SECURITY.lsKeys.pinHash, h);
        pushAudit("Initialized default superadmin credentials");
    }

    // make sure emails are present
    if (!admin.emails || !Array.isArray(admin.emails) || admin.emails.length === 0) {
        admin.emails = SECURITY.adminEmails;
        localStorage.setItem(SECURITY.lsKeys.admin, JSON.stringify(admin));
    }

    return admin;
}

/* Validate username + PIN */
async function validateCredentials(username, pin) {
    const admin = await ensureAdminConfig();
    const storedHash = localStorage.getItem(SECURITY.lsKeys.pinHash);
    const inputHash = await hashPin(pin);

    const userOK = username.trim().toLowerCase() === admin.username.toLowerCase();
    const pinOK = storedHash ? (storedHash === inputHash)
                             : (pin === SECURITY.superAdminPin);

    return userOK && pinOK;
}

/* Start an authenticated session */
function startSession(username) {
    const now = Date.now();
    const expires = now + SECURITY.sessionMinutes * 60 * 1000;
    const payload = { username, started: now, expires };
    localStorage.setItem(SECURITY.lsKeys.session, JSON.stringify(payload));
}

/* EmailJS send helper */
async function sendMfaEmail(code, emails) {
    try {
        emailjs.init(SECURITY.email.publicKey);

        const params = {
            to_email: emails.join(", "),
            code: code,
            timestamp: new Date().toLocaleString()
        };

        await emailjs.send(
            SECURITY.email.serviceId,
            SECURITY.email.templateId,
            params
        );
    } catch (err) {
        console.error("EmailJS error:", err);
        throw new Error("Unable to send MFA email");
    }
}

/* Save MFA payload */
function storeMfaState(code, username) {
    const expires = Date.now() + SECURITY.mfaExpiryMinutes * 60 * 1000;
    const payload = { code, username, expires };
    localStorage.setItem(SECURITY.lsKeys.mfa, JSON.stringify(payload));
}

/* Read MFA payload */
function getMfaState() {
    try {
        return JSON.parse(localStorage.getItem(SECURITY.lsKeys.mfa) || "null");
    } catch {
        return null;
    }
}

/* Forgot PIN: send reset token */
async function sendResetToken() {
    const admin = await ensureAdminConfig();
    const token = Math.floor(100000 + Math.random() * 900000).toString();
    const payload = {
        token,
        expires: Date.now() + 15 * 60 * 1000
    };
    localStorage.setItem(SECURITY.lsKeys.reset, JSON.stringify(payload));

    try {
        emailjs.init(SECURITY.email.publicKey);
        const params = {
            to_email: admin.emails.join(", "),
            code: token,
            timestamp: new Date().toLocaleString()
        };
        await emailjs.send(
            SECURITY.email.serviceId,
            SECURITY.email.templateId,
            params
        );
        pushAudit("Sent PIN reset token via EmailJS");
        return true;
    } catch (err) {
        console.error("Reset email error:", err);
        return false;
    }
}

/* ===== DOM wiring ===== */

document.addEventListener("DOMContentLoaded", async () => {
    // Ensure admin config exists
    await ensureAdminConfig();

    const loginCard = document.getElementById("login-card");
    const mfaCard = document.getElementById("mfa-card");
    const adminShell = document.getElementById("admin-shell");

    const loginForm = document.getElementById("login-form");
    const userInput = document.getElementById("adminUser");
    const pinInput = document.getElementById("adminPin");
    const loginMsg = document.getElementById("loginMessage");

    const overrideToggle = document.getElementById("overrideToggle");
    const overrideArea = document.getElementById("override-area");
    const overrideInput = document.getElementById("overrideKey");
    const overrideBtn = document.getElementById("overrideBtn");

    const forgotPinBtn = document.getElementById("forgotPin");

    const mfaEmailsLabel = document.getElementById("mfaEmails");
    const mfaForm = document.getElementById("mfa-form");
    const mfaCodeInput = document.getElementById("mfaCode");
    const mfaMsg = document.getElementById("mfaMessage");
    const mfaCancelBtn = document.getElementById("mfaCancelBtn");

    const admin = await ensureAdminConfig();
    mfaEmailsLabel.textContent = `Codes are sent to: ${admin.emails.join(", ")}`;

    /* Restore session if still valid */
    try {
        const sess = JSON.parse(localStorage.getItem(SECURITY.lsKeys.session) || "null");
        if (sess && sess.expires > Date.now()) {
            // already authenticated
            loginCard.classList.add("hidden");
            mfaCard.classList.add("hidden");
            adminShell.classList.remove("hidden");
        }
    } catch {
        // ignore
    }

    /* Login submit */
    loginForm.addEventListener("submit", async (evt) => {
        evt.preventDefault();
        loginMsg.textContent = "";
        loginMsg.className = "vb-message";

        const username = userInput.value.trim();
        const pin = pinInput.value.trim();

        if (!username || !pin) {
            loginMsg.textContent = "Enter both username and PIN.";
            loginMsg.classList.add("error");
            return;
        }

        const ok = await validateCredentials(username, pin);
        if (!ok) {
            loginMsg.textContent = "Invalid username or PIN.";
            loginMsg.classList.add("error");
            pushAudit(`FAILED login attempt for user '${username}'`);
            return;
        }

        // Generate MFA code
        const code = Math.floor(100000 + Math.random() * 900000).toString();
        storeMfaState(code, username);

        try {
            await sendMfaEmail(code, admin.emails);
            pushAudit(`MFA code sent for user '${username}'`);
        } catch (err) {
            loginMsg.textContent = "Unable to send MFA email. Try again later.";
            loginMsg.classList.add("error");
            return;
        }

        // Switch to MFA screen
        loginCard.classList.add("hidden");
        mfaCard.classList.remove("hidden");
        mfaMsg.textContent = "";
        mfaCodeInput.value = "";
        mfaCodeInput.focus();
    });

    /* Override key toggle */
    overrideToggle.addEventListener("click", () => {
        overrideArea.classList.toggle("hidden");
        overrideInput.focus();
    });

    /* Override key submit */
    overrideBtn.addEventListener("click", () => {
        loginMsg.textContent = "";
        loginMsg.className = "vb-message";

        const key = overrideInput.value.trim();
        if (!key) {
            loginMsg.textContent = "Enter an override key.";
            loginMsg.classList.add("error");
            return;
        }

        if (key !== SECURITY.overrideKey) {
            loginMsg.textContent = "Invalid override key.";
            loginMsg.classList.add("error");
            pushAudit("FAILED override attempt");
            return;
        }

        pushAudit("SUCCESSFUL admin override login");
        startSession("override");
        loginCard.classList.add("hidden");
        mfaCard.classList.add("hidden");
        adminShell.classList.remove("hidden");
        loginMsg.textContent = "";
        overrideInput.value = "";
    });

    /* Forgot PIN */
    forgotPinBtn.addEventListener("click", async () => {
        loginMsg.textContent = "Sending reset token...";
        loginMsg.className = "vb-message";

        const ok = await sendResetToken();
        if (ok) {
            loginMsg.textContent =
                "Reset token sent to admin email(s). Use it when changing the PIN.";
            loginMsg.classList.add("success");
        } else {
            loginMsg.textContent = "Unable to send reset token. Try again later.";
            loginMsg.classList.add("error");
        }
    });

    /* MFA verify */
    mfaForm.addEventListener("submit", (evt) => {
        evt.preventDefault();
        mfaMsg.textContent = "";
        mfaMsg.className = "vb-message";

        const entered = mfaCodeInput.value.trim();
        if (!entered) {
            mfaMsg.textContent = "Enter the 6-digit code.";
            mfaMsg.classList.add("error");
            return;
        }

        const mfa = getMfaState();
        if (!mfa || mfa.expires < Date.now()) {
            mfaMsg.textContent = "Code expired. Please log in again.";
            mfaMsg.classList.add("error");
            pushAudit("EXPIRED MFA code entered");
            return;
        }

        if (entered !== mfa.code) {
            mfaMsg.textContent = "Incorrect code.";
            mfaMsg.classList.add("error");
            pushAudit("Incorrect MFA code entered");
            return;
        }

        localStorage.removeItem(SECURITY.lsKeys.mfa);
        startSession(mfa.username);
        pushAudit(`SUCCESSFUL login for user '${mfa.username}'`);

        mfaCard.classList.add("hidden");
        document.getElementById("admin-shell").classList.remove("hidden");
    });

    /* MFA cancel */
    mfaCancelBtn.addEventListener("click", () => {
        localStorage.removeItem(SECURITY.lsKeys.mfa);
        mfaCard.classList.add("hidden");
        loginCard.classList.remove("hidden");
    });
});
