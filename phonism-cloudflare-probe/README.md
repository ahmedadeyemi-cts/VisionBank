# Cloudflare US Durable Object investigation

Prepared October 22, 2026. This is a read-only connectivity probe, not a production relay.

Verified:
- Cloudflare documents jurisdiction("us") for Durable Objects.
- SQLite-backed Durable Objects are available on Free and Paid Workers plans.
- This account already has an unrelated SQLite-backed Durable Object.
- Wrangler 4.138.0 deploy --dry-run passes.
- Six local tests pass for jurisdiction enforcement, method/route restrictions, six-request cap, fixed GET target, credential/body redaction, and failure classification.

Not verified:
- Account plan and remaining included usage. The existing API authorization gets HTTP 403 reading subscriptions; browser GitHub sign-in was rejected by Cloudflare after mobile approval.
- Live deployment and runtime support in this account.
- Phonism acceptance of authenticated requests from the US-restricted object.
- Outbound country as observed by Phonism. A Cloudflare trace is only supplementary evidence, not proof of the vendor's classification.
- End-to-end unattended expiry.

No resources deployed, subscriptions changed, production versions promoted, line writes or reboots performed.

Next steps:
1. Verify account Workers plan and current Durable Object usage against included allowance before any live invocation.
2. Deploy only this standalone internal probe (workers.dev and preview URLs disabled; no routes or cron).
3. Use a short-lived authenticated zero-traffic candidate of the existing Worker to call the probe through an internal service binding, using the existing server-side Phonism secret without exporting it. Do not expose raw upstream responses or secret values.
4. Inspect sanitized result and ask Phonism to confirm the logged origin if needed.
5. Remove the temporary candidate access and probe when testing finishes.
6. Only if verified, prepare a separate production change and unattended 15-minute expiry test.

Phonism target is fixed to GET /api/v3/phones/313135/lines. No user-controlled destination, method or phone ID is accepted. The probe has a six-invocation cap and no repeating timers or alarms. It returns status, a success boolean, jurisdiction and safe correlation/location diagnostics only.

References:
- https://developers.cloudflare.com/durable-objects/reference/data-location/
- https://developers.cloudflare.com/durable-objects/platform/pricing/
