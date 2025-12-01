/* ================================================
   VisionBank Security Admin System
   ================================================ */

const SECURITY = {

    pin: "8419",  // Admin-only PIN (CHANGE THIS)

    /* Load stored settings */
    loadSettings() {
        this.allowedIPs = JSON.parse(localStorage.getItem("allowedIPs") || "[]");
        this.businessHours = JSON.parse(localStorage.getItem("businessHours") || "{}");
        this.audit = JSON.parse(localStorage.getItem("auditLog") || "[]");
    },

    /* Save settings */
    saveIPs() {
        localStorage.setItem("allowedIPs", JSON.stringify(this.allowedIPs));
        this.renderIPList();
    },

    saveBusinessHours() {
        const start = document.getElementById("start-time").value;
        const end = document.getElementById("end-time").value;

        const days = Array.from(document.getElementById("days-open").selectedOptions)
            .map(opt => opt.value);

        this.businessHours = { start, end, days };
        localStorage.setItem("businessHours", JSON.stringify(this.businessHours));

        this.log(`Updated business hours`);
        alert("Business hours saved!");
    },

    /* Audit Log */
    log(message) {
        const entry = `${new Date().toLocaleString()} — ${message}`;
        this.audit.unshift(entry);
        localStorage.setItem("auditLog", JSON.stringify(this.audit));
        this.renderAuditLog();
    },

    /* Admin login */
    verifyPIN() {
        const entered = document.getElementById("admin-pin").value;
        if (entered === this.pin) {
            document.getElementById("auth-section").classList.add("hidden");
            document.getElementById("admin-section").classList.remove("hidden");
            this.renderAll();
        } else {
            document.getElementById("auth-error").innerText = "Incorrect PIN";
        }
    },

    logout() {
        location.reload();
    },

    /* IP Management */
    addIP() {
        const ip = document.getElementById("new-ip").value.trim();
        if (!ip) return alert("Enter valid IP or CIDR");

        this.allowedIPs.push(ip);
        this.saveIPs();
        this.log(`Added allowed IP: ${ip}`);
        document.getElementById("new-ip").value = "";
    },

    removeIP(index) {
        const removed = this.allowedIPs[index];
        this.allowedIPs.splice(index, 1);
        this.saveIPs();
        this.log(`Removed IP: ${removed}`);
    },

    renderIPList() {
        const list = document.getElementById("ip-list");
        list.innerHTML = "";

        this.allowedIPs.forEach((ip, i) => {
            list.innerHTML += `
            <li>
                ${ip}
                <span class="delete-btn" onclick="SECURITY.removeIP(${i})">×</span>
            </li>`;
        });
    },

    renderAuditLog() {
        const list = document.getElementById("audit-log");
        list.innerHTML = "";

        this.audit.forEach(a => {
            list.innerHTML += `<li>${a}</li>`;
        });
    },

    renderBusinessHours() {
        const { start, end, days } = this.businessHours;

        if (start) document.getElementById("start-time").value = start;
        if (end) document.getElementById("end-time").value = end;

        if (days) {
            days.forEach(d => {
                const opt = document.querySelector(`#days-open option[value="${d}"]`);
                if (opt) opt.selected = true;
            });
        }
    },

    renderAll() {
        this.renderIPList();
        this.renderAuditLog();
        this.renderBusinessHours();
    }
};

SECURITY.loadSettings();
