# Phone Line 2 synchronization before restart

The reported 1406 save queued a restart about 2.7 seconds after the lease began without Phonism confirming the requested line. This change removes that unsafe fallback. It does not prove the handset display itself has updated.

- Wait for the requested Phonism Line 2 identity before requesting a restart.
- Save pending work before polling; the existing five-minute maintenance schedule retries delayed synchronization. No global schedule change.
- Revalidate the Webex target on retries and manual recovery. Stop retrying unconfirmed configurations after approximately ten minutes (at the next maintenance run), log an Issues event, and preserve automatic expiry.
- Match complete names or extension tokens rather than arbitrary substrings.
- Show still-syncing, needs-attention, or handset-unverified status instead of declaring every saved assignment active.
- Return from the initial locked phone wait screen after 60 seconds if no restart arrived; reopen Add Extension for status. Most saves are expected to restart promptly, but provider delay can extend this beyond 40 seconds.
- Preserve existing expiry restoration, primary line, Button 7 routing, enrollment, and phone model compatibility.

Validation: device-management regression suite plus delayed sync, stale target, retry completion, bounded failure, expiry, identity matching, and failed-read cases. A real T54W test must still confirm the extension is visible beneath the primary line and can place/receive a test call.

Deploy only the gateway and write modules from this change into the current Worker, preserving every other live module and binding. Publish device.html/device.js through the existing frontend deployment. Do not reboot production phones merely to smoke-test the release.
