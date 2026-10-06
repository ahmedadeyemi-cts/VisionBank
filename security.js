/* ============================================================
   SECURITY.JS — Upgraded UI + Worker Integration
   VisionBank | Admin Login • MFA • Access Control
   ============================================================ */

const WORKER_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
const DEVICE_ADMIN_BASE = `${WORKER_BASE}/api/webex/device-management`;
const VB_SESSION_KEY = "vb_session";
const VB_USER_KEY = "vb_user";
const VB_ROLE_KEY = "vb_role";

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
let ACTIVE_MFA_SETUP_TOKEN = null;

function authHeaders(extra = {}) {
    return {
        ...extra,
        ...(ACTIVE_SESSION ? { Authorization: `Bearer ${ACTIVE_SESSION}` } : {})
    };
}

let statusTimer = null;
let userPanelInitialized = false;
let LAST_DELETED_USER = null;

let auditInterval = null;
let AUDIT_EVENTS = [];
let SECURITY_CONFIG_HISTORY = [];
let ACTIVE_SECURITY_SESSIONS = [];
let CURRENT_CONNECTION = null;
let DEVICE_ADMIN_SETTINGS = null;
let DEVICE_FLEET_KEYS = null;
let LICENSE_CONFIG = null;
let LICENSE_STATUS = null;
let ACTIVE_SECURITY_VIEW = "overview";

function consumePortalReturnTarget() {
    let value = "";
    try {
        value = sessionStorage.getItem("vb_return_to") || "";
        sessionStorage.removeItem("vb_return_to");
    } catch {}
    if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return "";
    if (/\/security(?:\.html)?(?:[?#]|$)/i.test(value)) return "";
    return value;
}

/* =============================================================
   THEME TOGGLE
   ============================================================= */
(function initTheme() {
    const saved = localStorage.getItem("vb_portal_theme") || localStorage.getItem("vbTheme");
    if (saved === "dark" || saved === "light") localStorage.setItem("vb_portal_theme", saved);
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
            localStorage.setItem("vb_portal_theme", "dark");
        } else {
            themeToggleIcon.textContent = "🌙";
            themeToggleText.textContent = "Dark mode";
            localStorage.setItem("vbTheme", "light");
            localStorage.setItem("vb_portal_theme", "light");
        }
    });
})();

/* =============================================================
   STATUS BANNER
   ============================================================= */
function showStatus(msg, type = "info") {
    const bar = document.getElementById("security-console-status");
    if (!bar) return;
    bar.textContent = msg;
    bar.className = `security-console-status visible ${type}`;

    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        bar.className = "security-console-status";
        bar.textContent = "";
    }, 5000);
}


/* =============================================================
   ENTERPRISE SECURITY CONSOLE
   ============================================================= */
const securityText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value == null || value === "" ? "—" : String(value);
};

function roleLabel(role = ACTIVE_ROLE) {
    return ({
        superadmin: "Super Admin",
        admin: "Admin",
        analyst: "Analyst",
        auditor: "Auditor",
        view: "View"
    })[role] || "View";
}

function setSecurityView(view) {
    const requested = String(view || "overview");
    const button = document.querySelector('.security-nav-item[data-security-view="' + requested + '"]');
    if (!button || button.hidden || button.disabled) {
        if (requested !== "overview") return setSecurityView("overview");
        return;
    }

    ACTIVE_SECURITY_VIEW = requested;
    document.querySelectorAll("[data-security-view-panel]").forEach(panel => {
        panel.hidden = panel.dataset.securityViewPanel !== requested;
    });
    document.querySelectorAll(".security-nav-item").forEach(item => {
        const active = item.dataset.securityView === requested;
        item.classList.toggle("active", active);
        item.setAttribute("aria-current", active ? "page" : "false");
    });
}

function applySecurityNavPermissions() {
    const rules = ROLE_RULES[ACTIVE_ROLE] || ROLE_RULES.view;
    const allowed = {
        overview: true,
        identity: true,
        network: true,
        policy: true,
        audit: !!rules.audit,
        tools: !!rules.cidr,
        licensing: true,
        device: !!rules.deviceAdmin
    };

    document.querySelectorAll(".security-nav-item").forEach(item => {
        item.hidden = !allowed[item.dataset.securityView];
    });
    document.querySelectorAll("[data-security-target]").forEach(item => {
        item.hidden = !allowed[item.dataset.securityTarget];
    });

    if (!allowed[ACTIVE_SECURITY_VIEW]) setSecurityView("overview");
}

function initSecurityConsoleNavigation() {
    document.querySelectorAll(".security-nav-item").forEach(button => {
        button.addEventListener("click", () => setSecurityView(button.dataset.securityView));
    });
    document.querySelectorAll("[data-security-target]").forEach(button => {
        button.addEventListener("click", () => setSecurityView(button.dataset.securityTarget));
    });
}

function updateSecuritySessionSummary() {
    securityText("security-session-user", ACTIVE_USERNAME || "Authenticated user");
    securityText("security-session-role", roleLabel());
    securityText("security-overview-role", roleLabel());
    securityText("security-session-state", ACTIVE_SESSION ? "Session active" : "Session unavailable");
}

function selectedBusinessDaysLabel() {
    const labels = {0:"Sun",1:"Mon",2:"Tue",3:"Wed",4:"Thu",5:"Fri",6:"Sat"};
    const days = [...hoursDayChecks].filter(cb => cb.checked).map(cb => labels[Number(cb.value)]).filter(Boolean);
    return days.length ? days.join(", ") : "No active days";
}

function updateSecurityOverview() {
    updateSecuritySessionSummary();

    const start = hoursStart?.value || "";
    const end = hoursEnd?.value || "";
    securityText("security-overview-hours", start && end ? start + "–" + end : "Not configured");
    securityText("security-overview-hours-days", selectedBusinessDaysLabel());

    securityText("security-overview-network", String(IP_RULES.length));
    securityText("security-overview-denied", String(AUDIT_EVENTS.filter(event => event?.allowed === false).length));

    let deviceLabel = "Restricted";
    if (ROLE_RULES[ACTIVE_ROLE]?.deviceAdmin) {
        deviceLabel = DEVICE_ADMIN_SETTINGS
            ? (DEVICE_ADMIN_SETTINGS.verificationEnabled !== false ? "Required" : "Disabled")
            : "Checking…";
    }
    securityText("security-overview-device", deviceLabel);

    let licenseLabel = "Checking…";
    let licenseDetail = "License status has not loaded";
    if (LICENSE_STATUS) {
        if (LICENSE_STATUS.enforcementEnabled !== true) {
            licenseLabel = "Not enforced";
            licenseDetail = LICENSE_STATUS.status === "active"
                ? "Valid license is activated; enforcement is disabled"
                : "Security remains available while licensing is not enforced";
        } else {
            licenseLabel = LICENSE_STATUS.allowed === true ? "Active" : String(LICENSE_STATUS.status || "Required");
            licenseDetail = LICENSE_STATUS.reason || "License enforcement enabled";
        }
    }
    securityText("security-overview-license", licenseLabel);
    securityText("security-overview-license-detail", licenseDetail);

    const protectedState = CURRENT_CONNECTION?.allowed === true && IP_RULES.length > 0 && !!ACTIVE_SESSION;
    securityText("security-overview-posture", protectedState ? "Protected" : "Attention");
    securityText(
        "security-overview-posture-detail",
        protectedState
            ? "Authenticated session and network policy are active"
            : "Review current session or network policy"
    );

    const badge = document.getElementById("security-current-access-badge");
    const networkBadge = document.getElementById("security-network-access-badge");
    for (const el of [badge, networkBadge]) {
        if (!el) continue;
        const allowed = CURRENT_CONNECTION?.allowed === true;
        el.textContent = allowed ? "Approved" : CURRENT_CONNECTION ? "Not approved" : "Checking";
        el.className = "security-state-badge " + (allowed ? "success" : CURRENT_CONNECTION ? "danger" : "neutral");
    }
}

