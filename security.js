/* ======================================================================
   SECURITY ADMIN CONSOLE – FINAL BUILD (PIN → PASSWORD FIX APPLIED)
   Designer: Ahmed Adeyemi
   ====================================================================== */

console.log("%cSecurity Console Loaded (FINAL BUILD)", "color:#4ade80; font-size:14px;");

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
   SECTION 1 — LOGIN + MFA (PIN → PASSWORD MAPPING)
   ====================================================================== */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("login-username").value.trim();

    // IMPORTANT: map your PIN input to password for Worker.js
    const password = document.getElementById("login-pin").value.trim();

    const totp     = document.getElementById("login-totp").value.trim();

    loginMessage.textContent = "";

    try {
        const res = await fetch(`${WORKER_BASE}/api/login`, {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({
                username,
                password,  // FIXED
                totp
            })
        });

        const data = await res.json();

        if (!res.ok) {
            if (data.requireTotp) {
                loginTotpWrap.classList.remove("hidden");
                loginMessage.textContent = "Enter Microsoft Authenticator code.";
                return;
            }
            if (data.requireMfaSetup) {
                showMfaSetup({ account: username, secret: "Pending", qr: "" });
                return;
            }

            loginMessage.textContent = data.error || "Invalid login.";
            return;
        }

        CURRENT_USER = data.user;

        if (data.requireMfaSetup) {
            showMfaSetup(data.requireMfaSetup);
            return;
        }

        showAdminView();

    } catch (err) {
        console.error(err);
        loginMessage.textContent = "Network error. Try again.";
    }
});


function showMfaSetup(mfaData) {
    loginView.classList.add("hidden");
    adminView.classList.add("hidden");
    mfaView.classList.remove("hidden");

    document.getElementById("mfa-account").value = mfaData.account;
    document.getElementById("mfa-secret").value  = mfaData.secret;
    if (mfaData.qr) document.getElementById("mfa-qr-img").src = mfaData.qr;
}


/* ======================================================================
   SECTION 2 — ADMIN VIEW LOADING
   ====================================================================== */

function showAdminView() {
    loginView.classList.add("hidden");
    mfaView.classList.add("hidden");
    adminView.classList.remove("hidden");

    loadBusinessHours();
    loadIpRulesUI();
    loadAuditLogs();
    applyRolePermissions();
}


/* ======================================================================
   SECTION 3 — ROLE PERMISSIONS
   ====================================================================== */

function applyRolePermissions() {
    if (!CURRENT_USER) return;

    if (CURRENT_USER.role === "superadmin") {
        safeInitUserManagement();
    }
}


/* ======================================================================
   SECTION 4 — SAFE INITIALIZER
   ====================================================================== */

function safeInitUserManagement() {
    if (userPanelInitialized) return;

    const audit = document.getElementById("admin-audit-section");
    if (!audit) return setTimeout(safeInitUserManagement, 100);

    initUserManagement();
}


/* ======================================================================
   SECTION 5 — USER MANAGEMENT ENGINE
   ====================================================================== */

function initUserManagement() {
    if (userPanelInitialized) return;
    userPanelInitialized = true;

    const audit = document.getElementById("admin-audit-section");

    const wrapper = document.createElement("section");
    wrapper.className = "admin-section";
    wrapper.id = "user-mgmt-section";

    wrapper.innerHTML = `
        <h3>User Management</h3>
        <div id="user-toast" class="user-toast hidden"></div>
        <div class="user-loading hidden"><div class="spinner"></div>Loading…</div>

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

    audit.before(wrapper);

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

        (data.users || []).forEach(u => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${u.username}</td>
                <td>${u.role}</td>
                <td>${u.mfaEnabled ? "Yes" : "No"}</td>
            `;

            tr.onclick = () => {
                document.getElementById("um-username").value = u.username;
                document.getElementById("um-role").value = u.role;
                document.getElementById("um-password").value = "";
                document.getElementById("um-mfa").checked = !!u.mfaEnabled;
            };

            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error("User load error:", err);
    }

    loader.classList.add("hidden");
}


function setupUserEvents() {
    const uname = document.getElementById("um-username");
    const pwd   = document.getElementById("um-password");
    const role  = document.getElementById("um-role");
    const mfa   = document.getElementById("um-mfa");

    document.getElementById("um-create").onclick = async () => {
        if (!uname.value || !pwd.value) {
            return showToast("Username + Password required", "error");
        }

        const res = await fetch(`${WORKER_BASE}/api/users/save`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
                username: uname.value,
                password: pwd.value,
                role: role.value,
                mfaEnabled: mfa.checked
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User created","success");
            refreshUserList();
        } else showToast(data.error,"error");
    };

    document.getElementById("um-update").onclick = async () => {
        if (!uname.value) return showToast("Select a user","error");

        const res = await fetch(`${WORKER_BASE}/api/users/save`, {
            method:"POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({
                username: uname.value,
                password: pwd.value || undefined,
                role: role.value,
                mfaEnabled: mfa.checked
            })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User updated","success");
            refreshUserList();
        } else showToast(data.error,"error");
    };

    document.getElementById("um-delete").onclick = async () => {
        if (!uname.value) return showToast("Select a user","error");

        const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
            method: "POST",
            headers: {"Content-Type":"application/json"},
            body: JSON.stringify({ username: uname.value })
        });

        const data = await res.json();
        if (res.ok) {
            showToast("User deleted","success");
            refreshUserList();
        } else showToast(data.error,"error");
    };
}


