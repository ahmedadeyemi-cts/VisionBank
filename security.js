/* ============================================================
   SECURITY.JS — OLD UI + NEW WORKER LOGIC + THEME TOGGLE
   VisionBank | Admin Login • MFA • Access Control
   ============================================================ */

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
const THEME_KEY = "vb_security_theme";

/* ---------- UI Elements ---------- */
const loginView = document.getElementById("login-view");
const mfaSetupView = document.getElementById("mfa-setup-view");
const adminView = document.getElementById("admin-view");

const loginForm = document.getElementById("login-form");
const loginMsg = document.getElementById("login-message");
const overrideToggle = document.getElementById("override-toggle");
const overrideForm = document.getElementById("override-form");
const overrideInput = document.getElementById("override-input");

const loginTotpWrapper = document.getElementById("login-totp-wrapper");
const loginTotp = document.getElementById("login-totp");

const mfaQrImg = document.getElementById("mfa-qr-img");
const mfaAccount = document.getElementById("mfa-account");
const mfaSecret = document.getElementById("mfa-secret");
const mfaCodeInput = document.getElementById("mfa-code");
const mfaConfirmBtn = document.getElementById("mfa-confirm-btn");
const mfaCancelBtn = document.getElementById("mfa-cancel-btn");
const mfaMsg = document.getElementById("mfa-message");

const logoutBtn = document.getElementById("logout-btn");

const hoursForm = document.getElementById("hours-form");
const hoursStart = document.getElementById("hours-start");
const hoursEnd = document.getElementById("hours-end");
const hoursDayChecks = document.querySelectorAll(".hours-day");

const ipForm = document.getElementById("ip-form");
const ipTextarea = document.getElementById("ip-textarea");

const auditLogBox = document.getElementById("audit-log");

const themeToggle = document.getElementById("theme-toggle");

/* ---------- State ---------- */
let ACTIVE_SESSION = null;
let ACTIVE_USERNAME = null;
let ACTIVE_ROLE = null;

let statusTimer = null;
let userPanelInitialized = false;

/* =============================================================
   THEME HANDLING
   ============================================================= */

function applyTheme(theme) {
  const body = document.body;
  body.classList.remove("theme-light", "theme-dark");
  body.classList.add(theme === "dark" ? "theme-dark" : "theme-light");
}

(function initTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    const initial = stored === "dark" || stored === "light" ? stored : "light";
    applyTheme(initial);
  } catch {
    applyTheme("light");
  }
})();

if (themeToggle) {
  themeToggle.addEventListener("click", () => {
    const isDark = document.body.classList.contains("theme-dark");
    const next = isDark ? "light" : "dark";
    applyTheme(next);
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // ignore storage issues
    }
  });
}

/* =============================================================
   STATUS BANNER
   ============================================================= */

function showStatus(msg, type = "info") {
  let bar = document.getElementById("admin-status");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "admin-status";
    bar.style.marginBottom = "10px";
    bar.style.padding = "8px 12px";
    bar.style.borderRadius = "8px";
    bar.style.fontSize = "14px";
    bar.style.display = "none";
    adminView.prepend(bar);
  }

  bar.textContent = msg;
  bar.style.display = "block";

  if (type === "success") {
    bar.style.backgroundColor = "#e6ffed";
    bar.style.border = "1px solid #16a34a";
    bar.style.color = "#14532d";
  } else if (type === "error") {
    bar.style.backgroundColor = "#fee2e2";
    bar.style.border = "1px solid #dc2626";
    bar.style.color = "#7f1d1d";
  } else {
    bar.style.backgroundColor = "#e0ecff";
    bar.style.border = "1px solid #2563eb";
    bar.style.color = "#1e3a8a";
  }

  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    bar.style.display = "none";
  }, 4000);
}

