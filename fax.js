// =====================================================
// VisionBank Fax Reports
// Created and maintained by Ahmed Adeyemi
// =====================================================

const SECURITY_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
const REPORT_API = `${SECURITY_BASE}/api/fax/cdrsearch`;

const reportBody = document.getElementById("fax-report-body");
const reportSummary = document.getElementById("fax-summary");
const reportRange = document.getElementById("report-range");
const refreshBtn = document.getElementById("refresh-report-btn");
const exportBtn = document.getElementById("export-csv-btn");
const printPdfBtn = document.getElementById("printPdfBtn");
const sendDailyBtn = document.getElementById("sendDailyBtn");
const testScheduleBtn = document.getElementById("testScheduleBtn");
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
const scheduleMonthlyRule = document.getElementById("scheduleMonthlyRule");
const scheduleMonthlyDay = document.getElementById("scheduleMonthlyDay");
const scheduleAttachmentType = document.getElementById("scheduleAttachmentType");
const saveScheduleBtn = document.getElementById("saveScheduleBtn");
const scheduleStatus = document.getElementById("scheduleStatus");
const scheduleTableBody = document.getElementById("scheduleTableBody");
const scheduleCount = document.getElementById("scheduleCount");
const newScheduleBtn = document.getElementById("newScheduleBtn");


let currentScheduleId = null;
let savedSchedules = [];
let pendingUsername = "";
let pendingPassword = "";
let lastReportData = null;

// =====================================================
// LOGIN / LOGOUT
// =====================================================
loginForm?.addEventListener("submit", async function (e) {
  e.preventDefault();

  const username = loginUsername.value.trim();
  const password = loginPassword.value;
  const totp = loginTotp.value.trim();

  pendingUsername = username;
  pendingPassword = password;

  loginMessage.textContent = "Signing in...";

  try {
    const body = { username, password };

    if (!totpWrapper.classList.contains("hidden")) {
      body.totp = totp;
    }

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
      loginMessage.textContent = "MFA setup is required. Please use the Security Admin Console to complete MFA setup first.";
      return;
    }

    if (!res.ok || !data.success) {
      loginMessage.textContent = data.error || "Login failed.";
      return;
    }

    sessionStorage.setItem("vb_fax_session", data.session);
    sessionStorage.setItem("vb_fax_user", username);

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
  sessionStorage.removeItem("vb_fax_session");
  sessionStorage.removeItem("vb_fax_user");
  location.reload();
});

// =====================================================
// DARK MODE
// =====================================================
themeToggle?.addEventListener("click", function () {
  document.body.classList.toggle("theme-dark");

  const isDark = document.body.classList.contains("theme-dark");

  document.body.classList.toggle("theme-light", !isDark);
  themeToggle.textContent = isDark ? "Light mode" : "Dark mode";

  localStorage.setItem("vb_fax_theme", isDark ? "dark" : "light");
});

(function loadSavedTheme() {
  const saved = localStorage.getItem("vb_fax_theme");

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
              <p><strong>Location:</strong> ${city}, ${region} ${country}</p>
              <p><strong>Network:</strong> ${asOrg} (AS${asn})</p>
              <p><strong>Reason:</strong> ${reason}</p>
              <p><strong>Current CST/CDT:</strong> ${nowCst.label || "Unknown"}</p>
            </div>

            <p class="access-denied-note">Please provide this information to the VisionBank IT Team.</p>
            <p class="access-denied-note muted">If you believe this is in error, contact the VisionBank IT Team.</p>
          </div>
        </div>
      `;

      document.getElementById("copyRestrictedIpBtn")?.addEventListener("click", async function () {
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
          <p class="access-denied-note">Please contact the VisionBank IT Team.</p>
        </div>
      </div>
    `;

    return false;
  }
}

// =====================================================
// DATE / FORMAT HELPERS
// =====================================================
function formatSeconds(seconds) {
  seconds = Number(seconds || 0);

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  if (h > 0) {
    return `${h}h ${m}m ${s}s`;
  }

  if (m > 0) {
    return `${m}m ${s}s`;
  }

  return `${s}s`;
}

