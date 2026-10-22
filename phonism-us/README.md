# US-restricted Phonism transport

Phonism rejects API requests from countries outside its allowlist. Scheduled Workers can execute globally, so successful interactive requests did not guarantee successful temporary-line expiry.

This companion exports a SQLite-backed Durable Object, PhonismUS. The production Worker selects PHONISM_US.jurisdiction('us') and the object verifies ctx.id.jurisdiction before making any upstream request. This is a jurisdiction restriction, not a best-effort placement hint.

The companion has no public route, workers.dev endpoint, preview URL, or cron. Its default handler returns 404. The main Worker invokes it through an account-internal Durable Object binding. The existing API key is passed in memory; this service never persists it or logs request/response bodies, URLs, phone identifiers, or headers.

## Deployment

1. Run node --test tests/device-management/*.test.mjs.
2. Deploy this directory's wrangler.jsonc using the existing Cloudflare account.
3. Add the main Worker binding PHONISM_US (type durable_object_namespace) using this companion's namespace ID.
4. Set main Worker PHONISM_TRANSPORT to cloudflare-us and deploy device-management/phonism.mjs. Preserve every other module, binding, secret, and schedule.
5. Verify an authenticated read and unattended temporary-line expiry.

When cloudflare-us is selected, missing bindings, invalid jurisdiction, and transport errors fail closed. There is no fallback to unrestricted egress. Legacy environments without the setting retain direct transport for compatibility; production must include the setting.

Reads, integration sync, and Reboot all use the same route. Only existing required API routes are allowed; factory reset, arbitrary destinations, unrelated writes, and redirects are not followed. Responses preserve provider correlation IDs and are not cached. Requests are bounded to 256 KiB, responses to 4 MiB, upstream time to 15 seconds, and concurrent calls to 16. Existing caller timeouts remain in effect.

A local/transport failure is an unknown upstream outcome. The client does not blindly retry it. Existing sync retries apply only to explicit upstream responses carrying route provenance; reboots are never retried here. No lease or baseline semantics change.

## Validation and cost

The preceding read-only probe on 2026-10-22 at 19:24:01 UTC successfully read phone 313135 lines: HTTP 200, valid API envelope, zero provider errors, cf-ray a4eae136af85e763-DEN, 1409 ms. A supplementary trace reported US/DEN. The test confirms this route worked with Phonism's firewall; runtime jurisdiction is not a vendor contractual guarantee about every future egress IP.

The account already has Workers Paid and included Durable Object allowances. This requires no additional hosting subscription. Usage remains metered under that plan; it is not an unlimited-free guarantee.

## Rollback

Restore the previous main Worker production version first. Leave the companion present until no deployed version references it. Restoring direct transport also restores the original geographic risk, so rollback is an operational fallback, not a solution to the firewall failure.
