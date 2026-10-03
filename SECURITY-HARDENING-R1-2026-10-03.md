# VisionBank Security Hardening R1 — 2026-10-03

## Scope
This release hardens the legacy VisionBank Security/reporting Worker while preserving the current Device Manager, Webex, Phonism, reporting, scheduling, and cron behavior.

## Access policy
Interactive portal identities are limited to approved VisionBank and US Signal email domains. A private backend-only exception is represented by a SHA-256 policy value and is intentionally not rendered in the UI or admin lists.

## Critical remediations
- Protect legacy Security user management, logs, IP rules, and business-hours APIs with server-side session + role authorization.
- Stop returning stored password material from user-list responses.
- Migrate legacy plaintext passwords to PBKDF2-SHA256 after the next successful login.
- Hash all new/changed passwords before storage.
- Add login failure throttling.
- Replace unauthenticated MFA setup with a short-lived, IP-bound setup ticket issued only after successful password verification.
- Stage MFA secrets until TOTP confirmation instead of overwriting the active secret immediately.
- Give Security Console logout a server-side session revocation route.
- Fail closed if the IP allowlist is empty and reject attempts to save an empty allowlist.
- Require approved-network access for legacy fax/voicemail schedule and agent-setting routes that previously lacked consistent access enforcement.
- Restrict fax/voicemail scheduled-report recipients to approved corporate domains.
- Remove raw authentication tokens and customer/agent sample payloads from Worker logs.
- Remove stored-XSS sinks from Security user and IP-rule rendering.
- Restrict Device Manager verification emails to the approved portal identity policy.

## Password compatibility
Existing plaintext records are not bulk-rewritten during deployment. On the next successful login, the known password is verified once and the record is atomically replaced with:
- passwordScheme: pbkdf2-sha256-v1
- random 128-bit salt
- PBKDF2-SHA256 with 210,000 iterations
- 256-bit derived password hash

The plaintext password field is removed during migration.

## Preserved behavior
- 207 VisionBank phones remain in organization-wide Device Manager scope.
- Webex/Phonism write, sync, reboot, lease, rollback, and drift protections are unchanged.
- Existing fax and voicemail schedules remain unchanged.
- Existing Worker secrets, KV namespaces, Durable Object bindings, and cron are inherited from the current production version.
- Factory Reset remains unavailable.

## Release method
The current 100%-serving Worker is the immutable rollback base. A zero-traffic Cloudflare version is created with all bindings and unchanged modules hash-locked. Only the reviewed main Worker module and Device Manager identity module differ.
