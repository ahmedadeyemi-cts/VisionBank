/* ======================================================================================
   SECURITY.JS — FINAL STABLE FULL BUILD
   VisionBank | Security Admin Console
   Engineer: Ahmed Adeyemi
   ====================================================================================== */

console.log("%cSecurity Console Loaded (FINAL BUILD)", "color:#22c55e; font-size:14px;");

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

/* -----------------------------------------------------------------------------
   DOM ELEMENTS
----------------------------------------------------------------------------- */
const loginView      = document.getElementById("login-view");
const mfaSetupView   = document.getElementById("mfa-setup-view");
const adminView      = document.getElementById("admin-view");

const loginForm      = document.getElementById("login-form");
const loginMsg       = document.getElementById("login-message");
const loginTotpWrap  = document.getElementById("login-totp-wrapper");
const loginTotp      = document.getElementById("login-totp");

const mfaQrImg       = document.getElementById("mfa-qr-img");
const mfaAccount     = document.getElementById("mfa-account");
const mfaSecret      = document.getElementById("mfa-secret");
const mfaCodeInput   = document.getElementById("mfa-code");
const mfaConfirmBtn  = document.getElementById("mfa-confirm-btn");
const mfaCancelBtn   = document.getElementById("mfa-cancel-btn");
const mfaMsg         = document.getElementById("mfa-message");

const logoutBtn      = document.getElementById("logout-btn");

const hoursForm      = document.getElementById("hours-form");
const hoursStart     = document.getElementById("hours-start");
const hoursEnd       = document.getElementById("hours-end");
const hoursDayChecks = document.querySelectorAll(".hours-day");

const auditLogBox    = document.getElementById("audit-log");

const ipAddInput     = document.getElementById("ip-add-input");
const ipAddBtn       = document.getElementById("ip-add-btn");
const ipListEl       = document.getElementById("ip-list");
const ipSaveBtn      = document.getElementById("ip-save-btn");
const testerRules    = document.getElementById("ip-rules-textarea");

let ACTIVE_ROLE = null;
let USER_PANEL_INITIALIZED = false;
let LAST_DELETED_USER = null;
let IP_RULES = [];

/* ======================================================================================
   1. LOGIN + MFA WORKFLOW  (Matches your working logic exactly)
   ====================================================================================== */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    const username = document.getElementById("login-username").value.trim();
    const password = document.getElementById("login-pin").value.trim();
    const totp     = loginTotpWrap.classList.contains("hidden") ? "" : loginTotp.value.trim();

    try {
        const res = await fetch(`${WORKER_BASE}/api/login`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ username, password, totp })
        });

        const data = await res.json();

        if (!res.ok) {
            if (data.requireTotp) {
                loginTotpWrap.classList.remove("hidden");
                loginMsg.textContent = "Enter your 6-digit Microsoft Authenticator code.";
                return;
            }
            loginMsg.textContent = data.error || "Login failed.";
            return;
        }

        if (data.requireMfaSetup) {
            return beginMfaEnrollment(username);
        }

        if (data.success && data.session) {
            ACTIVE_ROLE = data.user?.role || "view";
            loginTotp.value = "";
            loginTotpWrap.classList.add("hidden");
            showAdminView();
            return;
        }

        loginMsg.textContent = "Invalid login.";
    }
    catch (err) {
        console.error(err);
        loginMsg.textContent = "Network error contacting authentication service.";
    }
});

/* -----------------------------------------------------------------------------
   MFA ENROLLMENT
----------------------------------------------------------------------------- */
async function beginMfaEnrollment(username) {
    try {
        const res = await fetch(`${WORKER_BASE}/api/setup-mfa`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ username })
        });

        const data = await res.json();
        if (!res.ok) return loginMsg.textContent = data.error;

        showMfaSetup(data);
    }
    catch (err) {
        console.error(err);
        loginMsg.textContent = "MFA setup failed.";
    }
}

