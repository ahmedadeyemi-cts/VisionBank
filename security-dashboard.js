/* ============================================================
   VisionBank Security Administration Console
   - Admin login with PIN + MFA (email + Teams webhook hooks)
   - IP allow list management
   - Business hours management
   - Audit log viewer
   - Works with security.js guard through localStorage keys:
       allowedIPs, businessHours, auditLog
   ============================================================ */

(function () {
    "use strict";

    /* -------------------------
       CONFIG / DEFAULTS
       ------------------------- */

    const DEFAULT_IPS = [
        "10.100.100.0/24",
        "45.19.161.17",
        "45.19.162.18/32",
        "120.112.1.119/28"
    ];

    const DEFAULT_HOURS = {
        // 7 AM – 7 PM CST, Monday–Saturday
        start: "07:00",
        end: "19:00",
        days: ["1", "2", "3", "4", "5", "6"]
    };

    // Initial admin — you should change this PIN and email after first login
    const DEFAULT_ADMINS = [
        {
            id: "superadmin",
            name: "Super Admin",
            role: "super",
            pin: "ChangeMeNow!",
            email: "ahmed.adeyemi@ussignal.com",
            teamsWebhook: "", // Optional Teams incoming webhook URL
            active: true
        }
    ];

    // Global security configuration, used also by security.js (override PIN)
    window.SECURITY = window.SECURITY || {
        pin: "VB-ADMIN-OVERRIDE-2025",
        mfaEnabled: true
    };

    /* For blocked attempts and MFA */
    const LOCK_THRESHOLD = 5;          // attempts
    const LOCK_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
    const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour admin session

    /* -------------------------
       PERSISTENCE HELPERS
       ------------------------- */

    function loadJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function saveJSON(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    let allowedIPs = loadJSON("allowedIPs", null);
    let businessHours = loadJSON("businessHours", null);
    let auditLog = loadJSON("auditLog", []);
    let admins = loadJSON("vb-admins", null);

    /* Initialise defaults on first load */
    if (!Array.isArray(allowedIPs) || allowedIPs.length === 0) {
        allowedIPs = DEFAULT_IPS.map(ip => ({
            ip,
            addedAt: new Date().toISOString()
        }));
        saveJSON("allowedIPs", allowedIPs);
        logEvent("SYSTEM", "Initial allowed IP list created.");
    }

    if (!businessHours || !businessHours.start) {
        businessHours = DEFAULT_HOURS;
        saveJSON("businessHours", businessHours);
        logEvent("SYSTEM", "Default business hours created (7 AM – 7 PM, Mon–Sat).");
    }

    if (!Array.isArray(admins) || admins.length === 0) {
        admins = DEFAULT_ADMINS;
        saveJSON("vb-admins", admins);
        logEvent("SYSTEM", "Default Super Admin account created (superadmin).");
    }

    /* -------------------------
       LOGGING
       ------------------------- */

    function logEvent(actor, message) {
        const entry = `${new Date().toLocaleString()} — [${actor}] ${message}`;
        auditLog.unshift(entry);
        auditLog = auditLog.slice(0, 500); // keep 500 latest
        saveJSON("auditLog", auditLog);
    }

    /* -------------------------
       DOM HELPERS
       ------------------------- */

    const $ = (id) => document.getElementById(id);

    function show(el) {
        el.classList.remove("hidden");
    }

    function hide(el) {
        el.classList.add("hidden");
    }

    function safeText(el, text) {
        if (el) el.textContent = text;
    }

    /* -------------------------
       LOGIN & MFA STATE
       ------------------------- */

    let currentAdmin = null;
    let pendingMfa = null;

    function getLockState() {
        return loadJSON("vb-login-lock", { count: 0, firstAt: null });
    }

    function setLockState(state) {
        saveJSON("vb-login-lock", state);
    }

    function isLocked() {
        const st = getLockState();
        if (!st.firstAt) return false;

        const age = Date.now() - st.firstAt;
        if (age > LOCK_WINDOW_MS) {
            // reset window
            setLockState({ count: 0, firstAt: null });
            return false;
        }
        return st.count >= LOCK_THRESHOLD;
    }

    function recordFailedAttempt(adminId) {
        const st = getLockState();
        if (!st.firstAt) {
            st.firstAt = Date.now();
            st.count = 1;
        } else {
            st.count += 1;
        }
        setLockState(st);

        if (st.count >= LOCK_THRESHOLD) {
            logEvent("SECURITY", `Login locked due to repeated failures for ID ${adminId || "unknown"}.`);
        }
    }

    function clearLock() {
        setLockState({ count: 0, firstAt: null });
    }

    /* -------------------------
       MFA: Email + Teams hooks
       ------------------------- */

    function generateMfaCode() {
        return String(Math.floor(100000 + Math.random() * 900000));
    }

    function sendTeamsMfa(admin, code) {
        if (!admin.teamsWebhook) return;
        fetch(admin.teamsWebhook, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: `VisionBank Security MFA code for ${admin.name} (${admin.id}): **${code}**`
            })
        }).catch(() => { /* ignore */ });
    }

    function sendEmailMfa(admin, code) {
        // Placeholder: integrate with your email API (SendGrid, Mailgun, etc.)
        // Example payload only; you must provide a real endpoint.
        const emailApi = ""; // e.g. https://your-email-api/send
        if (!emailApi) return;

        fetch(emailApi, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                to: admin.email,
                subject: "VisionBank Security MFA Code",
                text: `Your VisionBank security verification code is ${code}.`
            })
        }).catch(() => { /* ignore */ });
    }

    function startMfa(admin) {
        const code = generateMfaCode();
        pendingMfa = {
            adminId: admin.id,
            code,
            expiresAt: Date.now() + 5 * 60 * 1000 // 5 minutes
        };
        sessionStorage.setItem("vb-pending-mfa", JSON.stringify(pendingMfa));

        sendTeamsMfa(admin, code);
        sendEmailMfa(admin, code);

        logEvent(admin.id, "MFA challenge issued.");

        // UI
        show($("mfa-section"));
        $("mfa-code").focus();
    }

    function loadPendingMfa() {
        const raw = sessionStorage.getItem("vb-pending-mfa");
        if (!raw) return null;
        try {
            const p = JSON.parse(raw);
            if (Date.now() > p.expiresAt) {
                sessionStorage.removeItem("vb-pending-mfa");
                return null;
            }
            return p;
        } catch {
            return null;
        }
    }

    /* -------------------------
       SESSION
       ------------------------- */

    function saveSession(admin) {
        const session = {
            adminId: admin.id,
            role: admin.role,
            name: admin.name,
            createdAt: Date.now()
        };
        sessionStorage.setItem("vb-admin-session", JSON.stringify(session));
    }

    function loadSession() {
        const raw = sessionStorage.getItem("vb-admin-session");
        if (!raw) return null;
        try {
            const s = JSON.parse(raw);
            if (Date.now() - s.createdAt > SESSION_TTL_MS) {
                sessionStorage.removeItem("vb-admin-session");
                return null;
            }
            return s;
        } catch {
            return null;
        }
    }

    function clearSession() {
        sessionStorage.removeItem("vb-admin-session");
        sessionStorage.removeItem("vb-pending-mfa");
        pendingMfa = null;
        currentAdmin = null;
    }

    /* -------------------------
       RENDERING
       ------------------------- */

    function renderIPs() {
        const tbody = $("ip-tbody");
        tbody.innerHTML = "";

        if (!Array.isArray(allowedIPs) || allowedIPs.length === 0) {
            const tr = document.createElement("tr");
            const td = document.createElement("td");
            td.colSpan = 3;
            td.textContent = "No IPs configured.";
            tr.appendChild(td);
            tbody.appendChild(tr);
            return;
        }

        allowedIPs.forEach((item, index) => {
            const tr = document.createElement("tr");

            const ipTd = document.createElement("td");
            ipTd.textContent = item.ip;
            tr.appendChild(ipTd);

            const whenTd = document.createElement("td");
            const d = new Date(item.addedAt || Date.now());
            whenTd.textContent = d.toLocaleString();
            tr.appendChild(whenTd);

            const actionTd = document.createElement("td");
            const btn = document.createElement("button");
            btn.textContent = "Remove";
            btn.className = "btn ghost small";
            btn.addEventListener("click", () => {
                const removed = allowedIPs.splice(index, 1)[0];
                saveJSON("allowedIPs", allowedIPs);
                logEvent(currentAdmin.id, `Removed allowed IP ${removed.ip}.`);
                renderIPs();
            });
            actionTd.appendChild(btn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        });
    }

    function renderHours() {
        $("start-time").value = businessHours.start || "07:00";
        $("end-time").value = businessHours.end || "19:00";

        const daysInputs = document.querySelectorAll(".days-fieldset input[type=checkbox]");
        const selected = new Set(businessHours.days || []);
        daysInputs.forEach(cb => {
            cb.checked = selected.has(cb.value);
        });

        safeText(
            $("hours-status"),
            `Currently active: ${businessHours.start || "07:00"} – ${businessHours.end || "19:00"} (CST)`
        );
    }

    function renderLog() {
        const list = $("log-list");
        list.innerHTML = "";

        if (!auditLog || auditLog.length === 0) {
            const li = document.createElement("li");
            li.textContent = "No audit events logged yet.";
            list.appendChild(li);
            return;
        }

        auditLog.slice(0, 50).forEach(entry => {
            const li = document.createElement("li");
            li.textContent = entry;
            list.appendChild(li);
        });
    }

    function renderAdminSession(session) {
        if (!session) return;
        safeText($("admin-welcome"), `Welcome, ${session.name}`);
        safeText($("admin-role"), `Role: ${session.role === "super" ? "Super Admin" : "Admin"}`);

        hide($("login-view"));
        hide($("mfa-section"));
        show($("admin-view"));

        renderIPs();
        renderHours();
        renderLog();
    }

    /* -------------------------
       EVENT HANDLERS
       ------------------------- */

    function onLoginSubmit(evt) {
        evt.preventDefault();

        const id = $("admin-id").value.trim();
        const pin = $("admin-pin").value;

        const lockMsg = $("login-lock-msg");
        lockMsg.classList.add("hidden");
        lockMsg.textContent = "";

        if (isLocked()) {
            lockMsg.textContent = "Too many failed attempts. Login is temporarily locked.";
            lockMsg.classList.remove("hidden");
            return;
        }

        const admin = admins.find(a => a.id === id && a.active !== false);
        if (!admin || admin.pin !== pin) {
            recordFailedAttempt(id);
            logEvent("SECURITY", `Failed login attempt for ID ${id || "unknown"}.`);
            lockMsg.textContent = "Invalid credentials.";
            lockMsg.classList.remove("hidden");
            return;
        }

        clearLock();
        currentAdmin = admin;
        logEvent(admin.id, "Password/PIN verified.");

        if (SECURITY.mfaEnabled) {
            startMfa(admin);
        } else {
            completeLogin(admin);
        }
    }

    function completeLogin(admin) {
        currentAdmin = admin;
        hide($("login-view"));
        hide($("mfa-section"));
        saveSession(admin);
        logEvent(admin.id, "Admin logged in successfully.");
        renderAdminSession({
            adminId: admin.id,
            role: admin.role,
            name: admin.name
        });
    }

    function onMfaSubmit(evt) {
        evt.preventDefault();

        const p = loadPendingMfa();
        const input = $("mfa-code").value.trim();
        const err = $("mfa-error");
        err.classList.add("hidden");
        err.textContent = "";

        if (!p) {
            err.textContent = "Verification expired. Please sign in again.";
            err.classList.remove("hidden");
            return;
        }

        if (input !== p.code) {
            err.textContent = "Invalid verification code.";
            err.classList.remove("hidden");
            logEvent("SECURITY", `Invalid MFA code for ID ${p.adminId}.`);
            return;
        }

        sessionStorage.removeItem("vb-pending-mfa");
        pendingMfa = null;

        const admin = admins.find(a => a.id === p.adminId);
        if (!admin) {
            err.textContent = "Admin not found.";
            err.classList.remove("hidden");
            return;
        }

        logEvent(admin.id, "MFA verification successful.");
        completeLogin(admin);
    }

    function onMfaCancel() {
        sessionStorage.removeItem("vb-pending-mfa");
        pendingMfa = null;
        $("mfa-code").value = "";
        hide($("mfa-section"));
    }

    function onLogout() {
        if (currentAdmin) {
            logEvent(currentAdmin.id, "Admin logged out.");
        }
        clearSession();
        show($("login-view"));
        hide($("admin-view"));
        $("admin-pin").value = "";
    }

    function onIpFormSubmit(evt) {
        evt.preventDefault();
        const ipField = $("ip-input");
        const ip = ipField.value.trim();
        if (!ip) return;

        allowedIPs.push({
            ip,
            addedAt: new Date().toISOString()
        });
        saveJSON("allowedIPs", allowedIPs);
        logEvent(currentAdmin.id, `Added allowed IP ${ip}.`);

        ipField.value = "";
        renderIPs();
    }

    function onHoursFormSubmit(evt) {
        evt.preventDefault();
        const start = $("start-time").value || "07:00";
        const end = $("end-time").value || "19:00";

        const dayChecks = document.querySelectorAll(".days-fieldset input[type=checkbox]");
        const days = [];
        dayChecks.forEach(cb => {
            if (cb.checked) days.push(cb.value);
        });

        businessHours = { start, end, days };
        saveJSON("businessHours", businessHours);
        logEvent(currentAdmin.id, `Updated business hours to ${start}–${end}, days ${days.join(",") || "(none)"}.`);
        renderHours();
    }

    function onClearLog() {
        if (!confirm("Clear audit log? This cannot be undone.")) return;
        auditLog = [];
        saveJSON("auditLog", auditLog);
        logEvent(currentAdmin.id || "SYSTEM", "Audit log cleared.");
        renderLog();
    }

    function onExportSettings() {
        const exportObj = {
            allowedIPs,
            businessHours,
            auditLog,
            admins
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `visionbank-security-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        logEvent(currentAdmin.id || "SYSTEM", "Exported security configuration.");
    }

    /* -------------------------
       INITIALISE
       ------------------------- */

    function init() {
        // Restore session if present
        const session = loadSession();
        if (session) {
            const admin = admins.find(a => a.id === session.adminId);
            if (admin) {
                currentAdmin = admin;
                renderAdminSession(session);
            }
        }

        // Restore pending MFA if any
        pendingMfa = loadPendingMfa();
        if (pendingMfa) {
            show($("mfa-section"));
        }

        // Bind events
        $("login-form").addEventListener("submit", onLoginSubmit);
        $("mfa-form").addEventListener("submit", onMfaSubmit);
        $("mfa-cancel").addEventListener("click", onMfaCancel);
        $("btn-logout").addEventListener("click", onLogout);
        $("ip-form").addEventListener("submit", onIpFormSubmit);
        $("hours-form").addEventListener("submit", onHoursFormSubmit);
        $("btn-clear-log").addEventListener("click", onClearLog);
        $("btn-export").addEventListener("click", onExportSettings);
    }

    document.addEventListener("DOMContentLoaded", init);

})();
