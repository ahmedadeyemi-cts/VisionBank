# Automatic phone sign-out

After Sign Out Now, the phone displays a progress screen and refreshes every five seconds. No further confirmation, Refresh, or Restart Now click is required. The backend restores the baseline, synchronizes, confirms Webex and Phonism agree, and requests a restart. Newer assignments remain protected.

Requests address the enrolled phone and lease directly instead of loading every lease. Fast checks run for five minutes; scheduled maintenance continues afterward if synchronization or restart remains pending. Closing the screen can defer further checks until that handoff. The restart message confirms a request, not physical handset completion.

Manual sign-out and expiry cleanup use a full People + Workspace + Device synchronization before reboot so removed extensions are fully regenerated in handset provisioning. Normal new assignments remain Device-only for speed. When a temporary extension is handed off from one phone to another, the destination also uses the full People + Workspace + Device synchronization before reboot; permanent existing assignments are preserved.

Latest reported physical restart times before this change were T53 87 seconds and T57W 38 seconds. Those observations are not a guarantee for the new release. Verify actual add-line and sign-out timings on both models after deployment.
