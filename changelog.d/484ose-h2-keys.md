none

- The kernel's random testing no longer hands its access keys to the step that runs the kernel's code: the stop watcher starts in its own step, and the script that runs kernel commands drops every key from their environment. Two new tests check this.

public: none
