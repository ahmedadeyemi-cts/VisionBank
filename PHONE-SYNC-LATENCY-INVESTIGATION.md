# Add-line synchronization latency — October 15, 2026

PR145 immediate broad synchronization did not meet the latency target; revert to device-first with the existing 15-second bounded fallback. This is containment, not a proven performance fix. Preserve automatic sign-out, line confirmation before restart, expiry cleanup, and other platform changes.

## Production evidence

| Model | Lease | Extension | Save accepted UTC | Restart requested UTC | Accepted-to-request | User observed |
|---|---|---|---|---|---|---|
| T57W | 2eb15344-1b40-437c-837e-258709023d63 | 1106 | 21:59:42.771 | 22:00:39.451 | 56.680 sec | 76 sec |
| T53 | dddaa2ca-3dba-4287-83a3-ee182f32680d | 1108 | 22:01:42.951 | 22:03:23.253 | 100.302 sec | 108 sec |

Both used assignment-immediate and phone-progress confirmation. Latest parallel read durations: T57W 651 ms; T53 443 ms. Seven and fourteen subsequent checks respectively. Each queued one automatic restart attempt. These logs localize the major wait to line readiness/visibility, but do not distinguish provider job queue time, Webex propagation, or internal provider caching. Acceptance is after the Webex write and sync API acceptance, not necessarily the physical Save-button time. The T53 selected 1108 in this run versus 1107 previously, so the runs are not controlled equivalents.

## Verified public API documentation

The vendor's current API documentation is https://apidocs.phonism.com/ (linked from https://www.inlayer.com/products/inlayer-api). Its public Postman collection is https://apidocs.phonism.com/api/collections/50382646/2sBXqDsNhZ?segregateAuth=true&versionTag=latest . The older wiki Postman link returns 404.

Documented sync operations: PUT /api/v3/hierarchy/:id/integrations/sync and PUT /api/v3/integrations/:id/sync. Both queue work and accept company_id, tenant_id and asset_type filters. No single-phone Webex sync operation was found in this collection. Existing integration requests include the verified tenant_id. The portal has a single-phone Sync From Webex control, but an API-key equivalent has not been verified. Do not substitute browser credentials/cookies in the Worker.

## Questions for Phonism/Inlayer support

Please inspect Webex integration queue and device-configuration processing for the two UTC intervals above and confirm:
1. When each job started, fetched updated Webex line configuration, and exposed the new Line 2 via GET /phones/:id/lines.
2. Whether tenant_id alone restricts work to one location, or company_id must also identify the Webex domain to avoid partner-wide traversal.
3. The supported API-key operation equivalent to the portal's single-phone Sync From Webex control, including parameters, response semantics, rate limits, and completion status.
4. Whether device config synchronization or lines reads have a minimum refresh interval or internal cache, and any supported way to request fresh data.
5. Expected queue-to-ready latency and any account-side concurrency/throttling limits.

No vendor message has been sent. A stable under-one-minute result has not been established. Avoid more production timer-only changes without evidence of the actual limiting stage.
