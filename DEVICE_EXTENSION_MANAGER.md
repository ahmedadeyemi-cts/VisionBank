# VisionBank Device & Extension Manager

## Objective

Provide a nontechnical workspace at `/device` for managing temporary secondary phone-line assignments across VisionBank Webex Calling phones that are physically provisioned through Phonism by InLayer. Phone inventory can be filtered by location, while secondary-line candidates are organization-wide to match Webex Control Hub behavior.

Initial release scope:
- Show Webex Calling locations.
- Show partner-managed phones correlated to Phonism by MAC address.
- Show primary owner, Line 1, optional Line 2, and independent Webex + Phonism registration/sync health.
- Search by person/workspace name, extension, phone number, or MAC.
- Filter by location, owner type, and registration status.
- Allow Line 2 to be added, replaced, or removed with an eligible user/workspace from any VisionBank Webex Calling location. Preserve both the phone location and selected line location in preview, audit, and history.
- When a real VisionBank user/workspace is excluded from Webex `availableMembers`, surface it as a disabled result from the Webex organization number directory with any discoverable existing appearance context. Never allow that fallback result to bypass Webex eligibility during Preview.
- Protect Line 1 from changes in the first release.
- Preview every change before execution.
- Maintain durable audit history and per-system result status.

## Authority model

Webex is authoritative for:
- Organization and location identity.
- User/workspace identity.
- Extensions and phone numbers.
- Webex Calling device identity and any registration state Webex exposes.
- Device-member association only where the live API proves it is supported.

Phonism is authoritative for:
- Physical partner-managed phone configuration.
- Vendor/model/firmware and last provisioning metadata.
- Physical Line 2 configuration on partner-managed phones.
- Phonism line-registration monitoring when available.
- The normal post-save action is Phonism Sync, followed immediately by Webex + Phonism Line 2 registration verification.
## Important partner-managed-device limitation

Cisco documents that partner-managed devices may have a Webex Calling device ID but standard Webex Calling device configuration is not available for partner-managed devices.

For that reason, the implementation will not assume that Device Members writes are supported. The backend must perform a live read-only capability probe before enabling Webex member writes for this customer.

If Webex Device Members writes are unsupported, the system will still:
1. Use Webex for location/member/extension validation and inventory context.
2. Save the physical line change through Phonism.
3. Track the desired cross-system assignment in the dashboard audit/state store.
4. Display Webex and Phonism status separately so a limitation is never shown as a successful Webex configuration write.

## Correlation key

Preferred cross-system correlation is normalized MAC address:
`AA:BB:CC:DD:EE:FF`

Also retain:
- Webex `callingDeviceId`
- Webex `webexDeviceId` when present
- Phonism device ID
- Webex owner ID
- Webex location ID

Never use display name as the primary correlation key.

## Safe change workflow

1. User selects a phone and Line 2 candidate.
2. Backend reloads the device, current line state, candidate member, and location.
3. Backend permits eligible organization-wide Webex users/workspaces and records the selected member's source location. The phone's own location remains the Phonism provisioning/sync scope.
4. Backend creates a one-time mutation ID and preview.
5. User reviews current vs proposed assignment.
6. Backend revalidates version/state before any write.
7. Perform only the supported Webex association write.
8. Immediately invoke the verified Phonism Sync action so the Webex change is pulled into Phonism without waiting for the normal periodic synchronization.
9. Queue a Phonism TR-069 reboot so the handset applies the updated configuration.
10. Re-read Webex and Phonism Line 2 state independently. When Phonism does not expose registration telemetry, report the configuration as present but registration telemetry unavailable.
11. If the handset still needs attention, allow Reboot & Reverify. Destructive recovery actions remain blocked.
12. Record complete, applied-unverified, mismatch, pending-verification, reboot-failed, failed, or unknown result in audit history.

Never blindly retry a write after an unknown network response. Reconcile first.
## Phonism action safety

Normal production behavior is:

`Save in Webex → force Phonism Sync → queue TR-069 Reboot → reverify`

Configuration-clearing and other destructive actions are not part of this workflow. If another reboot is needed, `Reboot & Reverify` can be invoked and is audited separately.

Existing Webex BLF / Line Monitoring settings are a separate configuration domain and are not modified by the temporary shared-line workflow.

## Required backend endpoints

Front end contract:
- `GET /api/webex/device-management/capabilities`
- `GET /api/webex/device-management/locations`
- `GET /api/webex/device-management/inventory?locationId=...`
- `GET /api/webex/device-management/members?deviceId=...&q=...&limit=50` — bounded organization-wide search by name, extension, number, workspace/user type, or location. Eligible lines come from Webex `availableMembers`; known but ineligible lines may be returned disabled with appearance context from the Webex organization number directory.
- `GET /api/webex/device-management/history`
- `POST /api/webex/device-management/preview`
- `POST /api/webex/device-management/apply` — Save in Webex, force Phonism Sync, queue reboot, then verify both systems.
- `POST /api/webex/device-management/reboot` — optional Reboot & Reverify recovery action.

All endpoints must retain the existing VisionBank approved-network and trusted-origin checks.