async function loadCurrentConnectionContext() {
    try {
        const res = await fetch(WORKER_BASE + "/security/check", {
            method: "GET",
            mode: "cors",
            credentials: "omit",
            cache: "no-store"
        });
        const data = await res.json();
        CURRENT_CONNECTION = data;
        const info = data?.info || {};
        securityText("security-current-ip", info.primaryIp || "Unknown");
        securityText("security-network-current-ip", info.primaryIp || "Unknown");
        securityText("security-current-network", [info.asOrg, info.asn ? "AS" + info.asn : ""].filter(Boolean).join(" · ") || "Unknown");
        securityText("security-current-location", [info.geo?.city, info.geo?.region, info.geo?.country].filter(Boolean).join(", ") || "Unknown");
        securityText("security-current-service", data.allowed === true ? "Access approved" : "Access " + (data.reason || "not approved"));
    } catch (error) {
        CURRENT_CONNECTION = {allowed:false, error:true};
        securityText("security-current-ip", "Unavailable");
        securityText("security-network-current-ip", "Unavailable");
        securityText("security-current-network", "Unavailable");
        securityText("security-current-location", "Unavailable");
        securityText("security-current-service", "Security check unavailable");
    }
    updateSecurityOverview();
}

async function deviceAdminRequest(path, options = {}) {
    if (!ACTIVE_SESSION) throw new Error("Security session is required.");
    const method = options.method || "GET";
    const body = options.body;
    const res = await fetch(DEVICE_ADMIN_BASE + path, {
        method,
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        headers: authHeaders({
            Accept: "application/json",
            ...(body !== undefined ? {"Content-Type":"application/json"} : {})
        }),
        ...(body !== undefined ? {body: JSON.stringify(body)} : {})
    });
    let data = {};
    try { data = await res.json(); } catch {}
    if (!res.ok || data.success === false) {
        const error = new Error(data.error || data.message || "HTTP " + res.status);
        error.code = data.error || "";
        error.status = res.status;
        error.details = data;
        throw error;
    }
    return data;
}

function securityAdminRow(primary, secondary, buttonText, handler, disabled = false) {
    const row = document.createElement("div");
    row.className = "security-admin-row";
    const copy = document.createElement("div");
    const strong = document.createElement("strong");
    strong.textContent = primary;
    const meta = document.createElement("span");
    meta.textContent = secondary;
    copy.append(strong, meta);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn-secondary small";
    button.textContent = buttonText;
    button.disabled = disabled;
    button.addEventListener("click", handler);
    row.append(copy, button);
    return row;
}

function renderDeviceAdminSettings() {
    const settings = DEVICE_ADMIN_SETTINGS || {};
    const toggle = document.getElementById("security-device-verification-toggle");
    const toggleLabel = document.getElementById("security-device-verification-label");
    if (toggle) toggle.checked = settings.verificationEnabled !== false;
    if (toggleLabel) toggleLabel.textContent = settings.verificationEnabled !== false ? "On" : "Off";

    const defaultHours = document.getElementById("security-device-default-hours");
    if (defaultHours) defaultHours.value = String(settings.defaultVerificationHours || 24);

    const durationList = document.getElementById("security-device-duration-list");
    if (durationList) {
        durationList.replaceChildren();
        const overrides = settings.verificationHoursByEmail && typeof settings.verificationHoursByEmail === "object"
            ? Object.entries(settings.verificationHoursByEmail).sort(([a],[b]) => a.localeCompare(b))
            : [];
        if (!overrides.length) {
            const empty = document.createElement("div");
            empty.className = "security-admin-empty";
            empty.textContent = "No per-user duration overrides. Everyone uses the default.";
            durationList.appendChild(empty);
        } else {
            for (const [email, hours] of overrides) {
                durationList.appendChild(securityAdminRow(
                    email,
                    String(hours) + " hour" + (Number(hours) === 1 ? "" : "s") + " before re-verification",
                    "Use Default",
                    () => void removeDeviceDuration(email)
                ));
            }
        }
    }

    const adminList = document.getElementById("security-device-admin-list");
    if (adminList) {
        adminList.replaceChildren();
        const admins = Array.isArray(settings.admins) ? settings.admins : [];
        const shared = new Set(Array.isArray(settings.sharedMailboxes) ? settings.sharedMailboxes : []);
        const current = settings.currentAdmin?.email || "";
        if (!admins.length) {
            const empty = document.createElement("div");
            empty.className = "security-admin-empty";
            empty.textContent = "No Device Manager admins are configured.";
            adminList.appendChild(empty);
        } else {
            for (const email of admins) {
                const isCurrent = email === current;
                const detail = (shared.has(email) ? "Shared Tech Admin mailbox" : "Individual admin") + (isCurrent ? " · Current admin" : "");
                adminList.appendChild(securityAdminRow(
                    email,
                    detail,
                    "Remove",
                    () => void removeDeviceAdmin(email),
                    isCurrent
                ));
            }
        }
    }

    securityText(
        "security-device-settings-state",
        settings.updatedAt
            ? "Last updated " + new Date(settings.updatedAt).toLocaleString() + " by " + (settings.updatedBy || "an admin") + "."
            : "Device Manager security policy loaded."
    );
    updateSecurityOverview();
}

function securityFleetWhen(value) {
    if (!value) return "Never";
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? String(value) : at.toLocaleString();
}

