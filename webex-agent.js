// =====================================================
// VisionBank Webex Agent Controls
// Build 2026.08.27-v5
// =====================================================

const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
const VB_SESSION_KEY = "vb_session";
const VB_USER_KEY = "vb_user";
const WEBEX_AGENT_BUILD = "2026.08.27-v5";

console.info(`Webex Agent Controls build ${WEBEX_AGENT_BUILD}`);

const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginTotp = document.getElementById("loginTotp");
const totpWrapper = document.getElementById("totpWrapper");
const loginMessage = document.getElementById("loginMessage");

const logoutBtn = document.getElementById("logoutBtn");
const themeToggle = document.getElementById("themeToggle");

const reminderEnabled = document.getElementById("reminderEnabled");
const reminderTime = document.getElementById("reminderTime");
const ccRecipients = document.getElementById("ccRecipients");
const autoLogoutEnabled = document.getElementById("autoLogoutEnabled");
const weekdayLogoutTime = document.getElementById("weekdayLogoutTime");
const saturdayLogoutTime = document.getElementById("saturdayLogoutTime");
const logoutTargetMode = document.getElementById("logoutTargetMode");
const logoutTargetAgentName = document.getElementById("logoutTargetAgentName");
const logoutDryRun = document.getElementById("logoutDryRun");
const logoutReason = document.getElementById("logoutReason");

const settingsStatus = document.getElementById("settingsStatus");
const logoutSettingsStatus = document.getElementById("logoutSettingsStatus");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const refreshAgentsBtn = document.getElementById("refreshAgentsBtn");
const runAutoLogoutNowBtn = document.getElementById("runAutoLogoutNowBtn");
const sendTestReminderBtn = document.getElementById("sendTestReminderBtn");
const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
const actionMessage = document.getElementById("actionMessage");
const modeWarning = document.getElementById("modeWarning");

const agentsBody = document.getElementById("agentsBody");
const historyBody = document.getElementById("historyBody");
const agentMeta = document.getElementById("agentMeta");

const kpiLoggedIn = document.getElementById("kpiLoggedIn");
const kpiAvailable = document.getElementById("kpiAvailable");
const kpiActiveContact = document.getElementById("kpiActiveContact");
const kpiSignoutMode = document.getElementById("kpiSignoutMode");

let currentSettings = null;
let currentAgents = [];

function getSession() {
  return localStorage.getItem(VB_SESSION_KEY) || "";
}

function authHeaders(extra = {}) {
  const session = getSession();
  return {
    ...extra,
    ...(session ? { Authorization: `Bearer ${session}` } : {})
  };
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${SECURITY_BASE}${path}`, {
    ...options,
    mode: "cors",
    credentials: "omit",
    headers: authHeaders(options.headers || {})
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: text || `HTTP ${res.status}` };
  }

  if (res.status === 401 && data.error === "session-required") {
    localStorage.removeItem(VB_SESSION_KEY);
    localStorage.removeItem(VB_USER_KEY);
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    loginMessage.textContent = "Your VisionBank session expired. Please sign in again.";
  }

  return { res, data };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function showActionMessage(message, type = "success") {
  actionMessage.textContent = message;
  actionMessage.classList.remove("hidden", "success", "error");
  actionMessage.classList.add(type);
}

function hideActionMessage() {
  actionMessage.classList.add("hidden");
}

function isContactState(value) {
  const s = String(value || "").toLowerCase();
  return ["connected", "engaged", "ringing", "reserved", "wrapup", "wrap-up"].some(x => s.includes(x));
}

function updateModeUi() {
  const dry = logoutDryRun.value !== "false";
  kpiSignoutMode.textContent = dry ? "DRY RUN" : "LIVE";

  if (dry) {
    modeWarning.textContent = "Dry Run is enabled. Manual and scheduled actions will only report which Webex agents would be signed out.";
    modeWarning.classList.remove("live-warning");
  } else {
    modeWarning.textContent = "LIVE Webex signout is enabled. Manual actions and the automatic schedule can sign out active Webex agent sessions.";
    modeWarning.classList.add("live-warning");
  }

  if (currentAgents.length) renderAgents(currentAgents);
}

logoutDryRun?.addEventListener("change", updateModeUi);
logoutTargetMode?.addEventListener("change", () => {
  const specific = logoutTargetMode.value === "specific";
  logoutTargetAgentName.disabled = !specific;
});

// =====================================================
// LOGIN
// =====================================================
loginForm?.addEventListener("submit", async function (e) {
  e.preventDefault();

  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  const totp = loginTotp.value.trim();
  loginMessage.textContent = "Signing in...";

  try {
    const body = { username, password };
    if (!totpWrapper.classList.contains("hidden")) body.totp = totp;

    const res = await fetch(`${SECURITY_BASE}/api/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const data = await res.json();

    if (data.requireTotp) {
      totpWrapper.classList.remove("hidden");
      loginMessage.textContent = "Enter your Microsoft Authenticator code.";
      return;
    }

    if (data.requireMfaSetup) {
      loginMessage.textContent = "MFA setup is required. Complete MFA setup in the Security Admin Console first.";
      return;
    }

    if (!res.ok || !data.success) {
      loginMessage.textContent = data.error || "Login failed.";
      return;
    }

    localStorage.setItem(VB_SESSION_KEY, data.session);
    localStorage.setItem(VB_USER_KEY, username);
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    loginMessage.textContent = "";

    await loadAllWebexAgentData();
  } catch (err) {
    console.error("Login error:", err);
    loginMessage.textContent = "Login failed. Check console or Worker logs.";
  }
});

