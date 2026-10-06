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
  let reportReady = false;
  let refreshTimer = null;
  let requestInFlight = null;
  let lastDisplayKey = '';
  const centralDate = at => new Intl.DateTimeFormat('en-CA',{timeZone:REPORT_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(at);
  function reportCurrent() {
    const at=lastPayload?.generatedAtEpoch,now=Date.now();
    return window.VB_SECURITY?.allowed===true&&reportReady&&Number.isFinite(at)&&now-at>=-5000&&now-at<150000&&centralDate(at)===centralDate(now);
  }
  const displayCount = v => Number.isSafeInteger(v)&&v>=0?v.toLocaleString():'—';
  const rateFromCounts = (n,d) => Number.isSafeInteger(n)&&n>=0&&Number.isSafeInteger(d)&&d>0&&n<=d?(100*n/d).toFixed(1)+'%':'—';
  const displayedDuration = v => typeof v==='string'&&/^\d{2,}:\d{2}:\d{2}$/.test(v)?v:'Not reported';
  function refreshDisplay() {
    const key=[window.VB_SECURITY?.allowed===true,reportCurrent(),lastPayload?.generatedAtEpoch].join(':');
    if(key===lastDisplayKey)return;lastDisplayKey=key;
    renderSummary(lastPayload?.summary||{});renderOperatingMode(lastPayload||{});setReportMeta(lastPayload);
    renderTable('answered');renderTable('abandoned');
  }
  window.VB_DAILY_REPORT_STATUS=Object.freeze({refresh:refreshDisplay,current:reportCurrent});

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


  function phoneKey(value) {
    const digits = String(value ?? "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
    if (digits.length === 10) return digits;
    return digits.length >= 7 ? digits : "";
  }

  function sameDestination(a, b) {
    const left = phoneKey(a);
    const right = phoneKey(b);
    return !!left && !!right && left === right;
  }

  function followupLabel(code) {
    return ({
      "needs-followup": "Needs Follow-up",
      "returned-unresolved": "Called Back — Not Helped",
      "helped": "Called Back — Helped",
      "review": "Possible Return — Needs Review"
    })[code] || "Needs Follow-up";
  }

  function correlateAbandonedFollowups(abandonedRows, answeredRows) {
    const answered = Array.isArray(answeredRows) ? answeredRows : [];
    const abandoned = Array.isArray(abandonedRows) ? abandonedRows : [];
    const answeredByAni = new Map();
    const abandonedByAni = new Map();

    for (const row of answered) {
      const ani = phoneKey(row?.ani);
      if (!ani || !Number.isFinite(row?.startEpoch)) continue;
      if (!answeredByAni.has(ani)) answeredByAni.set(ani, []);
      answeredByAni.get(ani).push(row);
    }
    for (const row of abandoned) {
      const ani = phoneKey(row?.ani);
      if (!ani || !Number.isFinite(row?.startEpoch)) continue;
      if (!abandonedByAni.has(ani)) abandonedByAni.set(ani, []);
      abandonedByAni.get(ani).push(row);
    }
    for (const rows of answeredByAni.values()) rows.sort((a,b) => Number(a.startEpoch) - Number(b.startEpoch));
    for (const rows of abandonedByAni.values()) rows.sort((a,b) => Number(a.startEpoch) - Number(b.startEpoch));

    return abandoned.map(row => {
      const ani = phoneKey(row?.ani);
      const after = Math.max(Number(row?.endEpoch || 0), Number(row?.startEpoch || 0));
      if (!ani || !after) return {
        ...row,
        followupCode:"needs-followup",
        followupLabel:followupLabel("needs-followup"),
        followupEpoch:null,
        followupTimeCentral:"—",
        followupAgent:"—",
        followupDetail:"No later same-number contact was found in today's reporting scope."
      };

      const laterAnswered = (answeredByAni.get(ani) || []).filter(candidate =>
        Number(candidate.startEpoch) > after && String(candidate.contactId || "") !== String(row.contactId || "")
      );
      const laterAbandoned = (abandonedByAni.get(ani) || []).filter(candidate =>
        Number(candidate.startEpoch) > after && String(candidate.contactId || "") !== String(row.contactId || "")
      );

      const exactAnswered = laterAnswered.find(candidate => sameDestination(row.dnis, candidate.dnis));
      if (exactAnswered) return {
        ...row,
        followupCode:"helped",
        followupLabel:followupLabel("helped"),
        followupEpoch:Number(exactAnswered.startEpoch),
        followupTimeCentral:exactAnswered.startTimeCentral || "—",
        followupAgent:exactAnswered.agentName || "Answered by agent",
        followupDetail:"Same ANI and called number returned later and the later contact was answered."
      };

      const possibleAnswered = laterAnswered[0];
      if (possibleAnswered) return {
        ...row,
        followupCode:"review",
        followupLabel:followupLabel("review"),
        followupEpoch:Number(possibleAnswered.startEpoch),
        followupTimeCentral:possibleAnswered.startTimeCentral || "—",
        followupAgent:possibleAnswered.agentName || "Answered by agent",
        followupDetail:"Same ANI later reached an agent, but the called number differs or is unavailable. Review before excluding from follow-up."
      };

      const exactAbandoned = laterAbandoned.find(candidate => sameDestination(row.dnis, candidate.dnis));
      if (exactAbandoned) return {
        ...row,
        followupCode:"returned-unresolved",
        followupLabel:followupLabel("returned-unresolved"),
        followupEpoch:Number(exactAbandoned.startEpoch),
        followupTimeCentral:exactAbandoned.startTimeCentral || "—",
        followupAgent:"—",
        followupDetail:"Same ANI and called number returned later but abandoned again."
      };

      const possibleAbandoned = laterAbandoned[0];
      if (possibleAbandoned) return {
        ...row,
        followupCode:"review",
        followupLabel:followupLabel("review"),
        followupEpoch:Number(possibleAbandoned.startEpoch),
        followupTimeCentral:possibleAbandoned.startTimeCentral || "—",
        followupAgent:"—",
        followupDetail:"Same ANI returned later but the called number differs or is unavailable. Review before deciding follow-up."
      };

      return {
        ...row,
        followupCode:"needs-followup",
        followupLabel:followupLabel("needs-followup"),
        followupEpoch:null,
        followupTimeCentral:"—",
        followupAgent:"—",
        followupDetail:"No later same-number contact was found in today's reporting scope."
      };
    });
  }

  function getFollowupFilter() {
    return byId("abandonedFollowupFilter")?.value || "all";
  }

  function renderFollowupSummary() {
    const rows = states.abandoned.rows || [];
    const totals = rows.reduce((acc,row) => {
      const key = row.followupCode || "needs-followup";
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const summary = byId("abandonedFollowupSummary");
    if (!summary) return;
    if (!reportCurrent()) {
      summary.textContent = "Return-call correlation is unavailable until the current daily report is ready.";
      return;
    }
    summary.textContent = [
      `${totals["needs-followup"] || 0} need follow-up`,
      `${totals["returned-unresolved"] || 0} returned but unresolved`,
      `${totals.helped || 0} confirmed helped`,
      `${totals.review || 0} need review`
    ].join(" · ") + ". Confirmed-helped rows are excluded from dashboard callback scheduling.";
  }

  function setText(id, value) {
    const el = byId(id);
    if (el) el.textContent = value;
  }

  function formatRate(value) {
    return typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=100?`${value.toFixed(1)}%`:'—';
  }

  function ensureTransitionUi() {
    const totalCard = byId("dailyTotalReceived")?.closest(".stat-card");
    const summary = totalCard?.parentElement;

    if (summary && !byId("dailyTransferredOut")) {
      const card = document.createElement("div");
      card.className = "stat-card";
      card.id = "dailyTransferredOutCard";
      card.innerHTML = `
        <div class="stat-value" id="dailyTransferredOut">--</div>
        <div class="stat-label">Transferred Out Today</div>
      `;

      const abandonedCard = byId("dailyAbandoned")?.closest(".stat-card");
      if (abandonedCard?.nextSibling) {
        summary.insertBefore(card, abandonedCard.nextSibling);
      } else {
        summary.appendChild(card);
      }
    }

    const answerRate = byId("dailyAnswerRate");
    const answerRateLabel = answerRate?.closest(".stat-card")?.querySelector(".stat-label");
    if (answerRateLabel) {answerRateLabel.textContent = "Answered / received";answerRateLabel.parentElement.title='Answered contacts / all received inbound Voice contacts started today. Offered-based answer rate is in Voice Statistics.';}
    const abandonRateLabel=byId('dailyAbandonRate')?.closest('.stat-card')?.querySelector('.stat-label');
    if(abandonRateLabel){abandonRateLabel.textContent='Abandoned / received';abandonRateLabel.parentElement.title='Abandoned contacts / all received inbound Voice contacts started today. Queue-entry abandonment rate is in Voice Statistics.';}

    if (summary && !byId("dailyOperatingModeNotice")) {
      const notice = document.createElement("div");
      notice.id = "dailyOperatingModeNotice";
      notice.setAttribute("role", "status");
      notice.style.display = "none";
      notice.style.margin = "-6px 0 18px";
      notice.style.padding = "10px 12px";
      notice.style.border = "1px solid #cbd5e1";
      notice.style.borderRadius = "8px";
      notice.style.background = "rgba(59, 130, 246, 0.08)";
      notice.style.fontSize = "12px";
      notice.style.lineHeight = "1.45";
      notice.style.color = "inherit";
      summary.insertAdjacentElement("afterend", notice);
    }
  }

  function renderOperatingMode(payload = {}) {
    ensureTransitionUi();
    const notice = byId("dailyOperatingModeNotice");
    if (!notice) return;

    const transferredOut=payload?.summary?.transferredOutCalls;
    if(reportCurrent()&&Number.isSafeInteger(transferredOut)&&transferredOut>0){
      notice.textContent=`${transferredOut.toLocaleString()} inbound contact(s) transferred out today. This does not establish whether a person answered at the destination. Daily rates here use all received calls; Voice Statistics shows the separate offered-based rate.`;
      notice.style.display='block';
    }else{notice.textContent='';notice.style.display='none';}
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
      row.agentName,
      row.followupLabel,
      row.followupTimeCentral,
      row.followupAgent,
      row.followupDetail
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

    if (kind === "abandoned") {
      const followup = getFollowupFilter();
      if (followup !== "all") {
        state.filtered = state.filtered.filter(row => row.followupCode === followup);
      }
    }

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
        <td>${html(displayedDuration(row.ivrQueueTime))}</td>
        <td>${html(displayedDuration(row.talkTime))}</td>
        <td>${html(displayedDuration(row.totalCallDuration))}</td>
        <td>${row.transferred===true ? "Yes" : row.transferred===false ? "No" : "Not reported"}</td>
        <td>${html(row.transferred ? (row.transferredTo || "Not provided by Webex") : "-")}</td>
      </tr>`;
  }

  function renderAbandonedRow(row) {
    const code = row.followupCode || "needs-followup";
    const title = row.followupDetail || followupLabel(code);
    return `
      <tr class="vb-followup-row vb-followup-row-${html(code)}">
        <td>${html(row.ani || "-")}</td>
        <td>${html(row.dnis || "-")}</td>
        <td>${html(row.startTimeCentral || "-")}</td>
        <td>${html(displayedDuration(row.totalCallDuration))}</td>
        <td>${html(displayedDuration(row.totalIvrQueueDuration))}</td>
        <td>${html(displayedDuration(row.timeToAbandon))}</td>
        <td>${html(row.abandonmentStage || "Abandoned")}</td>
        <td>${html(row.agentName || "-")}</td>
        <td><span class="vb-followup-status vb-followup-status-${html(code)}" title="${html(title)}">${html(row.followupLabel || followupLabel(code))}</span></td>
        <td>${html(row.followupTimeCentral || "—")}</td>
        <td>${html(row.followupAgent || "—")}</td>
      </tr>`;
  }

  function renderTable(kind) {
    const state = states[kind];
    const exportButton=byId(kind==='answered'?'exportAnsweredCalls':'exportAbandonedCalls');
    if(exportButton)exportButton.disabled=!reportCurrent();
    if(!reportCurrent()){
      const body=byId(kind==='answered'?'answeredCallsBody':'abandonedCallsBody');
      if(body)body.innerHTML=`<tr><td colspan="${kind==='answered'?10:11}" class="report-empty">${window.VB_SECURITY?.allowed!==true?'Reporting access is not approved.':'Report is loading, stale, or unavailable. Retrying automatically; no zero totals are inferred.'}</td></tr>`;
      for(const suffix of ['PrevPage','NextPage']){const b=byId(kind+suffix);if(b)b.disabled=true;}
      setText(kind+'RecordCount','Not reported');setText(kind+'PageStatus','Not reported');
      if(kind==='abandoned'){
        renderFollowupSummary();
        window.VB_ABANDONED_SELECTION?.invalidate('Current abandoned-call reporting is unavailable.');
      }
      return;
    }
    applyFilterSort(kind);

    const body = byId(kind === "answered" ? "answeredCallsBody" : "abandonedCallsBody");
    if (!body) return;

    const start = (state.page - 1) * REPORT_PAGE_SIZE;
    const pageRows = state.filtered.slice(start, start + REPORT_PAGE_SIZE);
    const colspan = kind === "answered" ? 10 : 11;

    if (!pageRows.length) {
      const filtered = getSearchValue(kind) || (kind === "abandoned" && getFollowupFilter() !== "all");
      const empty=filtered?'No calls match the current search or follow-up filter.':kind==='answered'?'No answered calls in today’s reporting scope.':'No abandoned calls in today’s reporting scope.';
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
    if (kind === "abandoned") {
      renderFollowupSummary();
      window.VB_ABANDONED_SELECTION?.render();
    }
  }

  function renderSummary(summary = {}) {
    ensureTransitionUi();
    const valid=reportCurrent(),value=key=>valid?summary[key]:null;
    setText('dailyTotalReceived',displayCount(value('totalCallsReceived')));
    setText('dailyAnswered',displayCount(value('answeredCalls')));
    setText('dailyAbandoned',displayCount(value('abandonedCalls')));
    setText('dailyTransferredOut',displayCount(value('transferredOutCalls')));
    setText('dailyAnswerRate',rateFromCounts(value('answeredCalls'),value('totalCallsReceived')));
    setText('dailyAbandonRate',rateFromCounts(value('abandonedCalls'),value('totalCallsReceived')));

    const transferCard = byId("dailyTransferredOutCard");
    if (transferCard) {
      transferCard.title = `Transferred out rate: ${formatRate(summary.transferredOutRate)}`;
    }
  }

  function setReportMeta(payload) {
    const label=Number.isFinite(payload?.generatedAtEpoch)?new Date(payload.generatedAtEpoch).toLocaleString('en-US',{timeZone:REPORT_TIMEZONE,timeZoneName:'short'}):'Not reported';
    const scope=reportCurrent()?`Inbound Voice contacts started today · America/Chicago · Updated ${label}`:`Daily reporting unavailable or stale · Last response: ${label}`;
    setText('answeredCallsMeta',scope);setText('abandonedCallsMeta',scope);
  }

  function setLoading(kind, message) {
    if (kind === "abandoned") reportReady = false;
    const body = byId(kind === "answered" ? "answeredCallsBody" : "abandonedCallsBody");
    if (!body) return;
    if (kind === "abandoned") window.VB_ABANDONED_SELECTION?.invalidate(message);
    const colspan = kind === "answered" ? 10 : 11;
    body.innerHTML = `<tr><td colspan="${colspan}" class="loading">${html(message)}</td></tr>`;
    if (kind === "abandoned") renderFollowupSummary();
  }

  async function fetchDailyReports(force = false) {
    if (requestInFlight) return requestInFlight;

    requestInFlight = (async () => {
      const controller=new AbortController();
      const timer=setTimeout(()=>controller.abort(),45000);
      try {
        const suffix = force ? "?refresh=1" : "";
        const res = await fetch(`${REPORTS_ENDPOINT}${suffix}`, {
          signal: controller.signal,
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

        if(!Array.isArray(data.answeredCalls)||!Array.isArray(data.abandonedCalls)||!data.summary||!Number.isFinite(data.generatedAtEpoch))throw new Error('Daily report response is incomplete.');
        lastPayload = data;
        reportReady = true;
        states.answered.rows = Array.isArray(data.answeredCalls) ? data.answeredCalls : [];
        states.abandoned.rows = correlateAbandonedFollowups(
          Array.isArray(data.abandonedCalls) ? data.abandonedCalls : [],
          states.answered.rows
        );

        renderSummary(data.summary || {});
        renderOperatingMode(data);
        setReportMeta(data);
        renderTable("answered");
        renderTable("abandoned");
      } catch (err) {
        reportReady=false;renderSummary({});renderOperatingMode({});setReportMeta(lastPayload);
        for(const id of ['exportAnsweredCalls','exportAbandonedCalls']){const button=byId(id);if(button)button.disabled=true;}
        console.error("Webex daily report load failed:", err);
        setLoading("answered", `Unable to load answered-call report: ${err.message}`);
        setLoading("abandoned", `Unable to load abandoned-call report: ${err.message}`);
      } finally {
        clearTimeout(timer);
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

  function bindFollowupFilter() {
    byId("abandonedFollowupFilter")?.addEventListener("change", () => {
      states.abandoned.page = 1;
      renderTable("abandoned");
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
    if(!reportCurrent())return;
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
      displayedDuration(row.ivrQueueTime),
      displayedDuration(row.talkTime),
      displayedDuration(row.totalCallDuration),
      row.transferred===true ? "Yes" : row.transferred===false ? "No" : "Not reported",
      row.transferred ? (row.transferredTo || "Not provided by Webex") : "-"
    ]);

    downloadBlob(buildXlsx("Answered Calls", headers, rows), `webex-answered-calls-${businessDateForFile()}.xlsx`);
  }

  function exportAbandoned() {
    if(!reportCurrent())return;
    applyFilterSort("abandoned");
    const headers = [
      "ANI",
      "Called Number (DNIS)",
      "Start Time (CST/CDT)",
      "Total Call Duration",
      "Total IVR / Queue Duration",
      "Time to Abandon",
      "Abandonment Stage",
      "Agent Name",
      "Follow-up Status",
      "Return Call Time",
      "Handled By",
      "Follow-up Detail"
    ];
    const rows = states.abandoned.filtered.map(row => [
      row.ani || "-",
      row.dnis || "-",
      row.startTimeCentral || "-",
      displayedDuration(row.totalCallDuration),
      displayedDuration(row.totalIvrQueueDuration),
      displayedDuration(row.timeToAbandon),
      row.abandonmentStage || "Abandoned",
      row.agentName || "-",
      row.followupLabel || followupLabel(row.followupCode),
      row.followupTimeCentral || "—",
      row.followupAgent || "—",
      row.followupDetail || "—"
    ]);

    downloadBlob(buildXlsx("Abandoned Calls", headers, rows), `webex-abandoned-calls-${businessDateForFile()}.xlsx`);
  }

  function initialize() {
    if (!byId("answeredCallsBody") || !byId("abandonedCallsBody")) return;

    ensureTransitionUi();
    bindSearch("answered");
    bindSearch("abandoned");
    bindFollowupFilter();
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

    const observer=new MutationObserver(refreshDisplay);observer.observe(document.body,{attributes:true,attributeFilter:['class']});
    document.addEventListener('visibilitychange',refreshDisplay);
    refreshTimer = window.setInterval(() => {refreshDisplay();void fetchDailyReports(false);}, REPORT_REFRESH_MS);
    window.addEventListener("beforeunload", () => {
      observer.disconnect();
      if (refreshTimer) window.clearInterval(refreshTimer);
    }, { once: true });
  }

  // Read-only selection bridge; native scheduling always revalidates source data server-side.
  window.VB_ABANDONED_REPORT = Object.freeze({
    snapshot() {
      if (window.VB_SECURITY?.allowed !== true) return null;
      const s = states.abandoned, start = (s.page - 1) * REPORT_PAGE_SIZE;
      const search=getSearchValue('abandoned'),followup=getFollowupFilter();
      return { rows: s.rows, filtered: s.filtered, pageRows: s.filtered.slice(start, start + REPORT_PAGE_SIZE),
        ready: reportCurrent(), filter: [search,followup!=='all'?followup:''].filter(Boolean).join('|'), observedAt: lastPayload?.generatedAtEpoch ?? null };
    },
    redraw() { renderTable('abandoned'); }
  });

  window.VB_WEBEX_REPORTS_TEST = {
    buildXlsx,
    buildSheetXml,
    createStoredZip,
    crc32,
    states,
    phoneKey,
    sameDestination,
    followupLabel,
    correlateAbandonedFollowups,
    applyFilterSort,
    ensureTransitionUi,
    renderOperatingMode,
    formatRate,displayCount,rateFromCounts,displayedDuration,reportCurrent,refreshDisplay,renderSummary
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize, { once: true });
  } else {
    initialize();
  }
})();