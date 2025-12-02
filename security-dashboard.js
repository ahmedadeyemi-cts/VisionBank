/* =========================================
   VisionBank Security – Admin Portal
   ========================================= */

(function () {
    const lsKeys = SECURITY.lsKeys;

    function getJson(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            return raw ? JSON.parse(raw) : fallback;
        } catch {
            return fallback;
        }
    }

    function setJson(key, value) {
        localStorage.setItem(key, JSON.stringify(value));
    }

    function logAudit(msg) {
        const audit = getJson(lsKeys.audit, []);
        const ts = new Date().toLocaleString();
        audit.unshift(`${ts} — ${msg}`);
        setJson(lsKeys.audit, audit);
    }

    function loadSession() {
        return getJson(lsKeys.session, null);
    }

    document.addEventListener("DOMContentLoaded", () => {
        const adminShell = document.getElementById("admin-shell");
        const loginCard = document.getElementById("login-card");
        const mfaCard = document.getElementById("mfa-card");

        if (!adminShell) return; // nothing to do

        const sess = loadSession();
        if (!sess || sess.expires < Date.now()) {
            // not authenticated; keep login visible
            return;
        }

        // Show admin, hide login/MFA
        loginCard && loginCard.classList.add("hidden");
        mfaCard && mfaCard.classList.add("hidden");
        adminShell.classList.remove("hidden");

        /* ===== Wire controls ===== */
        const ipList = document.getElementById("ipList");
        const saveIPs = document.getElementById("saveIPs");

        const bhStart = document.getElementById("bhStart");
        const bhEnd = document.getElementById("bhEnd");
        const bhSummary = document.getElementById("bhSummary");
        const saveBH = document.getElementById("saveBH");
        const bhDayCheckboxes = Array.from(
            document.querySelectorAll(".bhDay")
        );

        const pinForm = document.getElementById("pinForm");
        const currentPin = document.getElementById("currentPin");
        const newPin = document.getElementById("newPin");
        const confirmPin = document.getElementById("confirmPin");
        const pinMessage = document.getElementById("pinMessage");

        const auditList = document.getElementById("auditList");
        const refreshAudit = document.getElementById("refreshAudit");
        const clearAudit = document.getElementById("clearAudit");

        const logoutBtn = document.getElementById("logoutBtn");
        const adminMessage = document.getElementById("adminMessage");

        /* === Load IP allowlist === */
        const ipData = getJson("vb-allowedIPs", []);
        ipList.value = ipData.join("\n");

        saveIPs.addEventListener("click", () => {
            const lines = ipList.value
                .split("\n")
                .map(l => l.trim())
                .filter(Boolean);
            setJson("vb-allowedIPs", lines);
            adminMessage.textContent = "IP rules saved.";
            adminMessage.className = "vb-message success";
            logAudit(`Updated IP allowlist (${lines.length} entries)`);
        });

        /* === Load business hours === */
        const defaultBH = {
            start: "07:00",
            end: "19:00",
            days: ["1", "2", "3", "4", "5", "6"] // Mon–Sat
        };
        const bh = getJson("vb-businessHours", defaultBH);

        bhStart.value = bh.start || defaultBH.start;
        bhEnd.value = bh.end || defaultBH.end;

        bhDayCheckboxes.forEach(cb => {
            cb.checked = (bh.days || defaultBH.days).includes(cb.value);
        });

        function updateBhSummary() {
            const days = bhDayCheckboxes
                .filter(cb => cb.checked)
                .map(cb => cb.parentElement.textContent.trim());
            bhSummary.textContent =
                `Open ${bhStart.value || "??"} – ${bhEnd.value || "??"} (CST) on: ` +
                (days.length ? days.join(", ") : "no days configured");
        }
        updateBhSummary();

        saveBH.addEventListener("click", () => {
            const days = bhDayCheckboxes
                .filter(cb => cb.checked)
                .map(cb => cb.value);
            const payload = {
                start: bhStart.value || defaultBH.start,
                end: bhEnd.value || defaultBH.end,
                days
            };
            setJson("vb-businessHours", payload);
            updateBhSummary();
            adminMessage.textContent = "Business hours updated.";
            adminMessage.className = "vb-message success";
            logAudit("Updated business hours configuration");
        });

        /* === Change PIN === */
        pinForm.addEventListener("submit", async (evt) => {
            evt.preventDefault();
            pinMessage.textContent = "";
            pinMessage.className = "vb-message small";

            const cur = currentPin.value.trim();
            const np = newPin.value.trim();
            const cp = confirmPin.value.trim();

            if (!cur || !np || !cp) {
                pinMessage.textContent = "Fill in all PIN fields.";
                pinMessage.classList.add("error");
                return;
            }
            if (np !== cp) {
                pinMessage.textContent = "New PIN and confirmation do not match.";
                pinMessage.classList.add("error");
                return;
            }

            const valid = await validateCredentials(
                (getJson(lsKeys.admin, { username: "superadmin" })).username,
                cur
            );
            if (!valid) {
                pinMessage.textContent = "Current PIN is incorrect.";
                pinMessage.classList.add("error");
                return;
            }

            const newHash = await hashPin(np);
            localStorage.setItem(lsKeys.pinHash, newHash);
            pinMessage.textContent = "Admin PIN updated successfully.";
            pinMessage.classList.add("success");
            logAudit("Admin PIN changed");

            currentPin.value = "";
            newPin.value = "";
            confirmPin.value = "";
        });

        /* === Audit log === */
        function renderAudit() {
            const audit = getJson(lsKeys.audit, []);
            auditList.innerHTML = "";
            if (!audit.length) {
                const li = document.createElement("li");
                li.textContent = "No audit entries yet.";
                auditList.appendChild(li);
                return;
            }
            audit.slice(0, 200).forEach(entry => {
                const li = document.createElement("li");
                li.textContent = entry;
                auditList.appendChild(li);
            });
        }
        renderAudit();

        refreshAudit.addEventListener("click", renderAudit);

        clearAudit.addEventListener("click", () => {
            if (!confirm("Clear all audit log entries?")) return;
            localStorage.removeItem(lsKeys.audit);
            renderAudit();
            adminMessage.textContent = "Audit log cleared.";
            adminMessage.className = "vb-message success";
            logAudit("Audit log cleared");
        });

        /* === Logout === */
        logoutBtn.addEventListener("click", () => {
            localStorage.removeItem(lsKeys.session);
            adminShell.classList.add("hidden");
            loginCard.classList.remove("hidden");
            adminMessage.textContent = "";
            logAudit("Admin logged out");
        });
    });
})();
