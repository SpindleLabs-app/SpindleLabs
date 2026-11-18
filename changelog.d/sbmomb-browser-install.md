none

- The browser checks' install step now really switches mirror when the runner's own Ubuntu mirror stalls (the new runner image names a different mirror, which the old switch missed), tries a third mirror on the last try, and keeps the browsers and their packages between runs, so a stalled mirror no longer fails the phone check. A failed install still fails the check.

public: none
