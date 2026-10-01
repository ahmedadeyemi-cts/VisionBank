# Abandoned callbacks: dashboard / new-flow handoff

## Ownership and release status
The user owns building, validating and publishing the new Webex callback flow and assigning it to the intended outbound callback entry point. This revision changes the dashboard interface, protected API gateway and private durable callback service only. It does not modify any Webex flow, entry-point assignment, global retry setting, caller ID, live master setting or execution approval.

The dashboard completion release includes management, automation and outcome adapters; its deployment evidence is recorded separately. It is not proof of a successful telephone callback. The private native-execution restriction remains in force. Preview and saved plans are usable without permitting native schedule creation. There is no automatic conversion of a saved plan into a schedule when the master switch is later enabled.

## Operator workflow
1. Select one original abandoned call, a group across pages, or the frozen matching bulk set.
2. Choose a permitted date/start time. The panel displays the computed end and Central time zone.
3. Optionally select **Save plan — no calls**. This creates a persistent draft, not a Webex schedule. Save remains available while execution is disabled.
4. Reopen the draft from **Callback Workspace** even after its original call is absent from today's report. Edit its window or archive it. The saved source evidence is explicit, not represented as today's live report.
5. **Preview batch** validates the current settings, time window, source evidence and native duplicate inventory. Readiness is presented as separate checks with an owner and next action.
6. **Schedule** submits only after all server-side gates pass. A local accepted job is not labeled Scheduled until a validated Webex response contains the matching schedule ID.
7. The Callback Workspace keeps requests across dates, allows read-only status refresh, and retains unconfirmed outcomes without interpreting a missing future schedule as completion.

Saving a plan is optional. A ready operator may still preview and submit a current selection directly. No login form or acknowledgement checkbox is introduced. Existing network/hours restrictions continue to protect every endpoint. The stored Source IP/browser context is not a verified person's identity or an inferred internal workstation address.

## Native scheduling contract
The existing backend adapter submits one POST to the supported scheduled-callback resource. It supplies:

| Field | Dashboard value |
| --- | --- |
| callbackNumber | Server-validated original caller number, normalized; not an arbitrary browser-supplied destination |
| customerName | Existing explicit placeholder `Customer name not provided` when the abandoned record lacks a verified name |
| timezone | `America/Chicago` |
| scheduleDate | `YYYY-MM-DD` |
| startTime / endTime | 24-hour `HH:mm:ss` within the allowed window |
| queueId | Saved active Voice queue ID; no specific agent assignment |
| callbackReason | Exactly `Callback for missed call from customer` |
| sourceInteraction | Original abandoned Contact ID |

The adapter does not invent `maxAttempts`, a per-schedule caller-ID override, or a per-schedule entry-point override. The organization's callback entry-point selection remains authoritative. Storing the stable entry-point ID in the dashboard allows name changes, but selecting a different ID does not update Control Hub.

The API response must confirm the correct organization, number, queue, date/window, reason and source interaction. A 201 with mismatching data, an invalid response, a timeout, or an ambiguous failure is not treated as success and is not blindly retried.

## New Webex flow integration
When a scheduled callback triggers, Cisco creates a new interaction through the organization callback entry point. The flow should recognize this as execution of an existing schedule, not enter ordinary number-collection prompts or register another future callback for the same follow-up.

Use the Start activity outputs for callback context, including `CallbackType`, `CallbackReason` and `ScheduleSourceInteractionId`, with the actual Start activity name in expressions. Map the callback reason into an agent-viewable variable so the message is displayed to the receiving agent. Verify the queue route, agent eligibility, caller ID and customer destination in the controlled pilot.

The saved maximum is a **requested total customer-dial attempt limit**, default 3, application range 1–10. The native schedule contract has no per-schedule attempt-limit field. The private execution policy must match the reviewed flow's actual total-attempt behavior. Three means one initial dial plus at most two retries, not three schedules. Do not use IVR digit-entry retry counters as evidence of customer dial attempts. Stop retries after a successful connection and apply the intended end-window, hours, cancellation and failure rules in the flow. No unrelated organization-wide policy is silently changed by this dashboard.

