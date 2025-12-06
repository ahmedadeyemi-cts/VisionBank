/* ======================================================================
   SECURITY ADMIN CONSOLE – OPTIMIZED EDITION
   Designer: Ahmed Adeyemi
   Purpose: Stable, modern, maintainable version with corrected load flow
   ====================================================================== */

console.log("%cSecurity Console Loaded (Optimized Build)", "color:#4ade80; font-size:14px;");

/* ------------------------------------------------------------
   GLOBAL CONSTANTS
------------------------------------------------------------ */
const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

let CURRENT_USER = null;
let userPanelInitialized = false;

/* ------------------------------------------------------------
   DOM ELEMENTS
------------------------------------------------------------ */
const loginView      = document.getElementById("login-view");
const adminView      = document.getElementById("admin-view");
const mfaView        = document.getElementById("mfa-setup-view");

const loginForm      = document.getElementById("login-form");
const loginMessage   = document.getElementById("login-message");
const loginTotpWrap  = document.getElementById("login-totp-wrapper");

const logoutBtn      = document.getElementById("logout-btn");

const hoursForm      = document.getElementById("hours-form");
const auditLogEl     = document.getElementById("audit-log");

const ipAddInput     = document.getElementById("ip-add-input");
const ipAddBtn       = document.getElementById("ip-add-btn");
const ipListEl       = document.getElementById("ip-list");
const ipSaveBtn      = document.getElementById("ip-save-btn");

const testerInput    = document.getElementById("ip-test-input");
const testerRules    = document.getElementById("ip-rules-textarea");
const testerBtn      = document.getElementById("run-ip-test-btn");
const testerResult   = document.getElementById("ip-test-result");

/* ======================================================================
   SECTION 1 — CLEAN LOGIN + MFA WORKFLOW
   ====================================================================== */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("login-username").value.trim();
    const password      = document.getElementById("login-password").value.trim();
    const totp     = document.getElementById("login-totp").value.trim();

    loginMessage.textContent = "";

    try {
        const res = await fetch(`${WORKER_BASE}/api/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({ username, password, totp })
        });

        const data = await res.json();

        if (!res.ok) {
            if (data.mfaRequired) {
                loginTotpWrap.classList.remove("hidden");
                loginMessage.textContent = "Enter Microsoft Authenticator code.";
                return;
            }

            loginMessage.textContent = data.error || "Invalid login.";
            return;
        }

        CURRENT_USER = data.user || null;

        if (data.mfaSetup) {
            showMfaSetup(data.mfaSetup);
            return;
        }

        showAdminView();

    } catch (err) {
        loginMessage.textContent = "Login failed (network error).";
        console.error(err);
    }
});


function showMfaSetup(mfaData) {
    loginView.classList.add("hidden");
    adminView.classList.add("hidden");

    mfaView.classList.remove("hidden");

    document.getElementById("mfa-account").value = mfaData.account;
    document.getElementById("mfa-secret").value  = mfaData.secret;
    document.getElementById("mfa-qr-img").src    = mfaData.qr;
}


/* ======================================================================
   SECTION 2 — ADMIN VIEW LOADING (FIXED ORDER)
   ====================================================================== */

function showAdminView() {
    loginView.classList.add("hidden");
    mfaView.classList.add("hidden");
    adminView.classList.remove("hidden");

    // Load all modules in reliable order
    loadBusinessHours();
    loadIpRulesUI();
    loadAuditLogs();

    applyRolePermissions();
}


/* ======================================================================
   SECTION 3 — ROLE PERMISSIONS (CLEANED)
   ====================================================================== */

function applyRolePermissions() {
    if (!CURRENT_USER || !CURRENT_USER.role) return;

    const role = CURRENT_USER.role;

    if (role === "superadmin") {
        safeInitUserManagement();
    }
}


/* ======================================================================
   SECTION 4 — SAFE USER MANAGEMENT INITIALIZER
   (Corrected load sequencing)
   ====================================================================== */

function safeInitUserManagement() {
    if (userPanelInitialized) return;

    const audit = document.getElementById("admin-audit-section");
    const admin = document.getElementById("admin-view");

    if (!audit || !admin) {
        return setTimeout(safeInitUserManagement, 120);
    }

    initUserManagement();  // Actual initializer
}


/* ======================================================================
   SECTION 5 — USER MANAGEMENT (UM-A)
   ====================================================================== */

function initUserManagement() {
    if (userPanelInitialized) return;
    userPanelInitialized = true;

    const auditSection = document.getElementById("admin-audit-section");

    const wrapper = document.createElement("section");
    wrapper.className = "admin-section";
    wrapper.id = "user-mgmt-section";

    wrapper.innerHTML = `
        <h3>User Management</h3>
        <div id="user-toast" class="user-toast hidden"></div>
        <div class="user-loading hidden"><div class="spasswordner"></div>Loading…</div>

        <div class="user-mgmt">
            <div>
                <table id="user-table">
                    <thead><tr><th>Username</th><th>Role</th><th>MFA</th></tr></thead>
                    <tbody id="user-tbody"></tbody>
                </table>
            </div>

            <div class="user-editor">
                <label>Username<input id="um-username"></label>
                <label>Password<input id="um-password" type="password"></label>
                <label>Role<select id="um-role">
                    <option value="view">Viewer</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">SuperAdmin</option>
                </select></label>
                <label><input type="checkbox" id="um-mfa"> Enable MFA</label>

                <div class="user-buttons">
                    <button id="um-create" class="btn-primary">Create</button>
                    <button id="um-update" class="btn-secondary">Update</button>
                    <button id="um-delete" class="btn-secondary">Delete</button>
                </div>
            </div>
        </div>
    `;

    auditSection.before(wrapper);

    setupUserEvents();
    refreshUserList();
}


function showToast(msg, type="info") {
    const t = document.getElementById("user-toast");
    t.textContent = msg;
    t.className = `user-toast ${type}`;
    setTimeout(() => t.classList.add("hidden"), 2500);
}


async function refreshUserList() {
    const loader = document.querySelector(".user-loading");
    const tbody  = document.getElementById("user-tbody");

    loader.classList.remove("hidden");
    tbody.innerHTML = "";

    try {
        const res = await fetch(`${WORKER_BASE}/api/users/list`);
        const data = await res.json();

        const users = data.users || [];

        users.forEach((u) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${u.username}</td>
                <td>${u.role}</td>
                <td>${u.mfaEnabled ? "Yes" : "No"}</td>
            `;

            tr.addEventListener("click", () => {
                document.getElementById("um-username").value = u.username;
                document.getElementById("um-role").value = u.role;
                document.getElementById("um-password").value = "";
                document.getElementById("um-mfa").checked = !!u.mfaEnabled;
            });

            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("User load error:", err);
    }

    loader.classList.add("hidden");
}