logoutBtn?.addEventListener("click", function () {
  localStorage.removeItem(VB_SESSION_KEY);
  localStorage.removeItem(VB_USER_KEY);
  location.href = "security.html";
});

// =====================================================
// SECURITY CHECK
// =====================================================
async function runSecurityCheck() {
  try {
    const res = await fetch(`${SECURITY_BASE}/security/check`);
    const data = await res.json();

    if (!data.allowed) {
      const info = data.info || {};
      const geo = info.geo || {};
      const primaryIp = info.primaryIp || "Unknown";

      document.body.innerHTML = `
        <div class="access-denied-overlay">
          <div class="access-denied-card">
            <h1>Access Restricted</h1>
            <p><strong>Access has been restricted.</strong></p>
            <div class="access-denied-details">
              <p><strong>Primary IP:</strong> <span id="restrictedIp">${escapeHtml(primaryIp)}</span> (${escapeHtml(info.ipVersion || "Unknown")})
              <button id="copyRestrictedIpBtn" class="copy-ip-btn">Copy IP</button></p>
              <p><strong>Location:</strong> ${escapeHtml(geo.city || "Unknown")}, ${escapeHtml(geo.region || "")} ${escapeHtml(geo.country || "")}</p>
              <p><strong>Network:</strong> ${escapeHtml(info.asOrg || "Unknown")} (AS${escapeHtml(info.asn || "Unknown")})</p>
              <p><strong>Reason:</strong> ${escapeHtml(data.reason || "access-denied")}</p>
              <p><strong>Current CST/CDT:</strong> ${escapeHtml(info.nowCst?.label || "Unknown")}</p>
            </div>
            <p>Please provide this information to the VisionBank IT Team.</p>
          </div>
        </div>`;

      document.getElementById("copyRestrictedIpBtn")?.addEventListener("click", async function () {
        await navigator.clipboard.writeText(primaryIp);
        this.textContent = "Copied";
      });
      return false;
    }
    return true;
  } catch (err) {
    console.error("Security check failed", err);
    return false;
  }
}

