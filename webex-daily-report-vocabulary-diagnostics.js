/*
 * WEBEX DAILY REPORTING - TENANT VOCABULARY DIAGNOSTICS
 *
 * Diagnostic-only adapter. It does not change answered/abandoned classification.
 * It exposes aggregate, non-PII value distributions for CSR/CLR/CAR/AAR fields so
 * the tenant's actual Webex Search vocabulary can be used for the final classifier.
 */

function webexReportIncrementCount(map, value) {
  const key = webexReportText(value) || "(blank)";
  map.set(key, (map.get(key) || 0) + 1);
}

function webexReportTopCounts(map, limit = 25) {
  return Object.fromEntries(
    [...map.entries()]
      .sort((a, b) => (b[1] - a[1]) || String(a[0]).localeCompare(String(b[0])))
      .slice(0, limit)
  );
}

function buildWebexTenantVocabularyDiagnostics(tasks, taskLegs, carTasks, agentSessions, dayStartEpoch, now) {
  const taskStatus = new Map();
  const taskContactHandleType = new Map();
  const taskTerminationType = new Map();
  const taskTerminationReason = new Map();
  const taskTerminatingEnd = new Map();

  let taskHandledTrueRows = 0;
  let taskConnectedCountRows = 0;
  let taskConnectedDurationRows = 0;
  let taskLastAgentRows = 0;
  let taskOfferedTrueRows = 0;

  for (const task of (Array.isArray(tasks) ? tasks : [])) {
    webexReportIncrementCount(taskStatus, task?.status);
    webexReportIncrementCount(taskContactHandleType, task?.contactHandleType);
    webexReportIncrementCount(taskTerminationType, task?.terminationType);
    webexReportIncrementCount(taskTerminationReason, task?.terminationReason);
    webexReportIncrementCount(taskTerminatingEnd, task?.terminatingEnd);

    if (task?.isContactHandled === true) taskHandledTrueRows += 1;
    if (webexReportNumber(task?.connectedCount) > 0) taskConnectedCountRows += 1;
    if (webexReportNumber(task?.connectedDuration) > 0) taskConnectedDurationRows += 1;
    if (webexReportText(task?.lastAgent?.id) || webexReportText(task?.lastAgent?.name)) taskLastAgentRows += 1;
    if (task?.isContactOffered === true) taskOfferedTrueRows += 1;
  }

  const legStatus = new Map();
  const legContactState = new Map();
  const legHandleType = new Map();
  const legAbandonedType = new Map();

  let legOwnerRows = 0;
  let legHandleTimeRows = 0;
  let legConnectedCountRows = 0;
  let legConnectedDurationRows = 0;
  let legRingingDurationRows = 0;
  let legHandledTrueRows = 0;

  for (const leg of (Array.isArray(taskLegs) ? taskLegs : [])) {
    webexReportIncrementCount(legStatus, leg?.status);
    webexReportIncrementCount(legContactState, leg?.contactState);
    webexReportIncrementCount(legHandleType, leg?.handleType);
    webexReportIncrementCount(legAbandonedType, leg?.abandonedType);

    if (webexReportText(leg?.owner?.id) || webexReportText(leg?.owner?.name)) legOwnerRows += 1;
    if (webexReportNumber(leg?.handleTime) > 0) legHandleTimeRows += 1;
    if (webexReportNumber(leg?.connectedCount) > 0) legConnectedCountRows += 1;
    if (webexReportNumber(leg?.connectedDuration) > 0) legConnectedDurationRows += 1;
    if (webexReportNumber(leg?.ringingDuration) > 0) legRingingDurationRows += 1;
    if (leg?.isTaskLegHandled === true) legHandledTrueRows += 1;
  }

  const carEventName = new Map();
  const carActivityName = new Map();
  const carActivityType = new Map();
  const carPreviousState = new Map();
  const carNextState = new Map();
  const carTransferType = new Map();
  const carTerminationReason = new Map();

  let carRows = 0;
  let carRowsWithAgent = 0;
  let carRowsWithQueue = 0;
  let carRowsWithDuration = 0;
  let carRowsWithTransferType = 0;

  for (const carTask of (Array.isArray(carTasks) ? carTasks : [])) {
    for (const activity of webexReportActivities(carTask)) {
      carRows += 1;
      webexReportIncrementCount(carEventName, activity?.eventName);
      webexReportIncrementCount(carActivityName, activity?.activityName);
      webexReportIncrementCount(carActivityType, activity?.activityType);
      webexReportIncrementCount(carPreviousState, activity?.previousState);
      webexReportIncrementCount(carNextState, activity?.nextState);
      webexReportIncrementCount(carTransferType, activity?.transferType);
      webexReportIncrementCount(carTerminationReason, activity?.terminationReason);

      if (webexReportText(activity?.agentId) || webexReportText(activity?.agentName)) carRowsWithAgent += 1;
      if (webexReportText(activity?.queueId) || webexReportText(activity?.queueName)) carRowsWithQueue += 1;
      if (webexReportNumber(activity?.duration) > 0) carRowsWithDuration += 1;
      if (webexReportText(activity?.transferType)) carRowsWithTransferType += 1;
    }
  }

  const aarState = new Map();
  const aarTaskIdState = new Map();
  const aarTodayTaskIdState = new Map();
  const aarAssignmentType = new Map();
  const aarReason = new Map();
  const aarOutboundType = new Map();

  let aarRows = 0;
  let aarTaskIdRows = 0;
  let aarTodayRows = 0;
  let aarTodayTaskIdRows = 0;

  for (const session of (Array.isArray(agentSessions) ? agentSessions : [])) {
    for (const channel of (Array.isArray(session?.channelInfo) ? session.channelInfo : [])) {
      if (webexReportLower(channel?.channelType) !== "telephony") continue;

      const activities = Array.isArray(channel?.activities?.nodes) ? channel.activities.nodes : [];
      for (const activity of activities) {
        aarRows += 1;
        webexReportIncrementCount(aarState, activity?.state);
        webexReportIncrementCount(aarAssignmentType, activity?.contactAssignmentType);
        webexReportIncrementCount(aarReason, activity?.reason);
        webexReportIncrementCount(aarOutboundType, activity?.outboundType);

        const taskId = webexReportText(activity?.taskId);
        if (taskId) {
          aarTaskIdRows += 1;
          webexReportIncrementCount(aarTaskIdState, activity?.state);
        }

        const startEpoch = webexReportEpoch(activity?.startTime);
        if (startEpoch >= dayStartEpoch && startEpoch <= now) {
          aarTodayRows += 1;
          if (taskId) {
            aarTodayTaskIdRows += 1;
            webexReportIncrementCount(aarTodayTaskIdState, activity?.state);
          }
        }
      }
    }
  }

  return {
    diagnosticVocabularyOnly: true,

    taskStatusCounts: webexReportTopCounts(taskStatus),
    taskContactHandleTypeCounts: webexReportTopCounts(taskContactHandleType),
    taskTerminationTypeCounts: webexReportTopCounts(taskTerminationType),
    taskTerminationReasonCounts: webexReportTopCounts(taskTerminationReason),
    taskTerminatingEndCounts: webexReportTopCounts(taskTerminatingEnd),
    taskHandledTrueRows,
    taskConnectedCountRows,
    taskConnectedDurationRows,
    taskLastAgentRows,
    taskOfferedTrueRows,

    legStatusCounts: webexReportTopCounts(legStatus),
    legContactStateCounts: webexReportTopCounts(legContactState),
    legHandleTypeCounts: webexReportTopCounts(legHandleType),
    legAbandonedTypeCounts: webexReportTopCounts(legAbandonedType),
    legOwnerRows,
    legHandleTimeRows,
    legConnectedCountRows,
    legConnectedDurationRows,
    legRingingDurationRows,
    legHandledTrueRows,

    carVocabularyRows: carRows,
    carEventNameCounts: webexReportTopCounts(carEventName),
    carActivityNameCounts: webexReportTopCounts(carActivityName),
    carActivityTypeCounts: webexReportTopCounts(carActivityType),
    carPreviousStateCounts: webexReportTopCounts(carPreviousState),
    carNextStateCounts: webexReportTopCounts(carNextState),
    carTransferTypeCounts: webexReportTopCounts(carTransferType),
    carTerminationReasonCounts: webexReportTopCounts(carTerminationReason),
    carRowsWithAgent,
    carRowsWithQueue,
    carRowsWithDuration,
    carRowsWithTransferType,

    aarVocabularyRows: aarRows,
    aarTaskIdRows,
    aarTodayRows,
    aarTodayTaskIdRows,
    aarStateCounts: webexReportTopCounts(aarState),
    aarTaskIdStateCounts: webexReportTopCounts(aarTaskIdState),
    aarTodayTaskIdStateCounts: webexReportTopCounts(aarTodayTaskIdState),
    aarContactAssignmentTypeCounts: webexReportTopCounts(aarAssignmentType),
    aarReasonCounts: webexReportTopCounts(aarReason),
    aarOutboundTypeCounts: webexReportTopCounts(aarOutboundType)
  };
}

