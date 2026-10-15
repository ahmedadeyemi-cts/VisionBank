# Phone synchronization confirmation

Hudson's 2026-10-15 save took 223 seconds to reach the restart request. Webex save and Phonism sync acceptance took approximately seven seconds. The existing 90-second handset ownership window then expired, leaving minute-based scheduled confirmation.

This change preserves five-second handset refreshes through a fixed five-minute confirmation window. Each check reads Webex and Phonism concurrently and requires both to confirm the intended assignment before reboot. Phone line reads request fresh status with Cache-Control: no-cache. This does not bypass the provider's internal processing.

The ownership deadline remains fixed, with a ten-second handoff guard. Cron does not compete with the handset during this window. If the handset stops polling, scheduled recovery takes over after the fixed five-minute window; this is a longer unattended fallback delay than the previous 90-second window. Lock-in progress refresh normally keeps the handset polling. Expiry and changed-assignment protections remain in effect, and overlapping requests are coalesced within each Worker isolate, not globally.

No new sync job is submitted on each check. No undocumented targeted-device API or reduced asset scope is used. One minute is a performance target, not a verified service guarantee. A physical handset run is still required to measure provider readiness and actual reboot completion.

Tests cover late convergence on T53/T54W/T57W, concurrent reads, changed Webex assignment despite a failed Phonism read, expiry, fresh line reads, and the existing save/restore/reboot behavior.
