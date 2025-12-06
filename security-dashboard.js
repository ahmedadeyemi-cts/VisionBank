/* ======================================================================
   security-dashboard.js
   VisionBank Dashboard • Security Pre-Check Integration
   - Performs IP + Business Hours evaluation
   - Exposes VB_SECURITY object globally
   - Updates optional footer/status UI if present
   ====================================================================== */

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

/* ============================================================
   1. RUN SECURITY CHECK ON PAGE LOAD
   ============================================================ */

(async function securityCheck() {
    try {
        const res = await fetch(`${WORKER_BASE}/security/check`, {
            method: "GET",
            mode: "cors",
            credentials: "omit"
        });

        if (!res.ok) {
            console.warn("Security check error:", res.status);
            window.VB_SECURITY = { allowed: false, reason: "worker-error" };
            showDeniedMessage("Unable to validate access. Please contact the IT team.");
            return;
        }

        const data = await res.json();

        // Store globally
        window.VB_SECURITY = data;

        // If not allowed, stop dashboard load
        if (!data.allowed) {
            if (data.reason === "ip-denied") {
                showDeniedMessage(
                    "Your access is being denied due to lack of permission. Please contact the IT Team to enable your access."
                );
            } else if (data.reason === "hours-closed") {
                showDeniedMessage(
                    "This dashboard is only available during approved business hours (CST)."
                );
            } else {
                showDeniedMessage(
                    "Your access is currently unavailable. Please contact the IT team."
                );
            }
            return;
        }

        // If allowed, update footer display if element exists
        updateSecurityFooterBanner();

    } catch (err) {
        console.error("Security check failed:", err);
        window.VB_SECURITY = { allowed: false, reason: "network-error" };
        showDeniedMessage("Unable to validate security access (network error).");
    }
})();

/* ============================================================
   2. OPTIONAL: SHOW DENIED PAGE MESSAGE
   ============================================================ */

