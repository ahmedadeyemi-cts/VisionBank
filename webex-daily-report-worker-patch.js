/*******************************************************************************************
 * WEBEX DAILY CALL REPORTING - SAFE ADDITIVE PATCH
 *
 * Development-only integration block for visionbank-worker-webex-dashboard.js.
 * DO NOT deploy directly. It is intended to be merged into the existing Worker source
 * without changing existing CORS, security, OAuth, routing, or scheduled-task behavior.
 *
 * Existing Worker dependencies intentionally reused:
 *   checkAccess(request, env)
 *   json(obj, cors, status)
 *   webexSearchPaged(env, queryFactory, rootField, listField)
 *   paginationArgument(cursor)
 *   getCentralDayStartEpochMs(epochMs)
 *   formatWebexEpochCentral(epochMs)
 *   formatWebexDurationMs(ms)
 *******************************************************************************************/

const WEBEX_DAILY_REPORT_CACHE_MS = 60 * 1000;
let webexDailyReportCache = {
  dayStartEpoch: 0,
  expiresAt: 0,
  data: null,
  promise: null
};

function webexReportNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function webexReportEpoch(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function webexReportText(value) {
  return String(value ?? "").trim();
}

function webexReportLower(value) {
  return webexReportText(value).toLowerCase();
}

function webexReportClampDuration(value, maxValue = 0) {
  const n = Math.max(0, webexReportNumber(value));
  const max = Math.max(0, webexReportNumber(maxValue));
  return max > 0 ? Math.min(n, max) : n;
}

function webexReportTaskDurationMs(task, now = Date.now()) {
  const explicit = webexReportNumber(task?.totalDuration);
  if (explicit > 0) return explicit;

  const start = webexReportEpoch(task?.createdTime);
  const end = webexReportEpoch(task?.endedTime) || webexReportEpoch(task?.lastActivityTime) || now;
  return start > 0 && end >= start ? end - start : 0;
}

function webexReportIsInboundTelephony(task) {
  return webexReportLower(task?.channelType) === "telephony" &&
    webexReportLower(task?.direction) === "inbound";
}

function webexReportActivities(task) {
  const nodes = task?.activities?.nodes;
  return Array.isArray(nodes) ? [...nodes] : [];
}

function webexReportIsConnectedActivity(activity) {
  const values = [
    activity?.eventName,
    activity?.previousState,
    activity?.nextState,
    activity?.activityType,
    activity?.activityName
  ].map(webexReportLower);

  return values.some(value => {
    if (!value || value.includes("disconnect")) return false;
    return (
      value === "connected" ||
      value === "connect" ||
      value === "ctq-accepted" ||
      value.includes("ctq-accepted") ||
      value.includes("ctq accepted") ||
      value.includes("agent-connected") ||
      value.includes("agent connected") ||
      value.includes("agent-connect") ||
      value.includes("connected-to-agent")
    );
  });
}

function webexReportHasAnswerSignal(task, taskLegs = []) {
  if (task?.isContactHandled === true) return true;
  if (webexReportNumber(task?.connectedCount) > 0) return true;
  if (webexReportNumber(task?.connectedDuration) > 0) return true;

  if (webexReportActivities(task).some(webexReportIsConnectedActivity)) return true;

  return taskLegs.some(leg =>
    leg?.isTaskLegHandled === true ||
    webexReportNumber(leg?.connectedCount) > 0 ||
    webexReportNumber(leg?.connectedDuration) > 0
  );
}

function webexReportHasAbandonSignal(task, taskLegs = []) {
  if (webexReportText(task?.abandonedType)) return true;
  if (webexReportLower(task?.contactHandleType) === "abandoned") return true;
  if (webexReportNumber(task?.abandonedSlCount) > 0) return true;

  return taskLegs.some(leg =>
    webexReportText(leg?.abandonedType) ||
    webexReportLower(leg?.handleType) === "abandoned" ||
    webexReportNumber(leg?.abandonedSlCount) > 0
  );
}

function webexReportConnectedActivityDurationMs(task) {
  const activities = webexReportActivities(task).filter(webexReportIsConnectedActivity);
  if (!activities.length) return 0;

  const withAgent = activities.filter(activity =>
    webexReportText(activity?.agentName) || webexReportText(activity?.agentId)
  );
  const candidates = withAgent.length ? withAgent : activities;

  const segments = candidates
    .map(activity => {
      const start = webexReportEpoch(activity?.createdTime);
      const explicitEnd = webexReportEpoch(activity?.endedTime) || webexReportEpoch(activity?.lastActivityTime);
      const duration = webexReportNumber(activity?.duration);
      const end = explicitEnd > start
        ? explicitEnd
        : (start > 0 && duration > 0 ? start + duration : 0);
      return start > 0 && end > start ? { start, end } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start);

  if (!segments.length) {
    return candidates.reduce((sum, activity) => sum + webexReportNumber(activity?.duration), 0);
  }

  let total = 0;
  let current = { ...segments[0] };
  for (const segment of segments.slice(1)) {
    if (segment.start <= current.end) {
      current.end = Math.max(current.end, segment.end);
    } else {
      total += current.end - current.start;
      current = { ...segment };
    }
  }
  total += current.end - current.start;
  return total;
}

function webexReportFindAnswerContext(task, taskLegs = []) {
  const activities = webexReportActivities(task)
    .filter(activity => webexReportEpoch(activity?.createdTime) > 0)
    .sort((a, b) => webexReportEpoch(a.createdTime) - webexReportEpoch(b.createdTime));

  const answerActivity = activities.find(webexReportIsConnectedActivity);
  const connectedAgentActivity = activities.find(activity =>
    webexReportIsConnectedActivity(activity) &&
    (webexReportText(activity?.agentName) || webexReportText(activity?.agentId))
  );

  if (answerActivity) {
    const agentActivity = connectedAgentActivity ||
      activities.find(activity => webexReportText(activity?.agentName) || webexReportText(activity?.agentId));

    return {
      answerEpoch: webexReportEpoch(answerActivity.createdTime),
      agentName:
        webexReportText(agentActivity?.agentName) ||
        webexReportText(task?.lastAgent?.name) ||
        "-",
      source: "customer-activity-record"
    };
  }

  const handledLegs = [...taskLegs]
    .filter(leg =>
      leg?.isTaskLegHandled === true ||
      webexReportNumber(leg?.connectedCount) > 0 ||
      webexReportNumber(leg?.connectedDuration) > 0
    )
    .sort((a, b) => webexReportEpoch(a.createdTime) - webexReportEpoch(b.createdTime));

  const firstHandled = handledLegs[0];
  if (firstHandled) {
    const start = webexReportEpoch(task?.createdTime);
    const legStart = webexReportEpoch(firstHandled.createdTime);
    const beforeAnswerEstimate =
      webexReportNumber(task?.selfserviceDuration) +
      webexReportNumber(task?.queueDuration) +
      webexReportNumber(firstHandled?.ringingDuration);

    return {
      answerEpoch: start > 0
        ? start + beforeAnswerEstimate
        : legStart,
      agentName: webexReportText(firstHandled?.owner?.name) || webexReportText(task?.lastAgent?.name) || "-",
      source: "handled-call-leg"
    };
  }

  return {
    answerEpoch: 0,
    agentName: webexReportText(task?.lastAgent?.name) || "-",
    source: "task-fallback"
  };
}

function webexReportTransferSignal(task, taskLegs = []) {
  const taskCounts = [
    task?.transferCount,
    task?.blindTransferCount,
    task?.agentToDnTransferCount,
    task?.agentToAgentTransferCount,
    task?.agentToEntrypointTransferCount,
    task?.agentToQueueTransferCount,
    task?.queueTransferToEPCount,
    task?.queueTransferToQueueCount,
    task?.transferInToEPCount
  ];

  if (taskCounts.some(value => webexReportNumber(value) > 0)) return true;
  if (webexReportText(task?.transferEpDN)) return true;

  if (taskLegs.some(leg =>
    webexReportNumber(leg?.transferCount) > 0 ||
    webexReportNumber(leg?.blindTransferCount) > 0
  )) return true;

  return webexReportActivities(task).some(activity => {
    const transferType = webexReportText(activity?.transferType);
    const activityText = [
      activity?.activityType,
      activity?.activityName,
      activity?.eventName
    ].map(webexReportLower).join(" ");

    return Boolean(transferType) || activityText.includes("transfer");
  });
}

function webexReportTransferDestination(task, taskLegs = []) {
  const transferEpDn = webexReportText(task?.transferEpDN);
  if (transferEpDn) return transferEpDn;

  const transferActivities = webexReportActivities(task)
    .filter(activity =>
      webexReportText(activity?.transferType) ||
      webexReportText(activity?.destinationAgentPhoneNumber) ||
      webexReportText(activity?.destinationAgentName) ||
      webexReportText(activity?.destinationQueueName) ||
      webexReportText(activity?.consultEpName)
    )
    .sort((a, b) =>
      (webexReportEpoch(b.endedTime) || webexReportEpoch(b.createdTime)) -
      (webexReportEpoch(a.endedTime) || webexReportEpoch(a.createdTime))
    );

  for (const activity of transferActivities) {
    const destination =
      webexReportText(activity?.destinationAgentPhoneNumber) ||
      webexReportText(activity?.destinationAgentName) ||
      webexReportText(activity?.destinationQueueName) ||
      webexReportText(activity?.consultEpName);

    if (destination) return destination;
  }

  const destinationLegs = [...taskLegs].sort((a, b) =>
    (webexReportEpoch(b.endedTime) || webexReportEpoch(b.createdTime)) -
    (webexReportEpoch(a.endedTime) || webexReportEpoch(a.createdTime))
  );

  for (const leg of destinationLegs) {
    const destination =
      webexReportText(leg?.nextDestination?.agent?.phoneNumber) ||
      webexReportText(leg?.nextDestination?.agent?.name) ||
      webexReportText(leg?.nextDestination?.queue?.name);

    if (destination) return destination;
  }

  return null;
}

function webexReportQueueWaitBucket(queueMs) {
  const ms = Math.max(0, webexReportNumber(queueMs));
  if (ms < 60 * 1000) return "Queue Wait < 1 Min";
  if (ms < 5 * 60 * 1000) return "Queue Wait 1–5 Min";
  if (ms < 10 * 60 * 1000) return "Queue Wait 5–10 Min";
  return "Queue Wait > 10 Min";
}

function webexReportAbandonmentStage(task, taskLegs = []) {
  const legWithAbandon = taskLegs.find(leg => webexReportText(leg?.abandonedType));
  const raw = webexReportLower(task?.abandonedType || legWithAbandon?.abandonedType);
  const queueMs = webexReportNumber(task?.queueDuration) ||
    taskLegs.reduce((sum, leg) => sum + webexReportNumber(leg?.queue?.duration), 0);
  const ivrMs = webexReportNumber(task?.selfserviceDuration) ||
    taskLegs.reduce((sum, leg) => sum + webexReportNumber(leg?.selfserviceDuration), 0);

  if (raw.includes("treatment")) return "Abandoned in IVR";
  if (raw.includes("queue")) return webexReportQueueWaitBucket(queueMs);
  if (raw.includes("agent-connect") || raw.includes("agent connect")) return "Abandoned During Agent Offer";
  if (raw === "new" || raw.includes("new")) return "Abandoned Before Queue";

  if (queueMs > 0) return webexReportQueueWaitBucket(queueMs);
  if (ivrMs > 0) return "Abandoned in IVR";
  return "Abandoned Before Queue";
}

function buildWebexDailyReportPayload(tasks, taskLegs, now = Date.now(), dayStartEpoch = 0) {
  const reportDayStart = dayStartEpoch || getCentralDayStartEpochMs(now);
  const inboundTasks = (Array.isArray(tasks) ? tasks : [])
    .filter(webexReportIsInboundTelephony)
    .filter(task => {
      const start = webexReportEpoch(task?.createdTime);
      return start >= reportDayStart && start <= now;
    });

  const legsByTaskId = new Map();
  for (const leg of (Array.isArray(taskLegs) ? taskLegs : [])) {
    const taskId = webexReportText(leg?.taskId);
    if (!taskId) continue;
    if (!legsByTaskId.has(taskId)) legsByTaskId.set(taskId, []);
    legsByTaskId.get(taskId).push(leg);
  }

  const answeredCalls = [];
  const abandonedCalls = [];

  for (const task of inboundTasks) {
    const contactId = webexReportText(task?.id);
    const legs = contactId ? (legsByTaskId.get(contactId) || []) : [];
    const answered = webexReportHasAnswerSignal(task, legs);
    const abandoned = !answered && webexReportHasAbandonSignal(task, legs);

    if (answered) {
      const startEpoch = webexReportEpoch(task?.createdTime);
      const endEpoch = webexReportEpoch(task?.endedTime) || webexReportEpoch(task?.lastActivityTime) || now;
      const totalDurationMs = webexReportTaskDurationMs(task, now);
      const answerContext = webexReportFindAnswerContext(task, legs);
      const measuredPreAnswerMs = answerContext.answerEpoch > startEpoch
        ? answerContext.answerEpoch - startEpoch
        : 0;
      const fallbackPreAnswerMs =
        webexReportNumber(task?.selfserviceDuration) +
        webexReportNumber(task?.queueDuration) +
        webexReportNumber(task?.ringingDuration);
      const ivrQueueMs = webexReportClampDuration(measuredPreAnswerMs || fallbackPreAnswerMs, totalDurationMs);
      const legConnectedMs = legs.reduce((sum, leg) => sum + webexReportNumber(leg?.connectedDuration), 0);
      const talkMs = webexReportClampDuration(
        webexReportNumber(task?.connectedDuration) ||
        legConnectedMs ||
        webexReportConnectedActivityDurationMs(task),
        totalDurationMs
      );
      const transferred = webexReportTransferSignal(task, legs);
      const transferredTo = transferred ? webexReportTransferDestination(task, legs) : null;

      answeredCalls.push({
        contactId,
        ani: webexReportText(task?.origin) || "-",
        dnis: webexReportText(task?.destination) || "-",
        agentName: answerContext.agentName || "-",
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
        transferredTo,
        correlation: "contact-session-id",
        agentSource: answerContext.source
      });
      continue;
    }

    if (abandoned) {
      const startEpoch = webexReportEpoch(task?.createdTime);
      const endEpoch = webexReportEpoch(task?.endedTime) || webexReportEpoch(task?.lastActivityTime) || now;
      const totalDurationMs = webexReportTaskDurationMs(task, now);
      const queueMs = webexReportNumber(task?.queueDuration) ||
        legs.reduce((sum, leg) => sum + webexReportNumber(leg?.queue?.duration), 0);
      const ivrMs = webexReportNumber(task?.selfserviceDuration) ||
        legs.reduce((sum, leg) => sum + webexReportNumber(leg?.selfserviceDuration), 0);
      const totalIvrQueueMs = webexReportClampDuration(ivrMs + queueMs, totalDurationMs);
      const timeToAbandonMs = totalDurationMs;

      abandonedCalls.push({
        contactId,
        ani: webexReportText(task?.origin) || "-",
        dnis: webexReportText(task?.destination) || "-",
        startEpoch,
        endEpoch,
        startTimeCentral: formatWebexEpochCentral(startEpoch),
        totalDurationMs,
        totalCallDuration: formatWebexDurationMs(totalDurationMs),
        totalIvrQueueMs,
        totalIvrQueueDuration: formatWebexDurationMs(totalIvrQueueMs),
        timeToAbandonMs,
        timeToAbandon: formatWebexDurationMs(timeToAbandonMs),
        abandonmentStage: webexReportAbandonmentStage(task, legs),
        agentName: "-",
        rawAbandonedType: webexReportText(task?.abandonedType) || webexReportText(legs.find(leg => leg?.abandonedType)?.abandonedType) || null,
        correlation: "contact-session-id"
      });
    }
  }

  answeredCalls.sort((a, b) => b.startEpoch - a.startEpoch);
  abandonedCalls.sort((a, b) => b.startEpoch - a.startEpoch);

  const totalCallsReceived = inboundTasks.length;
  const answeredCount = answeredCalls.length;
  const abandonedCount = abandonedCalls.length;
  const carAnswerSignalRows = inboundTasks.filter(task =>
    webexReportActivities(task).some(webexReportIsConnectedActivity)
  ).length;

  return {
    success: true,
    timezone: "America/Chicago",
    reportingDayStartEpoch: reportDayStart,
    reportingDayStartCentral: formatWebexEpochCentral(reportDayStart),
    generatedAtEpoch: now,
    generatedAtCentral: formatWebexEpochCentral(now),
    summary: {
      totalCallsReceived,
      answeredCalls: answeredCount,
      abandonedCalls: abandonedCount,
      answerRate: totalCallsReceived > 0 ? (answeredCount / totalCallsReceived) * 100 : 0,
      abandonRate: totalCallsReceived > 0 ? (abandonedCount / totalCallsReceived) * 100 : 0
    },
    answeredCalls,
    abandonedCalls,
    diagnostics: {
      inboundTelephonyContactsToday: totalCallsReceived,
      taskLegsCorrelated: (Array.isArray(taskLegs) ? taskLegs : []).filter(leg => legsByTaskId.has(webexReportText(leg?.taskId))).length,
      carAnswerSignalRows,
      answeredRows: answeredCount,
      abandonedRows: abandonedCount,
      unresolvedRows: Math.max(0, totalCallsReceived - answeredCount - abandonedCount),
      correlationKey: "task.id = taskLeg.taskId"
    }
  };
}

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
            isContactOffered
            isContactHandled
            abandonedType
            abandonedSlCount
            contactHandleType
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
            queueTransferToEPCount
            queueTransferToQueueCount
            transferInToEPCount
            transferEpDN
            firstQueueName
            lastQueue { id name duration }
            lastAgent { id name signInId sessionId phoneNumber }
            activities(first: 100) {
              totalCount
              nodes {
                id
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
                teamId
                teamName
                transferType
                activityType
                activityName
                eventName
                previousState
                nextState
                duration
                consultEpId
                consultEpName
                childContactId
                childContactType
                destinationAgentPhoneNumber
                destinationAgentId
                destinationAgentName
                destinationAgentSessionId
                destinationAgentTeamName
                destinationQueueId
                destinationQueueName
                terminationReason
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

async function fetchWebexDailyReportLegs(env, from, to) {
  return webexSearchPaged(
    env,
    cursor => `
      {
        taskLegDetails(
          from: ${from}
          to: ${to}
          ${paginationArgument(cursor)}
        ) {
          taskLegs {
            id
            taskId
            createdTime
            endedTime
            lastActivityTime
            isActive
            status
            contactState
            channelType
            direction
            origin
            destination
            queue { id name duration durationBusinessHours }
            owner { id name signInId sessionId phoneNumber }
            team { id name }
            isWithinServiceLevel
            isTaskLegHandled
            abandonedType
            abandonedSlCount
            ringingDuration
            connectedCount
            connectedDuration
            selfserviceDuration
            queueCount
            handleTime
            handleType
            transferCount
            blindTransferCount
            nextDestination {
              agent { id name signInId sessionId phoneNumber }
              team { id name }
              queue { id name }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    "taskLegDetails",
    "taskLegs"
  );
}

async function buildWebexDailyReportData(env, force = false) {
  const now = Date.now();
  const dayStartEpoch = getCentralDayStartEpochMs(now);

  if (
    !force &&
    webexDailyReportCache.data &&
    webexDailyReportCache.dayStartEpoch === dayStartEpoch &&
    webexDailyReportCache.expiresAt > now
  ) {
    return webexDailyReportCache.data;
  }

  if (webexDailyReportCache.promise) {
    return webexDailyReportCache.promise;
  }

  webexDailyReportCache.promise = (async () => {
    const [tasks, taskLegs] = await Promise.all([
      fetchWebexDailyReportTasks(env, dayStartEpoch, now),
      fetchWebexDailyReportLegs(env, dayStartEpoch, now)
    ]);

    const data = buildWebexDailyReportPayload(tasks, taskLegs, now, dayStartEpoch);

    webexDailyReportCache = {
      dayStartEpoch,
      expiresAt: now + WEBEX_DAILY_REPORT_CACHE_MS,
      data,
      promise: null
    };

    return data;
  })();

  try {
    return await webexDailyReportCache.promise;
  } finally {
    if (webexDailyReportCache.promise) {
      webexDailyReportCache.promise = null;
    }
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
    const data = await buildWebexDailyReportData(env, force);
    return json(data, cors);
  } catch (err) {
    console.error("handleWebexDailyReports failed:", err.message);
    console.error(err.stack || err);
    return json({ success: false, error: err.message }, cors, 500);
  }
}

/*******************************************************************************************
 * ROUTE ADDITION
 *
 * Add ONLY this route beside the existing Webex dashboard GET routes:
 *
 * if (path === "/api/webex/daily-reports" && method === "GET") {
 *   return handleWebexDailyReports(request, env, cors);
 * }
 *******************************************************************************************/