Caller ID and flow validation remain explicit deployment inputs. The dashboard does not manufacture a passing caller-ID or published-flow check merely because an entry-point name exists. A changed EP/queue/requested attempt policy requires matching private approval before submission resumes.

## Timing rules
Cisco documents a start at least 30 minutes ahead, dates from today through 31 days ahead, and a 30-minute to 8-hour window with a valid IANA time zone. The application also enforces saved working days, calling hours and excluded dates; its whole window must fit. A longer saved minimum delay takes precedence. The date picker uses local calendar days, server time and daylight-saving checks. The server revalidates before preview, reservation and dispatch. An old draft may remain saved but cannot submit an expired or no-longer-permitted window; use **Use next permitted window**, then preview again.

Saved source evidence has an additional application freshness limit of 31 elapsed days. This is separate from Webex's schedule-date horizon. Existing native callbacks continue independently of the browser and are not canceled by disabling new callback creation.

## Duplicate protection
- Atomic reservation for the original Contact ID and unresolved normalized number across dates.
- Number deduplication within a batch. New report arrivals are never silently appended to a frozen selection.
- Native future-schedule and active-callback lookups during preview; for large previews, at most five candidates receive immediate native checks and the rest are explicitly unchecked. Every dispatch checks again.
- Unknown or incomplete native inventory blocks submission, not a false zero-duplicate result.
- Idempotent job ID, durable alarm and create-request claim. A lost response or restart reconciles the original request, never blindly creates a replacement.
- A missing future schedule, elapsed window or unknown outcome does not release the number reservation.
- Multiple saved drafts are preparation only. They cannot defeat the execution reservation when submitted.

These controls prevent duplicate submissions by this application. Native read/create is not an atomic lock against independent external schedulers or manual agent calls. Those channels require coordinated operating procedures or a shared deduplication mechanism before unrestricted automatic/bulk use.

## Status and management boundaries
`Saved plan` -> `Accepted locally` -> `Submitting to Webex` -> `Scheduled in Webex` are distinct stages. `Creation unconfirmed`, `Not submitted`, `Rejected` and `Due — outcome not confirmed` remain explicit.

The requested maximum is never used as an observed attempt count. Actual dial attempts, handling agent, connection and terminal outcome are read through the new source-interaction-correlated reporting adapter. The new flow must emit the agreed variables. Missing or stale evidence remains unknown rather than inventing completion. Do not release duplicate reservations based only on inferred elapsed time.

Editing/archiving applies to unscheduled drafts. Manage schedule exposes native rescheduling (PUT of the same ID) and cancellation (DELETE, confirmed 204), with a 30-second safety margin before the original start. Native management is durable, audited and idempotent. Cancellation is allowed with the master switch Off. An uncertain response is reconciled rather than replayed. Archive plan never cancels a native schedule. A missing/externally changed future schedule is explicitly unconfirmed, and current-looking activity expires when observation is older than two minutes.

## Protected interface routes
Under `/api/webex/abandoned-callback/`:
- `settings`, `history`, `readiness`: existing persistent configuration and audit.
- `preview`, `schedule`, `jobs`, `records`: existing selected-call submission workflow.
- `plans`: GET list/detail/mutation lookup; POST save/archive.
- `plan-preview`, `plan-schedule`: reopen persisted source selection and validate/submit explicitly.
- `register`: paginated callback records across dates.
- `refresh-record`: native read-only reconciliation/status check; it cannot dial or blindly resubmit.
- `manage`, `management`: submit and track native reschedule/cancel actions.
- `automation-status`: saved automatic mode, operational eligibility and last scan status.
- `flow-policy`: separately authenticated machine-to-machine read-only policy lookup, not a browser permission or call-creation endpoint.

