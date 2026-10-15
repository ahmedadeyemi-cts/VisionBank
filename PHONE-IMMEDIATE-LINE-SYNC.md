# Immediate new-line synchronization

New-line saves now request People, Workspace, and Device synchronization together immediately after the Webex write, within the existing verified tenant/company scope. This removes the staged device-only attempt and its 15-second broader fallback delay. New leases use assignment-immediate; old pending device-first leases retain their recovery path. Sign-out and expiry behavior are unchanged.

Latest October 15 traces: T53 accepted at 21:42:08.571Z, broader sync accepted at 21:42:25.063Z, restart requested at 21:42:50.522Z. T57W accepted at 21:47:03.143Z, broader sync accepted at 21:47:21.009Z, restart requested at 21:48:11.590Z. Users reported 57 and 72 seconds respectively. Both attempts remained unconfirmed until after broader synchronization; this does not prove the broader call alone caused convergence.

The change removes an intentional staging delay. It cannot guarantee Phonism queue processing or handset restart time. Reboot still requires matching line confirmation. No repeated broader synchronization is added, and no unsupported single-phone API is assumed.
