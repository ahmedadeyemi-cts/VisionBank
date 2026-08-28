/*
 * WEBEX DAILY REPORTING - AAR ADAPTER
 *
 * Webex tenant evidence shows CSR/CLR handled metrics and CAR event names are not
 * reliable answer indicators in this org. Agent Activity Records (AAR) are the
 * authoritative source for the agent Connected state. This adapter keeps the
 * existing CSR/CLR/CAR report pipeline and enriches CAR task activity lists with
 * synthetic connected activities derived from AAR taskId joins.
 */

function webexReportIsAarConnected(activity) {
  return webexReportLower(activity?.state) === "connected";
}

async function fetchWebexDailyReportAgentSessions(env, from, to) {
  return webexSearchPaged(
    env,
    cursor => `
      {
        agentSession(
          from: ${from}
          to: ${to}
          ${paginationArgument(cursor)}
        ) {
          agentSessions {
            agentId
            agentName
            agentSessionId
            userLoginId
            startTime
            endTime
            teamId
            teamName
            channelInfo {
              channelId
              channelType
              agentPhoneNumber
              activities(first: 100) {
                totalCount
                nodes {
                  id
                  startTime
                  endTime
                  duration
                  state
                  taskId
                  queue { id name }
                  isOutdial
                  outboundType
                  contactAssignmentType
                  reason
                }
                pageInfo { hasNextPage endCursor }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    `,
    "agentSession",
    "agentSessions"
  );
}

function buildWebexDailyAarIndex(agentSessions, dayStartEpoch, now) {
  const byTaskId = new Map();
  let sessionCount = 0;
  let telephonyChannelCount = 0;
  let activityRows = 0;
  let connectedRows = 0;
  let connectedTaskIds = 0;
  let innerTruncatedChannels = 0;

  for (const session of (Array.isArray(agentSessions) ? agentSessions : [])) {
    sessionCount += 1;
    const channels = Array.isArray(session?.channelInfo) ? session.channelInfo : [];

    for (const channel of channels) {
      if (webexReportLower(channel?.channelType) !== "telephony") continue;
      telephonyChannelCount += 1;

      const activities = Array.isArray(channel?.activities?.nodes)
        ? channel.activities.nodes
        : [];
      activityRows += activities.length;

      if (channel?.activities?.pageInfo?.hasNextPage) {
        innerTruncatedChannels += 1;
      }

      for (const activity of activities) {
        const taskId = webexReportText(activity?.taskId);
        if (!taskId || !webexReportIsAarConnected(activity)) continue;

        const startEpoch = webexReportEpoch(activity?.startTime);
        if (startEpoch < dayStartEpoch || startEpoch > now) continue;

        connectedRows += 1;

        const entry = {
          id: webexReportText(activity?.id),
          taskId,
          agentId: webexReportText(session?.agentId),
          agentName:
            webexReportText(session?.agentName) ||
            webexReportText(session?.userLoginId) ||
            "-",
          agentSessionId: webexReportText(session?.agentSessionId),
          agentPhoneNumber: webexReportText(channel?.agentPhoneNumber),
          teamId: webexReportText(session?.teamId),
          teamName: webexReportText(session?.teamName),
          startEpoch,
          endEpoch: webexReportEpoch(activity?.endTime),
          duration: webexReportNumber(activity?.duration),
          queueId: webexReportText(activity?.queue?.id),
          queueName: webexReportText(activity?.queue?.name)
        };

        if (!byTaskId.has(taskId)) byTaskId.set(taskId, []);
        byTaskId.get(taskId).push(entry);
      }
    }
  }

  for (const entries of byTaskId.values()) {
    entries.sort((a, b) => a.startEpoch - b.startEpoch);
  }
  connectedTaskIds = byTaskId.size;

  return {
    byTaskId,
    diagnostics: {
      aarSessionCount: sessionCount,
      aarTelephonyChannelCount: telephonyChannelCount,
      aarActivityRows: activityRows,
      aarConnectedRows: connectedRows,
      aarConnectedTaskIds: connectedTaskIds,
      aarInnerTruncatedChannels: innerTruncatedChannels
    }
  };
}

