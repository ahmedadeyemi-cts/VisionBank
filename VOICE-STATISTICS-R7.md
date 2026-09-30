# Voice statistics R7

## Definition correction

Queued means unique inbound contacts with reported `queueDuration > 0` milliseconds, not `queueCount > 0` or the presence of a queue ID in history. No IVR/ringing/connected time is substituted. Equal queued and answered totals remain possible. Offered means the CSR `isContactOffered` flag; repeated offers and transfers of a contact do not multiply unique-contact totals.

Sources: https://raw.githubusercontent.com/WebexSamples/webex-contact-center-api-samples/main/reporting-samples/graphql-sample/DataDictionary/CSR.md and https://developer.webex.com/webex-contact-center/docs/getting-started-with-search-api .

## Scope and calculations

Daily counts cover unique inbound Voice contacts STARTED in the America/Chicago business day. Historical queue durations can lag on active contacts.

- Received: all contacts in that cohort.
- Offered: contacts explicitly marked offered to an agent.
- Queued / actually waited: positive recorded queue duration.
- Answered: handled flag or a positive connection count.
- Abandoned: ended, unhandled contacts with source abandonment evidence.
- Not offered: explicit false offer flag; not a missed-calls count.
- Offered answer rate: answered members of the offered cohort / offered cohort.
- Queue abandonment rate: abandoned queue entrants / all queue entrants, including unresolved entrants. Pre-queue abandonment is excluded.
- Average wait: recorded queueDuration for completed answered contacts, including zeros. Not full arrival-to-answer or IVR/ringing time.
- Longest wait: completed queue entrants started today, not prior-day legs or active waits.
- Average talk: connectedDuration for completed answered contacts; not AHT.
- Answered within Webex target: true provider flags / completed answered cohort. Not contractual Service Level. No threshold or tenant SLA denominator is inferred.
- Now: waiting, offered, active, wrap-up from displayed Voice queues, excluding Chat. This live scope can contain older contacts.

Categories overlap; do not sum them as mutually exclusive call outcomes. Null/missing/invalid evidence produces unavailable; an empty eligible sample produces a dash, not zero or 100%. Callback history remains in the Callback Register; upcoming inventory is not connected.

## Preservation and deployment

The full combined Worker must match the guarded baseline hash. The build appends a single pure statistics override; no queries, endpoints, timers, security/auth code, scheduled jobs, call controls, or state writes are added. Existing fields are retained for older clients; the new UI uses `statistics.voicePerformance`. Customer names and both agent tables are retained. The legacy portal is unchanged.

Local unit and actual-page browser tests use synthetic records. The example fixture with 212 received, 10 offered, 5 waited and 9 answered is NOT a measurement of production.

Do not merge/promote until an authorized live reporting window allows candidate JSON and browser validation. The normal after-hours policy currently returns `hours-closed`; no bypass or security change is part of this release. Stage with deploy=false, inherit all 32 bindings from the exact production version, verify metadata/code, and promote the verified version only after the live gate. Never deploy the repository standalone Worker. Publish frontend after backend validation and verify Render assets.
