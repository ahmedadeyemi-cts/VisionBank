// =====================================================
// VisionBank Voicemail Reports
// Created and maintained by Ahmed Adeyemi
// =====================================================

const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
//const API_BASE = "https://pop1-apps.mycontactcenter.net/api/v3";
//const TOKEN = "REPLACE_WITH_TOKEN";
const REPORT_API = `${SECURITY_BASE}/api/voicemails/report`;

const reportBody = document.getElementById("voicemail-report-body");
const reportSummary = document.getElementById("voicemail-summary");
const reportRange = document.getElementById("report-range");
const refreshBtn = document.getElementById("refresh-report-btn");
const exportBtn = document.getElementById("export-csv-btn");
const printPdfBtn = document.getElementById("printPdfBtn");
const sendDailyBtn = document.getElementById("sendDailyBtn");
const themeToggle = document.getElementById("themeToggle");
const loginView = document.getElementById("loginView");
const appView = document.getElementById("appView");
const loginForm = document.getElementById("loginForm");
const loginUsername = document.getElementById("loginUsername");
const loginPassword = document.getElementById("loginPassword");
const loginTotp = document.getElementById("loginTotp");
const totpWrapper = document.getElementById("totpWrapper");
const loginMessage = document.getElementById("loginMessage");
const logoutBtn = document.getElementById("logoutBtn");
const scheduleReportBtn = document.getElementById("scheduleReportBtn");
const schedulePanel = document.getElementById("schedulePanel");
const scheduleEnabled = document.getElementById("scheduleEnabled");
const scheduleRecipients = document.getElementById("scheduleRecipients");
const scheduleFrequency = document.getElementById("scheduleFrequency");
const scheduleRange = document.getElementById("scheduleRange");
const scheduleSendTime = document.getElementById("scheduleSendTime");
const saveScheduleBtn = document.getElementById("saveScheduleBtn");
const scheduleStatus = document.getElementById("scheduleStatus");

let pendingUsername = "";
let pendingPassword = "";

loginForm?.addEventListener("submit", async function (e) {
  e.preventDefault();

  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  const totp = loginTotp.value.trim();

  pendingUsername = username;
  pendingPassword = password;

  loginMessage.textContent = "Signing in...";

  try {
    const body = {
      username,
      password
    };

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
      loginMessage.textContent = "MFA setup is required. Please use the Security Admin Console to complete MFA setup first.";
      return;
    }

    if (!res.ok || !data.success) {
      loginMessage.textContent = data.error || "Login failed.";
      return;
    }

    sessionStorage.setItem("vb_voicemail_session", data.session);
    sessionStorage.setItem("vb_voicemail_user", username);

    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    loginMessage.textContent = "";

    await loadReport();

  } catch (err) {
    console.error("Login error:", err);
    loginMessage.textContent = "Login failed. Check console or Worker logs.";
  }
});

logoutBtn?.addEventListener("click", function () {
  sessionStorage.removeItem("vb_voicemail_session");
  sessionStorage.removeItem("vb_voicemail_user");
  location.reload();
});
// =====================================================
// PRINT / SAVE PDF
// =====================================================
if (printPdfBtn) {

  console.log("printPdfBtn found successfully");

  printPdfBtn.addEventListener("click", function (e) {

    console.log("======================================");
    console.log("PRINT BUTTON CLICKED");
    console.log("Timestamp:", new Date().toISOString());

    e.preventDefault();
    e.stopPropagation();

    console.log("preventDefault() applied");
    console.log("stopPropagation() applied");

    try {

      console.log("Attempting window.focus()");
      window.focus();

      console.log("window.focus() completed");

      setTimeout(() => {

        console.log("setTimeout triggered");
        console.log("Attempting window.print()");

        try {

          window.print();

          console.log("window.print() executed");

        } catch (printErr) {

          console.error("window.print() FAILED");
          console.error(printErr);

        }

      }, 250);

      console.log("Print timeout scheduled");

    } catch (err) {

      console.error("PRINT BUTTON ERROR");
      console.error(err);

    }

  });

} else {

  console.error("printPdfBtn was NOT found.");
  console.error("Check button ID in voicemails.html.");

}
// =====================================================
// SEND EMAIL REPORT
// =====================================================
sendDailyBtn?.addEventListener("click", async function () {
  const range = reportRange.value;

  sendDailyBtn.disabled = true;
  sendDailyBtn.textContent = "Sending...";

  try {
    const res = await fetch(
      `${SECURITY_BASE}/api/voicemails/send-daily?range=${encodeURIComponent(range)}`,
      {
        method: "POST"
      }
    );

    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Email failed.");
    }

    alert(
      `Voicemail report sent for ${range}. Total voicemails: ${data.totalVoicemails}`
    );

  } catch (err) {
    console.error(err);
    alert("Email failed. Check Worker logs.");
  } finally {
    sendDailyBtn.disabled = false;
    sendDailyBtn.textContent = "Send Email";
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

  localStorage.setItem("vb_voicemail_theme", isDark ? "dark" : "light");
});

