/* ======================================================================
   security-dashboard.js
   VisionBank Dashboard • Security Pre-Check Integration
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
            window.VB_SECURITY = { allowed: false, reason: "worker-error" };
            showDeniedMessage("Unable to validate access. Please contact the IT team.");
            return;
        }

        const data = await res.json();
        window.VB_SECURITY = data;

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

        updateSecurityFooterBanner();
    } catch (err) {
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
    if (!info) return;

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