/* ======================================================================
   SECTION 6 — BUSINESS HOURS
   ====================================================================== */

async function loadBusinessHours() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-hours`);
        const data = await res.json();

        document.getElementById("hours-start").value = data.start;
        document.getElementById("hours-end").value   = data.end;

        document.querySelectorAll(".hours-day").forEach(c => {
            c.checked = (data.days || []).includes(parseInt(c.value));
        });

    } catch (err) {
        console.error("Hours load error:", err);
    }
}


/* ======================================================================
   SECTION 7 — IP RULES
   ====================================================================== */

async function loadIpRulesUI() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`);
        const data = await res.json();

        renderIpList(data.rules || []);
        testerRules.value = (data.rules || []).join("\n");

    } catch (err) {
        console.error("IP rule load error:", err);
    }
}


function renderIpList(rules) {
    ipListEl.innerHTML = "";

    rules.forEach(rule => {
        const row = document.createElement("div");
        row.className = "ip-item";

        row.innerHTML = `
            <span><strong>${rule}</strong></span>
            <button class="ip-remove-btn" data-rule="${rule}">Remove</button>
        `;

        row.querySelector(".ip-remove-btn").onclick = async () => {
            await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
                method:"POST",
                headers: {"Content-Type":"application/json"},
                body: JSON.stringify({ rules: rules.filter(r => r !== rule) })
            });

            loadIpRulesUI();
        };

        ipListEl.appendChild(row);
    });
}


ipAddBtn.onclick = async () => {
    const value = ipAddInput.value.trim();
    if (!value) return;

    const list = testerRules.value.split("\n").filter(x=>x.trim());
    list.push(value);

    await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
        method: "POST",
        headers: {"Content-Type":"application/json"},
        body: JSON.stringify({ rules: list })
    });

    ipAddInput.value = "";
    loadIpRulesUI();
};


/* ======================================================================
   SECTION 8 — CIDR TESTER
   ====================================================================== */

testerBtn.addEventListener("click", () => {
    const ip = testerInput.value.trim();
    const rules = testerRules.value.split("\n").map(r=>r.trim()).filter(Boolean);

    if (!ip) {
        testerResult.textContent = "Enter an IP address.";
        testerResult.className = "cidr-result-box cidr-fail cidr-visible";
        return;
    }

    for (const rule of rules) {
        if (rule.includes("/")) {
            if (isIpInCidr(ip, rule)) {
                testerResult.textContent = `✓ Allowed by ${rule}`;
                testerResult.className = "cidr-result-box cidr-pass cidr-visible";
                return;
            }
        } else if (rule === ip) {
            testerResult.textContent = `✓ Exact IP match`;
            testerResult.className = "cidr-result-box cidr-pass cidr-visible";
            return;
        }
    }

    testerResult.textContent = "✖ Not allowed";
    testerResult.className = "cidr-result-box cidr-fail cidr-visible";
});


function ipToBigInt(ip) {
    if (ip.includes(".")) {
        return ip.split(".").reduce((a, o) => (a<<8n)+BigInt(o), 0n);
    }

    const parts = ip.split("::");
    const left = parts[0].split(":").filter(Boolean);
    const right = parts[1] ? parts[1].split(":") : [];

    const missing = 8 - (left.length + right.length);
    const middle = Array(missing).fill("0");

    const full = [...left, ...middle, ...right].map(x=>BigInt(parseInt(x,16)));

    return full.reduce((a,b)=>(a<<16n)+b, 0n);
}

function isIpInCidr(ip, cidr) {
    const [range, bits] = cidr.split("/");
    const prefix = BigInt(bits);

    const ipN = ipToBigInt(ip);
    const rangeN = ipToBigInt(range);

    const size = ip.includes(".") ? 32n : 128n;
    const mask = (~0n) << (size - prefix);

    return (ipN & mask) === (rangeN & mask);
}


/* ======================================================================
   SECTION 9 — AUDIT LOGS
   ====================================================================== */

async function loadAuditLogs() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/logs`);
        const txt = await res.text();

        auditLogEl.textContent = txt;
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