## Write enablement gates

The UI must remain read-only until all are true. Organization-wide writes require the explicit server-side `DEVICE_WRITE_SCOPE=organization` switch; if that switch is absent, the existing MAC pilot allowlist remains the fallback scope:
- Existing Webex OAuth can enumerate locations and partner-managed devices.
- Required Webex read scopes are confirmed.
- Any Webex write path is proven against the customer's device type.
- Phonism API authentication is configured server-side.
- Device lookup by MAC is proven.
- Line read/write endpoint is proven.
- Exact Phonism Sync API action is proven and can be triggered immediately after a Webex save.
- Webex registration status read is proven for the customer device/line type.
- Phonism line-registration status read is proven.
- Destructive Phonism recovery actions remain blocked; the supported recovery control is non-destructive Reboot & Reverify.
- Audit/idempotency storage is ready.
## Information needed from VisionBank / Phonism

When ready for the live adapter, provide one of the following:
- Phonism API documentation / Swagger URL, or
- Phonism API base URL plus the authentication method.

Also needed:
- A Phonism API credential stored as a Cloudflare secret, not pasted into repository code.
- The Phonism tenant/company/domain identifier containing VisionBank phones.
- A screenshot or exact label of the action currently used after changing an extension.
- Whether Phonism line-registration monitoring is already enabled for these phones.
- One non-sensitive sample phone MAC and its Webex location for read-only correlation testing.

The existing Webex OAuth integration should be reused. Its current scopes will be tested before requesting any scope changes.

## Failure presentation

A change is not simply Success/Failure. The UI should distinguish:
- Completed — desired Line 2 is present, Phonism Sync completed, and both Webex and Phonism report healthy registration.
- Pending verification — Save & Sync was accepted but one or both registration states are still converging.
- Mismatch — Webex and Phonism disagree about Line 2 or its registration state.
- Recovery eligible — Sync and the automatic reboot were attempted, verification still needs attention, and Reboot & Reverify may be offered as a separate audited action.
- Partial — one system updated and another did not.
- Rejected — validation blocked the request before writes.
- Failed — provider returned a terminal failure.
- Unknown — response was lost; reconciliation required before retry.

No partial or unknown state may be presented as completed.

## Temporary assignment lease model

Changes made through `/device` are temporary by definition. The user must select a duration between 15 minutes and 12 hours; 12 hours is a hard server-side maximum.

Each successful platform change will create a server-side lease containing:
- Lease/mutation ID
- Webex Calling device ID and Phonism phone ID
- Webex location / Phonism tenant
- Permanent Line 2 baseline captured immediately before the change
- Temporary Line 2 assignment created by the platform
- Start and expiration timestamps
- Webex and Phonism verification status
- Audit actor/source metadata
- Lease status: active, expiring, restored, external-change-detected, failed, or reconciled

The browser is not responsible for expiration. Expiration must execute from backend state even when no user has the page open.

### Expiration behavior

At lease expiration:
1. Re-read the current Webex Line 2 state.
2. If it still matches the temporary assignment created by this lease, restore the captured permanent baseline.
3. Force Phonism Sync immediately.
4. Re-read Webex and Phonism registration and record the final result.
5. If the current Webex Line 2 differs from the lease's temporary assignment, treat it as external drift (for example, a later Control Hub change), preserve the current Webex state, and do not blindly restore the old baseline.
6. Record the external-change decision in Change History.

A Control Hub change is not automatically converted into a temporary lease. Control Hub remains the path for permanent assignments.

For production write enablement, use durable server-side lease state plus a scheduled/alarm-based expiry executor. The existing periodic maintenance schedule may be used as a reconciliation safety sweep, but the browser must never be the timer.

### User experience

The editor offers common durations: 30 minutes, 1 hour, 2 hours, 4 hours, 8 hours, and 12 hours maximum. The final confirmation displays the exact auto-revert timestamp, and the inventory shows active temporary leases and their expiration time.

## Operator identity and audit trail

Browsing device inventory does not require operator identification. Before a user can enter the line-change workflow, the platform requires:
- Full name
- Work email address

The browser stores only the server-issued operator session in session storage for the current browser session. The server stores the namespaced operator session in the existing `SESSIONS` KV namespace.

Every executed change must write an audit record to the existing `LOGS` KV namespace under the `device-audit:` prefix. Audit identity must never be accepted solely from change-request form fields; the backend resolves it from the validated operator session.

Server-captured audit evidence includes:
- Operator name and work email
- Source IP from Cloudflare request headers
- User agent/browser
- Timestamp
- Device name, IDs, and MAC where available
- Location
- Action type
- Previous and requested Line 2 state
- Temporary duration and expiration
- Change reason/note
- Webex result
- Phonism result
- Overall result
- Unique audit/mutation identifier

Automatic lease expiration/reconciliation uses actor `VisionBank Device Manager – Automated` and retains a link to the original human operator. Manual Reboot & Reverify recovery is audited as its own action.

The Change History UI exposes operator, source IP, device, location, action, provider results, and final result. Operator sessions expire after 12 hours and are namespaced so they do not collide with existing VisionBank authentication sessions.