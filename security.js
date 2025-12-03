// =====================================
// VisionBank Security Core (security.js)
// =====================================

// Storage keys
const SEC_KEYS = {
  ADMINS: "vb-admins",
  CURRENT_ADMIN: "vb-current-admin",
  BUSINESS_HOURS: "vb-businessHours",
  ALLOWED_IPS: "vb-allowedIPs",
  AUDIT_LOG: "vb-auditLog"
};

// ---------- Audit logging ----------
function secLog(message) {
  const key = SEC_KEYS.AUDIT_LOG;
  const log = JSON.parse(localStorage.getItem(key) || "[]");
  const line = new Date().toLocaleString() + " — " + message;
  log.unshift(line);
  localStorage.setItem(key, JSON.stringify(log.slice(0, 500)));
}

// ---------- Admin storage helpers ----------
function loadAdmins() {
  const raw = localStorage.getItem(SEC_KEYS.ADMINS);
  if (!raw) {
    // Seed default superadmin
    const seed = [
      {
        username: "superadmin",
        pin: "ChangeMeNow!",
        totpSecret: null,
        label: "VisionBank Security (superadmin)",
        isSuper: true
      }
    ];
    localStorage.setItem(SEC_KEYS.ADMINS, JSON.stringify(seed));
    secLog("Seeded default superadmin account.");
    return seed;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAdmins(admins) {
  localStorage.setItem(SEC_KEYS.ADMINS, JSON.stringify(admins));
}

function getCurrentAdmin() {
  const id = localStorage.getItem(SEC_KEYS.CURRENT_ADMIN);
  if (!id) return null;
  const admins = loadAdmins();
  return admins.find(a => a.username.toLowerCase() === id.toLowerCase()) || null;
}

function setCurrentAdmin(username) {
  if (username) {
    localStorage.setItem(SEC_KEYS.CURRENT_ADMIN, username);
  } else {
    localStorage.removeItem(SEC_KEYS.CURRENT_ADMIN);
  }
}

// ---------- Business hours & IP helpers ----------
function loadBusinessHours() {
  const raw = localStorage.getItem(SEC_KEYS.BUSINESS_HOURS);
  if (!raw) {
    const def = {
      start: "07:00",
      end: "19:00",
      days: ["1", "2", "3", "4", "5", "6"] // Mon–Sat
    };
    localStorage.setItem(SEC_KEYS.BUSINESS_HOURS, JSON.stringify(def));
    return def;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return { start: "07:00", end: "19:00", days: ["1", "2", "3", "4", "5", "6"] };
  }
}

function saveBusinessHours(hours) {
  localStorage.setItem(SEC_KEYS.BUSINESS_HOURS, JSON.stringify(hours));
  secLog("Business hours updated.");
}

function loadAllowedIPs() {
  const raw = localStorage.getItem(SEC_KEYS.ALLOWED_IPS);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveAllowedIPs(list) {
  localStorage.setItem(SEC_KEYS.ALLOWED_IPS, JSON.stringify(list));
  secLog("Allowed IP list updated.");
}

function ipToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + (parseInt(part, 10) || 0), 0);
}

function ipMatches(ip, cidr) {
  if (!cidr) return false;
  if (!cidr.includes("/")) return ip === cidr;
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits)) return false;
  const mask = ~(2 ** (32 - bits) - 1) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

function isBusinessOpenNow() {
  const hours = loadBusinessHours();
  if (!hours.start || !hours.end || !Array.isArray(hours.days)) return true;

  const now = new Date();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const [hh, mm] = formatter.format(now).split(":");
  const current = hh + ":" + mm;
  const day = String(now.getDay());

  return hours.days.includes(day) &&
    current >= hours.start &&
    current <= hours.end;
}

async function getPublicIP() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    return data.ip;
  } catch {
    return "0.0.0.0";
  }
}

