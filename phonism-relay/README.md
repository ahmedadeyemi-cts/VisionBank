# VisionBank Phonism US connection

Phonism confirmed that its country firewall rejected a Cloudflare scheduled request from Amsterdam before it reached the application. An authenticated read of phone 313135 from Render Oregon succeeded on October 22, 2026. This service gives the existing Worker a region-selected path for Phonism API calls.

## Deploy

Create a dedicated Render web service in the confirmed My Workspace account:
- Name: visionbank-phonism-us
- Repository: ahmedadeyemi-cts/VisionBank
- Region: Oregon
- Runtime: Node; NODE_VERSION=22
- Build: node --check phonism-relay/server.mjs
- Start: node phonism-relay/server.mjs
- HTTP health path: /healthz
- Instance: always-on Starter (confirm current charge before provisioning)
- Auto deploy: off; release the reviewed commit explicitly
- Secret PHONISM_RELAY_TOKEN: a newly generated cryptographically random value of at least 32 characters.

Configure the same secret as PHONISM_RELAY_TOKEN on visionbank-security and set PHONISM_RELAY_URL to the exact new service HTTPS origin. Preserve every other Worker binding and cron schedule. The existing PHONISM_API_KEY remains a Worker secret; the authenticated Worker forwards it over HTTPS to this customer-owned relay on each request. It is not copied into source, logs, or a persistent Render variable.

Do not reuse the agent-logout cron or resume the old suspended web service. Do not select Free for the production connection: idle spin-down would introduce cold-start delays.

## Safety and behavior

The relay accepts only the existing inventory reads, integration sync, and Reboot operation, always to app.phonism.com/api/v3. It rejects factory reset, DELETE, arbitrary destinations, redirects, traversal, unauthenticated requests, and unsupported routes. Responses are not cached. Limits bound concurrency, request/response size and upstream duration. Logs contain only request correlation, method, status, dispatch flag and elapsed milliseconds.

The Worker shares this transport across interactive and scheduled workflows. With relay configuration present it never falls back to direct Cloudflare egress. A relay or hosting gateway failure has an uncertain write outcome, so it cannot trigger immediate duplicate sync/reboot requests. Existing bounded retries remain only for responses explicitly returned by Phonism. The existing cleanup state machine, baseline restoration, terminal markers and verification gates are unchanged.

## Release and verification

1. Run node --test tests/device-management/*.test.mjs.
2. Deploy this relay and verify /healthz plus unauthorized rejection.
3. Create a zero-traffic Worker candidate with only the Phonism client change and two relay bindings. Verify module hashes, inherited bindings and unchanged schedules.
4. Verify an authenticated read through the candidate, without printing SIP credentials or raw upstream data.
5. Promote the reviewed candidate after PR merge and repeat a production read.
6. On the specifically authorized test handset, add a 15-minute temporary line. Observe scheduled expiry without manually triggering cleanup. Verify Webex baseline, Phonism line state, provisioning/reboot and physical handset removal. Record timestamps and correlation IDs; do not mark the incident resolved from a read-only test.
7. Confirm other pending temporary leases recover while preserving permanent and manually configured lines.

The Oregon deployment controls where this service runs; it does not promise a dedicated static IP or a Phonism firewall exception. If provider access policy changes, errors must remain visible rather than silently reported as success.

## Rollback

Retain the prior Worker version and relay. Roll back the Worker version only if the new transport introduces a regression, preserving current lease records and terminal markers. The old direct route still has the known country-firewall limitation; rollback does not solve that incident. Never replay uncertain writes, reset phones, or erase lease baselines as a rollback.