// Load saved theme
(function loadSavedTheme() {
  const saved = localStorage.getItem("vb_voicemail_theme");

  if (saved === "dark") {
    document.body.classList.add("theme-dark");
    document.body.classList.remove("theme-light");

    if (themeToggle) {
      themeToggle.textContent = "Light mode";
    }
  }
})();
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

              <p>
                <strong>Location:</strong>
                ${city}, ${region} ${country}
              </p>

              <p>
                <strong>Network:</strong>
                ${asOrg} (AS${asn})
              </p>

              <p>
                <strong>Reason:</strong>
                ${reason}
              </p>

              <p>
                <strong>Current CST/CDT:</strong>
                ${nowCst.label || "Unknown"}
              </p>
            </div>

            <p class="access-denied-note">
              Please provide this information to the VisionBank IT Team.
            </p>

            <p class="access-denied-note muted">
              If you believe this is in error, contact the VisionBank IT Team.
            </p>
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

    document.body.innerHTML = `
      <div class="access-denied-overlay">
        <div class="access-denied-card">
          <h1>Access Restricted</h1>
          <p>Unable to validate access at this time.</p>
          <p class="access-denied-note">
            Please contact the VisionBank IT Team.
          </p>
        </div>
      </div>
    `;

    return false;
  }
}

// =====================================================
// DATE HELPERS
// =====================================================
function formatDate(date) {
  return date.toISOString().split("T")[0];
}

function getDateRange(type) {
  const now = new Date();
  const start = new Date();
  const end = new Date();

  switch (type) {
    case "today":
      break;

    case "this-week":
      start.setDate(now.getDate() - now.getDay());
      break;

    case "last-week":
      start.setDate(now.getDate() - now.getDay() - 7);
      end.setDate(now.getDate() - now.getDay() - 1);
      break;

    case "this-month":
      start.setDate(1);
      break;

    case "last-month":
      start.setMonth(now.getMonth() - 1);
      start.setDate(1);

      end.setMonth(now.getMonth());
      end.setDate(0);
      break;

    case "ytd":
      start.setMonth(0);
      start.setDate(1);
      break;
  }

  return {
    start,
    end
  };
}

function enumerateDates(start, end) {
  const dates = [];
  const current = new Date(start);

  while (current <= end) {
    dates.push(formatDate(current));
    current.setDate(current.getDate() + 1);
  }

  return dates;
}

// =====================================================
// BUILD REPORT
// =====================================================
async function loadReport() {
  reportBody.innerHTML = `
    <tr>
      <td colspan="5">Loading voicemail report...</td>
    </tr>
  `;

  const range = reportRange.value;

  try {
    const res = await fetch(`${REPORT_API}?range=${encodeURIComponent(range)}`);

    if (!res.ok) {
      throw new Error(`Report failed: HTTP ${res.status}`);
    }

    const data = await res.json();

    renderReport(data.records || [], range);

  } catch (err) {
    console.error(err);
    reportBody.innerHTML = `
      <tr>
        <td colspan="5">Unable to load voicemail report.</td>
      </tr>
    `;
    reportSummary.innerHTML = `Report failed. Check the Worker logs.`;
  }
}

scheduleReportBtn?.addEventListener("click", async function () {
  schedulePanel.classList.toggle("hidden");
  await loadScheduleSettings();
});

async function loadScheduleSettings() {
  try {
    const res = await fetch(`${SECURITY_BASE}/api/voicemails/schedule/get`);
    const data = await res.json();

    if (!res.ok || !data.success) {
      throw new Error(data.error || "Unable to load schedule.");
    }

    const s = data.schedule;

    scheduleEnabled.value = String(Boolean(s.enabled));
    scheduleRecipients.value = (s.recipients || []).join(", ");
    scheduleFrequency.value = s.frequency || "daily";
    scheduleRange.value = s.range || "today";
    scheduleSendTime.value = s.sendTime || "07:00";

    scheduleStatus.textContent = s.enabled
      ? `Schedule enabled. Last sent: ${s.lastSentAt || "Never"}`
      : "Schedule is currently disabled.";

  } catch (err) {
    console.error(err);
    scheduleStatus.textContent = "Unable to load schedule settings.";
  }
}

