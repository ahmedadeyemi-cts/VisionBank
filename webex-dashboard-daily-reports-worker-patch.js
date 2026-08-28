/*
 * VisionBank Webex Dashboard - Daily Reporting Extension
 * Branch-only development patch. DO NOT deploy by itself.
 *
 * Merge this block into the CURRENT production dashboard Worker
 * (visionbank-worker-webex-dashboard.js), which already provides:
 *   checkAccess, json, webexSearchPaged, paginationArgument,
 *   formatWebexEpochCentral, formatWebexDurationMs,
 *   getCentralDayStartEpochMs, getCentralDateKeyFromEpoch,
 *   WEBEX_CENTRAL_TIMEZONE.
 *
 * Add this route beside the existing /api/webex/dashboard routes:
 *
 * if (path === "/api/webex/daily-reports" && method === "GET") {
 *   return handleWebexDailyReports(request, env, cors);
 * }
 */

const WEBEX_DAILY_REPORT_BUILD = "2026.08.28-v1";
const WEBEX_DAILY_REPORT_CACHE_MS = 60 * 1000;

let webexDailyReportCache = null;
let webexDailyReportCacheAt = 0;
let webexDailyReportPromise = null;

async function fetchWebexDailyReportTasks(env, from, to) {
  return webexSearchPaged(
    env,
    cursor => `
      {
        taskDetails(
          from: ${from}
          to: ${to}
          ${paginationArgument(cursor)}
        ) {
          tasks {
            id
            isActive
            status
            channelType
            direction
            createdTime
            endedTime
            lastActivityTime
            origin
            destination
            terminationType
            terminationReason
            terminatingEnd
            abandonedType
            contactHandleType
            isContactOffered
            isContactHandled
            connectedCount
            connectedDuration
            queueCount
            queueDuration
            selfserviceDuration
            ringingDuration
            totalDuration
            transferCount
            blindTransferCount
            agentToDnTransferCount
            agentToAgentTransferCount
            agentToEntrypointTransferCount
            agentToQueueTransferCount
            transferEpDN
            lastQueue { id name duration }
            lastAgent { id name signInId sessionId phoneNumber }
            activities(first: 100) {
              totalCount
              nodes {
                id
                isActive
                createdTime
                endedTime
                lastActivityTime
                agentId
                agentName
                agentPhoneNumber
                agentSessionId
                entrypointId
                entrypointName
                queueId
                queueName
                transferType
                activityType
                activityName
                eventName
                previousState
                nextState
                duration
                destinationAgentPhoneNumber
                destinationAgentId
                destinationAgentName
                destinationQueueName
                destinationQueueId
                terminationReason
                consultEpId
                consultEpName
              }
              pageInfo { hasNextPage endCursor }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    "taskDetails",
    "tasks"
  );
}

function webexReportNumber(value) {
  return String(value ?? "").trim();
}

function webexReportMs(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function webexReportEpoch(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n < 1e12 ? n * 1000 : n;
}

function webexReportDurationBetween(start, end) {
  const startMs = webexReportEpoch(start);
  const endMs = webexReportEpoch(end);
  return startMs && endMs && endMs >= startMs ? endMs - startMs : 0;
}

function getWebexReportTotalDurationMs(task) {
  return webexReportMs(task?.totalDuration) ||
    webexReportDurationBetween(task?.createdTime, task?.endedTime || task?.lastActivityTime);
}

function getWebexReportIvrQueueMs(task) {
  return webexReportMs(task?.selfserviceDuration) + webexReportMs(task?.queueDuration);
}

function isInboundWebexTelephony(task) {
  return String(task?.channelType || "").toLowerCase() === "telephony" &&
    String(task?.direction || "").toLowerCase() === "inbound";
}

function isAnsweredWebexContact(task) {
  return task?.isContactHandled === true ||
    webexReportMs(task?.connectedCount) > 0 ||
    webexReportMs(task?.connectedDuration) > 0;
}

function isAbandonedWebexContact(task) {
  if (isAnsweredWebexContact(task)) return false;

  const abandonedType = String(task?.abandonedType || "").trim();
  const handleType = String(task?.contactHandleType || "").toLowerCase();
  const termination = String(task?.terminationReason || "").toLowerCase();

  return Boolean(abandonedType) ||
    handleType.includes("abandon") ||
    termination.includes("customer left");
}

function activityText(activity) {
  return [
    activity?.transferType,
    activity?.activityType,
    activity?.activityName,
    activity?.eventName,
    activity?.previousState,
    activity?.nextState
  ].map(value => String(value || "").toLowerCase()).join(" ");
}

function hasWebexTransferEvidence(task) {
  const count = [
    task?.transferCount,
    task?.blindTransferCount,
    task?.agentToDnTransferCount,
    task?.agentToAgentTransferCount,
    task?.agentToEntrypointTransferCount,
    task?.agentToQueueTransferCount
  ].some(value => Number(value || 0) > 0);

  if (count || webexReportNumber(task?.transferEpDN)) return true;

  return (task?.activities?.nodes || []).some(activity =>
    activityText(activity).includes("transfer") ||
    webexReportNumber(activity?.destinationAgentPhoneNumber) ||
    webexReportNumber(activity?.destinationAgentName) ||
    webexReportNumber(activity?.destinationQueueName)
  );
}

function getWebexTransferDestination(task) {
  const directDn = webexReportNumber(task?.transferEpDN);
  if (directDn) return directDn;

  const activities = [...(task?.activities?.nodes || [])].sort((a, b) =>
    Number(b?.createdTime || b?.lastActivityTime || 0) -
    Number(a?.createdTime || a?.lastActivityTime || 0)
  );

  for (const activity of activities) {
    const destinationNumber = webexReportNumber(activity?.destinationAgentPhoneNumber);
    if (destinationNumber) return destinationNumber;
  }

  for (const activity of activities) {
    const destinationAgent = webexReportNumber(activity?.destinationAgentName);
    if (destinationAgent) return destinationAgent;

    const destinationQueue = webexReportNumber(activity?.destinationQueueName);
    if (destinationQueue) return destinationQueue;

    const destinationEp = webexReportNumber(activity?.consultEpName);
    if (destinationEp && activityText(activity).includes("transfer")) return destinationEp;
  }

  return "-";
}

function getWebexAnsweredAgentName(task) {
  const lastAgent = webexReportNumber(task?.lastAgent?.name);
  if (lastAgent) return lastAgent;

  const connectedActivity = (task?.activities?.nodes || []).find(activity => {
    if (!activity?.agentName) return false;
    const text = activityText(activity);
    return text.includes("connect") || text.includes("talk") || text.includes("handled");
  });

  return webexReportNumber(connectedActivity?.agentName) || "-";
}

function getQueueWaitBucket(queueMs) {
  const minute = 60 * 1000;
  if (queueMs < minute) return "Queue Wait < 1 Min";
  if (queueMs < 5 * minute) return "Queue Wait 1–5 Min";
  if (queueMs < 10 * minute) return "Queue Wait 5–10 Min";
  return "Queue Wait > 10 Min";
}

function getWebexAbandonmentStage(task) {
  const type = String(task?.abandonedType || "").trim().toLowerCase();
  const queueMs = webexReportMs(task?.queueDuration);
  const ivrMs = webexReportMs(task?.selfserviceDuration);

  if (type === "queue" || type.includes("queue")) {
    return getQueueWaitBucket(queueMs);
  }

  if (type === "agent-connect" || type.includes("agent-connect") || type.includes("agent_connect")) {
    return "Abandoned During Agent Connect";
  }

  if (
    type === "new" ||
    type === "treatment" ||
    type.includes("ivr") ||
    type.includes("treatment") ||
    (queueMs <= 0 && ivrMs > 0)
  ) {
    return "Abandoned in IVR";
  }

  if (queueMs > 0) return getQueueWaitBucket(queueMs);
  return "Abandoned Before Queue";
}

function buildAnsweredWebexReportRow(task) {
  const startEpoch = webexReportEpoch(task?.createdTime);
  const endEpoch = webexReportEpoch(task?.endedTime || task?.lastActivityTime);
  const ivrQueueMs = getWebexReportIvrQueueMs(task);
  const talkMs = webexReportMs(task?.connectedDuration);
  const totalDurationMs = getWebexReportTotalDurationMs(task);
  const transferred = hasWebexTransferEvidence(task);

  return {
    contactId: String(task?.id || ""),
    ani: webexReportNumber(task?.origin) || "-",
    dnis: webexReportNumber(task?.destination) || "-",
    agentName: getWebexAnsweredAgentName(task),
    startEpoch,
    endEpoch,
    startTimeCentral: formatWebexEpochCentral(startEpoch),
    endTimeCentral: formatWebexEpochCentral(endEpoch),
    ivrQueueMs,
    ivrQueueTime: formatWebexDurationMs(ivrQueueMs),
    talkMs,
    talkTime: formatWebexDurationMs(talkMs),
    totalDurationMs,
    totalCallDuration: formatWebexDurationMs(totalDurationMs),
    transferred,
    transferredTo: transferred ? getWebexTransferDestination(task) : "-"
  };
}

function buildAbandonedWebexReportRow(task) {
  const startEpoch = webexReportEpoch(task?.createdTime);
  const endEpoch = webexReportEpoch(task?.endedTime || task?.lastActivityTime);
  const totalDurationMs = getWebexReportTotalDurationMs(task);
  const totalIvrQueueMs = getWebexReportIvrQueueMs(task);

  // For an unhandled abandoned contact, the complete customer-session
  // duration is the most accurate "time to abandon" available. It includes
  // the applicable IVR/queue/ringing path and never invents an agent leg.
  const timeToAbandonMs = totalDurationMs || totalIvrQueueMs;

  return {
    contactId: String(task?.id || ""),
    ani: webexReportNumber(task?.origin) || "-",
    dnis: webexReportNumber(task?.destination) || "-",
    startEpoch,
    endEpoch,
    startTimeCentral: formatWebexEpochCentral(startEpoch),
    totalDurationMs,
    totalCallDuration: formatWebexDurationMs(totalDurationMs),
    totalIvrQueueMs,
    totalIvrQueueDuration: formatWebexDurationMs(totalIvrQueueMs),
    timeToAbandonMs,
    timeToAbandon: formatWebexDurationMs(timeToAbandonMs),
    abandonmentStage: getWebexAbandonmentStage(task),
    abandonedType: webexReportNumber(task?.abandonedType) || "-",
    agentName: "-"
  };
}

function buildWebexDailyReportPayload(tasks, now, dayStart) {
  const inbound = tasks.filter(isInboundWebexTelephony);
  const answeredTasks = inbound.filter(isAnsweredWebexContact);
  const abandonedTasks = inbound.filter(isAbandonedWebexContact);

  const answeredCalls = answeredTasks
    .map(buildAnsweredWebexReportRow)
    .sort((a, b) => Number(b.startEpoch || 0) - Number(a.startEpoch || 0));

  const abandonedCalls = abandonedTasks
    .map(buildAbandonedWebexReportRow)
    .sort((a, b) => Number(b.startEpoch || 0) - Number(a.startEpoch || 0));

  const totalCallsReceived = inbound.length;
  const answered = answeredCalls.length;
  const abandoned = abandonedCalls.length;

  return {
    success: true,
    build: WEBEX_DAILY_REPORT_BUILD,
    timezone: WEBEX_CENTRAL_TIMEZONE,
    reportingDate: getCentralDateKeyFromEpoch(dayStart),
    reportingDayStartEpoch: dayStart,
    reportingDayStartCentral: formatWebexEpochCentral(dayStart),
    generatedAtEpoch: now,
    generatedAtCentral: formatWebexEpochCentral(now),
    summary: {
      totalCallsReceived,
      answeredCalls: answered,
      abandonedCalls: abandoned,
      answerRate: totalCallsReceived > 0 ? (answered / totalCallsReceived) * 100 : 0,
      abandonRate: totalCallsReceived > 0 ? (abandoned / totalCallsReceived) * 100 : 0
    },
    answeredCalls,
    abandonedCalls,
    diagnostics: {
      taskCount: tasks.length,
      inboundTelephonyCount: inbound.length,
      answeredCount: answered,
      abandonedCount: abandoned,
      cacheSeconds: WEBEX_DAILY_REPORT_CACHE_MS / 1000
    }
  };
}

async function buildWebexDailyReports(env, force = false) {
  const now = Date.now();

  if (
    !force &&
    webexDailyReportCache &&
    now - webexDailyReportCacheAt < WEBEX_DAILY_REPORT_CACHE_MS
  ) {
    return webexDailyReportCache;
  }

  if (webexDailyReportPromise) return webexDailyReportPromise;

  webexDailyReportPromise = (async () => {
    const dayStart = getCentralDayStartEpochMs(now);
    const tasks = await fetchWebexDailyReportTasks(env, dayStart, now);
    const payload = buildWebexDailyReportPayload(tasks, now, dayStart);

    webexDailyReportCache = payload;
    webexDailyReportCacheAt = Date.now();
    return payload;
  })();

  try {
    return await webexDailyReportPromise;
  } finally {
    webexDailyReportPromise = null;
  }
}

async function handleWebexDailyReports(request, env, cors) {
  try {
    const access = await checkAccess(request, env);
    if (!access.allowed) {
      return json({ success: false, error: "access-denied", access }, cors, 403);
    }

    const url = new URL(request.url);
    const force = url.searchParams.get("refresh") === "1";
    const payload = await buildWebexDailyReports(env, force);
    return json(payload, cors);
  } catch (err) {
    console.error("handleWebexDailyReports failed:", err.message);
    console.error(err.stack || err);
    return json({ success: false, error: err.message }, cors, 500);
  }
}
