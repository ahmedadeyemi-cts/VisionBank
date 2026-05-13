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
  printPdfBtn.addEventListener("click", function (e) {
    e.preventDefault();
    console.log("Print PDF button clicked");
    window.print();
  });
} else {
  console.error("printPdfBtn was not found. Check button ID in voicemails.html.");
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
      alert("Access denied.");
      document.body.innerHTML = `
        <div style="padding:40px;font-family:sans-serif;">
          <h1>Access Restricted</h1>
          <p>Your IP or access window is not authorized.</p>
        </div>
      `;
      return false;
    }

    return true;
  } catch (err) {
    console.error("Security check failed", err);
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
// FETCH VOICEMAILS
// =====================================================
async function fetchVoicemailsForDate(date) {
  let page = 1;
  let totalPages = 1;
  let all = [];

  while (page <= totalPages) {
    const res = await fetch(`${API_BASE}/hist/voicemails/${date}`, {
      headers: {
        "Content-Type": "application/json",
        token: TOKEN,
        Page: String(page)
      }
    });

    if (!res.ok) {
      console.error(`Failed loading ${date} page ${page}`);
      break;
    }

    totalPages = Number(res.headers.get("TotalPages") || 1);

    const data = await res.json();
    all = all.concat(data || []);

    page++;
  }

  return all;
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

// =====================================================
// RENDER REPORT
// =====================================================
function renderReport(records, range) {

  // =====================================================
  // NO RECORDS
  // =====================================================
  if (!records.length) {

    reportBody.innerHTML = `
      <tr>
        <td colspan="5">No voicemails found.</td>
      </tr>
    `;

    reportSummary.innerHTML = `
      <div class="summary-card">
        <h3>${range.toUpperCase()}</h3>
        <p>No voicemail activity detected.</p>
      </div>
    `;

    // KPI CARDS
    document.getElementById("kpiTotal").textContent = "0";
    document.getElementById("kpiAvg").textContent = "0s";
    document.getElementById("kpiLongest").textContent = "0s";
    document.getElementById("kpiDates").textContent = "0";

    // DAILY BREAKDOWN
    document.getElementById("dailyBreakdown").innerHTML = `
      <div class="empty-state">
        No voicemail activity found for this range.
      </div>
    `;

    // REPORT META
    document.getElementById("reportMeta").textContent =
      "No report loaded.";

    return;
  }

  // =====================================================
  // TOTALS
  // =====================================================
  let totalDuration = 0;
  let longestDuration = 0;

  const perDayCounts = {};

  // =====================================================
  // TABLE RENDER
  // =====================================================
  reportBody.innerHTML = records.map(vm => {

    const duration = Number(vm.SecondsDuration || 0);

    totalDuration += duration;

    if (duration > longestDuration) {
      longestDuration = duration;
    }

    // DAILY BREAKDOWN
    const day = (vm.CreationDateUtc || "").split("T")[0];

    if (day) {
      perDayCounts[day] = (perDayCounts[day] || 0) + 1;
    }

    return `
      <tr>
        <td>${vm.VoicemailId || "-"}</td>
        <td>${vm.CallId || "-"}</td>
        <td>${vm.ReferenceNo || "-"}</td>
        <td>${duration}s</td>
        <td>${vm.CreationDateUtc || "-"}</td>
      </tr>
    `;

  }).join("");

  // =====================================================
  // METRICS
  // =====================================================
  const avgDuration =
    Math.round(totalDuration / records.length);

  const uniqueDates =
    Object.keys(perDayCounts).length;

  // =====================================================
  // SUMMARY PANEL
  // =====================================================
  reportSummary.innerHTML = `
    <div class="summary-card">

      <h3>${range.toUpperCase()}</h3>

      <p>
        <strong>Total Voicemails:</strong>
        ${records.length}
      </p>

      <p>
        <strong>Total Duration:</strong>
        ${totalDuration}s
      </p>

      <p>
        <strong>Average Duration:</strong>
        ${avgDuration}s
      </p>

    </div>
  `;

  // =====================================================
  // KPI CARDS
  // =====================================================
  document.getElementById("kpiTotal").textContent =
    records.length;

  document.getElementById("kpiAvg").textContent =
    `${avgDuration}s`;

  document.getElementById("kpiLongest").textContent =
    `${longestDuration}s`;

  document.getElementById("kpiDates").textContent =
    uniqueDates;

  // =====================================================
  // DAILY BREAKDOWN
  // =====================================================
  const dailyHtml =
    Object.entries(perDayCounts)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => {

        return `
          <div class="daily-card">
            <div class="daily-date">${date}</div>
            <div class="daily-count">${count}</div>
            <div class="daily-label">Voicemails</div>
          </div>
        `;

      }).join("");

  document.getElementById("dailyBreakdown").innerHTML =
    dailyHtml;

  // =====================================================
  // REPORT META
  // =====================================================
  document.getElementById("reportMeta").textContent =
    `${records.length} total voicemail(s) across ${uniqueDates} day(s)`;

  // =====================================================
  // STORE GLOBAL
  // =====================================================
  window.currentVoicemailData = records;
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
      "VoicemailId",
      "CallId",
      "ReferenceNo",
      "SecondsDuration",
      "CreationDateUtc"
    ].join(",")
  ];

  rows.forEach(r => {
    csv.push([
      r.VoicemailId,
      r.CallId,
      r.ReferenceNo,
      r.SecondsDuration,
      r.CreationDateUtc
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
