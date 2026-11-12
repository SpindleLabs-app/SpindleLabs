none

- The random tester now waits for a timeline Delete that is still being worked out before it compares the timeline bar with the saved file, so it no longer reports a mismatch that was only a moment early (issue #650). It checks this itself on every run with a slowed-down delete.

public: none
