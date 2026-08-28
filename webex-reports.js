(() => {
  "use strict";

  const REPORTS_API_BASE = "https://visionbank-security.ahmedadeyemi.workers.dev";
  const REPORTS_ENDPOINT = `${REPORTS_API_BASE}/api/webex/daily-reports`;
  const REPORT_TIMEZONE = "America/Chicago";
  const REPORT_REFRESH_MS = 60 * 1000;
  const REPORT_PAGE_SIZE = 25;

  const states = {
    answered: {
      rows: [],
      filtered: [],
      page: 1,
      sortKey: "startEpoch",
      sortDirection: "desc"
    },
    abandoned: {
      rows: [],
      filtered: [],
      page: 1,
      sortKey: "startEpoch",
      sortDirection: "desc"
    }
  };

  let lastPayload = null;
  let refreshTimer = null;
  let requestInFlight = null;

  function byId(id) {
    return document.getElementById(id);
  }

  function html(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value ?? "").trim().toLowerCase();
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function formatRate(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `${n.toFixed(1)}%` : "0.0%";
  }

  function compareValues(a, b, key) {
    const av = a?.[key];
    const bv = b?.[key];

    if (typeof av === "number" || typeof bv === "number") {
      return Number(av || 0) - Number(bv || 0);
    }

    return String(av ?? "").localeCompare(String(bv ?? ""), undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  function searchableText(kind, row) {
    if (kind === "answered") {
      return [
        row.ani,
        row.dnis,
        row.agentName,
        row.transferredTo,
        row.startTimeCentral,
        row.endTimeCentral
      ].map(normalize).join(" ");
    }

    return [
      row.ani,
      row.dnis,
      row.abandonmentStage,
      row.startTimeCentral,
      row.agentName
    ].map(normalize).join(" ");
  }

  function getSearchValue(kind) {
    return normalize(byId(kind === "answered" ? "answeredCallsSearch" : "abandonedCallsSearch")?.value);
  }

  function applyFilterSort(kind) {
    const state = states[kind];
    const term = getSearchValue(kind);

    state.filtered = term
      ? state.rows.filter(row => searchableText(kind, row).includes(term))
      : [...state.rows];

    state.filtered.sort((a, b) => {
      const result = compareValues(a, b, state.sortKey);
      return state.sortDirection === "asc" ? result : -result;
    });

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / REPORT_PAGE_SIZE));
    if (state.page > totalPages) state.page = totalPages;
  }

  function renderSortIndicators(kind) {
    const tableId = kind === "answered" ? "answeredCallsTable" : "abandonedCallsTable";
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
      const base = th.dataset.label || th.textContent.replace(/[▲▼]/g, "").trim();
      th.dataset.label = base;
      const active = th.dataset.sort === states[kind].sortKey;
      const arrow = active ? (states[kind].sortDirection === "asc" ? " ▲" : " ▼") : "";
      th.textContent = `${base}${arrow}`;
      th.setAttribute("aria-sort", active ? (states[kind].sortDirection === "asc" ? "ascending" : "descending") : "none");
    });
  }

  function renderAnsweredRow(row) {
    return `
      <tr>
        <td>${html(row.ani || "-")}</td>
        <td>${html(row.dnis || "-")}</td>
        <td>${html(row.agentName || "-")}</td>
        <td>${html(row.startTimeCentral || "-")}</td>
        <td>${html(row.endTimeCentral || "-")}</td>
        <td>${html(row.ivrQueueTime || "00:00:00")}</td>
        <td>${html(row.talkTime || "00:00:00")}</td>
        <td>${html(row.totalCallDuration || "00:00:00")}</td>
        <td>${row.transferred ? "Yes" : "No"}</td>
        <td>${html(row.transferred ? (row.transferredTo || "Not provided by Webex") : "-")}</td>
      </tr>`;
  }

  function renderAbandonedRow(row) {
    return `
      <tr>
        <td>${html(row.ani || "-")}</td>
        <td>${html(row.dnis || "-")}</td>
        <td>${html(row.startTimeCentral || "-")}</td>
        <td>${html(row.totalCallDuration || "00:00:00")}</td>
        <td>${html(row.totalIvrQueueDuration || "00:00:00")}</td>
        <td>${html(row.timeToAbandon || "00:00:00")}</td>
        <td>${html(row.abandonmentStage || "Abandoned")}</td>
        <td>${html(row.agentName || "-")}</td>
      </tr>`;
  }

  function renderTable(kind) {
    const state = states[kind];
    applyFilterSort(kind);

    const body = byId(kind === "answered" ? "answeredCallsBody" : "abandonedCallsBody");
    if (!body) return;

    const start = (state.page - 1) * REPORT_PAGE_SIZE;
    const pageRows = state.filtered.slice(start, start + REPORT_PAGE_SIZE);
    const colspan = kind === "answered" ? 10 : 8;

    if (!pageRows.length) {
      const empty = kind === "answered" ? "No answered calls today." : "No abandoned calls today.";
      body.innerHTML = `<tr><td colspan="${colspan}" class="report-empty">${empty}</td></tr>`;
    } else {
      body.innerHTML = pageRows
        .map(kind === "answered" ? renderAnsweredRow : renderAbandonedRow)
        .join("");
    }

    const totalPages = Math.max(1, Math.ceil(state.filtered.length / REPORT_PAGE_SIZE));
    setText(kind === "answered" ? "answeredRecordCount" : "abandonedRecordCount", `${state.filtered.length} record${state.filtered.length === 1 ? "" : "s"}`);
    setText(kind === "answered" ? "answeredPageStatus" : "abandonedPageStatus", `Page ${state.page} of ${totalPages}`);

    const prev = byId(kind === "answered" ? "answeredPrevPage" : "abandonedPrevPage");
    const next = byId(kind === "answered" ? "answeredNextPage" : "abandonedNextPage");
    if (prev) prev.disabled = state.page <= 1;
    if (next) next.disabled = state.page >= totalPages;

    renderSortIndicators(kind);
  }

  function renderSummary(summary = {}) {
    setText("dailyTotalReceived", Number(summary.totalCallsReceived || 0).toLocaleString());
    setText("dailyAnswered", Number(summary.answeredCalls || 0).toLocaleString());
    setText("dailyAbandoned", Number(summary.abandonedCalls || 0).toLocaleString());
    setText("dailyAnswerRate", formatRate(summary.answerRate));
    setText("dailyAbandonRate", formatRate(summary.abandonRate));
  }

  function setReportMeta(payload) {
    const label = payload?.generatedAtCentral || "-";
    setText("answeredCallsMeta", `America/Chicago business day • Updated ${label}`);
    setText("abandonedCallsMeta", `America/Chicago business day • Updated ${label}`);
  }

  function setLoading(kind, message) {
    const body = byId(kind === "answered" ? "answeredCallsBody" : "abandonedCallsBody");
    if (!body) return;
    const colspan = kind === "answered" ? 10 : 8;
    body.innerHTML = `<tr><td colspan="${colspan}" class="loading">${html(message)}</td></tr>`;
  }

  async function fetchDailyReports(force = false) {
    if (requestInFlight && !force) return requestInFlight;

    requestInFlight = (async () => {
      try {
        const suffix = force ? "?refresh=1" : "";
        const res = await fetch(`${REPORTS_ENDPOINT}${suffix}`, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          headers: { "Accept": "application/json" }
        });

        let data = {};
        try {
          data = await res.json();
        } catch {
          throw new Error(`Daily report endpoint returned HTTP ${res.status} with invalid JSON.`);
        }

        if (!res.ok || data?.success !== true) {
          throw new Error(data?.error || `Daily report endpoint returned HTTP ${res.status}.`);
        }

        lastPayload = data;
        states.answered.rows = Array.isArray(data.answeredCalls) ? data.answeredCalls : [];
        states.abandoned.rows = Array.isArray(data.abandonedCalls) ? data.abandonedCalls : [];

        renderSummary(data.summary || {});
        setReportMeta(data);
        renderTable("answered");
        renderTable("abandoned");
      } catch (err) {
        console.error("Webex daily report load failed:", err);
        setLoading("answered", `Unable to load answered-call report: ${err.message}`);
        setLoading("abandoned", `Unable to load abandoned-call report: ${err.message}`);
      } finally {
        requestInFlight = null;
      }
    })();

    return requestInFlight;
  }

  function bindSearch(kind) {
    const input = byId(kind === "answered" ? "answeredCallsSearch" : "abandonedCallsSearch");
    input?.addEventListener("input", () => {
      states[kind].page = 1;
      renderTable(kind);
    });
  }

  function bindPagination(kind) {
    const prev = byId(kind === "answered" ? "answeredPrevPage" : "abandonedPrevPage");
    const next = byId(kind === "answered" ? "answeredNextPage" : "abandonedNextPage");

    prev?.addEventListener("click", () => {
      if (states[kind].page > 1) {
        states[kind].page--;
        renderTable(kind);
      }
    });

    next?.addEventListener("click", () => {
      const pages = Math.max(1, Math.ceil(states[kind].filtered.length / REPORT_PAGE_SIZE));
      if (states[kind].page < pages) {
        states[kind].page++;
        renderTable(kind);
      }
    });
  }

  function bindSorting(kind) {
    const tableId = kind === "answered" ? "answeredCallsTable" : "abandonedCallsTable";
    document.querySelectorAll(`#${tableId} th[data-sort]`).forEach(th => {
      th.tabIndex = 0;
      th.classList.add("sortable-report-column");

      const activate = () => {
        const key = th.dataset.sort;
        if (!key) return;
        if (states[kind].sortKey === key) {
          states[kind].sortDirection = states[kind].sortDirection === "asc" ? "desc" : "asc";
        } else {
          states[kind].sortKey = key;
          states[kind].sortDirection = "asc";
        }
        states[kind].page = 1;
        renderTable(kind);
      };

      th.addEventListener("click", activate);
      th.addEventListener("keydown", event => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate();
        }
      });
    });
  }

  function xml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  function columnName(index) {
    let n = index + 1;
    let name = "";
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc ^= bytes[i];
      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function utf8(value) {
    return new TextEncoder().encode(value);
  }

  function concatBytes(parts) {
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function zipHeader(size) {
    return new Uint8Array(size);
  }

  function writeU16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function writeU32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function createStoredZip(files) {
    const localParts = [];
    const centralParts = [];
    let offset = 0;
    const stamp = dosDateTime();

    files.forEach(file => {
      const nameBytes = utf8(file.name);
      const dataBytes = utf8(file.content);
      const crc = crc32(dataBytes);

      const local = zipHeader(30 + nameBytes.length);
      const localView = new DataView(local.buffer);
      writeU32(localView, 0, 0x04034b50);
      writeU16(localView, 4, 20);
      writeU16(localView, 6, 0x0800);
      writeU16(localView, 8, 0);
      writeU16(localView, 10, stamp.time);
      writeU16(localView, 12, stamp.day);
      writeU32(localView, 14, crc);
      writeU32(localView, 18, dataBytes.length);
      writeU32(localView, 22, dataBytes.length);
      writeU16(localView, 26, nameBytes.length);
      writeU16(localView, 28, 0);
      local.set(nameBytes, 30);

      const central = zipHeader(46 + nameBytes.length);
      const centralView = new DataView(central.buffer);
      writeU32(centralView, 0, 0x02014b50);
      writeU16(centralView, 4, 20);
      writeU16(centralView, 6, 20);
      writeU16(centralView, 8, 0x0800);
      writeU16(centralView, 10, 0);
      writeU16(centralView, 12, stamp.time);
      writeU16(centralView, 14, stamp.day);
      writeU32(centralView, 16, crc);
      writeU32(centralView, 20, dataBytes.length);
      writeU32(centralView, 24, dataBytes.length);
      writeU16(centralView, 28, nameBytes.length);
      writeU16(centralView, 30, 0);
      writeU16(centralView, 32, 0);
      writeU16(centralView, 34, 0);
      writeU16(centralView, 36, 0);
      writeU32(centralView, 38, 0);
      writeU32(centralView, 42, offset);
      central.set(nameBytes, 46);

      localParts.push(local, dataBytes);
      centralParts.push(central);
      offset += local.length + dataBytes.length;
    });

    const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
    const end = zipHeader(22);
    const endView = new DataView(end.buffer);
    writeU32(endView, 0, 0x06054b50);
    writeU16(endView, 4, 0);
    writeU16(endView, 6, 0);
    writeU16(endView, 8, files.length);
    writeU16(endView, 10, files.length);
    writeU32(endView, 12, centralSize);
    writeU32(endView, 16, offset);
    writeU16(endView, 20, 0);

    return concatBytes([...localParts, ...centralParts, end]);
  }

  function buildSheetXml(headers, rows) {
    const allRows = [headers, ...rows];
    const rowXml = allRows.map((row, rowIndex) => {
      const cells = row.map((value, colIndex) => {
        const ref = `${columnName(colIndex)}${rowIndex + 1}`;
        return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
      }).join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    }).join("");

    const endCol = columnName(headers.length - 1);
    const endRow = Math.max(1, allRows.length);

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<sheetData>${rowXml}</sheetData>` +
      `<autoFilter ref="A1:${endCol}${endRow}"/>` +
      `</worksheet>`;
  }

  function buildXlsx(sheetName, headers, rows) {
    const safeSheetName = String(sheetName || "Report").slice(0, 31).replace(/[\\/?*\[\]:]/g, "-");
    const files = [
      {
        name: "[Content_Types].xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
          `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
          `<Default Extension="xml" ContentType="application/xml"/>` +
          `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
          `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
          `</Types>`
      },
      {
        name: "_rels/.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
          `</Relationships>`
      },
      {
        name: "xl/workbook.xml",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
          `<sheets><sheet name="${xml(safeSheetName)}" sheetId="1" r:id="rId1"/></sheets>` +
          `</workbook>`
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
          `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
          `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
          `</Relationships>`
      },
      {
        name: "xl/worksheets/sheet1.xml",
        content: buildSheetXml(headers, rows)
      }
    ];

    return new Blob([createStoredZip(files)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  }

  function businessDateForFile() {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).formatToParts(new Date());

    const values = Object.fromEntries(parts.filter(p => p.type !== "literal").map(p => [p.type, p.value]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportAnswered() {
    applyFilterSort("answered");
    const headers = [
      "Customer Number (ANI)",
      "Called Number (DNIS)",
      "Agent Name",
      "Start Time (CST/CDT)",
      "End Time (CST/CDT)",
      "IVR / Queue Time",
      "Talk Time",
      "Total Call Duration",
      "Transferred",
      "Transferred To"
    ];
    const rows = states.answered.filtered.map(row => [
      row.ani || "-",
      row.dnis || "-",
      row.agentName || "-",
      row.startTimeCentral || "-",
      row.endTimeCentral || "-",
      row.ivrQueueTime || "00:00:00",
      row.talkTime || "00:00:00",
      row.totalCallDuration || "00:00:00",
      row.transferred ? "Yes" : "No",
      row.transferred ? (row.transferredTo || "Not provided by Webex") : "-"
    ]);

    downloadBlob(buildXlsx("Answered Calls", headers, rows), `webex-answered-calls-${businessDateForFile()}.xlsx`);
  }

  function exportAbandoned() {
    applyFilterSort("abandoned");
    const headers = [
      "ANI",
      "Called Number (DNIS)",
      "Start Time (CST/CDT)",
      "Total Call Duration",
      "Total IVR / Queue Duration",
      "Time to Abandon",
      "Abandonment Stage",
      "Agent Name"
    ];
    const rows = states.abandoned.filtered.map(row => [
      row.ani || "-",
      row.dnis || "-",
      row.startTimeCentral || "-",
      row.totalCallDuration || "00:00:00",
      row.totalIvrQueueDuration || "00:00:00",
      row.timeToAbandon || "00:00:00",
      row.abandonmentStage || "Abandoned",
      row.agentName || "-"
    ]);

    downloadBlob(buildXlsx("Abandoned Calls", headers, rows), `webex-abandoned-calls-${businessDateForFile()}.xlsx`);
  }

  function initialize() {
    if (!byId("answeredCallsBody") || !byId("abandonedCallsBody")) return;

    bindSearch("answered");
    bindSearch("abandoned");
    bindPagination("answered");
    bindPagination("abandoned");
    bindSorting("answered");
    bindSorting("abandoned");

    byId("exportAnsweredCalls")?.addEventListener("click", exportAnswered);
    byId("exportAbandonedCalls")?.addEventListener("click", exportAbandoned);
    byId("refreshDailyReports")?.addEventListener("click", () => fetchDailyReports(true));

    setLoading("answered", "Loading today's answered calls…");
    setLoading("abandoned", "Loading today's abandoned calls…");
    fetchDailyReports();

    refreshTimer = window.setInterval(() => fetchDailyReports(false), REPORT_REFRESH_MS);
    window.addEventListener("beforeunload", () => {
      if (refreshTimer) window.clearInterval(refreshTimer);
    }, { once: true });
  }

  window.VB_WEBEX_REPORTS_TEST = {
    buildXlsx,
    buildSheetXml,
    createStoredZip,
    crc32,
    states,
    applyFilterSort
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();
