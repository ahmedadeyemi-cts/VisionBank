// security.js
// Handles authentication, Google Authenticator MFA and view switching.

(function () {
  "use strict";

  const STORAGE = {
    ADMINS: "vb_ceg_admins",
    SESSION: "vb_ceg_session",
    AUDIT: "vb_ceg_audit",
    MFA_PENDING: "vb_ceg_mfa_pending" // temp during setup
  };

  // Default super admin (only created if nothing exists)
  const DEFAULT_ADMIN = {
    username: "superadmin",
    pin: "ChangeMeNow!",
    mfaSecret: null,
    mfaEnabled: false
  };

  const OVERRIDE_KEY = "VB-CEG-ADMIN-OVERRIDE-2025";

  // Ensure audit structure
  function readAudit() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.AUDIT) || "[]");
    } catch {
      return [];
    }
  }

  function writeAudit(entries) {
    localStorage.setItem(STORAGE.AUDIT, JSON.stringify(entries));
  }

  function addAudit(message) {
    const entries = readAudit();
    const stamp = new Date().toISOString();
    const agent = navigator.userAgent || "unknown-agent";
    entries.unshift(`${stamp} — ${message} — UA: ${agent}`);
    writeAudit(entries);
  }

  // Admins helpers
  function readAdmins() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE.ADMINS) || "[]");
      if (!Array.isArray(data) || !data.length) throw new Error();
      return data;
    } catch {
      // bootstrap default
      localStorage.setItem(STORAGE.ADMINS, JSON.stringify([DEFAULT_ADMIN]));
      return [DEFAULT_ADMIN];
    }
  }

  function writeAdmins(admins) {
    localStorage.setItem(STORAGE.ADMINS, JSON.stringify(admins));
  }

  function findAdmin(username) {
    const admins = readAdmins();
    return admins.find((a) => a.username.toLowerCase() === username.toLowerCase());
  }

  function updateAdmin(username, updater) {
    const admins = readAdmins();
    const idx = admins.findIndex(
      (a) => a.username.toLowerCase() === username.toLowerCase()
    );
    if (idx === -1) return;
    admins[idx] = updater(admins[idx]);
    writeAdmins(admins);
  }

  // Session helpers
  function setSession(session) {
    localStorage.setItem(STORAGE.SESSION, JSON.stringify(session));
    renderSessionIndicator(session);
  }

  function getSession() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE.SESSION) || "null");
    } catch {
      return null;
    }
  }

  function clearSession() {
    localStorage.removeItem(STORAGE.SESSION);
    renderSessionIndicator(null);
  }

  function renderSessionIndicator(session) {
    const el = document.getElementById("sessionIndicator");
    if (!el) return;
    if (session && session.authenticated) {
      el.textContent = `Signed in as ${session.username}`;
    } else {
      el.textContent = "";
    }
  }

  // Random Base32 secret for Google Authenticator
  function generateBase32Secret(length = 32) {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let out = "";
    for (let i = 0; i < length; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  function getOtpLib() {
    if (!window.otplib || !window.otplib.authenticator) {
      console.error("otplib not loaded");
      return null;
    }
    const { authenticator } = window.otplib;
    authenticator.options = {
      step: 30,
      digits: 6
    };
    return authenticator;
  }

  // ===== View helpers =====

  function showView(id) {
    const views = ["loginView", "mfaSetupView", "mfaVerifyView", "adminConsole"];
    views.forEach((vid) => {
      const el = document.getElementById(vid);
      if (!el) return;
      if (vid === id) {
        el.classList.remove("hidden");
      } else {
        el.classList.add("hidden");
      }
    });
  }

  // store current user during login flow
  let pendingUser = null;

  // ====== LOGIN FLOW ======

  function initLogin() {
    const loginForm = document.getElementById("loginForm");
    const loginError = document.getElementById("loginError");
    const usernameInput = document.getElementById("loginUsername");
    const pinInput = document.getElementById("loginPin");
    const overrideBtn = document.getElementById("useOverrideBtn");
    const mfaBackToLogin = document.getElementById("mfaBackToLogin");

    if (!loginForm) return;

    loginForm.addEventListener("submit", (e) => {
      e.preventDefault();
      loginError.textContent = "";

      const username = usernameInput.value.trim();
      const pin = pinInput.value.trim();

      if (!username || !pin) {
        loginError.textContent = "Enter both username and PIN.";
        return;
      }

      const admin = findAdmin(username);
      if (!admin || admin.pin !== pin) {
        loginError.textContent = "Invalid username or PIN.";
        addAudit(`Failed login attempt for user "${username}"`);
        return;
      }

      pendingUser = admin.username;

      if (admin.mfaEnabled && admin.mfaSecret) {
        // Existing MFA – go straight to verify
        const verifyUser = document.getElementById("mfaVerifyError");
        if (verifyUser) verifyUser.textContent = "";
        document.getElementById("mfaVerifyCode").value = "";
        showView("mfaVerifyView");
      } else {
        // First time – MFA setup
        startMfaSetup(admin);
      }
    });

    overrideBtn.addEventListener("click", () => {
      const key = window.prompt("Enter override key:");
      if (!key) return;
      if (key === OVERRIDE_KEY) {
        pendingUser = "override-admin";
        completeLogin(true);
        addAudit("Access granted via override key");
      } else {
        window.alert("Invalid override key.");
        addAudit("Failed override key attempt");
      }
    });

    if (mfaBackToLogin) {
      mfaBackToLogin.addEventListener("click", () => {
        showView("loginView");
        pendingUser = null;
      });
    }
  }

  // ===== MFA SETUP =====

  function startMfaSetup(admin) {
    const otp = getOtpLib();
    if (!otp) {
      window.alert("TOTP library failed to load.");
      return;
    }

    const accountField = document.getElementById("mfaAccount");
    const secretField = document.getElementById("mfaSecret");
    const codeField = document.getElementById("mfaSetupCode");
    const errorEl = document.getElementById("mfaSetupError");
    const qrContainer = document.getElementById("mfaQr");

    const secret = generateBase32Secret();
    const issuer = "VisionBank Security";
    const accountLabel = `${admin.username}@VisionBank`;

    const otpauthUrl = otp.keyuri(accountLabel, issuer, secret);

    // store pending secret in localStorage so refresh doesn't break
    localStorage.setItem(
      STORAGE.MFA_PENDING,
      JSON.stringify({ username: admin.username, secret })
    );

    if (accountField) accountField.value = `${issuer} (${admin.username})`;
    if (secretField) secretField.value = secret;
    if (codeField) codeField.value = "";
    if (errorEl) errorEl.textContent = "";

    if (qrContainer) {
      qrContainer.innerHTML = "";
      if (window.QRCode) {
        new QRCode(qrContainer, {
          text: otpauthUrl,
          width: 220,
          height: 220
        });
      } else {
        qrContainer.textContent = "QR library failed to load.";
      }
    }

    showView("mfaSetupView");
  }

  function initMfaSetupForm() {
    const form = document.getElementById("mfaSetupForm");
    const codeField = document.getElementById("mfaSetupCode");
    const errorEl = document.getElementById("mfaSetupError");

    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!pendingUser) {
        errorEl.textContent = "Session expired. Return to login.";
        return;
      }

      const otp = getOtpLib();
      if (!otp) {
        errorEl.textContent = "TOTP library failed to load.";
        return;
      }

      const stored = localStorage.getItem(STORAGE.MFA_PENDING);
      if (!stored) {
        errorEl.textContent = "No pending MFA setup. Start again from login.";
        return;
      }

      let info;
      try {
        info = JSON.parse(stored);
      } catch {
        errorEl.textContent = "Setup data invalid. Start again.";
        return;
      }

      if (!info || info.username.toLowerCase() !== pendingUser.toLowerCase()) {
        errorEl.textContent = "Setup data invalid. Start again.";
        return;
      }

      const code = (codeField.value || "").trim();
      if (!/^\d{6}$/.test(code)) {
        errorEl.textContent = "Enter a valid 6-digit code.";
        return;
      }

      const isValid = otp.check(code, info.secret);
      if (!isValid) {
        errorEl.textContent =
          "Invalid code. Make sure you scanned the correct QR or secret.";
        addAudit(`MFA setup failed for user "${pendingUser}"`);
        return;
      }

      // save secret to admin profile
      updateAdmin(pendingUser, (admin) => ({
        ...admin,
        mfaSecret: info.secret,
        mfaEnabled: true
      }));

      localStorage.removeItem(STORAGE.MFA_PENDING);

      addAudit(`MFA enabled for user "${pendingUser}"`);
      completeLogin(false);
    });
  }

  // ===== MFA VERIFY (existing users) =====

  function initMfaVerifyForm() {
    const form = document.getElementById("mfaVerifyForm");
    const codeField = document.getElementById("mfaVerifyCode");
    const errorEl = document.getElementById("mfaVerifyError");

    if (!form) return;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (!pendingUser) {
        errorEl.textContent = "Session expired. Return to login.";
        return;
      }

      const admin = findAdmin(pendingUser);
      if (!admin || !admin.mfaEnabled || !admin.mfaSecret) {
        errorEl.textContent =
          "This account is not configured for MFA. Please login again.";
        return;
      }

      const otp = getOtpLib();
      if (!otp) {
        errorEl.textContent = "TOTP library failed to load.";
        return;
      }

      const code = (codeField.value || "").trim();
      if (!/^\d{6}$/.test(code)) {
        errorEl.textContent = "Enter a valid 6-digit code.";
        return;
      }

      const isValid = otp.check(code, admin.mfaSecret);
      if (!isValid) {
        errorEl.textContent = "Invalid code. Please try again.";
        addAudit(`MFA verify failed for user "${pendingUser}"`);
        return;
      }

      addAudit(`MFA verified for user "${pendingUser}"`);
      completeLogin(false);
    });
  }

  // ===== COMPLETE LOGIN =====

  function completeLogin(fromOverride) {
    const username = pendingUser || "unknown";

    const session = {
      authenticated: true,
      username,
      override: !!fromOverride,
      ts: Date.now()
    };

    setSession(session);
    pendingUser = null;

    addAudit(
      `Admin login successful for "${username}"${
        fromOverride ? " (override)" : ""
      }`
    );

    showView("adminConsole");

    if (window.initSecurityDashboard) {
      window.initSecurityDashboard(session);
    }
  }

  // ===== LOGOUT BUTTON =====

  function initLogout() {
    const btn = document.getElementById("logoutBtn");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const session = getSession();
      if (session?.username) {
        addAudit(`Admin "${session.username}" logged out`);
      }
      clearSession();
      pendingUser = null;
      showView("loginView");
    });
  }

  // ===== RESTORE EXISTING SESSION ON LOAD =====

  function restoreSessionIfAny() {
    const session = getSession();
    if (session && session.authenticated) {
      pendingUser = session.username;
      renderSessionIndicator(session);
      showView("adminConsole");
      if (window.initSecurityDashboard) {
        window.initSecurityDashboard(session);
      }
    } else {
      clearSession();
      showView("loginView");
    }
  }

  // ===== INIT =====

  document.addEventListener("DOMContentLoaded", () => {
    // bootstrap default admin store if missing
    readAdmins();

    initLogin();
    initMfaSetupForm();
    initMfaVerifyForm();
    initLogout();
    restoreSessionIfAny();
  });

  // Expose small API for dashboard
  window.VB_SECURITY = {
    getSession,
    addAudit,
    readAudit,
    updateAdmin
  };
})();