/* =============================================================
   1.  LOGIN HANDLING
   ============================================================= */

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "";

  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-pin").value.trim(); // Worker expects "password"
  const totp = loginTotpWrapper.classList.contains("hidden")
    ? ""
    : loginTotp.value.trim();

  ACTIVE_USERNAME = username;

  try {
    const res = await fetch(`${WORKER_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, totp }),
    });

    const data = await res.json();

    if (!res.ok) {
      loginMsg.textContent = data.error || "Login failed.";
      return;
    }

    // MFA not yet configured for a user that requires MFA
    if (data.requireMfaSetup) {
      await beginMfaEnrollment(username);
      return;
    }

    // MFA is required for this login (but code not sent yet)
    if (data.requireTotp) {
      loginTotpWrapper.classList.remove("hidden");
      loginMsg.textContent = "Enter your 6-digit Microsoft Authenticator code.";
      return;
    }

    // SUCCESS
    if (data.success && data.session) {
      ACTIVE_SESSION = data.session;
      ACTIVE_ROLE = data.user?.role || "view";

      loginTotp.value = "";
      loginTotpWrapper.classList.add("hidden");
      showAdminView();
      return;
    }

    loginMsg.textContent = "Unexpected response from authentication service.";
  } catch (err) {
    console.error(err);
    loginMsg.textContent = "Network error connecting to authentication service.";
  }
});

/* =============================================================
   2.  OVERRIDE KEY HANDLING (UI ONLY — NO BACKEND ENDPOINT)
   ============================================================= */

overrideToggle.addEventListener("click", () => {
  overrideForm.classList.toggle("hidden");
});

overrideForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginMsg.textContent = "Override login is not enabled on this system.";
});

/* =============================================================
   3.  MFA SETUP FLOW
   ============================================================= */

async function beginMfaEnrollment(username) {
  try {
    const res = await fetch(`${WORKER_BASE}/api/setup-mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });

    const data = await res.json();

    if (!res.ok) {
      loginMsg.textContent = data.error || "Unable to start MFA setup.";
      return;
    }

    ACTIVE_USERNAME = username;
    showMfaSetup({
      username,
      qr: data.qr,
      secret: data.secret,
    });
  } catch (err) {
    console.error(err);
    loginMsg.textContent = "Network error starting MFA setup.";
  }
}

function showMfaSetup(data) {
  loginView.classList.add("hidden");
  adminView.classList.add("hidden");
  mfaSetupView.classList.remove("hidden");

  mfaQrImg.src = data.qr;
  mfaAccount.value = data.username || ACTIVE_USERNAME || "";
  mfaSecret.value = data.secret || "";
  mfaCodeInput.value = "";
  mfaMsg.textContent = "";
}

mfaConfirmBtn.addEventListener("click", async () => {
  const code = mfaCodeInput.value.trim();
  if (!code) {
    mfaMsg.textContent = "Enter a 6-digit code.";
    return;
  }

  try {
    const res = await fetch(`${WORKER_BASE}/api/confirm-mfa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: ACTIVE_USERNAME, code }),
    });

    const data = await res.json();

    if (!res.ok) {
      mfaMsg.textContent = data.error || "Invalid MFA code.";
      return;
    }

    // MFA confirmed: send user back to login to authenticate with password + TOTP
    mfaMsg.textContent = "MFA confirmed. Please log in with your password and 6-digit code.";
    setTimeout(() => {
      mfaSetupView.classList.add("hidden");
      loginView.classList.remove("hidden");
      loginMsg.textContent = "MFA configured. Please log in.";
    }, 1200);
  } catch (err) {
    console.error(err);
    mfaMsg.textContent = "Unable to verify MFA code.";
  }
});

mfaCancelBtn.addEventListener("click", () => {
  mfaSetupView.classList.add("hidden");
  loginView.classList.remove("hidden");
});

/* =============================================================
   4.  SHOW ADMIN VIEW
   ============================================================= */

async function showAdminView() {
  loginView.classList.add("hidden");
  mfaSetupView.classList.add("hidden");
  adminView.classList.remove("hidden");

  await loadBusinessHours();
  await loadIpRules();
  await loadAuditLog();

  applyRolePermissions();
}

/* =============================================================
   ROLE-BASED PERMISSIONS
   ============================================================= */

function applyRolePermissions() {
  const role = ACTIVE_ROLE || "view";

  // Business Hours: superadmin, admin, analyst can edit
  const canEditHours = role === "superadmin" || role === "admin" || role === "analyst";
  hoursStart.disabled = !canEditHours;
  hoursEnd.disabled = !canEditHours;
  hoursDayChecks.forEach((cb) => (cb.disabled = !canEditHours));
  const hoursButtons = hoursForm ? hoursForm.querySelectorAll("button, input[type='submit']") : [];
  hoursButtons.forEach((el) => (el.disabled = !canEditHours));

  // IP Allowlist: superadmin, admin can edit
  const canEditIp = role === "superadmin" || role === "admin";
  ipTextarea.disabled = !canEditIp;
  const ipButtons = ipForm ? ipForm.querySelectorAll("button, input[type='submit']") : [];
  ipButtons.forEach((el) => (el.disabled = !canEditIp));

  // Logs: superadmin, admin, auditor can view
  const canViewLogs = role === "superadmin" || role === "admin" || role === "auditor";
  if (!canViewLogs) {
    auditLogBox.textContent = "You do not have permission to view logs.";
  }

  // User Management: only superadmin
  if (role === "superadmin") {
    initUserManagement();
  }
}

/* =============================================================
   5.  BUSINESS HOURS
   ============================================================= */

async function loadBusinessHours() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/get-hours`);
    const hours = await res.json();

    hoursStart.value = hours.start || "";
    hoursEnd.value = hours.end || "";

    hoursDayChecks.forEach((cb) => {
      cb.checked = Array.isArray(hours.days) ? hours.days.includes(Number(cb.value)) : false;
    });
  } catch (err) {
    console.error("Hours load failed:", err);
  }
}

hoursForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const start = hoursStart.value;
  const end = hoursEnd.value;
  const days = [...hoursDayChecks]
    .filter((cb) => cb.checked)
    .map((cb) => Number(cb.value));

  try {
    const res = await fetch(`${WORKER_BASE}/api/set-hours`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ start, end, days }),
    });

    if (!res.ok) {
      showStatus("Failed to save business hours.", "error");
      return;
    }

    showStatus("Business hours saved successfully.", "success");
  } catch (err) {
    console.error("Save hours failed:", err);
    showStatus("Failed to save business hours.", "error");
  }
});

