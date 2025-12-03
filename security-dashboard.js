/* ============================================================
   VisionBank Dashboard Guard
   Reads config written by security console (localStorage).
   For real deployments, move this logic into a backend or
   Cloudflare Worker so IPs and logs cannot be tampered with.
   ============================================================ */

const DASHBOARD_KEYS = {
  HOURS: "vb-security-hours",
  IPS: "vb-security-ips",
  AUDIT: "vb-security-audit"
};

async function vbGetIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch {
    return "0.0.0.0";
  }
}

function vbLoadJSON(key, fallback) {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : fallback;
  } catch {
    return fallback;
  }
}

/* IP in CIDR / single IP check */
function vbIpToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + (parseInt(part, 10) || 0), 0) >>> 0;
}

function vbIpMatches(ip, cidr) {
  if (!cidr.includes("/")) {
    return ip === cidr;
  }
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (Number.isNaN(bits)) return false;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (vbIpToInt(ip) & mask) === (vbIpToInt(range) & mask);
}

/* Business hours in CST */
function vbIsWithinHours(hours) {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
  const [hh, mm] = formatter.format(now).split(":");
  const current = `${hh}:${mm}`;
  const day = now.getDay().toString();
  return hours.days.includes(day) &&
         current >= hours.start &&
         current <= hours.end;
}

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
          If you believe this is an error, please contact a system administrator.
        </p>
      </div>
    </div>
  `;
}

/* Main guard */
(async function vbGuard() {
  const ip = await vbGetIp();

  const hours = vbLoadJSON(DASHBOARD_KEYS.HOURS, {
    start: "07:00",
    end: "19:00",
    days: ["1", "2", "3", "4", "5", "6"] // Mon–Sat
  });

  const ips = vbLoadJSON(DASHBOARD_KEYS.IPS, [
    "10.100.100.0/24",
    "45.19.161.17",
    "45.19.162.18/32",
    "120.112.1.119/28"
  ]);

  const inHours = vbIsWithinHours(hours);
  const ipAllowed = ips.some(rule => vbIpMatches(ip, rule));

  if (!inHours) {
    vbShowLockout(
      "The dashboard is only available during configured business hours (CST). " +
      "Please try again during the scheduled access window."
    );
    return;
  }

  if (!ipAllowed) {
    vbShowLockout(
      `Your IP address ${ip} is not in the allowed list for this dashboard.`
    );
    return;
  }

  // Access granted – no DOM changes, dashboard.js continues to run.
})();