function enrichWebexCarTasksWithAar(carTasks, aarIndex) {
  const sourceTasks = Array.isArray(carTasks) ? carTasks : [];
  const seenTaskIds = new Set();
  const enriched = sourceTasks.map(carTask => {
    const taskId = webexReportText(carTask?.id);
    if (taskId) seenTaskIds.add(taskId);

    const existingActivities = Array.isArray(carTask?.activities?.nodes)
      ? carTask.activities.nodes
      : [];
    const aarEntries = taskId ? (aarIndex.get(taskId) || []) : [];

    const syntheticActivities = aarEntries.map((entry, index) => ({
      id: entry.id || `aar-connected-${taskId}-${index}`,
      createdTime: entry.startEpoch,
      endedTime: entry.endEpoch || (entry.duration > 0 ? entry.startEpoch + entry.duration : 0),
      lastActivityTime: entry.endEpoch || (entry.duration > 0 ? entry.startEpoch + entry.duration : entry.startEpoch),
      agentId: entry.agentId || null,
      agentName: entry.agentName || null,
      agentPhoneNumber: entry.agentPhoneNumber || null,
      agentSessionId: entry.agentSessionId || null,
      queueId: entry.queueId || null,
      queueName: entry.queueName || null,
      teamId: entry.teamId || null,
      teamName: entry.teamName || null,
      transferType: null,
      activityType: "agent-activity-record",
      activityName: "Connected",
      eventName: "connected",
      previousState: null,
      nextState: "connected",
      duration: entry.duration || 0,
      terminationReason: null
    }));

    return {
      ...carTask,
      activities: {
        ...(carTask?.activities || {}),
        totalCount: Number(carTask?.activities?.totalCount || existingActivities.length) + syntheticActivities.length,
        nodes: [...existingActivities, ...syntheticActivities]
      }
    };
  });

  // Be defensive in case an AAR task appears even when the CAR-only query omitted
  // the corresponding task shell. The CSR remains the authoritative contact list;
  // this synthetic shell only provides the answer activity to the join map.
  for (const [taskId, entries] of aarIndex.entries()) {
    if (seenTaskIds.has(taskId)) continue;
    enriched.push({
      id: taskId,
      channelType: "telephony",
      activities: {
        totalCount: entries.length,
        nodes: entries.map((entry, index) => ({
          id: entry.id || `aar-connected-${taskId}-${index}`,
          createdTime: entry.startEpoch,
          endedTime: entry.endEpoch || (entry.duration > 0 ? entry.startEpoch + entry.duration : 0),
          lastActivityTime: entry.endEpoch || (entry.duration > 0 ? entry.startEpoch + entry.duration : entry.startEpoch),
          agentId: entry.agentId || null,
          agentName: entry.agentName || null,
          agentPhoneNumber: entry.agentPhoneNumber || null,
          agentSessionId: entry.agentSessionId || null,
          queueId: entry.queueId || null,
          queueName: entry.queueName || null,
          teamId: entry.teamId || null,
          teamName: entry.teamName || null,
          transferType: null,
          activityType: "agent-activity-record",
          activityName: "Connected",
          eventName: "connected",
          previousState: null,
          nextState: "connected",
          duration: entry.duration || 0,
          terminationReason: null
        })),
        pageInfo: { hasNextPage: false, endCursor: null }
      }
    });
  }

  return enriched;
}

// Replace only the data-orchestration function. Existing route, access control,
// cache contract, CSR/CLR/CAR payload builder, transfer logic, and formatting are
// retained unchanged.
buildWebexDailyReportData = async function buildWebexDailyReportDataWithAar(env, force = false) {
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
    // AAR/CAR Search spans cannot exceed 30 days. Use a 30-day lookback for
    // agent sessions so sessions that began before midnight can still contribute
    // today's Connected activities; activity startTime is filtered back to today.
    const aarFrom = Math.max(dayStartEpoch - (29 * 24 * 60 * 60 * 1000), 0);

    const [tasks, taskLegs, carTasks, agentSessions] = await Promise.all([
      fetchWebexDailyReportTasks(env, dayStartEpoch, now),
      fetchWebexDailyReportLegs(env, dayStartEpoch, now),
      fetchWebexDailyReportCarTasks(env, dayStartEpoch, now),
      fetchWebexDailyReportAgentSessions(env, aarFrom, now)
    ]);

    const aar = buildWebexDailyAarIndex(agentSessions, dayStartEpoch, now);
    const enrichedCarTasks = enrichWebexCarTasksWithAar(carTasks, aar.byTaskId);
    const data = buildWebexDailyReportPayload(
      tasks,
      taskLegs,
      enrichedCarTasks,
      now,
      dayStartEpoch
    );

    data.diagnostics = {
      ...(data.diagnostics || {}),
      ...aar.diagnostics,
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
    if (webexDailyReportCache.promise) {
      webexDailyReportCache.promise = null;
    }
  }
};