/* =============================================================
   6.  IP ALLOWLIST
   ============================================================= */

async function loadIpRules() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`);
    const data = await res.json();
    ipTextarea.value = Array.isArray(data.rules) ? data.rules.join("\n") : "";
  } catch (err) {
    console.error("IP load failed:", err);
  }
}

ipForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const rules = ipTextarea.value
    .split("\n")
    .map((r) => r.trim())
    .filter((r) => r);

  try {
    const res = await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rules }),
    });

    if (!res.ok) {
      showStatus("Failed to save IP Allowlist.", "error");
      return;
    }

    showStatus("IP Allowlist saved successfully.", "success");
  } catch (err) {
    console.error("Save IP rules failed:", err);
    showStatus("Failed to save IP Allowlist.", "error");
  }
});

/* =============================================================
   7.  AUDIT LOG
   ============================================================= */

async function loadAuditLog() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/logs`);
    const data = await res.json();

    const events = Array.isArray(data.events) ? data.events : [];

    auditLogBox.textContent =
      events
        .map((ev) => {
          const t = ev.time || "";
          const ip = ev.ip || "";
          const path = ev.path || "";
          const reason = ev.reason || "";
          const allowed = ev.allowed ? "ALLOWED" : "DENIED";
          return `${t} | ${ip} | ${path} | ${allowed} | ${reason}`;
        })
        .join("\n") || "No logs yet.";
  } catch (err) {
    console.error("Log load failed:", err);
    auditLogBox.textContent = "Unable to load logs.";
  }
}

/* =============================================================
   8.  USER MANAGEMENT (SUPERADMIN ONLY)
   ============================================================= */