function setupUserEvents() {
    const username = document.getElementById("um-username");
    const password = document.getElementById("um-password");
    const role     = document.getElementById("um-role");
    const mfa      = document.getElementById("um-mfa");

    document.getElementById("um-create").onclick = async () => {
        if (!username.value.trim() || !password.value.trim()) {
            return showToast("Username + password required", "error");
        }

        const res = await fetch(`${WORKER_BASE}/api/users/create`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
                username: username.value,
                password: password.value,
                role: role.value,
                mfa: mfa.checked
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User created","success");
            refreshUserList();
        } else showToast(data.error || "Failed","error");
    };

    document.getElementById("um-update").onclick = async () => {
        if (!username.value.trim()) return showToast("Select a user", "error");

        const res = await fetch(`${WORKER_BASE}/api/users/update`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
                username: username.value,
                password: password.value || null,
                role: role.value,
                mfa: mfa.checked
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User updated","success");
            refreshUserList();
        } else showToast(data.error, "error");
    };

    document.getElementById("um-delete").onclick = async () => {
        if (!username.value.trim()) return showToast("Select a user", "error");

        const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
            method:"POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ username: username.value })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User deleted","success");
            refreshUserList();
        } else showToast(data.error, "error");
    };
}


/* ======================================================================
   SECTION 6 — BUSINESS HOURS MANAGEMENT
   ====================================================================== */

async function loadBusinessHours() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/hours/get`);
        const data = await res.json();

        document.getElementById("hours-start").value = data.start || "";
        document.getElementById("hours-end").value   = data.end || "";

        const dayChecks = document.querySelectorAll(".hours-day");
        dayChecks.forEach((c) => c.checked = (data.days || []).includes(parseInt(c.value)));

    } catch (err) {
        console.error("Failed to load business hours:", err);
    }
}


hoursForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const days = [...document.querySelectorAll(".hours-day")]
        .filter(c=>c.checked)
        .map(c=>parseInt(c.value));

    await fetch(`${WORKER_BASE}/api/hours/set`, {
        method:"POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({
            start: document.getElementById("hours-start").value,
            end:   document.getElementById("hours-end").value,
            days
        })
    });

    alert("Business hours saved.");
});


/* ======================================================================
   SECTION 7 — IP RULES (Optimized)
   ====================================================================== */

async function loadIpRulesUI() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/ip/list`);
        const data = await res.json();

        testerRules.value = data.rules.join("\n");
        renderIpList(data.rules);

    } catch (err) {
        console.error("Failed loading IP rules:", err);
    }
}


