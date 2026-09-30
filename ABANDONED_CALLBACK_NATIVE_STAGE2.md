# Abandoned callbacks: native scheduling and configurable attempts

This stage supersedes the preview-only behavior described in the initial settings PR.
It is not a production-enable instruction. The runtime execution gate defaults closed.

## Operator behavior

- A new configuration defaults to **3 total customer-dial attempts**, including the initial attempt. The application accepts an integer from 1 through 10. This application range is not a claim about Cisco's supported per-request retry settings.
- An explicit saved limit (including 1) is preserved; upgrading does not silently raise it.
- Saving the desired limit persists configuration and its old/new values in the Source IP audit. It does not change Webex organization-wide configuration.
- One original abandoned contact gets one persistent callback record and at most one ambiguous native create dispatch. Customer retries belong to the verified Webex callback policy, not repeated schedule-creation requests.
- Single, selective, filtered, and all-matching preparation remain. A server-enforced pilot permits one approved customer number and one callback record per batch. Live bulk requires a passed single-callback pilot.
- Callback rows show confirmed schedule ID/time or explicit pending/uncertain states. Actual customer-attempt counts are unknown until authoritative execution evidence is integrated; `postAttempts` is an internal API-dispatch count, not the customer-dial count.

## Native contract

The adapter implements the documented Callback Schedule API on the tenant's US1 host:
`POST /v1/callbacks/organization/{orgId}/scheduled-callback`.
It sends the source Contact ID as `sourceInteraction`, the configured Voice queue, and the exact reason **Callback for missed call from customer**. It omits `assigneeAgent` for team routing.
The documented creation body does not expose a per-schedule maximum-attempt field. Do not invent one, nor multiply native schedule records to simulate retries.
GET lookup requires an exact callback number or an assignee agent. Lookup excludes schedules whose trigger time has passed; absence never proves cancellation, successful contact, or permission to recreate a callback.
The recorded create contract requires a start at least 30 minutes ahead and a window of at least 30 minutes. The UI and server validate these independently.

## Retry-policy readiness

The private execution configuration must record a reviewed total-attempt policy and its corresponding native setting. Do not assume Cisco's reported maximum is numerically identical to total customer-dial attempts without validating its semantics and the actual flow.
The desired saved limit must equal `validatedTotalAttempts`. Current native `maximumCallbackAttempts` must equal `validatedNativeMaximumAttempts`. A mismatch pauses NEW submissions and leaves the saved Enabled setting intact.
The record retains the policy requested at submission; editing the dashboard does not change an existing native schedule. External Control Hub/flow changes can affect native behavior and are outside the dashboard setting's control.
The reviewed callback entry point, caller ID, queue, agent message, and retry behavior still require an approved live pilot. No global Webex setting is written by this code.

## Durable execution

The private settings Durable Object also owns an atomic callback ledger, per-contact reservations, same-number/date reservations, batch mutation IDs, source audit, and durable alarms. It persists the job before any native create request. Processing continues without an open browser.
After an uncertain create, later alarms only reconcile existing native records. They never repeat the create POST. An unresolved outcome remains visibly unconfirmed; it is not presented as zero work or successful completion.
Disabling blocks jobs not yet dispatched. It does not terminate an active call, cancel an already accepted native schedule, or recall an in-flight request. Changing settings before dispatch stops that pending job for review.
The companion reads the existing `webex-oauth-state` from the shared `WEBEX_AUTH_KV` binding. It never writes or rotates tokens. Missing/expired credentials pause submission until normal existing renewal occurs.

## Private deployment inputs

Keep the main combined Worker and all 32 existing bindings unchanged; add only its external `ABANDONED_CALLBACK_SETTINGS` Durable Object binding. Provision the companion separately, with no public routes and no workers.dev URL.
The companion needs `WEBEX_ORG_ID`, a binding to the existing `WEBEX_AUTH_KV`, and private `CALLBACK_EXECUTION_CONFIG` JSON. Never publish credentials, customer test numbers, private Worker source, or actual deployment metadata in the public repository.
Required runtime fields are `enabled`, `phase`, `queueId`, `callbackEntryPointId`, `callbackAni`, `callbackDefaultsVerified`, `attemptPolicyVerified`, `attemptSemantics`, `validatedTotalAttempts`, `validatedNativeMaximumAttempts`, `reviewedFlowSha256`, `agentMessageVerified`, and `testNumbers` for a pilot. Live bulk also requires `singleCallbackPilotPassed`.
`attemptSemantics` must be `total-customer-dial-attempts`; the reviewed values and SHA must reflect actual verification, not placeholders. Keep `enabled:false` until that evidence and one approved test number are available.
The guarded main-Worker builder only accepts the exact R7 baseline. If production advances, reconcile the builder against the new source; never overwrite a newer production Worker.
Do not merge for automatic frontend publication before backend provisioning, route checks, and a controlled pilot are complete. The separate R8 reporting-lifecycle repair remains out of scope.

## Validation

Unit tests cover default/custom counts, old-choice preservation, audit persistence, readiness mismatches, a single native schedule for a three-attempt policy, concurrent batches, uncertain responses, restart recovery, duplicate prevention, and elapsed-schedule ambiguity.
Browser tests use actual dashboard/gateway/coordinator code with a synthetic native service. Local workerd/SQLite tests exercise atomic alarm commit and real automatic alarm execution, then restart and replay without a duplicate schedule. No test places a customer call.
Actual call-attempt outcomes, live callback flow routing, agent-visible reason, and native retry semantics still need tenant validation. Automatic-new-abandoned processing and reschedule/cancel controls are not activated by this stage.

## Primary API documentation used

- https://developer.webex.com/webex-contact-center/docs/api/v1/callback-schedule/schedule-a-callback
- https://developer.webex.com/webex-contact-center/docs/api/v1/callback-schedule/get-scheduled-callbacks
- https://developer.webex.com/webex-contact-center/docs/api/v1/callback-schedule/get-scheduled-callback-by-id

## Configurable callback entry point (settings v3)

The settings panel now exposes a persisted `callbackEntryPointId` selection. Options are loaded from the documented, read-only entry-point inventory and filtered to active outbound telephony entries. Names are display metadata, never routing keys; renaming an existing entry point does not change its saved ID. Names refresh when settings are reopened or through the existing visible-panel refresh. No entry-point name or tenant-specific ID is hardcoded in the application.

The operator can select a different existing outbound entry point and save it with the same atomic source-IP audit. This does not rename an entry point, change the Control Hub organization callback selection, or modify existing schedules. Actual renames and organization-wide callback routing remain managed in Control Hub. A new selection requires matching reviewed runtime routing before new submissions are allowed. The live entry-point read must confirm that it remains active, outbound telephony and callback-enabled.

Existing v2 records are projected with an empty new ID without rewriting their version, enabled state, attempts or audit history. The first deliberate selection is audited. A cached older browser that omits the new field cannot clear the saved selection. Discovery failures retain the saved ID and show an unavailable label; disabling remains possible. Discovery has an independent five-second total deadline, validates complete pagination, and is not added to the general reporting polling loop.

The schedule ledger captures the selected entry-point ID/name at submission. The native scheduling request is unchanged and does not invent an entry-point override parameter. This update does not enable dialing, change the callback retry count, modify the approved pilot number, or complete the pending live callback-flow pilot.

Deployment order remains companion/backend modules first, then matching frontend after validation. No new storage namespace or Worker binding is needed for this update.
