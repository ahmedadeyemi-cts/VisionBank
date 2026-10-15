# Temporary phone line expiry and longer durations

Adds 1 day, 7 days, and 30 days to handset and web selections. Existing choices and the web 1-hour default remain. The shared API limit is 30 days; expiry is an elapsed duration, not a calendar-day boundary.

Expiry and early sign-out now require both the current Webex Line 2 and Phonism configuration to match the restored baseline before requesting a restart. This includes positively confirming that Line 2 is absent when removal is expected. An unavailable provider read is not confirmation. The existing five-minute maintenance schedule retries pending cleanup; an attention event is logged initially and a failure event after ten minutes without confirmation. Cleanup continues retrying. A new Webex assignment supersedes delayed cleanup without an obsolete write or restart.

The phone displays a removal-pending message during cleanup, and status reads cannot overwrite closed or restoring lease state. Configuration confirmation still does not verify physical handset display or line registration on phones without monitoring.

Validation: device-management and portal-shell tests cover duration limits and labels, 30-day expiry, delayed removal, failed provider reads, newer-assignment protection, and no repeated restart after completed cleanup. No production phone was deliberately changed to test this release. A physical add/expire/add test remains necessary.
