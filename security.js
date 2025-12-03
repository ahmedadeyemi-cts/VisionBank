/* ============================================================
   VisionBank Security Admin Console (frontend-only)
   ============================================================ */

const STORAGE_KEYS = {
  ADMIN: "vb-security-admin",          // { username, pinHash, mfaEnabled, mfaSecret }
  SESSION: "vb-security-session",      // { username, createdAt }
  HOURS: "vb-security-hours",          // { start:"07:00", end:"19:00", days:["1","2",...]}
  IPS: "vb-security-ips",              // ["10.100.100.0/24", ...]
  AUDIT: "vb-security-audit"           // [ string lines ]
};

/* ------------ Tiny helpers ------------ */
const $ = (id) => document.getElementById(id);

function hashPIN(pin) {
  // simple hash for demo only; not cryptographically strong
  return btoa(pin.split("").reverse().join(""));
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function addAudit(message) {
  const now = new Date().toISOString();
  const ip = window.__vbClientIp || "unknown-ip";
  const line = `[${now}] [${ip}] ${message}`;
  const log = loadJSON(STORAGE_KEYS.AUDIT, []);
  log.unshift(line);
  saveJSON(STORAGE_KEYS.AUDIT, log.slice(0, 200)); // keep last 200 lines
  renderAuditLog();
}

function renderAuditLog() {
  const log = loadJSON(STORAGE_KEYS.AUDIT, []);
  $("audit-log").textContent = log.join("\n");
}

/* ------------ IP (best-effort) ------------ */
async function fetchClientIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    window.__vbClientIp = data.ip;
  } catch {
    window.__vbClientIp = "unknown-ip";
  }
}

/* ------------ Admin bootstrap ------------ */
function ensureDefaultAdmin() {
  let admin = loadJSON(STORAGE_KEYS.ADMIN, null);
  if (!admin) {
    admin = {
      username: "superadmin",
      pinHash: hashPIN("ChangeMeNow!"),
      mfaEnabled: false,
      mfaSecret: null
    };
    saveJSON(STORAGE_KEYS.ADMIN, admin);
    addAudit("Initialized default superadmin account.");
  }
}

function getSession() {
  return loadJSON(STORAGE_KEYS.SESSION, null);
}

function setSession(username) {
  const session = { username, createdAt: new Date().toISOString() };
  saveJSON(STORAGE_KEYS.SESSION, session);
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.SESSION);
}

/* ------------ Google Authenticator (TOTP) helpers ------------ */
/* NOTE: This is a minimal implementation using Web Crypto.       */
/* It is intended for demo use; for production, use a battle-     */
/* tested TOTP library on a trusted backend instead.             */

const TOTP_STEP = 30; // seconds
const TOTP_DIGITS = 6;

function randomBase32(length = 32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let out = "";
  crypto.getRandomValues(new Uint8Array(length)).forEach(b => {
    out += alphabet[b % alphabet.length];
  });
  return out;
}

function base32ToBytes(base32) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of base32.replace(/=+$/,"").toUpperCase()) {
    const val = alphabet.indexOf(c);
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return new Uint8Array(bytes);
}

async function generateTOTP(secretBase32, time = Date.now()) {
  const keyBytes = base32ToBytes(secretBase32);
  const counter = Math.floor(time / 1000 / TOTP_STEP);
  const counterBytes = new ArrayBuffer(8);
  const view = new DataView(counterBytes);
  view.setUint32(4, counter, false); // big-endian low 4 bytes

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const hmac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, counterBytes));
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  const otp = (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
  return otp;
}

async function verifyTOTP(secretBase32, token) {
  token = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  const now = Date.now();
  const windows = [-1, 0, 1]; // allow small clock skew
  for (const w of windows) {
    const t = now + w * TOTP_STEP * 1000;
    const expected = await generateTOTP(secretBase32, t);
    if (expected === token) return true;
  }
  return false;
}

/* ------------ MFA QR URL ------------ */
function buildOtpAuthUrl(account, secret) {
  const issuer = encodeURIComponent("VisionBank Security");
  const label = encodeURIComponent(account);
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&period=${TOTP_STEP}`;
}

function renderMfaQr(account, secret) {
  const url = buildOtpAuthUrl(account, secret);
  const api = `https://chart.googleapis.com/chart?chs=220x220&cht=qr&chl=${encodeURIComponent(url)}`;
  const container = $("mfa-qr");
  container.innerHTML = "";
  const img = document.createElement("img");
  img.src = api;
  img.alt = "Google Authenticator QR";
  img.className = "mfa-qr-img";
  container.appendChild(img);
}

/* ------------ View helpers ------------ */
function showView(id) {
  ["login-view", "mfa-setup-view", "admin-view"].forEach(v => {
    $(v).classList.toggle("hidden", v !== id);
  });
}

/* ------------ Load / save config into UI ------------ */
function loadHoursIntoForm() {
  const hours = loadJSON(STORAGE_KEYS.HOURS, {
    start: "07:00",
    end: "19:00",
    days: ["1", "2", "3", "4", "5", "6"] // Mon–Sat
  });
  $("hours-start").value = hours.start;
  $("hours-end").value = hours.end;
  document.querySelectorAll(".hours-day").forEach(cb => {
    cb.checked = hours.days.includes(cb.value);
  });
}

