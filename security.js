/* ============================================================
   VisionBank / US Signal — Advanced Security Engine
   ============================================================ */

const SECURITY = {

    /* ============================================================
       DEFAULT SUPER ADMIN (bootstrapped only if no admin exists)
       ============================================================ */
    superAdmin: {
        id: "superadmin",
        pin: sha256("ChangeMeNow!"),
        created: new Date().toISOString()
    },

    /* ============================================================
       STORAGE HELPERS
       ============================================================ */
    load(key, fallback) {
        return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    },

    save(key, data) {
        localStorage.setItem(key, JSON.stringify(data));
    },

    /* ============================================================
       DATABASE MODELS
       ============================================================ */
    initDatabase() {
        if (!localStorage.getItem("admins")) {
            this.save("admins", [this.superAdmin]);
        }
        if (!localStorage.getItem("allowedIPs")) {
            this.save("allowedIPs", [
                "10.100.100.0/24",
                "45.19.161.17",
                "45.19.162.18/32",
                "120.112.1.119/28"
            ]);
        }
        if (!localStorage.getItem("businessHours")) {
            this.save("businessHours", {
                start: "07:00",
                end: "19:00",
                days: ["1", "2", "3", "4", "5", "6"] // Mon–Sat
            });
        }
        if (!localStorage.getItem("auditLog")) {
            this.save("auditLog", []);
        }
        if (!localStorage.getItem("mfaEmails")) {
            this.save("mfaEmails", [
                "security@visionsystems.com"
            ]);
        }
    },

    /* ============================================================
       LOGGING
       ============================================================ */
    log(msg) {
        const log = this.load("auditLog", []);
        log.unshift(`${new Date().toLocaleString()} — ${msg}`);
        this.save("auditLog", log);
    },

    /* ============================================================
       HASHING (SHA-256)
       ============================================================ */
    async hash(str) {
        const buf = new TextEncoder().encode(str);
        const digest = await crypto.subtle.digest("SHA-256", buf);
        return Array.from(new Uint8Array(digest))
            .map(b => b.toString(16).padStart(2, "0"))
            .join("");
    },

    /* ============================================================
       GET USER PUBLIC IP
       ============================================================ */
    async getIP() {
        try {
            const res = await fetch("https://api.ipify.org?format=json");
            const j = await res.json();
            return j.ip;
        } catch {
            return "0.0.0.0";
        }
    },

    /* ============================================================
       IP RANGE MATCHING (CIDR)
       ============================================================ */
    ipMatches(ip, cidr) {
        if (!cidr.includes("/")) return ip === cidr;

        const [range, bits] = cidr.split("/");
        const mask = ~(2 ** (32 - bits) - 1);

        const toInt = x => x.split(".").reduce((a, b) => (a << 8) + parseInt(b), 0);

        return (toInt(ip) & mask) === (toInt(range) & mask);
    },

    /* ============================================================
       BUSINESS HOURS CHECK
       CST Timezone Fixed
       ============================================================ */
    isBusinessOpen() {
        const hours = this.load("businessHours", {});
        const now = new Date();

        const CST = new Intl.DateTimeFormat("en-US", {
            timeZone: "America/Chicago",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        });

        let [hh, mm] = CST.format(now).split(":");
        const current = `${hh}:${mm}`;
        const day = now.getDay().toString();

        return (
            hours.days.includes(day) &&
            current >= hours.start &&
            current <= hours.end
        );
    },

    /* ============================================================
       MFA EMAIL ALERT
       Multiple Recipients Supported
       ============================================================ */
    async sendMFAEmail(subject, message) {
        const recipients = this.load("mfaEmails", []);

        for (const email of recipients) {
            console.log(`📧 Sending MFA to ${email}...`);

            // Example webhook call (replace with SMTP or Teams webhook)
            await fetch("https://example.com/mfahook", {
                method: "POST",
                body: JSON.stringify({
                    to: email,
                    subject,
                    message
                }),
                headers: { "Content-Type": "application/json" }
            });
        }

        this.log(`MFA alert sent to ${recipients.length} recipients`);
    },

    /* ============================================================
       LOGIN — AUTHENTICATION
       ============================================================ */
    async login() {
        const id = document.getElementById("admin-id").value.trim();
        const pin = document.getElementById("admin-pin").value.trim();
        const errorBox = document.getElementById("login-error");

        const admins = this.load("admins", []);
        const hashed = await this.hash(pin);

        const admin = admins.find(a => a.id === id && a.pin === hashed);

        if (!admin) {
            errorBox.textContent = "Invalid ID or PIN";
            this.log(`LOGIN FAILED for ID ${id}`);
            return;
        }

        // Send MFA email
        await this.sendMFAEmail(
            "Security Portal Login",
            `Admin ${id} logged into VisionBank Security Portal.`
        );

        // Save session
        localStorage.setItem("logged-in-admin", id);
        this.log(`LOGIN SUCCESS for admin ${id}`);

        // Load dashboard
        document.getElementById("login-panel").style.display = "none";
        document.getElementById("admin-dashboard").style.display = "block";

        SECURITY_DASHBOARD.loadUI();
    },

    /* ============================================================
       ACCESS CONTROL CHECK
       (Used on dashboard pages like index.html)
       ============================================================ */
    async enforceAccess() {
        const ip = await this.getIP();
        const allowed = this.load("allowedIPs", []);

        const authorized = allowed.some(cidr => this.ipMatches(ip, cidr));
        const open = this.isBusinessOpen();

        if (!authorized || !open) {
            this.log(`ACCESS BLOCKED for IP ${ip}`);

            document.body.innerHTML = `
            <div class="denied glass">
                <img src="assets/VisionBank-Logo.png" class="vb-logo-small">
                <h1>Access Denied</h1>
                <p>Your IP <strong>${ip}</strong> is not authorized to access this dashboard.</p>
                <p>Please contact your system administrator.</p>
            </div>`;

            return false;
        }

        this.log(`ACCESS GRANTED for IP ${ip}`);
        return true;
    }
};

/* INIT */
SECURITY.initDatabase();
