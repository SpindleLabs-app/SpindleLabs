none

- Version numbers: a new CAD step now adds one to the version's middle number instead of setting it to the step's own number. Step 89 (history kept across a reload, done early while the main line was at step 35) had made the version jump from 0.35.53 to 0.89.0, and every main-line step below 89 after it would have changed nothing. The numbers already given stay as they are (the five step entries merged under the old rule keep it), so no version goes backwards; the next step makes 0.90.0. CI now refuses a second start of a step already started. Verified: hand-worked cases including the real history replayed, seeded random merge orders against an independent model (no jump, never backwards), the pull request check through real git, and five deliberate breaks each caught.

public: none
