/*
 * WEBEX DAILY REPORTING - TRANSITION OPERATING MODE
 *
 * Current VisionBank flow behavior blind-transfers almost every inbound contact
 * out of Webex Contact Center. Those contacts are neither Webex-agent answered
 * calls nor unresolved failures; they are intentionally transferred out by Flow.
 *
 * This adapter does not change answered/abandoned classification. It only adds a
 * third outcome (Transferred Out) from the tenant-validated TransferToDN /
 * blind-transfer vocabulary and updates unresolved counts accordingly. When calls
 * begin staying in Webex Contact Center for agents, the existing answered logic
 * remains available without another redesign.
 */

const buildWebexDailyReportDataBeforeTransitionMode = buildWebexDailyReportData;

buildWebexDailyReportData = async function buildWebexDailyReportDataTransitionMode(env, force = false) {
  const data = await buildWebexDailyReportDataBeforeTransitionMode(env, force);
  const summary = data?.summary || {};
  const diagnostics = data?.diagnostics || {};

  const total = Math.max(0, Number(summary.totalCallsReceived || 0));
  const answered = Math.max(0, Number(summary.answeredCalls || 0));
  const abandoned = Math.max(0, Number(summary.abandonedCalls || 0));

  const transferSignals = [
    diagnostics?.taskContactHandleTypeCounts?.TransferToDN,
    diagnostics?.taskTerminationTypeCounts?.TransferToDN,
    diagnostics?.carActivityTypeCounts?.["blind-transfer"],
    diagnostics?.carEventNameCounts?.["transferred-to-dn"]
  ].map(value => Math.max(0, Number(value || 0)));

  const blindTransferRows = Math.max(0, ...transferSignals);
  const remainingAfterAgentOutcomes = Math.max(0, total - answered - abandoned);
  const transferredOut = Math.min(blindTransferRows, remainingAfterAgentOutcomes);
  const unresolved = Math.max(0, total - answered - abandoned - transferredOut);

  summary.transferredOutCalls = transferredOut;
  summary.transferredOutRate = total > 0 ? (transferredOut / total) * 100 : 0;
  summary.classifiedCalls = answered + abandoned + transferredOut;
  summary.agentAnswerRateApplicable = !(transferredOut > 0 && answered === 0);

  diagnostics.transferredOutRows = transferredOut;
  diagnostics.unresolvedRows = unresolved;
  diagnostics.transitionOperatingMode = true;

  data.summary = summary;
  data.diagnostics = diagnostics;
  data.operatingMode = "flow-blind-transfer-transition";
  data.operatingModeMessage = transferredOut > 0
    ? `${transferredOut} call${transferredOut === 1 ? "" : "s"} transferred out by Webex Contact Center Flow. Agent answer/talk metrics are unavailable after the blind transfer leaves Webex Contact Center.`
    : "Calls are no longer being blind-transferred out by Flow; Webex Contact Center agent answer metrics apply normally.";

  return data;
};
