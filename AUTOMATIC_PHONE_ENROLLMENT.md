# Automatic phone enrollment

The combined Cloudflare Worker runs `reconcilePhoneEnrollments` from its existing five-minute scheduled event. A new phone is enrolled once it is present in the VisionBank Iowa Phonism inventory and uniquely matches a Webex device by MAC, organization, and location. No first button press is required. The existing on-demand fleet enrollment remains available.

The job reads complete, paginated inventory snapshots and refuses incomplete input. It creates or refreshes fleet enrollment records only. It never changes line assignments, triggers Phonism sync, or reboots phones. Existing individually authenticated enrollments and revoked enrollments are preserved. Each pass creates/updates at most 50 records; subsequent passes finish larger batches.

Integration Health includes **Automatic phone enrollment**, with the last check, enrollment count, pending count, and mapping exceptions. Provider failures are retried on the next five-minute run. A phone missing from Phonism cannot be enrolled into this Phonism-backed workflow; correct its mapping first and the next scheduled run handles it.

Deploy with `scripts/integrate-auto-enrollment.mjs` applied to a fresh copy of the currently deployed combined Worker. Include `device-management/auto-enrollment.mjs` and the updated gateway, preserve all other modules, bindings, runtime settings, and the existing `*/5 * * * *` schedule. Never deploy the standalone repository worker as a replacement for the combined production Worker.
