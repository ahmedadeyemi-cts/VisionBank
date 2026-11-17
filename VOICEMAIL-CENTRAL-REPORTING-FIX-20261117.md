# VisionBank voicemail Central Time reporting fix — 2026-11-17

## Incident
The November 17 scheduled email for November 16 showed zero voicemail records, despite a recording shown in Contact Center at 2026-11-16 23:55:53 (portal time zone not established). The existing report explicitly uses America/Chicago.

## Frontend
voicemails.js now derives daily grouping keys from CreationDateUtc in America/Chicago rather than taking the UTC YYYY-MM-DD prefix.

## Production Cloudflare Worker
Worker: visionbank-security
Backup version: e2ce532a-de02-4cc4-8f1f-31053ca0445e
New deployed version: 410ceb14-2407-4cc6-89af-a5629cca6c88
Deployment: 100% after candidate validation.
The deployment maintained 25 modules, 41 bindings, and 12 secret bindings.

The live Worker main module is visionbank-worker-webex-dashboard-reporting.js (not the repository's worker.js). Its voicemail reporting handlers now share fetchVoicemailsForRange(env, start, end):
- Retrieve Contact Center /hist/voicemails/{date} for each report day and its adjacent API date buckets.
- Convert each CreationDateUtc timestamp to the America/Chicago calendar day.
- Include only records within the selected report range, and deduplicate by voicemail identifier.
- Reject failed upstream voicemail requests or malformed JSON rather than silently reporting zero.
- Use the shared logic for dashboard reporting, manual email reports, and scheduled emails.

No queue-specific filter was added or changed.

## Tests and validation
- Node syntax check passed.
- Regression simulation passed: 2026-11-17T05:55:53Z is included in the November 16 Central report, while 2026-11-17T06:01:00Z is excluded.
- Cloudflare version upload passed with zero traffic and all original bindings present.
- Production deployment confirmed the new version at 100% traffic.
- Remote smoke requests returned HTTP 403 both before and after deployment (existing access restriction); therefore actual authenticated voicemail counts could not be confirmed from the remote Mac.

## Follow-up
From an authorized VisionBank session, confirm that the November 16 report includes the relevant 39-second recording if its CreationDateUtc falls within November 16 Central. Verify the upstream queue scope and portal display time zone, since the screenshot names the MONITORING CENT queue. If appropriate, regenerate a historical report for November 16 and review the next scheduled email. Do not infer successful data reconciliation from the Cloudflare deployment status alone.

## Rollback
Cloudflare Worker version e2ce532a-de02-4cc4-8f1f-31053ca0445e was the pre-deployment baseline and can be redeployed if necessary.
