(() => {
  "use strict";

  const DASHBOARD_ENDPOINT = "https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/dashboard";
  const REPORTS_ENDPOINT = "https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/daily-reports";
  const TRENDS_ENDPOINT = "https://visionbank-security.ahmedadeyemi.workers.dev/api/webex/analytics-trends";
  const CENTRAL = "America/Chicago";
  const TREND_TABS = new Set(["hourly", "daycompare", "weekcompare"]);

  let dashboard = null;
  let reports = null;
  let trends = null;
  let dashboardAt = 0;
  let reportsAt = 0;
  let trendsAt = 0;
  let dTimer = null;
  let rTimer = null;
  let activeTab = "overview";

  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
  const n = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const count = v => n(v) !== null ? n(v).toLocaleString() : "—";
  const pct = v => n(v) !== null ? `${n(v).toFixed(1)}%` : "—";
  const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
  const fmtTime = e => Number.isFinite(Number(e))
    ? new Date(Number(e)).toLocaleString("en-US", {timeZone:CENTRAL,hour:"numeric",minute:"2-digit",second:"2-digit",timeZoneName:"short"})
    : "—";
  const dur = v => {
    const m = String(v || "").match(/^(\d+):(\d{2}):(\d{2})$/);
    return m ? (+m[1] * 3600) + (+m[2] * 60) + (+m[3]) : null;
  };
  const fmtDur = s => Number.isFinite(s)
    ? `${String(Math.floor(s/3600)).padStart(2,"0")}:${String(Math.floor((s%3600)/60)).padStart(2,"0")}:${String(Math.round(s%60)).padStart(2,"0")}`
    : "—";

  function status(msg, kind = "") {
    const el = $("enterpriseAnalyticsStatus");
    if (el) {
      el.textContent = msg;
      el.dataset.kind = kind;
    }
  }

  async function getJson(url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45000);
    try {
      const response = await fetch(url, {
        cache:"no-store",
        credentials:"omit",
        signal:controller.signal,
        headers:{Accept:"application/json"}
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  function validDashboard(d) {
    return d?.success === true &&
      Number.isFinite(d.generatedAtEpoch) &&
      Array.isArray(d.queues) &&
      Array.isArray(d.agents) &&
      d.statistics;
  }

  function validReports(d) {
    return Number.isFinite(d?.generatedAtEpoch) &&
      Array.isArray(d?.answeredCalls) &&
      Array.isArray(d?.abandonedCalls) &&
      d.summary;
  }

  function validTotals(t) {
    return t && ["chat","inboundCeg","outbound","total"].every(k => Number.isSafeInteger(t[k]) && t[k] >= 0);
  }

  function validTrends(d) {
    return d?.success === true &&
      d.schemaVersion === 1 &&
      d.timezone === CENTRAL &&
      Number.isFinite(d.generatedAtEpoch) &&
      validTotals(d.periods?.today?.totals) &&
      validTotals(d.periods?.yesterday?.totals) &&
      validTotals(d.periods?.thisWeek?.totals) &&
      validTotals(d.periods?.lastWeek?.totals) &&
      Array.isArray(d.hourlyToday) &&
      d.hourlyToday.length === 24 &&
      Array.isArray(d.weekDays?.current) &&
      Array.isArray(d.weekDays?.previous);
  }

  function state(a) {
    const s = String(a?.status || "").toLowerCase();
    if (/engaged|connected|talk/.test(s)) return "Engaged";
    if (/available|ready/.test(s)) return "Available";
    if (s.includes("wrap")) return "Wrap-up";
    if (/idle|logged in|lunch|meeting|training/.test(s)) return "Idle";
    return "Other";
  }

  function renderOverview() {
    if (!dashboard) return;
    const g = dashboard.statistics || {};
    const agents = dashboard.agents || [];
    const states = agents.reduce((acc, row) => {
      const key = state(row);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});

    set("eaAgentsLoggedIn", count(agents.length));
    set("eaAgentsAvailable", count(states.Available || 0));
    set("eaAgentsEngaged", count(states.Engaged || 0));
    set("eaCallsWaiting", count(g.totalCallsQueued));
    set("eaServiceLevel", pct(g.serviceLevel));
    set("eaAnswerRate", pct(g.answerRate));
    set("eaAbandonRate", pct(g.abandonRate));
    set("eaMaxWait", String(g.maxQueueWaitingTime || "00:00:00"));
    set("eaCallbacksWaiting", count(g.callbacksWaiting));
    set("eaCallbacksRegistered", count(g.callbacksRegistered));

    const stateHost = $("eaStateDistribution");
    if (stateHost) {
      stateHost.innerHTML = ["Available","Engaged","Wrap-up","Idle","Other"].map(key => {
        const value = states[key] || 0;
        const width = agents.length ? Math.max(value ? 3 : 0, (value / agents.length) * 100) : 0;
        return `<div class="ea-bar-row"><div class="ea-bar-label"><span>${key}</span><strong>${value}</strong></div><div class="ea-track"><span style="width:${width}%"></span></div></div>`;
      }).join("");
    }

    const queues = (dashboard.queues || []).slice().sort((a,b) => Number(b.calls || 0) - Number(a.calls || 0));
    const queueHost = $("eaQueuePressure");
    const max = Math.max(1, ...queues.map(q => Number(q.calls || 0)));
    if (queueHost) {
      queueHost.innerHTML = queues.length
        ? queues.slice(0,8).map(q => {
            const calls = Number(q.calls || 0);
            const agents = Number(q.agents || 0);
            const width = Math.max(calls ? 6 : 0, (calls / max) * 100);
            return `<div class="ea-queue-card"><div><strong>${esc(q.name || q.displayName || "Queue")}</strong><small>${agents} agent${agents===1?"":"s"} · ${esc(q.maxWait || q.maxWaitingTime || "00:00:00")} max wait</small></div><div class="ea-queue-meter"><span style="width:${width}%"></span></div><b>${calls} waiting</b></div>`;
          }).join("")
        : '<p class="ea-empty">No queue rows were returned.</p>';
    }
  }

  function renderLeaderboard() {
    const host = $("eaLeaderboardRows");
    if (!host || !dashboard) return;
    const rows = (dashboard.agents || []).map(a => ({
      ...a,
      inbound:Number(a.inbound || 0),
      outbound:Number(a.outbound || 0),
      missed:Number(a.missed || 0),
      transferred:Number(a.transferred || 0)
    }));
    rows.forEach(a => a.handled = a.inbound + a.outbound);
    rows.sort((a,b) => b.handled - a.handled || b.inbound - a.inbound || a.missed - b.missed);
    host.innerHTML = rows.length
      ? rows.map((a,i) => `<tr><td>${i+1}</td><td><strong>${esc(a.name || "Unknown")}</strong><small>${esc(a.team || "—")}</small></td><td>${state(a)}</td><td>${a.inbound}</td><td>${a.outbound}</td><td>${a.missed}</td><td>${a.transferred}</td><td>${esc(a.avgHandle || "00:00:00")}</td></tr>`).join("")
      : '<tr><td colspan="8" class="ea-empty">No current agent-session data returned.</td></tr>';
  }

  function renderHourlyAnswered() {
    const host = $("eaHourlyChart");
    if (!host) return;
    if (!reports) {
      host.innerHTML = '<p class="ea-empty">Daily report data is loading.</p>';
      return;
    }
    const buckets = new Map(Array.from({length:24},(_,h) => [h,{answered:0,abandoned:0}]));
    const add = (rows,key) => rows.forEach(row => {
      if (!Number.isFinite(Number(row.startEpoch))) return;
      const parts = new Intl.DateTimeFormat("en-US",{timeZone:CENTRAL,hour:"numeric",hour12:false})
        .formatToParts(new Date(Number(row.startEpoch)));
      const hour = Number(parts.find(x => x.type === "hour")?.value);
      if (buckets.has(hour)) buckets.get(hour)[key]++;
    });
    add(reports.answeredCalls || [], "answered");
    add(reports.abandonedCalls || [], "abandoned");
    const seen = [...buckets.entries()].filter(([,v]) => v.answered || v.abandoned);
    const max = Math.max(1, ...seen.map(([,v]) => Math.max(v.answered,v.abandoned)));
    host.innerHTML = seen.length
      ? seen.map(([hour,v]) => `<div class="ea-hour"><div class="ea-hour-bars"><span class="ea-hour-answered" style="height:${Math.max(v.answered?5:0,(v.answered/max)*100)}%" title="Answered ${v.answered}"></span><span class="ea-hour-abandoned" style="height:${Math.max(v.abandoned?5:0,(v.abandoned/max)*100)}%" title="Abandoned ${v.abandoned}"></span></div><small>${String(hour).padStart(2,"0")}:00</small></div>`).join("")
      : '<p class="ea-empty">No answered or abandoned rows reported for today.</p>';
  }

  function renderDaily() {
    if (!reports) return;
    const summary = reports.summary || {};
    const rows = reports.answeredCalls || [];
    set("eaTodayReceived", count(summary.totalCallsReceived));
    set("eaTodayAnswered", count(summary.answeredCalls));
    set("eaTodayAbandoned", count(summary.abandonedCalls));
    set("eaTodayTransferred", count(summary.transferredOutCalls));

    const talk = rows.map(r => dur(r.talkTime)).filter(Number.isFinite);
    const queue = rows.map(r => dur(r.ivrQueueTime)).filter(Number.isFinite);
    set("eaAvgTalk", fmtDur(talk.length ? talk.reduce((a,b) => a+b,0) / talk.length : null));
    set("eaAvgQueue", fmtDur(queue.length ? queue.reduce((a,b) => a+b,0) / queue.length : null));
    renderHourlyAnswered();
  }

  const trendLabels = {
    chat:"Chat",
    inboundCeg:"Inbound — CEG Queue",
    outbound:"Outbound Calls",
    total:"Combined activity"
  };

  function compareValue(current, previous) {
    const a = Number(current || 0);
    const b = Number(previous || 0);
    const diff = a - b;
    const percent = b > 0 ? (diff / b) * 100 : (a > 0 ? null : 0);
    return {
      diff,
      diffText:`${diff > 0 ? "+" : ""}${diff.toLocaleString()}`,
      percent,
      percentText:percent === null ? "New activity" : `${percent > 0 ? "+" : ""}${percent.toFixed(1)}%`
    };
  }

  function renderBusiest() {
    if (!trends) return;
    const config = [
      ["Combined","combined","contacts"],
      ["Chat","chat","chats"],
      ["Inbound","inboundCeg","inbound calls"],
      ["Outbound","outbound","outbound calls"]
    ];
    for (const [id,key,noun] of config) {
      const row = trends.busiest?.[key] || {};
      set("eaBusiest" + id, row.count > 0 ? row.label : "No activity yet");
      set("eaBusiest" + id + "Count", row.count > 0 ? `${count(row.count)} ${noun}` : `0 ${noun}`);
    }
  }

  function renderActivityByHour() {
    const host = $("eaActivityHourly");
    if (!host) return;
    if (!trends) {
      host.innerHTML = '<p class="ea-empty">Historical trend data is loading.</p>';
      return;
    }

    const rows = trends.hourlyToday.filter(row => row?.observed === true);
    const max = Math.max(1, ...rows.flatMap(row => [row.chat,row.inboundCeg,row.outbound].map(Number)));
    const busiestHour = trends.busiest?.combined?.hour;

    host.innerHTML = rows.length ? rows.map(row => {
      const classes = ["ea-activity-hour"];
      if (row.hour === busiestHour && Number(row.total) > 0) classes.push("busiest");
      if (row.partial) classes.push("partial");
      const series = [
        ["Chat","chat",row.chat],
        ["CEG Queue","inbound",row.inboundCeg],
        ["Outbound","outbound",row.outbound]
      ].map(([label,tone,value]) => {
        const width = Math.max(Number(value) ? 2 : 0, (Number(value || 0) / max) * 100);
        return `<div class="ea-activity-series"><span>${label}</span><div class="ea-activity-track"><i class="${tone}" style="width:${width}%"></i></div><strong>${count(value)}</strong></div>`;
      }).join("");
      return `<div class="${classes.join(" ")}"><div class="ea-activity-hour-label"><strong>${esc(row.label)}</strong><small>${row.partial ? "Current hour · partial" : (row.hour === busiestHour && Number(row.total) > 0 ? "Busiest combined" : "Central Time")}</small></div><div class="ea-activity-series-wrap">${series}</div><div class="ea-activity-total"><strong>${count(row.total)}</strong><span>Total</span></div></div>`;
    }).join("") : '<p class="ea-empty">No observed hours are available.</p>';

    renderBusiest();
    set("eaTrendFreshness", `Trend snapshot: ${fmtTime(trends.generatedAtEpoch)} · Central Time`);
  }

  function renderCompareCards(hostId, current, previous, currentLabel, previousLabel) {
    const host = $(hostId);
    if (!host || !current || !previous) return;
    const keys = ["chat","inboundCeg","outbound","total"];
    host.innerHTML = keys.map(key => {
      const change = compareValue(current[key], previous[key]);
      return `<article class="ea-compare-card"><span>${esc(trendLabels[key])}</span><strong>${count(current[key])}</strong><small>${esc(currentLabel)}</small><div class="ea-compare-baseline"><b>${count(previous[key])}</b><span>${esc(previousLabel)}</span></div><div class="ea-compare-change">${esc(change.diffText)} · ${esc(change.percentText)}</div></article>`;
    }).join("");
  }

  function renderCompareRows(hostId, current, previous) {
    const host = $(hostId);
    if (!host || !current || !previous) return;
    host.innerHTML = ["chat","inboundCeg","outbound","total"].map(key => {
      const change = compareValue(current[key], previous[key]);
      return `<tr><td><strong>${esc(trendLabels[key])}</strong></td><td>${count(current[key])}</td><td>${count(previous[key])}</td><td>${esc(change.diffText)}</td><td>${esc(change.percentText)}</td></tr>`;
    }).join("");
  }

  function renderDayComparison() {
    if (!trends) return;
    const today = trends.periods.today;
    const yesterday = trends.periods.yesterday;
    renderCompareCards("eaDayCompareCards", today.totals, yesterday.totals, today.label, yesterday.label);
    renderCompareRows("eaDayCompareRows", today.totals, yesterday.totals);
  }

  function renderWeekdayComparison() {
    const host = $("eaWeekdayCompare");
    if (!host || !trends) return;
    const current = trends.weekDays?.current || [];
    const previous = trends.weekDays?.previous || [];
    const rows = current.filter(row => row?.observed === true);
    const max = Math.max(1, ...rows.flatMap(row => {
      const old = previous.find(x => x.index === row.index);
      return [Number(row.total || 0), Number(old?.total || 0)];
    }));

    host.innerHTML = rows.length ? rows.map(row => {
      const old = previous.find(x => x.index === row.index) || {total:0,chat:0,inboundCeg:0,outbound:0};
      const currentWidth = Math.max(Number(row.total) ? 2 : 0, Number(row.total || 0) / max * 100);
      const previousWidth = Math.max(Number(old.total) ? 2 : 0, Number(old.total || 0) / max * 100);
      return `<div class="ea-weekday-row"><div class="ea-weekday-label"><strong>${esc(row.label)}</strong><small>${row.partial ? "Current day · partial" : "Central Time"}</small></div><div class="ea-weekday-bars"><div><span>This week</span><div class="ea-week-track"><i class="current" style="width:${currentWidth}%"></i></div><b>${count(row.total)}</b></div><div><span>Last week</span><div class="ea-week-track"><i class="previous" style="width:${previousWidth}%"></i></div><b>${count(old.total)}</b></div></div><div class="ea-weekday-breakdown"><span>This week: Chat ${count(row.chat)} · CEG ${count(row.inboundCeg)} · Outbound ${count(row.outbound)}</span><span>Last week: Chat ${count(old.chat)} · CEG ${count(old.inboundCeg)} · Outbound ${count(old.outbound)}</span></div></div>`;
    }).join("") : '<p class="ea-empty">No week-to-date rows are available.</p>';
  }

  function renderWeekComparison() {
    if (!trends) return;
    const current = trends.periods.thisWeek;
    const previous = trends.periods.lastWeek;
    renderCompareCards("eaWeekCompareCards", current.totals, previous.totals, current.label, previous.label);
    renderWeekdayComparison();
  }

  function renderTrends() {
    if (!trends) return;
    renderActivityByHour();
    renderDayComparison();
    renderWeekComparison();
  }

  function renderFresh() {
    set("eaRealtimeFreshness", dashboard ? `Realtime snapshot: ${fmtTime(dashboard.generatedAtEpoch)}` : "Realtime snapshot unavailable");
    set("eaDailyFreshness", reports ? `Daily reporting: ${fmtTime(reports.generatedAtEpoch)}` : "Daily reporting unavailable");
    const fresh = dashboard && Date.now() - Number(dashboard.generatedAtEpoch) < 150000;
    status(
      fresh ? "Enterprise analytics synchronized with the live dashboard." : "Showing the latest available data; live reporting is delayed.",
      fresh ? "ok" : "warn"
    );
  }

  function renderAll() {
    renderOverview();
    renderLeaderboard();
    renderDaily();
    renderTrends();
    renderFresh();
  }

  async function refreshDashboard(force = false) {
    if (window.VB_SECURITY && window.VB_SECURITY.allowed !== true) return;
    if (!force && dashboard && Date.now() - dashboardAt < 10000) return;
    try {
      const data = await getJson(DASHBOARD_ENDPOINT + (force ? "?refresh=1" : ""));
      if (!validDashboard(data)) throw new Error("Incomplete dashboard response");
      dashboard = data;
      dashboardAt = Date.now();
      renderAll();
    } catch (error) {
      console.debug("Enterprise analytics dashboard refresh deferred:", error?.message || error);
      renderFresh();
    }
  }

  async function refreshReports(force = false) {
    if (window.VB_SECURITY && window.VB_SECURITY.allowed !== true) return;
    if (!force && reports && Date.now() - reportsAt < 30000) return;
    try {
      const data = await getJson(REPORTS_ENDPOINT + (force ? "?refresh=1" : ""));
      if (!validReports(data)) throw new Error("Incomplete daily report response");
      reports = data;
      reportsAt = Date.now();
      renderAll();
    } catch (error) {
      console.debug("Enterprise analytics daily refresh deferred:", error?.message || error);
      renderFresh();
    }
  }

  function renderTrendError(message) {
    const safe = esc(message || "Historical trend data is temporarily unavailable.");
    const hourly = $("eaActivityHourly");
    if (hourly) hourly.innerHTML = `<p class="ea-empty">${safe}</p>`;
    for (const id of ["eaDayCompareCards","eaWeekCompareCards","eaWeekdayCompare"]) {
      const host = $(id);
      if (host) host.innerHTML = `<p class="ea-empty">${safe}</p>`;
    }
    for (const [id,colspan] of [["eaDayCompareRows",5]]) {
      const host = $(id);
      if (host) host.innerHTML = `<tr><td colspan="${colspan}" class="ea-empty">${safe}</td></tr>`;
    }
    set("eaTrendFreshness", "Historical trend data unavailable; retrying when this view is opened or refreshed.");
  }

  async function refreshTrends(force = false) {
    if (window.VB_SECURITY && window.VB_SECURITY.allowed !== true) return;
    if (!force && trends && Date.now() - trendsAt < 4 * 60 * 1000) {
      renderTrends();
      return;
    }
    try {
      set("eaTrendFreshness", "Loading historical contact trends…");
      const data = await getJson(TRENDS_ENDPOINT + (force ? "?refresh=1" : ""));
      if (!validTrends(data)) throw new Error("Incomplete historical trend response");
      trends = data;
      trendsAt = Date.now();
      renderTrends();
    } catch (error) {
      console.debug("Enterprise analytics trend refresh deferred:", error?.message || error);
      renderTrendError("Historical trend data is temporarily unavailable.");
    }
  }

  function activateTab(button) {
    const tab = button.dataset.eaTab;
    activeTab = tab;
    document.querySelectorAll("[data-ea-tab]").forEach(b => {
      const selected = b === button;
      b.classList.toggle("active", selected);
      b.setAttribute("aria-selected", String(selected));
    });
    document.querySelectorAll("[data-ea-view]").forEach(view => {
      view.hidden = view.dataset.eaView !== tab;
    });
    if (TREND_TABS.has(tab)) void refreshTrends(false);
  }

  function bind() {
    document.querySelectorAll("[data-ea-tab]").forEach(button => {
      button.setAttribute("role","tab");
      button.setAttribute("aria-selected", String(button.classList.contains("active")));
      button.addEventListener("click", () => activateTab(button));
    });

    const refresh = $("enterpriseAnalyticsRefresh");
    if (refresh) {
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        status("Refreshing enterprise analytics…");
        const jobs = [refreshDashboard(true), refreshReports(true)];
        if (trends || TREND_TABS.has(activeTab)) jobs.push(refreshTrends(true));
        try {
          await Promise.all(jobs);
        } finally {
          refresh.disabled = false;
        }
      });
    }
  }

  function init() {
    bind();
    void refreshDashboard(true);
    void refreshReports(true);
    dTimer = setInterval(() => void refreshDashboard(false), 30000);
    rTimer = setInterval(() => void refreshReports(false), 60000);
    window.addEventListener("pagehide", () => {
      clearInterval(dTimer);
      clearInterval(rTimer);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, {once:true});
  } else {
    init();
  }
})();