// =====================================================
// SETTINGS
// =====================================================
async function loadSettings() {
  settingsStatus.textContent = "Loading settings...";
  logoutSettingsStatus.textContent = "Loading auto-signout settings...";

  const { res, data } = await apiFetch("/api/webex/agent/settings");
  if (!res.ok || !data.success) {
    if (res.status !== 401) {
      settingsStatus.textContent = "Unable to load settings.";
      logoutSettingsStatus.textContent = data.error || "Unable to load auto-signout settings.";
    }
    return;
  }

  const s = data.settings || {};
  currentSettings = s;
  reminderEnabled.value = String(s.reminderEnabled !== false);
  reminderTime.value = s.reminderTime || "16:55";
  ccRecipients.value = (s.ccRecipients || []).join(", ");
  autoLogoutEnabled.value = String(s.autoLogoutEnabled === true);
  weekdayLogoutTime.value = s.weekdayLogoutTime || "17:30";
  saturdayLogoutTime.value = s.saturdayLogoutTime || "12:30";
  logoutTargetMode.value = s.targetMode || "all";
  logoutTargetAgentName.value = s.targetAgentName || "";
  logoutTargetAgentName.disabled = logoutTargetMode.value !== "specific";
  logoutDryRun.value = String(s.dryRun !== false);
  logoutReason.value = s.logoutReason || "VisionBank scheduled end-of-shift signout";

  const updated = s.updatedAt || "Never";
  settingsStatus.textContent = `Settings loaded. Last updated: ${updated}`;
  logoutSettingsStatus.textContent = `Auto-signout settings loaded. Last updated: ${updated}`;
  updateModeUi();
}