function showDeniedMessage(msg) {
    const blocker = document.createElement("div");
    blocker.style.position = "fixed";
    blocker.style.top = 0;
    blocker.style.left = 0;
    blocker.style.right = 0;
    blocker.style.bottom = 0;
    blocker.style.background = "#ffffff";
    blocker.style.display = "flex";
    blocker.style.flexDirection = "column";
    blocker.style.alignItems = "center";
    blocker.style.justifyContent = "center";
    blocker.style.zIndex = "999999";
    blocker.style.fontFamily = "-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    blocker.innerHTML = `
        <h2 style="color:#c00; margin-bottom: 10px;">Access Denied</h2>
        <p style="max-width:420px; text-align:center; font-size:15px; color:#333;">
            ${msg}
        </p>
    `;
    document.body.innerHTML = "";
    document.body.appendChild(blocker);
}

/* ============================================================
   3. UPDATE FOOTER / UI WITH SECURITY STATUS
   ============================================================ */

function updateSecurityFooterBanner() {
    if (!window.VB_SECURITY || !window.VB_SECURITY.allowed) return;

    const info = window.VB_SECURITY.info;
    if (!info || !info.now) return;

    // If your footer has: <span id="securityStatus"></span>
    const el = document.getElementById("securityStatus");
    if (el) {
        el.textContent =
            "Access approved from IP " +
            info.ip +
            " at " +
            info.now.label +
            " (CST)";
    }

    console.log("Security check info:", info);
}
/* ======================================================================
   5. CIDR TESTER PANEL — PURE JS IPV4 + IPV6 CIDR ENGINE Section Below is being removed:
   // ---------- BigInt IP Conversion ----------
function ipToBigInt(ip) {
    if (ip.includes(".")) {
        return ip.split(".")
            .reduce((acc, oct) => (acc << 8n) + BigInt(parseInt(oct, 10)), 0n);
    }

    // IPv6
    const parts = ip.split("::");
    let left = parts[0].split(":").filter(Boolean);
    let right = parts.length > 1 ? parts[1].split(":").filter(Boolean) : [];

    const missing = 8 - (left.length + right.length);
    const middle = Array(missing).fill("0");

    const full = [...left, ...middle, ...right]
        .map(h => BigInt(parseInt(h || "0", 16)));

    return full.reduce((acc, h) => (acc << 16n) + h, 0n);
}

// ---------- CIDR Check ----------
function isIpInCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split("/");
        const prefix = BigInt(bits);
        const ipNum = ipToBigInt(ip);
        const rangeNum = ipToBigInt(range);
        const totalBits = ip.includes(".") ? 32n : 128n;

        const mask = (totalBits === 32n)
            ? (~0n << (32n - prefix)) & 0xffffffffn
            : (~0n << (128n - prefix));

        return (ipNum & mask) === (rangeNum & mask);
    } catch {
        return false;
    }
}

function checkRules(ip, rules) {
    for (const rule of rules) {
        if (rule.includes("/")) {
            if (isIpInCidr(ip, rule)) return { match: true, rule };
        } else if (ip === rule) {
            return { match: true, rule };
        }
    }
    return { match: false, rule: null };
}

// ---------- Hook up CIDR Tester UI ----------
document.addEventListener("DOMContentLoaded", () => {
    const ipBox = document.getElementById("cidr-test-ip");
    const rulesBox = document.getElementById("cidr-test-rules");
    const btn = document.getElementById("cidr-test-btn");
    const result = document.getElementById("cidr-test-result");

    if (!ipBox || !rulesBox || !btn) return;

    // Auto-load rules from the allowlist textarea
    const mainRulesTextarea = document.getElementById("ip-textarea");
    if (mainRulesTextarea) {
        rulesBox.value = mainRulesTextarea.value;
    }

    btn.addEventListener("click", () => {
        const ip = ipBox.value.trim();
        const rules = rulesBox.value.split("\n").map(r => r.trim()).filter(Boolean);

        if (!ip) {
            result.textContent = "Enter an IP address first.";
            result.className = "cidr-test-result error";
            result.classList.remove("hidden");
            return;
        }

        if (rules.length === 0) {
            result.textContent = "No rules available to test.";
            result.className = "cidr-test-result error";
            result.classList.remove("hidden");
            return;
        }

        const { match, rule } = checkRules(ip, rules);

        if (match) {
            result.textContent = `✔ Allowed. Matching Rule: ${rule}`;
            result.className = "cidr-test-result success";
        } else {
            result.textContent = `✖ Not Allowed. No matching rule found.`;
            result.className = "cidr-test-result error";
        }

        result.classList.remove("hidden");
    });
});
   ====================================================================== */
 // ---------- BigInt IP Conversion ----------
function ipToBigInt(ip) {
    if (ip.includes(".")) {
        return ip.split(".")
            .reduce((acc, oct) => (acc << 8n) + BigInt(parseInt(oct, 10)), 0n);
    }

    // IPv6
    const parts = ip.split("::");
    let left = parts[0].split(":").filter(Boolean);
    let right = parts.length > 1 ? parts[1].split(":").filter(Boolean) : [];

    const missing = 8 - (left.length + right.length);
    const middle = Array(missing).fill("0");

    const full = [...left, ...middle, ...right]
        .map(h => BigInt(parseInt(h || "0", 16)));

    return full.reduce((acc, h) => (acc << 16n) + h, 0n);
}

// ---------- CIDR Check ----------
function isIpInCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split("/");
        const prefix = BigInt(bits);
        const ipNum = ipToBigInt(ip);
        const rangeNum = ipToBigInt(range);
        const totalBits = ip.includes(".") ? 32n : 128n;

        const mask = (totalBits === 32n)
            ? (~0n << (32n - prefix)) & 0xffffffffn
            : (~0n << (128n - prefix));

        return (ipNum & mask) === (rangeNum & mask);
    } catch {
        return false;
    }
}

function checkRules(ip, rules) {
    for (const rule of rules) {
        if (rule.includes("/")) {
            if (isIpInCidr(ip, rule)) return { match: true, rule };
        } else if (ip === rule) {
            return { match: true, rule };
        }
    }
    return { match: false, rule: null };
}

// ---------- Hook up CIDR Tester UI ----------
document.addEventListener("DOMContentLoaded", () => {
    const ipBox = document.getElementById("cidr-test-ip");
    const rulesBox = document.getElementById("cidr-test-rules");
    const btn = document.getElementById("cidr-test-btn");
    const result = document.getElementById("cidr-test-result");

    if (!ipBox || !rulesBox || !btn) return;

    // Auto-load rules from the allowlist textarea
    const mainRulesTextarea = document.getElementById("ip-textarea");
    if (mainRulesTextarea) {
        rulesBox.value = mainRulesTextarea.value;
    }

    btn.addEventListener("click", () => {
        const ip = ipBox.value.trim();
        const rules = rulesBox.value.split("\n").map(r => r.trim()).filter(Boolean);

        if (!ip) {
            result.textContent = "Enter an IP address first.";
            result.className = "cidr-test-result error";
            result.classList.remove("hidden");
            return;
        }

        if (rules.length === 0) {
            result.textContent = "No rules available to test.";
            result.className = "cidr-test-result error";
            result.classList.remove("hidden");
            return;
        }

        const { match, rule } = checkRules(ip, rules);

        if (match) {
            result.textContent = `✔ Allowed. Matching Rule: ${rule}`;
            result.className = "cidr-test-result success";
        } else {
            result.textContent = `✖ Not Allowed. No matching rule found.`;
            result.className = "cidr-test-result error";
        }

        result.classList.remove("hidden");
    });
});

/* ============================================================
   4. PLACEHOLDER HOOK FOR OTHER DASHBOARD JS
   ============================================================ */

// Example if you ever want to gate other logic:
/*
document.addEventListener("DOMContentLoaded", () => {
    if (window.VB_SECURITY && window.VB_SECURITY.allowed) {
        // loadDashboard();
    }
});
*/
