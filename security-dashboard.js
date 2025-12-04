/* ============================================================
   VisionBank Security Console Guard
   (Updated to match Cloudflare Worker–based security model)
   ============================================================ */

const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

/**
 * Calls the Cloudflare Worker to validate:
 *   - IP allowlist
 *   - CIDR subnets
 *   - Business hours
 *   - Approved weekdays
 */
async function vbCheckAccess() {
  try {
    const res = await fetch(`${SECURITY_BASE}/security/check`, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });

    if (!res.ok) {
      throw new Error(`Security HTTP ${res.status}`);
    }

    return await res.json();
  } catch (e) {
    console.error("Security console check failed:", e);
    return { allowed: false, reason: "unreachable" };
  }
}

/**
 * Shows a full lockout screen if user is not allowed.
 */
function vbShowLockout(message) {
  document.body.innerHTML = `
    <div style="
      min-height:100vh;
      display:flex;
      align-items:center;
      justify-content:center;
      background:#050816;
      color:#f5f7ff;
      font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
    ">
      <div style="
        max-width:520px;
        padding:32px 36px;
        border-radius:16px;
        background:rgba(19,22,38,0.92);
        box-shadow:0 18px 40px rgba(0,0,0,0.55);
        text-align:center;
      ">
        <h1 style="margin-top:0;margin-bottom:8px;font-size:24px;">Access Restricted</h1>
        <p style="margin:0 0 14px;font-size:14px;line-height:1.5;">${message}</p>
        <p style="margin:0;font-size:12px;color:#9aa3c7;">
          If you believe this is an error, please contact the VisionBank IT Team.
        </p>
      </div>
    </div>
  `;
}

/**
 * Maps Worker result → human readable messages
 */
function vbExplain(reason) {
  switch (reason) {
    case "ip-denied":
      return "Your IP address is not approved for VisionBank Security Console access.";
    case "hours-closed":
      return "Access to the Security Console is restricted outside configured business hours (CST).";
    case "unreachable":
      return "Security validation service is unreachable. Access cannot be granted.";
    default:
      return "Your access is restricted by security policy.";
  }
}

/**
 * MAIN GUARD EXECUTION
 * Runs before security.html loads its UI.
 */
(async function vbSecurityConsoleGuard() {
  const sec = await vbCheckAccess();

  if (!sec.allowed) {
    const msg = vbExplain(sec.reason);
    vbShowLockout(msg);
    return;
  }

  // ------------------------------------------
  // ACCESS GRANTED
  // ------------------------------------------
  console.log("%cSecurity Console Access Approved", "color:#00d97e;font-weight:bold;");
  console.log("Security Info:", sec);

  // Optional: show a small green badge in console footer
  const badge = document.createElement("div");
  badge.style.position = "fixed";
  badge.style.bottom = "10px";
  badge.style.right = "10px";
  badge.style.padding = "6px 12px";
  badge.style.background = "rgba(0,150,0,0.85)";
  badge.style.color = "#fff";
  badge.style.fontSize = "11px";
  badge.style.borderRadius = "6px";
  badge.style.zIndex = "9999";
  badge.textContent = `Security Console Verified — IP ${sec.info.ip}`;
  document.body.appendChild(badge);

})();
