# Device-first assignment synchronization

The 2026-10-15 post-release tests still showed about 18 seconds from save acceptance to restart request for Ahmed's T57W and about 96 seconds for the T53 test handset. Both were using frequent handset confirmation, so extending polling alone did not remove the provider-side readiness delay.

Initial temporary assignment sync now requests only the Device asset type, scoped to the existing verified phone tenant and enterprise integration owner. This skips the People and Workspace inventory scans in the initial request. It is location-scoped device sync, not a verified single-phone API call.

If both providers are readable, Webex still has the expected assignment, and Phonism has not exposed the target line after 45 seconds, issue one broader People/Workspace/Device sync. Persist the attempt before dispatch, bound that fallback request to three seconds without transport retries, and keep confirming the line even if dispatch returns an ambiguous error. Never submit a new sync on every progress refresh. Existing leases without the device-first marker do not change behavior. Near-expiry, expired, changed-assignment and failed/timed-out jobs do not start the fallback.

The provider console exposes Sync From Webex on an individual phone. Its frontend uses POST /phones/sync_webex with a phone_id, through an authenticated browser session. No API-key-authenticated equivalent was verified. Do not embed browser passwords, cookies, or session renewal into the worker to imitate it. The provider's linked public Postman reference returned 404 during this investigation.

The existing five-second progress refresh, five-minute handset check window, confirmation before reboot, expiry restoration, duration options and countdown remain. Cleanup continues to use its existing full sync behavior.

Validation: 212 device-management tests pass, including device-only initial payload, bounded one-shot fallback, target changes, unreadable providers, ambiguous failures, late confirmation, expiry and restoration. Physical handset timing after this change is still required; one minute is a target, not a guaranteed completion time.