The private store adds management, outcome observation and automatic-source processing. The main Worker adds a separate maintenance hook to the existing schedule without replacing existing scheduled tasks. Its read-only flow-policy route requires a new private CALLBACK_FLOW_POLICY_TOKEN binding. All 33 existing bindings and the R8 reporting repair remain preserved. The guarded completion builder rejects wrong baselines or missing dependencies. A compatible main Worker/companion/frontend release is required; an old main Worker will not recognize the new routes.

## Pilot acceptance and release checklist
Deploy the compatible interface/backend release while native calling remains disabled. Publish and assign the new flow. Read back the actual native queue/EP and reviewed retry/caller-ID/message policy. Configure the already-approved single test number in the private pilot policy; keep bulk/automatic execution held. Save the deliberate master setting and run one selected callback. Verify the returned schedule ID, incoming agent message, correct team, caller ID, answer/no-answer handling, and no duplicate schedule after reload. Do not approve unrestricted calling from simulated provider tests alone.

No secrets or customer records belong in this document, the repository or screenshots used for review.

## Primary Cisco references
- Scheduled-callback routing and timing: https://help.webex.com/en-us/article/np2fdx
- Agent Desktop callback creation and native management: https://help.webex.com/en-us/article/mmcf7p
- Flow Designer callback context and variables: https://help.webex.com/en-us/article/nhovcy4

## Automatic mode
Automatic-new-abandoned mode scans on the existing five-minute Worker schedule only after the saved master switch is On, mode is automatic, and live-mode execution/pilot checks pass. It begins at the activation time and does not backfill older calls. Manual selections and saved plans remain explicit operations. A scan reserves up to 20 eligible records and dispatch uses the same source, timing, policy and duplicate checks. The switch persists independently of operational readiness.

## Per-record attempt policy and outcome contract for the new flow
The schedule-create API does not accept a per-callback maximum-attempt field. Two supported application policies exist: a fixed reviewed flow limit, or an explicitly reviewed per-record-policy flow. For per-record operation, the flow makes an authenticated POST to `/api/webex/abandoned-callback/flow-policy` with JSON `{"sourceInteraction":"<original abandoned Contact ID>"}`. The bearer credential is provisioned privately and must never be embedded in dashboard JavaScript or the public repository. A denied/unavailable lookup must not default to an unbounded retry count. The response includes `allowed`, `totalAttempts`, `scheduleId`, original calling-window bounds and the saved reason. The flow must honor the window and stop after successful connection, terminal failure, or its total-attempt limit. This endpoint reads policy; it does not place a call.

Publish the following reportable global variables from the actual flow:
- `VB_CallbackSourceInteractionId`: original Start `ScheduleSourceInteractionId`, required for reliable correlation.
- `VB_CallbackScheduleId`: the returned policy schedule ID when available; a mismatch is rejected.
- `VB_CallbackAttempts`: actual total customer dials made, including the initial attempt. Do not populate it with the maximum or an IVR-input retry count.
- `VB_CallbackOutcome`: actual observed state, such as QUEUED, DIALING, NO_ANSWER, BUSY, RETRY_PENDING, EXHAUSTED, EXPIRED, CANCELED or FAILED.

The dashboard also checks native callback number, activity timestamps, active/ended flags and customer connection evidence. A phone/time match alone cannot link calls, and a COMPLETED word alone does not prove a connection. Successful terminal correlation additionally checks for pending/active callbacks before releasing number reservations. Actual attempts remain unknown until reported; the requested maximum is never used as an actual count.

## Dashboard presentation review
The former index dashboard now redirects to Webex; retired navigation is removed without deleting provider history or shared backend services. Daily counts and rates are explicitly scoped, missing values are not fabricated zeros, stale queues/channels/callbacks are labeled unknown, and callback history is distinguished from scheduled work. A bounded diagnostics history retains request status/timing only, without customer records or credentials.
