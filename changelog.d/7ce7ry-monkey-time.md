none

- The monkey tester's saves no longer miss a file on a busy test machine: the wait between two saves is timed in the page, where the app's double-click guard times it, and a new self-test delays one click to prove it.
- The monkey stops itself at the run's own time limit: a session it is in says it was cut off, later seeds say they were not started, and its summary (with how many Combines it made) is always printed; a run where no session finished is still a failure. The daytime runs start only as many sessions as fit before the cut-off.

public: none
