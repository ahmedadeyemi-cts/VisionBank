# Dashboard request lifecycle R8

## Evidence and scope
On September 30, a production dashboard request was canceled after 45,192 ms while a separate native browser completed ten dashboard reads in 904–1,673 ms. The canceled request emitted no report-query diagnostics. This confirms an intermittent request stall, but does not by itself locate its exact upstream cause or identify the customer's Chrome tab.

A regression test reproduces an independent defect in the deployed R5 dashboard cache: a later caller awaits a cached in-flight promise without its own deadline. A canceled owner can therefore leave later callers dependent on request-scoped work that no longer completes. The reproduction seeds the orphaned promise; it is not a claim that a live cancellation was replayed deterministically.

## Repair
- Cache completed dashboard JSON only, never a different request's promise, timers, streams or response.
- Store only a plain-data build lease. A 39-second expired lease is recoverable after a canceled owner.
- A waiting caller uses its own timer, waits at most three seconds, then receives a retryable response rather than waiting indefinitely.
- Preserve the five-second completed-data TTL and one active build per organization/day. The owner retains a 37-second build limit; the entire dashboard handler has an independent 40-second deadline, including its retained security check.
- An expired owner's late completion cannot overwrite a replacement owner's cached result or clear its lease.
- Existing security decisions still run before any report or cache result is returned. Failed authorization or missing data never produces invented zero counts.
- Phase/timing diagnostics contain no credentials, contact IDs, customer names or agent names.

## Preservation
The exact R7 combined source is retained byte-for-byte. Only dashboard cache/handler overrides are appended. The guarded builder rejects any different baseline and verifies retained security/report routes. No frontend files, statistics calculations, polling intervals, reporting queries, Chat/name caches, routing, call controls, OAuth, legacy portal or scheduled handler are changed. All 32 bindings must be inherited and validated before promotion. Never deploy this patch as a standalone Worker.

## Validation and rollout
15 targeted tests cover the old unbounded wait, concurrent callers, abandoned/expired owners, bounded waits, late results, failed/hung builds, organization isolation, denied access and exact-source preservation. They are included in the existing Portal regression workflow. Live candidate and production checks remain mandatory. Do not declare the customer's specific intermittent path reproduced solely because a separate browser passes.

## Callback-compatible release

The release builder also accepts the exact reviewed callback-workspace root (PR #16), without relaxing its byte-fingerprint requirement. Existing reporting calculations, native-calling gates and all storage are unchanged. An expired owner cannot return an older report after a replacement owner completes; it returns the newer completed snapshot or a bounded retry error. The release preserves the original callback-free reporting source and appends the R8 repair after the callback router has been built. No Webex flow or caller-ID configuration is modified.
