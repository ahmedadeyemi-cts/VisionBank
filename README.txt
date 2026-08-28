VISIONBANK WEBEX AGENT - STANDALONE SAFE DEPLOYMENT
===================================================

WHY
---
Do NOT modify the stable visionbank-security Worker again.
It remains on known-good version 129 with all existing bindings/secrets.

This package deploys a NEW Worker:
  visionbank-webex-agent

It reuses existing KV namespaces by ID:
- SESSIONS
- BUSINESS
- IP_ALLOWLIST
- AGENT_SETTINGS_KV
- LOGOUT_CONFIG
- WEBEX_AUTH_KV

NO EXISTING SECRET VALUES ARE REQUIRED.

The stable visionbank-security Worker continues to:
- authenticate users
- maintain MFA
- refresh the Webex OAuth token into WEBEX_AUTH_KV
- run voicemail/fax/other existing features

The standalone Worker:
- reads the current Webex token from shared WEBEX_AUTH_KV
- lists active Webex agents
- stores signout settings/history
- supports Dry Run
- supports manual per-agent signout
- runs automatic weekday/Saturday signout every 5 minutes
- honors the existing VisionBank IP allowlist/business hours/session

DEPLOY
------
1. Unzip locally:
   mkdir -p ~/visionbank-webex-agent
   cd ~/visionbank-webex-agent
   unzip -o ~/Downloads/visionbank-webex-agent-standalone-v1.zip

2. Syntax check:
   node --check worker.js

3. Deploy the NEW Worker:
   npx wrangler deploy --config wrangler.jsonc

This creates/updates ONLY:
  visionbank-webex-agent

It does NOT modify:
  visionbank-security

4. Test:
   https://visionbank-webex-agent.ahmedadeyemi.workers.dev/health

Expected:
   success: true
   service: visionbank-webex-agent

5. Upload to Render:
   webex-agent.html
   webex-agent.css
   webex-agent.js

6. Open:
   https://visionbank-dashboard.onrender.com/webex-agent.html

7. KEEP DRY RUN ENABLED.
   Click Refresh Logged-In Agents.
   Then click Run Auto-Signout Now.

EMAIL REMINDER NOTE
-------------------
The standalone Worker deliberately does not send Brevo email because the
BREVO_API_KEY exists only inside the historical stable Worker version.
Legacy reminder functionality remains untouched on agents.html.
This avoids regenerating or moving any secret.
