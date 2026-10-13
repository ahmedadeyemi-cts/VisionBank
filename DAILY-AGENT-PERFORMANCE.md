# Daily agent performance

Both Voice and Chat offered/missed default to Today (America/Chicago). Current session remains selectable. Voice and Chat each have their own independent performance period selector; changing one does not change the other. Existing Chat handled/completed columns continue to use daily contact history and last-agent attribution. Live state, channel slots, and state duration remain independent.

The new access-checked `/api/webex/agent-performance` endpoint reconstructs daily totals from Webex historical agent sessions, keyed by agent ID and deduplicated by session ID. Closed sessions are included; there is no browser-owned history to erase. Historical agent rows survive logout. Average handle time is calculated from summed durations and counts, not averaged session averages. Provider history remains the source of truth across backend restarts. No additional database or storage binding is required.

The backend uses the existing tenant-scoped, Central-day cache and reporting transport (30-second cache; full pagination; existing query deadline). The browser refreshes every 30 seconds while visible, rejects stale/previous-day snapshots, and retries errors without substituting zeros. Search reporting can lag.

## Deliberate limitations

Lifetime counters for a session that spans Central midnight cannot be reliably divided into days. Affected channel totals display Not reported rather than yesterday plus today or partial totals. A subsequent same-day login cannot reconstruct that earlier portion. A future activity-level reporting adapter is needed for complete overnight-session coverage. Session discovery follows the existing 30-day lookback. Missing individual provider fields remain Not reported. Chat handled/completed remain contact totals attributed to the last agent, not every participant.

## Release

Deploy the backend before merging the frontend PR (the frontend repository deploys separately). Fetch and verify the exact active combined visionbank-security Worker first; the repository's worker.js is NOT that combined Worker.

Use `scripts/integrate-daily-agent-performance.mjs` to add the guarded route/import to that verified main module. Add `worker-patches/daily-agent-performance.mjs` as the sibling module `daily-agent-performance.mjs`. Preserve all existing modules, bindings, compatibility flags, runtime settings, routes, and schedules. Validate a zero-traffic version before promotion. Do not deploy the standalone repository worker.js.

Unit tests cover relogin, closed sessions, duplicates, missing fields, weighted averages, pagination failure, midnight/stale browser rejection, session view, and integration/auth guard. Integration syntax was checked against the caller-history candidate source. An initial Cloudflare HTTP 401 was resolved by refreshing the existing CLI authentication. The live provider query subsequently passed (one query, three agents, voice and chat rows, no unavailable midnight sessions). A zero-traffic combined Worker candidate passed module-hash, binding, runtime-setting and baseline checks; see the release manifest. That candidate was subsequently promoted: the live daily endpoint returned HTTP 200 with three agent rows, existing device integration health passed, and schedules were preserved.

Run: `node --test tests/daily-agent-performance.test.mjs tests/chat-agent-presentation.test.mjs tests/chat-customer-names-monthly-missed.test.mjs tests/browser-security-r2.test.mjs`

## Logged-in visibility

Both performance sections provide a synchronized **Hide logged-out agents** toggle. The browser remembers this display preference. Filtering uses the fresh active-session roster, not Available status, so idle, engaged and wrap-up agents remain visible. Current Chat workload also keeps an agent visible if the session roster is delayed. History-only rows are hidden without changing stored history, daily totals, or reporting period. If the roster is stale or unavailable, filtering pauses with an explicit notice rather than assuming sign-out. Chat CSV export follows the filtered view.