function initUserManagement() {
  if (userPanelInitialized) return;
  userPanelInitialized = true;

  const section = document.createElement("section");
  section.id = "user-management";
  section.innerHTML = `
        <h3>User Management</h3>
        <div class="user-mgmt">
            <div class="user-form">
                <label>Username<br><input type="text" id="user-username" /></label><br>
                <label>Password<br><input type="password" id="user-password" /></label><br>
                <label>Role<br>
                    <select id="user-role">
                        <option value="superadmin">Super Admin</option>
                        <option value="admin">Admin</option>
                        <option value="analyst">Analyst</option>
                        <option value="auditor">Auditor</option>
                        <option value="view">View</option>
                    </select>
                </label><br>
                <label><input type="checkbox" id="user-mfa" /> MFA Enabled</label>
                <div class="user-buttons" style="margin-top:8px;">
                    <button type="button" id="user-save-btn" class="btn-primary">Add / Update User</button>
                    <button type="button" id="user-delete-btn" class="btn-secondary">Delete User</button>
                    <button type="button" id="user-reset-mfa-btn" class="btn-secondary">Reset MFA</button>
                </div>
            </div>
            <div class="user-list" style="margin-top:12px;">
                <h4>Existing Users</h4>
                <table id="user-table">
                    <thead>
                        <tr><th>Username</th><th>Role</th><th>MFA</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `;

  // Insert into placeholder container so it appears above logs
  const container = document.getElementById("user-management-container") || adminView;
  container.appendChild(section);

  const usernameInput = section.querySelector("#user-username");
  const passwordInput = section.querySelector("#user-password");
  const roleSelect = section.querySelector("#user-role");
  const mfaCheckbox = section.querySelector("#user-mfa");

  const saveBtn = section.querySelector("#user-save-btn");
  const deleteBtn = section.querySelector("#user-delete-btn");
  const resetMfaBtn = section.querySelector("#user-reset-mfa-btn");

  const tbody = section.querySelector("#user-table tbody");

  saveBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    const password = passwordInput.value.trim();
    const role = roleSelect.value;
    const mfaEnabled = mfaCheckbox.checked;

    if (!username || !password) {
      showStatus("Username and password are required.", "error");
      return;
    }

    try {
      const res = await fetch(`${WORKER_BASE}/api/users/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role, mfaEnabled }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showStatus(data.error || "Failed to save user.", "error");
        return;
      }

      showStatus("User saved successfully.", "success");
      passwordInput.value = "";
      await refreshUserList();
    } catch (err) {
      console.error("Save user failed:", err);
      showStatus("Failed to save user.", "error");
    }
  });

  deleteBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) {
      showStatus("Select a user to delete.", "error");
      return;
    }

    if (!confirm(`Delete user "${username}"?`)) return;

    try {
      const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showStatus(data.error || "Failed to delete user.", "error");
        return;
      }

      showStatus("User deleted.", "success");
      usernameInput.value = "";
      passwordInput.value = "";
      mfaCheckbox.checked = false;
      await refreshUserList();
    } catch (err) {
      console.error("Delete user failed:", err);
      showStatus("Failed to delete user.", "error");
    }
  });

  resetMfaBtn.addEventListener("click", async () => {
    const username = usernameInput.value.trim();
    if (!username) {
      showStatus("Select a user to reset MFA.", "error");
      return;
    }

    if (!confirm(`Reset MFA for "${username}"?`)) return;

    try {
      const res = await fetch(`${WORKER_BASE}/api/users/reset-mfa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      });
      const data = await res.json();

      if (!res.ok || !data.success) {
        showStatus(data.error || "Failed to reset MFA.", "error");
        return;
      }

      showStatus("MFA reset. User will be prompted to re-enroll on next login.", "success");
    } catch (err) {
      console.error("Reset MFA failed:", err);
      showStatus("Failed to reset MFA.", "error");
    }
  });

  async function refreshUserList() {
    try {
      const res = await fetch(`${WORKER_BASE}/api/users/list`);
      const data = await res.json();
      const users = Array.isArray(data.users) ? data.users : [];

      tbody.innerHTML = "";
      users.forEach((u) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
                    <td>${u.username}</td>
                    <td>${u.role}</td>
                    <td>${u.mfaEnabled ? "Yes" : "No"}</td>
                `;
        tr.addEventListener("click", () => {
          usernameInput.value = u.username;
          roleSelect.value = u.role || "view";
          mfaCheckbox.checked = !!u.mfaEnabled;
          passwordInput.value = "";
        });
        tbody.appendChild(tr);
      });
    } catch (err) {
      console.error("Load users failed:", err);
      tbody.innerHTML = `<tr><td colspan="3">Unable to load users.</td></tr>`;
    }
  }

  refreshUserList();
}

/* =============================================================
   9.  LOGOUT
   ============================================================= */

logoutBtn.addEventListener("click", () => {
  ACTIVE_SESSION = null;
  ACTIVE_USERNAME = null;
  ACTIVE_ROLE = null;

  loginTotp.value = "";
  loginTotpWrapper.classList.add("hidden");

  adminView.classList.add("hidden");
  mfaSetupView.classList.add("hidden");
  loginView.classList.remove("hidden");
  loginMsg.textContent = "";
});