// Enforce on non-security pages
async function enforceDashboardFrontDoor() {
  const loc = window.location.pathname.toLowerCase();
  if (loc.includes("security.html")) return;

  const allowed = loadAllowedIPs();
  const hoursOk = isBusinessOpenNow();

  let ipOk = true;
  const ip = await getPublicIP();
  if (allowed.length > 0) {
    ipOk = allowed.some(r => ipMatches(ip, r));
  }

  if (ipOk && hoursOk) {
    secLog("Dashboard access granted to IP " + ip);
    return;
  }

  secLog("Dashboard access BLOCKED: IP " + ip);

  document.body.innerHTML = `
    <div class="denied">
      <h1>Access Denied</h1>
      <p>Your IP address <strong>${ip}</strong> is not authorized or outside business hours.</p>
      <p>If you believe this is an error, please contact a security administrator.</p>
      <p><a href="security.html">Go to Security Admin Console</a></p>
    </div>
  `;

  const style = document.createElement("style");
  style.textContent = `
    .denied {
      margin: 80px auto;
      max-width: 520px;
      text-align: center;
      background: #ffffffee;
      border-radius: 10px;
      border: 1px solid #ccc;
      padding: 30px 20px;
      font-family: Arial, sans-serif;
    }
    .denied h1 { margin-top: 0; }
    .denied a { color: #2c82c9; }
  `;
  document.head.appendChild(style);
}

// =====================================
// GOOGLE AUTHENTICATOR (using otplib)
// =====================================

// Configure otplib window so slight clock drift is OK
if (window.otplib && window.otplib.authenticator) {
  window.otplib.authenticator.options = { window: 1 };
}

function generateTotpSecret() {
  return window.otplib.authenticator.generateSecret();
}

function verifyTOTP(secret, token) {
  const clean = (token || "").replace(/\D/g, "");
  if (clean.length !== 6) return false;
  return window.otplib.authenticator.check(clean, secret);
}

// =====================================
// LOGIN HANDLING
// =====================================

async function handleAdminLogin() {
  const unameEl = document.getElementById("login-username");
  const pinEl = document.getElementById("login-pin");
  const totpEl = document.getElementById("login-totp");
  const errEl = document.getElementById("login-error");
  if (!unameEl || !pinEl || !totpEl || !errEl) return;

  errEl.textContent = "";

  const username = (unameEl.value || "").trim();
  const pin = (pinEl.value || "").trim();
  const totp = (totpEl.value || "").trim();

  const admins = loadAdmins();
  const admin = admins.find(a => a.username.toLowerCase() === username.toLowerCase());

  if (!admin || admin.pin !== pin) {
    errEl.textContent = "Invalid admin ID or PIN.";
    secLog("Failed admin login for ID: " + username);
    return;
  }

  if (admin.totpSecret) {
    if (!verifyTOTP(admin.totpSecret, totp)) {
      errEl.textContent = "Invalid Google Authenticator code.";
      secLog("Failed TOTP for admin " + admin.username);
      return;
    }
    setCurrentAdmin(admin.username);
    secLog("Admin " + admin.username + " logged in with MFA.");
    errEl.textContent = "";
    showAdminConsole();
  } else {
    // No secret yet → MFA enrolment
    setCurrentAdmin(admin.username);
    secLog("Admin " + admin.username + " logged in (no MFA yet).");
    errEl.textContent = "";
    showMfaSetupForAdmin(admin);
  }
}

// MFA enrolment screen
function showMfaSetupForAdmin(admin) {
  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-setup-card");
  const consoleCard = document.getElementById("admin-console");

  if (loginCard) loginCard.classList.add("sec-card-hidden");
  if (consoleCard) consoleCard.classList.add("sec-card-hidden");
  if (mfaCard) mfaCard.classList.remove("sec-card-hidden");

  const secret = generateTotpSecret();
  const label = admin.label || ("VisionBank-" + admin.username);
  const issuer = "VisionBank";

  const otpauth =
    "otpauth://totp/" +
    encodeURIComponent(issuer + ":" + label) +
    "?secret=" +
    secret +
    "&issuer=" +
    encodeURIComponent(issuer);

  const secretEl = document.getElementById("mfa-secret");
  const labelEl = document.getElementById("mfa-account-label");
  const qrEl = document.getElementById("mfa-qr-placeholder");

  if (secretEl) secretEl.textContent = secret;
  if (labelEl) labelEl.textContent = label;

  if (qrEl) {
    const qrUrl =
      "https://chart.googleapis.com/chart?chs=200x200&cht=qr&chl=" +
      encodeURIComponent(otpauth);
    qrEl.innerHTML =
      '<img src="' +
      qrUrl +
      '" alt="Scan in Google Authenticator" style="max-width:100%;border-radius:10px;" />';
  }

  sessionStorage.setItem(
    "vb-pending-mfa",
    JSON.stringify({ username: admin.username, secret: secret })
  );
}

