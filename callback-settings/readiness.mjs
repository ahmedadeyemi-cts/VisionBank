// Presentation only: no readiness flag can be approved by the browser.
export function readinessChecklist(state, gate, native, blockers, now = Date.now()) {
  const settings = state?.settings || {};
  const has = (...codes) => codes.some(code => blockers.includes(code));
  const checks = [];
  const add = (id, label, status, detail, owner) => checks.push({id,label,status,detail,owner});
  add('settings', 'Saved dashboard settings', settings.queueId && settings.callbackEntryPointId ? 'passed' : 'action-required',
    settings.queueId && settings.callbackEntryPointId ? 'Voice queue and callback entry point are saved.' : 'Select a Voice queue and outbound callback entry point, then Save settings.', 'Dashboard settings');
  add('resources', 'Webex queue and entry point', native ? native.queueActive && native.voiceQueue && native.entryPointCallbackEnabled && native.webCallbackEnabled ? 'passed' : 'action-required' : 'not-verified',
    native ? `${native.queueName || 'Voice queue'} / ${native.callbackEntryPointName || 'callback entry point'}; native resource check completed.` : 'Native resource information is unavailable or has not been checked. A saved name alone does not verify routing.', 'Webex configuration');
  add('flow', 'Published flow, routing and caller ID', has('callback-entrypoint-and-caller-id-not-verified','callback-entry-point-review-required','queue-not-approved-for-this-release','approved-queue-not-configured') ? 'not-verified' : 'passed',
    'The new flow must be published and assigned to the selected entry point. Its route and caller ID require a matching backend review.', 'Flow integration');
  add('attempts', 'Customer-dial attempt limit', has('callback-attempt-policy-not-verified','requested-attempt-limit-not-verified','webex-attempt-policy-changed') ? 'not-verified' : 'passed',
    `${settings.maxAttempts ?? 'Not saved'} total attempts requested; ${gate.validatedTotalAttempts ?? 'no'} verified total-attempt policy. Retries belong to Webex, not additional dashboard schedules.`, 'Flow integration');
  add('message', 'Incoming agent message', has('agent-message-display-not-verified') ? 'not-verified' : 'passed',
    'Callback for missed call from customer. Map the callback reason to an agent-viewable flow variable.', 'Flow integration');
  add('pilot', 'Pilot approval', has('pilot-phase-not-configured','one-approved-test-number-required','single-callback-pilot-not-passed') ? 'not-verified' : 'passed',
    gate.phase === 'pilot' ? 'Single-record pilot only. The approved test number must be installed in the private execution policy.' : 'Bulk execution requires a recorded successful single-call pilot.', 'Backend activation');
  add('switch', 'Master callback switch', settings.enabled === true ? 'passed' : 'off',
    settings.enabled === true ? 'Enabled is saved. It does not override any missing checks.' : 'Off. Saving settings or plans does not place calls. Enable deliberately after integration checks pass.', 'Dashboard settings');
  add('execution', 'Native submission service', has('native-execution-not-enabled') ? 'off' : 'passed',
    has('native-execution-not-enabled') ? 'Live schedule submission is disabled in the backend.' : 'Backend submission is enabled; all other checks still apply.', 'Backend activation');
  if (has('automatic-processing-not-enabled-in-this-stage')) add('mode','Scheduling mode','action-required','Use Manual selection for the pilot. Automatic processing has not been enabled.','Dashboard settings');
  const known = new Set(['native-execution-not-enabled','pilot-phase-not-configured','approved-queue-not-configured','callback-entrypoint-and-caller-id-not-verified','callback-attempt-policy-not-verified','agent-message-display-not-verified','one-approved-test-number-required','single-callback-pilot-not-passed','master-switch-disabled','automatic-processing-not-enabled-in-this-stage','queue-not-approved-for-this-release','callback-entry-point-required','callback-entry-point-review-required','requested-attempt-limit-not-verified','native-voice-queue-unavailable','webex-attempt-policy-changed','native-web-callback-disabled','webex-callback-entry-point-mismatch']);
  for (const code of blockers.filter(c => !known.has(c))) add(code,'Service check','not-verified',code,'Backend diagnostics');
  return {checkedAt:now, checks, canSaveSettings:true, canSavePlan:!!settings.queueId,
    canSubmit:blockers.length === 0, maximumBatch:gate.maxBatch,
    summary:blockers.length ? 'You can save settings and callback plans. Webex scheduling remains paused until the checks below pass.' : 'Ready to submit the selected callbacks to Webex.'};
}
export function callbackStatusLabel(status) {
  return ({'submission-pending':'Accepted locally — awaiting Webex',dispatching:'Submitting to Webex',
    'creation-unconfirmed':'Creation unconfirmed — review required',scheduled:'Scheduled in Webex',
    'due-outcome-unconfirmed':'Due — outcome not confirmed',rejected:'Not scheduled — Webex rejected',
    'not-submitted':'Not submitted',draft:'Saved plan — not scheduled',submitted:'Submitted — see callback records',archived:'Archived plan'})[status] || 'Status not confirmed';
}
