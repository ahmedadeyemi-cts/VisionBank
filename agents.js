// =====================================================
// VisionBank Agent Controls
// Created and maintained by Ahmed Adeyemi
// =====================================================

const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";

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
const logoutSettingsStatus = document.getElementById("logoutSettingsStatus");
const logoutTargetMode = document.getElementById("logoutTargetMode");
const logoutTargetAgentName = document.getElementById("logoutTargetAgentName");
const logoutDryRun = document.getElementById("logoutDryRun");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");
const refreshAgentsBtn = document.getElementById("refreshAgentsBtn");
const sendTestReminderBtn = document.getElementById("sendTestReminderBtn");

const settingsStatus = document.getElementById("settingsStatus");
const agentsBody = document.getElementById("agentsBody");
const agentMeta = document.getElementById("agentMeta");

const kpiLoggedIn = document.getElementById("kpiLoggedIn");
const kpiWithEmail = document.getElementById("kpiWithEmail");
const kpiMissingEmail = document.getElementById("kpiMissingEmail");
const kpiReminderTime = document.getElementById("kpiReminderTime");

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

    if (!totpWrapper.classList.contains("hidden")) {
      body.totp = totp;
    }

    const res = await fetch(`${SECURITY_BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    if (data.requireTotp) {
      totpWrapper.classList.remove("hidden");
      loginMessage.textContent = "Enter your Microsoft Authenticator code.";
      return;
    }

    if (data.requireMfaSetup) {
      loginMessage.textContent =
        "MFA setup is required. Please use the Security Admin Console to complete MFA setup first.";
      return;
    }

    if (!res.ok || !data.success) {
      loginMessage.textContent = data.error || "Login failed.";
      return;
    }

    sessionStorage.setItem("vb_agents_session", data.session);
    sessionStorage.setItem("vb_agents_user", username);

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    loginMessage.textContent = "";

    await loadAgentSettings();
    await loadCurrentAgents();

  } catch (err) {
    console.error("Login error:", err);
    loginMessage.textContent = "Login failed. Check console or Worker logs.";
  }
});

// =====================================================
// LOGOUT
// =====================================================
logoutBtn?.addEventListener("click", function () {
  sessionStorage.removeItem("vb_agents_session");
  sessionStorage.removeItem("vb_agents_user");
  location.reload();
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
      const nowCst = info.nowCst || {};

      const primaryIp = info.primaryIp || "Unknown";
      const ipVersion = info.ipVersion || "Unknown";
      const city = geo.city || "Unknown";
      const region = geo.region || "Unknown";
      const country = geo.country || "Unknown";
      const asOrg = info.asOrg || "Unknown";
      const asn = info.asn || "Unknown";
      const reason = data.reason || "access-denied";

      document.body.innerHTML = `
        <div class="access-denied-overlay">
          <div class="access-denied-card">
            <h1>Access Restricted</h1>

            <p><strong>Access has been restricted.</strong></p>

            <div class="access-denied-details">
              <p>
                <strong>Primary IP:</strong>
                <span id="restrictedIp">${primaryIp}</span> (${ipVersion})
                <button id="copyRestrictedIpBtn" class="copy-ip-btn">Copy IP</button>
              </p>

              <p><strong>Location:</strong> ${city}, ${region} ${country}</p>
              <p><strong>Network:</strong> ${asOrg} (AS${asn})</p>
              <p><strong>Reason:</strong> ${reason}</p>
              <p><strong>Current CST/CDT:</strong> ${nowCst.label || "Unknown"}</p>
            </div>

            <p>Please provide this information to the VisionBank IT Team.</p>
          </div>
        </div>
      `;

      document
        .getElementById("copyRestrictedIpBtn")
        ?.addEventListener("click", async function () {
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
// LOAD SETTINGS
// =====================================================
async function loadAgentSettings() {
  settingsStatus.textContent = "Loading settings...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/agents/settings/get`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load settings.");
    }

    const s = data.settings;

    reminderEnabled.value = String(Boolean(s.reminderEnabled));
    reminderTime.value = s.reminderTime || "16:55";
    ccRecipients.value = (s.ccRecipients || []).join(", ");
    autoLogoutEnabled.value = String(Boolean(s.autoLogoutEnabled));
    weekdayLogoutTime.value = s.weekdayLogoutTime || "17:30";
    saturdayLogoutTime.value = s.saturdayLogoutTime || "12:30";

    settingsStatus.textContent = `Settings loaded. Last updated: ${s.updatedAt || "Never"}`;
    kpiReminderTime.textContent = reminderTime.value;
    await loadLogoutSettings();
  } catch (err) {
    console.error(err);
    settingsStatus.textContent = "Unable to load settings.";
  }
}

// =====================================================
// SAVE SETTINGS
// =====================================================
saveSettingsBtn?.addEventListener("click", async function () {
  const logoutPayload = {
  enabled: autoLogoutEnabled.value === "true",
  weekdayTime: weekdayLogoutTime.value || "17:30",
  saturdayTime: saturdayLogoutTime.value || "12:30",
  targetMode: logoutTargetMode.value || "all",
  targetAgentName: logoutTargetAgentName.value.trim(),
  dryRun: logoutDryRun.value === "true"
};

const logoutRes = await fetch(`${SECURITY_BASE}/api/agents/logout/settings/save`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(logoutPayload)
});

const logoutData = await logoutRes.json();

if (!logoutRes.ok || !logoutData.success) {
  throw new Error(logoutData.error || "Auto-logout settings save failed.");
}

logoutSettingsStatus.textContent = "Auto-logout settings saved successfully.";
  settingsStatus.textContent = "Saving settings...";
  saveSettingsBtn.disabled = true;

  try {
    const payload = {
      reminderEnabled: reminderEnabled.value === "true",
      reminderTime: reminderTime.value || "16:55",
      ccRecipients: ccRecipients.value,
      autoLogoutEnabled: autoLogoutEnabled.value === "true",
      weekdayLogoutTime: weekdayLogoutTime.value || "17:30",
      saturdayLogoutTime: saturdayLogoutTime.value || "12:30"
    };

    const res = await fetch(`${SECURITY_BASE}/api/agents/settings/save`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Save failed.");
    }

    settingsStatus.textContent = "Settings saved successfully.";
    kpiReminderTime.textContent = payload.reminderTime;

  } catch (err) {
    console.error(err);
    settingsStatus.textContent = "Unable to save settings.";
  } finally {
    saveSettingsBtn.disabled = false;
  }
});