// Diagnostic-only orchestration override. Classification is intentionally identical
// to the AAR adapter immediately before this file; only diagnostics are added.
buildWebexDailyReportData = async function buildWebexDailyReportDataWithTenantVocabulary(env, force = false) {
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

  if (webexDailyReportCache.promise) return webexDailyReportCache.promise;

  webexDailyReportCache.promise = (async () => {
    const aarFrom = Math.max(dayStartEpoch - (29 * 24 * 60 * 60 * 1000), 0);

    const [tasks, taskLegs, carTasks, agentSessions] = await Promise.all([
      fetchWebexDailyReportTasks(env, dayStartEpoch, now),
      fetchWebexDailyReportLegs(env, dayStartEpoch, now),
      fetchWebexDailyReportCarTasks(env, dayStartEpoch, now),
      fetchWebexDailyReportAgentSessions(env, aarFrom, now)
    ]);

    const vocabulary = buildWebexTenantVocabularyDiagnostics(
      tasks,
      taskLegs,
      carTasks,
      agentSessions,
      dayStartEpoch,
      now
    );

    const aar = buildWebexDailyAarIndex(agentSessions, dayStartEpoch, now);
    const enrichedCarTasks = enrichWebexCarTasksWithAar(carTasks, aar.byTaskId);
    const data = buildWebexDailyReportPayload(tasks, taskLegs, enrichedCarTasks, now, dayStartEpoch);

    data.diagnostics = {
      ...(data.diagnostics || {}),
      ...aar.diagnostics,
      ...vocabulary,
      correlationKey: "task.id = taskLeg.taskId = carTask.id = aar.taskId"
    };

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
    if (webexDailyReportCache.promise) webexDailyReportCache.promise = null;
  }
};
