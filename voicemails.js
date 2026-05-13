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
  if (!records.length) {
    reportBody.innerHTML = `
      <tr>
        <td colspan="5">No voicemails found.</td>
      </tr>
    `;

    reportSummary.innerHTML = `No voicemail activity detected.`;
    return;
  }

  let totalDuration = 0;

  reportBody.innerHTML = records.map(vm => {
    totalDuration += vm.SecondsDuration || 0;

    return `
      <tr>
        <td>${vm.VoicemailId || "-"}</td>
        <td>${vm.CallId || "-"}</td>
        <td>${vm.ReferenceNo || "-"}</td>
        <td>${vm.SecondsDuration || 0}s</td>
        <td>${vm.CreationDateUtc || "-"}</td>
      </tr>
    `;
  }).join("");

  const avgDuration = Math.round(totalDuration / records.length);

  reportSummary.innerHTML = `
    <div class="summary-card">
      <h3>${range.toUpperCase()}</h3>
      <p><strong>Total Voicemails:</strong> ${records.length}</p>
      <p><strong>Total Duration:</strong> ${totalDuration}s</p>
      <p><strong>Average Duration:</strong> ${avgDuration}s</p>
    </div>
  `;

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