function showMfaSetup(data) {
    loginView.classList.add("hidden");
    adminView.classList.add("hidden");
    mfaSetupView.classList.remove("hidden");

    mfaQrImg.src     = data.qr;
    mfaAccount.value = data.username;
    mfaSecret.value  = data.secret;
    mfaCodeInput.value = "";
}

mfaConfirmBtn.addEventListener("click", async () => {
    const code = mfaCodeInput.value.trim();
    if (!code) {
        mfaMsg.textContent = "Enter the 6-digit code.";
        return;
    }

    try {
        const res = await fetch(`${WORKER_BASE}/api/confirm-mfa`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ username: mfaAccount.value, code })
        });

        const data = await res.json();

        if (!res.ok) {
            mfaMsg.textContent = data.error || "Invalid code.";
            return;
        }

        mfaMsg.textContent = "MFA activated. Please log in again.";

        setTimeout(() => {
            mfaSetupView.classList.add("hidden");
            loginView.classList.remove("hidden");
            loginMsg.textContent = "MFA configured. Log in with password + code.";
        }, 1200);
    }
    catch (err) {
        console.error(err);
        mfaMsg.textContent = "Unable to verify MFA code.";
    }
});

mfaCancelBtn.addEventListener("click", () => {
    mfaSetupView.classList.add("hidden");
    loginView.classList.remove("hidden");
});

/* ======================================================================================
   2. ADMIN VIEW LOADING
   ====================================================================================== */
async function showAdminView() {
    loginView.classList.add("hidden");
    mfaSetupView.classList.add("hidden");
    adminView.classList.remove("hidden");

    await loadBusinessHours();
    await loadIpRulesUI();
    await loadAuditLog();

    setTimeout(applyRolePermissions, 80);
}

/* ======================================================================================
   3. ROLE PERMISSIONS
   ====================================================================================== */
function applyRolePermissions() {
    if (!ACTIVE_ROLE) return;

    const role = ACTIVE_ROLE;

    /* BUSINESS HOURS — editable by superadmin/admin/analyst */
    const canEditHours = ["superadmin","admin","analyst"].includes(role);
    hoursStart.disabled = !canEditHours;
    hoursEnd.disabled   = !canEditHours;
    hoursDayChecks.forEach(cb => cb.disabled = !canEditHours);

    /* IP RULES — only superadmin/admin */
    const canEditIp = ["superadmin","admin"].includes(role);
    document.getElementById("ip-add-input").disabled = !canEditIp;
    document.getElementById("ip-add-btn").disabled   = !canEditIp;
    document.getElementById("ip-save-btn").disabled  = !canEditIp;
    document.querySelectorAll(".ip-remove-btn").forEach(btn => btn.disabled = !canEditIp);

    /* USER MANAGEMENT — superadmin only */
    if (role === "superadmin") {
        safeInitUserManagement();
    }
}

/* ======================================================================================
   4. SAFE USER MANAGEMENT INITIALIZATION
   ====================================================================================== */
function safeInitUserManagement() {
    if (USER_PANEL_INITIALIZED) return;

    const auditSec = document.getElementById("admin-audit-section");
    if (!auditSec) return setTimeout(safeInitUserManagement, 120);

    initUserManagement();
}

/* ======================================================================================
   5. USER MANAGEMENT — EXACT WORKING VERSION (unchanged)
   ====================================================================================== */

