# VisionBank reporting resilience — 2026-09-28

## Scope
Reporting only. No Agent Desktop layout/routing changes. No security-policy, OAuth, wrap-up, secret, KV binding, cron, automatic sign-out, voicemail, or directory changes.

## Repair
- Main dashboard and Chat/Voice report browser requests have bounded 45-second timeouts.
- Dashboard-only agent-session search filters active sessions within the existing 30-day window. The original control/automatic-sign-out query is retained.
- Completed reporting snapshots are briefly reused; concurrent builds are coalesced per organization/day.
- Chat daily totals no longer duplicate the live query or wait unboundedly for optional first-connected timestamps. Missing enrichment remains explicitly unavailable.
- Reporting GraphQL reads enforce deadlines, reject malformed/paginated partial results, and log only query category/status/duration, not records or credentials.
- Chat core sections are independently bounded. Transient browser failures back off automatically while preserving only snapshots still within their existing freshness limits.
- HTTP 429 Retry-After is respected. Browser-generated retries do not create duplicate in-flight report requests.

## Guarded build
The builder requires the exact previously deployed combined Worker SHA-256. It permits three reporting deadline-literal changes, then appends reporting-only overrides. It asserts exactly one executable GET route for security, dashboard, Voice reports, and Chat reports.

Run unit tests with Node and Acorn installed, providing `VB_REPORT_BASELINE` as the path to the private retained combined Worker. The combined source and Cloudflare credentials must NOT be committed to this repository.

## Deployment boundary
Upload a zero-traffic version using every binding inherited from the explicitly verified production version. Compare uploaded source, all 32 bindings, runtime metadata, and cron configuration before promotion. Never deploy the repository's unrelated standalone Worker or recreate secrets. Use an existing-version promotion, not a plain Wrangler deployment.

## Verification
The release is not accepted solely from mock tests. Validate the actual candidate and production dashboard over multiple automatic refreshes: security, queues, agent rows, live Chat, daily/completed Chat, callback history and existing Voice reports. Confirm each reporting section returns ready data, and failures do not manufacture zero counts.

## Known separate work
The repeated Logged In-to-Available Agent Desktop refresh issue is outside this reporting release. Cisco's optional proactive-chat settings 404 and vendor widget stylesheet warning are also separate from reporting endpoint latency.