// =====================================================
// LOAD CURRENT AGENTS
// =====================================================
refreshAgentsBtn?.addEventListener("click", loadCurrentAgents);

async function loadCurrentAgents() {
  agentsBody.innerHTML = `
    <tr>
      <td colspan="11" class="loading">Loading currently logged-in agents...</td>
    </tr>
  `;

  try {
    const res = await fetch(`${SECURITY_BASE}/api/agents/current`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load agents.");
    }

    renderAgents(data.agents || []);

  } catch (err) {
    console.error(err);

    agentsBody.innerHTML = `
      <tr>
        <td colspan="11" class="loading">Unable to load logged-in agents.</td>
      </tr>
    `;

    agentMeta.textContent = "Agent load failed.";
  }
}
async function loadLogoutSettings() {
  logoutSettingsStatus.textContent = "Loading auto-logout settings...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/agents/logout/settings`);
    const settings = await res.json();

    if (!res.ok) {
      throw new Error(settings.error || "Unable to load logout settings.");
    }

    autoLogoutEnabled.value = String(Boolean(settings.enabled));
    weekdayLogoutTime.value = settings.weekdayTime || "17:30";
    saturdayLogoutTime.value = settings.saturdayTime || "12:30";
    logoutTargetMode.value = settings.targetMode || "all";
    logoutTargetAgentName.value = settings.targetAgentName || "";
    logoutDryRun.value = String(settings.dryRun === true);

    logoutSettingsStatus.textContent = `Auto-logout settings loaded. Last updated: ${settings.updatedAt || "Never"}`;

  } catch (err) {
    console.error(err);
    logoutSettingsStatus.textContent = "Unable to load auto-logout settings.";
  }
}
function renderAgents(agents) {
  if (!agents.length) {
    agentsBody.innerHTML = `
      <tr>
        <td colspan="11" class="loading">No logged-in agents found.</td>
      </tr>
    `;

    kpiLoggedIn.textContent = "0";
    kpiWithEmail.textContent = "0";
    kpiMissingEmail.textContent = "0";
    agentMeta.textContent = "No logged-in agents found.";
    return;
  }

  const withEmail = agents.filter(a => a.email).length;
  const missingEmail = agents.length - withEmail;

  kpiLoggedIn.textContent = agents.length;
  kpiWithEmail.textContent = withEmail;
  kpiMissingEmail.textContent = missingEmail;

  agentMeta.textContent =
    `${agents.length} logged-in agent(s), ${withEmail} with email, ${missingEmail} missing email.`;

  agentsBody.innerHTML = agents.map(agent => {
    const emailClass = agent.email ? "email-ok" : "email-missing";
    const emailText = agent.email || "Missing email";

    return `
      <tr>
        <td>${agent.name || "-"}</td>
        <td class="${emailClass}">${emailText}</td>
        <td>${agent.team || "-"}</td>
        <td>${agent.number || "-"}</td>
        <td>${agent.status || "-"}</td>
        <td>${agent.duration || "-"}</td>
        <td>${agent.inbound ?? 0}</td>
        <td>${agent.missed ?? 0}</td>
        <td>${agent.transferred ?? 0}</td>
        <td>${agent.outbound ?? 0}</td>
        <td>${agent.startDate || "-"}</td>
      </tr>
    `;
  }).join("");
}

// =====================================================
// TEST REMINDER
// =====================================================
sendTestReminderBtn?.addEventListener("click", async function () {
  sendTestReminderBtn.disabled = true;
  sendTestReminderBtn.textContent = "Sending...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/agents/reminder/test`, {
      method: "POST"
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Test reminder failed.");
    }

    alert("Agent reminder test completed.");

  } catch (err) {
    console.error(err);
    alert("Agent reminder test failed. Check Worker logs.");
  } finally {
    sendTestReminderBtn.disabled = false;
    sendTestReminderBtn.textContent = "Send Test Reminder";
  }
});

// =====================================================
// DARK MODE
// =====================================================
themeToggle?.addEventListener("click", function () {
  document.body.classList.toggle("theme-dark");

  const isDark = document.body.classList.contains("theme-dark");

  document.body.classList.toggle("theme-light", !isDark);

  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";

  localStorage.setItem("vb_agents_theme", isDark ? "dark" : "light");
});

(function loadSavedTheme() {
  const saved = localStorage.getItem("vb_agents_theme");

  if (saved === "dark") {
    document.body.classList.add("theme-dark");
    document.body.classList.remove("theme-light");

    if (themeToggle) {
      themeToggle.textContent = "Light mode";
    }
  }
})();

// =====================================================
// INIT
// =====================================================
(async function init() {
  const ok = await runSecurityCheck();

  if (!ok) return;

  const existingSession = sessionStorage.getItem("vb_agents_session");

  if (existingSession) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    await loadAgentSettings();
    await loadCurrentAgents();
  }
})();