function initUserManagement() {
    if (USER_PANEL_INITIALIZED) return;
    USER_PANEL_INITIALIZED = true;

    const section = document.createElement("section");
    section.className = "admin-section";
    section.id = "user-management";

    section.innerHTML = `
        <h3>User Management</h3>
        <div id="user-toast" class="user-toast hidden"></div>

        <div class="user-mgmt">
            <div class="user-form">
                <label>Username<br><input type="text" id="user-username"></label><br>
                <label>Password<br><input type="password" id="user-password"></label><br>
                <label>Role<br>
                    <select id="user-role">
                        <option value="superadmin">Super Admin</option>
                        <option value="admin">Admin</option>
                        <option value="analyst">Analyst</option>
                        <option value="auditor">Auditor</option>
                        <option value="view">View</option>
                    </select>
                </label><br>
                <label><input type="checkbox" id="user-mfa"> MFA Enabled</label>

                <div class="user-buttons">
                    <button id="user-save-btn" class="btn-primary">Add / Update User</button>
                    <button id="user-delete-btn" class="btn-secondary">Delete User</button>
                    <button id="user-reset-mfa-btn" class="btn-secondary">Reset MFA</button>
                    <button id="user-undo-btn" class="btn-link hidden">Undo Delete</button>
                </div>
            </div>

            <div class="user-list">
                <h3>Existing Users</h3>

                <div id="user-loading" class="user-loading hidden">
                    <div class="spinner"></div>
                    Loading users...
                </div>

                <table id="user-table">
                    <thead>
                        <tr><th>Username</th><th>Role</th><th>MFA</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `;

    const auditSec = document.getElementById("admin-audit-section");
    adminView.insertBefore(section, auditSec);

    setupUserEvents(section);
    refreshUserList(section);
}

function setupUserEvents(section) {
    const usernameInput = section.querySelector("#user-username");
    const passwordInput = section.querySelector("#user-password");
    const roleSelect    = section.querySelector("#user-role");
    const mfaCheckbox   = section.querySelector("#user-mfa");

    const saveBtn   = section.querySelector("#user-save-btn");
    const delBtn    = section.querySelector("#user-delete-btn");
    const resetMfa  = section.querySelector("#user-reset-mfa-btn");
    const undoBtn   = section.querySelector("#user-undo-btn");

    const toast     = section.querySelector("#user-toast");

    function showToast(msg, type="info") {
        toast.textContent = msg;
        toast.className = `user-toast ${type}`;
        toast.classList.remove("hidden");
        setTimeout(() => toast.classList.add("hidden"), 2500);
    }

    /* SAVE USER */
    saveBtn.onclick = async () => {
        const username = usernameInput.value.trim();
        const password = passwordInput.value.trim();
        const role     = roleSelect.value;
        const mfaEnabled = mfaCheckbox.checked;

        if (!username || !password) return showToast("Username + Password required","error");

        const res = await fetch(`${WORKER_BASE}/api/users/save`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ username, password, role, mfaEnabled })
        });

        const data = await res.json();
        if (!res.ok || !data.success) return showToast(data.error || "Failed","error");

        showToast("User saved","success");
        passwordInput.value = "";
        refreshUserList(section);
    };

    /* DELETE USER */
    delBtn.onclick = async () => {
        const username = usernameInput.value.trim();
        if (!username) return showToast("Select user","error");
        if (!confirm(`Delete user ${username}?`)) return;

        LAST_DELETED_USER = { username };

        const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ username })
        });

        const data = await res.json();
        if (!res.ok || !data.success) return showToast(data.error || "Failed","error");

        showToast("User deleted","success");
        undoBtn.classList.remove("hidden");
        usernameInput.value = "";
        passwordInput.value = "";
        mfaCheckbox.checked = false;

        refreshUserList(section);
    };

    /* RESET MFA */
    resetMfa.onclick = async () => {
        const username = usernameInput.value.trim();
        if (!username) return showToast("Select user","error");

        if (!confirm(`Reset MFA for ${username}?`)) return;

        const res = await fetch(`${WORKER_BASE}/api/users/reset-mfa`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ username })
        });

        const data = await res.json();
        if (!res.ok || !data.success) return showToast(data.error || "Failed","error");

        showToast("MFA reset; user will re-enroll on next login","success");
    };

    /* UNDO DELETE */
    undoBtn.onclick = async () => {
        if (!LAST_DELETED_USER) return;

        const username = LAST_DELETED_USER.username;

        const res = await fetch(`${WORKER_BASE}/api/users/save`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({
                username,
                password:"ChangeMeNow!",
                role:"view",
                mfaEnabled:false
            })
        });

        const data = await res.json();
        if (!res.ok || !data.success) return showToast(data.error || "Failed","error");

        showToast("User restored","success");
        undoBtn.classList.add("hidden");
        LAST_DELETED_USER = null;

        refreshUserList(section);
    };
}