saveSettingsBtn?.addEventListener("click", async function () {
  hideActionMessage();
  saveSettingsBtn.disabled = true;
  settingsStatus.textContent = "Saving settings...";
  logoutSettingsStatus.textContent = "Saving auto-signout settings...";

  try {
    const payload = {
      reminderEnabled: reminderEnabled.value === "true",
      reminderTime: reminderTime.value || "16:55",
      ccRecipients: ccRecipients.value,
      autoLogoutEnabled: autoLogoutEnabled.value === "true",
      weekdayLogoutTime: weekdayLogoutTime.value || "17:30",
      saturdayLogoutTime: saturdayLogoutTime.value || "12:30",
      targetMode: logoutTargetMode.value || "all",
      targetAgentName: logoutTargetAgentName.value.trim(),
      dryRun: logoutDryRun.value !== "false",
      logoutReason: logoutReason.value.trim() || "VisionBank scheduled end-of-shift signout"
    };

    if (payload.targetMode === "specific" && !payload.targetAgentName) {
      throw new Error("Enter the Specific Agent Name / Login ID before saving Specific Agent mode.");
    }

    if (!payload.dryRun) {
      const ok = confirm(
        "You are saving LIVE Webex signout mode. The automatic schedule and manual Sign Out buttons can end Webex agent sessions. Continue?"
      );
      if (!ok) throw new Error("Live-mode save cancelled.");
    }

    const { res, data } = await apiFetch("/api/webex/agent/settings/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok || !data.success) throw new Error(data.error || "Save failed.");

    currentSettings = data.settings;
    settingsStatus.textContent = "Settings saved successfully.";
    logoutSettingsStatus.textContent = "Auto-signout settings saved successfully.";
    showActionMessage(`Webex Agent settings saved in ${data.settings.dryRun ? "DRY RUN" : "LIVE"} mode.`);
    updateModeUi();
  } catch (err) {
    console.error(err);
    settingsStatus.textContent = "Unable to save settings.";
    logoutSettingsStatus.textContent = "Unable to save auto-signout settings.";
    showActionMessage(err.message || "Unable to save settings.", "error");
  } finally {
    saveSettingsBtn.disabled = false;
  }
});

// =====================================================
// AGENTS
// =====================================================
refreshAgentsBtn?.addEventListener("click", loadCurrentAgents);

async function loadCurrentAgents() {
  agentsBody.innerHTML = `<tr><td colspan="12" class="loading">Loading currently logged-in Webex agents...</td></tr>`;

  const { res, data } = await apiFetch("/api/webex/agent/current");
  if (!res.ok || !data.success) {
    agentsBody.innerHTML = `<tr><td colspan="12" class="loading">Unable to load logged-in Webex agents.</td></tr>`;
    agentMeta.textContent = data.error || "Agent load failed.";
    return;
  }

  currentAgents = data.agents || [];
  renderAgents(currentAgents);
}

function renderAgents(agents) {
  if (!agents.length) {
    agentsBody.innerHTML = `<tr><td colspan="12" class="loading">No logged-in Webex agents found.</td></tr>`;
    kpiLoggedIn.textContent = "0";
    kpiAvailable.textContent = "0";
    kpiActiveContact.textContent = "0";
    agentMeta.textContent = "No logged-in Webex agents found.";
    return;
  }

  const available = agents.filter(a => {
    const s = String(a.status || a.state || "").toLowerCase();
    return s.includes("available") || s.includes("idle");
  }).length;
  const onContact = agents.filter(a => isContactState(a.status || a.state)).length;

  kpiLoggedIn.textContent = agents.length;
  kpiAvailable.textContent = available;
  kpiActiveContact.textContent = onContact;
  agentMeta.textContent = `${agents.length} active Webex agent session(s).`;

  const dry = logoutDryRun.value !== "false";

  agentsBody.innerHTML = agents.map(agent => {
    const state = String(agent.status || agent.state || "Unknown");
    const stateClass = `state-${state.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const actionLabel = dry ? "Test Sign Out" : "Sign Out";
    const actionClass = dry ? "btn-test" : "btn-danger";

    return `
      <tr>
        <td>${escapeHtml(agent.name || "-")}</td>
        <td>${escapeHtml(agent.email || agent.loginId || "-")}</td>
        <td>${escapeHtml(agent.team || "-")}</td>
        <td>${escapeHtml(agent.number || "-")}</td>
        <td><span class="agent-state ${stateClass}">${escapeHtml(state)}</span></td>
        <td>${escapeHtml(agent.duration || "-")}</td>
        <td>${Number(agent.inbound || 0)}</td>
        <td>${Number(agent.missed || 0)}</td>
        <td>${Number(agent.transferred || 0)}</td>
        <td>${Number(agent.outbound || 0)}</td>
        <td>${escapeHtml(agent.sessionStartCentral || "-")}</td>
        <td><button class="${actionClass} agent-signout-btn" data-agent-id="${escapeHtml(agent.agentId)}" data-agent-name="${escapeHtml(agent.name || "Agent")}">${actionLabel}</button></td>
      </tr>`;
  }).join("");

  document.querySelectorAll(".agent-signout-btn").forEach(btn => {
    btn.addEventListener("click", () => manualSignout(btn.dataset.agentId, btn.dataset.agentName));
  });
}

async function manualSignout(agentId, agentName) {
  const dry = logoutDryRun.value !== "false";

  if (!dry) {
    const ok = confirm(`LIVE Webex signout: Sign out ${agentName}?`);
    if (!ok) return;
  }

  showActionMessage(`${dry ? "Testing" : "Signing out"} ${agentName}...`);

  const { res, data } = await apiFetch("/api/webex/agent/logout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agentId })
  });

  if (!res.ok || !data.success) {
    const error = data.result?.error || data.error || "Webex signout failed.";
    showActionMessage(`${agentName}: ${error}`, "error");
    await loadHistory();
    return;
  }

  const result = data.result || {};
  showActionMessage(
    result.dryRun
      ? `Dry Run: ${agentName} would be signed out.`
      : `Webex accepted the signout request for ${agentName}.`
  );

  await Promise.all([loadCurrentAgents(), loadHistory()]);
}

// =====================================================
// RUN AUTO-SIGNOUT NOW
// =====================================================
runAutoLogoutNowBtn?.addEventListener("click", async function () {
  const dry = logoutDryRun.value !== "false";

  if (!dry) {
    const target = logoutTargetMode.value === "specific"
      ? logoutTargetAgentName.value.trim() || "the configured specific agent"
      : "ALL currently logged-in Webex agents";
    const ok = confirm(`LIVE Webex auto-signout now for ${target}?`);
    if (!ok) return;
  }

  runAutoLogoutNowBtn.disabled = true;
  showActionMessage(`Running ${dry ? "Dry Run" : "LIVE"} Webex auto-signout...`);

  try {
    const { res, data } = await apiFetch("/api/webex/agent/auto-logout/run", { method: "POST" });
    if (!res.ok || !data.success) throw new Error(data.error || "Auto-signout run failed.");

    const successes = (data.results || []).filter(r => r.success).length;
    const failures = (data.results || []).filter(r => !r.success).length;
    showActionMessage(
      `${data.dryRun ? "Dry Run" : "Live run"} complete: ${data.targetCount} target(s), ${successes} successful/tested, ${failures} failed/skipped.`,
      failures ? "error" : "success"
    );

    await Promise.all([loadCurrentAgents(), loadHistory()]);
  } catch (err) {
    console.error(err);
    showActionMessage(err.message || "Auto-signout run failed.", "error");
  } finally {
    runAutoLogoutNowBtn.disabled = false;
  }
});

// =====================================================
// TEST REMINDER
// =====================================================
sendTestReminderBtn?.addEventListener("click", async function () {
  sendTestReminderBtn.disabled = true;
  sendTestReminderBtn.textContent = "Sending...";

  try {
    const { res, data } = await apiFetch("/api/webex/agent/reminder/test", { method: "POST" });
    if (!res.ok || !data.success) throw new Error(data.error || "Test reminder failed.");

    showActionMessage(`Webex reminder test completed: ${data.sent} email(s) sent, ${data.skippedNoEmail} skipped without email.`);
    await loadHistory();
  } catch (err) {
    console.error(err);
    showActionMessage(err.message || "Webex reminder test failed.", "error");
  } finally {
    sendTestReminderBtn.disabled = false;
    sendTestReminderBtn.textContent = "Send Test Reminder";
  }
});

// =====================================================
// HISTORY
// =====================================================
refreshHistoryBtn?.addEventListener("click", loadHistory);

async function loadHistory() {
  const { res, data } = await apiFetch("/api/webex/agent/history");
  if (!res.ok || !data.success) {
    historyBody.innerHTML = `<tr><td colspan="7" class="loading">Unable to load history.</td></tr>`;
    return;
  }

  const history = data.history || [];
  if (!history.length) {
    historyBody.innerHTML = `<tr><td colspan="7" class="loading">No Webex signout history yet.</td></tr>`;
    return;
  }

  historyBody.innerHTML = history.map(item => {
    const status = String(item.status || (item.success ? "success" : "failed"));
    const statusClass = `status-${status.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
    const mode = item.dryRun === true ? "Dry Run" : item.dryRun === false ? "Live" : "-";

    return `
      <tr>
        <td>${escapeHtml(item.timeCentral || "-")}</td>
        <td>${escapeHtml(item.source || "-")}</td>
        <td>${escapeHtml(item.agentName || "-")}</td>
        <td><span class="status-pill ${statusClass}">${escapeHtml(status)}</span></td>
        <td>${escapeHtml(mode)}</td>
        <td>${escapeHtml(item.initiatedBy || "-")}</td>
        <td>${escapeHtml(item.error || (item.httpStatus ? `HTTP ${item.httpStatus}` : "-"))}</td>
      </tr>`;
  }).join("");
}

// =====================================================
// THEME
// =====================================================
themeToggle?.addEventListener("click", function () {
  document.body.classList.toggle("theme-dark");
  const isDark = document.body.classList.contains("theme-dark");
  document.body.classList.toggle("theme-light", !isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
  localStorage.setItem("vb_webex_agents_theme", isDark ? "dark" : "light");
});

(function loadSavedTheme() {
  const saved = localStorage.getItem("vb_webex_agents_theme");
  if (saved === "dark") {
    document.body.classList.add("theme-dark");
    document.body.classList.remove("theme-light");
    if (themeToggle) themeToggle.textContent = "Light mode";
  }
})();

async function loadAllWebexAgentData() {
  await loadSettings();
  if (!getSession()) return;
  await Promise.all([loadCurrentAgents(), loadHistory()]);
}

// =====================================================
// INIT
// =====================================================
(async function init() {
  const ok = await runSecurityCheck();
  if (!ok) return;

  const existingSession = getSession();
  if (!existingSession) {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
    return;
  }

  loginView.classList.add("hidden");
  appView.classList.remove("hidden");
  await loadAllWebexAgentData();
})();