function renderSecurityFleetKeys() {
    const data = DEVICE_FLEET_KEYS || {};
    const active = data.active || null;
    securityText("security-fleet-active-key", active?.key || "Not configured");
    securityText("security-fleet-generated-at", securityFleetWhen(active?.generatedAt));
    securityText("security-fleet-generated-by", active?.generatedBy || "—");
    securityText("security-fleet-last-used", securityFleetWhen(active?.lastUsedAt));
    securityText("security-fleet-use-count", String(active?.useCount ?? 0));
    const template = document.getElementById("security-fleet-template-url");
    if (template) template.value = data.templateUrl || "";
    const copyKey = document.getElementById("security-fleet-copy-key");
    if (copyKey) copyKey.disabled = !active?.key;
    const copyTemplate = document.getElementById("security-fleet-copy-template");
    if (copyTemplate) copyTemplate.disabled = !data.templateUrl;

    const tbody = document.getElementById("security-fleet-rows");
    if (tbody) {
        tbody.replaceChildren();
        const rows = Array.isArray(data.keys) ? data.keys : [];
        if (!rows.length) {
            const tr = document.createElement("tr"), td = document.createElement("td");
            td.colSpan = 7; td.textContent = "No Fleet Keys have been configured."; tr.appendChild(td); tbody.appendChild(tr);
        } else {
            for (const row of rows) {
                const tr = document.createElement("tr");
                const values = [
                    row.status || "unknown",
                    row.key || row.keyMasked || "Retired",
                    securityFleetWhen(row.generatedAt),
                    row.generatedBy || "—",
                    securityFleetWhen(row.lastUsedAt),
                    String(row.useCount ?? 0),
                    row.validUntil ? securityFleetWhen(row.validUntil) : (row.status === "active" ? "Active" : "—")
                ];
                values.forEach((value, index) => {
                    const td = document.createElement("td");
                    if (index === 1) { const code = document.createElement("code"); code.textContent = value; td.appendChild(code); }
                    else td.textContent = value;
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }
        }
    }
    securityText("security-fleet-state", active
        ? "Active Fleet Key loaded. Rotation history and last-use telemetry are shown below."
        : "No active Fleet Key is configured.");
}

async function loadSecurityFleetKeys() {
    if (!ROLE_RULES[ACTIVE_ROLE]?.deviceAdmin) { DEVICE_FLEET_KEYS = null; return; }
    try {
        securityText("security-fleet-state", "Loading Fleet Key status…");
        DEVICE_FLEET_KEYS = await deviceAdminRequest("/admin-settings/fleet-keys");
        renderSecurityFleetKeys();
    } catch (error) {
        DEVICE_FLEET_KEYS = null;
        securityText("security-fleet-state", "Fleet Key settings unavailable: " + error.message);
    }
}

async function copySecurityFleetValue(value, label) {
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        showStatus(label + " copied.", "success");
    } catch {
        showStatus("Unable to copy automatically. Select the value and copy it manually.", "error");
    }
}

async function rotateSecurityFleetKey() {
    if (!ROLE_RULES[ACTIVE_ROLE]?.deviceAdmin) return;
    const current = DEVICE_FLEET_KEYS?.active;
    const prompt = current
        ? "Generate a new Fleet Key? The current key will remain valid for 24 hours while the Phonism template is updated."
        : "Generate the first Fleet Key for Yealink Phone Self-Service?";
    if (!confirm(prompt)) return;
    const button = document.getElementById("security-fleet-rotate");
    if (button) { button.disabled = true; button.textContent = "Generating…"; }
    try {
        DEVICE_FLEET_KEYS = await deviceAdminRequest("/admin-settings/fleet-keys/rotate", {
            method:"POST", body:{confirm:true, expectedActiveKeyId:DEVICE_FLEET_KEYS?.activeKeyId || null}
        });
        renderSecurityFleetKeys();
        showStatus("New Fleet Key generated. Update the Phonism template during the 24-hour grace period.", "success");
    } catch (error) {
        showStatus("Unable to rotate Fleet Key: " + error.message, "error");
    } finally {
        if (button) { button.disabled = false; button.textContent = "Generate New Fleet Key"; }
    }
}

async function loadDeviceAdminSettings() {
    if (!ROLE_RULES[ACTIVE_ROLE]?.deviceAdmin) {
        DEVICE_ADMIN_SETTINGS = null;
        DEVICE_FLEET_KEYS = null;
        updateSecurityOverview();
        return;
    }
    try {
        securityText("security-device-settings-state", "Loading Device Manager security settings…");
        DEVICE_ADMIN_SETTINGS = await deviceAdminRequest("/admin-settings");
        renderDeviceAdminSettings();
        await loadSecurityFleetKeys();
    } catch (error) {
        DEVICE_ADMIN_SETTINGS = null;
        DEVICE_FLEET_KEYS = null;
        securityText(
            "security-device-settings-state",
            error.code === "device-admin-session-required"
                ? "This Security account is not authorized in the Device Manager admin list."
                : "Device Manager settings unavailable: " + error.message
        );
        updateSecurityOverview();
    }
}

async function updateDeviceVerificationSetting() {
    const toggle = document.getElementById("security-device-verification-toggle");
    if (!toggle || !DEVICE_ADMIN_SETTINGS) return;
    const desired = toggle.checked;
    const previous = DEVICE_ADMIN_SETTINGS.verificationEnabled !== false;
    if (!desired && !confirm("Disable Device Manager email verification? Operators will still be audited, but email verification will no longer be required.")) {
        toggle.checked = previous;
        return;
    }
    toggle.disabled = true;
    try {
        const data = await deviceAdminRequest("/admin-settings/verification", {method:"POST", body:{enabled:desired}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        renderDeviceAdminSettings();
        showStatus("Device Manager email verification " + (desired ? "enabled" : "disabled") + ".", "success");
    } catch (error) {
        toggle.checked = previous;
        showStatus("Unable to update Device Manager verification: " + error.message, "error");
    } finally {
        toggle.disabled = false;
    }
}

async function saveDeviceDefaultHours() {
    const input = document.getElementById("security-device-default-hours");
    const button = document.getElementById("security-device-default-save");
    const hours = Number(input?.value || 0);
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
        return showStatus("Device verification duration must be between 1 and 720 hours.", "error");
    }
    if (button) button.disabled = true;
    try {
        const data = await deviceAdminRequest("/admin-settings/default-hours", {method:"POST", body:{hours}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        renderDeviceAdminSettings();
        showStatus("Default Device Manager verification duration saved.", "success");
    } catch (error) {
        showStatus("Unable to save Device Manager duration: " + error.message, "error");
    } finally {
        if (button) button.disabled = false;
    }
}

async function saveDeviceUserDuration() {
    const emailInput = document.getElementById("security-device-duration-email");
    const hoursInput = document.getElementById("security-device-duration-hours");
    const button = document.getElementById("security-device-duration-save");
    const email = emailInput?.value.trim() || "";
    const hours = Number(hoursInput?.value || 0);
    if (!email) return showStatus("Enter a user email for the verification-duration override.", "error");
    if (!Number.isFinite(hours) || hours < 1 || hours > 720) {
        return showStatus("User verification duration must be between 1 and 720 hours.", "error");
    }
    if (button) button.disabled = true;
    try {
        const data = await deviceAdminRequest("/admin-settings/durations/set", {method:"POST", body:{email,hours}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        if (emailInput) emailInput.value = "";
        if (hoursInput) hoursInput.value = "";
        renderDeviceAdminSettings();
        showStatus("Device Manager user verification duration saved.", "success");
    } catch (error) {
        showStatus("Unable to set user duration: " + error.message, "error");
    } finally {
        if (button) button.disabled = false;
    }
}

async function removeDeviceDuration(email) {
    if (!email) return;
    try {
        const data = await deviceAdminRequest("/admin-settings/durations/remove", {method:"POST", body:{email}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        renderDeviceAdminSettings();
        showStatus("Device Manager user duration returned to the default.", "success");
    } catch (error) {
        showStatus("Unable to remove user duration: " + error.message, "error");
    }
}

async function addDeviceAdmin() {
    const input = document.getElementById("security-device-admin-email");
    const button = document.getElementById("security-device-admin-add");
    const email = input?.value.trim() || "";
    if (!email) return showStatus("Enter an admin email address.", "error");
    if (button) button.disabled = true;
    try {
        const data = await deviceAdminRequest("/admin-settings/admins/add", {method:"POST", body:{email}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        if (input) input.value = "";
        renderDeviceAdminSettings();
        showStatus("Device Manager admin added.", "success");
    } catch (error) {
        showStatus("Unable to add Device Manager admin: " + error.message, "error");
    } finally {
        if (button) button.disabled = false;
    }
}

async function removeDeviceAdmin(email) {
    if (!email || !confirm("Remove " + email + " from Device Manager admins?")) return;
    try {
        const data = await deviceAdminRequest("/admin-settings/admins/remove", {method:"POST", body:{email}});
        DEVICE_ADMIN_SETTINGS = {...DEVICE_ADMIN_SETTINGS, ...data};
        renderDeviceAdminSettings();
        showStatus("Device Manager admin removed.", "success");
    } catch (error) {
        showStatus("Unable to remove Device Manager admin: " + error.message, "error");
    }
}

function bindDeviceAdminControls() {
    document.getElementById("security-device-verification-toggle")?.addEventListener("change", () => void updateDeviceVerificationSetting());
    document.getElementById("security-device-default-save")?.addEventListener("click", () => void saveDeviceDefaultHours());
    document.getElementById("security-device-duration-save")?.addEventListener("click", () => void saveDeviceUserDuration());
    document.getElementById("security-device-admin-add")?.addEventListener("click", () => void addDeviceAdmin());
    document.getElementById("security-fleet-refresh")?.addEventListener("click", () => void loadSecurityFleetKeys());
    document.getElementById("security-fleet-rotate")?.addEventListener("click", () => void rotateSecurityFleetKey());
    document.getElementById("security-fleet-copy-key")?.addEventListener("click", () => void copySecurityFleetValue(DEVICE_FLEET_KEYS?.active?.key || "", "Active Fleet Key"));
    document.getElementById("security-fleet-copy-template")?.addEventListener("click", () => void copySecurityFleetValue(DEVICE_FLEET_KEYS?.templateUrl || "", "Phonism Template URL"));
}

/* =============================================================
   1.  LOGIN HANDLING
   ============================================================= */

loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginMsg.textContent = "";

    const username = document
  .getElementById("login-username")
  .value
  .trim()
  .toLowerCase();
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
            await beginMfaEnrollment(username, data.setupToken);
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
            window.VBPortalSession?.set(ACTIVE_SESSION);
            localStorage.setItem(VB_USER_KEY, username);
            localStorage.setItem(VB_ROLE_KEY, ACTIVE_ROLE);
           
            loginTotp.value = "";
            loginTotpWrapper.classList.add("hidden");
            const params = new URLSearchParams(location.search);
            const licensingRedirect = params.get("view") === "licensing" || params.has("reason");
            const returnTarget = licensingRedirect ? "" : consumePortalReturnTarget();
            if (returnTarget) {
                location.assign(returnTarget);
                return;
            }
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

async function beginMfaEnrollment(username, setupToken) {
    try {
        ACTIVE_MFA_SETUP_TOKEN = setupToken || null;
        const res = await fetch(`${WORKER_BASE}/api/setup-mfa`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, setupToken: ACTIVE_MFA_SETUP_TOKEN }),
        });

        const data = await res.json();

        if (!res.ok) {
            loginMsg.textContent = data.error || "Unable to start MFA setup.";
            return;
        }

        ACTIVE_USERNAME = username;
        showMfaSetup({
            username,
            uri: data.uri,
            secret: data.secret,
        });
    } catch (err) {
        console.error(err);
        loginMsg.textContent = "Network error starting MFA setup.";
    }
}

function renderLocalMfaQr(uri) {
    if (!uri || typeof window.qrcode !== "function") {
        mfaQrImg.removeAttribute("src");
        mfaQrImg.alt = "QR code unavailable. Use the Secret Key shown beside it.";
        return false;
    }

    try {
        const qr = window.qrcode(0, "M");
        qr.addData(String(uri));
        qr.make();
        mfaQrImg.src = qr.createDataURL(5, 4);
        mfaQrImg.alt = "Microsoft Authenticator enrollment QR code";
        return true;
    } catch (err) {
        console.error("Local MFA QR generation failed:", err);
        mfaQrImg.removeAttribute("src");
        mfaQrImg.alt = "QR code unavailable. Use the Secret Key shown beside it.";
        return false;
    }
}

function showMfaSetup(data) {
    loginView.classList.add("hidden");
    adminView.classList.add("hidden");
    mfaSetupView.classList.remove("hidden");

    renderLocalMfaQr(data.uri);
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
            body: JSON.stringify({ username: ACTIVE_USERNAME, code, setupToken: ACTIVE_MFA_SETUP_TOKEN }),
        });

        const data = await res.json();

        if (!res.ok) {
            mfaMsg.textContent = data.error || "Invalid MFA code.";
            return;
        }

        // MFA confirmed: send user back to login to authenticate with password + TOTP
        ACTIVE_MFA_SETUP_TOKEN = null;
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
    ACTIVE_MFA_SETUP_TOKEN = null;
    mfaSetupView.classList.add("hidden");
    loginView.classList.remove("hidden");
});

/* =============================================================
   LICENSING
   ============================================================= */

function licenseHeaders(extra = {}) {
    return authHeaders({"Content-Type":"application/json", ...extra});
}

async function licenseRequest(path, options = {}) {
    const response = await fetch(WORKER_BASE + "/api/license" + path, {
        method: options.method || "GET",
        cache: "no-store",
        headers: licenseHeaders(options.headers || {}),
        ...(options.body !== undefined ? {body: JSON.stringify(options.body)} : {})
    });
    let data = {};
    try { data = await response.json(); } catch {}
    if (!response.ok) {
        const error = new Error(data.error || "license-request-failed");
        error.code = data.error || "license-request-failed";
        error.status = response.status;
        throw error;
    }
    return data;
}

function securityLicenseDate(value) {
    if (!value) return "—";
    const at = new Date(value);
    return Number.isNaN(at.getTime()) ? String(value) : at.toLocaleString();
}

function licenseConfigFromForm(enforcementOverride = null) {
    const current = LICENSE_CONFIG || {};
    return {
        activeSource: document.getElementById("security-license-source")?.value || current.activeSource || "primary",
        installationName: document.getElementById("security-license-installation-name")?.value.trim() || "VisionBank Production",
        enforcementEnabled: enforcementOverride === null
            ? current.enforcementEnabled === true
            : enforcementOverride === true,
        primary: {
            repository: document.getElementById("security-license-primary-repo")?.value.trim() || "",
            authorityUrl: document.getElementById("security-license-primary-url")?.value.trim() || ""
        },
        mirror: {
            repository: document.getElementById("security-license-mirror-repo")?.value.trim() || "",
            authorityUrl: document.getElementById("security-license-mirror-url")?.value.trim() || ""
        },
        custom: {
            repository: document.getElementById("security-license-custom-repo")?.value.trim() || "",
            authorityUrl: document.getElementById("security-license-custom-url")?.value.trim() || ""
        }
    };
}

function renderLicenseConsole() {
    const config = LICENSE_CONFIG || {};
    const status = LICENSE_STATUS || {};
    const canManage = ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin === true;

    const source = document.getElementById("security-license-source");
    if (source) source.value = config.activeSource || "primary";
    const installName = document.getElementById("security-license-installation-name");
    if (installName) installName.value = config.installationName || "VisionBank Production";

    const pairs = [
        ["security-license-primary-repo", config.primary?.repository],
        ["security-license-primary-url", config.primary?.authorityUrl],
        ["security-license-mirror-repo", config.mirror?.repository],
        ["security-license-mirror-url", config.mirror?.authorityUrl],
        ["security-license-custom-repo", config.custom?.repository],
        ["security-license-custom-url", config.custom?.authorityUrl]
    ];
    for (const [id, value] of pairs) {
        const el = document.getElementById(id);
        if (el) el.value = value || "";
    }

    const badge = document.getElementById("security-license-badge");
    const active = status.allowed === true && status.status === "active";
    if (badge) {
        badge.textContent = config.enforcementEnabled !== true
            ? (status.status === "active" ? "Valid · Not Enforced" : "Not Enforced")
            : active ? "Active" : String(status.status || "Required");
        badge.className = "security-state-badge " +
            (config.enforcementEnabled !== true ? "neutral" : active ? "success" : "danger");
    }

    securityText("security-license-status", status.status || "Unlicensed");
    securityText("security-license-customer", status.customerName || "—");
    securityText("security-license-expires", securityLicenseDate(status.expiresAt));
    securityText("security-license-revalidation", securityLicenseDate(status.fullRevalidationAt));
    securityText("security-license-heartbeat", securityLicenseDate(status.lastSuccessfulContactAt || status.lastHeartbeatAt));
    securityText("security-license-next-heartbeat", securityLicenseDate(status.nextHeartbeatAt));
    securityText("security-license-offline-deadline", securityLicenseDate(status.offlineDeadline));
    securityText("security-license-enforcement-state", config.enforcementEnabled === true ? "Enabled" : "Disabled");
    securityText("security-license-active-source", status.activeSource || config.activeSource || "primary");
    securityText("security-license-active-repo", status.repository || config?.[config.activeSource]?.repository || "—");
    securityText("security-license-active-url", status.authorityUrl || config?.[config.activeSource]?.authorityUrl || "—");
    securityText("security-license-system-id", config.systemId || "Generated when settings are first saved");
    securityText("security-license-installation-id", status.installationId || "Not activated");
    securityText("security-license-error", status.lastValidationError || "None");

    const detail = document.getElementById("security-license-status-detail");
    if (detail) {
        if (config.enforcementEnabled !== true) {
            detail.textContent = status.status === "active"
                ? "A valid license is activated. Enforcement is currently disabled."
                : "Licensing is not enforced. Configure an authority and activate a license before enabling enforcement.";
        } else if (status.allowed === true) {
            detail.textContent = status.degraded === true
                ? "License authority validation is due; cached access remains within the configured offline grace window."
                : "License is valid and operational portal access is permitted.";
        } else {
            detail.textContent = "Operational portal access is blocked by license state: " + (status.reason || status.status || "license required") + ". Security remains available.";
        }
    }

    const toggle = document.getElementById("security-license-enforcement-toggle");
    if (toggle) {
        toggle.checked = config.enforcementEnabled === true;
        toggle.disabled = !canManage;
    }
    securityText("security-license-enforcement-label", config.enforcementEnabled === true ? "On" : "Off");

    document.querySelectorAll("[data-license-admin-controls]").forEach(container => {
        container.querySelectorAll?.("input,select,button,textarea").forEach(el => { el.disabled = !canManage; });
        if (container.matches?.("button,input,select,textarea")) container.disabled = !canManage;
    });

    const full = document.getElementById("security-license-full-revalidate");
    if (full) full.disabled = !ACTIVE_SESSION || !status.installationId;
    const refresh = document.getElementById("security-license-refresh");
    if (refresh) refresh.disabled = !ACTIVE_SESSION || !status.installationId;

    updateSecurityOverview();
}

async function loadLicenseConsole() {
    if (!ACTIVE_SESSION) return;
    try {
        const [config, status] = await Promise.all([
            licenseRequest("/config"),
            licenseRequest("/status")
        ]);
        LICENSE_CONFIG = config;
        LICENSE_STATUS = status;
        renderLicenseConsole();
    } catch (error) {
        LICENSE_CONFIG = LICENSE_CONFIG || null;
        LICENSE_STATUS = {
            status:"unavailable",allowed:false,
            reason:error.code || error.message,
            lastValidationError:error.code || error.message
        };
        renderLicenseConsole();
        showStatus("Licensing status unavailable: " + (error.code || error.message), "error");
    }
}

async function saveLicenseAuthoritySettings({enforcementOverride=null, quiet=false} = {}) {
    if (ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true) return;
    const button = document.getElementById("security-license-save-config");
    if (button) button.disabled = true;
    try {
        LICENSE_CONFIG = await licenseRequest("/config", {
            method:"POST",
            body:licenseConfigFromForm(enforcementOverride)
        });
        LICENSE_STATUS = await licenseRequest("/status");
        renderLicenseConsole();
        if (!quiet) showStatus("License authority settings saved.", "success");
        return true;
    } catch (error) {
        renderLicenseConsole();
        if (!quiet) showStatus("Unable to save licensing settings: " + (error.code || error.message), "error");
        return false;
    } finally {
        if (button) button.disabled = ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true;
    }
}

async function testActiveLicenseAuthority() {
    if (ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true) return;
    const saved = await saveLicenseAuthoritySettings({quiet:true});
    if (!saved) return showStatus("Save the authority settings before testing.", "error");
    const button = document.getElementById("security-license-test");
    if (button) button.disabled = true;
    try {
        const data = await licenseRequest("/test", {
            method:"POST",
            body:{source: document.getElementById("security-license-source")?.value || "primary"}
        });
        securityText(
            "security-license-authority-state",
            "Connected to " + (data.service || "license authority") + " via " + (data.authority?.authorityUrl || "configured URL") + "."
        );
        showStatus("License authority connection succeeded.", "success");
    } catch (error) {
        securityText("security-license-authority-state", "Connection failed: " + (error.code || error.message));
        showStatus("License authority test failed.", "error");
    } finally {
        if (button) button.disabled = ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true;
    }
}

async function activateInstallationLicense() {
    if (ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true) return;
    const input = document.getElementById("security-license-key");
    const licenseKey = input?.value.trim() || "";
    if (!licenseKey) return showStatus("Enter a license key.", "error");
    const saved = await saveLicenseAuthoritySettings({quiet:true});
    if (!saved) return;
    const button = document.getElementById("security-license-activate");
    if (button) button.disabled = true;
    try {
        LICENSE_STATUS = await licenseRequest("/activate", {method:"POST",body:{licenseKey}});
        if (input) input.value = "";
        LICENSE_CONFIG = await licenseRequest("/config");
        renderLicenseConsole();
        showStatus("VisionBank license activated successfully.", "success");
    } catch (error) {
        showStatus("License activation failed: " + (error.code || error.message), "error");
    } finally {
        if (button) button.disabled = ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true;
    }
}

async function refreshInstallationLicense(full = false) {
    const button = document.getElementById(full ? "security-license-full-revalidate" : "security-license-refresh");
    if (button) button.disabled = true;
    try {
        LICENSE_STATUS = await licenseRequest("/refresh", {method:"POST",body:{full}});
        LICENSE_CONFIG = await licenseRequest("/config");
        renderLicenseConsole();
        showStatus(full ? "Full license revalidation completed." : "License check completed.", "success");
    } catch (error) {
        showStatus("License validation failed: " + (error.code || error.message), "error");
    } finally {
        renderLicenseConsole();
    }
}

async function updateLicenseEnforcement() {
    const toggle = document.getElementById("security-license-enforcement-toggle");
    if (!toggle || ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true) return;
    const desired = toggle.checked;
    if (desired && !confirm("Enable license enforcement? Once enabled, operational portal pages and APIs will require a valid license. Security remains accessible.")) {
        toggle.checked = false;
        return;
    }
    const previous = LICENSE_CONFIG?.enforcementEnabled === true;
    const saved = await saveLicenseAuthoritySettings({enforcementOverride:desired,quiet:true});
    if (!saved) {
        toggle.checked = previous;
        return showStatus("License enforcement was not changed.", "error");
    }
    renderLicenseConsole();
    showStatus("License enforcement " + (desired ? "enabled" : "disabled") + ".", "success");
}

async function deactivateInstallationLicense() {
    if (ROLE_RULES[ACTIVE_ROLE]?.licenseAdmin !== true) return;
    if (!confirm("Deactivate the local VisionBank license? Enforcement will be disabled so Security remains available for reactivation.")) return;
    try {
        LICENSE_STATUS = await licenseRequest("/deactivate", {method:"POST",body:{}});
        LICENSE_CONFIG = await licenseRequest("/config");
        renderLicenseConsole();
        showStatus("Local license deactivated. Activate a license before re-enabling enforcement.", "success");
    } catch (error) {
        showStatus("Unable to deactivate local license: " + (error.code || error.message), "error");
    }
}

function bindLicenseControls() {
    document.getElementById("security-license-save-config")?.addEventListener("click", () => void saveLicenseAuthoritySettings());
    document.getElementById("security-license-test")?.addEventListener("click", () => void testActiveLicenseAuthority());
    document.getElementById("security-license-activate")?.addEventListener("click", () => void activateInstallationLicense());
    document.getElementById("security-license-refresh")?.addEventListener("click", () => void refreshInstallationLicense(false));
    document.getElementById("security-license-full-revalidate")?.addEventListener("click", () => void refreshInstallationLicense(true));
    document.getElementById("security-license-enforcement-toggle")?.addEventListener("change", () => void updateLicenseEnforcement());
    document.getElementById("security-license-deactivate")?.addEventListener("click", () => void deactivateInstallationLicense());
}

/* =============================================================
   4.  SHOW ADMIN VIEW
   ============================================================= */

async function showAdminView() {
    loginView.classList.add("hidden");
    mfaSetupView.classList.add("hidden");
    adminView.classList.remove("hidden");

    updateSecuritySessionSummary();
    applyRolePermissions();
    setSecurityView("overview");

    await Promise.all([
        loadBusinessHours(),
        loadIpRulesUI(),
        loadAuditLog(),
        loadSecurityConfigHistory(),
        loadActiveSecuritySessions(),
        loadCurrentConnectionContext(),
        loadDeviceAdminSettings(),
        loadLicenseConsole()
    ]);

    updateSecurityOverview();

    const params = new URLSearchParams(location.search);
    if (params.get("view") === "licensing" || params.has("reason")) {
        setSecurityView("licensing");
        if (params.get("reason")) {
            showStatus("Operational portal access requires license attention: " + params.get("reason"), "error");
        }
    }

    if (ROLE_RULES[ACTIVE_ROLE]?.audit) {
        startAuditLogAutoRefresh();
    }
}
/* =============================================================
   ROLE-BASED PERMISSIONS (SINGLE SOURCE OF TRUTH)
   ============================================================= */

function applyRolePermissions() {
  if (!ACTIVE_ROLE) return;

  const role = ACTIVE_ROLE;
  const rules = ROLE_RULES[role] || ROLE_RULES.view;

  toggleSection("admin-audit-section", rules.audit);
  toggleSection("cidr-ip-tester", rules.cidr);
  toggleSection("cidr-range-tester", rules.cidr);
  setReadOnly("admin-hours-section", rules.editHours);
  setReadOnly("ip-manager", rules.editIp);

  document.querySelectorAll("[data-license-admin-controls]").forEach(container => {
    container.querySelectorAll?.("input,select,button,textarea").forEach(el => {
      el.disabled = !rules.licenseAdmin;
    });
    if (container.matches?.("button,input,select,textarea")) container.disabled = !rules.licenseAdmin;
  });

  const restrictedNote = document.getElementById("identity-restricted-note");
  if (restrictedNote) restrictedNote.hidden = role === "superadmin";

  if (role === "superadmin") {
    safeInitUserManagement();
  } else {
    toggleSection("user-management", false);
  }

  applySecurityNavPermissions();
  updateSecuritySessionSummary();
  updateSecurityOverview();
}

const ROLE_RULES = {
  superadmin: {
    userMgmt: true,
    audit: true,
    editHours: true,
    editIp: true,
    cidr: true,
    deviceAdmin: true,
    licenseAdmin: true,
    readOnly: false
  },
  admin: {
    userMgmt: false,
    audit: true,
    editHours: true,
    editIp: true,
    cidr: true,
    deviceAdmin: true,
    licenseAdmin: true,
    readOnly: false
  },
  analyst: {
    userMgmt: false,
    audit: false,
    editHours: true,
    editIp: false,
    cidr: true,
    deviceAdmin: false,
    licenseAdmin: false,
    readOnly: false
  },
  auditor: {
    userMgmt: false,
    audit: true,
    editHours: false,
    editIp: false,
    cidr: true,
    deviceAdmin: false,
    licenseAdmin: false,
    readOnly: true
  },
  view: {
    userMgmt: false,
    audit: false,
    editHours: false,
    editIp: false,
    cidr: false,
    deviceAdmin: false,
    licenseAdmin: false,
    readOnly: true
  }
};

function toggleSection(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? "" : "none";
}

function setReadOnly(sectionId, allowed) {
  const section = document.getElementById(sectionId);
  if (!section) return;

  section.querySelectorAll("input, textarea, select, button").forEach(el => {
    if (el.classList.contains("collapse-toggle")) return;
    el.disabled = !allowed;
  });
}

/* ============================================================
   SAFE USER MGMT INITIALIZER (GLOBAL SCOPE)
   ============================================================ */
function safeInitUserManagement() {
    if (ACTIVE_ROLE !== "superadmin") return;
    const slot = document.getElementById("user-management-slot");
    if (!slot) return setTimeout(safeInitUserManagement, 150);
    initUserManagement();
}

/* ============================================================
   AUTO-REFRESH AUDIT LOG — every 5 seconds
   ============================================================ */
function startAuditLogAutoRefresh() {
  if (!ROLE_RULES[ACTIVE_ROLE]?.audit) return;
  if (auditInterval) return;

  loadAuditLog();
  auditInterval = setInterval(loadAuditLog, 5000);
}

/* =============================================================
   5.  BUSINESS HOURS
   ============================================================= */

async function loadBusinessHours() {
    try {
        const res = await fetch(`${WORKER_BASE}/api/get-hours`, { headers: authHeaders() });
        const hours = await res.json();

        hoursStart.value = hours.start || "";
        hoursEnd.value = hours.end || "";

        hoursDayChecks.forEach((cb) => {
            cb.checked = Array.isArray(hours.days)
                ? hours.days.includes(Number(cb.value))
                : false;
        });
        updateSecurityOverview();
    } catch (err) {
        console.error("Hours load failed:", err);
    }
}

hoursForm.addEventListener("submit", async (e) => {
    e.preventDefault();
  if (!ROLE_RULES[ACTIVE_ROLE]?.editHours) {
    return showStatus("Read-only access.", "error");
  }

  // rest of code stays
    const start = hoursStart.value;
    const end = hoursEnd.value;
    const days = [...hoursDayChecks]
        .filter(cb => cb.checked)
        .map(cb => Number(cb.value));

    try {
        const res = await fetch(`${WORKER_BASE}/api/set-hours`, {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ start, end, days }),
        });

        if (!res.ok) {
            showStatus("Failed to save business hours.", "error");
            return;
        }

        updateSecurityOverview();
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

    const label = document.createElement("div");
    const icon = document.createElement("span");
    icon.className = "ip-item-icon";
    icon.textContent = ruleIcon(rule);
    label.appendChild(icon);
    label.appendChild(document.createTextNode(" " + rule));

    const button = document.createElement("button");
    button.className = "ip-remove-btn";
    button.dataset.index = String(index);
    button.textContent = "Remove";
    button.disabled = !ROLE_RULES[ACTIVE_ROLE]?.editIp;

    div.appendChild(label);
    div.appendChild(button);
    container.appendChild(div);
  });

  document.querySelectorAll(".ip-remove-btn").forEach(btn => {
    btn.addEventListener("click", e => {
      if (!ROLE_RULES[ACTIVE_ROLE]?.editIp) return showStatus("Read-only access.", "error");
      const i = Number(e.target.dataset.index);

      if (IP_RULES.length <= 1) {
        return showStatus("At least one approved network rule must remain.", "error");
      }
      if (!confirm(`Remove rule: ${IP_RULES[i]} ?`)) return;

      IP_RULES.splice(i, 1);
      renderIpList();
      autoSaveRules();
    });
  });

  updateSecurityOverview();
}

async function addRule() {
  const input = document.getElementById("ip-add-input");
  const rule = input.value.trim();
  input.value = "";

  if (!rule) return showStatus("You must enter a valid rule.", "error");

  const res = await fetch(`${WORKER_BASE}/api/validate-ip`, {
    method: "POST",
    headers: authHeaders({"Content-Type":"application/json"}),
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

document.getElementById("ip-add-btn").onclick = () => {
 if (ACTIVE_ROLE !== "admin" && ACTIVE_ROLE !== "superadmin") {
  return showStatus("View-only access.", "error");
}
  addRule();
};

document.getElementById("ip-save-btn")?.addEventListener("click", () => {
  if (!ROLE_RULES[ACTIVE_ROLE]?.editIp) return showStatus("Read-only access.", "error");
  void autoSaveRules();
});


async function autoSaveRules() {
  if (saving) return;
  if (!IP_RULES.length) return showStatus("At least one approved network rule is required.", "error");
  saving = true;

  showStatus("Saving network access rules…", "info");

  try {
    const res = await fetch(`${WORKER_BASE}/api/set-ip-rules`, {
      method:"POST",
      headers:authHeaders({ "Content-Type":"application/json" }),
      body: JSON.stringify({ rules: IP_RULES })
    });

    if (!res.ok) {
      return showStatus("Failed to save network access rules.", "error");
    }

    updateSecurityOverview();
    showStatus("Network access rules saved.", "success");
  } catch (error) {
    console.error("Save IP rules failed:", error);
    showStatus("Failed to save network access rules.", "error");
  } finally {
    saving = false;
  }
}

async function loadIpRulesUI() {
  try {
    const res = await fetch(`${WORKER_BASE}/api/get-ip-rules`, { headers: authHeaders() });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Unable to load IP rules.");

    IP_RULES = Array.isArray(data.rules) ? data.rules : [];
    renderIpList();

    const rulesTextarea = document.getElementById("ip-rules-textarea");
    if (rulesTextarea) rulesTextarea.value = IP_RULES.join("\n");
    updateSecurityOverview();
  } catch (error) {
    console.error("IP rule load failed:", error);
    IP_RULES = [];
    renderIpList();
    showStatus("Unable to load network access rules.", "error");
  }
}

/* =============================================================
   End of the IP Allow List
   ============================================================= */
/* =============================================================
   7.  AUDIT LOG
   ============================================================= */

function renderAuditLog() {
    if (!auditLogBox) return;
    const query = (document.getElementById("audit-filter-query")?.value || "").trim().toLowerCase();
    const outcome = document.getElementById("audit-filter-outcome")?.value || "";

    const events = AUDIT_EVENTS.filter(ev => {
        if (outcome === "allowed" && ev.allowed !== true) return false;
        if (outcome === "denied" && ev.allowed !== false) return false;
        if (!query) return true;
        return [ev.time, ev.ip, ev.path, ev.reason]
            .some(value => String(value || "").toLowerCase().includes(query));
    });

    auditLogBox.textContent = events.map(ev => {
        const allowed = ev.allowed ? "ALLOWED" : "DENIED";
        return [ev.time || "", ev.ip || "", ev.path || "", allowed, ev.reason || ""].join(" | ");
    }).join("\n") || "No matching security events.";
}

async function loadAuditLog() {
    if (!ROLE_RULES[ACTIVE_ROLE]?.audit) {
        AUDIT_EVENTS = [];
        updateSecurityOverview();
        return;
    }
    try {
        const res = await fetch(`${WORKER_BASE}/api/logs`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load logs.");
        AUDIT_EVENTS = Array.isArray(data.events) ? data.events : [];
        renderAuditLog();
        updateSecurityOverview();
    } catch (err) {
        console.error("Log load failed:", err);
        AUDIT_EVENTS = [];
        if (auditLogBox) auditLogBox.textContent = "Unable to load logs.";
        updateSecurityOverview();
    }
}


function securityFormatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
}

function securityTableCell(value) {
    const td = document.createElement("td");
    td.textContent = value == null || value === "" ? "—" : String(value);
    return td;
}

function renderSecurityConfigHistory() {
    const tbody = document.getElementById("security-config-history-body");
    if (!tbody) return;
    tbody.replaceChildren();

    if (!SECURITY_CONFIG_HISTORY.length) {
        const tr = document.createElement("tr");
        const td = securityTableCell("No configuration changes have been recorded yet.");
        td.colSpan = 6;
        td.className = "security-table-empty";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    for (const event of SECURITY_CONFIG_HISTORY) {
        const tr = document.createElement("tr");
        tr.append(
            securityTableCell(securityFormatDate(event.at)),
            securityTableCell(event.actor?.username || "unknown"),
            securityTableCell(String(event.action || "").replaceAll("_", " ")),
            securityTableCell(event.target || "Security"),
            securityTableCell(Array.isArray(event.changes) && event.changes.length ? event.changes.join("; ") : "—"),
            securityTableCell(event.actor?.ip || "unknown")
        );
        tbody.appendChild(tr);
    }
}

async function loadSecurityConfigHistory() {
    const panel = document.getElementById("security-config-history-panel");
    if (!ROLE_RULES[ACTIVE_ROLE]?.audit) {
        SECURITY_CONFIG_HISTORY = [];
        if (panel) panel.hidden = true;
        return;
    }
    if (panel) panel.hidden = false;
    try {
        const res = await fetch(WORKER_BASE + "/api/security/config-history", { headers: authHeaders(), cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load configuration history.");
        SECURITY_CONFIG_HISTORY = Array.isArray(data.events) ? data.events : [];
        renderSecurityConfigHistory();
    } catch (error) {
        console.error("Configuration history load failed:", error);
        SECURITY_CONFIG_HISTORY = [];
        const tbody = document.getElementById("security-config-history-body");
        if (tbody) {
            tbody.replaceChildren();
            const tr = document.createElement("tr");
            const td = securityTableCell("Unable to load configuration history.");
            td.colSpan = 6;
            td.className = "security-table-empty";
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    }
}

function renderActiveSecuritySessions() {
    const tbody = document.getElementById("security-sessions-body");
    if (!tbody) return;
    tbody.replaceChildren();

    if (!ACTIVE_SECURITY_SESSIONS.length) {
        const tr = document.createElement("tr");
        const td = securityTableCell("No indexed active sessions are available yet.");
        td.colSpan = 7;
        td.className = "security-table-empty";
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    for (const session of ACTIVE_SECURITY_SESSIONS) {
        const tr = document.createElement("tr");
        tr.append(
            securityTableCell(session.username || "unknown"),
            securityTableCell(roleLabel(session.role)),
            securityTableCell(securityFormatDate(session.createdAt)),
            securityTableCell(securityFormatDate(session.expiresAt)),
            securityTableCell(session.ip || "unknown"),
            securityTableCell(session.browser || "Unknown")
        );
        const actionCell = document.createElement("td");
        if (session.current) {
            const badge = document.createElement("span");
            badge.className = "security-state-badge success";
            badge.textContent = "Current session";
            actionCell.appendChild(badge);
        } else {
            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn-secondary small";
            button.textContent = "Revoke";
            button.addEventListener("click", () => void revokeSecuritySession(session.fingerprint, session.username));
            actionCell.appendChild(button);
        }
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
    }
}

async function loadActiveSecuritySessions() {
    const panel = document.getElementById("security-active-sessions-panel");
    if (ACTIVE_ROLE !== "superadmin") {
        ACTIVE_SECURITY_SESSIONS = [];
        if (panel) panel.hidden = true;
        return;
    }
    if (panel) panel.hidden = false;
    try {
        const res = await fetch(WORKER_BASE + "/api/security/sessions", { headers: authHeaders(), cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Unable to load active sessions.");
        ACTIVE_SECURITY_SESSIONS = Array.isArray(data.sessions) ? data.sessions : [];
        renderActiveSecuritySessions();
    } catch (error) {
        console.error("Active session load failed:", error);
        ACTIVE_SECURITY_SESSIONS = [];
        const tbody = document.getElementById("security-sessions-body");
        if (tbody) {
            tbody.replaceChildren();
            const tr = document.createElement("tr");
            const td = securityTableCell("Unable to load active sessions.");
            td.colSpan = 7;
            td.className = "security-table-empty";
            tr.appendChild(td);
            tbody.appendChild(tr);
        }
    }
}

async function revokeSecuritySession(fingerprint, username) {
    if (!fingerprint) return;
    if (!confirm("Revoke the active Security session for \"" + (username || "this user") + "\"?")) return;
    try {
        const res = await fetch(WORKER_BASE + "/api/security/sessions/revoke", {
            method: "POST",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ fingerprint })
        });
        const data = await res.json();
        if (!res.ok || !data.success) throw new Error(data.error || "Unable to revoke session.");
        showStatus("Administrative session revoked.", "success");
        await loadActiveSecuritySessions();
        await loadSecurityConfigHistory();
    } catch (error) {
        console.error("Session revoke failed:", error);
        showStatus("Unable to revoke session: " + error.message, "error");
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
                <label>Email<br><input type="email" id="user-email" /></label><br>

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
                <div class="security-user-state"><span>Account status</span><strong id="user-account-status">New account</strong></div>

                <div class="user-buttons" style="margin-top:8px;">
                    <button type="button" id="user-save-btn" class="btn-primary">Add / Update User</button>
                    <button type="button" id="user-status-btn" class="btn-secondary" disabled>Disable Account</button>
                    <button type="button" id="user-reset-mfa-btn" class="btn-secondary">Reset MFA</button>
                    <button type="button" id="user-delete-btn" class="btn-secondary danger-outline">Delete Permanently</button>
                </div>
                <p class="security-summary-note">For existing users, leave Password blank unless you intend to reset it. Disable is preferred over permanent deletion because it preserves account history.</p>
            </div>

            <div class="user-list" style="margin-top:18px;">
                <h3>Existing Users</h3>

                <div id="user-loading" class="user-loading hidden">
                    <div class="spinner"></div>
                    Loading users...
                </div>

                <table id="user-table" border="1" cellpadding="4" cellspacing="0">
                    <thead>
                        <tr><th>Username</th><th>Email</th><th>Role</th><th>Status</th><th>MFA</th><th>Last successful login</th><th>Last failed login</th></tr>
                    </thead>
                    <tbody></tbody>
                </table>
            </div>
        </div>
    `;

    const userSlot = document.getElementById("user-management-slot");
    if (userSlot) {
        userSlot.replaceChildren(section);
    } else {
        adminView.appendChild(section);
    }

    const usernameInput = section.querySelector("#user-username");
    const passwordInput = section.querySelector("#user-password");
    const roleSelect = section.querySelector("#user-role");
    const mfaCheckbox = section.querySelector("#user-mfa");
   const emailInput = section.querySelector("#user-email");

    const saveBtn = section.querySelector("#user-save-btn");
    const deleteBtn = section.querySelector("#user-delete-btn");
    const resetMfaBtn = section.querySelector("#user-reset-mfa-btn");
    const statusBtn = section.querySelector("#user-status-btn");
    const accountStatus = section.querySelector("#user-account-status");

    const tbody = section.querySelector("#user-table tbody");
    let selectedUser = null;
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

    const formatUserTime = value => {
        if (!value) return "Never";
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown";
    };

    function selectUser(u) {
        selectedUser = u || null;
        usernameInput.value = u?.username || "";
        roleSelect.value = u?.role || "view";
        mfaCheckbox.checked = !!u?.mfaEnabled;
        passwordInput.value = "";
        emailInput.value = u?.email || "";
        const enabled = u?.enabled !== false;
        accountStatus.textContent = u ? (enabled ? "Enabled" : "Disabled") : "New account";
        statusBtn.textContent = enabled ? "Disable Account" : "Enable Account";
        statusBtn.disabled = !u || (u.username === ACTIVE_USERNAME && enabled);
        deleteBtn.disabled = !u || u.username === ACTIVE_USERNAME;
        resetMfaBtn.disabled = !u;
    }

    saveBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim().toLowerCase();
        const password = passwordInput.value.trim();
        const role = roleSelect.value;
        const mfaEnabled = mfaCheckbox.checked;

        const editingExisting = selectedUser?.username === username;
        if (!username) {
            showToast("Username is required.", "error");
            return;
        }
        if (!editingExisting && !password) {
            showToast("Password is required when creating a new user.", "error");
            return;
        }

        try {
            const res = await fetch(`${WORKER_BASE}/api/users/save`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
        username,
        password,
        role,
        mfaEnabled,
        email: emailInput.value.trim()
    })
});

            const data = await res.json();

            if (!res.ok || !data.success) {
                showToast(data.error || "Failed to save user.", "error");
                return;
            }

            showToast("User saved successfully.", "success");
            passwordInput.value = "";
            selectedUser = data.user || selectedUser;
            await refreshUserList();
            await loadSecurityConfigHistory();

        } catch (err) {
            console.error("Save user failed:", err);
            showToast("Failed to save user.", "error");
        }
    });

    deleteBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim().toLowerCase();
        if (!username) {
            showToast("Select a user to delete.", "error");
            return;
        }

        if (!confirm(`Permanently delete user "${username}"? This cannot be undone. Disabling the account is preferred when access should be retained for audit history.`)) return;

        try {
            LAST_DELETED_USER = null;

            const res = await fetch(`${WORKER_BASE}/api/users/delete`, {
                method: "POST",
                headers: authHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ username }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                showToast(data.error || "Failed to delete user.", "error");
                return;
            }

            showToast(`User "${username}" was permanently deleted.`, "success");

            usernameInput.value = "";
            passwordInput.value = "";
            mfaCheckbox.checked = false;
            emailInput.value = "";
            selectedUser = null;
            accountStatus.textContent = "New account";
            statusBtn.disabled = true;

            await refreshUserList();
            await loadSecurityConfigHistory();
            await loadActiveSecuritySessions();

        } catch (err) {
            console.error("Delete user failed:", err);
            showToast("Failed to delete user.", "error");
        }
    });

    statusBtn.addEventListener("click", async () => {
        if (!selectedUser) return showToast("Select a user first.", "error");
        const desiredEnabled = selectedUser.enabled === false;
        const action = desiredEnabled ? "enable" : "disable";
        if (!confirm(`${desiredEnabled ? "Enable" : "Disable"} account "${selectedUser.username}"?`)) return;

        statusBtn.disabled = true;
        try {
            const res = await fetch(`${WORKER_BASE}/api/users/status`, {
                method: "POST",
                headers: authHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ username: selectedUser.username, enabled: desiredEnabled })
            });
            const data = await res.json();
            if (!res.ok || !data.success) {
                showToast(data.error || `Unable to ${action} account.`, "error");
                return;
            }
            selectedUser = data.user;
            showToast(`Account ${desiredEnabled ? "enabled" : "disabled"} successfully.`, "success");
            await refreshUserList();
            await loadSecurityConfigHistory();
            await loadActiveSecuritySessions();
        } catch (err) {
            console.error("Account status update failed:", err);
            showToast(`Unable to ${action} account.`, "error");
        } finally {
            if (selectedUser) selectUser(selectedUser);
        }
    });

    resetMfaBtn.addEventListener("click", async () => {
        const username = usernameInput.value.trim().toLowerCase();
        if (!username) {
            showToast("Select a user to reset MFA.", "error");
            return;
        }

        if (!confirm(`Reset MFA for "${username}"?`)) return;

        try {
            const res = await fetch(`${WORKER_BASE}/api/users/reset-mfa`, {
                method: "POST",
                headers: authHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({ username }),
            });
            const data = await res.json();

            if (!res.ok || !data.success) {
                showToast(data.error || "Failed to reset MFA.", "error");
                return;
            }

            showToast("MFA reset. User will be prompted to re-enroll on next login.", "success");
            await loadSecurityConfigHistory();
        } catch (err) {
            console.error("Reset MFA failed:", err);
            showToast("Failed to reset MFA.", "error");
        }
    });

    async function refreshUserList(retry = 0) {
        loadingIndicator.classList.remove("hidden");

        try {
            const res = await fetch(`${WORKER_BASE}/api/users/list`, { headers: authHeaders() });
            const data = await res.json();

            if ((!data || !Array.isArray(data.users)) && retry < 3) {
                return setTimeout(() => refreshUserList(retry + 1), 250);
            }

            const users = Array.isArray(data.users) ? data.users : [];
            tbody.innerHTML = "";

            users.forEach((u) => {
                const tr = document.createElement("tr");
                tr.style.opacity = "0";

                const values = [
                    u.username || "",
                    u.email || "—",
                    u.role || "view",
                    u.enabled === false ? "Disabled" : "Enabled",
                    u.mfaEnabled ? "Yes" : "No",
                    formatUserTime(u.lastSuccessfulLoginAt),
                    formatUserTime(u.lastFailedLoginAt)
                ];
                values.forEach((value) => {
                    const td = document.createElement("td");
                    td.textContent = String(value);
                    tr.appendChild(td);
                });

                tr.classList.toggle("security-user-disabled", u.enabled === false);
                const wasSelected = selectedUser?.username === u.username;
                if (wasSelected) {
                    selectedUser = u;
                    selectUser(u);
                    tr.classList.add("selected");
                }
                tr.addEventListener("click", () => {
                    selectUser(u);
                    tbody.querySelectorAll("tr").forEach(row => row.classList.remove("selected"));
                    tr.classList.add("selected");
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
            tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;">Unable to load users.</td></tr>`;
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
/* =============================================================
   End of Section 10
   ============================================================= */
/* =============================================================
   9.  LOGOUT
   ============================================================= */

logoutBtn.addEventListener("click", async () => {
    const sessionToRevoke = ACTIVE_SESSION;
    if (sessionToRevoke) {
        try {
            await fetch(`${WORKER_BASE}/api/logout`, {
                method: "POST",
                headers: { Authorization: `Bearer ${sessionToRevoke}` }
            });
        } catch (err) {
            console.debug("Server-side logout cleanup failed:", err);
        }
    }
    ACTIVE_SESSION = null;
    ACTIVE_USERNAME = null;
    ACTIVE_ROLE = null;
    AUDIT_EVENTS = [];
    SECURITY_CONFIG_HISTORY = [];
    ACTIVE_SECURITY_SESSIONS = [];
    CURRENT_CONNECTION = null;
    DEVICE_ADMIN_SETTINGS = null;
    DEVICE_FLEET_KEYS = null;
    document.getElementById("user-management")?.remove();
    userPanelInitialized = false;
       window.VBPortalSession?.clear();
       localStorage.removeItem(VB_USER_KEY);
       localStorage.removeItem(VB_ROLE_KEY);
    if (auditInterval) {
      clearInterval(auditInterval);
      auditInterval = null;
    }
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

initSecurityConsoleNavigation();
bindDeviceAdminControls();
bindLicenseControls();
document.getElementById("audit-filter-query")?.addEventListener("input", renderAuditLog);
document.getElementById("audit-filter-outcome")?.addEventListener("change", renderAuditLog);
document.getElementById("audit-refresh-btn")?.addEventListener("click", () => void loadAuditLog());
document.getElementById("security-config-history-refresh")?.addEventListener("click", () => void loadSecurityConfigHistory());
document.getElementById("security-sessions-refresh")?.addEventListener("click", () => void loadActiveSecuritySessions());

(async function restoreSharedSession() {
  const existingSession = window.VBPortalSession?.get();
  const existingUser = localStorage.getItem(VB_USER_KEY);
  const existingRole = localStorage.getItem(VB_ROLE_KEY);

  if (!existingSession) return;

  ACTIVE_SESSION = existingSession;
  ACTIVE_USERNAME = existingUser || "";
  ACTIVE_ROLE = existingRole || "view";

  try {
    const res = await fetch(`${WORKER_BASE}/api/get-hours`, { headers: authHeaders() });
    if (!res.ok) throw new Error("stored-session-invalid");
    await showAdminView();
  } catch {
    ACTIVE_SESSION = null;
    ACTIVE_USERNAME = null;
    ACTIVE_ROLE = null;
    window.VBPortalSession?.clear();
    localStorage.removeItem(VB_USER_KEY);
    localStorage.removeItem(VB_ROLE_KEY);
    loginView.classList.remove("hidden");
    adminView.classList.add("hidden");
  }
})();