function confirmMfaSetup() {
  const codeEl = document.getElementById("mfa-code");
  const errEl = document.getElementById("mfa-error");
  if (!codeEl || !errEl) return;

  errEl.textContent = "";

  const payloadRaw = sessionStorage.getItem("vb-pending-mfa");
  if (!payloadRaw) {
    errEl.textContent = "No MFA setup is pending.";
    return;
  }

  const payload = JSON.parse(payloadRaw);
  const secret = payload.secret;
  const username = payload.username;
  const token = (codeEl.value || "").trim();

  if (!verifyTOTP(secret, token)) {
    errEl.textContent = "Invalid code. Make sure you scanned the correct QR or secret.";
    return;
  }

  const admins = loadAdmins();
  const admin = admins.find(a => a.username.toLowerCase() === username.toLowerCase());
  if (!admin) {
    errEl.textContent = "Admin record not found.";
    return;
  }

  admin.totpSecret = secret;
  saveAdmins(admins);
  sessionStorage.removeItem("vb-pending-mfa");

  secLog("MFA successfully enabled for admin " + admin.username);
  errEl.textContent = "";
  showAdminConsole();
}

// Show admin console
function showAdminConsole() {
  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-setup-card");
  const consoleCard = document.getElementById("admin-console");
  const nameEl = document.getElementById("current-admin");

  if (loginCard) loginCard.classList.add("sec-card-hidden");
  if (mfaCard) mfaCard.classList.add("sec-card-hidden");
  if (consoleCard) consoleCard.classList.remove("sec-card-hidden");

  const admin = getCurrentAdmin();
  if (nameEl && admin) nameEl.textContent = admin.username;

  if (typeof initSecurityDashboard === "function") {
    initSecurityDashboard();
  }
}

// Logout
function handleLogout() {
  setCurrentAdmin(null);
  secLog("Admin logged out.");
  window.location.reload();
}

// Populate audit box
function populateAuditBox() {
  const box = document.getElementById("audit-log");
  if (!box) return;
  const log = JSON.parse(localStorage.getItem(SEC_KEYS.AUDIT_LOG) || "[]");
  box.textContent = log.join("\n");
}

// =====================================
// INIT
// =====================================

document.addEventListener("DOMContentLoaded", () => {
  // Apply IP + business-hours check on non-security pages
  enforceDashboardFrontDoor();

  const loc = window.location.pathname.toLowerCase();
  if (!loc.includes("security.html")) return;

  const btnLogin = document.getElementById("btn-login");
  const btnMfaConfirm = document.getElementById("btn-mfa-confirm");
  const btnLogout = document.getElementById("btn-logout");

  if (btnLogin) {
    btnLogin.addEventListener("click", (e) => {
      e.preventDefault();
      handleAdminLogin();
    });
  }

  if (btnMfaConfirm) {
    btnMfaConfirm.addEventListener("click", (e) => {
      e.preventDefault();
      confirmMfaSetup();
    });
  }

  if (btnLogout) {
    btnLogout.addEventListener("click", (e) => {
      e.preventDefault();
      handleLogout();
    });
  }

  // Already logged in?
  const admin = getCurrentAdmin();
  if (admin) {
    showAdminConsole();
  } else {
    const loginCard = document.getElementById("login-card");
    const mfaCard = document.getElementById("mfa-setup-card");
    const consoleCard = document.getElementById("admin-console");
    if (loginCard) loginCard.classList.remove("sec-card-hidden");
    if (mfaCard) mfaCard.classList.add("sec-card-hidden");
    if (consoleCard) consoleCard.classList.add("sec-card-hidden");
  }

  populateAuditBox();
});
