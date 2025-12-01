/* =========================================
   VisionBank — Dashboard Access Security
   ========================================= */

(async function() {

    /* Load database */
    const allowedIPs = JSON.parse(localStorage.getItem("allowedIPs") || "[]");
    const hours = JSON.parse(localStorage.getItem("businessHours") || "{}");
    const audit = JSON.parse(localStorage.getItem("auditLog") || "[]");

    function log(msg) {
        const entry = `${new Date().toLocaleString()} — ${msg}`;
        audit.unshift(entry);
        localStorage.setItem("auditLog", JSON.stringify(audit));
    }

    /* === Get user public IP === */
    async function getIP() {
        try {
            const res = await fetch("https://api.ipify.org?format=json");
            const data = await res.json();
            return data.ip;
        } catch {
            return "0.0.0.0";
        }
    }

    /* === CIDR / IP Check === */
    function ipMatches(ip, cidr) {
        if (!cidr.includes("/")) return ip === cidr;

        const [range, bits] = cidr.split("/");
        const mask = ~(2 ** (32 - bits) - 1);

        function toInt(x) {
            return x.split(".").reduce((a, b) => (a << 8) + parseInt(b), 0);
        }

        return (toInt(ip) & mask) === (toInt(range) & mask);
    }

    /* === Business Hour Check === */
    function isBusinessOpen() {
        if (!hours.start || !hours.end || !hours.days) return true;

        const now = new Date();
        const CST = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", hour: "2-digit", minute: "2-digit", hour12: false });
        const [hh, mm] = CST.format(now).split(":");
        const current = `${hh}:${mm}`;
        const day = now.getDay().toString();

        return hours.days.includes(day)
            && current >= hours.start
            && current <= hours.end;
    }

    /* ======================================
       MAIN SECURITY VALIDATION
       ====================================== */
    const ip = await getIP();
    const bypass = localStorage.getItem("security-bypass") === "true";

    let authorized =
        bypass ||
        allowedIPs.some(allowed => ipMatches(ip, allowed));

    if (!authorized || !isBusinessOpen()) {

        log(`BLOCKED access: IP ${ip}`);

        document.body.innerHTML = `
        <div class="denied">
            <h1>Access Denied</h1>
            <p>Your IP address <strong>${ip}</strong> is not authorized.</p>
            <p>If you believe this is an error, contact an administrator.</p>

            <input id="override" placeholder="Admin override key">
            <button onclick="
                if (document.getElementById('override').value === '${SECURITY.pin}') {
                    localStorage.setItem('security-bypass', 'true');
                    location.reload();
                } else {
                    alert('Invalid override key');
                }
            ">Enter Override</button>
        </div>`;

        document.head.insertAdjacentHTML("beforeend", `
            <style>
                .denied {
                    margin: 100px auto;
                    max-width: 500px;
                    text-align: center;
                    background: #ffffffdd;
                    padding: 40px;
                    border-radius: 10px;
                    border: 1px solid #ccc;
                    font-family: Arial;
                }
            </style>
        `);

        return;
    }

    log(`ACCESS granted to IP ${ip}`);

})();
