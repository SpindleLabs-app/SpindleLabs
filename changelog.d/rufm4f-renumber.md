none

- Version numbers renumbered once (owner's call, 16 Nov 2026): the entries from 11 Nov on, shown as 0.89.0 to 0.89.94 because step 89 used to set the middle number to 89, now follow the counting rule. Steps 89, 77, 53 and 66 each add one, so they read 0.36.0 to 0.39.39 and the app shows 0.39.39. The next step makes 0.40.0. Only step 35 keeps the old rule. The version is display-only (Settings > About and bug reports), and the offline copy updates when the build changes, never by comparing numbers, so going back down once is safe. Verified: the changelog tests with the renumbered history worked out by hand, the seeded merge orders, a deliberate break (step 89 put back on the old rule gives 0.92.39 and fails two tests), and `changelog.py public` now heads What's new with 0.39.39.

public:
- The version number in Settings > About and What's new is corrected: versions shown as 0.89 since 11 November now read 0.36 to 0.39.
