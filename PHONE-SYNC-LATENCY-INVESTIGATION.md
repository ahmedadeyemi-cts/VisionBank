# Add-line synchronization latency — October 15, 2026

PR145 immediate broad synchronization did not meet the latency target; PR146 restored device-first with a 15-second bounded fallback. The follow-up below defers the add-line fallback to 120 seconds based on newly inspected provider events. This is a reduction in overlapping work, not a proven latency guarantee. Preserve automatic sign-out, line confirmation before restart, expiry cleanup, and other platform changes.

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

## Follow-up: avoid premature overlapping synchronization

Portal logs now confirm a second Webex update during reboot on both devices. All times below are October 15 UTC.

| Event | T57W 313135 | T53 313100 |
|---|---|---|
| Application Save start | 22:19:27.993 | 22:22:19.911 |
| Initial Device sync accepted | 22:19:34.739 | 22:22:24.865 |
| Broader fallback accepted | 22:19:51.745 | 22:22:44.590 |
| Provider device information saved | 22:20:08 | 22:23:49 |
| Application reboot requested | 22:20:11.284 | 22:23:50.161 |
| Provider reboot queued | 22:20:12 | 22:23:50 |
| Provider reboot delivered / ACK | 22:20:22 | 22:24:04 |
| Second provider device update | 22:21:03 | 22:24:38–40 |
| Provider reboot done | 22:21:23 | 22:25:35 |

The second updates are consistent with overlapping initial/fallback jobs, but provider job IDs are unavailable, so causality is not established. Missing encrypted .enc requests occur on both models and routine hourly provisioning; they do not establish the cause of the pre-reboot delay.

The streamlined change retains the first tenant-scoped Device synchronization and the existing five-second readiness checks. It delays only the add-line broader recovery request until 120 seconds from syncPendingSince. Completion at 35, 85, or 115 seconds immediately queues the reboot without a second sync. Confirmation is always checked before the recovery threshold, including at its boundary. A still-pending assignment gets one broader recovery attempt; ambiguous acceptance is not retried on every refresh. Existing sign-out and expiry cleanup are unchanged. This is not a distributed single-flight lock and does not claim to prevent all concurrent KV writers.

Validation covers no broad request during the normal asynchronous window, prompt reboot when ready, one delayed fallback, ambiguous fallback failure, and changed/unreadable assignments. A controlled handset retest is still required: Save-to-reboot-ACK should be compared separately from reboot-to-configuration-ready. If Device-only sync cannot populate a new target, the delayed fallback can lengthen that case; preserve the fallback and use the timing logs to assess the tradeoff.
