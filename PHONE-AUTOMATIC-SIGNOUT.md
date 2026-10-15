# Automatic phone sign-out

After Sign Out Now, the phone displays a progress screen and refreshes every five seconds. No further confirmation, Refresh, or Restart Now click is required. The backend restores the baseline, synchronizes, confirms Webex and Phonism agree, and requests a restart. Newer assignments remain protected.

Requests address the enrolled phone and lease directly instead of loading every lease. Fast checks run for five minutes; scheduled maintenance continues afterward if synchronization or restart remains pending. Closing the screen can defer further checks until that handoff. The restart message confirms a request, not physical handset completion.

Manual sign-out uses Device-only synchronization first. If the line remains stale after 15 seconds, one bounded broader sync is attempted. Adding a temporary line now uses the same 15-second fallback threshold (previously 45 seconds). These calls remain scoped to the verified tenant; Device-only is an asset filter, not a documented single-handset sync API. Automatic expiry retains its existing sync scope.

Latest reported physical restart times before this change were T53 87 seconds and T57W 38 seconds. Those observations are not a guarantee for the new release. Verify actual add-line and sign-out timings on both models after deployment.
