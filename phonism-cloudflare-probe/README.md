# Cloudflare US Durable Object investigation

## Result: authenticated read passed

On October 22, 2026 at 19:24:01 UTC (12:24 PM Pacific), the isolated probe returned:
- Durable Object jurisdiction: us
- Supplementary Cloudflare network trace: US / DEN
- Phonism GET /api/v3/phones/313135/lines: HTTP 200
- Valid JSON API envelope, zero API errors
- Phonism response Ray ID: a4eae136af85e763-DEN
- Probe duration: 1,409 ms

See result.json for sanitized evidence. No raw response, SIP credentials or API key was retained.

The user supplied account screenshots confirming an existing Workers Paid subscription and current billable usage within included limits, including Durable Objects. No plan upgrade or new paid subscription was created. This bounded test does not establish that unlimited future production usage will remain within the allowance.

## Isolation and cleanup

A standalone SQLite-backed Durable Object used jurisdiction("us"), with workers.dev and preview URLs disabled and no routes or schedules. A zero-production-traffic version of the existing Worker called it through an internal service binding, using the existing Phonism secret without exporting the secret. Its temporary access was protected by a randomly generated token hash and a ten-minute expiry.

The probe allowed only a fixed GET of phone 313135, capped at six invocations. One authenticated invocation was made. It could not update lines, sync or reboot phones.

The temporary probe Worker was deleted after testing. Production remained on version c75d3d16-3437-4213-8813-41b4952efc73 at 100% throughout. The temporary version must NEVER be promoted; it is a diagnostics-only handler.

## Validation

- Wrangler 4.138.0 deployment dry run passed.
- Six local tests passed: US jurisdiction enforcement, method/route restrictions, cap, fixed GET, credential/body redaction, failure classification.
- Live unauthenticated access to the temporary test route was rejected.
- Live authenticated Phonism read succeeded.

## Still required before production adoption

Adapt the shared Phonism transport to an internal US-jurisdiction Durable Object, covering both scheduled and interactive operations. Preserve lease baselines, terminal markers, permanent assignments and verification-before-reboot gates. Add bounded timeouts, request/response limits and no retry of ambiguous writes.

Review the production change through a PR; validate and deploy separately. Then run a complete unattended 15-minute expiry on an authorized test handset and confirm physical removal.

US runtime placement plus this successful read is good evidence for this approach. The vendor's country classification and future usage must remain observable. This result alone does not certify production expiry or every possible future egress path.

References:
- https://developers.cloudflare.com/durable-objects/reference/data-location/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
