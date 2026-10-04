# VisionBank Security Hardening R4 — 2026-10-03

## Scope
Final browser-side hardening after R1–R3. This release does not change Webex/Phonism device-write logic, report schedules, cron behavior, or role policy.

## Changes
- HTML-encode external/API values in legacy Agent, Fax, and Voicemail table renderers.
- Remove inline Voicemail call-detail onclick construction and bind click handlers through data attributes.
- HTML-encode Voicemail call-detail fields and saved Fax/Voicemail schedule metadata.
- Render queue names with DOM textContent in both legacy and Webex dashboards.
- Make legacy/dashboard safe helpers HTML-encode values before innerHTML insertion.
- Add no-referrer metadata to all primary portal pages.
- Preserve the existing CSP on all primary portal entry points.
- Keep the shared portal bearer session in sessionStorage; localStorage is used only as a one-time legacy migration source and is removed afterward.
- Add a Render Blueprint header policy for X-Frame-Options, Referrer-Policy, Permissions-Policy, X-Content-Type-Options, and response-level CSP with frame-ancestors 'none'.

## Render header note
The repository now declares the required static-site response headers in render.yaml. Render applies Blueprint header rules only when the existing static site is managed/synced through that Blueprint. The application-level CSP, no-referrer metadata, and frame-busting remain active independently.

## Validation
- 93 security/device tests passing.
- Node syntax checks passing for every modified JavaScript file.
- git diff --check clean.
- Existing R1–R3 authorization, password, MFA, portal-session, reporting, and device-management tests remain green.
