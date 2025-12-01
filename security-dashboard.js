/* ============================================================
   VisionBank / US Signal — Security Admin Dashboard Logic
   ============================================================ */

window.SECURITY_DASHBOARD = {

    /* ============================================================
       Check session and load admin name
       ============================================================ */
    init() {
        const id = localStorage.getItem("logged-in-admin");
        if (!id) {
            document.getElementById("login-panel").style.display = "block";
            document.getElementById("admin-dashboard").style.display = "none";
            return;
        }

        document.getElementById("admin-dashboard").style.display = "block";
        document.getElementById("login-panel").style.display = "none";
        document.getElementById("welcome-admin").textContent = id;

        this.loadUI();
    },

    /* ============================================================
       Load All Admin Panel UI Sections
       ============================================================ */
    loadUI() {
        this.renderAdmins();
        this.renderIPs();
        this.renderMFAEmails();
        this.renderBusinessHours();
        this.renderAuditLog();
    },

    /* ============================================================
       ADMIN MANAGEMENT
       ============================================================ */
    renderAdmins() {
        const admins = SECURITY.load("admins", []);
        const box = document.getElementById("admin-list");
        box.innerHTML = "";

        admins.forEach(admin => {
            const row = document.createElement("div");
            row.className = "item-row glass";

            row.innerHTML = `
                <span><strong>${admin.id}</strong></span>
                <button class="danger-btn" onclick="SECURITY_DASHBOARD.removeAdmin('${admin.id}')">Remove</button>
            `;

            box.appendChild(row);
        });
    },

    async addAdmin() {
        const id = prompt("Enter new Admin ID:");
        if (!id) return;

        const pin = prompt("Enter PIN for admin:");
        if (!pin) return;

        const admins = SECURITY.load("admins", []);
        const hashed = await SECURITY.hash(pin);

        admins.push({ id, pin: hashed, created: new Date().toISOString() });
        SECURITY.save("admins", admins);

        SECURITY.log(`Admin created: ${id}`);
        this.renderAdmins();
    },

    removeAdmin(id) {
        if (!confirm(`Remove admin ${id}?`)) return;

        let admins = SECURITY.load("admins", []);
        admins = admins.filter(a => a.id !== id);

        SECURITY.save("admins", admins);
        SECURITY.log(`Admin removed: ${id}`);

        this.renderAdmins();
    },

    /* ============================================================
       ALLOWED IP MANAGEMENT
       ============================================================ */
    renderIPs() {
        const ips = SECURITY.load("allowedIPs", []);
        const box = document.getElementById("ip-list");
        box.innerHTML = "";

        ips.forEach(ip => {
            const row = document.createElement("div");
            row.className = "item-row glass";

            row.innerHTML = `
                <span>${ip}</span>
                <button class="danger-btn" onclick="SECURITY_DASHBOARD.removeIP('${ip}')">Remove</button>
            `;

            box.appendChild(row);
        });
    },

    addIP() {
        const ip = prompt("Enter allowed IP or CIDR:");
        if (!ip) return;

        const ips = SECURITY.load("allowedIPs", []);
        ips.push(ip);

        SECURITY.save("allowedIPs", ips);
        SECURITY.log(`Allowed IP added: ${ip}`);

        this.renderIPs();
    },

    removeIP(ip) {
        if (!confirm(`Remove ${ip}?`)) return;

        let ips = SECURITY.load("allowedIPs", []);
        ips = ips.filter(i => i !== ip);

        SECURITY.save("allowedIPs", ips);
        SECURITY.log(`Allowed IP removed: ${ip}`);

        this.renderIPs();
    },

    /* ============================================================
       MFA EMAIL MANAGEMENT
       ============================================================ */
    renderMFAEmails() {
        const emails = SECURITY.load("mfaEmails", []);
        const box = document.getElementById("mfa-list");
        box.innerHTML = "";

        emails.forEach(email => {
            const row = document.createElement("div");
            row.className = "item-row glass";

            row.innerHTML = `
                <span>${email}</span>
                <button class="danger-btn" onclick="SECURITY_DASHBOARD.removeMFA('${email}')">Remove</button>
            `;

            box.appendChild(row);
        });
    },

    addMFA() {
        const email = prompt("Enter new MFA email recipient:");
        if (!email) return;

        const emails = SECURITY.load("mfaEmails", []);
        emails.push(email);

        SECURITY.save("mfaEmails", emails);
        SECURITY.log(`MFA email added: ${email}`);

        this.renderMFAEmails();
    },

    removeMFA(email) {
        if (!confirm(`Remove ${email}?`)) return;

        let emails = SECURITY.load("mfaEmails", []);
        emails = emails.filter(e => e !== email);

        SECURITY.save("mfaEmails", emails);
        SECURITY.log(`MFA email removed: ${email}`);

        this.renderMFAEmails();
    },

    /* ============================================================
       BUSINESS HOURS MANAGEMENT
       ============================================================ */
    renderBusinessHours() {
        const hours = SECURITY.load("businessHours", {});

        document.getElementById("bh-start").value = hours.start || "07:00";
        document.getElementById("bh-end").value = hours.end || "19:00";
        document.getElementById("bh-days").value = (hours.days || []).join(",");
    },

    saveBusinessHours() {
        const start = document.getElementById("bh-start").value;
        const end = document.getElementById("bh-end").value;
        const days = document.getElementById("bh-days").value.split(",").map(x => x.trim());

        SECURITY.save("businessHours", { start, end, days });

        SECURITY.log(`Business hours updated`);
        alert("Business hours saved.");
    },

    /* ============================================================
       AUDIT LOG
       ============================================================ */
    renderAuditLog() {
        const log = SECURITY.load("auditLog", []);
        const box = document.getElementById("audit-log");

        box.innerHTML = log.map(entry => `<div class="audit-entry glass">${entry}</div>`).join("");
    },

    /* ============================================================
       LOGOUT
       ============================================================ */
    logout() {
        localStorage.removeItem("logged-in-admin");
        location.reload();
    }
};

/* Boot */
document.addEventListener("DOMContentLoaded", () => SECURITY_DASHBOARD.init());
