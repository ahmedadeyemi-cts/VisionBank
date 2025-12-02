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
    // Seed default superadmin (no MFA yet)
    const seed = [
      {
        username: "superadmin",
        pin: "ChangeMeNow!",
        totpSecret: null, // base32 string when set
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

// Get currently logged in admin object
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

// ---------- IP & Business Hours helpers ----------
function loadBusinessHours() {
  const raw = localStorage.getItem(SEC_KEYS.BUSINESS_HOURS);
  if (!raw) {
    // Default: 7AM–7PM CST, Mon–Sat
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

// CIDR matching
function ipToInt(ip) {
  return ip.split(".").reduce((acc, part) => (acc << 8) + (parseInt(part, 10) || 0), 0);
}

function ipMatches(ip, cidr) {
  if (!cidr) return false;
  if (!cidr.includes("/")) return ip === cidr;
  const parts = cidr.split("/");
  const range = parts[0];
  const bits = parseInt(parts[1], 10);
  if (isNaN(bits)) return false;
  const mask = ~(2 ** (32 - bits) - 1) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(range) & mask);
}

function isBusinessOpenNow() {
  const hours = loadBusinessHours();
  if (!hours.start || !hours.end || !Array.isArray(hours.days)) return true;

  const now = new Date();
  // convert to CST
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

// Run on dashboard pages only (NOT on security console)
async function enforceDashboardFrontDoor() {
  const loc = window.location.pathname.toLowerCase();
  if (loc.includes("security.html")) return;

  const allowed = loadAllowedIPs();
  const hoursOk = isBusinessOpenNow();

  // If no IP rules defined, only enforce business hours
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
    .denied h1 {
      margin-top: 0;
    }
    .denied a {
      color: #2c82c9;
    }
  `;
  document.head.appendChild(style);
}

// =====================================
// GOOGLE AUTHENTICATOR (TOTP) SUPPORT
// =====================================

// Basic Base32 decoding (RFC4648, no padding needed)
function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.toUpperCase().replace(/=+$/g, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substring(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

// Generate random base32 secret (20 bytes ≈ 32 chars)
function generateBase32Secret(length = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const arr = new Uint8Array(length);
  if (window.crypto && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < length; i++) arr[i] = Math.floor(Math.random() * 256);
  }
  let out = "";
  for (let i = 0; i < length; i++) {
    out += alphabet[arr[i] % alphabet.length];
  }
  return out;
}

// HMAC-SHA1 using Web Crypto
async function hotp(secretBase32, counter) {
  const keyBytes = base32ToBytes(secretBase32);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );

  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  // high 4 bytes = 0, low 4 bytes = counter
  view.setUint32(4, counter, false);

  const sig = await crypto.subtle.sign("HMAC", key, msg);
  const bytes = new Uint8Array(sig);
  const offset = bytes[bytes.length - 1] & 0x0f;
  const binCode =
    ((bytes[offset] & 0x7f) << 24) |
    ((bytes[offset + 1] & 0xff) << 16) |
    ((bytes[offset + 2] & 0xff) << 8) |
    (bytes[offset + 3] & 0xff);

  return binCode % 1000000;
}

async function verifyTOTP(secretBase32, token) {
  const code = (token || "").replace(/\D/g, "");
  if (code.length !== 6) return false;

  const timeStep = Math.floor(Date.now() / 1000 / 30);
  for (let offset = -1; offset <= 1; offset++) {
    const counter = timeStep + offset;
    if (counter < 0) continue;
    const val = await hotp(secretBase32, counter);
    const six = String(val).padStart(6, "0");
    if (six === code) return true;
  }
  return false;
}

// =====================================
// LOGIN HANDLING (used on security.html)
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

  // If admin has a TOTP secret, require code verification
  if (admin.totpSecret) {
    errEl.textContent = "Verifying Google Authenticator code…";

    try {
      const ok = await verifyTOTP(admin.totpSecret, totp);
      if (!ok) {
        errEl.textContent = "Invalid Google Authenticator code.";
        secLog("Failed TOTP for admin " + admin.username);
        return;
      }
    } catch (e) {
      console.error("TOTP error:", e);
      errEl.textContent = "Unable to verify TOTP.";
      return;
    }

    // success
    setCurrentAdmin(admin.username);
    secLog("Admin " + admin.username + " logged in with MFA.");
    errEl.textContent = "";
    showAdminConsole();
  } else {
    // No TOTP yet: log in and show MFA setup first
    setCurrentAdmin(admin.username);
    secLog("Admin " + admin.username + " logged in (no MFA yet).");
    errEl.textContent = "";
    showMfaSetupForAdmin(admin);
  }
}

// Show MFA setup card for an admin who has no secret yet
function showMfaSetupForAdmin(admin) {
  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-setup-card");
  const consoleCard = document.getElementById("admin-console");

  if (loginCard) loginCard.classList.add("sec-card-hidden");
  if (consoleCard) consoleCard.classList.add("sec-card-hidden");
  if (mfaCard) mfaCard.classList.remove("sec-card-hidden");

  const secret = generateBase32Secret();
  const label = admin.label || ("VisionBank-" + admin.username);
  const issuer = "VisionBank";

  const otpauth =
    "otpauth://totp/" +
    encodeURIComponent(issuer + ":" + label) +
    "?secret=" +
    secret +
    "&issuer=" +
    encodeURIComponent(issuer) +
    "&algorithm=SHA1&digits=6&period=30";

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

  // Temporarily store pending secret in sessionStorage until confirmed
  sessionStorage.setItem(
    "vb-pending-mfa",
    JSON.stringify({ username: admin.username, secret: secret })
  );
}

// Called when admin enters TOTP during enrollment
async function confirmMfaSetup() {
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

  try {
    const ok = await verifyTOTP(secret, token);
    if (!ok) {
      errEl.textContent = "Invalid code. Make sure you scanned the correct QR or secret.";
      return;
    }
  } catch (e) {
    console.error("TOTP verify error:", e);
    errEl.textContent = "Error verifying code.";
    return;
  }

  // Persist secret to admin record
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
  // Show main console now
  showAdminConsole();
}

// Display admin console after login
function showAdminConsole() {
  const loginCard = document.getElementById("login-card");
  const mfaCard = document.getElementById("mfa-setup-card");
  const consoleCard = document.getElementById("admin-console");
  const nameEl = document.getElementById("current-admin");

  if (loginCard) loginCard.classList.add("sec-card-hidden");
  if (mfaCard) mfaCard.classList.add("sec-card-hidden");
  if (consoleCard) consoleCard.classList.remove("sec-card-hidden");

  const admin = getCurrentAdmin();
  if (nameEl && admin) {
    nameEl.textContent = admin.username;
  }

  // fire dashboard init
  if (typeof initSecurityDashboard === "function") {
    initSecurityDashboard();
  }
}

// Logout
function handleLogout() {
  setCurrentAdmin(null);
  secLog("Admin logged out.");
  // Simple reload resets everything
  window.location.reload();
}

// Populate audit box in console
function populateAuditBox() {
  const box = document.getElementById("audit-log");
  if (!box) return;
  const log = JSON.parse(localStorage.getItem(SEC_KEYS.AUDIT_LOG) || "[]");
  box.textContent = log.join("\n");
}

// =====================================
// INIT ON LOAD
// =====================================

document.addEventListener("DOMContentLoaded", () => {
  // 1) Enforce IP + hours on non-security pages
  enforceDashboardFrontDoor();

  const loc = window.location.pathname.toLowerCase();
  if (!loc.includes("security.html")) return;

  // 2) Security console page behaviour
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

  // If already logged in, skip straight to console
  const admin = getCurrentAdmin();
  if (admin) {
    showAdminConsole();
  } else {
    // default: show login card
    const loginCard = document.getElementById("login-card");
    const mfaCard = document.getElementById("mfa-setup-card");
    const consoleCard = document.getElementById("admin-console");
    if (loginCard) loginCard.classList.remove("sec-card-hidden");
    if (mfaCard) mfaCard.classList.add("sec-card-hidden");
    if (consoleCard) consoleCard.classList.add("sec-card-hidden");
  }

  populateAuditBox();
});
