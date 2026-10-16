# Handset Add Extension options

The handset menu offers 15 Minutes (retained for testing), All Day (9 hours from assignment), 7 Days, 30 Days, Custom Days (whole days 1–999), and Permanent. Other hourly presets are removed from the handset menu. Existing leases keep their original expiration.

Handset additions use the first available supported line starting at 2, accounting for occupied line weights and the Webex-reported maxLineCount. Missing capacity or a full phone fails before a write. Fresh membership and capacity are checked before applying. Existing secondary assignments are preserved.

Each managed assignment records lineNumber. Verification, recovery, sign-out, and expiration use that slot. Older records without lineNumber remain Line 2 for compatibility. Existing API field names baselineLine2/temporaryLine2 are retained as compatibility fields containing the owned slot's data.

Permanent assignments store expiresAt=null and permanent=true with no KV expiration. Scheduled maintenance still completes their pending synchronization, but never removes them automatically. The handset exposes explicit Remove Line actions; selecting one requires confirmation and affects only that assignment. Multiple managed assignments are listed individually with their own status, duration, and removal action.

This change does not alter the synchronization strategy or promise a shorter reboot time. The administrator's existing replacement workflow is retained; first-free allocation applies to handset Add Extension.

Validation: handset gateway and fleet flows; boundary validation; first-free Line 2/3/4; full/missing capacity; occupied line weights; preservation on expiry; permanent storage, scheduled maintenance and explicit removal; multiple managed lines with targeted removal; legacy lease regression tests.
