/* ============================================================
   VisionBank Security Portal - Core Login + MFA
   ============================================================ */

(function () {
    const SEC_CONFIG = {
        superAdmin: {
            id: "superadmin",
            password: "ChangeMeNow!",     // <-- change after first login
            pinOverride: "857321"         // <-- PIN override, can be changed later
        },
        mfa: {
            serviceId: "service_ftbnopr",
            templateId: "Z_4fEOdBy8J__XmyP",
            publicKey: "Z_4fEOdBy8J__XmyP",
            recipients: [
                "ahmed.adeyemi@ussignal.com",
                "ahmed.adeyemi@oneneck.com",
                "ahmedadeyemi@gmail.com"
            ]
        },
        storageKeys: {
            authSession: "vb-security-auth",
            adminProfile: "vb-admin-profile",
            allowedIPs: "allowedIPs",
            businessHours: "businessHours",
            auditLog: "auditLog"
        }
    };

    // make config available to other scripts
    window.SEC_CONFIG = SEC_CONFIG;

    /* ========================================================
       AUDIT LOG HELPERS
       ======================================================== */

    function loadAudit() {
        try {
            return JSON.parse(
                localStorage.getItem(SEC_CONFIG.storageKeys.auditLog) || "[]"
            );
        } catch {
            return [];
        }
    }

    function saveAudit(entries) {
        localStorage.setItem(
            SEC_CONFIG.storageKeys.auditLog,
            JSON.stringify(entries)
        );
    }

    function addAudit(message) {
        const entries = loadAudit();
        const stamp = new Date().toLocaleString();
        entries.unshift(`${stamp} — ${message}`);
        saveAudit(entries);
    }

    window.VB_SECURITY = {
        addAudit,
        loadAudit
    };

    /* ========================================================
       EMAILJS INITIALISATION
       ======================================================== */

    document.addEventListener("DOMContentLoaded", () => {
        if (window.emailjs && typeof emailjs.init === "function") {
            emailjs.init(SEC_CONFIG.mfa.publicKey);
        }
        renderEntryPoint();
    });

    /* ========================================================
       LOGIN / MFA STATE
       ======================================================== */

    let currentMode = "password"; // "password" | "pin"
    let pendingUser = null;
    let pendingCode = null;

    function renderEntryPoint() {
        const root = document.getElementById("vb-root");
        if (!root) return;

        const already = sessionStorage.getItem(SEC_CONFIG.storageKeys.authSession);
        if (already === "ok") {
            // Already authenticated -> go straight to dashboard
            if (typeof window.initSecurityDashboard === "function") {
                window.initSecurityDashboard(root);
            } else {
                root.textContent = "Loading dashboard…";
            }
            return;
        }

        renderLogin(root);
    }

    /* ========================================================
       RENDER LOGIN CARD
       ======================================================== */

    function renderLogin(root) {
        root.innerHTML = `
            <div class="vb-shell">
                <section class="vb-login-card">
                    <div class="vb-login-header">
                        <h2>Administrator Sign In</h2>
                        <p>Use your VisionBank security credentials. MFA email will be required.</p>
                    </div>

                    <div id="vb-login-messages"></div>

                    <div class="vb-login-mode">
                        <button type="button"
                                class="vb-mode-btn vb-active"
                                data-mode="password">
                                Standard login
                        </button>
                        <button type="button"
                                class="vb-mode-btn"
                                data-mode="pin">
                                PIN override
                        </button>
                    </div>

                    <div class="vb-field">
                        <label for="vb-login-user">Username</label>
                        <input id="vb-login-user"
                               class="vb-input"
                               autocomplete="username"
                               placeholder="superadmin" />
                    </div>

                    <div id="vb-password-fields">
                        <div class="vb-field">
                            <label for="vb-login-pass">Password</label>
                            <input id="vb-login-pass"
                                   class="vb-input"
                                   type="password"
                                   autocomplete="current-password"
                                   placeholder="Enter admin password" />
                        </div>
                        <p class="vb-helper-text">
                            Standard mode uses your username and password.
                        </p>
                    </div>

                    <div id="vb-pin-fields" class="vb-hidden">
                        <div class="vb-field">
                            <label for="vb-login-pin">Override PIN</label>
                            <input id="vb-login-pin"
                                   class="vb-input"
                                   type="password"
                                   inputmode="numeric"
                                   autocomplete="one-time-code"
                                   placeholder="Enter 6-digit PIN override" />
                        </div>
                        <p class="vb-helper-text">
                            Use this mode only when password login is unavailable.
                            MFA is still required.
                        </p>
                    </div>

                    <button id="vb-btn-send-mfa"
                            class="vb-btn-primary">
                        Send MFA Code
                    </button>

                    <div class="vb-mfa-box vb-hidden" id="vb-mfa-step">
                        <p class="vb-mfa-hint">
                            A 6-digit security code has been emailed to the configured
                            administrator addresses. Enter it below to complete sign in.
                        </p>

                        <div class="vb-field">
                            <label for="vb-login-code">MFA code</label>
                            <input id="vb-login-code"
                                   class="vb-input"
                                   inputmode="numeric"
                                   maxlength="6"
                                   placeholder="123456" />
                        </div>

                        <button id="vb-btn-complete"
                                class="vb-btn-primary">
                            Complete Login
                        </button>
                    </div>

                    <div class="vb-btn-inline-row">
                        <button id="vb-btn-forgot"
                                class="vb-btn-secondary"
                                type="button">
                            Forgot password?
                        </button>
                        <span class="vb-small">
                            Default user: <strong>superadmin</strong>
                        </span>
                    </div>
                </section>
            </div>
        `;

        wireLoginEvents();
    }

    function setMessage(type, text) {
        const host = document.getElementById("vb-login-messages");
        if (!host) return;
        if (!text) {
            host.innerHTML = "";
            return;
        }
        const cls =
            type === "error"
                ? "vb-alert vb-alert-error"
                : type === "success"
                ? "vb-alert vb-alert-success"
                : "vb-alert vb-alert-info";
        host.innerHTML = `<div class="${cls}">${text}</div>`;
    }

    function wireLoginEvents() {
        const modeButtons = document.querySelectorAll(".vb-mode-btn");
        modeButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                modeButtons.forEach((b) => b.classList.remove("vb-active"));
                btn.classList.add("vb-active");
                currentMode = btn.dataset.mode === "pin" ? "pin" : "password";
                toggleModeFields();
                setMessage("info", `Login mode: ${currentMode === "pin" ? "PIN override" : "Standard password"}.`);
            });
        });

        document
            .getElementById("vb-btn-send-mfa")
            .addEventListener("click", handleSendMfa);

        document
            .getElementById("vb-btn-complete")
            .addEventListener("click", handleCompleteLogin);

        document
            .getElementById("vb-btn-forgot")
            .addEventListener("click", handleForgotPassword);
    }

    function toggleModeFields() {
        const pwd = document.getElementById("vb-password-fields");
        const pin = document.getElementById("vb-pin-fields");
        if (!pwd || !pin) return;

        if (currentMode === "password") {
            pwd.classList.remove("vb-hidden");
            pin.classList.add("vb-hidden");
        } else {
            pwd.classList.add("vb-hidden");
            pin.classList.remove("vb-hidden");
        }
    }

    /* ========================================================
       CREDENTIAL CHECK + MFA SEND
       ======================================================== */

    async function handleSendMfa() {
        const username = (document.getElementById("vb-login-user").value || "").trim();
        const pass = document.getElementById("vb-login-pass").value;
        const pin = document.getElementById("vb-login-pin").value;

        setMessage(null, "");

        if (!username) {
            setMessage("error", "Please enter your username.");
            return;
        }
        if (username.toLowerCase() !== SEC_CONFIG.superAdmin.id.toLowerCase()) {
            setMessage("error", "Unknown username.");
            addAudit(`Failed login - unknown user '${username}'.`);
            return;
        }

        if (currentMode === "password") {
            if (!pass) {
                setMessage("error", "Please enter your password.");
                return;
            }
            if (pass !== SEC_CONFIG.superAdmin.password) {
                setMessage("error", "Incorrect password.");
                addAudit("Failed login - incorrect password for superadmin.");
                return;
            }
        } else {
            if (!pin) {
                setMessage("error", "Please enter the PIN override.");
                return;
            }
            if (pin !== SEC_CONFIG.superAdmin.pinOverride) {
                setMessage("error", "Incorrect PIN override.");
                addAudit("Failed login - incorrect PIN override.");
                return;
            }
        }

        // Credentials look valid -> send MFA
        try {
            pendingUser = username;
            pendingCode = generateCode();

            await sendMfaEmails(pendingCode, username);

            setMessage(
                "success",
                "Credentials accepted. MFA code has been emailed to the configured administrator addresses."
            );
            document.getElementById("vb-mfa-step").classList.remove("vb-hidden");
            addAudit(`MFA code issued for user '${username}' using mode ${currentMode}.`);
        } catch (err) {
            console.error(err);
            setMessage(
                "error",
                "Unable to send MFA email. Please verify EmailJS configuration."
            );
        }
    }

    function generateCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    async function sendMfaEmails(code, username) {
        if (!window.emailjs) {
            throw new Error("EmailJS library not loaded.");
        }

        const { serviceId, templateId, recipients } = SEC_CONFIG.mfa;

        const payloads = recipients.map((to) =>
            emailjs.send(serviceId, templateId, {
                to_email: to,
                code,
                username,
                timestamp: new Date().toLocaleString()
            })
        );

        await Promise.all(payloads);
    }

    /* ========================================================
       COMPLETE LOGIN (VERIFY MFA)
       ======================================================== */

    function handleCompleteLogin() {
        const inputCode =
            (document.getElementById("vb-login-code").value || "").trim();

        if (!pendingCode || !pendingUser) {
            setMessage(
                "error",
                "No MFA request is pending. Please validate your credentials first."
            );
            return;
        }

        if (!inputCode) {
            setMessage("error", "Please enter the MFA code.");
            return;
        }

        if (inputCode !== pendingCode) {
            setMessage("error", "Incorrect MFA code.");
            addAudit(`Failed MFA attempt for user '${pendingUser}'.`);
            return;
        }

        // success
        sessionStorage.setItem(SEC_CONFIG.storageKeys.authSession, "ok");
        localStorage.setItem(
            SEC_CONFIG.storageKeys.adminProfile,
            JSON.stringify({
                id: pendingUser,
                lastLogin: new Date().toISOString()
            })
        );

        addAudit(`Super admin '${pendingUser}' successfully authenticated.`);

        const root = document.getElementById("vb-root");
        if (typeof window.initSecurityDashboard === "function") {
            window.initSecurityDashboard(root);
        } else if (root) {
            root.textContent = "Login successful. Loading dashboard…";
        }
    }

    /* ========================================================
       FORGOT PASSWORD HANDLER
       ======================================================== */

    function handleForgotPassword() {
        setMessage(
            "info",
            "For security, password resets must be performed manually. Use PIN override mode with MFA, then update the password in the admin dashboard."
        );
    }
})();
