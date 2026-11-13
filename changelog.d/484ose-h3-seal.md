none

- New tooling for the kernel checks: a job that runs the kernel can hand its result files to a later job in a sealed bundle that only the later job can open, and opening one refuses changed or unsafe bundles. Nothing uses it yet; tests cover a round trip, tampering and hostile archives.

public: none
