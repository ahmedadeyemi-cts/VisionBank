# Abandoned Callback Settings v1

## Implemented scope
A separate button below the existing dashboard header opens shared callback configuration. Branding and the existing fixed-position header buttons are unchanged. No new login or acknowledgement is required. Existing server-side IP/hours access policy remains mandatory; empty allowlists, unverified edge addresses, Worker subrequests and unapproved browser origins fail closed for these new routes.

The saved enabled switch does not depend on the browser, a reporting response, or deployment defaults. Configuration and its audit event commit together in a SQLite-backed Durable Object. Version conflicts return 409 instead of overwriting another editor. A mutation ID supports reconciliation and safe retries without duplicate audit events. No-op saves do not change attribution. Stored corruption and unavailable storage do not silently reset configuration.

Last changed by records the Cloudflare-observed source IP, reduced browser/OS labels, UTC timestamp, version and server-generated request ID. This is network/device context, not verified individual identity. Computer name and internal IP remain null because no trusted device integration is configured. Browser-supplied names, source-IP fields, X-Forwarded-For and X-Computer-Name are not accepted as attribution. History is append-only through this API and has version-based pagination; it has no application TTL.

Settings include one configured Voice queue, manual or automatic-new-abandoned mode, a delay/window, Central-time calling days/hours and excluded dates. Manual is the initial mode; the master switch initially defaults Off only for an empty store. The fixed policy is one callback per original abandoned call, one customer-dial attempt, any available agent, and exactly: **Callback for missed call from customer**.

## Execution is NOT included in this PR
This is the settings/audit foundation, not an implementation of native callback scheduling. Saving Enabled returns **Enabled — processing paused**. There are no customer numbers, call actions, callback API writes, browser dial timers, cron changes or alarms in this release. Do not claim this PR schedules calls, enforces a native dial-flow attempt limit, displays the reason to an incoming agent, or cancels existing Webex schedules.

The next integration must validate REST authorization, the configured callback entry point/flow, visible agent reason, one-attempt behavior, atomic per-contact deduplication and reconciliation of uncertain callback creations. It must read the authoritative enabled switch before creating a callback. Automatic mode must not backfill earlier abandoned calls without explicit approval. Disabling will stop new creations, not terminate active calls or automatically cancel accepted Webex schedules.

## Storage and guarded rollout
- `callback-settings/wrangler.jsonc` is a complete configuration for a NEW private companion Worker, `visionbank-abandoned-callback-settings`. It is NOT a replacement configuration for `visionbank-security`. Do not deploy the repository's unrelated root configuration.
- The companion exports the stable `AbandonedCallbackSettingsV1` SQLite Durable Object class. Public workers.dev/preview URLs are disabled and its default HTTP handler always returns 404. Preserve its namespace, class and per-organization object name across upgrades; never recreate it to roll out a frontend change.
- The existing combined security Worker requires ONE additional external Durable Object binding named `ABANDONED_CALLBACK_SETTINGS`. All 32 existing bindings, their resource identities/variable values and runtime settings must be inherited unchanged. This introduces no new VM or on-premises agent.
- `scripts/build-abandoned-callback-settings-v1.mjs` rejects any baseline other than the verified R7 bytes. It inserts only the two new settings/history routes and appends the gateway import. The entire old Worker is recoverable byte-for-byte. Include both returned gateway/policy ES modules in an upload.
- Before promotion: create a PR, run checks, provision/verify the private store, upload a zero-traffic combined candidate with all 32+1 bindings verified, validate normal security/CORS and both existing portals, and verify settings persistence against isolated test storage. Publish matching frontend assets only after backend verification. Do not reset real saved configuration during validation.
- The uncommitted R8 dashboard-lifecycle repair is separate and untouched. A later deployed baseline requires explicit rebasing/review, not bypassing the builder's source fingerprint.

## Tests
Policy/transaction tests exercise persistence, spoofed attribution, denied origins/networks, concurrent editors, audit-write rollback, idempotency, rate limits, corrupt data, queue validation and history pagination. The local workerd/SQLite test restarts the runtime against persistent storage. Actual-page browser tests use synthetic reporting and an isolated settings backend, cover reload/two-tab behavior, uncertain saves, conflicts, outages, themes, accessible layouts and access revocation. These tests do not place real calls.

References: Cloudflare Durable Objects storage transactions and HTTP header semantics; Cisco scheduled-callback configuration and Desktop documentation. The original Desktop logs establish that a scheduling module initialized, not that this external dashboard is authorized or its callback flow is correctly configured.