saveScheduleBtn?.addEventListener("click", async function () {
  scheduleStatus.textContent = "Saving schedule...";

  try {
    const payload = {
      enabled: scheduleEnabled.value === "true",
      recipients: scheduleRecipients.value,
      frequency: scheduleFrequency.value,
      range: scheduleRange.value,
      sendTime: scheduleSendTime.value,
      timezone: "America/Chicago"
    };

    const res = await fetch(`${SECURITY_BASE}/api/voicemails/schedule/save`, {
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

    scheduleStatus.textContent = "Schedule saved successfully.";

  } catch (err) {
    console.error(err);
    scheduleStatus.textContent = "Unable to save schedule.";
  }
});
// =====================================================
// RENDER REPORT
// =====================================================
function renderReport(records, range) {
  if (!records.length) {
    reportBody.innerHTML = `
      <tr>
        <td colspan="8">No voicemails found.</td>
      </tr>
    `;

    reportSummary.innerHTML = `
      <div class="summary-card">
        <h3>${range.toUpperCase()}</h3>
        <p>No voicemail activity detected.</p>
      </div>
    `;

    document.getElementById("kpiTotal").textContent = "0";
    document.getElementById("kpiAvg").textContent = "0s";
    document.getElementById("kpiLongest").textContent = "0s";
    document.getElementById("kpiDates").textContent = "0";

    document.getElementById("dailyBreakdown").innerHTML = `
      <div class="empty-state">
        No voicemail activity found for this range.
      </div>
    `;

    document.getElementById("reportMeta").textContent = "No report loaded.";
    window.currentVoicemailData = [];

    return;
  }

  let totalDuration = 0;
  let longestDuration = 0;
  const perDayCounts = {};

  reportBody.innerHTML = records.map(vm => {
    const duration = Number(vm.SecondsDuration || 0);

    totalDuration += duration;

    if (duration > longestDuration) {
      longestDuration = duration;
    }

    const day = (vm.CreationDateUtc || "").split("T")[0];

    if (day) {
      perDayCounts[day] = (perDayCounts[day] || 0) + 1;
    }

    return `
      <tr>
        <td>${vm.CreationDateUtc || "-"}</td>
        <td>${vm.CallerNumber || "-"}</td>
        <td>${vm.CallerName || "-"}</td>
        <td>${vm.ReferenceNo || "-"}</td>
        <td>${vm.CallId || "-"}</td>
        <td>${vm.EntryQueueId ?? "-"}</td>
        <td>${duration}s</td>
        <td>${vm.MailId || "-"}</td>
      </tr>
    `;
  }).join("");

  const avgDuration = Math.round(totalDuration / records.length);
  const uniqueDates = Object.keys(perDayCounts).length;

  reportSummary.innerHTML = `
    <div class="summary-card">
      <h3>${range.toUpperCase()}</h3>
      <p><strong>Total Voicemails:</strong> ${records.length}</p>
      <p><strong>Total Duration:</strong> ${totalDuration}s</p>
      <p><strong>Average Duration:</strong> ${avgDuration}s</p>
    </div>
  `;

  document.getElementById("kpiTotal").textContent = records.length;
  document.getElementById("kpiAvg").textContent = `${avgDuration}s`;
  document.getElementById("kpiLongest").textContent = `${longestDuration}s`;
  document.getElementById("kpiDates").textContent = uniqueDates;

  document.getElementById("dailyBreakdown").innerHTML =
    Object.entries(perDayCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => `
        <div class="daily-card">
          <div class="daily-date">${date}</div>
          <div class="daily-count">${count}</div>
          <div class="daily-label">Voicemails</div>
        </div>
      `).join("");

  document.getElementById("reportMeta").textContent =
    `${records.length} total voicemail(s) across ${uniqueDates} day(s)`;

  window.currentVoicemailData = records;
}

function safeCsv(value) {
  if (value === null || value === undefined) return "";

  const text = String(value).replace(/"/g, '""');

  return `"${text}"`;
}
// =====================================================
// CSV EXPORT
// =====================================================
function exportCsv() {
  const rows = window.currentVoicemailData || [];

  if (!rows.length) {
    alert("No data to export.");
    return;
  }

  const csv = [
    [
      "CreationDateUtc",
      "CallerNumber",
      "CallerName",
      "ReferenceNo",
      "CallId",
      "EntryQueueId",
      "SecondsDuration",
      "MailId"
    ].join(",")
  ];

  rows.forEach(r => {
    csv.push([
      safeCsv(r.CreationDateUtc),
      safeCsv(r.CallerNumber),
      safeCsv(r.CallerName),
      safeCsv(r.ReferenceNo),
      safeCsv(r.CallId),
      safeCsv(r.EntryQueueId),
      safeCsv(r.SecondsDuration),
      safeCsv(r.MailId)
    ].join(","));
  });

  const blob = new Blob([csv.join("\n")], {
    type: "text/csv"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = `visionbank-voicemails-${Date.now()}.csv`;
  a.click();

  URL.revokeObjectURL(url);
}

// =====================================================
// EVENTS
// =====================================================
refreshBtn?.addEventListener("click", loadReport);
exportBtn?.addEventListener("click", exportCsv);

// =====================================================
// INIT
// =====================================================
(async function init() {
  const ok = await runSecurityCheck();

  if (!ok) return;

  const existingSession = sessionStorage.getItem("vb_voicemail_session");

  if (existingSession) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    await loadReport();
  }
})();