function formatDate(value) {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

function rangeLabel(range) {
  const map = {
    today: "Today",
    yesterday: "Yesterday",
    "this-week": "This Week",
    "last-week": "Last Week",
    "this-month": "This Month",
    "last-month": "Last Month",
    ytd: "Year to Date"
  };

  return map[range] || range;
}

function normalizeFaxRecords(data) {
  if (Array.isArray(data)) return data;
  return data.records || data.results || data.items || [];
}

function getFaxDuration(row) {
  return Number(row.actualCallLengthSeconds || row.billCallLengthSeconds || 0);
}

function getFaxNumber(row) {
  return row.termNumber || row.dialedNumber || row.calledNumber || row.destinationNumber || "-";
}

function getCallerNumber(row) {
  return row.origNumber || row.callerNumber || row.callingNumber || row.ani || "-";
}

// =====================================================
// REPORT LOADING
// =====================================================
refreshBtn?.addEventListener("click", loadReport);

async function loadReport() {
  const range = reportRange?.value || "today";

  if (reportBody) {
    reportBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading">Loading fax report...</td>
      </tr>
    `;
  }

  if (reportSummary) {
    reportSummary.textContent = "Loading fax report...";
  }

  try {
    const res = await fetch(`${REPORT_API}?range=${encodeURIComponent(range)}`);
    const data = await res.json();

    if (!res.ok || data.ok === false || data.success === false) {
      throw new Error(data.error || "Fax report failed.");
    }

    const records = normalizeFaxRecords(data);
    lastReportData = {
      ...data,
      range,
      records
    };

    renderSummary(lastReportData);
    renderKpis(lastReportData);
    renderDailyBreakdown(records);
    renderTable(records);

  } catch (err) {
    console.error("Fax report error:", err);

    if (reportSummary) {
      reportSummary.textContent = `Unable to load fax report: ${err.message}`;
    }

    if (reportBody) {
      reportBody.innerHTML = `
        <tr>
          <td colspan="9" class="loading">Unable to load fax report.</td>
        </tr>
      `;
    }
  }
}

function renderSummary(data) {
  const records = data.records || [];
  const totalDuration = records.reduce((sum, r) => sum + getFaxDuration(r), 0);
  const avgDuration = records.length ? Math.round(totalDuration / records.length) : 0;

  if (!reportSummary) return;

  reportSummary.innerHTML = `
    <strong>${rangeLabel(data.range)}</strong> fax report loaded.<br>
    Total fax CDRs: <strong>${records.length}</strong><br>
    Average duration: <strong>${formatSeconds(avgDuration)}</strong><br>
    Total duration: <strong>${formatSeconds(totalDuration)}</strong>
  `;
}

function renderKpis(data) {
  const records = data.records || [];
  const totalDuration = records.reduce((sum, r) => sum + getFaxDuration(r), 0);
  const avgDuration = records.length ? Math.round(totalDuration / records.length) : 0;
  const longest = records.reduce((max, r) => Math.max(max, getFaxDuration(r)), 0);

  const uniqueDates = new Set(
    records
      .map(r => (r.startTime || r.createdDate || "").slice(0, 10))
      .filter(Boolean)
  );

  setText("kpiTotal", records.length);
  setText("kpiAvg", formatSeconds(avgDuration));
  setText("kpiLongest", formatSeconds(longest));
  setText("kpiDates", uniqueDates.size || "--");
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderDailyBreakdown(records) {
  const container = document.getElementById("dailyBreakdown");
  const meta = document.getElementById("reportMeta");

  if (!container) return;

  const counts = new Map();

  for (const r of records) {
    const key = (r.startTime || r.createdDate || "Unknown").slice(0, 10) || "Unknown";
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  if (meta) {
    meta.textContent = records.length ? `${records.length} fax records loaded.` : "No fax records loaded.";
  }

  if (!counts.size) {
    container.innerHTML = `<div class="daily-card muted">No fax records for this range.</div>`;
    return;
  }

  container.innerHTML = Array.from(counts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => `
      <div class="daily-card">
        <strong>${date}</strong>
        <span>${count} fax records</span>
      </div>
    `)
    .join("");
}

function renderTable(records) {
  if (!reportBody) return;

  if (!records.length) {
    reportBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading">No fax records found for this range.</td>
      </tr>
    `;
    return;
  }

  reportBody.innerHTML = records.map(row => `
    <tr>
      <td>${row.id || "-"}</td>
      <td>${formatDate(row.startTime || row.createdDate)}</td>
      <td>${getCallerNumber(row)}</td>
      <td>${getFaxNumber(row)}</td>
      <td>${row.termLocation || "-"}</td>
      <td>${row.callType || "-"}</td>
      <td>${row.callFlagType || "-"}</td>
      <td>${formatSeconds(getFaxDuration(row))}</td>
      <td>${row.meanOpinionScoreAverage || "-"}</td>
    </tr>
  `).join("");
}

// =====================================================
// EXPORTS
// =====================================================
exportBtn?.addEventListener("click", exportCsv);
printPdfBtn?.addEventListener("click", function () {
  window.print();
});

function exportCsv() {
  const data = lastReportData;
  const records = data?.records || [];

  if (!records.length) {
    alert("No fax records to export.");
    return;
  }

  const headers = [
    "ID",
    "Start Time Central",
    "Original Number",
    "Fax Number",
    "Term Location",
    "Call Type",
    "Call Flag Type",
    "Duration Seconds",
    "Orig City",
    "Orig State",
    "Term City",
    "Term State",
    "Media Server Type",
    "Application Type"
  ];

  const rows = records.map(r => [
    r.id || "",
    formatDate(r.startTime || r.createdDate),
    getCallerNumber(r),
    getFaxNumber(r),
    r.termLocation || "",
    r.callType || "",
    r.callFlagType || "",
    getFaxDuration(r),
    r.origCityName || "",
    r.origState || "",
    r.termCityName || "",
    r.termState || "",
    r.mediaServerType || "",
    r.applicationData?.type || ""
  ]);

  const csv = [headers, ...rows]
    .map(row => row.map(csvCell).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `VisionBank-Fax-Report-${data.range || "report"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

// =====================================================
// SCHEDULE
// =====================================================
scheduleReportBtn?.addEventListener("click", async function () {
  schedulePanel?.classList.toggle("hidden");
  await loadSchedule();
});

saveScheduleBtn?.addEventListener("click", saveSchedule);
newScheduleBtn?.addEventListener("click", resetScheduleForm);

sendDailyBtn?.addEventListener("click", async function () {
  await sendFaxReport(reportRange?.value || "today");
});

testScheduleBtn?.addEventListener("click", async function () {
  await sendFaxReport(scheduleRange?.value || reportRange?.value || "today");
});

async function loadSchedule() {
  if (!scheduleStatus) return;

  scheduleStatus.textContent = "Loading schedules...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/fax/schedule/get`);
    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Unable to load schedules.");
    }

    savedSchedules = data.schedules || [];

    renderScheduleTable(savedSchedules);

    if (savedSchedules.length) {
      fillScheduleForm(savedSchedules[0]);
    } else {
      resetScheduleForm();
    }

    scheduleStatus.textContent = `Schedules loaded. Total: ${savedSchedules.length}`;

  } catch (err) {
    console.error("Load fax schedule error:", err);
    scheduleStatus.textContent = `Unable to load schedules: ${err.message}`;
  }
}
function fillScheduleForm(schedule) {
  currentScheduleId = schedule.id || null;

  scheduleEnabled.value = String(Boolean(schedule.enabled));
  scheduleRecipients.value = Array.isArray(schedule.recipients)
    ? schedule.recipients.join(", ")
    : "";

  scheduleFrequency.value = schedule.frequency || "daily";
  scheduleRange.value = schedule.range || "today";
  scheduleSendTime.value = schedule.sendTime || "17:00";

  scheduleMonthlyRule.value = schedule.monthlyRule || "last-day";
  scheduleMonthlyDay.value = schedule.monthlyDay || 1;
  scheduleAttachmentType.value = schedule.attachmentType || "pdf";
}

