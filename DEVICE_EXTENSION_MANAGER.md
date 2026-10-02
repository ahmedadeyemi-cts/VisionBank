# VisionBank Device & Extension Manager

## Objective

Provide a nontechnical, location-scoped workspace at `/device` for managing secondary phone-line assignments across VisionBank Webex Calling phones that are physically provisioned through Phonism by InLayer.

Initial release scope:
- Show Webex Calling locations.
- Show partner-managed phones correlated to Phonism by MAC address.
- Show primary owner, Line 1, optional Line 2, and independent Webex + Phonism registration/sync health.
- Search by person/workspace name, extension, phone number, or MAC.
- Filter by location, owner type, and registration status.
- Allow Line 2 to be added, replaced, or removed only with a user/workspace from the same location.
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
3. Backend rejects cross-location assignments.
4. Backend creates a one-time mutation ID and preview.
5. User reviews current vs proposed assignment.
6. Backend revalidates version/state before any write.
7. Perform only the supported Webex association write.
8. Immediately invoke the verified Phonism Sync action so the Webex change is pulled into Phonism without waiting for the normal periodic synchronization.
9. Re-read Webex registration and Phonism line-registration status independently.
10. Mark Completed only when the desired Line 2 assignment is present and both systems report healthy registration.
11. If Sync was attempted but Line 2 remains unhealthy, create a recovery-eligible record. Factory Reset remains a separate, explicit recovery action and is never automatic.
12. Record complete, mismatch, pending-verification, recovery-eligible, failed, or unknown result in audit history.

Never blindly retry a write after an unknown network response. Reconcile first.
## Phonism action safety

Do not wire these actions as normal post-save behavior:
- Factory Reset
- Reset Config / Reset Configuration

Public Phonism documentation describes those as destructive or configuration-clearing actions.

Normal production behavior is Save in Webex → force Phonism Sync → verify both registration states. The exact Phonism API endpoint behind the existing Sync action must be verified rather than guessed.

Factory Reset is permitted only as a supervised recovery action after Sync has already been attempted and Line 2 is still unhealthy. The backend must verify the factory-reset endpoint, create a recovery record, require explicit confirmation, audit the operation separately, then wait for reprovisioning and re-check both systems.

## Required backend endpoints

Front end contract:
- `GET /api/webex/device-management/capabilities`
- `GET /api/webex/device-management/locations`
- `GET /api/webex/device-management/inventory?locationId=...`
- `GET /api/webex/device-management/members?locationId=...&deviceId=...`
- `GET /api/webex/device-management/history`
- `POST /api/webex/device-management/preview`
- `POST /api/webex/device-management/apply` — Save in Webex, force Phonism Sync, then verify both systems.
- `POST /api/webex/device-management/factory-reset` — recovery-only; requires server-issued recovery eligibility and explicit confirmation.

All endpoints must retain the existing VisionBank approved-network and trusted-origin checks.

## Write enablement gates

The UI must remain read-only until all are true:
- Existing Webex OAuth can enumerate locations and partner-managed devices.
- Required Webex read scopes are confirmed.
- Any Webex write path is proven against the customer's device type.
- Phonism API authentication is configured server-side.
- Device lookup by MAC is proven.
- Line read/write endpoint is proven.
- Exact Phonism Sync API action is proven and can be triggered immediately after a Webex save.
- Webex registration status read is proven for the customer device/line type.
- Phonism line-registration status read is proven.
- Factory-reset API action is separately verified before any recovery control can be enabled.
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
- Recovery eligible — Sync was attempted, verification still failed, and Factory Reset may be offered as a separate supervised action.
- Partial — one system updated and another did not.
- Rejected — validation blocked the request before writes.
- Failed — provider returned a terminal failure.
- Unknown — response was lost; reconciliation required before retry.

No partial or unknown state may be presented as completed.
