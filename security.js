/* ============================================================
   VisionBank Security Admin Console (Cloudflare-integrated)
   ============================================================ */

/* ------------------------------------------------------------
   Cloudflare Worker endpoint
------------------------------------------------------------ */
const WORKER = "https://visionbank-security.ahmedadeyemi.workers.dev";

/* ------------------------------------------------------------
   Local storage keys (still used ONLY for admin account + session)
------------------------------------------------------------ */
const STORAGE_KEYS = {
  ADMIN: "vb-security-admin",     // { username, pinHash, mfaEnabled, mfaSecret }
  SESSION: "vb-security-session"  // { username, createdAt }
};

/* ------------ Tiny helpers ------------ */
const $ = (id) => document.getElementById(id);

function hashPIN(pin) {
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

/* ------------ Get client IP for audit tagging ------------ */
async function fetchClientIp() {
  try {
    const res = await fetch("https://api.ipify.org?format=json");
    const data = await res.json();
    window.__vbClientIp = data.ip;
  } catch {
    window.__vbClientIp = "unknown-ip";
  }
}

/* ------------------------------------------------------------
   ADMIN ACCOUNT INITIALIZER
------------------------------------------------------------ */
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

/* ------------------------------------------------------------
   Google Authenticator (TOTP) functions
------------------------------------------------------------ */

const TOTP_STEP = 30;
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
  view.setUint32(4, counter, false);

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

  return (code % 10 ** TOTP_DIGITS).toString().padStart(TOTP_DIGITS, "0");
}

async function verifyTOTP(secretBase32, token) {
  token = token.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(token)) return false;

  const now = Date.now();
  const windows = [-1, 0, 1];

  for (const w of windows) {
    const t = now + w * TOTP_STEP * 1000;
    const expected = await generateTOTP(secretBase32, t);
    if (expected === token) return true;
  }

  return false;
}

/* ------------ QR helper ------------ */
function buildOtpAuthUrl(account, secret) {
  const issuer = encodeURIComponent("VisionBank Security");
  const label = encodeURIComponent(account);
  return `otpauth://totp/${issuer}:${label}?secret=${secret}&issuer=${issuer}&period=${TOTP_STEP}`;
}

function renderMfaQr(account, secret) {
  const url = buildOtpAuthUrl(account, secret);
  const api = `https://chart.googleapis.com/chart?chs=220x220&cht=qr&chl=${encodeURIComponent(url)}`;
  $("mfa-qr").innerHTML = "";
  const img = document.createElement("img");
  img.src = api;
  img.alt = "Google Authenticator QR";
  img.className = "mfa-qr-img";
  $("mfa-qr").appendChild(img);
}

/* ------------ UI view switcher ------------ */
function showView(id) {
  ["login-view", "mfa-setup-view", "admin-view"].forEach(v => {
    $(v).classList.toggle("hidden", v !== id);
  });
}

/* ============================================================
   CLOUDLFARE-INTEGRATED: BUSINESS HOURS
============================================================ */
async function loadHoursIntoForm() {
  const res = await fetch(`${WORKER}/security/hours`);
  const data = await res.json();
  const hours = data.hours;

  $("hours-start").value = hours.start;
  $("hours-end").value = hours.end;

  document.querySelectorAll(".hours-day").forEach(cb => {
    cb.checked = hours.days.includes(parseInt(cb.value));
  });
}

async function saveHoursFromForm(e) {
  e.preventDefault();

  const start = $("hours-start").value || "07:00";
  const end = $("hours-end").value || "19:00";
  const days = Array.from(document.querySelectorAll(".hours-day:checked"))
                    .map(cb => parseInt(cb.value));

  await fetch(`${WORKER}/security/hours`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ start, end, days }),
  });

  alert("Business hours updated successfully.");
}

/* ============================================================
   CLOUDLFARE-INTEGRATED: IP ALLOWLIST
============================================================ */
async function loadIpsIntoForm() {
  const res = await fetch(`${WORKER}/security/ip`);
  const data = await res.json();
  $("ip-textarea").value = data.rulesText || "";
}

async function saveIpsFromForm(e) {
  e.preventDefault();

  const rules = $("ip-textarea").value;

  await fetch(`${WORKER}/security/ip`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules }),
  });

  alert("IP allowlist updated.");
}

/* ============================================================
   CLOUDLFARE-INTEGRATED: AUDIT LOG VIEWER
============================================================ */
async function loadAuditLog() {
  const res = await fetch(`${WORKER}/security/logs?limit=100`);
  const data = await res.json();

  $("audit-log").textContent = JSON.stringify(data.events, null, 2);
}

/* ============================================================
   LOGIN + MFA FLOW (unchanged)
============================================================ */
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
    return;
  }

  if (admin.mfaEnabled) {
    $("login-totp-wrapper").classList.remove("hidden");

    if (!totp) {
      msg.textContent = "Enter your Google Authenticator code.";
      return;
    }

    const ok = await verifyTOTP(admin.mfaSecret, totp);
    if (!ok) {
      msg.textContent = "Invalid Google Authenticator code.";
      return;
    }

    setSession(username);
    postLogin();
    return;
  }

  setSession(username);
  startMfaSetup(admin);
}

function startMfaSetup(admin) {
  const secret = randomBase32(32);
  admin.mfaSecret = secret;
  admin.mfaEnabled = false;
  saveJSON(STORAGE_KEYS.ADMIN, admin);

  $("mfa-account").value = `${admin.username}@visionbank-security`;
  $("mfa-secret").value = secret;
  $("mfa-code").value = "";

  renderMfaQr($("mfa-account").value, secret);
  showView("mfa-setup-view");
}

async function confirmMfaSetup() {
  const admin = loadJSON(STORAGE_KEYS.ADMIN, null);
  if (!admin || !admin.mfaSecret) {
    $("mfa-message").textContent = "Setup error.";
    return;
  }

  const token = $("mfa-code").value.trim();
  if (!token) {
    $("mfa-message").textContent = "Enter a 6-digit code.";
    return;
  }

  const ok = await verifyTOTP(admin.mfaSecret, token);
  if (!ok) {
    $("mfa-message").textContent = "Invalid Google Authenticator code.";
    return;
  }

  admin.mfaEnabled = true;
  saveJSON(STORAGE_KEYS.ADMIN, admin);
  alert("MFA enabled successfully.");
  postLogin();
}

function postLogin() {
  loadHoursIntoForm();
  loadIpsIntoForm();
  loadAuditLog();

  setInterval(loadAuditLog, 30000); // auto-refresh logs

  $("login-form").reset();
  $("login-totp-wrapper").classList.add("hidden");
  $("login-message").textContent = "";
  showView("admin-view");
}

function logout() {
  clearSession();
  showView("login-view");
}

/* Override key */
const OVERRIDE_KEY = "VisionBankOverride2025!";

function handleOverrideToggle() {
  $("override-form").classList.toggle("hidden");
}

function handleOverrideSubmit(e) {
  e.preventDefault();
  if ($("override-input").value.trim() === OVERRIDE_KEY) {
    setSession("override-admin");
    postLogin();
  } else {
    alert("Invalid override key.");
  }
}

/* ============================================================
   PAGE INITIALIZATION
============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  await fetchClientIp();
  ensureDefaultAdmin();

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

  const session = getSession();
  if (session) {
    loadHoursIntoForm();
    loadIpsIntoForm();
    loadAuditLog();
    showView("admin-view");
  } else {
    showView("login-view");
  }
});