function resetScheduleForm() {
  currentScheduleId = null;

  scheduleEnabled.value = "true";
  scheduleRecipients.value = "";
  scheduleFrequency.value = "daily";
  scheduleRange.value = "today";
  scheduleSendTime.value = "17:00";
  scheduleMonthlyRule.value = "last-day";
  scheduleMonthlyDay.value = 1;
  scheduleAttachmentType.value = "pdf";

  scheduleStatus.textContent = "Creating a new schedule.";
}

function renderScheduleTable(schedules) {
  if (!scheduleTableBody) return;

  if (scheduleCount) {
    scheduleCount.textContent = schedules.length
      ? `${schedules.length} schedule(s) saved.`
      : "No schedules saved.";
  }

  if (!schedules.length) {
    scheduleTableBody.innerHTML = `
      <tr>
        <td colspan="9" class="loading">No schedules saved.</td>
      </tr>
    `;
    return;
  }

  scheduleTableBody.innerHTML = schedules.map(s => `
    <tr>
      <td>${s.name || "-"}</td>
      <td>${s.enabled ? "Enabled" : "Disabled"}</td>
      <td>${s.frequency || "-"}</td>
      <td>${rangeLabel(s.range || "-")}</td>
      <td>${s.sendTime || "-"}</td>
      <td>${s.monthlyRule || "-"}</td>
      <td>${s.attachmentType || "pdf"}</td>
      <td>${s.lastSentAt ? formatDate(s.lastSentAt) : "Never"}</td>
      <td>
        <button class="btn-secondary edit-schedule-btn" data-id="${s.id}">Edit</button>
        <button class="btn-secondary delete-schedule-btn" data-id="${s.id}">Delete</button>
      </td>
    </tr>
  `).join("");

  document.querySelectorAll(".edit-schedule-btn").forEach(btn => {
    btn.addEventListener("click", function () {
      const id = this.dataset.id;
      const schedule = savedSchedules.find(s => s.id === id);
      if (schedule) {
        fillScheduleForm(schedule);
        scheduleStatus.textContent = `Editing schedule: ${schedule.name || id}`;
      }
    });
  });

  document.querySelectorAll(".delete-schedule-btn").forEach(btn => {
    btn.addEventListener("click", async function () {
      const id = this.dataset.id;
      await deleteSchedule(id);
    });
  });
}
async function saveSchedule() {
  if (!scheduleStatus) return;

  scheduleStatus.textContent = "Saving schedule...";

  try {
    const payload = {
      id: currentScheduleId,
      name: `${scheduleFrequency.value || "daily"} fax report - ${scheduleSendTime.value || "17:00"}`,
      enabled: scheduleEnabled.value === "true",
      recipients: scheduleRecipients.value,
      frequency: scheduleFrequency.value || "daily",
      range: scheduleRange.value || "today",
      sendTime: scheduleSendTime.value || "17:00",
      timezone: "America/Chicago",
      monthlyRule: scheduleMonthlyRule.value || "last-day",
      monthlyDay: Number(scheduleMonthlyDay.value || 1),
      attachmentType: scheduleAttachmentType.value || "pdf"
    };

    const res = await fetch(`${SECURITY_BASE}/api/fax/schedule/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Unable to save schedule.");
    }

    savedSchedules = data.schedules || [];
    currentScheduleId = data.schedule?.id || null;

    renderScheduleTable(savedSchedules);
    if (data.schedule) {
  fillScheduleForm(data.schedule);
}

    scheduleStatus.textContent = "Schedule saved successfully.";

  } catch (err) {
    console.error("Save fax schedule error:", err);
    scheduleStatus.textContent = `Unable to save schedule: ${err.message}`;
  }
}
async function deleteSchedule(id) {
  if (!id) return;

  const ok = confirm("Delete this fax schedule?");
  if (!ok) return;

  scheduleStatus.textContent = "Deleting schedule...";

  try {
    const res = await fetch(`${SECURITY_BASE}/api/fax/schedule/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Unable to delete schedule.");
    }

    savedSchedules = data.schedules || [];
    renderScheduleTable(savedSchedules);
    resetScheduleForm();

    scheduleStatus.textContent = "Schedule deleted.";

  } catch (err) {
    console.error("Delete fax schedule error:", err);
    scheduleStatus.textContent = `Unable to delete schedule: ${err.message}`;
  }
}
async function sendFaxReport(range) {
  const ok = confirm(`Send fax report for ${rangeLabel(range)} now?`);
  if (!ok) return;

  try {
    const res = await fetch(`${SECURITY_BASE}/api/fax/send-daily?range=${encodeURIComponent(range)}`, {
      method: "POST"
    });

    const data = await res.json();

    if (!res.ok || data.success === false) {
      throw new Error(data.error || "Unable to send fax report.");
    }

    alert(`Fax report sent successfully. Recipients: ${(data.sentTo || []).join(", ")}`);

  } catch (err) {
    console.error("Send fax report error:", err);
    alert(`Unable to send fax report: ${err.message}`);
  }
}

// =====================================================
// INIT
// =====================================================
(async function init() {
  const allowed = await runSecurityCheck();
  if (!allowed) return;

  const existingSession = sessionStorage.getItem("vb_fax_session");

  if (existingSession) {
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");
    await loadReport();
  } else {
    loginView.classList.remove("hidden");
    appView.classList.add("hidden");
  }
})();
