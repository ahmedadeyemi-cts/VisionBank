/* ============================================================
   SECURITY.JS — Upgraded UI + Worker Integration
   VisionBank | Admin Login • MFA • Access Control
   ============================================================ */

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

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


const auditLogBox = document.getElementById("audit-log");

const themeToggle = document.getElementById("themeToggle");
const themeToggleIcon = document.getElementById("themeToggleIcon");
const themeToggleText = document.getElementById("themeToggleText");

/* ---------- State ---------- */
let ACTIVE_SESSION = null;
let ACTIVE_USERNAME = null;
let ACTIVE_ROLE = null;

let statusTimer = null;
let userPanelInitialized = false;
let LAST_DELETED_USER = null;

/* =============================================================
   THEME TOGGLE
   ============================================================= */
(function initTheme() {
    const saved = localStorage.getItem("vbTheme");
    if (saved === "dark") {
        document.body.classList.remove("theme-light");
        document.body.classList.add("theme-dark");
        themeToggleIcon.textContent = "☀️";
        themeToggleText.textContent = "Light mode";
    }

    themeToggle.addEventListener("click", () => {
        const dark = document.body.classList.toggle("theme-dark");
        document.body.classList.toggle("theme-light", !dark);
        if (dark) {
            themeToggleIcon.textContent = "☀️";
            themeToggleText.textContent = "Light mode";
            localStorage.setItem("vbTheme", "dark");
        } else {
            themeToggleIcon.textContent = "🌙";
            themeToggleText.textContent = "Dark mode";
            localStorage.setItem("vbTheme", "light");
        }
    });
})();

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
        adminView.insertBefore(bar, adminView.firstChild);
    }

    bar.textContent = msg;
    bar.style.display = "block";

    if (type === "success") {
        bar.style.backgroundColor = "#d4ffd9";
        bar.style.border = "1px solid #22c55e";
        bar.style.color = "#14532d";
    } else if (type === "error") {
        bar.style.backgroundColor = "#fee2e2";
        bar.style.border = "1px solid #ef4444";
        bar.style.color = "#7f1d1d";
    } else {
        bar.style.backgroundColor = "#dbeafe";
        bar.style.border = "1px solid #3b82f6";
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
    await loadIpRulesUI();
    await loadAuditLog();

   setTimeout(() => applyRolePermissions(), 50);

}

/* =============================================================
   ROLE-BASED PERMISSIONS
   ============================================================= */

function applyRolePermissions() {
    const role = ACTIVE_ROLE || "view";
   // MFA reset — ONLY superadmin
const canResetMfa = role === "superadmin";

const resetMfaBtn = document.getElementById("user-reset-mfa-btn");
if (resetMfaBtn) {
    resetMfaBtn.disabled = !canResetMfa;
}
   // CIDR Tester — viewer cannot access
const canUseCidrTester = role !== "view";
const cidrSection = document.getElementById("cidr-tester-section");

if (cidrSection) {
    cidrSection.style.display = canUseCidrTester ? "" : "none";
}

applyRolePermissions()

    // Business Hours: superadmin, admin, analyst can edit
    const canEditHours = role === "superadmin" || role === "admin" || role === "analyst";
    hoursStart.disabled = !canEditHours;
    hoursEnd.disabled = !canEditHours;
    hoursDayChecks.forEach(cb => cb.disabled = !canEditHours);
    const hoursButtons = hoursForm ? hoursForm.querySelectorAll("button, input[type='submit']") : [];
    hoursButtons.forEach(el => el.disabled = !canEditHours);

  // NEW IP RULE MANAGER — only superadmin/admin can edit
const canEditIp = role === "superadmin" || role === "admin";

document.getElementById("ip-add-input").disabled = !canEditIp;
document.getElementById("ip-add-btn").disabled = !canEditIp;
document.getElementById("ip-save-btn").disabled = !canEditIp;

document.querySelectorAll(".ip-remove-btn").forEach(btn => {
    btn.disabled = !canEditIp;
});


    // Logs: superadmin, admin, auditor can view.
    // Logs: superadmin, admin, auditor can view.
const canViewLogs = role === "superadmin" || role === "admin" || role === "auditor";
if (!canViewLogs) {
    auditLogBox.textContent = "You do not have permission to view logs.";
    auditLogBox.classList.add("disabled-section");
}

    // User Management: only superadmin
 // User Management: only superadmin
/* ============================================================
   SAFE USER MGMT INITIALIZER (GLOBAL SCOPE)
   ============================================================ */
function safeInitUserManagement() {
    const audit = document.getElementById("admin-audit-section");

    // DOM not yet ready → retry a moment later
    if (!audit) {
        return setTimeout(safeInitUserManagement, 150);
    }

    // DOM is ready → load the panel
    initUserManagement();
}
// User Management: only superadmin
if (role === "superadmin") {
    safeInitUserManagement();
}
}
/* ============================================================
   AUTO-REFRESH AUDIT LOG — every 5 seconds
   ============================================================ */
