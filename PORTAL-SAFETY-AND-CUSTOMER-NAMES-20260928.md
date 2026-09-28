# Portal roster handling and optional Chat customer names

## Observed incident versus inferred causes
- Native Chromium requests to the legacy agent API returned HTTP 200 with `AgentStatus: []`. The previous frontend incorrectly showed an error for that legitimate empty response. Missing/malformed arrays and failed requests remain errors.
- In direct-browser testing, Webex security, dashboard and Chat reporting loaded. The later intermittent Webex stall in the screenshot was not reproduced. Do not report a universal outage or infer that agents signed out from missing data.
- Earlier reporting smoke checks used Playwright route.fetch for API requests. This release's native checks do not proxy or substitute API responses; only candidate static frontend assets are overridden before release.

## Change boundaries
- Legacy agent roster distinguishes empty, invalid and failed results. A bounded 30-second transport and per-path in-flight coalescing prevent overlapping or indefinitely hanging legacy reads. No token or legacy API URL was changed.
- Webex exposes safe request-state diagnostics in `window.VB_REPORT_HEALTH` (endpoint, HTTP status, timestamps, duration, coarse failure reason only). No report calculations or server report transport changed.
- Customer Name is shown before Contact ID in handled, active/completed and abandoned Chat views. It participates in existing search, sort and CSV export, including HTML escaping and CSV formula protection.
- A new protected GET `/api/webex/chat-customer-names?ids=<up to 50 UUIDs>` reads only `taskDetails.customer.name` for those exact Chat contact IDs in the last 30 days. No customer email, phone or transcript fields are queried.
- Name lookup is independently bounded to four seconds server-side; 6.5 seconds browser-side. Failure leaves the primary reporting tables intact. Positive/missing responses cache for five minutes; failed browser lookups back off for one minute.
- The name is source-reported, not verified banking identity. No inferred or agent-name fallback is permitted.
- Existing combined Worker bytes are preserved exactly except insertion of the new GET route plus an appended implementation. No change to security policy, CORS policy, OAuth rotation, wrap-up, active calls, cron configuration, or Agent Desktop widgets.

## Release gates (required before a production promotion)
1. Read current deployment and version-pinned combined source. Reject any mismatch against the approved baseline hash.
2. Build with `scripts/build-customer-names-r6.mjs`; require exactly one executable route each for security, dashboard, Voice reports, Chat reports and customer names. Never use the repository's partial Worker as production source.
3. Run `tests/portal-safety/policy.test.mjs` with ACORN_MODULE and private VB_PRIVATE_BASELINE. Private exact-source test is explicitly skipped in public CI, never represented as verified there.
4. Upload deploy=false, inherit all 32 bindings from the exact live version and compare full names/types, KV IDs, variable values, runtime settings, modules and fetch/scheduled handlers. Secret contents cannot be compared via metadata; they are inherited, never re-entered or logged.
5. Validate BOTH portals through actual browser requests and automatic refresh cycles. Keep a genuine empty roster distinct from upstream failure. Verify names against exact Contact IDs and CSV export.
6. Inject missing/malformed legacy data and main-report/name-service failures only in a separate test browser. Require automatic report recovery and no fabricated zero totals or misattributed names.
7. Promote only the validated existing version, merge tested frontend SHA, compare served asset hashes, repeat both-portal browser checks, verify unchanged cron and release version.

## Continuous integration
Portal regression workflow is read-only with pinned Actions and a lockfile-pinned parser dependency. It has no Cloudflare credentials or deployment steps. Branch protection/required-check settings were not changed by this release.

## Rollback
Restore the recorded previous frontend merge and existing Worker version as a matched release after verifying current production state. Do not rebuild from a partial wrangler configuration or recreate secrets. Customer-name failure by itself does not require rolling back the working core reports.