async function refreshUserList(section, retry = 0) {
    const loader = section.querySelector("#user-loading");
    const tbody  = section.querySelector("#user-table tbody");

    loader.classList.remove("hidden");
    tbody.innerHTML = "";

    try {
        const res = await fetch(`${WORKER_BASE}/api/users/list`);
        const data = await res.json();

        if (!data.users && retry < 3) {
            return setTimeout(() => refreshUserList(section, retry+1), 200);
        }

        const users = data.users || [];

        users.forEach((u) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${u.username}</td>
                <td>${u.role}</td>
                <td>${u.mfaEnabled ? "Yes" : "No"}</td>
            `;

            tr.addEventListener("click", () => {
                section.querySelector("#user-username").value = u.username;
                section.querySelector("#user-password").value = "";
                section.querySelector("#user-role").value = u.role;
                section.querySelector("#user-mfa").checked = !!u.mfaEnabled;
            });

            tbody.appendChild(tr);
        });

    }
    catch (err) {
        console.error("User load failed:", err);

        if (retry < 3) {
            return setTimeout(() => refreshUserList(section, retry+1), 200);
        }

        tbody.innerHTML = `<tr><td colspan="3">Unable to load users.</td></tr>`;
    }

    loader.classList.add("hidden");
}

/* ======================================================================================
   6. BUSINESS HOURS
   ====================================================================================== */

async function loadBusinessHours() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-hours`);
        const hours = await res.json();

        hoursStart.value = hours.start || "";
        hoursEnd.value   = hours.end || "";

        hoursDayChecks.forEach(cb => {
            cb.checked = Array.isArray(hours.days)
                ? hours.days.includes(Number(cb.value))
                : false;
        });
    }
    catch (err) {
        console.error("Failed to load hours:", err);
    }
}

hoursForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const start = hoursStart.value;
    const end   = hoursEnd.value;
    const days  = [...hoursDayChecks].filter(cb => cb.checked).map(cb => Number(cb.value));

    try {
        const res = await fetch(`${WORKER_BASE}/api/set-hours`, {
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body: JSON.stringify({ start, end, days })
        });

        if (!res.ok) return showStatus("Failed to save business hours","error");

        showStatus("Business hours saved","success");
    }
    catch (err) {
        console.error(err);
        showStatus("Business hours save error","error");
    }
});

/* ======================================================================================
   7. IP ALLOWLIST (WORKING VERSION)
   ====================================================================================== */

function classifyRule(r) {
    if (r.includes("/")) return "cidr";
    if (r.includes(":")) return "ipv6";
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
    ipListEl.innerHTML = "";

    IP_RULES.forEach((rule, index) => {
        const div = document.createElement("div");
        div.className = "ip-item fade-in";

        div.innerHTML = `
            <div><span class="ip-item-icon">${ruleIcon(rule)}</span> ${rule}</div>
            <button class="ip-remove-btn" data-index="${index}">Remove</button>
        `;

        ipListEl.appendChild(div);
    });

    document.querySelectorAll(".ip-remove-btn").forEach(btn => {
        btn.onclick = () => {
            const i = Number(btn.dataset.index);
            if (!confirm(`Remove rule: ${IP_RULES[i]}?`)) return;

            IP_RULES.splice(i,1);
            renderIpList();
            autoSaveRules();
        };
    });
}