function startAuditLogAutoRefresh() {
    if (ACTIVE_ROLE === "analyst" || ACTIVE_ROLE === "view") return;

    loadAuditLog();

    setInterval(() => {
        loadAuditLog();
    }, 5000);
}

document.addEventListener("DOMContentLoaded", startAuditLogAutoRefresh);

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
            cb.checked = Array.isArray(hours.days)
                ? hours.days.includes(Number(cb.value))
                : false;
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
        .filter(cb => cb.checked)
        .map(cb => Number(cb.value));

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
/* =============================================================
   IMPROVED IP ALLOWLIST MANAGER
   ============================================================= */

let IP_RULES = [];
let saving = false;

function classifyRule(rule) {
  if (rule.includes("/")) return "cidr";
  if (rule.includes(":")) return "ipv6";
  return "ipv4";
}

function ruleIcon(rule) {
  switch (classifyRule(rule)) {
    case "ipv4": return "🔵 IPv4";
    case "ipv6": return "🟣 IPv6";
    case "cidr": return "📐 CIDR";
  }
}

function renderIpList() {
  const container = document.getElementById("ip-list");
  container.innerHTML = "";

  IP_RULES.forEach((rule, index) => {
    const div = document.createElement("div");
    div.className = "ip-item fade-in";

    div.innerHTML = `
      <div>
        <span class="ip-item-icon">${ruleIcon(rule)}</span>
        ${rule}
      </div>
      <button class="ip-remove-btn" data-index="${index}">Remove</button>
    `;

    container.appendChild(div);
  });

  document.querySelectorAll(".ip-remove-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      const i = Number(e.target.dataset.index);

      if (!confirm(`Remove rule: ${IP_RULES[i]} ?`)) return;

      IP_RULES.splice(i, 1);
      renderIpList();
      autoSaveRules();
    });
  });
}

async function addRule() {
  const input = document.getElementById("ip-add-input");
  const rule = input.value.trim();
  input.value = "";

  if (!rule) return showStatus("You must enter a valid rule.", "error");

  const res = await fetch(`${WORKER_BASE}/api/validate-ip`, {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ rule })
  });

  const data = await res.json();

  if (!data.valid) {
    return showStatus("Invalid IPv4 / IPv6 / CIDR format", "error");
  }

  if (IP_RULES.includes(rule)) {
    return showStatus("Rule already exists.", "warning");
  }

  IP_RULES.push(rule);
  renderIpList();
  autoSaveRules();
}

document.getElementById("ip-add-btn").onclick = addRule;

async function autoSaveRules() {
  if (saving) return; 
  saving = true;

  showStatus("Saving...", "info");

  const res = await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
    method:"POST",
    headers:{ "Content-Type":"application/json" },
    body: JSON.stringify({ rules: IP_RULES })
  });

  const data = await res.json();
  saving = false;

  if (!res.ok) return showStatus("Failed to save rules.", "error");
  
  showStatus("Saved!", "success");
}