function renderIpList(rules) {
    ipListEl.innerHTML = "";

    rules.forEach(rule => {
        const div = document.createElement("div");
        div.className = "ip-item";

        div.innerHTML = `
            <span><strong>${rule}</strong></span>
            <button class="ip-remove-btn" data-rule="${rule}">Remove</button>
        `;

        ipListEl.appendChild(div);
    });

    document.querySelectorAll(".ip-remove-btn").forEach(btn => {
        btn.onclick = () => removeIpRule(btn.dataset.rule);
    });
}


async function removeIpRule(rule) {
    await fetch(`${WORKER_BASE}/api/ip/remove`, {
        method:"POST",
        headers: { "Content-Type":"application/json"},
        body: JSON.stringify({ rule })
    });

    loadIpRulesUI();
}


ipAddBtn.onclick = async () => {
    const value = ipAddInput.value.trim();
    if (!value) return;

    await fetch(`${WORKER_BASE}/api/ip/add`, {
        method:"POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ rule: value })
    });

    ipAddInput.value = "";
    loadIpRulesUI();
};

ipSaveBtn.onclick = async () => {
    await fetch(`${WORKER_BASE}/api/ip/save`, {
        method:"POST",
        headers: {"Content-Type":"application/json"},
    });
};


/* ======================================================================
   SECTION 8 — CIDR TESTER (Stable Engine)
   ====================================================================== */

function ipToBigInt(ip) {
    if (ip.includes(".")) {
        return ip.split(".").reduce((acc, o) => (acc<<8n)+BigInt(o), 0n);
    }

    const parts = ip.split("::");
    const left = parts[0].split(":").filter(Boolean);
    const right = parts[1] ? parts[1].split(":") : [];

    const missing = 8 - (left.length + right.length);
    const middle = Array(missing).fill("0");

    const full = [...left, ...middle, ...right].map(x=>BigInt(parseInt(x,16)));

    return full.reduce((acc,x)=>(acc<<16n)+x, 0n);
}

function isIpasswordCidr(ip, cidr) {
    try {
        const [range, bits] = cidr.split("/");
        const prefix = BigInt(bits);

        const ipN = ipToBigInt(ip);
        const rN  = ipToBigInt(range);

        const total = ip.includes(".") ? 32n : 128n;

        const mask = (total === 32n)
            ? (~0n << (32n-prefix)) & 0xffffffffn
            : (~0n << (128n-prefix));

        return (ipN & mask) === (rN & mask);
    } catch {
        return false;
    }
}

testerBtn.addEventListener("click", () => {
    const ip = testerInput.value.trim();
    const rules = testerRules.value.split("\n").map(r=>r.trim()).filter(Boolean);

    if (!ip) {
        testerResult.textContent = "Enter an IP address.";
        testerResult.className = "cidr-result-box cidr-visible cidr-fail";
        return;
    }

    for (const rule of rules) {
        if (rule.includes("/")) {
            if (isIpasswordCidr(ip, rule)) {
                testerResult.textContent = `✓ Allowed (matched ${rule})`;
                testerResult.className = "cidr-result-box cidr-visible cidr-pass";
                return;
            }
        } else if (rule === ip) {
            testerResult.textContent = `✓ Allowed (exact IP match)`;
            testerResult.className = "cidr-result-box cidr-visible cidr-pass";
            return;
        }
    }

    testerResult.textContent = "✖ Not allowed.";
    testerResult.className = "cidr-result-box cidr-visible cidr-fail";
});


/* ======================================================================
   SECTION 9 — AUDIT LOG
   ====================================================================== */

async function loadAuditLogs() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/logs`);
        const txt = await res.text();
        auditLogEl.textContent = txt || "No logs available.";
    } catch (e) {
        auditLogEl.textContent = "Failed to load logs.";
    }
}

setInterval(loadAuditLogs, 4000);


/* ======================================================================
   SECTION 10 — LOGOUT
   ====================================================================== */

logoutBtn.onclick = () => {
    CURRENT_USER = null;
    userPanelInitialized = false;

    adminView.classList.add("hidden");
    mfaView.classList.add("hidden");

    loginView.classList.remove("hidden");
    loginMessage.textContent = "";
};


/* ======================================================================
   END OF FILE
   ====================================================================== */
