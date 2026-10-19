# Directory to CEG Address Book synchronization

Directory refresh remains on `17 */3 * * *` (UTC), and **Sync now** runs the same pipeline. After a successful canonical directory sync, the main Worker updates CEG Address Book `b404018a-eecb-4671-ba18-7a18b259cff0`. Version 4 bootstraps this once through the existing maintenance task.

Only Webex-linked directory contacts are managed. Full phone numbers are preferred (US 10-digit numbers gain +1; international numbers retain their country code), with extension fallback when there is no phone number. Names are normalized to the API's supported character set. Initial adoption requires unique normalized names on both sides; later updates use persisted Webex identity-to-entry-ID mappings. Duplicate names, invalid numbers, and manually changed managed entries are held for review. Unmatched/manual address-book entries are preserved. This release does not delete address-book entries.

The companion directory object stores a five-minute renewable lease and mapping checkpoints. Scheduled/manual address-book runs cannot overlap. Bulk writes include current resource versions, process each 207 item status, and checkpoint successes. A complete paginated read-back confirms writes before successful completion. Errors retain the last confirmed completion time and do not erase the successful directory refresh.

The directory page displays a separate address-book status with additions, updates, review counts, last confirmed time, and errors. The existing one-minute status refresh does not overwrite unsaved edits.

API contract checked against Cisco documentation on 2026-10-19:
- GET /organization/{orgid}/v3/address-book/{id}
- GET /organization/{orgid}/v2/address-book/{addressBookId}/entry
- POST /organization/{orgid}/address-book/{addressBookId}/entry/bulk
- Bulk body: items with itemIdentifier, requestAction SAVE, item (organizationId, name, number; id/version for updates).
- cjp:config_read and cjp:config_write plus Contact Center user-profile permissions are required.

Deployment: patch only directory-sync/sync.mjs in the current main, sync.mjs/store.mjs in the current companion, and add address-book.mjs to both. Preserve all other live modules, bindings, migrations and schedules. Deploy companion before main. Publish directory.html/directory.js through the existing Render deployment. Rollback uses saved live versions; do not restore stale directory data or unrelated Worker files.