async function loadIpRulesUI() {
  const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`);
  const data = await res.json();

  IP_RULES = data.rules || [];
  renderIpList();
}

loadIpRulesUI().then(() => {
    const rulesTextarea = document.getElementById("ip-rules-textarea");
    if (rulesTextarea) {
        rulesTextarea.value = IP_RULES.join("\n");   // <-- populates tester
    }
});
/* =============================================================
   End of the IP Allow List
   ============================================================= */
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
                .map(ev => {
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
   8.  USER MANAGEMENT (SUPERADMIN ONLY — FULL UPGRADED VERSION)
   ============================================================= */

function initUserManagement() {
    if (userPanelInitialized) return;
    userPanelInitialized = true;

    const section = document.createElement("section");
    section.id = "user-management";
    section.className = "admin-section";
    section.innerHTML = `
        <h3>User Management</h3>

        <div id="user-toast" class="user-toast hidden"></div>

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
                    <button type="button" id="user-undo-btn" class="btn-link hidden">Undo Delete</button>
                </div>
            </div>

            <div class="user-list" style="margin-top:18px;">
                <h3>Existing Users</h3>

                <div id="user-loading" class="user-loading hidden">
                    <div class="spinner"></div>
                    Loading users...
                </div>

                <table id="user-table" border="1" cellpadding="4" cellspacing="0">
                    <thead>
                        <tr><th>Username</th><th>Role</th><th>MFA</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `;

    const adminAuditSection = document.getElementById("admin-audit-section");
    if (adminAuditSection) {
        adminView.insertBefore(section, adminAuditSection);
    } else {
        adminView.appendChild(section);
    }

    const usernameInput = section.querySelector("#user-username");
    const passwordInput = section.querySelector("#user-password");
    const roleSelect = section.querySelector("#user-role");
    const mfaCheckbox = section.querySelector("#user-mfa");

    const saveBtn = section.querySelector("#user-save-btn");
    const deleteBtn = section.querySelector("#user-delete-btn");
    const resetMfaBtn = section.querySelector("#user-reset-mfa-btn");
    const undoBtn = section.querySelector("#user-undo-btn");

    const tbody = section.querySelector("#user-table tbody");
    const toast = section.querySelector("#user-toast");
    const loadingIndicator = section.querySelector("#user-loading");

    function showToast(message, type = "info") {
        toast.textContent = message;
        toast.className = `user-toast ${type}`;
        toast.classList.remove("hidden");

        setTimeout(() => {
            toast.classList.add("hidden");
        }, 3000);
    }

    saveBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const role = roleSelect.value;
        const mfaEnabled = mfaCheckbox.checked;

        if (!username || !password) {
            showToast("Username and password are required.", "error");
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
                showToast(data.error || "Failed to save user.", "error");
                return;
            }

            showToast("User saved successfully!", "success");
            passwordInput.value = "";
            await refreshUserList();

        } catch (err) {
            console.error("Save user failed:", err);
            showToast("Failed to save user.", "error");
        }
    });

    deleteBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim();
        if (!username) {
            showToast("Select a user to delete.", "error");
            return;
        }

        if (!confirm(`Delete user "${username}"?`)) return;

        try {
            LAST_DELETED_USER = { username };

            const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                showToast(data.error || "Failed to delete user.", "error");
                return;
            }

            showToast(`User "${username}" deleted.`, "success");
            undoBtn.classList.remove("hidden");

            usernameInput.value = "";
            passwordInput.value = "";
            mfaCheckbox.checked = false;

            await refreshUserList();

        } catch (err) {
            console.error("Delete user failed:", err);
            showToast("Failed to delete user.", "error");
        }
    });

    undoBtn.addEventListener("click", async () => {
        if (!LAST_DELETED_USER) return;

        const { username } = LAST_DELETED_USER;
        showToast(`Restoring user "${username}"...`, "info");

        try {
            const res = await fetch(`${WORKER_BASE}/api/users/save`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    username,
                    password: "ChangeMeNow!",
                    role: "view",
                    mfaEnabled: false
                }),
            });

            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || "Failed to restore user.", "error");
                return;
            }

            showToast(`User "${username}" restored.`, "success");
            undoBtn.classList.add("hidden");
            LAST_DELETED_USER = null;

            await refreshUserList();

        } catch (err) {
            console.error("Restore user failed:", err);
            showToast("Failed to restore user.", "error");
        }
    });

    resetMfaBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim();
        if (!username) {
            showToast("Select a user to reset MFA.", "error");
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
                showToast(data.error || "Failed to reset MFA.", "error");
                return;
            }

            showToast("MFA reset. User will be prompted to re-enroll on next login.", "success");
        } catch (err) {
            console.error("Reset MFA failed:", err);
            showToast("Failed to reset MFA.", "error");
        }
    });

    async function refreshUserList(retry = 0) {
        loadingIndicator.classList.remove("hidden");

        try {
            const res = await fetch(`${WORKER_BASE}/api/users/list`);
            const data = await res.json();

            if ((!data || !Array.isArray(data.users)) && retry < 3) {
                return setTimeout(() => refreshUserList(retry + 1), 250);
            }

            const users = Array.isArray(data.users) ? data.users : [];
            tbody.innerHTML = "";

            users.forEach((u) => {
                const tr = document.createElement("tr");
                tr.style.opacity = "0";
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
                setTimeout(() => {
                    tr.style.opacity = "1";
                }, 10);
            });

        } catch (err) {
            console.error("User load failed:", err);
            if (retry < 3) {
                return setTimeout(() => refreshUserList(retry + 1), 250);
            }
            tbody.innerHTML = `<tr><td colspan="3" style="text-align:center;">Unable to load users.</td></tr>`;
        } finally {
            setTimeout(() => loadingIndicator.classList.add("hidden"), 200);
        }
    }

    refreshUserList();
}
/* =============================================================
   End of Section 8
   ============================================================= */
/* =============================================================
   10. CIDR TESTER (Enhanced Stable Version)
   ============================================================= */

/* =============================================================
   ADVANCED CIDR / IP TESTER + CIDR RANGE TESTER
   ============================================================= */

document.addEventListener("DOMContentLoaded", () => {

    /* ------------------------------------------------------------
       SHARED HELPER FUNCTIONS (IPv4, IPv6, CIDR expansion)
    ------------------------------------------------------------ */

    function expandIPv6(address) {
        if (!address.includes("::")) {
            return address.split(":").map(p => p.padStart(4, "0")).join(":");
        }

        const [left, right] = address.split("::");
        const leftParts = left ? left.split(":") : [];
        const rightParts = right ? right.split(":") : [];

        const missing = 8 - (leftParts.length + rightParts.length);
        const zeros = Array(missing).fill("0000");

        return [
            ...leftParts.map(p => p.padStart(4, "0")),
            ...zeros,
            ...rightParts.map(p => p.padStart(4, "0"))
        ].join(":");
    }

    function ipv4ToBits(ip) {
        return ip
            .split(".")
            .map(n => Number(n).toString(2).padStart(8, "0"))
            .join("");
    }

    function ipv6ToBits(ip) {
        const full = expandIPv6(ip);
        return full
            .split(":")
            .map(h => parseInt(h, 16).toString(2).padStart(16, "0"))
            .join("");
    }

    function ipToBits(ip) {
        if (ip.includes(".")) return ipv4ToBits(ip);
        if (ip.includes(":")) return ipv6ToBits(ip);
        throw new Error("Invalid IP format: " + ip);
    }

    function parseCIDR(cidr) {
        if (!cidr.includes("/"))
            throw new Error("Not a CIDR: " + cidr);

        const [ip, prefix] = cidr.split("/");
        return { ip, prefix: Number(prefix) };
    }

    /* ============================================================
       UPPER SECTION — CIDR / IP TESTER (Auto-loaded rules)
       ============================================================ */

    const ipInput = document.getElementById("ip-test-input");
    const rulesTextarea = document.getElementById("ip-rules-textarea");
    const runIpBtn = document.getElementById("run-ip-test-btn");
    const resultBox = document.getElementById("ip-test-result");

    if (runIpBtn) {
        runIpBtn.addEventListener("click", () => {
            const ip = ipInput.value.trim();
            const rules = rulesTextarea.value
                .split("\n")
                .map(r => r.trim())
                .filter(r => r);

            if (!ip) {
                return showIpBatchResult("Enter an IP.", []);
            }

            const rows = rules.map(rule => {
                try {
                    if (!rule.includes("/")) {
                        return {
                            rule,
                            match: ip === rule ? "✓" : "✗",
                            type: "IP",
                            note: ip === rule ? "Exact match" : "No match"
                        };
                    }

                    const inside = isIpInCidr(ip, rule);

                    return {
                        rule,
                        match: inside ? "✓" : "✗",
                        type: "CIDR",
                        note: inside ? "Inside range" : "Not inside range"
                    };

                } catch (err) {
                    return {
                        rule,
                        match: "✗",
                        type: "Error",
                        note: err.message
                    };
                }
            });

            showIpBatchResult(ip, rows);
        });
    }

    function isIpInCidr(ip, cidr) {
        const { ip: baseIP, prefix } = parseCIDR(cidr);

        const bitsA = ipToBits(ip);
        const bitsB = ipToBits(baseIP);

        return bitsA.slice(0, prefix) === bitsB.slice(0, prefix);
    }

    function showIpBatchResult(ip, rows) {
        let html = `
            <div style="margin-top:10px; font-weight:700;">
                Results for: <span style="color:#1d4ed8">${ip}</span>
            </div>
            <table style="
                width:100%;
                border-collapse:collapse;
                margin-top:10px;
                font-size:14px;
                animation: fadeIn 0.35s ease;">
                <thead>
                    <tr style="background:#e2e8f0;">
                        <th style="padding:6px; border:1px solid #cbd5e1;">Rule</th>
                        <th style="padding:6px; border:1px solid #cbd5e1;">Match?</th>
                        <th style="padding:6px; border:1px solid #cbd5e1;">Type</th>
                        <th style="padding:6px; border:1px solid #cbd5e1;">Notes</th>
                    </tr>
                </thead>
                <tbody>
        `;

        rows.forEach(r => {
            const bg =
                r.match === "✓" ? "#dcfce7" :
                r.match === "✗" ? "#fee2e2" :
                "#fef9c3";

            html += `
                <tr style="background:${bg};">
                    <td style="padding:6px; border:1px solid #cbd5e1;">${r.rule}</td>
                    <td style="padding:6px; border:1px solid #cbd5e1;">${r.match}</td>
                    <td style="padding:6px; border:1px solid #cbd5e1;">${r.type}</td>
                    <td style="padding:6px; border:1px solid #cbd5e1;">${r.note}</td>
                </tr>
            `;
        });

        html += `</tbody></table>`;

        resultBox.innerHTML = html;
        resultBox.classList.add("cidr-visible");
    }

    /* ============================================================
       LOWER SECTION — CIDR RANGE TESTER (A vs B)
       ============================================================ */

    const cidrA = document.getElementById("cidr-input-a");
    const cidrB = document.getElementById("cidr-input-b");
    const cidrBtn = document.getElementById("cidr-test-btn");
    const cidrResult = document.getElementById("cidr-test-result");

    if (cidrBtn) {
        cidrBtn.addEventListener("click", () => {
            const A = cidrA.value.trim();
            const B = cidrB.value.trim();

            if (!A || !B) {
                return showCidrRangeResult("Enter both values.", "warning");
            }

            try {
                const msg = testCidrRange(A, B);
                showCidrRangeResult(msg.text, msg.type);
            } catch (err) {
                showCidrRangeResult(err.message, "fail");
            }
        });
    }

    function testCidrRange(A, B) {
        const isA_CIDR = A.includes("/");
        const isB_CIDR = B.includes("/");

        if (!isB_CIDR) throw new Error("Value B must be a CIDR.");

        const b = parseCIDR(B);
        const bitsB = ipToBits(b.ip).slice(0, b.prefix);

        if (!isA_CIDR) {
            const bitsA = ipToBits(A).slice(0, b.prefix);
            return bitsA === bitsB
                ? { text: `${A} IS inside ${B}`, type: "pass" }
                : { text: `${A} is NOT inside ${B}`, type: "fail" };
        }

        const a = parseCIDR(A);
        const bitsA = ipToBits(a.ip).slice(0, Math.min(a.prefix, b.prefix));

        return bitsA === bitsB
            ? { text: `${A} IS inside ${B}`, type: "pass" }
            : { text: `${A} is NOT inside ${B}`, type: "fail" };
    }

    function showCidrRangeResult(text, type) {
        cidrResult.textContent = text;

        cidrResult.classList.remove("cidr-pass", "cidr-fail", "cidr-warning");

        if (type === "pass") cidrResult.classList.add("cidr-pass");
        else if (type === "fail") cidrResult.classList.add("cidr-fail");
        else cidrResult.classList.add("cidr-warning");

        cidrResult.classList.add("cidr-visible");
    }

});
// Ensure CIDR tester auto-loads updated rules
document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        const rulesTextarea = document.getElementById("ip-rules-textarea");
        if (rulesTextarea && Array.isArray(IP_RULES)) {
            rulesTextarea.value = IP_RULES.join("\n");
        }
    }, 400); // small delay for UI to build
});
/* =============================================================
   End of Section 10
   ============================================================= */
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
/* =============================================================
   COLLAPSIBLE ADMIN SECTIONS — FIXED & ROBUST
   ============================================================= */

document.addEventListener("click", (e) => {
    const toggle = e.target.closest(".collapse-toggle");
    if (!toggle) return;

    const section = toggle.closest(".admin-section");
    if (!section) return;

    const isCollapsed = section.classList.toggle("collapsed");

    toggle.setAttribute("aria-expanded", String(!isCollapsed));

    const label = toggle.querySelector("span");
    if (label) {
        label.textContent = isCollapsed ? "▸" : "▾";
    }

    toggle.lastChild.textContent = isCollapsed ? " Expand" : " Collapse";
});
/* =============================================================
   EXPAND ALL / COLLAPSE ALL CONTROLS
   ============================================================= */

document.getElementById("expand-all-btn")?.addEventListener("click", () => {
    document.querySelectorAll(".admin-section").forEach(section => {
        section.classList.remove("collapsed");

        const toggle = section.querySelector(".collapse-toggle");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "true");
            const icon = toggle.querySelector("span");
            if (icon) icon.textContent = "▾";
            toggle.lastChild.textContent = " Collapse";
        }
    });
});

document.getElementById("collapse-all-btn")?.addEventListener("click", () => {
    document.querySelectorAll(".admin-section").forEach(section => {
        section.classList.add("collapsed");

        const toggle = section.querySelector(".collapse-toggle");
        if (toggle) {
            toggle.setAttribute("aria-expanded", "false");
            const icon = toggle.querySelector("span");
            if (icon) icon.textContent = "▸";
            toggle.lastChild.textContent = " Expand";
        }
    });
});