function saveHoursFromForm(e) {
  e.preventDefault();
  const start = $("hours-start").value || "07:00";
  const end = $("hours-end").value || "19:00";
  const days = Array.from(document.querySelectorAll(".hours-day"))
    .filter(cb => cb.checked)
    .map(cb => cb.value);
  const data = { start, end, days };
  saveJSON(STORAGE_KEYS.HOURS, data);
  addAudit(`Updated business hours to ${start}-${end}, days=${days.join(",")}`);
  alert("Business hours saved.");
}

function loadIpsIntoForm() {
  const ips = loadJSON(STORAGE_KEYS.IPS, [
    "10.100.100.0/24",
    "45.19.161.17",
    "45.19.162.18/32",
    "120.112.1.119/28"
  ]);
  $("ip-textarea").value = ips.join("\n");
}

function saveIpsFromForm(e) {
  e.preventDefault();
  const lines = $("ip-textarea").value
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean);
  saveJSON(STORAGE_KEYS.IPS, lines);
  addAudit(`Updated IP allowlist (${lines.length} entries).`);
  alert("IP rules saved.");
}

/* ------------ Login & MFA flow ------------ */
async function handleLogin(e) {
  e.preventDefault();
  const username = $("login-username").value.trim();
  const pin = $("login-pin").value;
  const totp = $("login-totp").value.trim();
  const msg = $("login-message");
  msg.textContent = "";

  const admin = loadJSON(STORAGE_KEYS.ADMIN, null);
  if (!admin || username !== admin.username || hashPIN(pin) !== admin.pinHash) {
    msg.textContent = "Invalid ID or PIN.";
    addAudit(`Failed login for '${username}'.`);
    return;
  }

  // if MFA enabled, require TOTP
  if (admin.mfaEnabled) {
    $("login-totp-wrapper").classList.remove("hidden");
    if (!totp) {
      msg.textContent = "Enter your Google Authenticator code.";
      return;
    }
    const ok = await verifyTOTP(admin.mfaSecret, totp);
    if (!ok) {
      msg.textContent = "Invalid Google Authenticator code.";
      addAudit(`Failed TOTP verification for '${username}'.`);
      return;
    }
    setSession(username);
    addAudit(`Admin '${username}' logged in with MFA.`);
    postLogin();
    return;
  }

  // MFA not yet configured -> start setup
  setSession(username);
  addAudit(`Admin '${username}' logged in; MFA setup required.`);
  startMfaSetup(admin);
}

function startMfaSetup(admin) {
  // generate secret & show MFA setup view
  const secret = randomBase32(32);
  admin.mfaSecret = secret;
  admin.mfaEnabled = false;
  saveJSON(STORAGE_KEYS.ADMIN, admin);

  $("mfa-account").value = `${admin.username}@visionbank-security`;
  $("mfa-secret").value = secret;
  $("mfa-code").value = "";

  renderMfaQr($("mfa-account").value, secret);
  $("mfa-message").textContent = "";
  showView("mfa-setup-view");
}

async function confirmMfaSetup() {
  const admin = loadJSON(STORAGE_KEYS.ADMIN, null);
  if (!admin || !admin.mfaSecret) {
    $("mfa-message").textContent = "Setup error. Please refresh and log in again.";
    return;
  }
  const token = $("mfa-code").value.trim();
  if (!token) {
    $("mfa-message").textContent = "Enter a 6-digit code from Google Authenticator.";
    return;
  }
  const ok = await verifyTOTP(admin.mfaSecret, token);
  if (!ok) {
    $("mfa-message").textContent =
      "Invalid code. Make sure your phone time is correct and you scanned the latest QR code.";
    addAudit("Failed MFA confirmation.");
    return;
  }
  admin.mfaEnabled = true;
  saveJSON(STORAGE_KEYS.ADMIN, admin);
  addAudit("Google Authenticator MFA enabled for admin account.");
  $("mfa-message").textContent = "";
  alert("MFA confirmed and enabled.");
  postLogin();
}

function postLogin() {
  loadHoursIntoForm();
  loadIpsIntoForm();
  renderAuditLog();
  $("login-form").reset();
  $("login-totp-wrapper").classList.add("hidden");
  $("login-message").textContent = "";
  showView("admin-view");
}

function logout() {
  clearSession();
  showView("login-view");
}

/* Override key (simple demo) */
const OVERRIDE_KEY = "VisionBankOverride2025!";

function handleOverrideToggle() {
  $("override-form").classList.toggle("hidden");
}

function handleOverrideSubmit(e) {
  e.preventDefault();
  const value = $("override-input").value.trim();
  if (value === OVERRIDE_KEY) {
    setSession("override-admin");
    addAudit("Admin logged in via override key.");
    postLogin();
  } else {
    alert("Invalid override key.");
  }
}

/* ------------ Initialize on page load ------------ */
document.addEventListener("DOMContentLoaded", async () => {
  await fetchClientIp();
  ensureDefaultAdmin();
  renderAuditLog();

  // Bind events
  $("login-form").addEventListener("submit", handleLogin);
  $("hours-form").addEventListener("submit", saveHoursFromForm);
  $("ip-form").addEventListener("submit", saveIpsFromForm);
  $("logout-btn").addEventListener("click", logout);
  $("override-toggle").addEventListener("click", handleOverrideToggle);
  $("override-form").addEventListener("submit", handleOverrideSubmit);
  $("mfa-confirm-btn").addEventListener("click", confirmMfaSetup);
  $("mfa-cancel-btn").addEventListener("click", () => {
    clearSession();
    showView("login-view");
  });

  // Decide which view to show
  const session = getSession();
  if (session) {
    // already logged in
    loadHoursIntoForm();
    loadIpsIntoForm();
    showView("admin-view");
  } else {
    showView("login-view");
  }
});
