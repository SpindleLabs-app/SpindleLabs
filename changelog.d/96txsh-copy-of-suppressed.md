none

- The nightly monkey tester now knows that a Duplicate or Mirror of a body whose item is suppressed builds nothing (it is greyed with it), so it no longer reports the Bodies group as missing that copy (issues #472, #475, #479). A hand-worked test and a six-action regression list in apps/fission/e2e/regressions/ check it; the three nightly sessions replay clean.

public: none