async function loadIpRulesUI() {
    const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`);
    const data = await res.json();

    IP_RULES = data.rules || [];
    renderIpList();

    if (testerRules) testerRules.value = IP_RULES.join("\n");
}

ipAddBtn.onclick = async () => {
    const rule = ipAddInput.value.trim();
    ipAddInput.value = "";

    if (!rule) return showStatus("Enter a valid rule","error");

    const res = await fetch(`${WORKER_BASE}/api/validate-ip`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ rule })
    });

    const data = await res.json();
    if (!data.valid) return showStatus("Invalid IPv4 / IPv6 / CIDR","error");

    if (IP_RULES.includes(rule)) return showStatus("Rule already exists","warning");

    IP_RULES.push(rule);
    renderIpList();
    autoSaveRules();
};

async function autoSaveRules() {
    const res = await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ rules: IP_RULES })
    });

    const data = await res.json();
    if (!res.ok) return showStatus("Save failed","error");

    showStatus("IP rules saved","success");
}

/* ======================================================================================
   8. CIDR / IP TESTER
   ====================================================================================== */

function ipToBigInt(ip) {
    if (ip.includes(".")) {
        return ip.split(".").reduce((acc,o)=>(acc<<8n)+BigInt(o),0n);
    }
    const parts = ip.split("::");
    const left = parts[0].split(":").filter(Boolean);
    const right = parts[1] ? parts[1].split(":") : [];
    const missing = 8 - (left.length + right.length);
    const full = [...left, ...Array(missing).fill("0"), ...right]
        .map(h=>BigInt(parseInt(h,16)));
    return full.reduce((acc,x)=>(acc<<16n)+x,0n);
}

function isIpInCidr(ip,cidr) {
    const [range,bits] = cidr.split("/");
    const prefix = BigInt(bits);

    const ipN = ipToBigInt(ip);
    const rN  = ipToBigInt(range);

    const total = ip.includes(".") ? 32n : 128n;
    const mask = (~0n << (total-prefix));

    return (ipN & mask) === (rN & mask);
}

document.getElementById("run-ip-test-btn").onclick = () => {
    const ip = document.getElementById("ip-test-input").value.trim();
    const rules = testerRules.value.split("\n").map(r=>r.trim()).filter(Boolean);

    const box = document.getElementById("ip-test-result");

    if (!ip) {
        box.textContent = "Enter an IP.";
        box.className = "cidr-result-box cidr-fail";
        return;
    }

    for (const r of rules) {
        if (r.includes("/")) {
            if (isIpInCidr(ip,r)) {
                box.textContent = `✓ Allowed (matched ${r})`;
                box.className = "cidr-result-box cidr-pass";
                return;
            }
        } else if (r === ip) {
            box.textContent = `✓ Allowed (exact match)`;
            box.className = "cidr-result-box cidr-pass";
            return;
        }
    }

    box.textContent = "✖ Not allowed.";
    box.className = "cidr-result-box cidr-fail";
};

/* ======================================================================================
   9. AUDIT LOGS
   ====================================================================================== */

async function loadAuditLog() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/logs`);
        const data = await res.json();
        const events = Array.isArray(data.events) ? data.events : [];

        auditLogBox.textContent = events
            .map(ev => {
                return `${ev.time || ""} | ${ev.ip || ""} | ${ev.path || ""} | ${ev.allowed ? "ALLOWED" : "DENIED"} | ${ev.reason || ""}`;
            })
            .join("\n") || "No logs yet.";
    }
    catch (err) {
        auditLogBox.textContent = "Unable to load logs.";
        console.error(err);
    }
}

setInterval(loadAuditLog,5000);

/* ======================================================================================
   10. LOGOUT
   ====================================================================================== */

logoutBtn.onclick = () => {
    ACTIVE_ROLE = null;
    USER_PANEL_INITIALIZED = false;
    loginTotp.value = "";

    loginView.classList.remove("hidden");
    mfaSetupView.classList.add("hidden");
    adminView.classList.add("hidden");
    loginMsg.textContent = "";
};

/* ======================================================================================
   END OF FINAL FILE
   ====================================================================================== */
